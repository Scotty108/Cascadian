#!/usr/bin/env npx tsx
/**
 * CRITICAL TEST: Are wallet's "condition_ids" actually ERC1155 token_ids?
 *
 * Hypothesis: vw_trades_canonical.condition_id_norm contains ERC1155 token_ids,
 * and we need to use token_condition_market_map to get the actual condition_ids.
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
  console.log('TOKEN_ID MAPPING TEST: Are wallet IDs actually ERC1155 token_ids?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get wallet's IDs
  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(condition_id_norm, '0x', '')) as wallet_id
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletIds.json<{ wallet_id: string }[]>();

  console.log(`Wallet has ${walletData.length} unique IDs\n`);
  console.log('Testing first 5 in token_condition_market_map:\n');

  // Check if these are token_ids or condition_ids in the mapping table
  for (let i = 0; i < Math.min(5, walletData.length); i++) {
    const testId = walletData[i].wallet_id;
    console.log(`${i + 1}. Testing: ${testId.substring(0, 20)}...`);

    // Check as token_id
    const asToken = await ch.query({
      query: `
        SELECT
          token_id_erc1155,
          condition_id_32b,
          market_id_cid
        FROM cascadian_clean.token_condition_market_map
        WHERE token_id_erc1155 = '${testId}'
          OR token_id_erc1155 = '0x${testId}'
      `,
      format: 'JSONEachRow',
    });
    const tokenData = await asToken.json<any[]>();

    // Check as condition_id
    const asCondition = await ch.query({
      query: `
        SELECT
          token_id_erc1155,
          condition_id_32b,
          market_id_cid
        FROM cascadian_clean.token_condition_market_map
        WHERE condition_id_32b = '${testId}'
          OR condition_id_32b = '0x${testId}'
      `,
      format: 'JSONEachRow',
    });
    const conditionData = await asCondition.json<any[]>();

    if (tokenData.length > 0) {
      console.log(`   ✅ Found as TOKEN_ID → maps to condition_id: ${tokenData[0].condition_id_32b.substring(0, 20)}...`);
      console.log(`   Market ID: ${tokenData[0].market_id_cid}`);
    } else if (conditionData.length > 0) {
      console.log(`   ✅ Found as CONDITION_ID (already correct)`);
      console.log(`   Market ID: ${conditionData[0].market_id_cid}`);
    } else {
      console.log(`   ❌ NOT FOUND in mapping table at all`);
    }
    console.log('');
  }

  // Batch check all 30
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('BATCH CHECK: All 30 wallet IDs');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const idList = walletData.map(w => `'${w.wallet_id}'`).join(',');
  const idListWith0x = walletData.map(w => `'0x${w.wallet_id}'`).join(',');

  const summary = await ch.query({
    query: `
      SELECT
        countIf(token_id_erc1155 IN (${idList}, ${idListWith0x})) as found_as_tokens,
        countIf(condition_id_32b IN (${idList}, ${idListWith0x})) as found_as_conditions
      FROM cascadian_clean.token_condition_market_map
    `,
    format: 'JSONEachRow',
  });
  const summaryData = await summary.json<any[]>();

  console.log(`Results for all ${walletData.length} wallet IDs:`);
  console.log(`  Found as token_ids: ${summaryData[0].found_as_tokens}`);
  console.log(`  Found as condition_ids: ${summaryData[0].found_as_conditions}`);
  console.log('');

  // If found as tokens, get the mapped condition_ids
  if (parseInt(summaryData[0].found_as_tokens) > 0) {
    console.log('Fetching mapped condition_ids for token_ids...\n');

    const mapped = await ch.query({
      query: `
        SELECT
          token_id_erc1155 as token_id,
          condition_id_32b as condition_id,
          market_id_cid
        FROM cascadian_clean.token_condition_market_map
        WHERE token_id_erc1155 IN (${idList}, ${idListWith0x})
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const mappedData = await mapped.json<any[]>();

    console.log('Sample mappings:');
    mappedData.forEach((row, i) => {
      console.log(`  ${i + 1}. Token: ${row.token_id.substring(0, 20)}...`);
      console.log(`     → Condition: ${row.condition_id.substring(0, 20)}...`);
      console.log(`     Market: ${row.market_id_cid}`);
    });
    console.log('');

    // NOW check if the MAPPED condition_ids have payouts
    console.log('Checking if mapped condition_ids have payouts in market_resolutions_final...\n');

    const mappedIdList = mappedData.map(m => `'${m.condition_id.replace(/^0x/, '')}'`).join(',');

    const payoutCheck = await ch.query({
      query: `
        SELECT
          count(*) as found,
          countIf(payout_denominator > 0 AND length(payout_numerators) > 0) as with_payouts
        FROM default.market_resolutions_final
        WHERE toString(condition_id_norm) IN (${mappedIdList})
      `,
      format: 'JSONEachRow',
    });
    const payoutData = await payoutCheck.json<any[]>();

    console.log(`Mapped condition_ids in market_resolutions_final:`);
    console.log(`  Found: ${payoutData[0].found}/${mappedData.length}`);
    console.log(`  With valid payouts: ${payoutData[0].with_payouts}/${mappedData.length}`);
    console.log('');
  }

  // Verdict
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const foundAsTokens = parseInt(summaryData[0].found_as_tokens);
  const foundAsConditions = parseInt(summaryData[0].found_as_conditions);

  if (foundAsTokens > 0) {
    console.log(`🎯 FOUND IT! ${foundAsTokens}/${walletData.length} IDs are ERC1155 TOKEN_IDs`);
    console.log('');
    console.log('ROOT CAUSE: vw_trades_canonical.condition_id_norm stores token_ids, not condition_ids!');
    console.log('');
    console.log('This explains everything:');
    console.log('  ❌ Direct join to market_resolutions_final failed (wrong ID type)');
    console.log('  ✅ Must use token_condition_market_map to get real condition_ids');
    console.log('  ✅ Then join to market_resolutions_final with mapped condition_ids');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Map all 30 token_ids to condition_ids');
    console.log('  2. Query market_resolutions_final with mapped condition_ids');
    console.log('  3. Check if payout data exists for those condition_ids');
  } else if (foundAsConditions > 0) {
    console.log(`✅ IDs are already CONDITION_IDs (${foundAsConditions}/${walletData.length} found)`);
    console.log('');
    console.log('Data genuinely missing from market_resolutions_final.');
    console.log('Need to check other tables or fetch externally.');
  } else {
    console.log(`❌ NOT FOUND: 0/${walletData.length} IDs in mapping table`);
    console.log('');
    console.log('Major issue - IDs don\'t exist anywhere in our mapping.');
    console.log('Need to investigate vw_trades_canonical source data.');
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
