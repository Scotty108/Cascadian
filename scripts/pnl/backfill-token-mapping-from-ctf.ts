/**
 * Backfill token mapping from CTF events
 *
 * CTF events (PayoutRedemption, PositionSplit, PositionsMerge) contain condition_id
 * which we can use to derive token_ids and fill mapping gaps.
 *
 * Token ID = keccak256(conditionId, outcomeSlotIndex)
 *
 * This script:
 * 1. Gets unique condition_ids from CTF events that aren't in the mapping
 * 2. Computes token_ids for each outcome (assuming 2 outcomes for binary markets)
 * 3. Inserts into pm_token_to_condition_patch for later merging
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// Compute token_id from condition_id and outcome_index
// Polymarket uses: keccak256(abi.encodePacked(conditionId, outcomeSlotIndex))
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
  console.log('='.repeat(80));
  console.log('BACKFILL TOKEN MAPPING FROM CTF EVENTS');
  console.log('='.repeat(80));

  // Step 1: Find condition_ids in CTF events that aren't in current mapping
  console.log('\nStep 1: Finding unmapped condition_ids...');

  const q1 = `
    SELECT DISTINCT c.condition_id
    FROM pm_ctf_events c
    LEFT JOIN (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_map_v5
    ) m ON c.condition_id = m.condition_id
    WHERE c.is_deleted = 0
      AND c.condition_id != ''
      AND m.condition_id IS NULL
    LIMIT 10000
  `;

  const r1 = await client.query({ query: q1, format: 'JSONEachRow' });
  const unmappedConditions = (await r1.json()) as { condition_id: string }[];
  console.log(`Found ${unmappedConditions.length} unmapped condition_ids in CTF events`);

  if (unmappedConditions.length === 0) {
    console.log('\nNo unmapped conditions found. Token mapping is complete!');
    await client.close();
    return;
  }

  // Step 2: Compute token_ids for each condition (2 outcomes for binary markets)
  console.log('\nStep 2: Computing token_ids...');

  const newMappings: {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }[] = [];

  for (const row of unmappedConditions) {
    const conditionId = row.condition_id;

    // Compute token_id for outcome 0 and 1 (binary markets)
    for (let outcomeIdx = 0; outcomeIdx < 2; outcomeIdx++) {
      try {
        const tokenIdDec = computeTokenId(conditionId, outcomeIdx);
        newMappings.push({
          token_id_dec: tokenIdDec,
          condition_id: conditionId,
          outcome_index: outcomeIdx,
        });
      } catch (e) {
        console.warn(`Failed to compute token_id for ${conditionId}:${outcomeIdx}:`, e);
      }
    }
  }

  console.log(`Computed ${newMappings.length} new token mappings`);

  // Step 3: Verify a sample against existing CLOB trades
  console.log('\nStep 3: Verifying computed mappings against CLOB trades...');

  const sampleTokens = newMappings.slice(0, 10).map((m) => `'${m.token_id_dec}'`).join(',');
  const verifyQ = `
    SELECT
      count(DISTINCT token_id) as matched_tokens
    FROM pm_trader_events_v2
    WHERE token_id IN (${sampleTokens})
      AND is_deleted = 0
  `;

  const verifyR = await client.query({ query: verifyQ, format: 'JSONEachRow' });
  const verifyRows = (await verifyR.json()) as { matched_tokens: number }[];
  console.log(`Sample verification: ${verifyRows[0]?.matched_tokens || 0}/10 tokens found in CLOB trades`);

  // Step 4: Insert into patch table
  console.log('\nStep 4: Inserting into pm_token_to_condition_patch...');

  // Batch insert
  const batchSize = 1000;
  let inserted = 0;

  for (let i = 0; i < newMappings.length; i += batchSize) {
    const batch = newMappings.slice(i, i + batchSize);

    const values = batch
      .map(
        (m) =>
          `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'CTF-derived market', 'backfill', 'ctf_events_backfill', now())`
      )
      .join(',');

    await client.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id_dec, condition_id, outcome_index, question, category, source, created_at)
        VALUES ${values}
      `,
    });

    inserted += batch.length;
    if (inserted % 5000 === 0) {
      console.log(`  Inserted ${inserted}/${newMappings.length}...`);
    }
  }

  console.log(`\n✅ Inserted ${inserted} new mappings into pm_token_to_condition_patch`);

  // Step 5: Check coverage improvement
  console.log('\nStep 5: Checking coverage improvement...');

  const coverageQ = `
    WITH all_tokens AS (
      SELECT DISTINCT token_id FROM pm_trader_events_v2 WHERE is_deleted = 0
    ),
    v5_mapped AS (
      SELECT token_id_dec FROM pm_token_to_condition_map_v5
    ),
    patch_mapped AS (
      SELECT token_id_dec FROM pm_token_to_condition_patch
    )
    SELECT
      count() as total_tokens,
      countIf(v5.token_id_dec IS NOT NULL) as v5_mapped,
      countIf(patch.token_id_dec IS NOT NULL) as patch_mapped,
      countIf(v5.token_id_dec IS NOT NULL OR patch.token_id_dec IS NOT NULL) as combined_mapped
    FROM all_tokens t
    LEFT JOIN v5_mapped v5 ON t.token_id = v5.token_id_dec
    LEFT JOIN patch_mapped patch ON t.token_id = patch.token_id_dec
  `;

  const coverageR = await client.query({ query: coverageQ, format: 'JSONEachRow' });
  const coverageRows = (await coverageR.json()) as any[];
  console.log('Coverage:');
  console.log(JSON.stringify(coverageRows[0], null, 2));

  await client.close();
  console.log('\n✅ Backfill complete!');
}

main().catch(console.error);
