/**
 * Map ALL unmapped tokens using redemption inference
 *
 * For resolved markets:
 * - Winner tokens redeem for $1/share
 * - Loser tokens are worthless
 *
 * Strategy:
 * 1. Find all unmapped tokens
 * 2. Get their conditions via tx_hash correlation
 * 3. For each condition, look at redemption payouts
 * 4. Token with high payout/share = winner (outcome that resolved to 1)
 * 5. Map accordingly
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== MAP ALL TOKENS VIA REDEMPTION INFERENCE ===\n');

  // Step 1: Create temp table with ALL unmapped tokens
  console.log('Step 1: Finding ALL unmapped tokens...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_conditions` });

  await clickhouse.command({ query: `
    CREATE TABLE tmp_all_unmapped ENGINE = MergeTree() ORDER BY token_id AS
    WITH all_tokens AS (
      SELECT DISTINCT token_id FROM pm_trader_events_v2 WHERE is_deleted = 0
    ),
    mapped AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT a.token_id
    FROM all_tokens a
    LEFT JOIN mapped m ON a.token_id = m.token_id
    WHERE m.token_id IS NULL OR m.token_id = ''
  `});

  const unmappedCountQ = `SELECT count() as cnt FROM tmp_all_unmapped`;
  const unmappedCountR = await clickhouse.query({ query: unmappedCountQ, format: 'JSONEachRow' });
  const { cnt: unmappedCount } = (await unmappedCountR.json() as any[])[0];
  console.log(`  Found ${unmappedCount} unmapped tokens\n`);

  // Step 2: Find tx_hashes
  console.log('Step 2: Finding tx_hashes...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_all_txhash ENGINE = MergeTree() ORDER BY token_id AS
    SELECT token_id, any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_all_unmapped) AND is_deleted = 0
    GROUP BY token_id
  `});

  const txCountQ = `SELECT count() as cnt FROM tmp_all_txhash`;
  const txCountR = await clickhouse.query({ query: txCountQ, format: 'JSONEachRow' });
  const { cnt: txCount } = (await txCountR.json() as any[])[0];
  console.log(`  Found ${txCount} tx_hashes\n`);

  // Step 3: Find conditions via CTF splits
  console.log('Step 3: Finding conditions via tx_hash correlation...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_all_conditions ENGINE = MergeTree() ORDER BY condition_id AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_all_txhash)
  `});

  const condCountQ = `SELECT countDistinct(condition_id) as cnt FROM tmp_all_conditions`;
  const condCountR = await clickhouse.query({ query: condCountQ, format: 'JSONEachRow' });
  const { cnt: condCount } = (await condCountR.json() as any[])[0];
  console.log(`  Found ${condCount} unique conditions\n`);

  // Step 4: Get token → condition pairs
  console.log('Step 4: Loading token → condition pairs...');

  const pairsQ = `
    SELECT t.token_id, c.condition_id
    FROM tmp_all_txhash t
    JOIN tmp_all_conditions c ON t.tx_hash = c.tx_hash
  `;
  const pairsR = await clickhouse.query({ query: pairsQ, format: 'JSONEachRow' });
  const pairs = await pairsR.json() as any[];

  // Group by condition
  const conditionToTokens = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!conditionToTokens.has(p.condition_id)) {
      conditionToTokens.set(p.condition_id, new Set());
    }
    conditionToTokens.get(p.condition_id)!.add(p.token_id);
  }

  console.log(`  ${pairs.length} token-condition pairs`);
  console.log(`  ${conditionToTokens.size} unique conditions with tokens\n`);

  // Step 5: Get resolution prices
  console.log('Step 5: Getting resolution prices...');

  const resQ = `
    SELECT condition_id, payout_numerators
    FROM pm_resolutions
    WHERE is_deleted = 0
      AND condition_id IN (SELECT DISTINCT condition_id FROM tmp_all_conditions)
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  const resolutionMap = new Map<string, string>();
  for (const r of resolutions) {
    resolutionMap.set(r.condition_id, r.payout_numerators);
  }

  console.log(`  Found ${resolutions.length} resolved conditions\n`);

  // Step 6: For binary markets with 2 tokens, use resolution data to assign outcomes
  console.log('Step 6: Deriving outcome mappings...');

  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }> = [];

  let binaryWithRes = 0;
  let binaryNoRes = 0;
  let singleToken = 0;
  let multiOutcome = 0;

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    const tokenArray = Array.from(tokens);

    if (tokenArray.length === 2) {
      const payouts = resolutionMap.get(conditionId);

      if (payouts) {
        // Parse payout_numerators like "[1000000000000000000,0]"
        // First is outcome 0, second is outcome 1
        // The one with high payout is the winner
        try {
          const parsed = JSON.parse(payouts);
          const outcome0Wins = BigInt(parsed[0]) > BigInt(parsed[1]);

          // Sort tokens to get consistent ordering
          const sorted = tokenArray.sort((a, b) => {
            const aBig = BigInt(a);
            const bBig = BigInt(b);
            return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
          });

          // We need to determine which token is which outcome
          // Use the payout data from redemptions to figure this out
          // For now, we'll mark as needing calibration
          // TODO: Look at actual redemption amounts per token

          // Placeholder: assign based on token order (will need calibration)
          derivedMappings.push({
            token_id_dec: sorted[0],
            condition_id: conditionId,
            outcome_index: 0
          });
          derivedMappings.push({
            token_id_dec: sorted[1],
            condition_id: conditionId,
            outcome_index: 1
          });

          binaryWithRes++;
        } catch {
          binaryNoRes++;
        }
      } else {
        binaryNoRes++;
      }
    } else if (tokenArray.length === 1) {
      singleToken++;
    } else {
      multiOutcome++;
    }
  }

  console.log(`  Binary markets with resolution: ${binaryWithRes}`);
  console.log(`  Binary markets without resolution: ${binaryNoRes}`);
  console.log(`  Single-token (incomplete): ${singleToken}`);
  console.log(`  Multi-outcome: ${multiOutcome}`);
  console.log(`  Total mappings derived: ${derivedMappings.length}`);

  // Step 7: Export
  console.log('\nStep 7: Exporting...');

  // CSV
  let csv = 'token_id_dec,condition_id,outcome_index\n';
  for (const m of derivedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index}\n`;
  }
  fs.writeFileSync('exports/all_tokens_derived_mappings.csv', csv);

  // SQL insert (for review before applying)
  const BATCH_SIZE = 10000;
  for (let i = 0; i < derivedMappings.length; i += BATCH_SIZE) {
    const batch = derivedMappings.slice(i, i + BATCH_SIZE);
    const values = batch.map(m =>
      `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'redemption_inference')`
    ).join(',\n');

    const sql = `INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source) VALUES\n${values};`;
    fs.writeFileSync(`exports/all_tokens_insert_batch_${Math.floor(i / BATCH_SIZE)}.sql`, sql);
  }

  console.log(`  Exported ${derivedMappings.length} mappings`);
  console.log(`  SQL batches: ${Math.ceil(derivedMappings.length / BATCH_SIZE)}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Unmapped tokens: ${unmappedCount}`);
  console.log(`Conditions via tx_hash: ${conditionToTokens.size}`);
  console.log(`Resolved conditions: ${resolutions.length}`);
  console.log(`Mappings derived: ${derivedMappings.length}`);

  const coverage = ((derivedMappings.length / parseInt(unmappedCount)) * 100).toFixed(1);
  console.log(`\nPotential coverage improvement: ${coverage}%`);
  console.log('\nNOTE: These mappings use token ordering as placeholder.');
  console.log('They need CALIBRATION against ground truth to determine correct outcome assignment.');

  // Cleanup
  console.log('\nCleaning up...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_all_conditions` });
  console.log('Done');
}

main().catch(console.error);
