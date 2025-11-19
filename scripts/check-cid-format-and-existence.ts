#!/usr/bin/env tsx
/**
 * Check condition ID format and whether wallet 0x4ce7's markets
 * actually exist in market_resolutions_final
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 CHECKING CONDITION ID FORMAT AND EXISTENCE');
  console.log('═'.repeat(80));

  // Step 1: Get wallet's condition IDs
  console.log('\n📊 Step 1: Wallet 0x4ce7 condition IDs (first 3):\n');

  const trades = await ch.query({
    query: `
      SELECT DISTINCT
        cid as original_cid,
        lower(replaceAll(cid, '0x', '')) as normalized_cid
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = '${TEST_WALLET}'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const walletCids = await trades.json();
  walletCids.forEach((c: any, i: number) => {
    console.log(`${i + 1}. Original: ${c.original_cid}`);
    console.log(`   Normalized: ${c.normalized_cid}`);
    console.log(`   Length: ${c.normalized_cid.length}`);
    console.log('');
  });

  // Step 2: Check if first condition ID exists in resolutions
  const firstNormCid = walletCids[0]?.normalized_cid;

  if (firstNormCid) {
    console.log(`📊 Step 2: Checking if '${firstNormCid.substring(0, 16)}...' exists in market_resolutions_final:\n`);

    const checkExistence = await ch.query({
      query: `
        SELECT COUNT(*) as count
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${firstNormCid}'
      `,
      format: 'JSONEachRow',
    });

    const exists = await checkExistence.json();
    console.log(`   Result: ${exists[0].count} records found`);

    if (exists[0].count === '0') {
      console.log(`   ❌ This condition ID does NOT exist in market_resolutions_final`);
    } else {
      console.log(`   ✅ Found in table`);
    }
  }

  // Step 3: Sample condition IDs from resolutions table
  console.log('\n📊 Step 3: Sample condition IDs from market_resolutions_final table:\n');

  const sample = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        payout_denominator
      FROM default.market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const sampleCids = await sample.json();
  sampleCids.forEach((c: any, i: number) => {
    console.log(`${i + 1}. ${c.condition_id_norm.substring(0, 16)}... (len=${c.len}, denom=${c.payout_denominator})`);
  });

  // Step 4: Check how many of wallet's 30 markets are in resolutions table
  console.log('\n📊 Step 4: Coverage check for all wallet markets:\n');

  const coverage = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id_norm
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = '${TEST_WALLET}'
      )
      SELECT
        COUNT(*) as total_wallet_markets,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as found_in_resolutions,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout
      FROM wallet_markets wm
      LEFT JOIN default.market_resolutions_final r
        ON wm.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const coverageStats = await coverage.json();
  console.log('Coverage statistics:');
  console.log(JSON.stringify(coverageStats[0], null, 2));

  // Step 5: Check what table market_resolutions_final actually is
  console.log('\n📊 Step 5: Checking market_resolutions_final table structure:\n');

  const tableInfo = await ch.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE name = 'market_resolutions_final'
    `,
    format: 'JSONEachRow',
  });

  const tableDetails = await tableInfo.json();
  console.log('Table details:');
  console.log(JSON.stringify(tableDetails[0], null, 2));

  console.log('\n' + '═'.repeat(80));
  console.log('✅ CHECK COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
