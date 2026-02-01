#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function finish2026() {
  console.log('🔄 Completing 2026 backup (monthly chunks)\n');

  // Copy remaining 2026 data month by month to avoid timeout
  const months = [
    { start: '2026-01-01', end: '2026-02-01', label: 'Jan 2026' }
  ];

  for (const month of months) {
    console.log(`   Copying ${month.label}...`);

    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE entry_time >= '${month.start}' AND entry_time < '${month.end}'
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        send_timeout: 3600,
        receive_timeout: 3600
      }
    });

    console.log(`   ✅ ${month.label} complete`);
  }

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total,
        formatReadableQuantity(countIf(toYear(entry_time) = 2026)) as y2026
      FROM pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130
    `,
    format: 'JSONEachRow'
  });
  const r = (await result.json<any>())[0];

  console.log(`\n✅ BACKUP COMPLETE:`);
  console.log(`   Total: ${r.total}`);
  console.log(`   2026: ${r.y2026}\n`);
}

finish2026().catch(console.error);
