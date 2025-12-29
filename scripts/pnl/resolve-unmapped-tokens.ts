/**
 * Resolve Unmapped Tokens via Polymarket Gamma API
 *
 * This script:
 * 1. Loads unmapped tokens from data/unmapped-tokens-complete.json
 * 2. Resolves each via Gamma API (markets endpoint)
 * 3. Creates pm_token_to_condition_patch table
 * 4. Creates pm_token_to_condition_map_v4 (v3 + patch)
 *
 * Features:
 * - Parallel workers (10 concurrent requests)
 * - Rate limiting (200ms between batches)
 * - Progress saving every 100 tokens
 * - Crash recovery from checkpoint
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CONCURRENT_REQUESTS = 10;
const RATE_LIMIT_MS = 250; // 4 requests per second per worker
const CHECKPOINT_FILE = 'data/token-resolution-checkpoint.json';
const OUTPUT_FILE = 'data/resolved-token-mappings.json';

interface UnmappedToken {
  token_id: string;
  trade_count: number;
  total_usdc: number;
  unique_wallets: number;
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

interface Checkpoint {
  processed: Set<string>;
  resolved: ResolvedMapping[];
  failed: string[];
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTokenViaGammaAPI(tokenId: string): Promise<ResolvedMapping | null> {
  try {
    const url = `${GAMMA_API}/markets?clob_token_ids=${tokenId}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - wait and retry
        await sleep(5000);
        return resolveTokenViaGammaAPI(tokenId);
      }
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const market = data[0];

    // Find which outcome index this token represents
    const clobTokenIds = market.clobTokenIds || [];
    let outcomeIndex = clobTokenIds.indexOf(tokenId);

    // If not found directly, try string comparison
    if (outcomeIndex === -1) {
      outcomeIndex = clobTokenIds.findIndex((id: string) => id === tokenId);
    }

    // Default to 0 if not found (binary market with single token)
    if (outcomeIndex === -1 && clobTokenIds.length <= 2) {
      outcomeIndex = 0;
    }

    if (!market.conditionId) {
      return null;
    }

    return {
      token_id: tokenId,
      token_id_dec: tokenId,
      condition_id: market.conditionId.toLowerCase(),
      outcome_index: outcomeIndex >= 0 ? outcomeIndex : 0,
      question: market.question || '',
      category: market.groupItemTitle || market.category || 'Other',
      source: 'gamma_api_clob_token_ids',
    };
  } catch (e) {
    return null;
  }
}

async function resolveTokenViaDirectLookup(tokenId: string): Promise<ResolvedMapping | null> {
  // Fallback: Try direct market lookup
  try {
    const url = `${GAMMA_API}/markets?token_id=${tokenId}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const market = data[0];

    const clobTokenIds = market.clobTokenIds || [];
    const outcomeIndex = clobTokenIds.indexOf(tokenId);

    if (!market.conditionId) {
      return null;
    }

    return {
      token_id: tokenId,
      token_id_dec: tokenId,
      condition_id: market.conditionId.toLowerCase(),
      outcome_index: outcomeIndex >= 0 ? outcomeIndex : 0,
      question: market.question || '',
      category: market.groupItemTitle || market.category || 'Other',
      source: 'gamma_api_token_id',
    };
  } catch (e) {
    return null;
  }
}

async function resolveToken(tokenId: string): Promise<ResolvedMapping | null> {
  // Try primary method first
  let result = await resolveTokenViaGammaAPI(tokenId);

  // Fallback to direct lookup
  if (!result) {
    result = await resolveTokenViaDirectLookup(tokenId);
  }

  return result;
}

async function processTokenBatch(
  tokens: UnmappedToken[],
  checkpoint: Checkpoint,
  onProgress: () => void
): Promise<void> {
  const promises = tokens.map(async (token) => {
    if (checkpoint.processed.has(token.token_id)) {
      return; // Skip already processed
    }

    const result = await resolveToken(token.token_id);

    checkpoint.processed.add(token.token_id);

    if (result) {
      checkpoint.resolved.push(result);
    } else {
      checkpoint.failed.push(token.token_id);
    }

    onProgress();
  });

  await Promise.all(promises);
}

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
      return {
        processed: new Set(data.processed || []),
        resolved: data.resolved || [],
        failed: data.failed || [],
      };
    } catch {
      // Start fresh
    }
  }
  return {
    processed: new Set(),
    resolved: [],
    failed: [],
  };
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({
      processed: Array.from(checkpoint.processed),
      resolved: checkpoint.resolved,
      failed: checkpoint.failed,
      saved_at: new Date().toISOString(),
    }, null, 2)
  );
}

async function createPatchTable(mappings: ResolvedMapping[]): Promise<void> {
  if (mappings.length === 0) {
    console.log('No mappings to create patch table for.');
    return;
  }

  console.log(`Creating pm_token_to_condition_patch with ${mappings.length} mappings...`);

  // Drop existing
  try {
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_patch' });
  } catch {}

  // Create table
  await clickhouse.command({
    query: `
      CREATE TABLE pm_token_to_condition_patch (
        token_id_dec String,
        condition_id String,
        outcome_index Int32,
        question String,
        category String,
        source String,
        created_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (token_id_dec)
    `,
  });

  // Insert in batches
  const batchSize = 500;
  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize);
    const values = batch
      .map((m) => {
        const escQuestion = m.question.replace(/'/g, "''").replace(/\\/g, '\\\\');
        const escCategory = m.category.replace(/'/g, "''").replace(/\\/g, '\\\\');
        return `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, '${escQuestion}', '${escCategory}', '${m.source}')`;
      })
      .join(',\n');

    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id_dec, condition_id, outcome_index, question, category, source)
        VALUES ${values}
      `,
    });
  }

  console.log('Patch table created successfully.');
}

async function createMapV4(): Promise<void> {
  console.log('Creating pm_token_to_condition_map_v4...');

  // Drop existing
  try {
    await clickhouse.command({ query: 'DROP VIEW IF EXISTS pm_token_to_condition_map_v4' });
  } catch {}

  // Create v4 as union of v3 + patch (patch fills gaps only)
  await clickhouse.command({
    query: `
      CREATE VIEW pm_token_to_condition_map_v4 AS
      SELECT
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
      FROM pm_token_to_condition_map_v3

      UNION ALL

      SELECT
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

  // Verify counts
  const [v3Count, patchCount, v4Count] = await Promise.all([
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v3', format: 'JSONEachRow' }),
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_patch', format: 'JSONEachRow' }),
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v4', format: 'JSONEachRow' }),
  ]);

  const v3Rows = (await v3Count.json()) as any[];
  const patchRows = (await patchCount.json()) as any[];
  const v4Rows = (await v4Count.json()) as any[];

  console.log(`  V3 token count: ${v3Rows[0]?.cnt || 0}`);
  console.log(`  Patch token count: ${patchRows[0]?.cnt || 0}`);
  console.log(`  V4 token count: ${v4Rows[0]?.cnt || 0}`);
}

async function main() {
  console.log('='.repeat(100));
  console.log('RESOLVE UNMAPPED TOKENS VIA POLYMARKET GAMMA API');
  console.log('='.repeat(100));
  console.log('');

  // Load unmapped tokens
  const inputFile = 'data/unmapped-tokens-complete.json';
  if (!fs.existsSync(inputFile)) {
    console.error('No unmapped tokens file found. Run the discovery script first.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  const allTokens: UnmappedToken[] = data.tokens;

  // Focus on top tokens by USDC volume (configurable)
  const MAX_TOKENS = parseInt(process.argv[2] || '500');
  const tokens = allTokens.slice(0, MAX_TOKENS);

  console.log(`Total unmapped tokens: ${allTokens.length}`);
  console.log(`Processing top ${tokens.length} by USDC volume`);
  console.log(`Total USDC in scope: $${tokens.reduce((s, t) => s + t.total_usdc, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('');

  // Load checkpoint
  const checkpoint = loadCheckpoint();
  console.log(`Checkpoint: ${checkpoint.processed.size} already processed, ${checkpoint.resolved.length} resolved`);

  // Process tokens
  let processed = 0;
  const startTime = Date.now();

  const progressCallback = () => {
    processed++;
    if (processed % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = tokens.length - processed;
      const eta = remaining / rate;

      process.stdout.write(
        `\rProcessed ${processed}/${tokens.length} (${checkpoint.resolved.length} resolved, ${checkpoint.failed.length} failed) - ETA: ${Math.round(eta)}s`
      );
    }

    if (processed % 100 === 0) {
      saveCheckpoint(checkpoint);
    }
  };

  // Process in batches with concurrency
  for (let i = 0; i < tokens.length; i += CONCURRENT_REQUESTS) {
    const batch = tokens.slice(i, i + CONCURRENT_REQUESTS);
    await processTokenBatch(batch, checkpoint, progressCallback);
    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n');
  saveCheckpoint(checkpoint);

  // Summary
  console.log('='.repeat(100));
  console.log('RESOLUTION SUMMARY');
  console.log('='.repeat(100));
  console.log(`Processed: ${checkpoint.processed.size}`);
  console.log(`Resolved: ${checkpoint.resolved.length}`);
  console.log(`Failed: ${checkpoint.failed.length}`);
  console.log(`Success rate: ${((checkpoint.resolved.length / checkpoint.processed.size) * 100).toFixed(1)}%`);

  // Save resolved mappings
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      total_resolved: checkpoint.resolved.length,
      resolved: checkpoint.resolved,
    }, null, 2)
  );
  console.log(`\nSaved resolved mappings to: ${OUTPUT_FILE}`);

  if (checkpoint.resolved.length > 0) {
    // Create patch table
    console.log('\n');
    await createPatchTable(checkpoint.resolved);

    // Create v4 map
    console.log('');
    await createMapV4();

    console.log('\n');
    console.log('='.repeat(100));
    console.log('NEXT STEPS');
    console.log('='.repeat(100));
    console.log('1. Verify pm_token_to_condition_map_v4 is correct');
    console.log('2. Rebuild pm_unified_ledger_v7 using v4 map');
    console.log('3. Rerun V19/V20 benchmark');
  }
}

main().catch(console.error);
