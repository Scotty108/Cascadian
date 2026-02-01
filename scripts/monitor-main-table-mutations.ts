#!/usr/bin/env npx tsx
/**
 * Monitor Main Table Mutations
 *
 * Tracks progress of ALTER TABLE UPDATE mutations
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_NAME = 'pm_trade_fifo_roi_v3_mat_unified';

async function checkMutations() {
  const result = await clickhouse.query({
    query: `
      SELECT
        substring(command, 1, 60) as command_preview,
        create_time,
        is_done,
        parts_to_do,
        round((1 - parts_to_do / (parts_to_do + 1)) * 100, 1) as progress_pct
      FROM system.mutations
      WHERE table = '${TABLE_NAME}'
        AND is_done = 0
      ORDER BY create_time DESC
    `,
    format: 'JSONEachRow',
  });

  return await result.json();
}

async function checkSampleData() {
  const result = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)) as bad_unresolved,
        countIf(resolved_at IS NOT NULL AND
                ((tokens_held <= 0.01 AND is_closed = 0) OR
                 (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
      FROM ${TABLE_NAME}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });

  return (await result.json())[0];
}

async function main() {
  console.log('\n🔍 MONITORING MAIN TABLE MUTATIONS\n');
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Time: ${new Date().toLocaleTimeString()}\n`);

  const mutations = await checkMutations();

  if (mutations.length === 0) {
    console.log('✅ All mutations complete!\n');

    const sample = await checkSampleData();
    console.log('Sample Check (last 7 days):');
    console.log(`  Bad unresolved: ${sample.bad_unresolved.toLocaleString()}`);
    console.log(`  Bad is_closed: ${sample.bad_closed_flag.toLocaleString()}\n`);

    if (sample.bad_unresolved === 0 && sample.bad_closed_flag === 0) {
      console.log('🎉 Table is CLEAN and ready to use!\n');
    } else {
      console.log('⚠️  Sample still has issues - mutations may need more time\n');
    }
  } else {
    console.log(`⏳ ${mutations.length} mutation(s) in progress:\n`);

    mutations.forEach((m: any, i: number) => {
      console.log(`${i + 1}. ${m.command_preview}...`);
      console.log(`   Started: ${m.create_time}`);
      console.log(`   Parts left: ${m.parts_to_do}`);
      console.log(`   Progress: ~${m.progress_pct}%\n`);
    });

    console.log('Run this script again to check progress.\n');
  }
}

main();
