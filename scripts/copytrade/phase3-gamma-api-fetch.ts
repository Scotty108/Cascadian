/**
 * Phase 3: Fetch unmapped token mappings from Gamma API
 *
 * Gamma API can look up token → market info including outcome
 * Rate limited, so we batch carefully
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface GammaMarket {
  tokens: Array<{
    token_id: string;
    outcome: string;
    winner: boolean;
  }>;
  condition_id: string;
  question: string;
}

async function fetchMarketByCondition(conditionId: string): Promise<GammaMarket | null> {
  try {
    const url = `${GAMMA_API}/markets?condition_ids=${conditionId}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== PHASE 3: GAMMA API FETCH ===\n');

  // Step 1: Get unmapped tokens grouped by condition
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
    CREATE TABLE tmp_split_conditions ENGINE = MergeTree() ORDER BY condition_id AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_token_txhash)
  `});

  // Step 2: Get unique unmapped conditions
  console.log('\nStep 2: Finding unmapped conditions...');
  const condQ = `
    SELECT DISTINCT s.condition_id, count(DISTINCT t.token_id) as token_count
    FROM tmp_token_txhash t
    JOIN tmp_split_conditions s ON t.tx_hash = s.tx_hash
    GROUP BY s.condition_id
    ORDER BY token_count DESC
  `;
  const condR = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
  const conditions = await condR.json() as any[];

  console.log(`  Found ${conditions.length} unmapped conditions`);

  // Step 3: Query Gamma API for each condition (with rate limiting)
  console.log('\nStep 3: Fetching from Gamma API...');

  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
  }> = [];

  let found = 0;
  let notFound = 0;
  let errors = 0;

  const BATCH_SIZE = 50;
  const DELAY_MS = 1000; // 1 second between batches

  for (let i = 0; i < Math.min(conditions.length, 500); i++) { // Limit to 500 for initial test
    const cond = conditions[i];

    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`  Processed ${i}/${Math.min(conditions.length, 500)} conditions (found: ${found}, not found: ${notFound})...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    try {
      const market = await fetchMarketByCondition(cond.condition_id);

      if (market && market.tokens) {
        for (const token of market.tokens) {
          // outcome is "Yes" or "No" - convert to index
          const outcomeIndex = token.outcome.toLowerCase() === 'yes' ? 0 : 1;
          derivedMappings.push({
            token_id_dec: token.token_id,
            condition_id: cond.condition_id,
            outcome_index: outcomeIndex,
            question: market.question || ''
          });
        }
        found++;
      } else {
        notFound++;
      }
    } catch (e) {
      errors++;
    }
  }

  console.log(`\n  Total found: ${found}`);
  console.log(`  Not found (deleted?): ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Mappings derived: ${derivedMappings.length}`);

  // Step 4: Cross-reference with our unmapped tokens
  console.log('\nStep 4: Matching with unmapped tokens...');
  const unmappedQ = `SELECT token_id FROM tmp_unmapped_tokens`;
  const unmappedR = await clickhouse.query({ query: unmappedQ, format: 'JSONEachRow' });
  const unmappedTokens = new Set((await unmappedR.json() as any[]).map(t => t.token_id));

  const matchedMappings = derivedMappings.filter(m => unmappedTokens.has(m.token_id_dec));
  console.log(`  Matched with unmapped tokens: ${matchedMappings.length}`);

  // Step 5: Export
  console.log('\nStep 5: Exporting...');

  let csv = 'token_id_dec,condition_id,outcome_index,question\n';
  for (const m of matchedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index},"${m.question.replace(/"/g, '""')}"\n`;
  }
  fs.writeFileSync('exports/phase3_gamma_mappings.csv', csv);

  if (matchedMappings.length > 0) {
    const values = matchedMappings.map(m =>
      `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'gamma_api_fetch')`
    ).join(',\n');

    const sql = `
INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source)
VALUES
${values};
`;
    fs.writeFileSync('exports/phase3_gamma_insert.sql', sql);
  }

  console.log(`  Exported ${matchedMappings.length} mappings`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Conditions queried: ${Math.min(conditions.length, 500)}`);
  console.log(`Markets found in Gamma: ${found}`);
  console.log(`Mappings derived: ${derivedMappings.length}`);
  console.log(`Matched unmapped tokens: ${matchedMappings.length}`);

  // Cleanup
  console.log('\nCleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });
  console.log('Done');
}

main().catch(console.error);
