/**
 * Update CLV columns in wio_metric_observations_v1
 *
 * Joins with pm_wallet_clv_agg to populate CLV fields.
 * Uses ReplacingMergeTree pattern: insert new rows with updated CLV values.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('=== Updating CLV in WIO Metrics ===\n');

  // Map WIO window_id to CLV window names
  const windowMap = [
    { wioWindowId: "'ALL'", clvWindow: 'ALL' },
    { wioWindowId: "'90d'", clvWindow: '90d' },
    { wioWindowId: "'30d'", clvWindow: '30d' },
  ];

  for (const { wioWindowId, clvWindow } of windowMap) {
    console.log(`Processing window: ${clvWindow}...`);
    const startTime = Date.now();

    // Insert updated rows with CLV data
    // ReplacingMergeTree will deduplicate keeping the newest row
    await ch.command({
      query: `
        INSERT INTO wio_metric_observations_v1
        SELECT
          m.wallet_id,
          m.scope_type,
          m.scope_id,
          m.window_id,

          -- Keep all existing fields
          m.positions_n,
          m.resolved_positions_n,
          m.fills_n,
          m.active_days_n,
          m.wallet_age_days,
          m.days_since_last_trade,
          m.roi_cost_weighted,
          m.pnl_total_usd,
          m.roi_p50,
          m.roi_p05,
          m.roi_p95,
          m.win_rate,
          m.avg_win_roi,
          m.avg_loss_roi,
          m.profit_factor,
          m.max_drawdown_usd,
          m.cvar_95_roi,
          m.max_loss_roi,
          m.loss_streak_max,
          m.hold_minutes_p50,
          m.pct_held_to_resolve,
          m.time_to_resolve_hours_p50,

          -- UPDATED CLV fields from aggregation
          0 as clv_4h_cost_weighted,  -- Not computed yet
          coalesce(c.clv_24h_weighted, 0) as clv_24h_cost_weighted,
          0 as clv_72h_cost_weighted,  -- Not computed yet
          coalesce(c.clv_24h_hit_rate, 0) as clv_24h_win_rate,

          -- Keep remaining fields
          m.brier_mean,
          m.brier_vs_crowd,
          m.sharpness,
          m.calibration_gap,
          m.unique_bundles_n,
          m.bundle_hhi_cost,
          m.top_bundle_share_cost,
          m.market_hhi_cost,
          m.top_market_share_cost,
          m.position_cost_p50,
          m.position_cost_p90,
          m.conviction_top_decile_cost_share,
          m.roi_cost_weighted_top_decile,
          m.fills_per_day,
          m.both_sides_same_market_rate,
          m.maker_ratio,
          m.same_block_trade_rate,

          now() as computed_at

        FROM wio_metric_observations_v1 m
        LEFT JOIN pm_wallet_clv_agg c
          ON m.wallet_id = c.wallet_id
          AND c.window_id = '${clvWindow}'
        WHERE m.window_id = ${wioWindowId}
          AND m.scope_type = 'GLOBAL'
          AND c.wallet_id IS NOT NULL  -- Only update wallets that have CLV data
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        max_execution_time: 600,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done (${elapsed}s)\n`);
  }

  // Verify results
  console.log('Verifying CLV population...\n');
  const stats = await ch.query({
    query: `
      SELECT
        window_id,
        count() as total_wallets,
        countIf(clv_24h_cost_weighted != 0) as wallets_with_clv,
        round(avg(clv_24h_cost_weighted), 6) as avg_clv,
        round(quantile(0.9)(clv_24h_cost_weighted), 6) as clv_p90,
        round(quantile(0.99)(clv_24h_cost_weighted), 6) as clv_p99
      FROM wio_metric_observations_v1
      WHERE scope_type = 'GLOBAL'
      GROUP BY window_id
      ORDER BY window_id
    `,
    format: 'JSONEachRow',
  });

  const rows = await stats.json() as any[];
  console.log('Window    | Total      | With CLV   | Avg CLV  | P90 CLV  | P99 CLV');
  console.log('----------|------------|------------|----------|----------|----------');
  for (const row of rows) {
    const pct = ((row.wallets_with_clv / row.total_wallets) * 100).toFixed(1);
    console.log(`${row.window_id.toString().padEnd(9)} | ${row.total_wallets.toString().padStart(10)} | ${row.wallets_with_clv.toString().padStart(10)} | ${(row.avg_clv * 100).toFixed(3).padStart(7)}% | ${(row.clv_p90 * 100).toFixed(3).padStart(7)}% | ${(row.clv_p99 * 100).toFixed(3).padStart(7)}%`);
  }

  // Force merge to deduplicate
  console.log('\nOptimizing table (deduplication)...');
  await ch.command({
    query: `OPTIMIZE TABLE wio_metric_observations_v1 FINAL`,
    clickhouse_settings: { wait_end_of_query: 1 },
  });

  console.log('\n=== CLV update complete! ===');
  await ch.close();
}

main().catch(console.error);
