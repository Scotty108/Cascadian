/**
 * Find and Fix ALL Unmapped Token IDs
 *
 * This script:
 * 1. Scans ALL token_ids in pm_trader_events_v2
 * 2. Identifies which ones are NOT in pm_token_to_condition_map_v3
 * 3. Attempts to resolve them via Polymarket Gamma API
 * 4. Creates a patch table pm_token_to_condition_patch
 * 5. Creates pm_token_to_condition_map_v4 as UNION of v3 + patch
 *
 * This is a SYSTEM-WIDE fix, not wallet-specific.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 200; // 5 requests per second to be safe

interface UnmappedToken {
  token_id: string;
  trade_count: number;
  total_usdc: number;
  unique_wallets: number;
  first_trade: string;
  last_trade: string;
}

interface ResolvedMapping {
  token_id: string;
  token_id_dec: string;
  condition_id: string;
  outcome_index: number;
  question: string;
  category: string;
  source: string;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAllUnmappedTokens(): Promise<UnmappedToken[]> {
  console.log('Finding all unmapped token_ids in pm_trader_events_v2...');

  const query = `
    WITH
      -- All unique token_ids from trader events
      all_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND token_id != ''
      ),
      -- Token_ids that ARE mapped
      mapped_tokens AS (
        SELECT DISTINCT token_id_dec
        FROM pm_token_to_condition_map_v3
        WHERE token_id_dec != ''
      ),
      -- Unmapped = all - mapped
      unmapped AS (
        SELECT token_id
        FROM all_tokens
        WHERE token_id NOT IN (SELECT token_id_dec FROM mapped_tokens)
      )
    -- Get stats for each unmapped token
    SELECT
      u.token_id,
      count() AS trade_count,
      sum(t.usdc_amount) / 1e6 AS total_usdc,
      uniqExact(t.trader_wallet) AS unique_wallets,
      min(t.trade_time) AS first_trade,
      max(t.trade_time) AS last_trade
    FROM unmapped u
    JOIN pm_trader_events_v2 t ON u.token_id = t.token_id
    WHERE t.is_deleted = 0
    GROUP BY u.token_id
    ORDER BY total_usdc DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    token_id: r.token_id,
    trade_count: Number(r.trade_count),
    total_usdc: Number(r.total_usdc),
    unique_wallets: Number(r.unique_wallets),
    first_trade: r.first_trade,
    last_trade: r.last_trade,
  }));
}

async function resolveTokenViaGammaAPI(tokenId: string): Promise<ResolvedMapping | null> {
  try {
    // Gamma API uses the decimal token ID
    const url = `${GAMMA_API}/markets?token_id=${tokenId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const market = data[0];

    // Extract condition_id and outcome_index from the token
    // The market has clobTokenIds which maps to outcomes
    const clobTokenIds = market.clobTokenIds || [];
    const outcomeIndex = clobTokenIds.indexOf(tokenId);

    if (outcomeIndex === -1) {
      // Token might be in a different format, try to find it
      // Sometimes the API returns the market but token mapping is tricky
      return null;
    }

    return {
      token_id: tokenId,
      token_id_dec: tokenId,
      condition_id: market.conditionId || '',
      outcome_index: outcomeIndex,
      question: market.question || '',
      category: market.groupItemTitle || market.category || 'Other',
      source: 'gamma_api',
    };
  } catch (e) {
    return null;
  }
}

async function resolveTokenViaConditionSearch(tokenId: string): Promise<ResolvedMapping | null> {
  // Alternative: Search by condition_id patterns
  // Token IDs in Polymarket are derived from condition_id + outcome_index
  // Try to reverse-engineer by searching for markets with this token

  try {
    // Try the clob endpoint
    const url = `${GAMMA_API}/clob-token/${tokenId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data || !data.condition_id) {
      return null;
    }

    return {
      token_id: tokenId,
      token_id_dec: tokenId,
      condition_id: data.condition_id,
      outcome_index: data.outcome_index || 0,
      question: data.question || '',
      category: data.category || 'Other',
      source: 'clob_token_api',
    };
  } catch (e) {
    return null;
  }
}

async function resolveTokensInBatch(tokens: UnmappedToken[]): Promise<ResolvedMapping[]> {
  const resolved: ResolvedMapping[] = [];
  let processed = 0;

  for (const token of tokens) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`  Processed ${processed}/${tokens.length} tokens, resolved ${resolved.length}...`);
    }

    // Try Gamma API first
    let mapping = await resolveTokenViaGammaAPI(token.token_id);

    // If that fails, try condition search
    if (!mapping) {
      mapping = await resolveTokenViaConditionSearch(token.token_id);
    }

    if (mapping) {
      resolved.push(mapping);
    }

    // Rate limiting
    await sleep(RATE_LIMIT_MS);
  }

  return resolved;
}

async function createPatchTable(mappings: ResolvedMapping[]) {
  if (mappings.length === 0) {
    console.log('No mappings to create patch table for.');
    return;
  }

  console.log(`Creating patch table with ${mappings.length} mappings...`);

  // Drop existing patch table
  try {
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS pm_token_to_condition_patch',
    });
  } catch (e) {
    // Ignore
  }

  // Create patch table with same schema as v3
  await clickhouse.command({
    query: `
      CREATE TABLE pm_token_to_condition_patch (
        token_id String,
        token_id_dec String,
        condition_id String,
        outcome_index Int32,
        question String,
        category String,
        source String,
        created_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (token_id_dec, condition_id, outcome_index)
    `,
  });

  // Insert mappings in batches
  const batchSize = 100;
  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize);
    const values = batch
      .map(
        (m) =>
          `('${m.token_id}', '${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, '${m.question.replace(/'/g, "''")}', '${m.category.replace(/'/g, "''")}', '${m.source}')`
      )
      .join(',\n');

    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id, token_id_dec, condition_id, outcome_index, question, category, source)
        VALUES ${values}
      `,
    });
  }

  console.log('Patch table created successfully.');
}

async function createMapV4() {
  console.log('Creating pm_token_to_condition_map_v4 (v3 + patch)...');

  // Drop existing v4
  try {
    await clickhouse.command({
      query: 'DROP VIEW IF EXISTS pm_token_to_condition_map_v4',
    });
  } catch (e) {
    // Ignore
  }

  // Create v4 as union of v3 and patch
  // Use v3 as primary, patch fills gaps
  await clickhouse.command({
    query: `
      CREATE VIEW pm_token_to_condition_map_v4 AS
      SELECT
        token_id,
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
      FROM pm_token_to_condition_map_v3

      UNION ALL

      SELECT
        token_id,
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
      FROM pm_token_to_condition_patch
      WHERE token_id_dec NOT IN (
        SELECT token_id_dec FROM pm_token_to_condition_map_v3
      )
    `,
  });

  console.log('pm_token_to_condition_map_v4 created successfully.');

  // Verify
  const countV3 = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v3',
    format: 'JSONEachRow',
  });
  const countV4 = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v4',
    format: 'JSONEachRow',
  });
  const countPatch = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_patch',
    format: 'JSONEachRow',
  });

  const v3Rows = (await countV3.json()) as any[];
  const v4Rows = (await countV4.json()) as any[];
  const patchRows = (await countPatch.json()) as any[];

  console.log(`  V3 token count: ${v3Rows[0]?.cnt || 0}`);
  console.log(`  Patch token count: ${patchRows[0]?.cnt || 0}`);
  console.log(`  V4 token count: ${v4Rows[0]?.cnt || 0}`);
}

async function main() {
  console.log('='.repeat(100));
  console.log('FIND AND FIX ALL UNMAPPED TOKEN IDS');
  console.log('='.repeat(100));
  console.log('');

  // Step 1: Find all unmapped tokens
  console.log('STEP 1: Finding all unmapped token_ids...');
  const unmapped = await findAllUnmappedTokens();

  console.log(`\nFound ${unmapped.length} unmapped token_ids.`);

  if (unmapped.length === 0) {
    console.log('No unmapped tokens found. All token_ids are already mapped!');
    return;
  }

  // Show summary
  const totalUsdc = unmapped.reduce((sum, t) => sum + t.total_usdc, 0);
  const totalTrades = unmapped.reduce((sum, t) => sum + t.trade_count, 0);

  console.log(`\nSummary:`);
  console.log(`  Total unmapped tokens: ${unmapped.length}`);
  console.log(`  Total USDC volume: $${totalUsdc.toFixed(2)}`);
  console.log(`  Total trades affected: ${totalTrades}`);

  // Show top 20 by USDC impact
  console.log(`\nTop 20 unmapped tokens by USDC volume:`);
  console.log('Token ID (first 20)      | USDC Volume  | Trades | Wallets');
  console.log('-'.repeat(70));
  for (const t of unmapped.slice(0, 20)) {
    console.log(
      `${t.token_id.substring(0, 24).padEnd(24)} | $${t.total_usdc.toFixed(2).padStart(10)} | ${t.trade_count.toString().padStart(6)} | ${t.unique_wallets}`
    );
  }

  // Save full list to file
  const outputFile = 'data/unmapped-tokens-full.json';
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_unmapped: unmapped.length,
        total_usdc_volume: totalUsdc,
        total_trades: totalTrades,
        tokens: unmapped,
      },
      null,
      2
    )
  );
  console.log(`\nFull list saved to: ${outputFile}`);

  // Step 2: Resolve tokens via API
  console.log('\n' + '='.repeat(100));
  console.log('STEP 2: Resolving tokens via Polymarket Gamma API...');
  console.log('='.repeat(100));
  console.log('');

  // Focus on high-impact tokens first (top 500 by USDC)
  const highImpactTokens = unmapped.slice(0, 500);
  console.log(`Processing top ${highImpactTokens.length} tokens by USDC volume...`);

  const resolved = await resolveTokensInBatch(highImpactTokens);

  console.log(`\nResolved ${resolved.length}/${highImpactTokens.length} tokens via API.`);

  if (resolved.length > 0) {
    // Show what we resolved
    console.log('\nResolved mappings:');
    console.log('Token ID (first 20)      | Condition ID (first 20)  | Idx | Category');
    console.log('-'.repeat(90));
    for (const m of resolved.slice(0, 20)) {
      console.log(
        `${m.token_id.substring(0, 24).padEnd(24)} | ${m.condition_id.substring(0, 24).padEnd(24)} | ${m.outcome_index.toString().padStart(3)} | ${m.category.substring(0, 15)}`
      );
    }

    // Save resolved mappings
    const resolvedFile = 'data/resolved-token-mappings.json';
    fs.writeFileSync(resolvedFile, JSON.stringify({ resolved }, null, 2));
    console.log(`\nResolved mappings saved to: ${resolvedFile}`);

    // Step 3: Create patch table
    console.log('\n' + '='.repeat(100));
    console.log('STEP 3: Creating patch table...');
    console.log('='.repeat(100));

    await createPatchTable(resolved);

    // Step 4: Create v4 map
    console.log('\n' + '='.repeat(100));
    console.log('STEP 4: Creating pm_token_to_condition_map_v4...');
    console.log('='.repeat(100));

    await createMapV4();
  } else {
    console.log('\nNo tokens could be resolved via API.');
    console.log('These tokens may be:');
    console.log('  - Very old markets no longer in the API');
    console.log('  - Test/invalid tokens');
    console.log('  - Tokens from deprecated market formats');
  }

  // Step 5: Show remaining gaps
  console.log('\n' + '='.repeat(100));
  console.log('STEP 5: Checking remaining gaps...');
  console.log('='.repeat(100));

  const stillUnmapped = unmapped.filter((t) => !resolved.some((r) => r.token_id === t.token_id));
  const stillUnmappedUsdc = stillUnmapped.reduce((sum, t) => sum + t.total_usdc, 0);

  console.log(`\nRemaining unmapped tokens: ${stillUnmapped.length}`);
  console.log(`Remaining unmapped USDC: $${stillUnmappedUsdc.toFixed(2)}`);
  console.log(`Percentage of volume now mapped: ${(((totalUsdc - stillUnmappedUsdc) / totalUsdc) * 100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(100));
  console.log('COMPLETE');
  console.log('='.repeat(100));
  console.log('\nNext steps:');
  console.log('1. Update pm_unified_ledger_v6 to use pm_token_to_condition_map_v4');
  console.log('2. Rerun V19 benchmark to verify improvements');
}

main().catch(console.error);
