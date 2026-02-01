#!/usr/bin/env npx tsx
/**
 * Sync missing resolved positions from January 2026
 *
 * The unified table is missing ~7.5M positions that exist in pm_trade_fifo_roi_v3
 * but weren't synced to pm_trade_fifo_roi_v3_mat_unified.
 *
 * This script syncs them day by day to stay under memory limits.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function syncMissingJanuary() {
  console.log('🔄 Syncing missing January 2026 resolved positions...\n');
  const startTime = Date.now();

  // Process day by day for January 2026
  const days = [
    { start: '2026-01-01', end: '2026-01-02' },
    { start: '2026-01-02', end: '2026-01-03' },
    { start: '2026-01-03', end: '2026-01-04' },
    { start: '2026-01-04', end: '2026-01-05' },
    { start: '2026-01-05', end: '2026-01-06' },
    { start: '2026-01-06', end: '2026-01-07' },
    { start: '2026-01-07', end: '2026-01-08' },
    { start: '2026-01-08', end: '2026-01-09' },
    { start: '2026-01-09', end: '2026-01-10' },
    { start: '2026-01-10', end: '2026-01-11' },
    { start: '2026-01-11', end: '2026-01-12' },
    { start: '2026-01-12', end: '2026-01-13' },
    { start: '2026-01-13', end: '2026-01-14' },
    { start: '2026-01-14', end: '2026-01-15' },
    { start: '2026-01-15', end: '2026-01-16' },
    { start: '2026-01-16', end: '2026-01-17' },
    { start: '2026-01-17', end: '2026-01-18' },
    { start: '2026-01-18', end: '2026-01-19' },
    { start: '2026-01-19', end: '2026-01-20' },
    { start: '2026-01-20', end: '2026-01-21' },
    { start: '2026-01-21', end: '2026-01-22' },
    { start: '2026-01-22', end: '2026-01-23' },
    { start: '2026-01-23', end: '2026-01-24' },
    { start: '2026-01-24', end: '2026-01-25' },
    { start: '2026-01-25', end: '2026-01-26' },
    { start: '2026-01-26', end: '2026-01-27' },
    { start: '2026-01-27', end: '2026-01-28' },
    { start: '2026-01-28', end: '2026-01-29' },
    { start: '2026-01-29', end: '2026-01-30' },
    { start: '2026-01-30', end: '2026-01-31' },
    { start: '2026-01-31', end: '2026-02-01' },
  ];

  let totalSynced = 0;

  for (const day of days) {
    // Check how many are missing for this day
    const countResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trade_fifo_roi_v3 s
        LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
          ON s.tx_hash = u.tx_hash
          AND s.wallet = u.wallet
          AND s.condition_id = u.condition_id
          AND s.outcome_index = u.outcome_index
        WHERE s.resolved_at >= '${day.start}'
          AND s.resolved_at < '${day.end}'
          AND u.tx_hash IS NULL
      `,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 120 }
    });

    const missing = ((await countResult.json()) as any)[0]?.cnt || 0;

    if (missing === 0) {
      console.log(`   ${day.start}: 0 missing (skipping)`);
      continue;
    }

    console.log(`   ${day.start}: ${missing.toLocaleString()} missing, syncing...`);

    // Sync missing positions for this day
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          s.tx_hash, s.wallet, s.condition_id, s.outcome_index,
          s.entry_time, s.resolved_at, s.tokens, s.cost_usd,
          s.tokens_sold_early, s.tokens_held, s.exit_value,
          s.pnl_usd, s.roi, s.pct_sold_early,
          s.is_maker, s.is_closed, s.is_short
        FROM pm_trade_fifo_roi_v3 s
        LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
          ON s.tx_hash = u.tx_hash
          AND s.wallet = u.wallet
          AND s.condition_id = u.condition_id
          AND s.outcome_index = u.outcome_index
        WHERE s.resolved_at >= '${day.start}'
          AND s.resolved_at < '${day.end}'
          AND u.tx_hash IS NULL
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    totalSynced += missing;
    console.log(`   ${day.start}: done (total synced: ${totalSynced.toLocaleString()})`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Final stats
  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        max(resolved_at) as newest
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const s = ((await stats.json()) as any)[0];

  console.log(`\n✅ Sync complete! (${elapsed} min)`);
  console.log(`   Total synced: ${totalSynced.toLocaleString()}`);
  console.log(`   Unified table now: ${Number(s.total).toLocaleString()} rows`);
  console.log(`   Resolved: ${Number(s.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${Number(s.unresolved).toLocaleString()}`);
  console.log(`   Newest resolved: ${s.newest}`);
}

syncMissingJanuary().catch(console.error);
