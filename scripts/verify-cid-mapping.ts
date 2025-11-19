#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

(async () => {
  console.log('\n🔍 Verifying what cid represents in fact_trades_clean...\n');

  // Get the single market that DOES exist
  const existingMarket = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      )
      SELECT
        wm.condition_id,
        ams.condition_id as ams_cid,
        ams.question,
        ams.market_slug,
        mrf.condition_id_norm as mrf_cid
      FROM wallet_markets wm
      LEFT JOIN default.api_markets_staging ams 
        ON wm.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
      LEFT JOIN default.market_resolutions_final mrf
        ON wm.condition_id = mrf.condition_id_norm
      WHERE ams.condition_id IS NOT NULL
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const exists = await existingMarket.json();
  if (exists.length > 0) {
    console.log('✅ Found 1 matching market:\n');
    console.log(`  Trade CID (normalized): ${exists[0].condition_id.substring(0, 32)}...`);
    console.log(`  AMS CID: ${exists[0].ams_cid ? exists[0].ams_cid.substring(0, 32) + '...' : 'NULL'}`);
    console.log(`  MRF CID: ${exists[0].mrf_cid ? exists[0].mrf_cid.substring(0, 32) + '...' : 'NULL'}`);
    console.log(`  Question: ${exists[0].question || 'NULL'}`);
    console.log(`  Slug: ${exists[0].market_slug || 'NULL'}`);
  }

  // Sample a few markets that DON'T exist
  console.log('\n❌ Sampling 5 markets that DON\'T exist in api_markets_staging:\n');

  const missingMarkets = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT 
          lower(replaceAll(cid, '0x', '')) as condition_id,
          cid as original_cid,
          COUNT(*) as trade_count
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
        GROUP BY cid
      )
      SELECT
        wm.condition_id,
        wm.original_cid,
        wm.trade_count,
        ams.condition_id as in_ams
      FROM wallet_markets wm
      LEFT JOIN default.api_markets_staging ams 
        ON wm.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
      WHERE ams.condition_id IS NULL
      ORDER BY wm.trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const missing = await missingMarkets.json();
  for (let i = 0; i < missing.length; i++) {
    const m = missing[i];
    console.log(`  ${i+1}. CID: ${m.condition_id.substring(0, 32)}... (${m.trade_count} trades)`);
    console.log(`     Original: ${m.original_cid.substring(0, 40)}...`);
    console.log(`     In AMS: ${m.in_ams || 'NO'}`);
    console.log();
  }

  // Check total market counts across key tables
  console.log('📊 Market count comparison across tables:\n');

  const tableCounts = await ch.query({
    query: `
      SELECT
        'fact_trades_clean' as table_name,
        COUNT(DISTINCT lower(replaceAll(cid, '0x', ''))) as unique_markets
      FROM default.fact_trades_clean

      UNION ALL

      SELECT
        'api_markets_staging',
        COUNT(DISTINCT lower(replaceAll(condition_id, '0x', '')))
      FROM default.api_markets_staging

      UNION ALL

      SELECT
        'market_resolutions_final',
        COUNT(DISTINCT condition_id_norm)
      FROM default.market_resolutions_final

      UNION ALL

      SELECT
        'resolutions_external_ingest',
        COUNT(DISTINCT condition_id)
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });

  const counts = await tableCounts.json();
  for (const c of counts) {
    console.log(`  ${c.table_name.padEnd(30)} ${parseInt(c.unique_markets).toLocaleString()} markets`);
  }

  await ch.close();
})();
