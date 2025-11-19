#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🗑️  Truncating global_ghost_ingestion_checkpoints table...\n');

  // Get row count BEFORE truncation
  const beforeResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM global_ghost_ingestion_checkpoints`,
    format: 'JSONEachRow'
  });
  const beforeRows: any[] = await beforeResult.json();
  const beforeCount = beforeRows[0]?.count || 0;

  console.log(`📊 Row count BEFORE truncation: ${beforeCount}`);

  // Truncate the table
  await clickhouse.query({
    query: `TRUNCATE TABLE global_ghost_ingestion_checkpoints`
  });

  console.log('✅ TRUNCATE TABLE executed');

  // Get row count AFTER truncation
  const afterResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM global_ghost_ingestion_checkpoints`,
    format: 'JSONEachRow'
  });
  const afterRows: any[] = await afterResult.json();
  const afterCount = afterRows[0]?.count || 0;

  console.log(`📊 Row count AFTER truncation: ${afterCount}\n`);

  if (afterCount === 0) {
    console.log('✅ Checkpoint table successfully truncated');
    console.log('✅ Ready for clean ingestion run');
  } else {
    console.log(`⚠️  Warning: Expected 0 rows after truncation, found ${afterCount}`);
  }
}

main().catch(console.error);
