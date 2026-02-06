/**
 * Backfill missing data from pm_trade_fifo_roi_v3 to pm_trade_fifo_roi_v3_mat_unified.
 *
 * Both tables are SharedReplacingMergeTree with ORDER BY (wallet, condition_id, outcome_index, tx_hash).
 * Strategy: Partition v3 data by hex prefix of condition_id (256 buckets) and INSERT each bucket.
 * ReplacingMergeTree automatically deduplicates on merge, so duplicate inserts are safe.
 *
 * Skips FINAL to avoid slow per-row dedup scans. Reads raw v3 partitions directly.
 * Uses explicit column list since v3 and unified have different column orders.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const QUERY_SETTINGS = {
  max_execution_time: 300,
  max_memory_usage: 8_000_000_000,
} as Record<string, any>;

const UNIFIED_COLS = [
  'tx_hash', 'order_id', 'wallet', 'condition_id', 'outcome_index',
  'entry_time', 'resolved_at', 'tokens', 'cost_usd', 'tokens_sold_early',
  'tokens_held', 'exit_value', 'pnl_usd', 'roi', 'pct_sold_early',
  'is_maker', 'is_closed', 'is_short',
].join(', ');

const V3_SELECT = [
  'tx_hash', 'order_id', 'wallet', 'condition_id', 'outcome_index',
  'entry_time', 'resolved_at', 'tokens', 'cost_usd', 'tokens_sold_early',
  'tokens_held', 'exit_value', 'pnl_usd', 'roi', 'pct_sold_early',
  'is_maker',
  'CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END AS is_closed',
  'is_short',
].join(', ');

async function getCount(table: string, useFinal: boolean = false): Promise<number> {
  const finalClause = useFinal ? ' FINAL' : '';
  const res = await clickhouse.query({
    query: `SELECT count() AS cnt FROM ${table}${finalClause}`,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const rows = await res.json() as { cnt: string }[];
  return Number(rows[0].cnt);
}

// Generate all 2-char hex prefixes: 00, 01, ..., ff
function hexPrefixes(): string[] {
  const prefixes: string[] = [];
  for (let i = 0; i < 256; i++) {
    prefixes.push(i.toString(16).padStart(2, '0'));
  }
  return prefixes;
}

async function backfillPrefix(prefix: string): Promise<void> {
  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified (${UNIFIED_COLS})
      SELECT ${V3_SELECT}
      FROM pm_trade_fifo_roi_v3
      WHERE substring(condition_id, 1, 2) = '${prefix}'
    `,
    clickhouse_settings: QUERY_SETTINGS,
  });
}

async function main() {
  console.log('=== Backfill unified table gap (v3 - hex prefix partitioned) ===\n');

  const beforeV3 = await getCount('pm_trade_fifo_roi_v3', true);
  const beforeUnified = await getCount('pm_trade_fifo_roi_v3_mat_unified', true);
  const beforeGap = beforeV3 - beforeUnified;
  console.log(`BEFORE: v3 FINAL = ${beforeV3.toLocaleString()}, unified FINAL = ${beforeUnified.toLocaleString()}, gap = ${beforeGap.toLocaleString()}\n`);

  const prefixes = hexPrefixes();
  const total = prefixes.length;
  const startTime = Date.now();
  let completed = 0;
  let errors = 0;

  for (const prefix of prefixes) {
    completed++;
    try {
      await backfillPrefix(prefix);
    } catch (err: any) {
      errors++;
      console.error(`  ERROR on prefix '${prefix}': ${err.message?.slice(0, 120)}`);
      // Continue to next prefix; don't abort the whole run
    }

    if (completed % 16 === 0 || completed === total) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (completed / ((Date.now() - startTime) / 1000)).toFixed(1);
      const eta = ((total - completed) / parseFloat(rate)).toFixed(0);
      console.log(`  Progress: ${completed}/${total} prefixes (${((completed/total)*100).toFixed(0)}%) - ${elapsed}s elapsed, ~${eta}s remaining${errors ? `, ${errors} errors` : ''}`);
    }
  }

  console.log('\nAll prefixes complete. Waiting 10s for async inserts to flush...');
  await new Promise(r => setTimeout(r, 10000));

  const afterV3 = await getCount('pm_trade_fifo_roi_v3', true);
  const afterUnifiedRaw = await getCount('pm_trade_fifo_roi_v3_mat_unified');
  const afterUnifiedFinal = await getCount('pm_trade_fifo_roi_v3_mat_unified', true);

  console.log('\n=== RESULTS ===');
  console.log(`BEFORE: v3 FINAL = ${beforeV3.toLocaleString()}, unified FINAL = ${beforeUnified.toLocaleString()}, gap = ${beforeGap.toLocaleString()}`);
  console.log(`AFTER:  v3 FINAL = ${afterV3.toLocaleString()}, unified raw = ${afterUnifiedRaw.toLocaleString()}, unified FINAL = ${afterUnifiedFinal.toLocaleString()}`);
  console.log(`GAP (FINAL): ${(afterV3 - afterUnifiedFinal).toLocaleString()}`);
  console.log(`Errors: ${errors}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
