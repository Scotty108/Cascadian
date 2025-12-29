/**
 * Phase 3: Derive token → outcome mappings for all unmapped tokens
 *
 * Uses CTF token_id calculation formula:
 * token_id = uint256(keccak256(parentCollectionId || conditionId || indexSet))
 *
 * For binary markets:
 * - indexSet 1 (0b01) = outcome_index 0
 * - indexSet 2 (0b10) = outcome_index 1
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, toHex, concat, pad, numberToHex } from 'viem';
import * as fs from 'fs';

// Calculate CTF token_id from condition_id and outcome_index
function calculateTokenId(conditionId: string, outcomeIndex: number): string {
  // Parent collection ID is 32 bytes of zeros for top-level positions
  const parentCollectionId = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

  // Condition ID as 32 bytes (ensure no 0x prefix, then add it)
  const condIdHex = ('0x' + conditionId.replace('0x', '')) as `0x${string}`;

  // Index set: outcome 0 = 1, outcome 1 = 2
  const indexSet = outcomeIndex === 0 ? 1 : 2;
  // Pad to 32 bytes
  const indexSetHex = pad(numberToHex(indexSet), { size: 32 });

  // Concatenate and hash
  const packed = concat([parentCollectionId, condIdHex, indexSetHex]);
  const hash = keccak256(packed);

  // Convert hash to decimal string (this is the token_id)
  return BigInt(hash).toString();
}

async function main() {
  console.log('=== PHASE 3: DERIVE TOKEN MAPPINGS ===\n');

  // Step 1: Recreate temp tables (in case they were cleaned up)
  console.log('Step 1: Setting up temp tables...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });

  // Create unmapped tokens table
  const createTokensQ = `
    CREATE TABLE tmp_unmapped_tokens ENGINE = MergeTree() ORDER BY token_id AS
    WITH cohort_tokens AS (
      SELECT DISTINCT token_id FROM pm_trader_events_v2
      WHERE trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4) AND is_deleted = 0
    ),
    mapped_tokens AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT ct.token_id FROM cohort_tokens ct
    LEFT JOIN mapped_tokens mt ON ct.token_id = mt.token_id
    WHERE mt.token_id IS NULL OR mt.token_id = ''
  `;
  await clickhouse.command({ query: createTokensQ });

  // Create tx_hash lookup
  const createTxHashQ = `
    CREATE TABLE tmp_token_txhash ENGINE = MergeTree() ORDER BY token_id AS
    SELECT token_id, any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_unmapped_tokens) AND is_deleted = 0
    GROUP BY token_id
  `;
  await clickhouse.command({ query: createTxHashQ });

  // Create split conditions lookup
  const createSplitsQ = `
    CREATE TABLE tmp_split_conditions ENGINE = MergeTree() ORDER BY tx_hash AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_token_txhash)
  `;
  await clickhouse.command({ query: createSplitsQ });

  console.log('  Temp tables created');

  // Step 2: Get all token → condition correlations
  console.log('\nStep 2: Loading token → condition correlations...');
  const corrQ = `
    SELECT t.token_id, s.condition_id
    FROM tmp_token_txhash t
    JOIN tmp_split_conditions s ON t.tx_hash = s.tx_hash
  `;
  const corrR = await clickhouse.query({ query: corrQ, format: 'JSONEachRow' });
  const correlations = await corrR.json() as any[];

  console.log(`  Found ${correlations.length} token-condition pairs`);

  // Build condition → tokens map
  const conditionToTokens = new Map<string, Set<string>>();
  for (const c of correlations) {
    if (!conditionToTokens.has(c.condition_id)) {
      conditionToTokens.set(c.condition_id, new Set());
    }
    conditionToTokens.get(c.condition_id)!.add(c.token_id);
  }

  console.log(`  Unique conditions: ${conditionToTokens.size}`);

  // Step 3: For each condition, compute expected token_ids and match
  console.log('\nStep 3: Computing token → outcome mappings...');

  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }> = [];

  let matched = 0;
  let unmatched = 0;
  let singleToken = 0;

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    const tokenArray = Array.from(tokens);

    if (tokenArray.length === 0) continue;

    // Calculate expected token_ids for outcomes 0 and 1
    const expectedToken0 = calculateTokenId(conditionId, 0);
    const expectedToken1 = calculateTokenId(conditionId, 1);

    // Match against actual tokens
    for (const actualToken of tokenArray) {
      if (actualToken === expectedToken0) {
        derivedMappings.push({
          token_id_dec: actualToken,
          condition_id: conditionId,
          outcome_index: 0
        });
        matched++;
      } else if (actualToken === expectedToken1) {
        derivedMappings.push({
          token_id_dec: actualToken,
          condition_id: conditionId,
          outcome_index: 1
        });
        matched++;
      } else {
        // Token doesn't match expected - might be multi-outcome market or error
        unmatched++;
      }
    }

    if (tokenArray.length === 1) singleToken++;
  }

  console.log(`  Matched: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);
  console.log(`  Single-token conditions: ${singleToken}`);

  // Step 4: Get resolution coverage for matched mappings
  console.log('\nStep 4: Checking resolution coverage...');
  const mappedConditions = new Set(derivedMappings.map(m => m.condition_id));
  const condList = Array.from(mappedConditions).slice(0, 10000); // Limit for query

  const resQ = `
    SELECT DISTINCT condition_id
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${condList.map(c => `'${c}'`).join(',')})
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolvedConditions = new Set((await resR.json() as any[]).map(r => r.condition_id));

  const resolved = Array.from(mappedConditions).filter(c => resolvedConditions.has(c)).length;
  console.log(`  Resolved conditions: ${resolved} / ${mappedConditions.size}`);

  // Step 5: Export mappings
  console.log('\nStep 5: Exporting mappings...');

  // CSV export
  let csv = 'token_id_dec,condition_id,outcome_index\n';
  for (const m of derivedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index}\n`;
  }
  fs.writeFileSync('exports/phase3_derived_mappings.csv', csv);

  // Generate SQL insert
  const insertValues = derivedMappings.slice(0, 50000).map(m =>
    `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'phase3_derived')`
  ).join(',\n');

  const insertSQL = `
INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source)
VALUES
${insertValues}
  `;
  fs.writeFileSync('exports/phase3_insert.sql', insertSQL);

  console.log(`  Exported ${derivedMappings.length} mappings to:`);
  console.log(`    - exports/phase3_derived_mappings.csv`);
  console.log(`    - exports/phase3_insert.sql`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Derived mappings: ${derivedMappings.length}`);
  console.log(`Unique conditions covered: ${mappedConditions.size}`);
  console.log(`Resolved conditions: ${resolved}`);

  console.log('\n=== OUTCOME DISTRIBUTION ===');
  const outcome0 = derivedMappings.filter(m => m.outcome_index === 0).length;
  const outcome1 = derivedMappings.filter(m => m.outcome_index === 1).length;
  console.log(`Outcome 0 tokens: ${outcome0}`);
  console.log(`Outcome 1 tokens: ${outcome1}`);

  // Cleanup
  console.log('\nCleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });
  console.log('Done');
}

main().catch(console.error);
