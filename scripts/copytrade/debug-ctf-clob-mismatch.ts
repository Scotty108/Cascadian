/**
 * Debug why CTF-derived tokens don't match CLOB tokens
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

// Token derivation formula A: keccak256(conditionId, outcomeIndex)
function computeTokenIdA(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  const packed = encodePacked(
    ['bytes32', 'uint256'],
    [condId as `0x${string}`, BigInt(outcomeIndex)]
  );
  return BigInt(keccak256(packed)).toString();
}

// Token derivation formula B: different packing
function computeTokenIdB(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  // Try with index set (1 << outcomeIndex) instead of raw outcomeIndex
  const indexSet = 1 << outcomeIndex;
  const packed = encodePacked(
    ['bytes32', 'uint256'],
    [condId as `0x${string}`, BigInt(indexSet)]
  );
  return BigInt(keccak256(packed)).toString();
}

async function main() {
  console.log('=== DEBUGGING CTF vs CLOB TOKEN MISMATCH ===\n');

  // Get a CTF condition
  console.log('1. Sample CTF event...');
  const q1 = `
    SELECT *
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    LIMIT 1
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const ctfEvent = (await r1.json())[0] as Record<string, unknown>;
  console.log('CTF event:');
  for (const [k, v] of Object.entries(ctfEvent)) {
    console.log(`  ${k}: ${v}`);
  }

  const conditionId = ctfEvent.condition_id as string;
  console.log(`\n2. Testing token derivation formulas for condition: ${conditionId}`);

  // Try both formulas
  console.log('\nFormula A (outcomeIndex):');
  for (let i = 0; i < 2; i++) {
    console.log(`  Outcome ${i}: ${computeTokenIdA(conditionId, i)}`);
  }

  console.log('\nFormula B (indexSet = 1 << outcomeIndex):');
  for (let i = 0; i < 2; i++) {
    console.log(`  Outcome ${i}: ${computeTokenIdB(conditionId, i)}`);
  }

  // Check if any of these are in the traded tokens
  console.log('\n3. Checking if computed tokens appear in CLOB trades...');
  const tokensToCheck = [
    computeTokenIdA(conditionId, 0),
    computeTokenIdA(conditionId, 1),
    computeTokenIdB(conditionId, 0),
    computeTokenIdB(conditionId, 1),
  ];

  for (const tokenId of tokensToCheck) {
    const q = `
      SELECT count() as cnt
      FROM pm_trader_events_v2
      WHERE token_id = '${tokenId}'
        AND is_deleted = 0
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const result = (await r.json())[0] as { cnt: number };
    console.log(`  Token ${tokenId.slice(0, 30)}...: ${result.cnt} trades`);
  }

  // Get a sample traded token and see what it looks like
  console.log('\n4. Sample traded tokens from CLOB...');
  const q4 = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    LIMIT 3
  `;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const tradedTokens = (await r4.json()) as { token_id: string }[];
  for (const t of tradedTokens) {
    console.log(`  ${t.token_id}`);
    // Convert to hex to see pattern
    const hex = '0x' + BigInt(t.token_id).toString(16).padStart(64, '0');
    console.log(`    Hex: ${hex}`);
  }

  // Check if CTF event condition appears anywhere in known mappings
  console.log(`\n5. Checking if condition ${conditionId} is in any mapping table...`);
  const q5 = `
    SELECT
      (SELECT count() FROM pm_token_to_condition_map_v5 WHERE condition_id = '${conditionId}') as in_v5,
      (SELECT count() FROM pm_token_to_condition_patch WHERE condition_id = '${conditionId}') as in_patch,
      (SELECT count() FROM pm_market_metadata FINAL WHERE condition_id = '${conditionId}') as in_metadata
  `;
  const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
  console.log('Condition found in:', await r5.json());

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
