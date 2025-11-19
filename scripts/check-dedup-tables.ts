#!/usr/bin/env tsx
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

async function check() {
  console.log('🔍 Checking table status...\n');

  // Check deduped table
  try {
    const dedupCount = await clickhouse.query({
      query: 'SELECT count() AS total FROM pm_trades_canonical_v3_deduped',
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total);
    console.log(`✅ pm_trades_canonical_v3_deduped exists: ${dedupCount} rows`);

    const uniqueDedup = await clickhouse.query({
      query: 'SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3_deduped',
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].unique_ids);
    console.log(`   Unique trade_ids: ${uniqueDedup}`);
  } catch (e) {
    console.log('❌ pm_trades_canonical_v3_deduped does NOT exist');
  }

  // Check main table
  const mainCount = await clickhouse.query({
    query: 'SELECT count() AS total FROM pm_trades_canonical_v3',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);
  console.log(`\nMain table pm_trades_canonical_v3: ${mainCount} rows`);

  const uniqueMain = await clickhouse.query({
    query: 'SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3',
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].unique_ids);
  console.log(`   Unique trade_ids: ${uniqueMain}`);

  // Check backup
  try {
    const backupCount = await clickhouse.query({
      query: 'SELECT count() AS total FROM pm_trades_canonical_v3_backup_20251116',
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total);
    console.log(`\nBackup pm_trades_canonical_v3_backup_20251116: ${backupCount} rows`);
  } catch (e) {
    console.log('\n❌ Backup does NOT exist');
  }

  await clickhouse.close();
}

check().catch(console.error);
