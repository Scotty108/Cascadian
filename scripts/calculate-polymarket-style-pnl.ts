#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const wallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'; // burrito338

/**
 * POLYMARKET-STYLE P&L CALCULATION
 *
 * Only counts "closed" positions where:
 * - User both entered AND exited the position
 * - Net shares ≈ 0 (fully closed)
 * - P&L = trading profit from price spread
 *
 * This matches Polymarket's "Closed" tab methodology
 */

async function calculatePolymarketStylePnL() {
  console.log('POLYMARKET-STYLE P&L CALCULATION');
  console.log('═'.repeat(80));
  console.log('Wallet:', wallet);
  console.log();
  console.log('Methodology: Only CLOSED positions (net_shares ≈ 0)');
  console.log();

  // Step 1: Calculate net position per market
  const closedPositions = await client.query({
    query: `
      WITH positions AS (
        SELECT
          t.condition_id_norm,
          t.market_id_norm,
          t.outcome_index,
          -- Net shares: positive = long, negative = short
          sum(CASE WHEN t.trade_direction = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
          -- Total cost basis (what you paid minus what you received)
          sum(CASE WHEN t.trade_direction = 'BUY' THEN t.usd_value ELSE -t.usd_value END) as cost_basis,
          -- Total spent buying
          sum(CASE WHEN t.trade_direction = 'BUY' THEN t.usd_value ELSE 0 END) as total_bought,
          -- Total received selling
          sum(CASE WHEN t.trade_direction = 'SELL' THEN t.usd_value ELSE 0 END) as total_sold,
          count() as num_trades
        FROM default.vw_trades_canonical t
        WHERE lower(t.wallet_address_norm) = lower('${wallet}')
          AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY t.condition_id_norm, t.market_id_norm, t.outcome_index
      ),
      closed_positions AS (
        SELECT
          condition_id_norm,
          market_id_norm,
          outcome_index,
          net_shares,
          cost_basis,
          total_bought,
          total_sold,
          num_trades,
          -- For CLOSED positions: P&L = what you sold for - what you paid
          -- This is just the negative of cost_basis
          -cost_basis as realized_pnl
        FROM positions
        WHERE abs(net_shares) < 100  -- Consider "closed" if < 100 shares remaining
      ),
      with_resolutions AS (
        SELECT
          cp.*,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator
        FROM closed_positions cp
        LEFT JOIN cascadian_clean.vw_resolutions_unified r
          ON lower(cp.condition_id_norm) = r.cid_hex
      )
      SELECT
        market_id_norm,
        condition_id_norm,
        outcome_index,
        toFloat64(net_shares) as net_shares,
        toFloat64(total_bought) as total_bought,
        toFloat64(total_sold) as total_sold,
        toFloat64(cost_basis) as cost_basis,
        toFloat64(realized_pnl) as realized_pnl,
        num_trades,
        winning_index,
        payout_numerators
      FROM with_resolutions
      ORDER BY abs(realized_pnl) DESC
    `,
    format: 'JSONEachRow',
  });

  const positions = await closedPositions.json<any[]>();

  console.log(`Found ${positions.length} closed positions`);
  console.log();

  // Calculate totals
  let totalGains = 0;
  let totalLosses = 0;
  let totalVolume = 0;
  let resolvedCount = 0;

  for (const pos of positions) {
    const pnl = parseFloat(pos.realized_pnl);
    const volume = parseFloat(pos.total_bought) + parseFloat(pos.total_sold);

    totalVolume += volume;

    if (pnl > 0) {
      totalGains += pnl;
    } else {
      totalLosses += pnl;
    }

    if (pos.winning_index !== null) {
      resolvedCount++;
    }
  }

  const netPnL = totalGains + totalLosses;

  console.log('═'.repeat(80));
  console.log('RESULTS - POLYMARKET STYLE (CLOSED POSITIONS ONLY)');
  console.log('═'.repeat(80));
  console.log();

  console.log('Summary:');
  console.log('  Total closed positions:', positions.length);
  console.log('  Positions with resolutions:', resolvedCount);
  console.log('  Trading volume (buys + sells):', '$' + totalVolume.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  console.log();

  console.log('P&L Breakdown:');
  console.log('  Total Gains:  +$' + totalGains.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  console.log('  Total Losses: -$' + Math.abs(totalLosses).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  console.log('  Net P&L:      ' + (netPnL >= 0 ? '+' : '') + '$' + netPnL.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  console.log();

  console.log('─'.repeat(80));
  console.log('COMPARISON TO POLYMARKET OFFICIAL');
  console.log('─'.repeat(80));
  console.log();

  const polyGains = 276100.40;
  const polyLosses = 133850.73;
  const polyNet = 142249.67;
  const polyVolume = 3662068.40;

  console.log('Polymarket Official:');
  console.log('  Gains:  +$' + polyGains.toLocaleString());
  console.log('  Losses: -$' + polyLosses.toLocaleString());
  console.log('  Net:    +$' + polyNet.toLocaleString());
  console.log('  Volume: $' + polyVolume.toLocaleString());
  console.log();

  console.log('Our Calculation:');
  console.log('  Gains:  +$' + totalGains.toLocaleString());
  console.log('  Losses: -$' + Math.abs(totalLosses).toLocaleString());
  console.log('  Net:    +$' + netPnL.toLocaleString());
  console.log('  Volume: $' + totalVolume.toLocaleString());
  console.log();

  console.log('Match %:');
  console.log('  Gains:  ' + ((totalGains / polyGains * 100).toFixed(1)) + '%');
  console.log('  Losses: ' + ((Math.abs(totalLosses) / polyLosses * 100).toFixed(1)) + '%');
  console.log('  Net:    ' + ((netPnL / polyNet * 100).toFixed(1)) + '%');
  console.log('  Volume: ' + ((totalVolume / polyVolume * 100).toFixed(1)) + '%');
  console.log();

  if (Math.abs(netPnL - polyNet) < 1000) {
    console.log('✅ EXACT MATCH! Within $1k of Polymarket official');
  } else if (Math.abs((netPnL - polyNet) / polyNet) < 0.05) {
    console.log('✅ CLOSE MATCH! Within 5% of Polymarket official');
  } else {
    console.log('⚠️  VARIANCE - Difference: $' + (netPnL - polyNet).toLocaleString());
  }

  console.log();
  console.log('─'.repeat(80));
  console.log('TOP 10 CLOSED POSITIONS BY P&L');
  console.log('─'.repeat(80));
  console.log();

  const top10 = positions.slice(0, 10);
  for (const pos of top10) {
    console.log('Market:', pos.market_id_norm);
    console.log('  Outcome:', pos.outcome_index);
    console.log('  Trades:', pos.num_trades);
    console.log('  Net shares (remaining):', parseFloat(pos.net_shares).toFixed(2));
    console.log('  Total bought: $' + parseFloat(pos.total_bought).toFixed(2));
    console.log('  Total sold:   $' + parseFloat(pos.total_sold).toFixed(2));
    console.log('  Realized P&L: ' + (parseFloat(pos.realized_pnl) >= 0 ? '+' : '') + '$' + parseFloat(pos.realized_pnl).toFixed(2));
    console.log('  Status:', pos.winning_index !== null ? 'Resolved' : 'Unresolved');
    console.log();
  }

  await client.close();
}

calculatePolymarketStylePnL().catch(console.error);
