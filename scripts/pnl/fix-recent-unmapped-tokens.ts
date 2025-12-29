/**
 * Fix unmapped tokens from RECENT trades via Gamma API
 *
 * Targets tokens from the last N days of trades that don't have mappings.
 * Much faster than full table scan since it focuses on active tokens.
 *
 * Usage:
 *   npx tsx scripts/pnl/fix-recent-unmapped-tokens.ts [--days 14] [--limit 5000] [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 10;
const DELAY_MS = 100;

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  category?: string;
  clobTokenIds?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTokenInfo(tokenIdDec: string): Promise<GammaMarket | null> {
  try {
    const url = `${GAMMA_API_BASE}/markets?clob_token_ids=${tokenIdDec}`;
    const res = await fetch(url);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as GammaMarket[];
    if (data && data.length > 0) {
      return data[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  const daysArg = args.find((a) => a.startsWith('--days'));
  const days = daysArg ? parseInt(daysArg.split('=')[1] || '14') : 14;

  const limitArg = args.find((a) => a.startsWith('--limit'));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] || '5000') : 5000;

  const dryRun = args.includes('--dry-run');

  console.log('='.repeat(80));
  console.log('FIX RECENT UNMAPPED TOKENS VIA GAMMA API');
  console.log('='.repeat(80));
  console.log(`Days: ${days}, Limit: ${limit}, Dry run: ${dryRun}`);

  // Step 1: Find unmapped tokens from recent trades
  console.log(`\nStep 1: Finding unmapped tokens from last ${days} days...`);

  const q1 = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL ${days} DAY
    )
    SELECT r.token_id
    FROM recent_tokens r
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON r.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON r.token_id = p.token_id_dec
    WHERE (v5.condition_id IS NULL OR v5.condition_id = '')
      AND (p.condition_id IS NULL OR p.condition_id = '')
    LIMIT ${limit}
  `;

  const r1 = await client.query({ query: q1, format: 'JSONEachRow' });
  const unmappedTokens = (await r1.json()) as { token_id: string }[];
  console.log(`Found ${unmappedTokens.length} unmapped tokens`);

  if (unmappedTokens.length === 0) {
    console.log('\nNo unmapped tokens found. All recent tokens are mapped!');
    await client.close();
    return;
  }

  // Step 2: Fetch from Gamma API
  console.log('\nStep 2: Fetching from Gamma API...');

  const results: {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
    category: string;
  }[] = [];

  let found = 0;
  let notFound = 0;

  for (let i = 0; i < unmappedTokens.length; i++) {
    const tokenId = unmappedTokens[i].token_id;

    const market = await fetchTokenInfo(tokenId);

    if (market && market.conditionId) {
      // Determine outcome_index from clobTokenIds array position
      let outcomeIndex = 0;
      if (market.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (Array.isArray(tokenIds)) {
            const idx = tokenIds.indexOf(tokenId);
            if (idx >= 0) outcomeIndex = idx;
          }
        } catch {
          // Keep default
        }
      }

      results.push({
        token_id_dec: tokenId,
        condition_id: market.conditionId.replace(/^0x/, '').toLowerCase(),
        outcome_index: outcomeIndex,
        question: market.question || 'Unknown',
        category: market.category || 'Other',
      });
      found++;
    } else {
      notFound++;
    }

    // Progress update
    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${unmappedTokens.length} (found: ${found}, not found: ${notFound})`);
    }

    // Rate limiting
    await sleep(DELAY_MS);
  }

  console.log(`\nAPI results: ${found} found, ${notFound} not found`);

  if (results.length === 0) {
    console.log('\nNo new mappings found from API.');
    await client.close();
    return;
  }

  // Step 3: Insert into patch table
  if (dryRun) {
    console.log('\nDRY RUN - Would insert:');
    for (const r of results.slice(0, 10)) {
      console.log(`  ${r.token_id_dec.substring(0, 20)}... -> ${r.condition_id.substring(0, 20)}... (${r.question.substring(0, 40)})`);
    }
    if (results.length > 10) {
      console.log(`  ... and ${results.length - 10} more`);
    }
  } else {
    console.log('\nStep 3: Inserting into pm_token_to_condition_patch...');

    // Batch insert
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      const values = batch
        .map(
          (m) =>
            `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, '${m.question.replace(/'/g, "''")}', '${m.category.replace(/'/g, "''")}', 'gamma_api_recent', now())`
        )
        .join(',');

      await client.command({
        query: `
          INSERT INTO pm_token_to_condition_patch
          (token_id_dec, condition_id, outcome_index, question, category, source, created_at)
          VALUES ${values}
        `,
      });
    }

    console.log(`✅ Inserted ${results.length} new mappings`);
  }

  // Step 4: Show coverage improvement
  console.log('\nStep 4: Checking updated coverage...');

  const coverageQ = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL ${days} DAY
    )
    SELECT
      count() as total_recent,
      countIf(v5.token_id_dec IS NOT NULL OR p.token_id_dec IS NOT NULL) as mapped,
      countIf(v5.token_id_dec IS NULL AND p.token_id_dec IS NULL) as unmapped
    FROM recent_tokens t
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON t.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON t.token_id = p.token_id_dec
  `;

  const coverageR = await client.query({ query: coverageQ, format: 'JSONEachRow' });
  const coverage = (await coverageR.json()) as { total_recent: number; mapped: number; unmapped: number }[];

  const cov = coverage[0];
  const pct = ((cov.mapped / cov.total_recent) * 100).toFixed(1);

  console.log(`Coverage (last ${days} days):`);
  console.log(`  Total tokens: ${cov.total_recent.toLocaleString()}`);
  console.log(`  Mapped: ${cov.mapped.toLocaleString()} (${pct}%)`);
  console.log(`  Unmapped: ${cov.unmapped.toLocaleString()}`);

  await client.close();
  console.log('\n✅ Complete!');
}

main().catch(console.error);
