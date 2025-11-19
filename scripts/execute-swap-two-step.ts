#!/usr/bin/env tsx
/**
 * Execute two-step swap (ClickHouse Cloud Shared doesn't support atomic multi-table RENAME)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function executeSwap() {
  console.log('🔄 Executing Two-Step Swap\n');

  console.log('Pre-swap verification:');
  const dedupCount = await clickhouse.query({
    query: 'SELECT count() AS total FROM pm_trades_canonical_v3_deduped',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);
  console.log(`  Deduped table: ${dedupCount} rows`);

  const mainCount = await clickhouse.query({
    query: 'SELECT count() AS total FROM pm_trades_canonical_v3',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);
  console.log(`  Main table: ${mainCount} rows (will be backed up)\n`);

  console.log('Step 1: Rename main → backup...');
  await clickhouse.query({
    query: `RENAME TABLE pm_trades_canonical_v3 TO pm_trades_canonical_v3_backup_20251116`,
    format: 'JSONEachRow'
  });
  console.log('✅ Main table backed up\n');

  console.log('Step 2: Rename deduped → main...');
  await clickhouse.query({
    query: `RENAME TABLE pm_trades_canonical_v3_deduped TO pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  });
  console.log('✅ Deduped table is now main\n');

  console.log('Post-swap verification:');
  const newMainCount = await clickhouse.query({
    query: 'SELECT count() AS total FROM pm_trades_canonical_v3',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);
  console.log(`  Main table: ${newMainCount} rows`);

  const backupCount = await clickhouse.query({
    query: 'SELECT count() AS total FROM pm_trades_canonical_v3_backup_20251116',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);
  console.log(`  Backup: ${backupCount} rows`);

  console.log('\n================================================================================');
  console.log('🎉 P0 DEDUPLICATION COMPLETE 🎉');
  console.log('================================================================================\n');
  console.log('RESULTS:');
  console.log(`  Before: ${backupCount} trades`);
  console.log(`  After:  ${newMainCount} trades`);
  console.log(`  Removed: ${backupCount - newMainCount} duplicates (${((backupCount - newMainCount) / backupCount * 100).toFixed(1)}%)`);
  console.log('\nBACKUP:');
  console.log('  pm_trades_canonical_v3_backup_20251116');
  console.log('\n================================================================================\n');

  await clickhouse.close();
}

executeSwap().catch((error) => {
  console.error('\n❌ SWAP FAILED:\n', error);
  process.exit(1);
});
