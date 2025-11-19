#!/usr/bin/env npx tsx
/**
 * DIRECT TEST: Do wallet's IDs exist in market_resolutions_final?
 *
 * Simplest possible check:
 * 1. Get wallet's normalized condition_ids
 * 2. Query market_resolutions_final with toString() cast
 * 3. Show exact matches
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
  console.log('DIRECT LOOKUP TEST: Wallet IDs in market_resolutions_final');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Get wallet's normalized IDs
  console.log('Step 1: Getting wallet IDs from vw_trades_canonical\n');

  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(condition_id_norm, '0x', '')) as cid
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletIds.json<{ cid: string }[]>();

  console.log(`Found ${walletData.length} unique condition_ids\n`);
  console.log('First 5:');
  walletData.slice(0, 5).forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.cid}`);
  });
  console.log('');

  // Step 2: Check each ID in market_resolutions_final
  console.log('Step 2: Checking each ID in market_resolutions_final\n');

  let foundCount = 0;
  let withPayoutsCount = 0;

  for (let i = 0; i < Math.min(5, walletData.length); i++) {
    const cid = walletData[i].cid;
    console.log(`${i + 1}. Testing: ${cid.substring(0, 20)}...`);

    const result = await ch.query({
      query: `
        SELECT
          toString(condition_id_norm) as cid,
          payout_numerators,
          payout_denominator,
          winning_index
        FROM default.market_resolutions_final
        WHERE toString(condition_id_norm) = '${cid}'
      `,
      format: 'JSONEachRow',
    });
    const data = await result.json<any[]>();

    if (data.length > 0) {
      foundCount++;
      console.log(`   ✅ FOUND in market_resolutions_final`);
      const row = data[0];
      console.log(`   Payout numerators: [${row.payout_numerators}]`);
      console.log(`   Payout denominator: ${row.payout_denominator}`);
      if (row.payout_denominator > 0 && row.payout_numerators && row.payout_numerators.length > 0) {
        withPayoutsCount++;
        console.log(`   🎯 HAS VALID PAYOUT!`);
      } else {
        console.log(`   ❌ EMPTY PAYOUT (denominator=${row.payout_denominator})`);
      }
    } else {
      console.log(`   ❌ NOT FOUND`);
    }
    console.log('');
  }

  // Step 3: Batch check all 30
  console.log('Step 3: Batch checking all 30 IDs\n');

  const cidList = walletData.map(w => `'${w.cid}'`).join(',');

  const summary = await ch.query({
    query: `
      SELECT
        count(*) as found,
        countIf(payout_denominator > 0) as with_denominator,
        countIf(length(payout_numerators) > 0) as with_numerators,
        countIf(payout_denominator > 0 AND length(payout_numerators) > 0) as both_valid
      FROM default.market_resolutions_final
      WHERE toString(condition_id_norm) IN (${cidList})
    `,
    format: 'JSONEachRow',
  });
  const summaryData = await summary.json<any[]>();

  console.log(`Summary for all ${walletData.length} wallet condition_ids:`);
  console.log(`  Found in market_resolutions_final: ${summaryData[0].found}/${walletData.length}`);
  console.log(`  With payout_denominator > 0: ${summaryData[0].with_denominator}/${walletData.length}`);
  console.log(`  With non-empty numerators: ${summaryData[0].with_numerators}/${walletData.length}`);
  console.log(`  With BOTH valid: ${summaryData[0].both_valid}/${walletData.length}`);
  console.log('');

  // Step 4: Verdict
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const found = parseInt(summaryData[0].found);
  const bothValid = parseInt(summaryData[0].both_valid);

  if (found === 0) {
    console.log('❌ ZERO MATCHES: Wallet IDs do NOT exist in market_resolutions_final');
    console.log('');
    console.log('Possible causes:');
    console.log('  1. vw_trades_canonical.condition_id_norm contains token_ids, not condition_ids');
    console.log('  2. ID format mismatch (need to check normalization)');
    console.log('  3. Data genuinely missing from market_resolutions_final');
    console.log('');
    console.log('Next: Check if wallet IDs map to different condition_ids via token_condition_market_map');
  } else if (found > 0 && bothValid === 0) {
    console.log(`⚠️  ${found}/${walletData.length} IDs FOUND but all have EMPTY payouts`);
    console.log('');
    console.log('This means:');
    console.log('  - Markets exist in table as placeholder rows');
    console.log('  - But payout data was never populated');
    console.log('  - Need to fetch from gamma_resolved, external APIs, or blockchain');
  } else if (bothValid > 0) {
    console.log(`🎉 SUCCESS: ${bothValid}/${walletData.length} IDs have VALID payout data!`);
    console.log('');
    console.log('The data EXISTS! The issue was with previous join queries.');
    console.log('Next: Rebuild vw_resolutions_truth properly and re-run P&L views.');
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
