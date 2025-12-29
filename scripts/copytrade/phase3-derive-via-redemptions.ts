/**
 * Phase 3: Derive token → outcome via redemption events
 *
 * For resolved markets:
 * - Winner token holders redeem for $1 per share
 * - Loser token holders get $0
 *
 * Strategy: Look at redemption events - if a token was redeemed for $1 per share,
 * it's the winner (resolution_price = 1.0)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 3: DERIVE MAPPINGS VIA REDEMPTIONS ===\n');

  // Step 1: Set up temp tables
  console.log('Step 1: Setting up temp tables...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });

  await clickhouse.command({ query: `
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
  `});

  await clickhouse.command({ query: `
    CREATE TABLE tmp_token_txhash ENGINE = MergeTree() ORDER BY token_id AS
    SELECT token_id, any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_unmapped_tokens) AND is_deleted = 0
    GROUP BY token_id
  `});

  await clickhouse.command({ query: `
    CREATE TABLE tmp_split_conditions ENGINE = MergeTree() ORDER BY tx_hash AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_token_txhash)
  `});

  console.log('  Temp tables created');

  // Step 2: Get token → condition pairs
  console.log('\nStep 2: Loading token → condition pairs...');
  const pairsQ = `
    SELECT t.token_id, s.condition_id
    FROM tmp_token_txhash t
    JOIN tmp_split_conditions s ON t.tx_hash = s.tx_hash
  `;
  const pairsR = await clickhouse.query({ query: pairsQ, format: 'JSONEachRow' });
  const pairs = await pairsR.json() as any[];

  const conditionToTokens = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!conditionToTokens.has(p.condition_id)) {
      conditionToTokens.set(p.condition_id, new Set());
    }
    conditionToTokens.get(p.condition_id)!.add(p.token_id);
  }

  console.log(`  Token pairs: ${pairs.length}`);
  console.log(`  Unique conditions: ${conditionToTokens.size}`);

  // Step 3: Get resolution prices
  console.log('\nStep 3: Loading resolution prices...');
  const conditions = Array.from(conditionToTokens.keys());

  // Batch query for resolutions
  const resQ = `
    SELECT condition_id, payout_numerators
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (SELECT DISTINCT condition_id FROM tmp_split_conditions)
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  const resolutionMap = new Map<string, string>();
  for (const r of resolutions) {
    resolutionMap.set(r.condition_id, r.payout_numerators);
  }

  console.log(`  Resolved conditions: ${resolutions.length}`);

  // Step 4: For binary markets, derive outcome based on token count per condition
  console.log('\nStep 4: Deriving outcome mappings...');

  // For conditions with exactly 2 tokens, we need to figure out which is 0 and which is 1
  // We'll use the fact that Polymarket always creates tokens in order:
  // The first token (lower token_id) is outcome 0, second is outcome 1

  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }> = [];

  let binaryMarkets = 0;
  let singleTokenMarkets = 0;
  let multiOutcomeMarkets = 0;

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    const tokenArray = Array.from(tokens);

    if (tokenArray.length === 2) {
      // Binary market - sort tokens by numeric value to determine order
      const sorted = tokenArray.sort((a, b) => {
        const aBig = BigInt(a);
        const bBig = BigInt(b);
        return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
      });

      // First (smaller) token is outcome 0, second is outcome 1
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

      binaryMarkets++;
    } else if (tokenArray.length === 1) {
      // Only one token found - we don't know the outcome
      // This happens when a wallet only traded one side
      singleTokenMarkets++;
    } else {
      // Multi-outcome market (>2 tokens) - more complex
      multiOutcomeMarkets++;
    }
  }

  console.log(`  Binary markets (2 tokens): ${binaryMarkets}`);
  console.log(`  Single-token (incomplete): ${singleTokenMarkets}`);
  console.log(`  Multi-outcome: ${multiOutcomeMarkets}`);
  console.log(`  Derived mappings: ${derivedMappings.length}`);

  // Step 5: Check resolution coverage for derived mappings
  const derivedConditions = new Set(derivedMappings.map(m => m.condition_id));
  const resolvedDerived = Array.from(derivedConditions).filter(c => resolutionMap.has(c));
  console.log(`\n  Derived conditions with resolution: ${resolvedDerived.length} / ${derivedConditions.size}`);

  // Step 6: Export
  console.log('\nStep 5: Exporting...');

  // CSV
  let csv = 'token_id_dec,condition_id,outcome_index\n';
  for (const m of derivedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index}\n`;
  }
  fs.writeFileSync('exports/phase3_derived_mappings.csv', csv);

  // SQL insert (for pm_token_to_condition_patch)
  const batchSize = 10000;
  for (let i = 0; i < derivedMappings.length; i += batchSize) {
    const batch = derivedMappings.slice(i, i + batchSize);
    const values = batch.map(m =>
      `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'phase3_sorted')`
    ).join(',\n');

    const sql = `
INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source)
VALUES
${values};
`;
    fs.writeFileSync(`exports/phase3_insert_batch_${Math.floor(i / batchSize)}.sql`, sql);
  }

  console.log(`  Exported ${derivedMappings.length} mappings`);
  console.log(`  SQL batches: ${Math.ceil(derivedMappings.length / batchSize)}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Conditions with 2 tokens: ${binaryMarkets}`);
  console.log(`Mappings derived: ${derivedMappings.length}`);
  console.log(`Resolved conditions: ${resolvedDerived.length}`);

  // Cleanup
  console.log('\nCleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });
  console.log('Done');
}

main().catch(console.error);
