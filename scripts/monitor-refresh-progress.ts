#!/usr/bin/env npx tsx
/**
 * Monitor Refresh Progress
 *
 * Checks how fresh the unresolved data is by querying the table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function monitorProgress() {
  const result = await clickhouse.query({
    query: `
      SELECT
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved_entry,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as minutes_stale_unresolved,
        countIf(resolved_at IS NULL) as unresolved_count
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });

  const stats = (await result.json())[0];

  console.log(`⏰ Current Time: ${new Date().toISOString()}`);
  console.log(`📊 Unresolved Positions: ${stats.unresolved_count.toLocaleString()}`);
  console.log(`🕐 Newest Unresolved Entry: ${stats.newest_unresolved_entry}`);
  console.log(`⏳ Minutes Stale: ${stats.minutes_stale_unresolved} minutes (${(stats.minutes_stale_unresolved / 60).toFixed(1)} hours)`);
  console.log('');

  if (stats.minutes_stale_unresolved < 60) {
    console.log('✅ Data is FRESH (<1 hour old)!');
  } else if (stats.minutes_stale_unresolved < 180) {
    console.log('⚠️  Data is moderately stale (<3 hours)');
  } else {
    console.log('❌ Data is stale (>3 hours)');
  }
}

monitorProgress().catch(console.error);
