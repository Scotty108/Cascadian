/**
 * Test different CTF token ID formula variations
 * to find the one that matches actual token IDs
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  // Get CTF events for our wallet
  const q = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      condition_id,
      parent_collection_id,
      collateral_token,
      partition_index_sets
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
    LIMIT 1
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const data = (await r.json() as any[])[0];

  console.log('=== CTF EVENT DATA ===');
  console.log('condition_id:', data.condition_id);
  console.log('parent_collection_id:', data.parent_collection_id);
  console.log('collateral_token:', data.collateral_token);
  console.log('partition_index_sets:', data.partition_index_sets);

  // Get actual tokens from CLOB for same condition
  const tokensQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    ctf_tx AS (
      SELECT tx_hash
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND condition_id = '${data.condition_id}'
        AND is_deleted = 0
      LIMIT 1
    )
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE lower(concat('0x', hex(transaction_hash))) IN (SELECT tx_hash FROM ctf_tx)
      AND trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const tokensR = await clickhouse.query({ query: tokensQ, format: 'JSONEachRow' });
  const tokens = (await tokensR.json() as any[]).map((t: any) => t.token_id);
  console.log('\nActual tokens in same tx:', tokens);

  // Normalize inputs
  const condId = (data.condition_id.startsWith('0x') ? data.condition_id : '0x' + data.condition_id) as `0x${string}`;
  const parentId = (data.parent_collection_id.startsWith('0x') ? data.parent_collection_id : '0x' + data.parent_collection_id) as `0x${string}`;
  const collateral = data.collateral_token as `0x${string}`;

  // Show actual tokens in hex for comparison
  console.log('\n=== ACTUAL TOKENS (hex) ===');
  for (const t of tokens) {
    const hex = BigInt(t).toString(16).padStart(64, '0');
    console.log(`  ${t.slice(0, 30)}... = 0x${hex.slice(0, 16)}...`);
  }

  // Formula 1: Standard CTF (parent, condition, indexSet) -> collectionId -> (collateral, collectionId) -> positionId
  console.log('\n=== FORMULA 1: Full CTF (2-step with collateral) ===');
  for (const indexSet of [1n, 2n]) {
    const collectionPacked = encodePacked(['bytes32', 'bytes32', 'uint256'], [parentId, condId, indexSet]);
    const collectionId = keccak256(collectionPacked);
    const positionPacked = encodePacked(['address', 'bytes32'], [collateral, collectionId]);
    const positionId = keccak256(positionPacked);
    const tokenDec = BigInt(positionId).toString();
    console.log(`indexSet=${indexSet}: ${tokenDec.slice(0, 30)}... Match: ${tokens.includes(tokenDec)}`);
  }

  // Formula 2: collectionId only (no positionId step)
  console.log('\n=== FORMULA 2: collectionId only (no collateral) ===');
  for (const indexSet of [1n, 2n]) {
    const packed = encodePacked(['bytes32', 'bytes32', 'uint256'], [parentId, condId, indexSet]);
    const hash = keccak256(packed);
    const tokenDec = BigInt(hash).toString();
    console.log(`indexSet=${indexSet}: ${tokenDec.slice(0, 30)}... Match: ${tokens.includes(tokenDec)}`);
  }

  // Formula 3: keccak256(condition, parent, indexSet) - reversed order
  console.log('\n=== FORMULA 3: Reversed (condition, parent, indexSet) ===');
  for (const indexSet of [1n, 2n]) {
    const packed = encodePacked(['bytes32', 'bytes32', 'uint256'], [condId, parentId, indexSet]);
    const hash = keccak256(packed);
    const tokenDec = BigInt(hash).toString();
    console.log(`indexSet=${indexSet}: ${tokenDec.slice(0, 30)}... Match: ${tokens.includes(tokenDec)}`);
  }

  // Formula 4: keccak256(condition, indexSet) - no parent
  console.log('\n=== FORMULA 4: No parent (condition, indexSet) ===');
  for (const indexSet of [0n, 1n, 2n]) {
    const packed = encodePacked(['bytes32', 'uint256'], [condId, indexSet]);
    const hash = keccak256(packed);
    const tokenDec = BigInt(hash).toString();
    console.log(`indexSet=${indexSet}: ${tokenDec.slice(0, 30)}... Match: ${tokens.includes(tokenDec)}`);
  }

  // Formula 5: keccak256(collateral, condition, indexSet) - collateral first
  console.log('\n=== FORMULA 5: Collateral first (collateral, condition, indexSet) ===');
  for (const indexSet of [1n, 2n]) {
    const packed = encodePacked(['address', 'bytes32', 'uint256'], [collateral, condId, indexSet]);
    const hash = keccak256(packed);
    const tokenDec = BigInt(hash).toString();
    console.log(`indexSet=${indexSet}: ${tokenDec.slice(0, 30)}... Match: ${tokens.includes(tokenDec)}`);
  }

  // Formula 6: Try with oracle/questionId instead of condition
  console.log('\n=== FORMULA 6: Check if token_id might come from oracle/question ===');
  // The token might be derived from a questionId, not condition_id

  // Formula 7: Try getPositionId formula (Gnosis CTF standard)
  // getPositionId(collateral, collectionId) where collectionId = getCollectionId(parentCollectionId, conditionId, indexSet)
  // But we need to verify the collateral address
  console.log('\n=== FORMULA 7: Check different collaterals ===');
  const collaterals = [
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // Native USDC
    '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', // Polymarket's CTF
    data.collateral_token, // From event
  ];

  for (const coll of collaterals) {
    console.log(`\nCollateral: ${coll}`);
    for (const indexSet of [1n, 2n]) {
      const collectionPacked = encodePacked(['bytes32', 'bytes32', 'uint256'], [parentId, condId, indexSet]);
      const collectionId = keccak256(collectionPacked);
      const positionPacked = encodePacked(['address', 'bytes32'], [coll as `0x${string}`, collectionId]);
      const positionId = keccak256(positionPacked);
      const tokenDec = BigInt(positionId).toString();
      const match = tokens.includes(tokenDec);
      if (match) {
        console.log(`  indexSet=${indexSet}: MATCH!!! ${tokenDec.slice(0, 30)}...`);
      }
    }
  }

  // Check pm_token_to_condition_map_v5 for any known mappings of these tokens
  console.log('\n=== CHECKING EXISTING MAPPINGS ===');
  const tokenList = tokens.map((t: string) => `'${t}'`).join(',');
  const mappingQ = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec IN (${tokenList})
  `;
  const mappingR = await clickhouse.query({ query: mappingQ, format: 'JSONEachRow' });
  const mappings = await mappingR.json() as any[];
  console.log(`Found ${mappings.length} existing mappings`);
  for (const m of mappings) {
    console.log(`  ${m.token_id_dec.slice(0, 20)}... -> ${m.condition_id.slice(0, 16)}... outcome=${m.outcome_index}`);
  }
}

main().catch(console.error);
