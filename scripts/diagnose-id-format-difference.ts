#!/usr/bin/env npx tsx
/**
 * CRITICAL DIAGNOSTIC: Are wallet's "condition_ids" actually TOKEN_IDs?
 *
 * Hypothesis: vw_trades_canonical.condition_id_norm might contain token_ids (66-char)
 * instead of condition_ids (64-char), which would explain join failures.
 *
 * This checks:
 * 1. Actual ID lengths in wallet's trades
 * 2. Sample IDs from both tables to compare format
 * 3. Whether mapping table can bridge the gap
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
  console.log('DIAGNOSTIC: Are wallet IDs actually TOKEN_IDs instead of CONDITION_IDs?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Check wallet's ID format and lengths
  console.log('Step 1: Checking wallet\'s ID format in vw_trades_canonical\n');

  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm as raw_id,
        length(condition_id_norm) as raw_length,
        lower(replaceAll(condition_id_norm, '0x', '')) as normalized_id,
        length(lower(replaceAll(condition_id_norm, '0x', ''))) as normalized_length
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletIds.json<any[]>();

  console.log(`Found ${walletData.length} sample IDs from wallet:\n`);
  walletData.forEach((row, i) => {
    console.log(`  ${i + 1}. Raw: ${row.raw_id.substring(0, 20)}... (length: ${row.raw_length})`);
    console.log(`     Normalized: ${row.normalized_id.substring(0, 20)}... (length: ${row.normalized_length})`);
  });
  console.log('');

  // Step 2: Check market_resolutions_final ID format
  console.log('Step 2: Checking market_resolutions_final ID format\n');

  const marketIds = await ch.query({
    query: `
      SELECT
        condition_id_norm as raw_id,
        toString(condition_id_norm) as string_id,
        length(toString(condition_id_norm)) as string_length
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const marketData = await marketIds.json<any[]>();

  console.log(`Sample IDs from market_resolutions_final:\n`);
  marketData.forEach((row, i) => {
    console.log(`  ${i + 1}. String: ${row.string_id.substring(0, 20)}... (length: ${row.string_length})`);
  });
  console.log('');

  // Step 3: Check if mapping table can bridge the gap
  console.log('Step 3: Checking token_condition_market_map for wallet IDs\n');

  const firstWalletId = walletData[0].normalized_id;

  const mappingCheck = await ch.query({
    query: `
      SELECT
        token_id_32b,
        condition_id_32b,
        market_id_cid,
        length(token_id_32b) as token_len,
        length(condition_id_32b) as condition_len
      FROM cascadian_clean.token_condition_market_map
      WHERE token_id_32b = '${firstWalletId}'
         OR condition_id_32b = '${firstWalletId}'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const mappingData = await mappingCheck.json<any[]>();

  if (mappingData.length > 0) {
    console.log('✅ FOUND in mapping table:\n');
    mappingData.forEach((row, i) => {
      console.log(`  ${i + 1}. Token ID: ${row.token_id_32b.substring(0, 20)}... (len: ${row.token_len})`);
      console.log(`     Condition ID: ${row.condition_id_32b.substring(0, 20)}... (len: ${row.condition_len})`);
      console.log(`     Market ID: ${row.market_id_cid}`);
    });
  } else {
    console.log('❌ NOT FOUND in mapping table');
  }
  console.log('');

  // Step 4: Try looking up wallet IDs as TOKEN_IDs in mapping
  console.log('Step 4: Looking up ALL wallet IDs in mapping table\n');

  const allWalletIdsList = walletData.map(w => `'${w.normalized_id}'`).join(',');

  const tokenLookup = await ch.query({
    query: `
      SELECT
        count(*) as found_as_tokens,
        countIf(condition_id_32b != '') as with_condition_ids
      FROM cascadian_clean.token_condition_market_map
      WHERE token_id_32b IN (${allWalletIdsList})
    `,
    format: 'JSONEachRow',
  });
  const tokenData = await tokenLookup.json<any[]>();

  console.log(`Wallet IDs looked up as TOKEN_IDs:`);
  console.log(`  Found: ${tokenData[0].found_as_tokens}/${walletData.length}`);
  console.log(`  With condition_id mapping: ${tokenData[0].with_condition_ids}/${walletData.length}`);
  console.log('');

  const conditionLookup = await ch.query({
    query: `
      SELECT
        count(*) as found_as_conditions
      FROM cascadian_clean.token_condition_market_map
      WHERE condition_id_32b IN (${allWalletIdsList})
    `,
    format: 'JSONEachRow',
  });
  const conditionData = await conditionLookup.json<any[]>();

  console.log(`Wallet IDs looked up as CONDITION_IDs:`);
  console.log(`  Found: ${conditionData[0].found_as_conditions}/${walletData.length}`);
  console.log('');

  // Step 5: Verdict
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const foundAsTokens = parseInt(tokenData[0].found_as_tokens);
  const foundAsConditions = parseInt(conditionData[0].found_as_conditions);

  if (foundAsTokens > 0 && foundAsConditions === 0) {
    console.log('🎯 SMOKING GUN: Wallet IDs are TOKEN_IDs, not CONDITION_IDs!');
    console.log('');
    console.log('This explains EVERYTHING:');
    console.log('  - Wallet\'s vw_trades_canonical.condition_id_norm contains token_ids');
    console.log('  - market_resolutions_final.condition_id_norm contains condition_ids');
    console.log('  - Direct join fails because they\'re different ID types');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Use token_condition_market_map to get condition_ids for wallet');
    console.log('  2. Query market_resolutions_final with mapped condition_ids');
    console.log('  3. Verify payout data exists after proper mapping');
  } else if (foundAsConditions > 0 && foundAsTokens === 0) {
    console.log('✅ Wallet IDs are CONDITION_IDs (correct format)');
    console.log('');
    console.log('This means the data genuinely doesn\'t exist in market_resolutions_final.');
    console.log('Need to check other internal tables or fetch from external APIs.');
  } else if (foundAsTokens > 0 && foundAsConditions > 0) {
    console.log('⚠️  MIXED: Some IDs are tokens, some are conditions');
    console.log('');
    console.log('Need deeper investigation into ID format inconsistency.');
  } else {
    console.log('❌ NOT FOUND: IDs don\'t exist in mapping table at all');
    console.log('');
    console.log('This is unexpected - need to investigate data corruption or ID format.');
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
