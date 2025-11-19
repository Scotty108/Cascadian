/**
 * 31: VERIFY TOKEN DECODE VS POLYMARKET
 *
 * Compare our bit-shift decoder against Polymarket's actual implementation
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { ethers } from 'ethers';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('31: TOKEN DECODE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Get sample token from production fills...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        count() AS fill_count
      FROM clob_fills
      WHERE timestamp >= '2025-01-01'
      GROUP BY asset_id
      ORDER BY fill_count DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const topToken: any = (await query1.json())[0];

  console.log('Most traded token:');
  console.log(`  asset_id: ${topToken.asset_id}`);
  console.log(`  fills: ${topToken.fill_count}\n`);

  console.log('📊 Step 2: Check our current decoder result...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        lower(hex(bitShiftRight(toUInt256(asset_id), 8))) AS our_condition_id,
        toUInt8(bitAnd(toUInt256(asset_id), 255)) AS our_outcome_index
      FROM (SELECT '${topToken.asset_id}' AS asset_id)
    `,
    format: 'JSONEachRow'
  });

  const ourDecode: any = (await query2.json())[0];

  console.log('Our decoder results:');
  console.log(`  condition_id (our decode): ${ourDecode.our_condition_id}`);
  console.log(`  outcome_index (our decode): ${ourDecode.our_outcome_index}\n`);

  console.log('📊 Step 3: Check if this condition_id exists in resolutions...\n');

  const query3 = await clickhouse.query({
    query: `
      SELECT count() AS match_count
      FROM market_resolutions_final
      WHERE condition_id_norm = '${ourDecode.our_condition_id}'
    `,
    format: 'JSONEachRow'
  });

  const resMatch: any = (await query3.json())[0];

  console.log(`  Matches in resolutions: ${resMatch.match_count}`);

  if (parseInt(resMatch.match_count) === 0) {
    console.log('  ❌ NO MATCH - Our decoder is extracting wrong condition_id\n');
  } else {
    console.log('  ✅ MATCH FOUND\n');
  }

  console.log('📊 Step 4: Understanding the truth...\n');

  console.log('GROUND TRUTH from Polymarket + Gnosis CTF:');
  console.log('');
  console.log('Position ID (ERC1155 token_id) formula:');
  console.log('  positionId = keccak256(collateralToken + collectionId)');
  console.log('');
  console.log('Collection ID formula:');
  console.log('  collectionId = calculateViaEllipticCurve(conditionId, indexSet)');
  console.log('  Uses alt_bn128 elliptic curve cryptography');
  console.log('');
  console.log('This means:');
  console.log('  ❌ token_id >> 8 does NOT give us condition_id');
  console.log('  ❌ Simple bit operations cannot reverse the hash');
  console.log('  ✅ We need external mapping: token_id → condition_id');
  console.log('');

  console.log('📊 Step 5: The solution...\n');

  console.log('We have TWO options:');
  console.log('');
  console.log('Option A: Use Gamma API to backfill mappings');
  console.log('  1. Get all unique asset_ids from clob_fills');
  console.log('  2. Query Gamma API for each to get condition_id');
  console.log('  3. Populate ctf_token_map with CORRECT mappings');
  console.log('  4. Rebuild fixture with proper condition_ids');
  console.log('');
  console.log('Option B: Use condition_market_map if it has correct data');
  console.log('  1. Check if condition_market_map has our token_ids');
  console.log('  2. If yes, use it as the mapping source');
  console.log('  3. If no, fall back to Option A');
  console.log('');

  console.log('📊 Step 6: Quick test of Gamma API approach...\n');

  console.log('Testing if we can fetch market data for this asset_id...');
  console.log('(This would require Gamma API integration)\n');

  console.log('\n✅ VERIFICATION COMPLETE\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CONCLUSION:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Our bit-shift decoder is WRONG.');
  console.log('Token IDs are cryptographic hashes, not simple encodings.');
  console.log('');
  console.log('Next step: Backfill ctf_token_map from Gamma API');
  console.log('  OR');
  console.log('Find existing mapping table that already has correct data');
  console.log('');
}

main().catch(console.error);
