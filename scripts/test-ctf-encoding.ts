#!/usr/bin/env tsx
/**
 * Test CTF Encoding Hypothesis
 *
 * Validate that we can compute ERC-1155 token IDs from condition_id + index_set
 * using the Conditional Token Framework (CTF) encoding
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { ethers } from 'ethers';

/**
 * Compute ERC-1155 token ID using CTF encoding
 *
 * Formula: keccak256(abi.encodePacked(conditionId, indexSet))
 */
function computeTokenId(conditionId: string, indexSet: number): string {
  // Normalize condition_id: remove 0x, pad to 64 chars
  const conditionIdHex = conditionId.replace('0x', '').padStart(64, '0');

  // Convert index_set to 32 bytes (256 bits)
  const indexSetHex = indexSet.toString(16).padStart(64, '0');

  // Concatenate: conditionId (32 bytes) + indexSet (32 bytes)
  const packed = '0x' + conditionIdHex + indexSetHex;

  // Hash with keccak256
  const tokenId = ethers.keccak256(packed);

  // Return normalized (no 0x, lowercase)
  return tokenId.replace('0x', '').toLowerCase();
}

async function main() {
  console.log('🧪 Testing CTF Encoding Hypothesis');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Get a sample condition with known outcomes
  console.log('Step 1: Getting sample conditions from ctf_token_map...');

  const conditionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm as condition_id,
        question,
        outcomes_json,
        COUNT(*) as token_count
      FROM ctf_token_map
      WHERE condition_id_norm != ''
        AND outcomes_json != ''
      GROUP BY condition_id_norm, question, outcomes_json
      ORDER BY token_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const conditions = await conditionsQuery.json<{
    condition_id: string;
    question: string;
    outcomes_json: string;
    token_count: string;
  }>();

  console.log(`✅ Found ${conditions.length} sample conditions\n`);

  // Step 2: For each condition, generate token IDs and test against erc1155_transfers
  console.log('Step 2: Generating token IDs and testing matches...\n');

  let totalGenerated = 0;
  let totalMatched = 0;

  for (const condition of conditions.slice(0, 5)) {  // Test first 5 conditions
    console.log(`\nCondition: ${condition.condition_id}`);
    console.log(`Question: ${condition.question}`);

    // Parse outcomes
    let outcomes: string[];
    try {
      outcomes = JSON.parse(condition.outcomes_json);
    } catch (e) {
      console.log('  ❌ Failed to parse outcomes_json');
      continue;
    }

    console.log(`Outcomes: ${outcomes.join(', ')} (${outcomes.length} outcomes)`);
    console.log('');

    // Generate token IDs for each outcome
    for (let i = 0; i < outcomes.length; i++) {
      const indexSet = 1 << i;  // 0x01, 0x02, 0x04, 0x08, ...
      const computedTokenId = computeTokenId(condition.condition_id, indexSet);

      totalGenerated++;

      console.log(`  Outcome ${i} (${outcomes[i]}):`);
      console.log(`    index_set: 0x${indexSet.toString(16).padStart(2, '0')}`);
      console.log(`    computed token_id: ${computedTokenId}`);

      // Check if this token exists in erc1155_transfers
      const checkQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as cnt
          FROM erc1155_transfers
          WHERE lower(replaceAll(token_id, '0x', '')) = '${computedTokenId}'
        `,
        format: 'JSONEachRow'
      });

      const result = await checkQuery.json<{cnt: string}>();
      const count = parseInt(result[0].cnt);

      if (count > 0) {
        console.log(`    ✅ MATCH! Found ${count} transfers`);
        totalMatched++;
      } else {
        console.log(`    ❌ NO MATCH`);
      }
    }
  }

  // Step 3: Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Total tokens generated: ${totalGenerated}`);
  console.log(`Total tokens matched:   ${totalMatched}`);
  console.log(`Match rate:             ${((totalMatched / totalGenerated) * 100).toFixed(2)}%`);
  console.log('');

  if (totalMatched / totalGenerated >= 0.9) {
    console.log('🎉 SUCCESS! CTF encoding hypothesis CONFIRMED (≥90% match rate)');
    console.log('   The standard CTF formula works for Polymarket data.');
  } else if (totalMatched > 0) {
    console.log('⚠️  PARTIAL SUCCESS: Some matches found, but not all.');
    console.log('   May need to investigate index_set encoding or edge cases.');
  } else {
    console.log('❌ FAILURE: No matches found.');
    console.log('   CTF encoding may be different than standard, or data mismatch.');
  }

  console.log('');
  console.log('✅ Test complete!');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
