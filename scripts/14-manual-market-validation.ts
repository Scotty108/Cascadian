import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function manualMarketValidation() {
  console.log('=== Manual Market-by-Market PnL Validation ===\n');
  console.log('Strategy: Pick 3 markets and manually trace each trade\n');

  // Step 1: Get markets with resolved positions
  const marketsQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
        count() AS trade_count,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      p.condition_id,
      p.outcome_idx,
      p.net_shares,
      p.net_cost,
      p.trade_count,
      p.first_trade,
      p.last_trade,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator,
      r.winning_outcome,
      if(
        r.payout_denominator > 0,
        (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
        -toFloat64(p.net_cost)
      ) AS calculated_pnl
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
    ORDER BY abs(calculated_pnl) DESC
    LIMIT 10
  `;

  const result = await clickhouse.query({ query: marketsQuery, format: 'JSONEachRow' });
  const markets = await result.json<any[]>();

  console.log('Top 10 positions by absolute PnL:\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  for (let i = 0; i < Math.min(3, markets.length); i++) {
    const market = markets[i];

    console.log(`\n[${i + 1}] Position #${i + 1}`);
    console.log('─'.repeat(79));
    console.log(`Condition ID: ${market.condition_id}`);
    console.log(`Outcome Index: ${market.outcome_idx}`);
    console.log(`Winning Outcome: ${market.winning_outcome}`);
    console.log(`Trade Count: ${market.trade_count}`);
    console.log(`First Trade: ${market.first_trade}`);
    console.log(`Last Trade: ${market.last_trade}`);
    console.log('');

    // Get individual trades for this position
    const tradesQuery = `
      SELECT
        timestamp,
        trade_direction,
        shares,
        usd_value,
        price
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 = '${market.condition_id}'
        AND outcome_index_v3 = ${market.outcome_idx}
      ORDER BY timestamp
    `;

    const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
    const trades = await tradesResult.json<any[]>();

    console.log('Trade History:');
    let runningShares = 0;
    let runningCost = 0;

    trades.forEach((trade, idx) => {
      const direction = trade.trade_direction;
      const shares = Number(trade.shares);
      const cost = Number(trade.usd_value);

      if (direction === 'BUY') {
        runningShares += shares;
        runningCost += cost;
      } else {
        runningShares -= shares;
        runningCost -= cost;
      }

      console.log(`  ${idx + 1}. ${trade.timestamp.substring(0, 10)} | ${direction.padEnd(4)} | ` +
                  `${shares.toFixed(2)} shares @ $${Number(trade.price).toFixed(4)} = $${cost.toFixed(2)} | ` +
                  `Running: ${runningShares.toFixed(2)} shares, $${runningCost.toFixed(2)} cost`);
    });

    console.log('');
    console.log('Final Position:');
    console.log(`  Net Shares: ${Number(market.net_shares).toFixed(2)}`);
    console.log(`  Net Cost: $${Number(market.net_cost).toFixed(2)}`);
    console.log('');

    // Resolution info
    const payoutNumerators = Array.isArray(market.payout_numerators)
      ? market.payout_numerators
      : JSON.parse(market.payout_numerators);
    const payoutDenom = Number(market.payout_denominator);
    const outcomeIdx = Number(market.outcome_idx);
    const myPayout = Number(payoutNumerators[outcomeIdx]);

    console.log('Resolution:');
    console.log(`  Winning Index: ${market.winning_index}`);
    console.log(`  Payout Numerators: [${payoutNumerators.join(', ')}]`);
    console.log(`  Payout Denominator: ${payoutDenom}`);
    console.log(`  My Outcome (${outcomeIdx}) Payout: ${myPayout}/${payoutDenom} = ${(myPayout / payoutDenom).toFixed(4)}`);
    console.log('');

    // Manual PnL calculation
    const netShares = Number(market.net_shares);
    const netCost = Number(market.net_cost);
    const settlementValue = netShares * (myPayout / payoutDenom);
    const manualPnL = settlementValue - netCost;

    console.log('Manual PnL Calculation:');
    console.log(`  Settlement Value = ${netShares.toFixed(2)} shares × (${myPayout}/${payoutDenom}) = $${settlementValue.toFixed(2)}`);
    console.log(`  PnL = $${settlementValue.toFixed(2)} - $${netCost.toFixed(2)} = $${manualPnL.toFixed(2)}`);
    console.log('');
    console.log(`  Formula PnL: $${Number(market.calculated_pnl).toFixed(2)}`);
    console.log(`  Match: ${Math.abs(manualPnL - Number(market.calculated_pnl)) < 0.01 ? '✅' : '❌'}`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
  }

  // Summary
  console.log('\n\nSUMMARY:');
  console.log('─'.repeat(79));

  const totalCalculatedPnL = markets.reduce((sum, m) => sum + Number(m.calculated_pnl), 0);
  console.log(`Total PnL from top 10 positions: $${totalCalculatedPnL.toFixed(2)}`);
  console.log(`Total positions analyzed: ${markets.length}`);
  console.log('');

  // Check if there are positions without resolutions
  const unresolvedQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      count() AS total_positions,
      countIf(r.condition_id_norm IS NULL) AS unresolved_positions,
      countIf(r.payout_denominator = 0) AS invalid_resolution,
      countIf(r.payout_denominator > 0) AS valid_resolution
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
  `;

  const unresolvedResult = await clickhouse.query({ query: unresolvedQuery, format: 'JSONEachRow' });
  const unresolvedData = await unresolvedResult.json<any[]>();
  const stats = unresolvedData[0];

  console.log('Position Coverage:');
  console.log(`  Total positions: ${stats.total_positions}`);
  console.log(`  Valid resolutions: ${stats.valid_resolution} (${((stats.valid_resolution / stats.total_positions) * 100).toFixed(1)}%)`);
  console.log(`  Unresolved: ${stats.unresolved_positions}`);
  console.log(`  Invalid resolution data: ${stats.invalid_resolution}`);
  console.log('');
}

manualMarketValidation().catch(console.error);
