#!/usr/bin/env tsx
/**
 * Phase 1B: Check if AMM trades already exist in erc1155_transfers
 *
 * Instead of fetching from external APIs, check if our existing blockchain
 * data already contains AMM activity for xcnstrategy wallet.
 *
 * Strategy:
 * 1. Query erc1155_transfers for xcnstrategy EOA and proxy
 * 2. Group by contract address to identify AMM contracts
 * 3. Look for transfers that don't match CLOB fills (these are likely AMM)
 * 4. Check if any transfers involve the 6 "ghost" condition_ids
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// 6 "ghost" markets - completely absent from CLOB tables
const GHOST_CONDITION_IDS = [
  '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
];

async function main() {
  console.log('Phase 1B: Checking for AMM Activity in Blockchain Data');
  console.log('='.repeat(80));
  console.log('');
  console.log('Goal: Determine if erc1155_transfers already contains AMM trades');
  console.log(`Wallet EOA: ${XCN_EOA}`);
  console.log(`Wallet Proxy: ${XCN_PROXY}`);
  console.log('');

  // Step 1: Check total ERC1155 transfer activity for xcn wallet
  console.log('Step 1: Total ERC1155 Transfer Activity');
  console.log('-'.repeat(80));

  const totalTransfersQuery = `
    SELECT
      COUNT(*) as total_transfers,
      COUNT(DISTINCT token_id) as unique_tokens,
      COUNT(DISTINCT contract) as unique_contracts,
      MIN(block_timestamp) as first_transfer,
      MAX(block_timestamp) as last_transfer
    FROM erc1155_transfers
    WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
       OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
  `;

  const totalResult = await clickhouse.query({ query: totalTransfersQuery });
  const totalRows = await totalResult.json();

  if (totalRows.data && totalRows.data.length > 0) {
    const stats = totalRows.data[0];
    console.log(`Total transfers: ${stats.total_transfers}`);
    console.log(`Unique token_ids: ${stats.unique_tokens}`);
    console.log(`Unique contracts: ${stats.unique_contracts}`);
    console.log(`Date range: ${stats.first_transfer} → ${stats.last_transfer}`);
  } else {
    console.log('⚠️  No ERC1155 transfers found for xcnstrategy wallet');
  }

  console.log('');

  // Step 2: Group transfers by contract to identify potential AMM contracts
  console.log('Step 2: Contract Address Analysis');
  console.log('-'.repeat(80));

  const contractsQuery = `
    SELECT
      contract,
      COUNT(*) as transfer_count,
      COUNT(DISTINCT token_id) as unique_tokens,
      MIN(block_timestamp) as first_seen,
      MAX(block_timestamp) as last_seen
    FROM erc1155_transfers
    WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
       OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
    GROUP BY contract
    ORDER BY transfer_count DESC
    LIMIT 20
  `;

  const contractsResult = await clickhouse.query({ query: contractsQuery });
  const contractsRows = await contractsResult.json();

  console.log('Top 20 contracts by transfer count:');
  console.log('');

  if (contractsRows.data && contractsRows.data.length > 0) {
    for (const row of contractsRows.data) {
      console.log(`Contract: ${row.contract}`);
      console.log(`  Transfers: ${row.transfer_count}`);
      console.log(`  Unique tokens: ${row.unique_tokens}`);
      console.log(`  Active: ${row.first_seen} → ${row.last_seen}`);
      console.log('');
    }
  }

  // Step 3: Check if any transfers involve the 6 ghost condition_ids
  console.log('Step 3: Ghost Market Token ID Search');
  console.log('-'.repeat(80));
  console.log('');
  console.log('Checking if blockchain has transfers for the 6 ghost markets...');
  console.log('');

  // We need to understand the token_id encoding first
  // Polymarket uses: keccak256(abi.encodePacked(condition_id, outcome_index))
  // Let's check if we have a mapping table or need to derive token_ids

  const tokenMapQuery = `
    SELECT COUNT(*) as count FROM system.tables
    WHERE database = currentDatabase() AND name = 'ctf_token_map'
  `;
  const tokenMapResult = await clickhouse.query({ query: tokenMapQuery });
  const tokenMapRows = await tokenMapResult.json();
  const hasTokenMap = tokenMapRows.data?.[0]?.count > 0;

  console.log(`ctf_token_map table exists: ${hasTokenMap ? 'YES' : 'NO'}`);
  console.log('');

  if (hasTokenMap) {
    console.log('Using ctf_token_map to find token_ids for ghost markets...');
    console.log('');

    for (const cid of GHOST_CONDITION_IDS) {
      const tokenLookupQuery = `
        SELECT
          token_id,
          outcome
        FROM ctf_token_map
        WHERE lower(condition_id_norm) = '${cid}'
        ORDER BY outcome
      `;

      const tokenResult = await clickhouse.query({ query: tokenLookupQuery });
      const tokenRows = await tokenResult.json();

      console.log(`Market ${cid.substring(0, 12)}...`);

      if (tokenRows.data && tokenRows.data.length > 0) {
        console.log(`  ✅ Found ${tokenRows.data.length} token_ids in ctf_token_map`);

        // Now check if we have transfers for these token_ids
        const tokenIds = tokenRows.data.map((r: any) => `'${r.token_id}'`).join(',');

        const transfersQuery = `
          SELECT
            COUNT(*) as transfer_count,
            SUM(value) as total_volume
          FROM erc1155_transfers
          WHERE token_id IN (${tokenIds})
            AND (
              lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
              OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
            )
        `;

        const transfersResult = await clickhouse.query({ query: transfersQuery });
        const transfersData = await transfersResult.json();

        if (transfersData.data?.[0]?.transfer_count > 0) {
          console.log(`  ✅ ${transfersData.data[0].transfer_count} transfers found in erc1155_transfers!`);
          console.log(`  Total volume: ${transfersData.data[0].total_volume} shares`);
        } else {
          console.log(`  ❌ No transfers found in erc1155_transfers`);
        }
      } else {
        console.log(`  ❌ No token_ids in ctf_token_map (market never mapped)`);
      }

      console.log('');
    }
  } else {
    console.log('⚠️  No ctf_token_map table found');
    console.log('Cannot map condition_ids to token_ids without this table');
    console.log('');
  }

  // Step 4: Compare CLOB fills vs ERC1155 transfers (identify AMM delta)
  console.log('Step 4: CLOB vs Blockchain Transfer Delta');
  console.log('-'.repeat(80));
  console.log('');
  console.log('Comparing CLOB fills with blockchain transfers to find AMM activity...');
  console.log('');

  const deltaQuery = `
    WITH clob_count AS (
      SELECT COUNT(*) as fills
      FROM clob_fills
      WHERE lower(proxy_wallet) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(user_eoa) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
    ),
    erc1155_count AS (
      SELECT COUNT(*) as transfers
      FROM erc1155_transfers
      WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
    )
    SELECT
      c.fills as clob_fills,
      e.transfers as erc1155_transfers,
      e.transfers - c.fills as delta
    FROM clob_count c, erc1155_count e
  `;

  const deltaResult = await clickhouse.query({ query: deltaQuery });
  const deltaRows = await deltaResult.json();

  if (deltaRows.data && deltaRows.data.length > 0) {
    const delta = deltaRows.data[0];
    console.log(`CLOB fills: ${delta.clob_fills}`);
    console.log(`ERC1155 transfers: ${delta.erc1155_transfers}`);
    console.log(`Delta: ${delta.delta} transfers`);
    console.log('');

    if (delta.delta > 0) {
      console.log('✅ POSITIVE DELTA - blockchain has MORE activity than CLOB!');
      console.log('This suggests AMM or other non-CLOB trades exist in blockchain data.');
    } else if (delta.delta === 0) {
      console.log('⚠️  ZERO DELTA - blockchain and CLOB have same count');
      console.log('This suggests no AMM activity, or AMM uses different contracts.');
    } else {
      console.log('⚠️  NEGATIVE DELTA - CLOB has more than blockchain?');
      console.log('This is unexpected - may indicate data quality issue.');
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Key Questions:');
  console.log('1. Does erc1155_transfers contain xcnstrategy activity? → (see Step 1)');
  console.log('2. Are the 6 ghost markets in blockchain data? → (see Step 3)');
  console.log('3. Is there a delta between CLOB and blockchain? → (see Step 4)');
  console.log('');
  console.log('Next Steps:');
  console.log('- If ghost markets found in blockchain → Build AMM extraction from erc1155');
  console.log('- If ghost markets NOT found → Need external data source (Dune or Dome API)');
  console.log('- If positive delta → Decode transfer patterns to identify AMM trades');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
