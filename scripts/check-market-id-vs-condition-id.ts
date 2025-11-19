#!/usr/bin/env npx tsx
/**
 * SMOKING GUN TEST: Is market_resolutions_final keyed by MARKET_ID, not CONDITION_ID?
 *
 * Observation: Market IDs from mapping table end with "00" while condition_ids have different endings.
 * Hypothesis: condition_id_norm in market_resolutions_final might actually be MARKET_ID!
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SMOKING GUN TEST: market_resolutions_final keyed by market_id vs condition_id?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Get wallet's condition_ids and their mapped market_ids
  console.log('Step 1: Getting wallet\'s condition_ids and market_ids from mapping\n');

  const mapping = await ch.query({
    query: `
      WITH wallet_ids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${WALLET}')
          AND condition_id_norm != ''
      )
      SELECT
        m.condition_id_32b as condition_id,
        m.market_id_cid as market_id
      FROM wallet_ids w
      INNER JOIN cascadian_clean.token_condition_market_map m
        ON w.cid = m.condition_id_32b
         OR w.cid = replaceAll(m.condition_id_32b, '0x', '')
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const mappingData = await mapping.json<{ condition_id: string; market_id: string }[]>();

  console.log(`Found ${mappingData.length} mappings:\n`);
  mappingData.slice(0, 5).forEach((row, i) => {
    const cid = row.condition_id.replace(/^0x/, '');
    const mid = row.market_id.replace(/^0x/, '');
    console.log(`${i + 1}. Condition: ${cid.substring(0, 20)}...${cid.substring(60)}`);
    console.log(`   Market:    ${mid.substring(0, 20)}...${mid.substring(60)}`);
    console.log(`   Match: ${cid === mid ? '✅ SAME' : '❌ DIFFERENT'}`);
  });
  console.log('');

  // Step 2: Test lookup by MARKET_ID instead of CONDITION_ID
  console.log('Step 2: Testing lookup by MARKET_ID in market_resolutions_final\n');

  let foundByCondition = 0;
  let foundByMarket = 0;
  let withPayouts = 0;

  for (let i = 0; i < Math.min(5, mappingData.length); i++) {
    const cid = mappingData[i].condition_id.replace(/^0x/, '');
    const mid = mappingData[i].market_id.replace(/^0x/, '');

    console.log(`${i + 1}. Testing: ${cid.substring(0, 16)}...`);

    // Try condition_id
    const byCondition = await ch.query({
      query: `
        SELECT count(*) as found
        FROM default.market_resolutions_final
        WHERE toString(condition_id_norm) = '${cid}'
      `,
      format: 'JSONEachRow',
    });
    const conditionResult = await byCondition.json<{ found: string }[]>();

    // Try market_id
    const byMarket = await ch.query({
      query: `
        SELECT
          toString(condition_id_norm) as id,
          payout_numerators,
          payout_denominator,
          winning_index
        FROM default.market_resolutions_final
        WHERE toString(condition_id_norm) = '${mid}'
      `,
      format: 'JSONEachRow',
    });
    const marketResult = await byMarket.json<any[]>();

    const foundCond = parseInt(conditionResult[0].found) > 0;
    const foundMkt = marketResult.length > 0;

    if (foundCond) foundByCondition++;
    if (foundMkt) foundByMarket++;

    console.log(`   By condition_id: ${foundCond ? '✅ FOUND' : '❌ NOT FOUND'}`);
    console.log(`   By market_id: ${foundMkt ? '✅ FOUND' : '❌ NOT FOUND'}`);

    if (foundMkt) {
      const row = marketResult[0];
      const hasPayouts = row.payout_denominator > 0 && row.payout_numerators && row.payout_numerators.length > 0;
      if (hasPayouts) withPayouts++;
      console.log(`   Payouts: ${hasPayouts ? '🎯 YES' : '❌ NO'} (numerators: [${row.payout_numerators}], denom: ${row.payout_denominator})`);
    }
    console.log('');
  }

  // Step 3: Batch test all 30
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('BATCH TEST: All 30 wallet markets');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const allMappings = await ch.query({
    query: `
      WITH wallet_ids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${WALLET}')
          AND condition_id_norm != ''
      )
      SELECT
        m.condition_id_32b as condition_id,
        m.market_id_cid as market_id
      FROM wallet_ids w
      INNER JOIN cascadian_clean.token_condition_market_map m
        ON w.cid = m.condition_id_32b
         OR w.cid = replaceAll(m.condition_id_32b, '0x', '')
    `,
    format: 'JSONEachRow',
  });
  const allMappingData = await allMappings.json<{ condition_id: string; market_id: string }[]>();

  const marketIdList = allMappingData
    .map(m => `'${m.market_id.replace(/^0x/, '')}'`)
    .join(',');

  const batchCheck = await ch.query({
    query: `
      SELECT
        count(*) as found,
        countIf(payout_denominator > 0) as with_denominator,
        countIf(length(payout_numerators) > 0) as with_numerators,
        countIf(payout_denominator > 0 AND length(payout_numerators) > 0) as both_valid
      FROM default.market_resolutions_final
      WHERE toString(condition_id_norm) IN (${marketIdList})
    `,
    format: 'JSONEachRow',
  });
  const batchData = await batchCheck.json<any[]>();

  console.log(`Results for all ${allMappingData.length} wallet markets (by MARKET_ID):`);
  console.log(`  Found: ${batchData[0].found}/${allMappingData.length}`);
  console.log(`  With denominator > 0: ${batchData[0].with_denominator}/${allMappingData.length}`);
  console.log(`  With numerators: ${batchData[0].with_numerators}/${allMappingData.length}`);
  console.log(`  With BOTH valid: ${batchData[0].both_valid}/${allMappingData.length}`);
  console.log('');

  // Step 4: Verdict
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const found = parseInt(batchData[0].found);
  const bothValid = parseInt(batchData[0].both_valid);

  if (foundByMarket > 0 && foundByCondition === 0) {
    console.log('🎯 SMOKING GUN FOUND!');
    console.log('');
    console.log('market_resolutions_final.condition_id_norm is MISLABELED - it\'s actually MARKET_ID!');
    console.log('');
    console.log('This explains EVERYTHING:');
    console.log('  ❌ Direct lookup by condition_id failed (wrong key)');
    console.log('  ✅ Lookup by market_id works!');
    console.log(`  ✅ ${found}/${allMappingData.length} markets found`);
    console.log(`  ✅ ${bothValid}/${allMappingData.length} have valid payouts`);
    console.log('');
    console.log('Fix required:');
    console.log('  1. Update vw_resolutions_truth to join via MARKET_ID not CONDITION_ID');
    console.log('  2. Use token_condition_market_map to get market_ids from condition_ids');
    console.log('  3. Re-run P&L views - gap should close!');
  } else if (found === 0) {
    console.log('❌ Still not found even by market_id');
    console.log('');
    console.log('Data genuinely missing. Need to:');
    console.log('  1. Check other internal tables (gamma_resolved, etc.)');
    console.log('  2. Or fetch from external APIs');
  } else if (bothValid > 0) {
    console.log(`🎉 SUCCESS! Found ${bothValid}/${allMappingData.length} with valid payouts`);
    console.log('');
    console.log('Codex was RIGHT - the data exists!');
    console.log('The issue was using condition_id instead of market_id for lookup.');
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
