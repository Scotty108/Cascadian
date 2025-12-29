#!/usr/bin/env tsx
/**
 * Force ClickHouse to merge ReplacingMergeTree versions
 * This ensures queries see the latest enriched data
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function optimizeTable() {
  console.log('\n🔧 Forcing table optimization to merge ReplacingMergeTree versions...\n');

  await clickhouse.command({
    query: 'OPTIMIZE TABLE pm_market_metadata FINAL'
  });

  console.log('✅ Table optimization complete!\n');
}

optimizeTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
