/**
 * Map 60-day unmapped tokens
 *
 * Strategy:
 * 1. Get unmapped tokens from last 60 days
 * 2. Find condition_ids via tx_hash correlation
 * 3. Query Gamma API for conditions (recent should work)
 * 4. Insert mappings to patch table
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
  category?: string;
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
  console.log('=== MAP 60-DAY UNMAPPED TOKENS ===\n');
  console.log('Target: 60,275 tokens → conditions → Gamma API → mappings\n');

  // Step 1: Create temp table with 60-day unmapped tokens
  console.log('Step 1: Creating temp table for 60-day unmapped tokens...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_conditions` });

  await clickhouse.command({ query: `
    CREATE TABLE tmp_60day_unmapped ENGINE = MergeTree() ORDER BY token_id AS
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 60 DAY
    ),
    mapped AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT r.token_id
    FROM recent_tokens r
    LEFT JOIN mapped m ON r.token_id = m.token_id
    WHERE m.token_id IS NULL OR m.token_id = ''
  `});

  const countQ = `SELECT count() as cnt FROM tmp_60day_unmapped`;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const { cnt } = (await countR.json() as any[])[0];
  console.log(`  Found ${cnt} unmapped tokens\n`);

  // Step 2: Find tx_hashes for these tokens
  console.log('Step 2: Finding tx_hashes...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_60day_txhash ENGINE = MergeTree() ORDER BY token_id AS
    SELECT token_id, any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_60day_unmapped)
      AND is_deleted = 0
    GROUP BY token_id
  `});

  const txCountQ = `SELECT count() as cnt, countDistinct(tx_hash) as tx_cnt FROM tmp_60day_txhash`;
  const txCountR = await clickhouse.query({ query: txCountQ, format: 'JSONEachRow' });
  const txCount = (await txCountR.json() as any[])[0];
  console.log(`  ${txCount.cnt} tokens with ${txCount.tx_cnt} unique tx_hashes\n`);

  // Step 3: Find conditions via CTF splits
  console.log('Step 3: Finding conditions via tx_hash correlation...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_60day_conditions ENGINE = MergeTree() ORDER BY condition_id AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_60day_txhash)
  `});

  const condCountQ = `SELECT countDistinct(condition_id) as cnt FROM tmp_60day_conditions`;
  const condCountR = await clickhouse.query({ query: condCountQ, format: 'JSONEachRow' });
  const condCount = (await condCountR.json() as any[])[0];
  console.log(`  Found ${condCount.cnt} unique conditions\n`);

  // Step 4: Get conditions with token mapping
  console.log('Step 4: Loading condition → token pairs...');

  const pairsQ = `
    SELECT s.condition_id, t.token_id
    FROM tmp_60day_txhash t
    JOIN tmp_60day_conditions s ON t.tx_hash = s.tx_hash
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
  console.log(`  ${conditionToTokens.size} unique conditions\n`);

  // Step 5: Query Gamma API for conditions
  console.log('Step 5: Querying Gamma API...');

  const conditions = Array.from(conditionToTokens.keys());
  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
    category: string;
  }> = [];

  let found = 0;
  let notFound = 0;

  // Process all conditions (no limit this time)
  const BATCH_SIZE = 100;
  const DELAY_MS = 500;

  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i];

    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`  Processed ${i}/${conditions.length} conditions (found: ${found}, not found: ${notFound})...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    try {
      const market = await fetchMarketByCondition(cond);

      if (market && market.tokens) {
        for (const token of market.tokens) {
          const outcomeIndex = token.outcome.toLowerCase() === 'yes' ? 0 : 1;
          derivedMappings.push({
            token_id_dec: token.token_id,
            condition_id: cond,
            outcome_index: outcomeIndex,
            question: market.question || '',
            category: market.category || ''
          });
        }
        found++;
      } else {
        notFound++;
      }
    } catch (e) {
      notFound++;
    }

    // Early exit status every 1000
    if (i > 0 && i % 1000 === 0) {
      const pct = ((found / (found + notFound)) * 100).toFixed(1);
      console.log(`  Hit rate: ${pct}% (${found} found, ${notFound} not found)`);
    }
  }

  console.log(`\n  Final: ${found} found, ${notFound} not found`);
  console.log(`  Hit rate: ${((found / (found + notFound)) * 100).toFixed(1)}%`);
  console.log(`  Mappings derived: ${derivedMappings.length}`);

  // Step 6: Match with our unmapped tokens
  console.log('\nStep 6: Matching with unmapped tokens...');

  const unmappedQ = `SELECT token_id FROM tmp_60day_unmapped`;
  const unmappedR = await clickhouse.query({ query: unmappedQ, format: 'JSONEachRow' });
  const unmappedTokens = new Set((await unmappedR.json() as any[]).map(t => t.token_id));

  const matchedMappings = derivedMappings.filter(m => unmappedTokens.has(m.token_id_dec));
  console.log(`  Matched: ${matchedMappings.length} / ${derivedMappings.length}`);

  // Step 7: Export
  console.log('\nStep 7: Exporting...');

  // CSV
  let csv = 'token_id_dec,condition_id,outcome_index,question,category\n';
  for (const m of matchedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index},"${m.question.replace(/"/g, '""')}","${m.category}"\n`;
  }
  fs.writeFileSync('exports/60day_gamma_mappings.csv', csv);

  // SQL insert batches
  const BATCH_INSERT = 10000;
  for (let i = 0; i < matchedMappings.length; i += BATCH_INSERT) {
    const batch = matchedMappings.slice(i, i + BATCH_INSERT);
    const values = batch.map(m =>
      `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'gamma_60day')`
    ).join(',\n');

    const sql = `INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source) VALUES\n${values};`;
    fs.writeFileSync(`exports/60day_insert_batch_${Math.floor(i / BATCH_INSERT)}.sql`, sql);
  }

  console.log(`  Exported ${matchedMappings.length} mappings`);
  console.log(`  SQL batches: ${Math.ceil(matchedMappings.length / BATCH_INSERT)}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`60-day unmapped tokens: ${cnt}`);
  console.log(`Conditions found via tx_hash: ${conditionToTokens.size}`);
  console.log(`Gamma API found: ${found} (${((found / conditions.length) * 100).toFixed(1)}%)`);
  console.log(`Mappings derived: ${matchedMappings.length}`);

  const coveragePct = ((matchedMappings.length / parseInt(cnt)) * 100).toFixed(1);
  console.log(`Coverage: ${coveragePct}%`);

  // Cleanup
  console.log('\nCleaning up...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_60day_conditions` });
  console.log('Done');
}

main().catch(console.error);
