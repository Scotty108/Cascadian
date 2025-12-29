/**
 * Derive token_id → condition_id + outcome_index mappings
 *
 * The CTF (Conditional Token Framework) uses a deterministic formula:
 * token_id = uint256(keccak256(abi.encodePacked(collateralToken, conditionId, indexSet)))
 *
 * For binary markets:
 * - outcome 0: indexSet = 1 (binary 0b01)
 * - outcome 1: indexSet = 2 (binary 0b10)
 *
 * If we have the condition_id, we can compute both token_ids and match
 * against actual tokens seen in CLOB trades.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

// Polymarket token_id derivation (simpler than standard CTF)
// token_id = keccak256(abi.encodePacked(conditionId, outcomeIndex))
function computeTokenId(conditionId: string, outcomeIndex: number): string {
  // Ensure condition_id has 0x prefix
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;

  // Pack conditionId (bytes32) + outcomeIndex (uint256)
  const packed = encodePacked(['bytes32', 'uint256'], [condId as `0x${string}`, BigInt(outcomeIndex)]);
  const hash = keccak256(packed);

  // Convert to decimal string (Polymarket uses decimal token IDs)
  return BigInt(hash).toString();
}

async function main() {
  console.log('=== DERIVING TOKEN MAPPINGS FROM CONDITION IDS ===\n');

  // Step 1: Get condition_ids from CTF splits
  console.log('Step 1: Getting condition_ids from CTF splits...');
  const conditionsQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const conditionsR = await clickhouse.query({ query: conditionsQ, format: 'JSONEachRow' });
  const conditions = (await conditionsR.json()) as { condition_id: string }[];
  console.log(`  Found ${conditions.length} unique condition_ids`);

  // Step 2: Get actual token_ids from CLOB trades
  console.log('\nStep 2: Getting token_ids from CLOB trades...');
  const tokensQ = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const tokensR = await clickhouse.query({ query: tokensQ, format: 'JSONEachRow' });
  const actualTokens = new Set((await tokensR.json() as { token_id: string }[]).map((t) => t.token_id));
  console.log(`  Found ${actualTokens.size} unique token_ids`);

  // Step 3: Compute expected token_ids for each condition
  console.log('\nStep 3: Computing expected token_ids...');
  const mappings: { token_id: string; condition_id: string; outcome_index: number }[] = [];
  let matchCount = 0;

  for (const { condition_id } of conditions) {
    // Compute token_ids for both outcomes (0 and 1)
    const token0 = computeTokenId(condition_id, 0);
    const token1 = computeTokenId(condition_id, 1);

    if (actualTokens.has(token0)) {
      mappings.push({ token_id: token0, condition_id, outcome_index: 0 });
      matchCount++;
    }
    if (actualTokens.has(token1)) {
      mappings.push({ token_id: token1, condition_id, outcome_index: 1 });
      matchCount++;
    }
  }

  console.log(`  Matched ${matchCount}/${actualTokens.size * 2} expected tokens`);

  if (matchCount === 0) {
    console.log('\n⚠️  No matches found. Checking formula...');

    // Debug: show a sample computation
    const sampleCondition = conditions[0].condition_id;
    console.log(`\nSample condition: ${sampleCondition}`);
    console.log(`Computed token0: ${computeTokenId(sampleCondition, 0)}`);
    console.log(`Computed token1: ${computeTokenId(sampleCondition, 1)}`);

    // Show actual tokens for comparison
    console.log('\nActual tokens (first 5):');
    const tokenList = Array.from(actualTokens).slice(0, 5);
    for (const t of tokenList) {
      console.log(`  ${t}`);
    }
  } else {
    console.log('\n=== MAPPINGS DERIVED ===');
    console.log(`Successfully derived ${mappings.length} token mappings`);

    // Show sample mappings
    console.log('\nSample mappings:');
    for (const m of mappings.slice(0, 10)) {
      console.log(`  ${m.token_id} → ${m.condition_id.slice(0, 16)}... outcome=${m.outcome_index}`);
    }

    // Verify against resolution prices
    console.log('\nVerifying against resolution prices...');
    const conditionList = [...new Set(mappings.map((m) => `'${m.condition_id}'`))].join(',');
    const resQ = `
      SELECT condition_id, outcome_index, resolved_price
      FROM vw_pm_resolution_prices
      WHERE condition_id IN (${conditionList})
    `;
    const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
    const resolutions = (await resR.json()) as any[];
    console.log(`  Found ${resolutions.length} resolution prices for derived mappings`);
  }
}

main().catch(console.error);
