/**
 * 05: DIAGNOSE RESOLUTION JOIN
 *
 * Check why resolution data isn't joining to fixture positions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('05: DIAGNOSE RESOLUTION JOIN');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load fixture to get condition_ids
  const fixture = JSON.parse(fs.readFileSync('fixture.json', 'utf-8'));
  const conditionIds = [...new Set(fixture.map((p: any) => p.condition_id_norm))];

  console.log(`Checking ${conditionIds.length} unique condition_ids from fixture...\n`);

  // Check if these condition_ids exist in market_resolutions_norm
  for (let i = 0; i < Math.min(5, conditionIds.length); i++) {
    const cid = conditionIds[i];

    console.log(`Condition ID ${i + 1}: ${cid}`);
    console.log(`  Length: ${cid.length} chars\n`);

    const query = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          payout_numerators,
          payout_denominator,
          resolved_at
        FROM market_resolutions_norm
        WHERE condition_id_norm = '${cid}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const results: any[] = await query.json();

    if (results.length === 0) {
      console.log(`  ❌ NOT FOUND in market_resolutions_norm\n`);

      // Check if it exists with different format
      const query2 = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            length(condition_id_norm) AS len
          FROM market_resolutions_final
          WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${cid}'
             OR replaceAll(condition_id_norm, '0x', '') = '${cid}'
             OR condition_id_norm = '${cid}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const results2: any[] = await query2.json();

      if (results2.length > 0) {
        console.log(`  ⚠️  FOUND in market_resolutions_final with format:`);
        console.log(`     condition_id_norm: "${results2[0].condition_id_norm}"`);
        console.log(`     Length: ${results2[0].len} chars\n`);
      } else {
        console.log(`  ❌ Also NOT FOUND in market_resolutions_final\n`);
      }
    } else {
      console.log(`  ✅ FOUND in market_resolutions_norm:`);
      console.log(`     winning_index: ${results[0].winning_index}`);
      console.log(`     payout_numerators: ${results[0].payout_numerators}`);
      console.log(`     resolved_at: ${results[0].resolved_at}\n`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Checking ctf_token_map_norm for same asset...\n');

  const winningAsset = fixture.find((p: any) => p.status === 'WON');

  if (winningAsset) {
    console.log(`Winning asset_id: ${winningAsset.asset_id}\n`);

    const query = await clickhouse.query({
      query: `
        SELECT
          asset_id,
          condition_id_norm,
          length(condition_id_norm) AS cid_len,
          outcome_index
        FROM ctf_token_map_norm
        WHERE asset_id = '${winningAsset.asset_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const results: any[] = await query.json();

    if (results.length > 0) {
      console.log(`  ✅ Found in ctf_token_map_norm:`);
      console.log(`     condition_id_norm: "${results[0].condition_id_norm}"`);
      console.log(`     Length: ${results[0].cid_len} chars`);
      console.log(`     outcome_index: ${results[0].outcome_index}\n`);
    }
  }

  console.log('✅ DIAGNOSIS COMPLETE\n');
}

main().catch(console.error);
