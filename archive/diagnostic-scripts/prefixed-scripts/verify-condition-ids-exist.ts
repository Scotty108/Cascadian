/**
 * VERIFY CONDITION IDS EXIST
 *
 * Check if our decoded condition_ids actually exist in market_resolutions_final
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('VERIFY CONDITION IDS EXIST');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test condition_ids from fixture
  const testConditions = [
    '00d03f68a6adf946e9996f1b14e2076e71f1e0e8eb8f49f24bf6c2c00b',
    '00dff5797f3690250cf104f651fa58f3a20db9bab2e3ac13d0ab73bb2d',
    '0053bff3cc2b20d20aaa0aaec6fc0d7330b2cbd5bee8ec6b29d2b3ae08',
    '004faf3ffdc606ab18285b5f12076e2fa9e04c653f12d0af862c53697f',
    '0004eb7841564beb8a9fef181174d9a984bc3511874b7f4233cbf2becae4fc6c'
  ];

  console.log('📊 Checking if condition_ids exist (exact match)...\n');

  let found = 0;
  for (const cid of testConditions) {
    const query = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          outcome_count,
          payout_numerators,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm = '${cid}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await query.json();

    if (res.length > 0) {
      console.log(`✅ ${cid.substring(0, 30)}... FOUND`);
      console.log(`   Winner: ${res[0].winning_index}`);
      console.log(`   Outcomes: ${res[0].outcome_count}`);
      console.log(`   Payouts: ${JSON.stringify(res[0].payout_numerators)}`);
      console.log(`   Resolved: ${res[0].resolved_at}\n`);
      found++;
    } else {
      console.log(`❌ ${cid.substring(0, 30)}... NOT FOUND\n`);
    }
  }

  console.log(`Found: ${found}/${testConditions.length}\n`);

  // Check what resolutions DO exist for this wallet
  console.log('📊 Finding ANY resolutions for this wallet...\n');

  const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const walletQuery = await clickhouse.query({
    query: `
      SELECT
        f.asset_id,
        lpad(lower(hex(bitShiftRight(toUInt256(f.asset_id), 8))), 64, '0') as condition_id_norm,
        toUInt8(bitAnd(toUInt256(f.asset_id), 255)) as outcome_index,
        r.winning_index,
        r.outcome_count,
        r.payout_numerators
      FROM clob_fills f
      INNER JOIN market_resolutions_final r
        ON lpad(lower(hex(bitShiftRight(toUInt256(f.asset_id), 8))), 64, '0') = r.condition_id_norm
      WHERE f.proxy_wallet = '${TARGET_WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const walletRes: any[] = await walletQuery.json();

  if (walletRes.length > 0) {
    console.log(`✅ Found ${walletRes.length} resolved positions for this wallet!\n`);

    for (const r of walletRes) {
      console.log(`Condition: ${r.condition_id_norm.substring(0, 30)}...`);
      console.log(`  Outcome Index: ${r.outcome_index}`);
      console.log(`  Winning Index: ${r.winning_index}`);
      console.log(`  Outcome Count: ${r.outcome_count}`);
      console.log(`  Payouts: ${JSON.stringify(r.payout_numerators)}\n`);
    }
  } else {
    console.log('❌ NO resolved positions found for this wallet\n');
    console.log('This means either:');
    console.log('  1. All of this wallet\'s positions are still open');
    console.log('  2. The condition_id decode is still wrong');
    console.log('  3. Resolution data is incomplete\n');
  }

  // Sample some actual resolutions to verify format
  console.log('📊 Sample resolutions from market_resolutions_final:\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        outcome_count,
        payout_numerators
      FROM market_resolutions_final
      WHERE outcome_count = 2  -- Binary markets only
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  for (const s of samples) {
    console.log(`Condition: ${s.condition_id_norm}`);
    console.log(`  Winner: ${s.winning_index}`);
    console.log(`  Outcomes: ${s.outcome_count}`);
    console.log(`  Payouts: ${JSON.stringify(s.payout_numerators)}\n`);
  }

  console.log('✅ VERIFICATION COMPLETE\n');
}

main().catch(console.error);
