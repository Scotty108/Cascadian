#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.4: Test Token Decode on Sample Data
 *
 * Tests token_id and asset_id decoding on 1000-row samples to validate
 * the decode logic before applying to 157M trades.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

interface DecodeTestResult {
  source: 'erc1155' | 'clob';
  total_sampled: number;
  decode_success: number;
  decode_failures: number;
  sample_rows: any[];
  anomalies: string[];
}

async function testERC1155Decode(): Promise<DecodeTestResult> {
  console.log('🧪 Testing ERC1155 token_id decode...');
  console.log('-'.repeat(80));

  const result: DecodeTestResult = {
    source: 'erc1155',
    total_sampled: 0,
    decode_success: 0,
    decode_failures: 0,
    sample_rows: [],
    anomalies: []
  };

  try {
    const query = `
      SELECT
        tx_hash,
        token_id,
        to_address,
        block_timestamp,

        -- Decode condition_id from token_id (first 254 bits -> 64 hex chars)
        lpad(
          hex(
            bitShiftRight(
              reinterpretAsUInt256(unhex(substring(token_id, 3))),  -- Remove 0x prefix
              2
            )
          ),
          64,
          '0'
        ) AS condition_id_decoded,

        -- Decode outcome_index from lower 2 bits
        multiIf(
          bitAnd(
            reinterpretAsUInt256(unhex(substring(token_id, 3))),
            3
          ) = 1, 0,
          bitAnd(
            reinterpretAsUInt256(unhex(substring(token_id, 3))),
            3
          ) = 2, 1,
          -1  -- Invalid
        ) AS outcome_index_decoded

      FROM erc1155_transfers
      WHERE token_id IS NOT NULL AND token_id != ''
      ORDER BY rand()
      LIMIT 1000
    `;

    const queryResult = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await queryResult.json() as any[];

    result.total_sampled = rows.length;
    result.sample_rows = rows.slice(0, 10);  // Keep first 10 for inspection

    // Analyze results
    for (const row of rows) {
      if (row.condition_id_decoded && row.condition_id_decoded.length === 64) {
        result.decode_success++;
      } else {
        result.decode_failures++;
        result.anomalies.push(`Invalid condition_id length: ${row.condition_id_decoded?.length} for tx ${row.tx_hash}`);
      }

      if (row.outcome_index_decoded !== 0 && row.outcome_index_decoded !== 1) {
        result.anomalies.push(`Invalid outcome_index: ${row.outcome_index_decoded} for tx ${row.tx_hash}`);
      }
    }

    console.log(`✓ Sampled: ${result.total_sampled} rows`);
    console.log(`✓ Decode success: ${result.decode_success} (${(result.decode_success / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`✗ Decode failures: ${result.decode_failures}`);
    console.log(`⚠️  Anomalies found: ${result.anomalies.length}`);

  } catch (error: any) {
    console.error('❌ Error testing ERC1155 decode:', error.message);
    result.anomalies.push(`Query error: ${error.message}`);
  }

  return result;
}

async function testCLOBDecode(): Promise<DecodeTestResult> {
  console.log('');
  console.log('🧪 Testing CLOB asset_id decode...');
  console.log('-'.repeat(80));

  const result: DecodeTestResult = {
    source: 'clob',
    total_sampled: 0,
    decode_success: 0,
    decode_failures: 0,
    sample_rows: [],
    anomalies: []
  };

  try {
    const query = `
      SELECT
        fill_id,
        asset_id,
        condition_id AS condition_id_original,
        user_eoa,
        timestamp,

        -- Decode condition_id from asset_id (decimal string -> bigint -> decode)
        lpad(
          hex(
            bitShiftRight(
              CAST(asset_id AS UInt256),
              2
            )
          ),
          64,
          '0'
        ) AS condition_id_decoded,

        -- Decode outcome_index from lower 2 bits
        multiIf(
          bitAnd(CAST(asset_id AS UInt256), 3) = 1, 0,
          bitAnd(CAST(asset_id AS UInt256), 3) = 2, 1,
          -1  -- Invalid
        ) AS outcome_index_decoded,

        -- For cross-validation: normalize original condition_id
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_original_norm

      FROM clob_fills
      WHERE asset_id IS NOT NULL AND asset_id != ''
      ORDER BY rand()
      LIMIT 1000
    `;

    const queryResult = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await queryResult.json() as any[];

    result.total_sampled = rows.length;
    result.sample_rows = rows.slice(0, 10);  // Keep first 10 for inspection

    // Analyze results
    let cross_validation_matches = 0;
    let cross_validation_mismatches = 0;

    for (const row of rows) {
      if (row.condition_id_decoded && row.condition_id_decoded.length === 64) {
        result.decode_success++;

        // Cross-validate decoded vs original
        if (row.condition_id_original_norm) {
          if (row.condition_id_decoded === row.condition_id_original_norm) {
            cross_validation_matches++;
          } else {
            cross_validation_mismatches++;
            if (cross_validation_mismatches <= 5) {  // Only log first 5 mismatches
              result.anomalies.push(`Mismatch: decoded=${row.condition_id_decoded.substring(0, 16)}... vs original=${row.condition_id_original_norm.substring(0, 16)}...`);
            }
          }
        }
      } else {
        result.decode_failures++;
        result.anomalies.push(`Invalid condition_id length: ${row.condition_id_decoded?.length} for fill ${row.fill_id}`);
      }

      if (row.outcome_index_decoded !== 0 && row.outcome_index_decoded !== 1) {
        result.anomalies.push(`Invalid outcome_index: ${row.outcome_index_decoded} for fill ${row.fill_id}`);
      }
    }

    console.log(`✓ Sampled: ${result.total_sampled} rows`);
    console.log(`✓ Decode success: ${result.decode_success} (${(result.decode_success / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`✗ Decode failures: ${result.decode_failures}`);
    console.log(`✓ Cross-validation matches: ${cross_validation_matches}`);
    console.log(`✗ Cross-validation mismatches: ${cross_validation_mismatches}`);
    console.log(`⚠️  Anomalies found: ${result.anomalies.length}`);

  } catch (error: any) {
    console.error('❌ Error testing CLOB decode:', error.message);
    result.anomalies.push(`Query error: ${error.message}`);
  }

  return result;
}

async function main() {
  console.log('🔬 Phase 1, Step 1.4: Token Decode Test');
  console.log('='.repeat(80));
  console.log('Testing token_id and asset_id decoding on 1000-row samples');
  console.log('');

  // Test ERC1155
  const erc1155Result = await testERC1155Decode();

  // Test CLOB
  const clobResult = await testCLOBDecode();

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  const erc1155Path = `reports/TOKEN_DECODE_TEST_erc1155_${timestamp}.json`;
  fs.writeFileSync(erc1155Path, JSON.stringify(erc1155Result, null, 2));
  console.log('');
  console.log(`✅ ERC1155 results saved to: ${erc1155Path}`);

  const clobPath = `reports/TOKEN_DECODE_TEST_clob_${timestamp}.json`;
  fs.writeFileSync(clobPath, JSON.stringify(clobResult, null, 2));
  console.log(`✅ CLOB results saved to: ${clobPath}`);

  // Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('📊 Test Summary');
  console.log('='.repeat(80));
  console.log('');
  console.log('ERC1155 Decode:');
  console.log(`  Success rate: ${(erc1155Result.decode_success / erc1155Result.total_sampled * 100).toFixed(2)}%`);
  console.log(`  Anomalies: ${erc1155Result.anomalies.length}`);
  console.log('');
  console.log('CLOB Decode:');
  console.log(`  Success rate: ${(clobResult.decode_success / clobResult.total_sampled * 100).toFixed(2)}%`);
  console.log(`  Anomalies: ${clobResult.anomalies.length}`);
  console.log('');

  // Overall verdict
  const overallSuccess = erc1155Result.decode_success + clobResult.decode_success;
  const overallTotal = erc1155Result.total_sampled + clobResult.total_sampled;
  const overallRate = (overallSuccess / overallTotal * 100).toFixed(2);

  if (parseFloat(overallRate) > 95) {
    console.log(`✅ PASS: Overall decode success rate ${overallRate}% > 95%`);
    console.log('   Decode logic is ready for production use.');
  } else {
    console.log(`⚠️  WARNING: Overall decode success rate ${overallRate}% < 95%`);
    console.log('   Review anomalies before proceeding to full repair.');
  }
}

main().catch(console.error);
