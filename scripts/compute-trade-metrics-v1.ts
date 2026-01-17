#!/usr/bin/env npx tsx
/**
 * Compute Trade-Based Wallet Metrics (v1)
 *
 * Uses pm_trade_fifo_roi_v3 (with shorts) to compute wallet metrics at the TRADE level.
 * This is more accurate than position-level metrics for assessing trading skill.
 *
 * Key differences from position-based (wio_metric_observations_v1):
 * - Win rate measures individual trade decisions, not net position outcomes
 * - Hold time is per trade, not per position
 * - Properly accounts for shorts (is_short=1)
 *
 * Output: pm_wallet_trade_metrics_v2 (or inserts into existing table)
 *
 * Usage: npx tsx scripts/compute-trade-metrics-v1.ts [--window=30d]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WINDOW = process.argv.find(a => a.startsWith('--window='))?.split('=')[1] || 'ALL';
const DRY_RUN = process.argv.includes('--dry-run');

interface WindowConfig {
  id: string;
  filter: string;
}

const WINDOWS: Record<string, WindowConfig> = {
  'ALL': { id: 'ALL', filter: '1=1' },
  '90d': { id: '90d', filter: 'entry_time >= now() - INTERVAL 90 DAY' },
  '30d': { id: '30d', filter: 'entry_time >= now() - INTERVAL 30 DAY' },
  '14d': { id: '14d', filter: 'entry_time >= now() - INTERVAL 14 DAY' },
  '7d': { id: '7d', filter: 'entry_time >= now() - INTERVAL 7 DAY' },
};

async function ensureTable(): Promise<void> {
  console.log('📋 Ensuring pm_wallet_trade_metrics_v2 table exists...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_trade_metrics_v2 (
        wallet String,
        window_id String,

        -- Sample sizes
        trades_total Int32,
        trades_long Int32,
        trades_short Int32,

        -- Win/Loss Economics (TRADE-LEVEL)
        win_rate Float64,          -- % of trades with pnl > 0
        win_rate_long Float64,     -- % of long trades profitable
        win_rate_short Float64,    -- % of short trades profitable

        -- Returns
        pnl_total_usd Float64,
        pnl_long_usd Float64,
        pnl_short_usd Float64,
        roi_cost_weighted Float64,  -- sum(pnl) / sum(cost)

        -- Averages
        avg_win_pnl Float64,
        avg_loss_pnl Float64,
        avg_win_roi Float64,
        avg_loss_roi Float64,

        -- Risk
        profit_factor Float64,      -- sum(wins) / abs(sum(losses))
        max_single_loss Float64,

        -- Sizing
        avg_trade_size Float64,
        median_trade_size Float64,

        -- Activity
        active_days Int32,
        first_trade DateTime,
        last_trade DateTime,

        computed_at DateTime DEFAULT now()
      ) ENGINE = SharedReplacingMergeTree(computed_at)
      ORDER BY (wallet, window_id)
      SETTINGS index_granularity = 8192
    `,
  });

  console.log('✅ Table ready');
}

async function computeMetrics(windowConfig: WindowConfig): Promise<number> {
  const { id: windowId, filter } = windowConfig;
  console.log(`\n🔄 Computing trade metrics for window: ${windowId}`);

  const query = `
    INSERT INTO pm_wallet_trade_metrics_v2
    SELECT
      wallet,
      '${windowId}' as window_id,

      -- Sample sizes
      toInt32(count()) as trades_total,
      toInt32(countIf(is_short = 0)) as trades_long,
      toInt32(countIf(is_short = 1)) as trades_short,

      -- Win rates (TRADE-LEVEL)
      countIf(pnl_usd > 0) / count() as win_rate,
      countIf(pnl_usd > 0 AND is_short = 0) / nullIf(countIf(is_short = 0), 0) as win_rate_long,
      countIf(pnl_usd > 0 AND is_short = 1) / nullIf(countIf(is_short = 1), 0) as win_rate_short,

      -- Returns
      sum(pnl_usd) as pnl_total_usd,
      sumIf(pnl_usd, is_short = 0) as pnl_long_usd,
      sumIf(pnl_usd, is_short = 1) as pnl_short_usd,
      sum(pnl_usd) / nullIf(sum(cost_usd), 0) as roi_cost_weighted,

      -- Averages
      avgIf(pnl_usd, pnl_usd > 0) as avg_win_pnl,
      avgIf(pnl_usd, pnl_usd < 0) as avg_loss_pnl,
      avgIf(roi, pnl_usd > 0) as avg_win_roi,
      avgIf(roi, pnl_usd < 0) as avg_loss_roi,

      -- Risk
      sumIf(pnl_usd, pnl_usd > 0) / nullIf(abs(sumIf(pnl_usd, pnl_usd < 0)), 0) as profit_factor,
      minIf(pnl_usd, pnl_usd < 0) as max_single_loss,

      -- Sizing
      avg(cost_usd) as avg_trade_size,
      quantile(0.5)(cost_usd) as median_trade_size,

      -- Activity
      toInt32(uniqExact(toDate(entry_time))) as active_days,
      min(entry_time) as first_trade,
      max(entry_time) as last_trade,

      now() as computed_at

    FROM pm_trade_fifo_roi_v3
    WHERE ${filter}
      AND resolved_at > '1970-01-01'  -- Only resolved trades
    GROUP BY wallet
    HAVING count() >= 5  -- Minimum 5 trades
  `;

  if (DRY_RUN) {
    console.log('DRY RUN - would execute:');
    console.log(query);
    return 0;
  }

  const startTime = Date.now();
  await clickhouse.command({ query });
  const elapsed = (Date.now() - startTime) / 1000;

  // Count results
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_trade_metrics_v2 WHERE window_id = '${windowId}'`,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json() as { cnt: string }[];
  const count = parseInt(countRows[0]?.cnt || '0');

  console.log(`✅ Computed ${count.toLocaleString()} wallets in ${elapsed.toFixed(1)}s`);
  return count;
}

async function showSampleStats(): Promise<void> {
  console.log('\n📊 Sample stats from trade-level metrics:');

  const result = await clickhouse.query({
    query: `
      SELECT
        window_id,
        count() as wallets,
        round(avg(win_rate) * 100, 1) as avg_win_rate_pct,
        round(avg(win_rate_long) * 100, 1) as avg_win_rate_long_pct,
        round(avg(win_rate_short) * 100, 1) as avg_win_rate_short_pct,
        round(avg(roi_cost_weighted) * 100, 1) as avg_roi_pct,
        round(avg(trades_short) / nullIf(avg(trades_total), 0) * 100, 1) as avg_short_pct
      FROM pm_wallet_trade_metrics_v2
      GROUP BY window_id
      ORDER BY window_id
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  console.table(rows);
}

async function compareWithPositionMetrics(): Promise<void> {
  console.log('\n🔍 Comparing trade-level vs position-level metrics:');

  const result = await clickhouse.query({
    query: `
      SELECT
        'Trade-level' as source,
        count() as wallets,
        round(avg(win_rate) * 100, 1) as avg_win_rate,
        round(avg(roi_cost_weighted) * 100, 1) as avg_roi
      FROM pm_wallet_trade_metrics_v2
      WHERE window_id = '90d'

      UNION ALL

      SELECT
        'Position-level' as source,
        count() as wallets,
        round(avg(win_rate) * 100, 1) as avg_win_rate,
        round(avg(roi_cost_weighted) * 100, 1) as avg_roi
      FROM wio_metric_observations_v1
      WHERE window_id = 2  -- 90d
        AND scope_type = 'GLOBAL'
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  console.table(rows);
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('TRADE-BASED WALLET METRICS COMPUTATION');
  console.log('='.repeat(60));
  console.log(`Window: ${WINDOW}`);
  console.log(`Dry run: ${DRY_RUN}`);

  // Check if FIFO table has data
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt, countIf(is_short = 1) as shorts FROM pm_trade_fifo_roi_v3`,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json() as { cnt: string; shorts: string }[];
  const totalTrades = parseInt(countRows[0]?.cnt || '0');
  const shortTrades = parseInt(countRows[0]?.shorts || '0');

  console.log(`\n📈 Source data: ${totalTrades.toLocaleString()} trades (${shortTrades.toLocaleString()} shorts)`);

  if (totalTrades === 0) {
    console.error('❌ No trades in pm_trade_fifo_roi_v3. Run FIFO build first.');
    process.exit(1);
  }

  await ensureTable();

  if (WINDOW === 'ALL_WINDOWS') {
    // Compute all windows
    for (const [name, config] of Object.entries(WINDOWS)) {
      await computeMetrics(config);
    }
  } else {
    const windowConfig = WINDOWS[WINDOW];
    if (!windowConfig) {
      console.error(`❌ Unknown window: ${WINDOW}. Use: ${Object.keys(WINDOWS).join(', ')}`);
      process.exit(1);
    }
    await computeMetrics(windowConfig);
  }

  await showSampleStats();

  // Compare with position-level if both exist
  try {
    await compareWithPositionMetrics();
  } catch (e) {
    console.log('(Position metrics comparison skipped - table may not exist)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TRADE METRICS COMPUTATION COMPLETE');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
