import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK IF BIDEN-COVID MARKET EXISTS IN OUR DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const slug = 'will-joe-biden-get-coronavirus-before-the-election';

  // Check market_key_map
  console.log('1. Checking market_key_map...\n');
  const keyMapQuery = await clickhouse.query({
    query: `
      SELECT
        market_id,
        condition_id,
        question,
        resolved_at
      FROM default.market_key_map
      WHERE market_id = '${slug}'
    `,
    format: 'JSONEachRow'
  });
  const keyMapRows: any[] = await keyMapQuery.json();

  if (keyMapRows.length > 0) {
    console.log('   ✅ Found in market_key_map:');
    console.log(`      Condition ID: ${keyMapRows[0].condition_id}`);
    console.log(`      Question: ${keyMapRows[0].question}`);
    console.log(`      Resolved at: ${keyMapRows[0].resolved_at || 'NULL'}\n`);
  } else {
    console.log('   ❌ NOT found in market_key_map\n');
  }

  // Check market_resolutions_by_market
  console.log('2. Checking market_resolutions_by_market...\n');
  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        market_id,
        winning_outcome,
        resolved_at
      FROM default.market_resolutions_by_market
      WHERE market_id = '${slug}'
    `,
    format: 'JSONEachRow'
  });
  const resolutionRows: any[] = await resolutionsQuery.json();

  if (resolutionRows.length > 0) {
    console.log('   ✅ Found in market_resolutions_by_market:');
    console.log(`      Winning outcome: ${resolutionRows[0].winning_outcome}`);
    console.log(`      Resolved at: ${resolutionRows[0].resolved_at}\n`);
  } else {
    console.log('   ❌ NOT found in market_resolutions_by_market\n');
  }

  // Check market_resolutions_final
  console.log('3. Checking market_resolutions_final...\n');
  const finalQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at
      FROM default.market_resolutions_final
      WHERE condition_id_norm IN (
        SELECT lower(replaceAll(condition_id, '0x', ''))
        FROM default.market_key_map
        WHERE market_id = '${slug}'
      )
    `,
    format: 'JSONEachRow'
  });
  const finalRows: any[] = await finalQuery.json();

  if (finalRows.length > 0) {
    console.log('   ✅ Found in market_resolutions_final:');
    console.log(`      Winning index: ${finalRows[0].winning_index}`);
    console.log(`      Payout numerators: ${finalRows[0].payout_numerators}`);
    console.log(`      Payout denominator: ${finalRows[0].payout_denominator}`);
    console.log(`      Resolved at: ${finalRows[0].resolved_at}\n`);
  } else {
    console.log('   ❌ NOT found in market_resolutions_final\n');
  }

  // Check bridge tables
  console.log('4. Checking bridge tables for our 5 CTFs...\n');

  const CTFs = [
    '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
    '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
    '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
    '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
    '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e',
  ];

  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_64,
        slug,
        condition_id_64,
        src
      FROM cascadian_clean.bridge_ctf_condition
      WHERE ctf_64 IN (${CTFs.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const bridgeRows: any[] = await bridgeQuery.json();

  if (bridgeRows.length > 0) {
    console.log(`   Found ${bridgeRows.length}/5 CTFs in bridge:\n`);
    bridgeRows.forEach((r, i) => {
      console.log(`   ${i + 1}. CTF: ${r.ctf_64.substring(0, 20)}...`);
      console.log(`      Slug: ${r.slug || 'NULL'}`);
      console.log(`      Condition ID: ${r.condition_id_64?.substring(0, 20) || 'NULL'}...`);
      console.log(`      Source: ${r.src}\n`);
    });
  } else {
    console.log('   No CTFs found in bridge\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const inKeyMap = keyMapRows.length > 0;
  const hasResolution = resolutionRows.length > 0 || finalRows.length > 0;
  const inBridge = bridgeRows.length > 0;

  console.log(`   Market slug: ${slug}`);
  console.log(`   In market_key_map: ${inKeyMap ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   Has resolution data: ${hasResolution ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   CTFs in bridge: ${bridgeRows.length}/5 ${bridgeRows.length === 5 ? '✅' : '⚠️'}\n`);

  if (!inKeyMap) {
    console.log('⚠️  Market not in market_key_map - need to fetch and insert\n');
  }

  if (!hasResolution) {
    console.log('⚠️  Market not in resolution tables - need to fetch resolution data\n');
  }

  if (bridgeRows.length < 5) {
    console.log(`⚠️  Only ${bridgeRows.length}/5 CTFs in bridge - need to insert missing mappings\n`);
  }

  if (inKeyMap && hasResolution && bridgeRows.length === 5) {
    console.log('🤔 Market EXISTS with resolution data, but CTFs not connecting properly');
    console.log('   Root cause: Bridge mappings likely have wrong condition_id\n');
    console.log('Next step: Fix bridge mappings to point to correct condition_id\n');
  } else {
    console.log('Next step: Fetch full market data from Gamma and insert\n');
    console.log('   Run: npx tsx fetch-biden-market-data.ts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
