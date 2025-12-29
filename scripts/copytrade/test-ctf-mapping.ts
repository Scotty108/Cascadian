/**
 * Test CTF-based token mapping for our calibration wallet
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

// Compute token_id from condition_id and outcome_index
function computeTokenId(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  const packed = encodePacked(
    ['bytes32', 'uint256'],
    [condId as `0x${string}`, BigInt(outcomeIndex)]
  );
  const hash = keccak256(packed);
  return BigInt(hash).toString();
}

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== TESTING CTF-BASED TOKEN MAPPING ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  // Get CTF conditions for this wallet
  console.log('1. Getting CTF conditions from this wallet...');
  const q1 = `
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND condition_id != ''
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const conditions = (await r1.json()) as { condition_id: string }[];
  console.log(`Found ${conditions.length} unique conditions from CTF events`);

  // Compute token_ids for these conditions
  console.log('\n2. Computing token_ids from conditions...');
  const computedTokens: { conditionId: string; outcomeIdx: number; tokenId: string }[] = [];
  for (const row of conditions) {
    const conditionId = row.condition_id;
    for (let outcomeIdx = 0; outcomeIdx < 2; outcomeIdx++) {
      const tokenId = computeTokenId(conditionId, outcomeIdx);
      computedTokens.push({ conditionId, outcomeIdx, tokenId });
    }
  }
  console.log(`Computed ${computedTokens.length} token_ids`);

  // Get wallet's traded tokens
  console.log('\n3. Getting traded tokens from CLOB...');
  const q3 = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const tradedTokensArr = (await r3.json()) as { token_id: string }[];
  const tradedTokens = new Set(tradedTokensArr.map((r) => r.token_id));
  console.log(`Wallet traded ${tradedTokens.size} unique tokens`);

  // Find matches
  console.log('\n4. Checking which computed tokens match traded tokens...');
  let matches = 0;
  const matchedConditions = new Set<string>();
  const matchedDetails: { conditionId: string; tokenId: string }[] = [];

  for (const ct of computedTokens) {
    if (tradedTokens.has(ct.tokenId)) {
      matches++;
      matchedConditions.add(ct.conditionId);
      matchedDetails.push({ conditionId: ct.conditionId, tokenId: ct.tokenId });
    }
  }

  console.log(`Found ${matches} matching tokens from ${matchedConditions.size} conditions`);
  console.log(
    `Coverage: ${matches}/${tradedTokens.size} tokens (${((matches / tradedTokens.size) * 100).toFixed(1)}%)`
  );

  // Show sample matched tokens
  console.log('\n5. Sample matched tokens:');
  for (const match of matchedDetails.slice(0, 5)) {
    console.log(`  Condition: ${match.conditionId.slice(0, 16)}...`);
    console.log(`  Token:     ${match.tokenId.slice(0, 30)}...`);
  }

  // Show unmatched tokens
  console.log('\n6. Unmatched tokens (from CLOB but not in CTF):');
  const computedTokenSet = new Set(computedTokens.map((ct) => ct.tokenId));
  let unmatchedShown = 0;
  for (const tradedToken of tradedTokens) {
    if (!computedTokenSet.has(tradedToken)) {
      console.log(`  ${tradedToken.slice(0, 40)}...`);
      unmatchedShown++;
      if (unmatchedShown >= 5) break;
    }
  }
  console.log(`  ... (${tradedTokens.size - matches} total unmatched)`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
