/**
 * Debug CTF token ID computation
 *
 * The correct CTF formula is:
 * 1. collectionId = keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet))
 * 2. positionId = keccak256(abi.encodePacked(collateralToken, collectionId))
 *
 * Where:
 * - indexSet = 1 for outcome 0
 * - indexSet = 2 for outcome 1
 * - parentCollectionId = 0x00...00 for base markets
 * - collateralToken = USDC.e or USDC on Polygon
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked, pad, toHex } from 'viem';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

// Collateral tokens on Polygon
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e (bridged)
const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'; // Native USDC

async function main() {
  console.log('=== DEBUG CTF TOKEN ID COMPUTATION ===\n');

  // Get one condition with its parent_collection_id and actual token_ids
  const q = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    ctf_data AS (
      SELECT
        tx_hash,
        condition_id,
        parent_collection_id,
        collateral_token
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
      LIMIT 1
    ),
    clob_tokens AS (
      SELECT DISTINCT
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
        AND lower(concat('0x', hex(transaction_hash))) IN (SELECT tx_hash FROM ctf_data)
    )
    SELECT
      c.condition_id,
      c.parent_collection_id,
      c.collateral_token,
      groupArray(DISTINCT t.token_id) as actual_tokens
    FROM ctf_data c
    LEFT JOIN clob_tokens t ON c.tx_hash = t.tx_hash
    GROUP BY c.condition_id, c.parent_collection_id, c.collateral_token
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  if (rows.length === 0) {
    console.log('No data found');
    return;
  }

  const data = rows[0];
  console.log('=== RAW DATA FROM CLICKHOUSE ===');
  console.log('condition_id:', data.condition_id);
  console.log('parent_collection_id:', data.parent_collection_id);
  console.log('collateral_token:', data.collateral_token);
  console.log('actual_tokens:', data.actual_tokens);

  // Normalize inputs
  const conditionId = data.condition_id.startsWith('0x')
    ? data.condition_id
    : `0x${data.condition_id}`;
  const parentCollectionId = data.parent_collection_id.startsWith('0x')
    ? data.parent_collection_id
    : `0x${data.parent_collection_id}`;
  const collateralToken = data.collateral_token;

  console.log('\n=== NORMALIZED INPUTS ===');
  console.log('conditionId:', conditionId, `(${conditionId.length} chars)`);
  console.log('parentCollectionId:', parentCollectionId, `(${parentCollectionId.length} chars)`);
  console.log('collateralToken:', collateralToken);

  // Compute token IDs using CTF formula
  console.log('\n=== COMPUTING TOKEN IDS ===');

  function computeTokenId(
    collateral: string,
    parent: `0x${string}`,
    condition: `0x${string}`,
    indexSet: bigint
  ): string {
    // Step 1: collectionId = keccak256(abi.encodePacked(parent, condition, indexSet))
    // Note: indexSet is uint256, so it needs to be 32 bytes
    const collectionPacked = encodePacked(
      ['bytes32', 'bytes32', 'uint256'],
      [parent, condition, indexSet]
    );
    console.log(`  collectionPacked (indexSet=${indexSet}):`, collectionPacked.slice(0, 50) + '...');
    const collectionId = keccak256(collectionPacked);
    console.log(`  collectionId:`, collectionId);

    // Step 2: positionId = keccak256(abi.encodePacked(collateral, collectionId))
    const positionPacked = encodePacked(['address', 'bytes32'], [collateral as `0x${string}`, collectionId]);
    console.log(`  positionPacked:`, positionPacked.slice(0, 50) + '...');
    const positionId = keccak256(positionPacked);
    console.log(`  positionId:`, positionId);

    return BigInt(positionId).toString();
  }

  // Try with the collateral token from the event
  console.log('\n--- Using collateral from event:', collateralToken, '---');
  const token0_event = computeTokenId(
    collateralToken,
    parentCollectionId as `0x${string}`,
    conditionId as `0x${string}`,
    1n // indexSet = 1 for outcome 0
  );
  console.log('  Computed token (indexSet=1, outcome 0):', token0_event);

  const token1_event = computeTokenId(
    collateralToken,
    parentCollectionId as `0x${string}`,
    conditionId as `0x${string}`,
    2n // indexSet = 2 for outcome 1
  );
  console.log('  Computed token (indexSet=2, outcome 1):', token1_event);

  // Compare with actual tokens
  console.log('\n=== COMPARISON ===');
  console.log('Actual tokens:', data.actual_tokens);
  console.log('Computed tokens:', [token0_event, token1_event]);

  const actualSet = new Set(data.actual_tokens);
  const match0 = actualSet.has(token0_event);
  const match1 = actualSet.has(token1_event);
  console.log(`Match outcome 0: ${match0}`);
  console.log(`Match outcome 1: ${match1}`);

  if (!match0 && !match1) {
    console.log('\n⚠️  No matches. Trying other collateral tokens...\n');

    // Try USDC.e
    console.log('--- Trying USDC.e:', USDC_E, '---');
    const token0_usdc_e = computeTokenId(
      USDC_E,
      parentCollectionId as `0x${string}`,
      conditionId as `0x${string}`,
      1n
    );
    const token1_usdc_e = computeTokenId(
      USDC_E,
      parentCollectionId as `0x${string}`,
      conditionId as `0x${string}`,
      2n
    );
    console.log('Match with USDC.e:', actualSet.has(token0_usdc_e), actualSet.has(token1_usdc_e));

    // Try native USDC
    console.log('\n--- Trying native USDC:', USDC, '---');
    const token0_usdc = computeTokenId(
      USDC,
      parentCollectionId as `0x${string}`,
      conditionId as `0x${string}`,
      1n
    );
    const token1_usdc = computeTokenId(
      USDC,
      parentCollectionId as `0x${string}`,
      conditionId as `0x${string}`,
      2n
    );
    console.log('Match with native USDC:', actualSet.has(token0_usdc), actualSet.has(token1_usdc));

    // Try without parent collection ID (direct hash)
    console.log('\n--- Trying simplified formula (no parent) ---');
    const simplePacked0 = encodePacked(['bytes32', 'uint256'], [conditionId as `0x${string}`, 0n]);
    const simpleToken0 = BigInt(keccak256(simplePacked0)).toString();
    const simplePacked1 = encodePacked(['bytes32', 'uint256'], [conditionId as `0x${string}`, 1n]);
    const simpleToken1 = BigInt(keccak256(simplePacked1)).toString();
    console.log('Simple token0:', simpleToken0);
    console.log('Simple token1:', simpleToken1);
    console.log('Match:', actualSet.has(simpleToken0), actualSet.has(simpleToken1));
  }

  // Print actual token digits for comparison
  console.log('\n=== TOKEN DIGIT ANALYSIS ===');
  for (const t of data.actual_tokens) {
    console.log(`Actual: ${t} (${t.length} digits)`);
  }
  console.log(`Computed0: ${token0_event} (${token0_event.length} digits)`);
  console.log(`Computed1: ${token1_event} (${token1_event.length} digits)`);
}

main().catch(console.error);
