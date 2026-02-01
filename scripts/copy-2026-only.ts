#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function copy2026() {
  console.log('Copying 2026 data...');
  const start = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130
      SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE toYear(entry_time) = 2026
    `,
    clickhouse_settings: {
      max_execution_time: 600,
      send_timeout: 3600,
      receive_timeout: 3600
    }
  });

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log(`✅ 2026 complete in ${elapsed} minutes`);

  const result = await clickhouse.query({
    query: `SELECT formatReadableQuantity(count()) as total FROM pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130`,
    format: 'JSONEachRow'
  });
  const r = (await result.json<any>())[0];
  console.log(`\n✅ FULL BACKUP COMPLETE: ${r.total} rows\n`);
}

copy2026().catch(console.error);
