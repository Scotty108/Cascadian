/**
 * Run CTF token backfill once (same logic as cron endpoint)
 *
 * This maps tokens from CTF events using keccak256(conditionId || outcomeIndex)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const BATCH_SIZE = 5000;

function computeTokenId(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  const packed = encodePacked(['bytes32', 'uint256'], [condId as `0x${string}`, BigInt(outcomeIndex)]);
  const hash = keccak256(packed);
  return BigInt(hash).toString();
}

async function main() {
  console.log('='.repeat(80));
  console.log('CTF TOKEN BACKFILL (ONE-TIME RUN)');
  console.log('='.repeat(80));

  // Step 1: Get current coverage
  const coverageQ = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
    )
    SELECT
      count() as total,
      countIf(v5.token_id_dec IS NOT NULL AND v5.token_id_dec != '') as mapped_v5,
      countIf(p.token_id_dec IS NOT NULL AND p.token_id_dec != '') as mapped_patch,
      countIf(
        (v5.token_id_dec IS NOT NULL AND v5.token_id_dec != '') OR
        (p.token_id_dec IS NOT NULL AND p.token_id_dec != '')
      ) as mapped
    FROM recent_tokens r
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON r.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON r.token_id = p.token_id_dec
  `;
  const covR = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
  const covRows = (await covR.json()) as any[];
  const cov = covRows[0];
  const covBefore = cov.total > 0 ? Math.round((Number(cov.mapped) / Number(cov.total)) * 1000) / 10 : 100;
  console.log(`\nCoverage before: ${covBefore}% (${cov.mapped}/${cov.total})`);

  // Step 2: Find unmapped conditions
  console.log('\nFinding unmapped condition_ids from CTF events...');

  const q1 = `
    WITH ctf_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND condition_id != ''
        AND event_timestamp >= now() - INTERVAL 30 DAY
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
    LIMIT ${BATCH_SIZE}
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const unmappedConditions = (await r1.json()) as { condition_id: string }[];
  console.log(`Found ${unmappedConditions.length} unmapped condition_ids`);

  if (unmappedConditions.length === 0) {
    console.log('\nAll CTF conditions are mapped!');
    return;
  }

  // Step 3: Compute token_ids
  console.log('\nComputing token_ids using keccak256...');

  const newMappings: {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }[] = [];

  for (const row of unmappedConditions) {
    const conditionId = row.condition_id;

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

  // Step 4: Verify
  const sampleTokens = newMappings.slice(0, 20).map((m) => `'${m.token_id_dec}'`).join(',');
  const verifyQ = `
    SELECT count(DISTINCT token_id) as matched_tokens
    FROM pm_trader_events_v2
    WHERE token_id IN (${sampleTokens})
      AND is_deleted = 0
  `;
  const verifyR = await clickhouse.query({ query: verifyQ, format: 'JSONEachRow' });
  const verifyRows = (await verifyR.json()) as { matched_tokens: number }[];
  const verified = verifyRows[0]?.matched_tokens || 0;
  console.log(`Sample verification: ${verified}/20 tokens found in CLOB trades`);

  // Step 5: Insert
  console.log('\nInserting into pm_token_to_condition_patch...');

  const insertBatchSize = 500;
  let inserted = 0;

  for (let i = 0; i < newMappings.length; i += insertBatchSize) {
    const batch = newMappings.slice(i, i + insertBatchSize);

    const values = batch
      .map(
        (m) =>
          `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'CTF-derived market', 'crypto-15min', 'ctf_backfill_script', now())`
      )
      .join(',');

    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id_dec, condition_id, outcome_index, question, category, source, created_at)
        VALUES ${values}
      `,
    });

    inserted += batch.length;
    if (inserted % 1000 === 0) {
      console.log(`  Inserted ${inserted}/${newMappings.length}...`);
    }
  }

  console.log(`Inserted ${inserted} new mappings`);

  // Step 6: Check coverage after
  const covAfterR = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
  const covAfterRows = (await covAfterR.json()) as any[];
  const covAfter = covAfterRows[0];
  const covAfterPct = covAfter.total > 0 ? Math.round((Number(covAfter.mapped) / Number(covAfter.total)) * 1000) / 10 : 100;

  console.log('\n' + '='.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log(`  Conditions mapped: ${unmappedConditions.length}`);
  console.log(`  Token mappings created: ${inserted}`);
  console.log(`  Coverage: ${covBefore}% → ${covAfterPct}%`);
  console.log('='.repeat(80));
}

main().catch(console.error);
