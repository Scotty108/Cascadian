#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard - Actual Bet Sizes (No Simulation)
 *
 * Calculates LogGrowthPerDay based on wallet's ACTUAL trades and bet sizes.
 * No simulation - just their real performance.
 *
 * LogGrowthPerDay = ln(B_T / B_0) / days
 * Where:
 *   B_0 = total cost (sum of all buys)
 *   B_T = B_0 + total PnL
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { writeFileSync } from 'fs';

const LOOKBACK_DAYS = 90;
const OUTPUT_PATH = '/Users/scotty/Projects/Cascadian-app/copytrade-leaderboard-actual-bets.csv';

async function main() {
  console.log('='.repeat(60));
  console.log('Copytrading Leaderboard - Actual Bet Sizes');
  console.log('='.repeat(60));
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log('Using actual wallet bet sizes (no simulation)\n');

  const startTime = Date.now();

  const query = `
    WITH
    -- Wallet age (first ever trade)
    wallet_age AS (
      SELECT wallet, min(entry_time) as first_ever_trade
      FROM pm_trade_fifo_roi_v3_mat_unified
      GROUP BY wallet
    ),

    -- 90-day closed trades (LONG only)
    trades_90d AS (
      SELECT *
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND is_closed = 1
        AND is_short = 0
        AND abs(cost_usd) >= 0.01
    ),

    -- Recent activity (buy in last 4 days)
    recent_buys AS (
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL 4 DAY
    ),

    -- Wallet stats with all metrics
    wallet_stats AS (
      SELECT
        wallet,
        count() as total_trades,
        uniq(condition_id) as unique_markets,
        countIf(pnl_usd > 0) / count() * 100 as win_rate,
        quantile(0.5)(roi * 100) as median_roi_raw,
        quantile(0.5)(abs(cost_usd)) as median_bet_size,
        quantile(0.95)(roi * 100) as p95_roi,

        -- For actual LogGrowthPerDay calculation
        sum(abs(cost_usd)) as total_cost,
        sum(pnl_usd) as total_pnl,
        min(entry_time) as first_trade,
        max(entry_time) as last_trade,

        -- Additional metrics
        quantileIf(0.5)(roi * 100, pnl_usd > 0) as median_win_roi,
        quantileIf(0.5)(abs(roi) * 100, pnl_usd <= 0) as median_loss_roi,
        avg(abs(cost_usd)) as avg_bet_size
      FROM trades_90d
      GROUP BY wallet
    ),

    -- Calculate LogGrowthPerDay
    wallet_growth AS (
      SELECT
        ws.*,
        -- Days active
        greatest(1, (toUnixTimestamp(ws.last_trade) - toUnixTimestamp(ws.first_trade)) / 86400.0) as days_active,
        -- B_T = total_cost + total_pnl
        ws.total_cost + ws.total_pnl as final_value,
        -- LogGrowthPerDay = ln(B_T / B_0) / days
        CASE
          WHEN ws.total_cost > 0 AND (ws.total_cost + ws.total_pnl) > 0
          THEN ln((ws.total_cost + ws.total_pnl) / ws.total_cost) /
               greatest(1, (toUnixTimestamp(ws.last_trade) - toUnixTimestamp(ws.first_trade)) / 86400.0)
          ELSE 0
        END as log_growth_per_day,
        -- Winsorized median ROI
        least(ws.median_roi_raw, ws.p95_roi) as median_roi_winsorized
      FROM wallet_stats ws
    )

    SELECT
      wg.wallet as wallet,
      wg.log_growth_per_day,
      -- Return %/day = (exp(logGrowth) - 1) * 100
      (exp(wg.log_growth_per_day) - 1) * 100 as return_pct_per_day,
      -- ROI %/day
      (wg.total_pnl / wg.total_cost / wg.days_active) * 100 as roi_pct_per_day,
      -- Trades per day
      wg.total_trades / wg.days_active as trades_per_day,
      -- Financial metrics
      wg.total_cost,
      wg.total_pnl,
      wg.final_value,
      wg.total_trades,
      wg.unique_markets,
      -- Edge per trade
      (wg.win_rate / 100) * wg.median_win_roi - ((1 - wg.win_rate / 100) * wg.median_loss_roi) as edge_per_trade,
      -- Compounding score
      ((wg.win_rate / 100) * wg.median_win_roi - ((1 - wg.win_rate / 100) * wg.median_loss_roi)) / greatest(1, wg.days_active) as compounding_score,
      wg.win_rate,
      wg.median_roi_winsorized as median_roi,
      wg.median_bet_size,
      wg.avg_bet_size,
      wg.days_active,
      wg.last_trade
    FROM wallet_growth wg
    INNER JOIN wallet_age wa ON wg.wallet = wa.wallet
    INNER JOIN recent_buys rb ON wg.wallet = rb.wallet
    WHERE
      -- Wallet age > 4 days
      wa.first_ever_trade < now() - INTERVAL 4 DAY
      -- Step 2: > 30 trades
      AND wg.total_trades > 30
      -- Step 3: > 7 markets
      AND wg.unique_markets > 7
      -- Step 4: Win rate > 40%
      AND wg.win_rate > 40
      -- Step 5: Median ROI > 10% (winsorized)
      AND wg.median_roi_winsorized > 10
      -- Step 6: Median bet size > $5
      AND wg.median_bet_size > 5
      -- Must have positive final value
      AND wg.final_value > 0
    ORDER BY wg.log_growth_per_day DESC
    LIMIT 50
  `;

  console.log('Running query...\n');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    request_timeout: 120000
  });

  const rows = await result.json<any>();

  console.log(`Found ${rows.length} qualifying wallets\n`);

  // Display results
  console.log('='.repeat(140));
  console.log('TOP 50 WALLETS BY LOG GROWTH PER DAY (Actual Bet Sizes)');
  console.log('='.repeat(140));
  console.log('Rank | Wallet         | LogGrowth/D | Return%/D | TotalCost | TotalPnL  | Trades | Markets | WinRate | MedianROI | AvgBet');
  console.log('-'.repeat(140));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.wallet) continue;
    const rank = (i + 1).toString().padStart(4);
    const wallet = r.wallet.substring(0, 12) + '...';
    const logGrowth = r.log_growth_per_day.toFixed(6);
    const returnPct = r.return_pct_per_day.toFixed(2) + '%';
    const totalCost = '$' + Math.round(r.total_cost).toLocaleString();
    const totalPnl = '$' + Math.round(r.total_pnl).toLocaleString();
    const trades = r.total_trades.toString();
    const markets = r.unique_markets.toString();
    const winRate = r.win_rate.toFixed(1) + '%';
    const medianRoi = r.median_roi.toFixed(1) + '%';
    const avgBet = '$' + r.avg_bet_size.toFixed(0);

    console.log(
      `${rank} | ${wallet.padEnd(14)} | ${logGrowth.padStart(11)} | ${returnPct.padStart(9)} | ` +
      `${totalCost.padStart(9)} | ${totalPnl.padStart(9)} | ${trades.padStart(6)} | ${markets.padStart(7)} | ` +
      `${winRate.padStart(7)} | ${medianRoi.padStart(9)} | ${avgBet.padStart(6)}`
    );
  }

  console.log('='.repeat(140));
  console.log('');

  // Export CSV
  const csvHeader = [
    'rank',
    'wallet',
    'log_growth_per_day',
    'return_pct_per_day',
    'roi_pct_per_day',
    'trades_per_day',
    'total_cost',
    'total_pnl',
    'final_value',
    'total_trades',
    'unique_markets',
    'edge_per_trade',
    'compounding_score',
    'win_rate',
    'median_roi',
    'median_bet_size',
    'avg_bet_size',
    'days_active',
    'last_trade'
  ].join(',');

  const csvRows = rows.map((r: any, i: number) => [
    i + 1,
    r.wallet,
    r.log_growth_per_day,
    r.return_pct_per_day,
    r.roi_pct_per_day,
    r.trades_per_day,
    r.total_cost,
    r.total_pnl,
    r.final_value,
    r.total_trades,
    r.unique_markets,
    r.edge_per_trade,
    r.compounding_score,
    r.win_rate,
    r.median_roi,
    r.median_bet_size,
    r.avg_bet_size,
    r.days_active,
    r.last_trade
  ].join(','));

  writeFileSync(OUTPUT_PATH, csvHeader + '\n' + csvRows.join('\n'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Completed in ${elapsed} seconds`);
  console.log(`CSV exported: ${OUTPUT_PATH}`);

  // Summary
  if (rows.length > 0) {
    const best = rows[0];
    const totalVolume = rows.reduce((sum: number, r: any) => sum + r.total_cost, 0);
    const totalPnl = rows.reduce((sum: number, r: any) => sum + r.total_pnl, 0);

    console.log('\nSummary:');
    console.log(`  Best wallet: ${best.wallet.substring(0, 16)}...`);
    console.log(`  Best LogGrowthPerDay: ${best.log_growth_per_day.toFixed(6)}`);
    console.log(`  Best return/day: ${best.return_pct_per_day.toFixed(2)}%`);
    console.log(`  Best total PnL: $${Math.round(best.total_pnl).toLocaleString()}`);
    console.log(`  Top 50 total volume: $${Math.round(totalVolume).toLocaleString()}`);
    console.log(`  Top 50 total PnL: $${Math.round(totalPnl).toLocaleString()}`);
  }
}

main().catch(console.error);
