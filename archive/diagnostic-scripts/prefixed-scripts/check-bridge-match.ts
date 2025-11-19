/**
 * CHECK BRIDGE MATCH
 *
 * Purpose: Check if our decoded condition_ids exist in ctf_to_market_bridge_mat
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('BRIDGE MATCH VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Use the 5 condition_ids we decoded earlier
  const testConditionIds = [
    '00029c52d867b6de3389caaa75da422c484dfaeb16c56d50eb02bbf7ffabb193',
    '009f37e89c66465d7680ef60341a76ba553bb08437df158e7046b48618c4a822',
    '0025b007710895f83b03f3726b951ac8e383c709d51d623ae531e46119bd4c13',
    '00357a089afabe5dc62bab131332a28bfcc3dc73b23d547643386e77aeab36f4',
    '0004eb7841564beb8a9fef181174d9a984bc3511874b7f4233cbf2becae4fc6c'
  ];

  let found = 0;
  let notFound = 0;

  for (const condId of testConditionIds) {
    console.log(`\nChecking condition_id: ${condId}`);

    // Check in bridge
    const bridgeQuery = await clickhouse.query({
      query: `
        SELECT
          ctf_hex64,
          market_hex64,
          vote_count
        FROM ctf_to_market_bridge_mat
        WHERE ctf_hex64 = '${condId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const bridge: any[] = await bridgeQuery.json();

    if (bridge.length > 0) {
      console.log(`  ✅ FOUND in bridge!`);
      console.log(`    Market ID: ${bridge[0].market_hex64}`);
      console.log(`    Vote Count: ${bridge[0].vote_count}`);
      found++;

      // Now check if this market has a resolution
      const resQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            payout_numerators
          FROM market_resolutions_final
          WHERE condition_id_norm = '${condId}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const res: any[] = await resQuery.json();
      if (res.length > 0) {
        console.log(`    ✅✅ RESOLUTION FOUND!`);
        console.log(`      Winning Index: ${res[0].winning_index}`);
        console.log(`      Payout: ${JSON.stringify(res[0].payout_numerators)}`);
      } else {
        console.log(`    ❌ Resolution NOT found`);
      }
    } else {
      console.log(`  ❌ NOT found in bridge`);
      notFound++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Found in bridge: ${found}/${testConditionIds.length}`);
  console.log(`Not found: ${notFound}/${testConditionIds.length}`);
  console.log(`Success rate: ${(found / testConditionIds.length * 100).toFixed(0)}%\n`);

  if (notFound > 0) {
    console.log('⚠️  Some condition_ids not in bridge');
    console.log('This could mean:');
    console.log('  1. These markets are too new (bridge not yet populated)');
    console.log('  2. The asset_id decode is incorrect');
    console.log('  3. These are test/invalid markets\n');
  }

  console.log('✅ VERIFICATION COMPLETE\n');
}

main().catch(console.error);
