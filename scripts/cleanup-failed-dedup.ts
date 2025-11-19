#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@clickhouse/client';
import { writeFileSync } from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function cleanup() {
  console.log('🧹 Cleaning up failed dedup table...\n');

  try {
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS pm_trades_canonical_v3_deduped`,
      format: 'JSONEachRow'
    });
    console.log('✅ Dropped pm_trades_canonical_v3_deduped');
  } catch (e: any) {
    console.log(`⚠️ Could not drop table: ${e.message}`);
  }

  // Reset checkpoint to analysis_complete so Step 2 re-runs with fixed query
  console.log('\n🔄 Resetting checkpoint to analysis_complete...');
  const checkpoint = {
    step: 'analysis_complete',
    timestamp: new Date().toISOString(),
    dupCount: 59274927
  };
  writeFileSync('/tmp/dedup-checkpoint.json', JSON.stringify(checkpoint, null, 2));
  console.log('✅ Checkpoint reset. Step 2 will re-run with deterministic ordering.\n');

  await clickhouse.close();
}

cleanup().catch(console.error);
