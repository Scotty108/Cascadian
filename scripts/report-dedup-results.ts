#!/usr/bin/env tsx
/**
 * Report Deduplication Results
 * Generates final summary of P0 deduplication execution
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
  request_timeout: 60000,
});

async function reportResults() {
  console.log('📊 P0 DEDUPLICATION - FINAL REPORT\n');

  // Current row count
  const currentCount = await clickhouse.query({
    query: `SELECT count() AS total FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);

  console.log(`Current row count: ${currentCount.toLocaleString()}`);

  // Check for remaining duplicates
  const dupCheck = await clickhouse.query({
    query: `
      SELECT count() AS remaining_dups
      FROM (
        SELECT trade_id
        FROM pm_trades_canonical_v3
        GROUP BY trade_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].remaining_dups);

  console.log(`Remaining duplicate trade_ids: ${dupCheck.toLocaleString()}`);

  // Unique trade_id count
  const uniqueCount = await clickhouse.query({
    query: `SELECT count(DISTINCT trade_id) AS unique_trades FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].unique_trades);

  console.log(`Unique trade_ids: ${uniqueCount.toLocaleString()}`);

  // Total volume
  const volume = await clickhouse.query({
    query: `SELECT sum(usd_value) AS total_volume FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total_volume);

  console.log(`Total volume: $${Math.round(volume / 1e9).toLocaleString()}B`);

  // Backup verification
  try {
    const backupCount = await clickhouse.query({
      query: `SELECT count() AS total FROM pm_trades_canonical_v3_backup_20251116`,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total);

    console.log(`\nBackup verification: ✅ ${backupCount.toLocaleString()} rows in backup`);
  } catch (e) {
    console.log('\nBackup verification: ❌ No backup found');
  }

  // Daily duplicate rate (last 24 hours)
  const dailyDups = await clickhouse.query({
    query: `
      SELECT count() AS new_dups
      FROM (
        SELECT trade_id
        FROM pm_trades_canonical_v3
        WHERE created_at >= now() - INTERVAL 1 DAY
        GROUP BY trade_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].new_dups);

  console.log(`\nDaily duplicate rate: ${dailyDups.toLocaleString()} (last 24 hours)`);

  // Summary
  console.log('\n================================================================================');
  console.log('SUMMARY:');
  console.log('================================================================================');

  if (dupCheck === 0 && currentCount === uniqueCount) {
    console.log('✅ SUCCESS: Database fully deduplicated');
    console.log(`   - ${currentCount.toLocaleString()} total trades`);
    console.log(`   - ${uniqueCount.toLocaleString()} unique trade_ids`);
    console.log(`   - 0 duplicate trade_ids`);
  } else if (dupCheck > 0) {
    console.log('⚠️  WARNING: Duplicates still exist');
    console.log(`   - ${currentCount.toLocaleString()} total trades`);
    console.log(`   - ${uniqueCount.toLocaleString()} unique trade_ids`);
    console.log(`   - ${dupCheck.toLocaleString()} duplicate trade_ids remaining`);
    console.log('\n   Next steps:');
    console.log('   1. Re-run deduplication script');
    console.log('   2. Check for table-level issues');
    console.log('   3. Verify RENAME operation completed');
  } else {
    console.log('⚠️  UNEXPECTED: Row count != unique count');
    console.log(`   - ${currentCount.toLocaleString()} total trades`);
    console.log(`   - ${uniqueCount.toLocaleString()} unique trade_ids`);
  }

  console.log('\n================================================================================\n');

  await clickhouse.close();
}

reportResults().catch(console.error);
