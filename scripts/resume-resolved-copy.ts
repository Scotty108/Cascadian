#!/usr/bin/env npx tsx
/**
 * Resume Resolved Copy
 *
 * Copies remaining resolved rows that weren't copied due to timeout
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function resumeResolvedCopy() {
  console.log('🔄 Resuming Resolved Copy\n');

  // Check current state
  const currentResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NOT NULL) as resolved_in_v2,
        (SELECT countIf(resolved_at IS NOT NULL) FROM pm_trade_fifo_roi_v3_mat_unified) as resolved_in_old
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
    `,
    format: 'JSONEachRow'
  });
  const current = (await currentResult.json<any>())[0];

  console.log(`Old table: ${parseInt(current.resolved_in_old).toLocaleString()} resolved rows`);
  console.log(`New table: ${parseInt(current.resolved_in_v2).toLocaleString()} resolved rows`);
  console.log(`Missing: ${(parseInt(current.resolved_in_old) - parseInt(current.resolved_in_v2)).toLocaleString()} rows\n`);

  console.log('Copying remaining resolved rows...');
  const startTime = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_v2
      SELECT *
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
        AND (tx_hash, wallet, condition_id, outcome_index) NOT IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM pm_trade_fifo_roi_v3_mat_unified_v2
          WHERE resolved_at IS NOT NULL
        )
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour timeout
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Copy complete! (${elapsed} minutes)\n`);

  // Verify
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
    `,
    format: 'JSONEachRow'
  });
  const verify = (await verifyResult.json<any>())[0];

  console.log('📊 NEW TABLE:');
  console.log(`   Total: ${parseInt(verify.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(verify.resolved).toLocaleString()}`);
  console.log(`   Expected: ${parseInt(current.resolved_in_old).toLocaleString()}\n`);

  if (parseInt(verify.resolved) >= parseInt(current.resolved_in_old)) {
    console.log('✅ All resolved data copied!\n');
  } else {
    console.log('⚠️ Still missing some rows\n');
  }
}

resumeResolvedCopy().catch(console.error);
