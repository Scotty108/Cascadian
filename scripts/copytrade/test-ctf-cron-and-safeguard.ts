/**
 * Test CTF token mapping cron and safeguard
 *
 * Tests:
 * 1. checkMappingCoverage for the calibration wallet
 * 2. checkGlobalMappingCoverage for recent trades
 * 3. Simulates what the cron endpoint would do
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import {
  checkMappingCoverage,
  checkGlobalMappingCoverage,
  assertMappingCoverage,
} from '@/lib/pnl/checkMappingCoverage';
import { keccak256, encodePacked } from 'viem';

const CALIBRATION_WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

// From the cron endpoint
function computeTokenId(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  const packed = encodePacked(['bytes32', 'uint256'], [condId as `0x${string}`, BigInt(outcomeIndex)]);
  const hash = keccak256(packed);
  return BigInt(hash).toString();
}

async function main() {
  console.log('='.repeat(80));
  console.log('TEST: CTF TOKEN MAPPING CRON & SAFEGUARD');
  console.log('='.repeat(80));

  // Test 1: Check calibration wallet coverage
  console.log('\n📊 Test 1: Wallet Coverage Check');
  console.log('-'.repeat(40));

  const walletCoverage = await checkMappingCoverage(CALIBRATION_WALLET, {
    includeUnmappedSamples: true,
  });
  console.log(`Wallet: ${walletCoverage.wallet}`);
  console.log(`Total tokens: ${walletCoverage.totalTokens}`);
  console.log(`Mapped: ${walletCoverage.mappedTokens}`);
  console.log(`Unmapped: ${walletCoverage.unmappedTokens}`);
  console.log(`Coverage: ${walletCoverage.coveragePct}%`);
  console.log(`Reliable: ${walletCoverage.reliable}`);
  if (walletCoverage.unmappedTokenSamples && walletCoverage.unmappedTokenSamples.length > 0) {
    console.log(`Unmapped samples: ${walletCoverage.unmappedTokenSamples.join(', ')}`);
  }

  // Test 2: Check global coverage
  console.log('\n📊 Test 2: Global Coverage Check (14 days)');
  console.log('-'.repeat(40));

  const globalCoverage = await checkGlobalMappingCoverage(14);
  console.log(`Total tokens (14d): ${globalCoverage.totalTokens.toLocaleString()}`);
  console.log(`Mapped (V5): ${globalCoverage.mappedV5.toLocaleString()}`);
  console.log(`Mapped (Patch): ${globalCoverage.mappedPatch.toLocaleString()}`);
  console.log(`Mapped (Combined): ${globalCoverage.mappedCombined.toLocaleString()}`);
  console.log(`Unmapped: ${globalCoverage.unmapped.toLocaleString()}`);
  console.log(`Coverage: ${globalCoverage.coveragePct}%`);

  // Test 3: Assert throws on low coverage
  console.log('\n📊 Test 3: Assert Throws on Low Coverage');
  console.log('-'.repeat(40));

  try {
    await assertMappingCoverage(CALIBRATION_WALLET);
    console.log('✅ Wallet has sufficient coverage');
  } catch (err) {
    console.log('⚠️ Expected error (coverage too low):');
    console.log(`   ${(err as Error).message.slice(0, 100)}...`);
  }

  // Test 4: Simulate cron - find unmapped conditions
  console.log('\n📊 Test 4: Simulate Cron - Find Unmapped Conditions');
  console.log('-'.repeat(40));

  // Note: ClickHouse LEFT JOIN returns '' not NULL for unmatched rows
  const unmappedQ = `
    WITH ctf_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND condition_id != ''
        AND lower(user_address) = '${CALIBRATION_WALLET}'
    ),
    v5_conditions AS (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_map_v5
    ),
    patch_conditions AS (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_patch
    )
    SELECT c.condition_id AS condition_id
    FROM ctf_conditions c
    LEFT JOIN v5_conditions v5 ON c.condition_id = v5.condition_id
    LEFT JOIN patch_conditions p ON c.condition_id = p.condition_id
    WHERE (v5.condition_id IS NULL OR v5.condition_id = '')
      AND (p.condition_id IS NULL OR p.condition_id = '')
    LIMIT 5
  `;

  const unmappedR = await clickhouse.query({ query: unmappedQ, format: 'JSONEachRow' });
  const unmappedRows = (await unmappedR.json()) as { condition_id: string }[];

  console.log(`Unmapped conditions for wallet: ${unmappedRows.length}`);

  if (unmappedRows.length > 0) {
    console.log('\nDeriving token_ids using keccak256...');
    for (const row of unmappedRows.slice(0, 3)) {
      if (!row.condition_id) continue;
      const condId = row.condition_id;
      const token0 = computeTokenId(condId, 0);
      const token1 = computeTokenId(condId, 1);

      console.log(`\nCondition: ${condId.slice(0, 16)}...`);
      console.log(`  Token 0: ${token0.slice(0, 20)}...`);
      console.log(`  Token 1: ${token1.slice(0, 20)}...`);

      // Check if these tokens exist in CLOB
      const checkQ = `
        SELECT count() as cnt
        FROM pm_trader_events_v2
        WHERE token_id IN ('${token0}', '${token1}')
          AND is_deleted = 0
      `;
      const checkR = await clickhouse.query({ query: checkQ, format: 'JSONEachRow' });
      const checkRows = (await checkR.json()) as { cnt: number }[];
      console.log(`  CLOB trades with these tokens: ${checkRows[0]?.cnt || 0}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));

  // Summary
  console.log('\n📋 Summary:');
  console.log(`   Wallet coverage: ${walletCoverage.coveragePct}% (${walletCoverage.reliable ? '✅' : '⚠️'})`);
  console.log(`   Global coverage (14d): ${globalCoverage.coveragePct}%`);
  console.log(`   Unmapped conditions for wallet: ${unmappedRows.length}`);

  if (!walletCoverage.reliable) {
    console.log('\n⚠️ ACTION NEEDED: Run the CTF cron to map these tokens:');
    console.log('   curl -X POST http://localhost:3000/api/cron/backfill-ctf-token-map');
  }
}

main().catch(console.error);
