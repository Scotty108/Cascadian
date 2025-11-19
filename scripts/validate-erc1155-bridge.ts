#!/usr/bin/env tsx
/**
 * ERC-1155 Token Bridge Validation
 *
 * Purpose: Test join success rate between erc1155_transfers (HEX) and ctf_token_map (DECIMAL)
 *
 * Background:
 * - Current join success rate: 0% (encoding mismatch)
 * - Expected after fix: 95%+ (via token conversion)
 *
 * This script validates our token conversion functions by:
 * 1. Sampling erc1155_transfers with HEX token IDs
 * 2. Converting HEX → DECIMAL using our functions
 * 3. Checking if converted values exist in ctf_token_map
 * 4. Reporting match rate and identifying failures
 *
 * Target: 95%+ match rate
 *
 * From PM_CANONICAL_SCHEMA_C1.md:
 * - erc1155_transfers: 61.4M rows (HEX format: "0x + 64 chars")
 * - ctf_token_map: 139K+ token mappings (DECIMAL format: 77-78 chars)
 * - Conversion: reverse byte order for big-endian ↔ little-endian
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { hexToDecimal, normalizeTokenId } from '../lib/polymarket/token-conversion.js';

interface ERC1155Sample {
  token_id: string;
  tx_hash: string;
  block_number: string;
  value: string;
}

interface TokenMapping {
  token_id: string;
  condition_id_norm: string;
  question: string;
  outcome: string;
}

interface ValidationResult {
  total_sampled: number;
  successful_matches: number;
  failed_matches: number;
  match_rate: number;
  failures: Array<{
    token_id_hex: string;
    token_id_decimal: string;
    tx_hash: string;
    block_number: string;
  }>;
}

async function main() {
  console.log('🔍 ERC-1155 Token Bridge Validation');
  console.log('=' .repeat(60));
  console.log('');

  // Step 1: Get sample of ERC-1155 transfers
  console.log('Step 1: Sampling erc1155_transfers...');
  const sampleSize = 1000;

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        tx_hash,
        toString(block_number) as block_number,
        value
      FROM erc1155_transfers
      WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND token_id != ''
      ORDER BY block_number DESC
      LIMIT ${sampleSize}
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json<ERC1155Sample>();
  console.log(`✅ Sampled ${samples.length} transfers`);
  console.log('');

  // Step 2: Get all token mappings from ctf_token_map
  console.log('Step 2: Loading ctf_token_map tokens...');

  const tokenQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        condition_id_norm,
        question,
        outcome
      FROM ctf_token_map
      WHERE token_id != ''
    `,
    format: 'JSONEachRow'
  });

  const tokenMappings = await tokenQuery.json<TokenMapping>();
  console.log(`✅ Loaded ${tokenMappings.length} token mappings`);

  // Build token lookup set
  const tokenSet = new Set<string>();

  for (const mapping of tokenMappings) {
    tokenSet.add(mapping.token_id);
  }

  console.log(`✅ Built lookup set with ${tokenSet.size} unique tokens`);
  console.log('');

  // Step 3: Convert and validate
  console.log('Step 3: Converting HEX → DECIMAL and validating...');
  console.log('');

  const failures: ValidationResult['failures'] = [];
  let successCount = 0;
  let conversionErrors = 0;

  for (const sample of samples) {
    try {
      // Convert HEX to DECIMAL using our function
      const decimalTokenId = hexToDecimal(sample.token_id);

      // Check if it exists in gamma_markets
      if (tokenSet.has(decimalTokenId)) {
        successCount++;
      } else {
        failures.push({
          token_id_hex: sample.token_id,
          token_id_decimal: decimalTokenId,
          tx_hash: sample.tx_hash,
          block_number: sample.block_number,
        });
      }
    } catch (error) {
      conversionErrors++;
      console.error(`❌ Conversion error for ${sample.token_id}:`, error);
    }
  }

  // Step 4: Report results
  console.log('');
  console.log('=' .repeat(60));
  console.log('📊 VALIDATION RESULTS');
  console.log('=' .repeat(60));
  console.log('');

  const matchRate = (successCount / samples.length) * 100;
  const result: ValidationResult = {
    total_sampled: samples.length,
    successful_matches: successCount,
    failed_matches: failures.length,
    match_rate: matchRate,
    failures: failures.slice(0, 10), // Only show first 10 failures
  };

  console.log(`Total Sampled:        ${result.total_sampled}`);
  console.log(`Successful Matches:   ${result.successful_matches} ✅`);
  console.log(`Failed Matches:       ${result.failed_matches} ❌`);
  console.log(`Conversion Errors:    ${conversionErrors}`);
  console.log('');
  console.log(`Match Rate:           ${matchRate.toFixed(2)}%`);
  console.log('');

  // Determine if we met target
  const target = 95.0;
  if (matchRate >= target) {
    console.log(`🎉 SUCCESS! Match rate ${matchRate.toFixed(2)}% exceeds target ${target}%`);
  } else {
    console.log(`⚠️  BELOW TARGET: Match rate ${matchRate.toFixed(2)}% is below ${target}%`);
  }
  console.log('');

  // Show sample failures
  if (failures.length > 0) {
    console.log('Sample Failures (first 10):');
    console.log('-'.repeat(60));

    for (const failure of result.failures) {
      console.log('');
      console.log(`HEX:     ${failure.token_id_hex}`);
      console.log(`DECIMAL: ${failure.token_id_decimal}`);
      console.log(`TX:      ${failure.tx_hash}`);
      console.log(`Block:   ${failure.block_number}`);
    }

    if (failures.length > 10) {
      console.log('');
      console.log(`... and ${failures.length - 10} more failures`);
    }
  }

  console.log('');
  console.log('=' .repeat(60));
  console.log('');

  // Additional analysis: Check if failures are from specific markets
  if (failures.length > 0 && failures.length < 100) {
    console.log('🔬 Analyzing failure patterns...');
    console.log('');

    // Try to find if any failures match using direct hex comparison
    const directMatches = await checkDirectHexMatches(failures.slice(0, 10));
    if (directMatches > 0) {
      console.log(`ℹ️  Found ${directMatches} matches using direct hex comparison`);
      console.log('   This suggests the conversion formula may need adjustment');
    }
  }

  console.log('✅ Validation complete!');
  console.log('');
}

/**
 * Check if failures might match using alternative conversion methods
 */
async function checkDirectHexMatches(failures: ValidationResult['failures'][]): Promise<number> {
  // This would test alternative conversion methods if needed
  // For now, just return 0
  return 0;
}

main().catch((error) => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});
