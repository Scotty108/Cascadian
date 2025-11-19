#!/usr/bin/env npx tsx
/**
 * CRITICAL TEST: Does market_resolutions_final actually have payout data
 * for the wallet's condition_ids?
 *
 * Codex claims the data exists but joins are failing due to FixedString padding.
 * Let's verify by direct query with toString() cast.
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

async function main() {
  const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('CRITICAL TEST: Does market_resolutions_final have REAL payout data?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get all wallet condition_ids
  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${wallet}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const walletCids = await walletIds.json<any[]>();

  console.log(`Wallet has ${walletCids.length} unique condition_ids\n`);

  // Test first 3 condition_ids
  console.log('Testing first 3 condition_ids in market_resolutions_final:\n');

  for (let i = 0; i < Math.min(3, walletCids.length); i++) {
    const testCid = walletCids[i].cid;

    console.log(`${i + 1}. Testing: ${testCid.substring(0, 20)}...`);

    const direct = await ch.query({
      query: `
        SELECT
          toString(condition_id_norm) as cid,
          payout_numerators,
          payout_denominator,
          winning_index,
          resolved_at
        FROM default.market_resolutions_final
        WHERE toString(condition_id_norm) = '${testCid}'
      `,
      format: 'JSONEachRow',
    });
    const directData = await direct.json<any[]>();

    if (directData.length > 0) {
      const row = directData[0];
      console.log(`   ✅ FOUND in market_resolutions_final`);
      console.log(`   Payout numerators: [${row.payout_numerators}]`);
      console.log(`   Payout denominator: ${row.payout_denominator}`);
      console.log(`   Winning index: ${row.winning_index}`);

      if (row.payout_denominator > 0 && row.payout_numerators && row.payout_numerators.length > 0) {
        console.log(`   🎯 HAS VALID PAYOUT DATA!`);
      } else {
        console.log(`   ❌ EMPTY/INVALID (denominator=${row.payout_denominator}, numerators=${row.payout_numerators})`);
      }
    } else {
      console.log(`   ❌ NOT FOUND in market_resolutions_final`);
    }
    console.log('');
  }

  // Now count how many of ALL 30 have valid payouts
  console.log('═'.repeat(80));
  console.log('COUNTING ALL 30 CONDITION_IDS');
  console.log('═'.repeat(80));
  console.log('');

  const cidList = walletCids.map(c => `'${c.cid}'`).join(',');

  const summary = await ch.query({
    query: `
      SELECT
        count(*) as found,
        countIf(payout_denominator > 0) as with_denominator,
        countIf(length(payout_numerators) > 0) as with_numerators,
        countIf(payout_denominator > 0 AND length(payout_numerators) > 0) as both_valid,
        countIf(arraySum(payout_numerators) = payout_denominator AND payout_denominator > 0) as balanced
      FROM default.market_resolutions_final
      WHERE toString(condition_id_norm) IN (${cidList})
    `,
    format: 'JSONEachRow',
  });
  const summaryData = await summary.json<any[]>();

  console.log(`Results for wallet's 30 condition_ids:`);
  console.log(`  Found in table: ${summaryData[0].found}/30`);
  console.log(`  With denominator > 0: ${summaryData[0].with_denominator}/30`);
  console.log(`  With non-empty numerators: ${summaryData[0].with_numerators}/30`);
  console.log(`  With BOTH valid: ${summaryData[0].both_valid}/30`);
  console.log(`  With balanced sums: ${summaryData[0].balanced}/30`);
  console.log('');

  const valid = parseInt(summaryData[0].both_valid);

  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (valid > 0) {
    console.log(`🎉 CODEX WAS RIGHT! ${valid}/30 condition_ids have VALID payout data!`);
    console.log('');
    console.log('The issue was the join, not missing data.');
    console.log('');
    console.log('Next step: Verify vw_resolutions_truth includes these rows with proper casting,');
    console.log('then re-run P&L views to see the $333K appear.');
  } else {
    console.log(`❌ I WAS RIGHT. ${summaryData[0].found}/30 found but 0/30 have valid payouts.`);
    console.log('');
    console.log('The data genuinely doesn\'t exist in market_resolutions_final.');
    console.log('Need to fetch from external APIs or accept that markets aren\'t resolved.');
  }
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
