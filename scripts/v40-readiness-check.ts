/**
 * V40 Readiness Verification Script
 *
 * Before implementing V40, verify that we have:
 * 1. Complete event coverage by source
 * 2. Ordering primitives (block_number, log_index)
 * 3. Token mapping coverage
 * 4. Per-wallet coverage profile
 *
 * Acceptance: Do NOT implement V40 until readiness passes for hard wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Benchmark wallets - original 15 + stratified 5
const BENCHMARK_WALLETS = [
  // Original V1 test wallets (15)
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'original', type: 'CLOB' },
  { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1', type: 'CLOB' },
  { wallet: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', name: 'maker_heavy_2', type: 'CLOB' },
  { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1', type: 'CLOB' },
  { wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', name: 'taker_heavy_2', type: 'CLOB' },
  { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', name: 'spot_2', type: 'MIXED' },
  { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', name: 'spot_4', type: 'MIXED' },
  { wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf', name: 'spot_8', type: 'MIXED' },
  { wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', name: 'mixed_1', type: 'NEGRISK' },
  { wallet: '0x969fdceba722e381776044c3b14ef1729511ad37', name: 'spot_1', type: 'NEGRISK' },
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3', type: 'NEGRISK' },
  { wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', name: 'spot_5', type: 'NEGRISK' },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6', type: 'NEGRISK' },
  { wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', name: 'spot_7', type: 'NEGRISK' },
  { wallet: '0x61341f266a614cc511d2f606542b0774688998b0', name: 'spot_9', type: 'NEGRISK' },
  // Stratified cohort (5)
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', name: 'CLOB_ONLY', type: 'CLOB' },
  { wallet: '0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86', name: 'NEGRISK_HEAVY', type: 'NEGRISK' },
  { wallet: '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba', name: 'SPLIT_HEAVY', type: 'CTF' },
  { wallet: '0x35c0732e069faea97c11aa9cab045562eaab81d6', name: 'REDEMPTION', type: 'CTF' },
  { wallet: '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d', name: 'MAKER_HEAVY', type: 'CLOB' },
];

interface WalletReadiness {
  wallet: string;
  name: string;
  type: string;
  // Event counts
  clobFills: number;
  ctfSplits: number;
  ctfMerges: number;
  ctfRedemptions: number;
  ctfConversions: number;
  erc1155Transfers: number;
  // Ordering checks
  ctfHasBlockNumber: boolean;
  ctfHasLogIndex: boolean;
  clobHasOrdering: boolean;
  // Token mapping
  uniqueTokenIds: number;
  mappedTokenIds: number;
  mappingCoverage: number;
  // Readiness
  ready: boolean;
  issues: string[];
}

async function checkWalletReadiness(wallet: string, name: string, type: string): Promise<WalletReadiness> {
  const w = wallet.toLowerCase();
  const issues: string[] = [];

  // 1. Count CLOB fills
  const clobQuery = `
    SELECT count() as cnt
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = '${w}'
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];
  const clobFills = Number(clobRows[0]?.cnt || 0);

  // 2. Count CTF events by type
  const ctfQuery = `
    SELECT
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges,
      countIf(event_type = 'PayoutRedemption') as redemptions,
      countIf(event_type = 'PositionsConverted') as conversions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];
  const ctfSplits = Number(ctfRows[0]?.splits || 0);
  const ctfMerges = Number(ctfRows[0]?.merges || 0);
  const ctfRedemptions = Number(ctfRows[0]?.redemptions || 0);
  let ctfConversions = Number(ctfRows[0]?.conversions || 0);

  // Also check dedicated neg risk conversions table
  const negRiskQuery = `
    SELECT count() as cnt
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
  `;
  const negRiskResult = await clickhouse.query({ query: negRiskQuery, format: 'JSONEachRow' });
  const negRiskRows = (await negRiskResult.json()) as any[];
  const negRiskConversions = Number(negRiskRows[0]?.cnt || 0);
  ctfConversions = Math.max(ctfConversions, negRiskConversions); // Use whichever source has more

  // 3. Count ERC1155 transfers
  const erc1155Query = `
    SELECT count() as cnt
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = '${w}' OR lower(to_address) = '${w}'
  `;
  const erc1155Result = await clickhouse.query({ query: erc1155Query, format: 'JSONEachRow' });
  const erc1155Rows = (await erc1155Result.json()) as any[];
  const erc1155Transfers = Number(erc1155Rows[0]?.cnt || 0);

  // 4. Check CTF ordering primitives (pm_ctf_events has block_number but NOT log_index)
  // We'll use pm_erc1155_transfers for log_index ordering within tx
  const ctfOrderingQuery = `
    SELECT
      countIf(block_number > 0) as has_block,
      count() as total,
      uniqExact(block_number) as unique_blocks
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
  `;
  const ctfOrderingResult = await clickhouse.query({ query: ctfOrderingQuery, format: 'JSONEachRow' });
  const ctfOrderingRows = (await ctfOrderingResult.json()) as any[];
  const ctfTotal = Number(ctfOrderingRows[0]?.total || 0);
  const ctfHasBlock = Number(ctfOrderingRows[0]?.has_block || 0);
  const ctfHasBlockNumber = ctfTotal === 0 || ctfHasBlock === ctfTotal;

  // Check if ERC1155 has log_index for this wallet (can be used for intra-block ordering)
  const erc1155OrderingQuery = `
    SELECT
      countIf(log_index >= 0) as has_log_index,
      count() as total
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = '${w}' OR lower(to_address) = '${w}'
  `;
  const erc1155OrderingResult = await clickhouse.query({ query: erc1155OrderingQuery, format: 'JSONEachRow' });
  const erc1155OrderingRows = (await erc1155OrderingResult.json()) as any[];
  const erc1155Total = Number(erc1155OrderingRows[0]?.total || 0);
  const erc1155HasLogIdx = Number(erc1155OrderingRows[0]?.has_log_index || 0);
  const ctfHasLogIndex = erc1155Total === 0 || erc1155HasLogIdx === erc1155Total;

  // 5. Check CLOB ordering
  const clobOrderingQuery = `
    SELECT
      countIf(trade_time > 0) as has_time,
      count() as total
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = '${w}'
  `;
  const clobOrderingResult = await clickhouse.query({ query: clobOrderingQuery, format: 'JSONEachRow' });
  const clobOrderingRows = (await clobOrderingResult.json()) as any[];
  const clobTotal = Number(clobOrderingRows[0]?.total || 0);
  const clobHasTime = Number(clobOrderingRows[0]?.has_time || 0);
  const clobHasOrdering = clobTotal === 0 || clobHasTime === clobTotal;

  // 6. Token mapping coverage
  const tokenMappingQuery = `
    WITH wallet_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${w}'
    )
    SELECT
      count() as total_tokens,
      countIf(m.token_id_dec IS NOT NULL) as mapped_tokens
    FROM wallet_tokens wt
    LEFT JOIN pm_token_to_condition_map_v5 m ON wt.token_id = m.token_id_dec
  `;
  const tokenMappingResult = await clickhouse.query({ query: tokenMappingQuery, format: 'JSONEachRow' });
  const tokenMappingRows = (await tokenMappingResult.json()) as any[];
  const uniqueTokenIds = Number(tokenMappingRows[0]?.total_tokens || 0);
  const mappedTokenIds = Number(tokenMappingRows[0]?.mapped_tokens || 0);
  const mappingCoverage = uniqueTokenIds > 0 ? (mappedTokenIds / uniqueTokenIds) * 100 : 100;

  // Determine issues
  if (!ctfHasBlockNumber && ctfTotal > 0) {
    issues.push('CTF events missing block_number');
  }
  if (!ctfHasLogIndex && ctfTotal > 0) {
    issues.push('CTF events missing log_index');
  }
  if (!clobHasOrdering && clobTotal > 0) {
    issues.push('CLOB events missing ordering');
  }
  if (mappingCoverage < 99 && uniqueTokenIds > 0) {
    issues.push(`Token mapping only ${mappingCoverage.toFixed(1)}%`);
  }
  if (type === 'CTF' && ctfSplits + ctfMerges + ctfRedemptions === 0) {
    issues.push('CTF wallet but no CTF events found');
  }
  if (type === 'NEGRISK' && ctfConversions === 0) {
    issues.push('NEGRISK wallet but no conversions found');
  }

  const ready = issues.length === 0;

  return {
    wallet: w,
    name,
    type,
    clobFills,
    ctfSplits,
    ctfMerges,
    ctfRedemptions,
    ctfConversions,
    erc1155Transfers,
    ctfHasBlockNumber,
    ctfHasLogIndex,
    clobHasOrdering,
    uniqueTokenIds,
    mappedTokenIds,
    mappingCoverage,
    ready,
    issues,
  };
}

async function main() {
  console.log('═'.repeat(120));
  console.log('📊 V40 Readiness Verification');
  console.log('═'.repeat(120));
  console.log();

  const results: WalletReadiness[] = [];

  for (const { wallet, name, type } of BENCHMARK_WALLETS) {
    process.stdout.write(`Checking ${name.padEnd(15)}...`);
    try {
      const result = await checkWalletReadiness(wallet, name, type);
      results.push(result);
      console.log(result.ready ? ' ✓ READY' : ` ✗ ${result.issues.join(', ')}`);
    } catch (e) {
      console.log(` ✗ ERROR: ${(e as Error).message.slice(0, 50)}`);
      results.push({
        wallet: wallet.toLowerCase(),
        name,
        type,
        clobFills: 0,
        ctfSplits: 0,
        ctfMerges: 0,
        ctfRedemptions: 0,
        ctfConversions: 0,
        erc1155Transfers: 0,
        ctfHasBlockNumber: false,
        ctfHasLogIndex: false,
        clobHasOrdering: false,
        uniqueTokenIds: 0,
        mappedTokenIds: 0,
        mappingCoverage: 0,
        ready: false,
        issues: ['Query failed'],
      });
    }
  }

  // Print detailed results
  console.log();
  console.log('═'.repeat(120));
  console.log('EVENT COVERAGE BY WALLET');
  console.log('═'.repeat(120));
  console.log(
    'Name'.padEnd(16) + ' | ' +
    'Type'.padEnd(8) + ' | ' +
    'CLOB'.padStart(8) + ' | ' +
    'Splits'.padStart(8) + ' | ' +
    'Merges'.padStart(8) + ' | ' +
    'Redeem'.padStart(8) + ' | ' +
    'Convert'.padStart(8) + ' | ' +
    'ERC1155'.padStart(10) + ' | ' +
    'Map%'.padStart(6)
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    console.log(
      r.name.padEnd(16) + ' | ' +
      r.type.padEnd(8) + ' | ' +
      r.clobFills.toString().padStart(8) + ' | ' +
      r.ctfSplits.toString().padStart(8) + ' | ' +
      r.ctfMerges.toString().padStart(8) + ' | ' +
      r.ctfRedemptions.toString().padStart(8) + ' | ' +
      r.ctfConversions.toString().padStart(8) + ' | ' +
      r.erc1155Transfers.toString().padStart(10) + ' | ' +
      r.mappingCoverage.toFixed(1).padStart(5) + '%'
    );
  }

  // Print ordering checks
  console.log();
  console.log('═'.repeat(120));
  console.log('ORDERING PRIMITIVES');
  console.log('═'.repeat(120));
  console.log(
    'Name'.padEnd(16) + ' | ' +
    'CTF block_number'.padStart(18) + ' | ' +
    'CTF log_index'.padStart(15) + ' | ' +
    'CLOB ordering'.padStart(15) + ' | ' +
    'Status'
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    const ctfBlockStatus = r.ctfHasBlockNumber ? '✓' : '✗';
    const ctfLogStatus = r.ctfHasLogIndex ? '✓' : '✗';
    const clobStatus = r.clobHasOrdering ? '✓' : '✗';
    const overallStatus = r.ready ? '✓ READY' : '✗ ISSUES';

    console.log(
      r.name.padEnd(16) + ' | ' +
      ctfBlockStatus.padStart(18) + ' | ' +
      ctfLogStatus.padStart(15) + ' | ' +
      clobStatus.padStart(15) + ' | ' +
      overallStatus
    );
  }

  // Summary
  console.log();
  console.log('═'.repeat(120));
  console.log('SUMMARY');
  console.log('═'.repeat(120));

  const readyCount = results.filter(r => r.ready).length;
  const totalCount = results.length;
  const hardWallets = results.filter(r => r.type === 'CTF' || r.type === 'NEGRISK');
  const hardReady = hardWallets.filter(r => r.ready).length;

  console.log(`Total wallets ready: ${readyCount}/${totalCount}`);
  console.log(`Hard wallets ready (CTF/NEGRISK): ${hardReady}/${hardWallets.length}`);
  console.log();

  // List issues for hard wallets
  const hardWithIssues = hardWallets.filter(r => !r.ready);
  if (hardWithIssues.length > 0) {
    console.log('HARD WALLETS WITH ISSUES:');
    for (const r of hardWithIssues) {
      console.log(`  ${r.name}: ${r.issues.join(', ')}`);
    }
    console.log();
    console.log('⚠️  V40 implementation should wait until hard wallet issues are resolved.');
  } else {
    console.log('✅ All hard wallets ready. V40 implementation can proceed.');
  }

  // Check for specific critical issues
  const splitHeavy = results.find(r => r.name === 'SPLIT_HEAVY');
  const negRiskHeavy = results.find(r => r.name === 'NEGRISK_HEAVY');

  console.log();
  console.log('═'.repeat(120));
  console.log('CRITICAL WALLET ANALYSIS');
  console.log('═'.repeat(120));

  if (splitHeavy) {
    console.log(`SPLIT_HEAVY:`);
    console.log(`  CLOB fills: ${splitHeavy.clobFills}`);
    console.log(`  CTF splits: ${splitHeavy.ctfSplits}`);
    console.log(`  CTF merges: ${splitHeavy.ctfMerges}`);
    console.log(`  CTF redemptions: ${splitHeavy.ctfRedemptions}`);
    console.log(`  ERC1155 transfers: ${splitHeavy.erc1155Transfers}`);
    if (splitHeavy.clobFills === 0 && splitHeavy.ctfSplits > 0) {
      console.log(`  → Pure CTF wallet, V40 MUST process CTF events`);
    }
  }

  if (negRiskHeavy) {
    console.log();
    console.log(`NEGRISK_HEAVY:`);
    console.log(`  CLOB fills: ${negRiskHeavy.clobFills}`);
    console.log(`  CTF conversions: ${negRiskHeavy.ctfConversions}`);
    console.log(`  ERC1155 transfers: ${negRiskHeavy.erc1155Transfers}`);
    if (negRiskHeavy.ctfConversions > 0) {
      console.log(`  → Has conversions, V40 MUST implement conversion handler`);
    } else {
      console.log(`  ⚠️ No conversions found - may need to check pm_neg_risk_conversions_v1`);
    }
  }
}

main().catch(console.error);
