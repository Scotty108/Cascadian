/**
 * Backfill is_closed in pm_trade_fifo_roi_v3
 *
 * Fixes 141.6M rows where resolved_at IS NOT NULL but is_closed = 0
 *
 * This is an async mutation in ClickHouse - we'll monitor progress.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  console.log('Checking current state...');

  // Check current state
  const checkResult = await client.query({
    query: `
      SELECT
        countIf(resolved_at IS NOT NULL) as total_resolved,
        countIf(resolved_at IS NOT NULL AND is_closed = 0) as bug_rows,
        countIf(resolved_at IS NOT NULL AND is_closed = 1) as correct_rows
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const checkData = (await checkResult.json()) as any[];
  console.log('Current state:', checkData[0]);

  if (checkData[0].bug_rows === 0) {
    console.log('✅ No bug rows to fix - already done!');
    return;
  }

  console.log(`\n🔄 Starting ALTER UPDATE to fix ${checkData[0].bug_rows.toLocaleString()} rows...`);
  console.log('This is an async mutation - may take a while.');

  // Run the mutation
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3
      UPDATE is_closed = 1
      WHERE resolved_at IS NOT NULL AND is_closed = 0
    `,
    clickhouse_settings: {
      mutations_sync: 0, // Async mutation
    },
  });

  console.log('✅ Mutation submitted. Checking progress...');

  // Monitor progress
  let done = false;
  let iterations = 0;
  const maxIterations = 60; // 5 minutes max wait

  while (!done && iterations < maxIterations) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    iterations++;

    const progressResult = await client.query({
      query: `
        SELECT
          mutation_id,
          command,
          is_done,
          parts_to_do
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3' AND database = currentDatabase()
        ORDER BY create_time DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const progressData = (await progressResult.json()) as any[];

    if (progressData.length === 0) {
      console.log(`⏳ [${iterations * 5}s] No mutation found (may have completed)`);
    } else {
      const mutation = progressData[0];
      console.log(`⏳ [${iterations * 5}s] Mutation ${mutation.mutation_id}: is_done=${mutation.is_done}, parts_to_do=${mutation.parts_to_do}`);

      if (mutation.is_done) {
        done = true;
      }
    }
  }

  // Verify final state
  console.log('\nVerifying final state...');
  const finalResult = await client.query({
    query: `
      SELECT
        countIf(resolved_at IS NOT NULL) as total_resolved,
        countIf(resolved_at IS NOT NULL AND is_closed = 0) as bug_rows,
        countIf(resolved_at IS NOT NULL AND is_closed = 1) as correct_rows
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const finalData = (await finalResult.json()) as any[];
  console.log('Final state:', finalData[0]);

  if (finalData[0].bug_rows === 0) {
    console.log('✅ Backfill complete! All bug rows fixed.');
  } else {
    console.log(`⚠️ Still ${finalData[0].bug_rows.toLocaleString()} bug rows remaining (mutation still in progress).`);
    console.log('Run this script again later to check progress.');
  }
}

main().catch(console.error);
