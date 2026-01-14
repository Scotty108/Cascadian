/**
 * WIO Metrics V1 Computation Script (Simplified)
 *
 * Computes wallet metrics from wio_positions_v2 data.
 * Uses a simplified approach - computes one window at a time per prefix batch.
 *
 * Metrics Implemented:
 * - Category A: Activity & Evidence (positions_n, resolved_n, active_days, wallet_age)
 * - Category B: Return & Profitability (pnl_total, roi_weighted, roi percentiles)
 * - Category C: Win/Loss Economics (win_rate, avg_win_roi, avg_loss_roi, profit_factor)
 * - Category D: Risk (cvar_95, max_loss_roi) - simplified, no drawdown path
 * - Category E: Time Horizon (hold_minutes_p50, pct_held_to_resolve, time_to_resolve_p50)
 * - Category G: Forecasting (brier_mean, sharpness) - partial
 * - Category I: Sizing (position_cost_p50, position_cost_p90)
 * - Category J: Bot (fills_per_day)
 *
 * Usage: npx tsx scripts/compute-wio-metrics-v1.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET_PREFIXES = [
  '0x0', '0x1', '0x2', '0x3',
  '0x4', '0x5', '0x6', '0x7',
  '0x8', '0x9', '0xa', '0xb',
  '0xc', '0xd', '0xe', '0xf'
];

interface WindowConfig {
  id: number;
  name: string;
  filter: string;  // SQL condition
}

const WINDOWS: WindowConfig[] = [
  { id: 1, name: 'ALL', filter: '1=1' },
  { id: 2, name: '90d', filter: 'end_ts >= now() - INTERVAL 90 DAY' },
  { id: 3, name: '30d', filter: 'end_ts >= now() - INTERVAL 30 DAY' },
  { id: 4, name: '14d', filter: 'end_ts >= now() - INTERVAL 14 DAY' },
  { id: 5, name: '7d', filter: 'end_ts >= now() - INTERVAL 7 DAY' },
  { id: 6, name: '1d', filter: 'end_ts >= now() - INTERVAL 1 DAY' },
];

async function computeMetricsForPrefixAndWindow(
  prefix: string,
  window: WindowConfig
): Promise<number> {
  const startTime = Date.now();

  // Use window filter condition
  const windowFilter = window.filter;
  const windowId = window.id;

  // Build query for this prefix and window
  const query = `
    INSERT INTO wio_metric_observations_v1
    SELECT
      wallet_id,
      'GLOBAL' as scope_type,
      '' as scope_id,
      ${windowId} as window_id,

      -- Sample sizes
      toInt32(positions_n) as positions_n,
      toInt32(resolved_positions_n) as resolved_positions_n,
      toInt32(fills_n) as fills_n,

      -- A. Activity & Evidence
      toInt32(active_days_n) as active_days_n,
      ${windowId === 1 ? 'toNullable(toInt32(wallet_age_days))' : 'CAST(NULL AS Nullable(Int32))'} as wallet_age_days,
      ${windowId === 1 ? 'toNullable(toInt32(days_since_last_trade))' : 'CAST(NULL AS Nullable(Int32))'} as days_since_last_trade,

      -- B. Return & Profitability
      roi_cost_weighted,
      pnl_total_usd,
      roi_p50,
      roi_p05,
      roi_p95,

      -- C. Win/Loss Economics
      win_rate,
      ifNull(avg_win_roi, 0) as avg_win_roi,
      ifNull(avg_loss_roi, 0) as avg_loss_roi,
      profit_factor,

      -- D. Risk (simplified)
      0 as max_drawdown_usd,
      ifNull(cvar_95_roi, 0) as cvar_95_roi,
      ifNull(max_loss_roi, 0) as max_loss_roi,
      0 as loss_streak_max,

      -- E. Time Horizon
      ifNull(hold_minutes_p50, 0) as hold_minutes_p50,
      pct_held_to_resolve,
      ifNull(time_to_resolve_hours_p50, 0) as time_to_resolve_hours_p50,

      -- F. CLV (placeholder - requires anchor prices)
      0 as clv_4h_cost_weighted,
      0 as clv_24h_cost_weighted,
      0 as clv_72h_cost_weighted,
      0 as clv_24h_win_rate,

      -- G. Forecasting
      ifNull(brier_mean, 0) as brier_mean,
      0 as brier_vs_crowd,
      ifNull(sharpness, 0) as sharpness,
      0 as calibration_gap,

      -- H. Focus & Concentration (placeholder - compute separately)
      ${windowId === 1 ? 'toNullable(toInt32(unique_bundles_n))' : 'CAST(NULL AS Nullable(Int32))'} as unique_bundles_n,
      NULL as bundle_hhi_cost,
      NULL as top_bundle_share_cost,
      0 as market_hhi_cost,
      0 as top_market_share_cost,

      -- I. Sizing & Conviction
      ifNull(position_cost_p50, 0) as position_cost_p50,
      ifNull(position_cost_p90, 0) as position_cost_p90,
      0 as conviction_top_decile_cost_share,
      0 as roi_cost_weighted_top_decile,

      -- J. Bot Diagnostics
      fills_per_day,
      0 as both_sides_same_market_rate,
      NULL as maker_ratio,
      NULL as same_block_trade_rate,

      now() as computed_at

    FROM (
      SELECT
        wallet_id,

        -- Sample sizes
        countIf(${windowFilter}) as positions_n,
        countIf(is_resolved = 1 AND ${windowFilter}) as resolved_positions_n,
        sumIf(fills_count, ${windowFilter}) as fills_n,

        -- A. Activity
        uniqExactIf(toDate(ts_open), ${windowFilter}) as active_days_n,
        dateDiff('day', min(ts_open), now()) as wallet_age_days,
        dateDiff('day', max(ts_open), now()) as days_since_last_trade,

        -- B. Returns (cap ROI at -1 to +10 to handle edge cases)
        if(sumIf(cost_usd, ${windowFilter}) > 0,
           sumIf(pnl_usd, ${windowFilter}) / sumIf(cost_usd, ${windowFilter}), 0) as roi_cost_weighted,
        sumIf(pnl_usd, ${windowFilter}) as pnl_total_usd,
        quantileIf(0.5)(greatest(-1, least(10, roi)), ${windowFilter}) as roi_p50,
        quantileIf(0.05)(greatest(-1, least(10, roi)), ${windowFilter}) as roi_p05,
        quantileIf(0.95)(greatest(-1, least(10, roi)), ${windowFilter}) as roi_p95,

        -- C. Win/Loss (cap ROI at -1 to +10)
        if(countIf(is_resolved = 1 AND ${windowFilter}) > 0,
           countIf(pnl_usd > 0 AND is_resolved = 1 AND ${windowFilter}) /
           countIf(is_resolved = 1 AND ${windowFilter}), 0) as win_rate,
        avgIf(greatest(-1, least(10, roi)), pnl_usd > 0 AND is_resolved = 1 AND ${windowFilter}) as avg_win_roi,
        avgIf(greatest(-1, least(10, roi)), pnl_usd < 0 AND is_resolved = 1 AND ${windowFilter}) as avg_loss_roi,
        if(abs(sumIf(pnl_usd, pnl_usd < 0 AND ${windowFilter})) > 0,
           sumIf(pnl_usd, pnl_usd > 0 AND ${windowFilter}) /
           abs(sumIf(pnl_usd, pnl_usd < 0 AND ${windowFilter})),
           if(sumIf(pnl_usd, pnl_usd > 0 AND ${windowFilter}) > 0, 999, 0)) as profit_factor,

        -- D. Risk (cap ROI at -1 to avoid impossible values from edge cases)
        avgIf(greatest(-1, roi), roi < 0 AND ${windowFilter}) as cvar_95_roi,
        greatest(-1, minIf(roi, ${windowFilter})) as max_loss_roi,

        -- E. Time
        quantileIf(0.5)(hold_minutes, ${windowFilter}) as hold_minutes_p50,
        if(countIf(is_resolved = 1 AND ${windowFilter}) > 0,
           countIf(ts_close IS NULL AND is_resolved = 1 AND ${windowFilter}) /
           countIf(is_resolved = 1 AND ${windowFilter}), 0) as pct_held_to_resolve,
        quantileIf(0.5)(
          dateDiff('hour', ts_open, ts_resolve),
          is_resolved = 1 AND ${windowFilter}
        ) as time_to_resolve_hours_p50,

        -- G. Forecasting
        avgIf(brier_score, is_resolved = 1 AND brier_score IS NOT NULL AND ${windowFilter}) as brier_mean,
        avgIf(abs(p_entry_side - 0.5), cost_usd > 0 AND ${windowFilter}) as sharpness,

        -- H. Concentration (ALL window only)
        uniqExactIf(primary_bundle_id, ${windowFilter}) as unique_bundles_n,

        -- I. Sizing
        quantileIf(0.5)(cost_usd, ${windowFilter}) as position_cost_p50,
        quantileIf(0.9)(cost_usd, ${windowFilter}) as position_cost_p90,

        -- J. Bot
        if(uniqExactIf(toDate(ts_open), ${windowFilter}) > 0,
           sumIf(fills_count, ${windowFilter}) / uniqExactIf(toDate(ts_open), ${windowFilter}), 0) as fills_per_day

      FROM wio_positions_v2
      WHERE wallet_id LIKE '${prefix}%'
      GROUP BY wallet_id
      HAVING positions_n > 0
    )
    SETTINGS max_execution_time = 600
  `;

  await clickhouse.command({ query });

  return Date.now() - startTime;
}

async function getMetricsCount(): Promise<{ total: number; byWindow: Map<number, number> }> {
  const result = await clickhouse.query({
    query: `
      SELECT
        window_id,
        count() as cnt
      FROM wio_metric_observations_v1
      GROUP BY window_id
      ORDER BY window_id
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as { window_id: number; cnt: string }[];

  const byWindow = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    byWindow.set(row.window_id, parseInt(row.cnt));
    total += parseInt(row.cnt);
  }
  return { total, byWindow };
}

async function truncateMetrics(): Promise<void> {
  await clickhouse.command({
    query: 'TRUNCATE TABLE wio_metric_observations_v1'
  });
}

async function main() {
  console.log('============================================================');
  console.log('WIO Metrics V1 Computation');
  console.log('Computing GLOBAL scope metrics for all windows');
  console.log('============================================================\n');

  // Check for resume mode
  const resumeArg = process.argv.includes('--resume');

  // Get initial count
  const initialStats = await getMetricsCount();
  console.log(`Step 1: Initial metrics count: ${initialStats.total.toLocaleString()}`);

  if (initialStats.total > 0 && !resumeArg) {
    console.log('  Table has existing data. Truncating...');
    await truncateMetrics();
    console.log('  Done.\n');
  } else if (initialStats.total > 0) {
    console.log('  Resuming with existing data.\n');
  }

  // Process each window × prefix combination
  console.log('Step 2: Processing wallets by prefix × window...');
  const overallStart = Date.now();

  for (let w = 0; w < WINDOWS.length; w++) {
    const window = WINDOWS[w];
    console.log(`\n  Window ${w + 1}/${WINDOWS.length}: ${window.name}`);

    const windowStart = Date.now();

    for (let p = 0; p < WALLET_PREFIXES.length; p++) {
      const prefix = WALLET_PREFIXES[p];
      process.stdout.write(`    [${p + 1}/${WALLET_PREFIXES.length}] ${prefix}*... `);

      const elapsed = await computeMetricsForPrefixAndWindow(prefix, window);
      console.log(`${(elapsed / 1000).toFixed(1)}s`);
    }

    const windowElapsed = (Date.now() - windowStart) / 1000 / 60;
    console.log(`  Window ${window.name} complete in ${windowElapsed.toFixed(1)}m`);
  }

  const totalTime = (Date.now() - overallStart) / 1000 / 60;
  console.log(`\nAll windows complete in ${totalTime.toFixed(1)}m\n`);

  // Final stats
  console.log('Step 3: Final statistics...');
  const finalStats = await getMetricsCount();
  console.log(`  Total rows: ${finalStats.total.toLocaleString()}`);
  for (const [windowId, count] of finalStats.byWindow) {
    const windowName = WINDOWS.find(w => w.id === windowId)?.name || `Window ${windowId}`;
    console.log(`    ${windowName}: ${count.toLocaleString()} wallets`);
  }

  // Sample validation
  console.log('\nStep 4: Sample validation...');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        wallet_id,
        positions_n,
        resolved_positions_n,
        round(pnl_total_usd, 2) as pnl,
        round(win_rate * 100, 1) as win_pct,
        round(roi_cost_weighted * 100, 1) as roi_pct,
        active_days_n,
        wallet_age_days
      FROM wio_metric_observations_v1
      WHERE scope_type = 'GLOBAL'
        AND window_id = 1
        AND positions_n >= 100
      ORDER BY pnl_total_usd DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json() as any[];

  console.log('\nTop 5 wallets by PnL (GLOBAL/ALL):');
  console.log('Wallet          | Pos | Resolved | PnL          | Win% | ROI%  | Days');
  console.log('----------------|-----|----------|--------------|------|-------|-----');
  for (const s of samples) {
    const wallet = s.wallet_id.slice(0, 14);
    const pnl = `$${Math.round(s.pnl).toLocaleString()}`.padEnd(12);
    console.log(`${wallet} | ${String(s.positions_n).padStart(3)} | ${String(s.resolved_positions_n).padStart(8)} | ${pnl} | ${String(s.win_pct).padStart(4)}% | ${String(s.roi_pct).padStart(5)}% | ${s.active_days_n}`);
  }

  // Worst performers
  const worstResult = await clickhouse.query({
    query: `
      SELECT
        wallet_id,
        positions_n,
        resolved_positions_n,
        round(pnl_total_usd, 2) as pnl,
        round(win_rate * 100, 1) as win_pct,
        round(roi_cost_weighted * 100, 1) as roi_pct
      FROM wio_metric_observations_v1
      WHERE scope_type = 'GLOBAL'
        AND window_id = 1
        AND positions_n >= 100
      ORDER BY pnl_total_usd ASC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const worst = await worstResult.json() as any[];

  console.log('\nBottom 5 wallets by PnL (GLOBAL/ALL):');
  console.log('Wallet          | Pos | Resolved | PnL           | Win% | ROI%');
  console.log('----------------|-----|----------|---------------|------|------');
  for (const s of worst) {
    const wallet = s.wallet_id.slice(0, 14);
    const pnl = `$${Math.round(s.pnl).toLocaleString()}`.padEnd(13);
    console.log(`${wallet} | ${String(s.positions_n).padStart(3)} | ${String(s.resolved_positions_n).padStart(8)} | ${pnl} | ${String(s.win_pct).padStart(4)}% | ${String(s.roi_pct).padStart(5)}%`);
  }

  console.log('\n============================================================');
  console.log('METRICS COMPUTATION COMPLETE');
  console.log('============================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
