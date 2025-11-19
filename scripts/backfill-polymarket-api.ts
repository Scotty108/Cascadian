#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface PolymarketMarket {
  condition_id: string;
  question: string;
  description: string;
  outcomes: string[];
  outcome: string; // winning outcome
  closed: boolean;
  resolved: boolean;
  category?: string;
  tags?: string[];
  end_date_iso?: string;
  payout_numerators?: number[];
}

async function fetchMarketFromAPI(conditionId: string): Promise<PolymarketMarket | null> {
  try {
    const cleanId = conditionId.replace('0x', '');
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${cleanId}`;

    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null; // Market doesn't exist
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Gamma API returns array, take first result
    if (!data || data.length === 0) return null;

    const market = data[0];

    // CRITICAL FIX: Only return markets with valid winning outcomes
    // Filter out unresolved markets (empty outcome, no winner)
    if (!market.outcome || market.outcome === '' || market.outcome === null) {
      return null; // Skip unresolved markets
    }

    return {
      condition_id: conditionId,
      question: market.question || '',
      description: market.description || '',
      outcomes: market.outcomes || [],
      outcome: market.outcome,
      closed: market.closed || false,
      resolved: true, // Only returning resolved markets now
      category: market.category || '',
      tags: market.tags || [],
      end_date_iso: market.end_date_iso,
      payout_numerators: market.payout_numerators,
    };
  } catch (error: any) {
    console.error(`Error fetching ${conditionId}: ${error.message}`);
    return null;
  }
}

async function insertMarketData(markets: PolymarketMarket[]) {
  if (markets.length === 0) return;

  // Insert into a new table: api_market_backfill
  const values = markets.map(m => ({
    condition_id: m.condition_id.replace('0x', ''),
    question: m.question,
    description: m.description,
    outcomes_json: JSON.stringify(m.outcomes),
    winning_outcome: m.outcome,
    closed: m.closed ? 1 : 0,
    resolved: m.resolved ? 1 : 0,
    category: m.category || '',
    tags_json: JSON.stringify(m.tags || []),
    end_date: m.end_date_iso || '',
    payout_numerators_json: JSON.stringify(m.payout_numerators || []),
    fetched_at: new Date().toISOString(),
  }));

  await client.insert({
    table: 'default.api_market_backfill',
    values,
    format: 'JSONEachRow',
  });
}

async function main() {
  console.log('POLYMARKET API BACKFILL - Getting Missing 171K Markets');
  console.log('═'.repeat(80));
  console.log();

  // Create table if not exists
  console.log('Creating api_market_backfill table...');
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.api_market_backfill (
        condition_id String,
        question String,
        description String,
        outcomes_json String,
        winning_outcome String,
        closed UInt8,
        resolved UInt8,
        category String,
        tags_json String,
        end_date String,
        payout_numerators_json String,
        fetched_at DateTime
      ) ENGINE = ReplacingMergeTree(fetched_at)
      ORDER BY condition_id
    `,
  });
  console.log('✅ Table ready');
  console.log();

  // Get missing condition_ids
  console.log('Fetching list of missing markets...');
  const missing = await client.query({
    query: `
      SELECT DISTINCT condition_id_norm AS cid
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(condition_id_norm) NOT IN (
          SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
        )
    `,
    format: 'JSONEachRow',
  });

  const missingIds = await missing.json<Array<{cid: string}>>();
  console.log(`Found ${missingIds.length.toLocaleString()} missing markets`);
  console.log();

  // Backfill configuration
  const BATCH_SIZE = 100; // Insert every 100 markets
  const RATE_LIMIT_MS = 10; // 10ms between requests = ~100 req/sec
  const CHECKPOINT_EVERY = 1000; // Log progress every 1000 markets

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let unresolved = 0;
  let errors = 0;
  let batch: PolymarketMarket[] = [];

  console.log('Starting backfill...');
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Rate limit: ~${1000/RATE_LIMIT_MS} req/sec`);
  console.log(`  Estimated time: ~${Math.ceil(missingIds.length * RATE_LIMIT_MS / 1000 / 60)} minutes`);
  console.log();

  const startTime = Date.now();

  for (const {cid} of missingIds) {
    const market = await fetchMarketFromAPI(cid);

    if (market) {
      batch.push(market);
      found++;
    } else {
      // Count as unresolved (filtered out) rather than not found
      unresolved++;
    }

    processed++;

    // Insert batch
    if (batch.length >= BATCH_SIZE) {
      await insertMarketData(batch);
      batch = [];
    }

    // Progress logging
    if (processed % CHECKPOINT_EVERY === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = missingIds.length - processed;
      const eta = remaining / rate;

      console.log(`Progress: ${processed.toLocaleString()} / ${missingIds.length.toLocaleString()} (${(100*processed/missingIds.length).toFixed(1)}%)`);
      console.log(`  Resolved: ${found.toLocaleString()} | Unresolved (skipped): ${unresolved.toLocaleString()} | Errors: ${errors}`);
      console.log(`  Rate: ${rate.toFixed(1)} markets/sec | ETA: ${Math.ceil(eta/60)} min`);
      console.log();
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  }

  // Insert remaining batch
  if (batch.length > 0) {
    await insertMarketData(batch);
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log('═'.repeat(80));
  console.log('BACKFILL COMPLETE!');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Total processed:        ${processed.toLocaleString()}`);
  console.log(`Resolved (inserted):    ${found.toLocaleString()}`);
  console.log(`Unresolved (skipped):   ${unresolved.toLocaleString()}`);
  console.log(`Errors:                 ${errors}`);
  console.log(`Resolution rate:        ${(100*found/processed).toFixed(1)}%`);
  console.log(`Total time:             ${Math.ceil(totalTime/60)} minutes`);
  console.log();

  // Now rebuild vw_resolutions_all to include this data
  console.log('Rebuilding vw_resolutions_all with backfill data...');
  
  // We need to convert the API data to resolution format
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_all_v2 AS
      
      -- Original resolutions from market_resolutions_final
      SELECT
        lower(concat('0x', condition_id_norm)) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        winning_outcome,
        source
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND winning_index IS NOT NULL
      
      UNION ALL
      
      -- New resolutions from API backfill
      SELECT
        lower(concat('0x', condition_id)) AS cid_hex,
        -- Derive winning_index from winning_outcome and outcomes array
        arrayFirstIndex(x -> x = winning_outcome, JSONExtract(outcomes_json, 'Array(String)')) - 1 AS winning_index,
        -- Parse payout_numerators from JSON
        JSONExtract(payout_numerators_json, 'Array(UInt8)') AS payout_numerators,
        1 AS payout_denominator,
        toDateTime(fetched_at) AS resolved_at,
        winning_outcome,
        'api_backfill' AS source
      FROM default.api_market_backfill
      WHERE resolved = 1
        AND length(winning_outcome) > 0
    `,
  });

  console.log('✅ vw_resolutions_all_v2 created with backfill data');
  console.log();

  // Check new coverage
  const newCoverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total,
        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN cascadian_clean.vw_resolutions_all_v2 r
           ON lower(t.condition_id_norm) = r.cid_hex
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS matched
    `,
    format: 'JSONEachRow',
  });

  const cov = (await newCoverage.json<Array<any>>())[0];
  const newPct = (100 * cov.matched / cov.total).toFixed(1);

  console.log('NEW COVERAGE:');
  console.log(`  Markets traded:  ${cov.total.toLocaleString()}`);
  console.log(`  With resolutions: ${cov.matched.toLocaleString()} (${newPct}%)`);
  console.log();

  if (parseFloat(newPct) > 80) {
    console.log('🎉🎉🎉 SUCCESS! Coverage > 80%!');
  }

  await client.close();
}

main().catch(console.error);
