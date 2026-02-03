/**
 * Test Leaderboard V3
 *
 * Tests the new copy trading leaderboard with log growth metrics.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function testLeaderboard() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Test Leaderboard V3 ===\n');

  // First check the percentiles
  console.log('Step 1: Checking ROI percentiles for winsorization...');
  const percResult = await client.query({
    query: `
      SELECT
        quantile(0.025)(roi) as p2_5,
        quantile(0.975)(roi) as p97_5,
        min(roi) as min_roi,
        max(roi) as max_roi
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const perc = (await percResult.json() as any[])[0];
  console.log(`  2.5th percentile: ${Number(perc.p2_5).toFixed(4)}`);
  console.log(`  97.5th percentile: ${Number(perc.p97_5).toFixed(4)}`);
  console.log(`  Min ROI: ${Number(perc.min_roi).toFixed(4)}`);
  console.log(`  Max ROI: ${Number(perc.max_roi).toFixed(4)}\n`);

  // Run the full leaderboard query
  console.log('Step 2: Running full leaderboard query...');
  const result = await client.query({
    query: `
      WITH
      percentiles AS (
        SELECT
          quantile(0.025)(roi) as p2_5,
          quantile(0.975)(roi) as p97_5
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at IS NOT NULL
      ),
      wallet_trades AS (
        SELECT
          u.wallet,
          u.condition_id,
          u.roi,
          u.cost_usd,
          u.entry_time,
          u.pnl_usd,
          greatest(p.p2_5, least(p.p97_5, u.roi)) as roi_winsorized,
          toDate(u.entry_time) as trade_date
        FROM pm_trade_fifo_roi_v3_mat_unified u
        CROSS JOIN percentiles p
        WHERE u.resolved_at IS NOT NULL
          AND u.cost_usd > 0
          AND u.cost_usd < 10000000
      ),
      wallet_daily AS (
        SELECT
          wallet,
          trade_date,
          sum(log(1 + roi_winsorized)) as daily_log_growth,
          count() as daily_trades,
          sum(pnl_usd) as daily_pnl
        FROM wallet_trades
        GROUP BY wallet, trade_date
      ),
      wallet_stats AS (
        SELECT
          wallet,
          count() as active_days,
          sum(daily_trades) as total_trades,
          sum(daily_log_growth) as total_log_growth,
          sum(daily_log_growth) / count() as daily_log_growth_avg,
          sum(daily_pnl) as total_pnl,
          max(trade_date) as last_active_date
        FROM wallet_daily
        GROUP BY wallet
      ),
      wallet_filters AS (
        SELECT
          wallet,
          count(DISTINCT condition_id) as unique_markets,
          avg(cost_usd) as avg_bet,
          max(entry_time) as last_buy,
          countIf(pnl_usd > 0) as wins,
          count() as trades
        FROM wallet_trades
        GROUP BY wallet
      )
      SELECT
        ws.wallet,
        ws.active_days,
        ws.total_trades,
        wf.unique_markets,
        round(wf.avg_bet, 2) as avg_bet,
        round(ws.total_pnl, 2) as total_pnl,
        round(wf.wins * 100.0 / wf.trades, 1) as win_rate_pct,
        round(ws.total_log_growth / ws.total_trades, 6) as log_growth_per_trade,
        round(ws.daily_log_growth_avg, 6) as daily_log_growth,
        dateDiff('day', wf.last_buy, now()) as days_since_buy
      FROM wallet_stats ws
      JOIN wallet_filters wf ON ws.wallet = wf.wallet
      WHERE wf.unique_markets >= 10
        AND dateDiff('day', wf.last_buy, now()) <= 5
        AND wf.avg_bet > 10
        AND wf.avg_bet < 1000000
        AND ws.total_log_growth / ws.total_trades > 0
        AND ws.active_days >= 14
        AND ws.daily_log_growth_avg > 0
      ORDER BY ws.daily_log_growth_avg DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 240 },
  });

  const rows = await result.json() as any[];
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('LEADERBOARD V3 RESULTS');
  console.log(`${'='.repeat(60)}`);
  console.log(`Query duration: ${duration}s`);
  console.log(`Wallets found: ${rows.length}\n`);

  console.log('Top 20 Wallets:');
  console.log('-'.repeat(120));
  console.log('Rank | Wallet                                     | Daily Log | Trades | Markets | Avg Bet  | PnL       | Win%  | Days');
  console.log('-'.repeat(120));

  rows.forEach((r, i) => {
    const wallet = r.wallet.substring(0, 10) + '...' + r.wallet.substring(r.wallet.length - 4);
    console.log(
      `${String(i + 1).padStart(4)} | ${wallet.padEnd(42)} | ${Number(r.daily_log_growth).toFixed(4).padStart(9)} | ${String(r.total_trades).padStart(6)} | ${String(r.unique_markets).padStart(7)} | $${Number(r.avg_bet).toFixed(0).padStart(6)} | $${Number(r.total_pnl).toFixed(0).padStart(8)} | ${Number(r.win_rate_pct).toFixed(1).padStart(5)}% | ${r.days_since_buy}`
    );
  });

  console.log('-'.repeat(120));

  // Summary stats
  if (rows.length > 0) {
    const avgDailyLog = rows.reduce((sum, r) => sum + r.daily_log_growth, 0) / rows.length;
    const avgTrades = rows.reduce((sum, r) => sum + r.total_trades, 0) / rows.length;
    const avgPnl = rows.reduce((sum, r) => sum + r.total_pnl, 0) / rows.length;
    const avgWinRate = rows.reduce((sum, r) => sum + r.win_rate_pct, 0) / rows.length;

    console.log(`\nSummary Stats:`);
    console.log(`  Avg Daily Log Growth: ${avgDailyLog.toFixed(4)}`);
    console.log(`  Avg Trades: ${avgTrades.toFixed(0)}`);
    console.log(`  Avg PnL: $${avgPnl.toFixed(0)}`);
    console.log(`  Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  }

  console.log('\n✓ Leaderboard V3 test complete');
}

testLeaderboard().catch(console.error);
