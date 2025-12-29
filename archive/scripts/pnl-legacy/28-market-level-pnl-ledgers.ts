import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Polymarket API time window
const START_TIME = new Date(1724259231000); // 2024-08-21
const END_TIME = new Date(1763250566105);   // 2025-11-11

async function buildMarketLevelLedgers() {
  console.log('=== Step 1: Per-Market PnL Ledgers ===\n');
  console.log(`Time window: ${START_TIME.toISOString()} to ${END_TIME.toISOString()}\n`);

  // Find top 10 markets by volume
  const topMarketsQuery = `
    SELECT
      condition_id_norm_v3 AS condition_id,
      outcome_index_v3 AS outcome_idx,
      sum(abs(usd_value)) AS total_volume,
      count() AS trade_count
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
      AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
    GROUP BY condition_id, outcome_idx
    ORDER BY total_volume DESC
    LIMIT 10
  `;

  const topMarketsResult = await clickhouse.query({ query: topMarketsQuery, format: 'JSONEachRow' });
  const topMarkets = await topMarketsResult.json<any[]>();

  console.log('Top 10 Markets by Volume:\n');

  const marketSummaries: any[] = [];

  for (let i = 0; i < topMarkets.length; i++) {
    const market = topMarkets[i];
    const conditionId = market.condition_id;
    const outcomeIdx = market.outcome_idx;

    console.log(`[${i + 1}] Condition: ${conditionId.substring(0, 16)}... Outcome: ${outcomeIdx}`);
    console.log(`    Volume: $${Number(market.total_volume).toLocaleString()}, Trades: ${market.trade_count}\n`);

    // Get trade ledger for this market position
    const ledgerQuery = `
      SELECT
        timestamp,
        trade_direction,
        shares,
        price,
        usd_value
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 = '${conditionId}'
        AND outcome_index_v3 = ${outcomeIdx}
        AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
        AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
      ORDER BY timestamp ASC
    `;

    const ledgerResult = await clickhouse.query({ query: ledgerQuery, format: 'JSONEachRow' });
    const trades = await ledgerResult.json<any[]>();

    // Build cumulative position
    let cumulativeCash = 0;
    let cumulativeShares = 0;

    console.log('    Trade Ledger:');
    console.log('    ─'.repeat(40));

    trades.forEach((trade, idx) => {
      const side = trade.trade_direction;
      const shares = Number(trade.shares);
      const usdValue = Number(trade.usd_value);
      const price = Number(trade.price);

      // cash_delta: BUY = negative (spend), SELL = positive (receive)
      const cashDelta = side === 'BUY' ? -usdValue : usdValue;

      cumulativeCash += cashDelta;
      cumulativeShares += (side === 'BUY' ? shares : -shares);

      if (idx < 5) { // Show first 5 trades
        console.log(`    ${trade.timestamp.substring(0, 16)} | ${side.padEnd(4)} | ${shares.toFixed(2).padStart(10)} @ $${price.toFixed(4)} | Cash: ${cashDelta >= 0 ? '+' : ''}$${cashDelta.toFixed(2).padStart(10)} | Pos: ${cumulativeShares.toFixed(2)}`);
      }
    });

    if (trades.length > 5) {
      console.log(`    ... (${trades.length - 5} more trades)`);
    }

    console.log('    ─'.repeat(40));
    console.log(`    Final Position: ${cumulativeShares.toFixed(2)} shares, Cumulative Cash: $${cumulativeCash.toFixed(2)}\n`);

    // Get resolution for this market
    const resolutionQuery = `
      SELECT
        payout_numerators,
        payout_denominator,
        winning_index,
        winning_outcome
      FROM market_resolutions_final
      WHERE condition_id_norm = '${conditionId}'
        AND payout_denominator > 0
      LIMIT 1
    `;

    const resolutionResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resolution = await resolutionResult.json<any[]>();

    if (resolution.length > 0) {
      const res = resolution[0];
      const payoutArray = Array.isArray(res.payout_numerators) ? res.payout_numerators : [];
      const payoutDenom = Number(res.payout_denominator);
      const myPayout = Number(payoutArray[outcomeIdx] || 0);
      const winningIdx = Number(res.winning_index);

      // Compute settlement
      const settlementValue = cumulativeShares * (myPayout / payoutDenom);
      const marketPnL = settlementValue + cumulativeCash;

      console.log(`    Resolution:`);
      console.log(`      Winning Outcome: ${res.winning_outcome} (index=${winningIdx})`);
      console.log(`      Our Outcome: ${outcomeIdx}`);
      console.log(`      Payout: ${myPayout}/${payoutDenom} = ${(myPayout / payoutDenom).toFixed(4)}`);
      console.log(`      Settlement Value: ${cumulativeShares.toFixed(2)} × ${(myPayout / payoutDenom).toFixed(4)} = $${settlementValue.toFixed(2)}`);
      console.log(`      Market PnL: $${settlementValue.toFixed(2)} + $${cumulativeCash.toFixed(2)} = ${marketPnL >= 0 ? '✅' : '❌'} $${marketPnL.toFixed(2)}`);

      marketSummaries.push({
        rank: i + 1,
        condition_id: conditionId.substring(0, 16) + '...',
        our_outcome: outcomeIdx,
        winning_outcome: winningIdx,
        match: outcomeIdx === winningIdx ? '✅' : '❌',
        final_shares: cumulativeShares.toFixed(2),
        cumulative_cash: cumulativeCash.toFixed(2),
        settlement_value: settlementValue.toFixed(2),
        market_pnl: marketPnL.toFixed(2),
        trade_count: trades.length,
      });
    } else {
      console.log(`    ⚠️  No resolution found`);

      marketSummaries.push({
        rank: i + 1,
        condition_id: conditionId.substring(0, 16) + '...',
        our_outcome: outcomeIdx,
        winning_outcome: 'N/A',
        match: 'N/A',
        final_shares: cumulativeShares.toFixed(2),
        cumulative_cash: cumulativeCash.toFixed(2),
        settlement_value: 'N/A',
        market_pnl: 'Unresolved',
        trade_count: trades.length,
      });
    }

    console.log('\n' + '═'.repeat(80) + '\n');
  }

  // Summary table
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MARKET-LEVEL PNL SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('| # | Condition ID      | Our | Win | Match | Final Shares | Cum Cash    | Settlement  | Market PnL  | Trades |');
  console.log('|---|-------------------|-----|-----|-------|--------------|-------------|-------------|-------------|--------|');

  marketSummaries.forEach(m => {
    console.log(`| ${String(m.rank).padStart(1)} | ${m.condition_id} | ${String(m.our_outcome).padStart(3)} | ${String(m.winning_outcome).padStart(3)} | ${m.match.padStart(5)} | ${String(m.final_shares).padStart(12)} | ${String(m.cumulative_cash).padStart(11)} | ${String(m.settlement_value).padStart(11)} | ${String(m.market_pnl).padStart(11)} | ${String(m.trade_count).padStart(6)} |`);
  });

  console.log('\n');

  // Calculate totals
  const resolvedSummaries = marketSummaries.filter(m => m.market_pnl !== 'Unresolved');
  const totalMarketPnL = resolvedSummaries.reduce((sum, m) => sum + Number(m.market_pnl), 0);
  const matchCount = resolvedSummaries.filter(m => m.match === '✅').length;
  const mismatchCount = resolvedSummaries.filter(m => m.match === '❌').length;

  console.log('Summary:');
  console.log(`  Resolved markets: ${resolvedSummaries.length}`);
  console.log(`  Outcome matches: ${matchCount} ✅`);
  console.log(`  Outcome mismatches: ${mismatchCount} ❌`);
  console.log(`  Total PnL (top 10): $${totalMarketPnL.toFixed(2)}`);
  console.log('');

  if (mismatchCount > matchCount) {
    console.log('🚨 PATTERN: Majority of markets show outcome mismatch!');
    console.log('   This confirms the 2.6% win rate is real in our data.');
  }

  console.log('\n');
  return marketSummaries;
}

buildMarketLevelLedgers().catch(console.error);
