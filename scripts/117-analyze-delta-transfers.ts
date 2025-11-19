#!/usr/bin/env tsx
/**
 * Deep Dive: Analyze the 55 "Delta" Transfers
 *
 * We found 55 more ERC1155 transfers than CLOB fills.
 * Goal: Identify which markets/tokens these belong to and if any match the ghost markets.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function main() {
  console.log('Deep Dive: Analyzing the 55 Delta Transfers');
  console.log('='.repeat(80));
  console.log('');
  console.log('Goal: Find which token_ids account for the blockchain > CLOB delta');
  console.log('');

  // Step 1: Get all unique token_ids from erc1155_transfers for xcn wallet
  console.log('Step 1: Token IDs in Blockchain Transfers');
  console.log('-'.repeat(80));

  const blockchainTokensQuery = `
    SELECT
      token_id,
      COUNT(*) as transfer_count,
      SUM(toFloat64OrZero(value)) as total_volume,
      MIN(block_timestamp) as first_transfer,
      MAX(block_timestamp) as last_transfer
    FROM erc1155_transfers
    WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
       OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
    GROUP BY token_id
    ORDER BY transfer_count DESC
  `;

  const blockchainResult = await clickhouse.query({ query: blockchainTokensQuery });
  const blockchainTokens = await blockchainResult.json();

  console.log(`Total unique token_ids in blockchain: ${blockchainTokens.data?.length || 0}`);
  console.log('');

  // Step 2: Get all unique asset_ids from clob_fills for xcn wallet
  console.log('Step 2: Asset IDs in CLOB Fills');
  console.log('-'.repeat(80));

  const clobTokensQuery = `
    SELECT
      asset_id,
      COUNT(*) as fill_count,
      SUM(size) as total_volume,
      MIN(timestamp) as first_fill,
      MAX(timestamp) as last_fill
    FROM clob_fills
    WHERE lower(proxy_wallet) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
       OR lower(user_eoa) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
    GROUP BY asset_id
    ORDER BY fill_count DESC
  `;

  const clobResult = await clickhouse.query({ query: clobTokensQuery });
  const clobTokens = await clobResult.json();

  console.log(`Total unique asset_ids in CLOB: ${clobTokens.data?.length || 0}`);
  console.log('');

  // Step 3: Find token_ids in blockchain that are NOT in CLOB (the delta)
  console.log('Step 3: Identify Delta Token IDs (blockchain only)');
  console.log('-'.repeat(80));
  console.log('');

  const blockchainTokenIdSet = new Set(
    blockchainTokens.data?.map((r: any) => r.token_id.toLowerCase()) || []
  );
  const clobAssetIdSet = new Set(
    clobTokens.data?.map((r: any) => r.asset_id.toLowerCase()) || []
  );

  const deltaTokenIds: any[] = [];
  const matchedTokenIds: any[] = [];

  for (const row of (blockchainTokens.data || [])) {
    const tokenId = row.token_id.toLowerCase();
    if (!clobAssetIdSet.has(tokenId)) {
      deltaTokenIds.push(row);
    } else {
      matchedTokenIds.push(row);
    }
  }

  console.log(`✅ Matched token_ids (in both blockchain & CLOB): ${matchedTokenIds.length}`);
  console.log(`⚠️  Delta token_ids (blockchain ONLY): ${deltaTokenIds.length}`);
  console.log('');

  if (deltaTokenIds.length > 0) {
    console.log('Delta Token IDs (blockchain transfers with no CLOB fills):');
    console.log('');

    for (const token of deltaTokenIds.slice(0, 20)) {
      console.log(`Token ID: ${token.token_id}`);
      console.log(`  Transfers: ${token.transfer_count}`);
      console.log(`  Volume: ${token.total_volume}`);
      console.log(`  Active: ${token.first_transfer} → ${token.last_transfer}`);

      // Try to map to condition_id via ctf_token_map
      const mappingQuery = `
        SELECT condition_id_norm, question, outcome
        FROM ctf_token_map
        WHERE lower(token_id) = '${token.token_id.toLowerCase()}'
        LIMIT 1
      `;

      const mappingResult = await clickhouse.query({ query: mappingQuery });
      const mappingData = await mappingResult.json();

      if (mappingData.data && mappingData.data.length > 0) {
        const mapping = mappingData.data[0];
        console.log(`  ✅ Mapped to: ${mapping.question}`);
        console.log(`  Condition ID: ${mapping.condition_id_norm}`);
        console.log(`  Outcome: ${mapping.outcome}`);
      } else {
        console.log(`  ❌ No mapping in ctf_token_map`);
      }

      console.log('');
    }

    if (deltaTokenIds.length > 20) {
      console.log(`... and ${deltaTokenIds.length - 20} more delta token_ids`);
      console.log('');
    }
  }

  // Step 4: Check if any delta tokens can be reverse-engineered to ghost condition_ids
  console.log('Step 4: Attempt Reverse Engineering to Ghost Markets');
  console.log('-'.repeat(80));
  console.log('');

  // Polymarket token_id = keccak256(abi.encodePacked(condition_id, outcome_index))
  // This is computationally hard to reverse without knowing the condition_id
  // But we can check if any unmapped tokens match a pattern

  console.log('Note: Token IDs are derived via keccak256(condition_id, outcome_index)');
  console.log('Cannot reverse-engineer without the condition_id.');
  console.log('');
  console.log('However, if the delta tokens are unmapped, they likely represent:');
  console.log('1. Markets that never went through our token mapping pipeline');
  console.log('2. AMM-only markets (not in CLOB)');
  console.log('3. Markets from before our backfill date range');
  console.log('');

  // Step 5: Aggregate stats
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  const totalBlockchainTransfers = blockchainTokens.data?.reduce((sum: number, r: any) => sum + parseInt(r.transfer_count), 0) || 0;
  const totalClobFills = clobTokens.data?.reduce((sum: number, r: any) => sum + parseInt(r.fill_count), 0) || 0;
  const deltaTransfers = deltaTokenIds.reduce((sum: number, r: any) => sum + parseInt(r.transfer_count), 0);
  const matchedTransfers = matchedTokenIds.reduce((sum: number, r: any) => sum + parseInt(r.transfer_count), 0);

  console.log(`Total blockchain transfers: ${totalBlockchainTransfers}`);
  console.log(`Total CLOB fills: ${totalClobFills}`);
  console.log(`Matched transfers (in both): ${matchedTransfers}`);
  console.log(`Delta transfers (blockchain only): ${deltaTransfers}`);
  console.log('');
  console.log(`Unique token_ids in blockchain: ${blockchainTokenIdSet.size}`);
  console.log(`Unique asset_ids in CLOB: ${clobAssetIdSet.size}`);
  console.log(`Unique delta token_ids: ${deltaTokenIds.length}`);
  console.log('');

  console.log('Key Findings:');
  console.log(`1. ${deltaTokenIds.length} token_ids exist in blockchain but NOT in CLOB`);
  console.log(`2. These account for ${deltaTransfers} transfers (the "missing" activity)`);
  console.log(`3. Most delta tokens are likely AMM trades or unmapped markets`);
  console.log('');
  console.log('Next Steps:');
  console.log('1. Check if delta tokens have mappings in ctf_token_map');
  console.log('2. If mapped → decode to condition_ids and check if any match ghost markets');
  console.log('3. If unmapped → need external source (Dune or Polymarket API) to identify');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
