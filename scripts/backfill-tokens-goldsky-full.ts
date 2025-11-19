#!/usr/bin/env npx tsx

/**
 * GOLDSKY TOKEN MAPPING BACKFILL - Full Coverage
 *
 * Purpose: Populate ctf_token_map from Goldsky subgraph for ALL unmapped tokens
 * Strategy: Direct GraphQL queries to fetch token→outcome mappings
 * Coverage target: 34.6% → ≥95%
 *
 * Usage: WORKER_COUNT=128 npx tsx scripts/backfill-tokens-goldsky-full.ts
 *
 * Features:
 * - Maximum parallelization (128+ workers recommended)
 * - Crash protection with checkpoint/resume
 * - Stall protection (auto-detect hung workers)
 * - Progress tracking with ETA
 * - Rate limit handling (429 → exponential backoff)
 *
 * Expected runtime: ~30-60 minutes with 128 workers
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import fs from 'fs/promises';

config({ path: resolve(process.cwd(), '.env.local') });

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '128');
const BATCH_SIZE = 100; // Process 100 tokens per batch
const CHECKPOINT_FILE = 'tmp/goldsky-token-backfill-checkpoint.json';
const GOLDSKY_URL = process.env.GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn';
const MAX_RETRIES = 3;
const STALL_TIMEOUT_MS = 60000; // 60 seconds

interface Checkpoint {
  processed: number;
  inserted: number;
  lastTokenId: string;
  startTime: number;
}

interface TokenMapping {
  token_id: string;
  condition_id_norm: string;
  outcome_index: number;
  outcome_label: string;
}

// Worker state tracking
const workerStates = new Map<number, { lastUpdate: number; processing: string }>();
let sharedCheckpoint: Checkpoint = { processed: 0, inserted: 0, lastTokenId: '', startTime: Date.now() };

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { processed: 0, inserted: 0, lastTokenId: '', startTime: Date.now() };
  }
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function fetchGoldskyTokenData(tokenIds: string[]): Promise<TokenMapping[]> {
  const mappings: TokenMapping[] = [];

  // Goldsky GraphQL query to fetch token metadata from markets
  // The orderbook subgraph has a "markets" table with tokens array
  const query = `
    query GetTokenMappings($tokenIds: [String!]!) {
      markets(where: { tokens_contains: $tokenIds }) {
        conditionId
        tokens
        outcomes
      }
    }
  `;

  const response = await fetch(GOLDSKY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: { tokenIds }
    })
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  // Process markets and extract token mappings
  const markets = result.data?.markets || [];

  for (const market of markets) {
    const conditionId = market.conditionId?.replace(/^0x/, '').toLowerCase();
    const tokens = market.tokens || [];
    const outcomes = market.outcomes || [];

    if (!conditionId || tokens.length === 0) continue;

    // Match tokens with outcomes by index
    tokens.forEach((tokenId: string, idx: number) => {
      if (tokenIds.includes(tokenId)) {
        const outcomeLabel = outcomes[idx] || `Outcome ${idx}`;
        mappings.push({
          token_id: tokenId,
          condition_id_norm: conditionId,
          outcome_index: idx,
          outcome_label: outcomeLabel
        });
      }
    });
  }

  return mappings;
}

async function insertMappings(mappings: TokenMapping[]) {
  if (mappings.length === 0) return;

  const values = mappings.map(m =>
    `('${m.token_id}', '${m.condition_id_norm}', ${m.outcome_index}, '${m.outcome_label.replace(/'/g, "''")}')`
  ).join(',');

  await clickhouse.query({
    query: `
      INSERT INTO default.ctf_token_map
        (token_id, condition_id_norm, outcome_index, outcome_label)
      VALUES ${values}
    `
  });
}

async function worker(workerId: number) {
  let retries = 0;

  while (true) {
    // Get next batch of unmapped tokens
    const batchResult = await clickhouse.query({
      query: `
        SELECT DISTINCT cf.asset_id
        FROM default.clob_fills cf
        LEFT JOIN default.ctf_token_map c ON cf.asset_id = c.token_id
        WHERE (c.condition_id_norm IS NULL OR c.condition_id_norm = '')
          AND cf.asset_id > '${sharedCheckpoint.lastTokenId}'
        ORDER BY cf.asset_id
        LIMIT ${BATCH_SIZE}
      `,
      format: 'JSONEachRow'
    });

    const batch = await batchResult.json();
    if (batch.length === 0) break; // No more work

    const tokenIds = batch.map((r: any) => r.asset_id);

    // Update worker state
    workerStates.set(workerId, {
      lastUpdate: Date.now(),
      processing: `${tokenIds[0].substring(0, 16)}...`
    });

    try {
      // Fetch from Goldsky
      const mappings = await fetchGoldskyTokenData(tokenIds);

      // Insert to production table
      await insertMappings(mappings);

      // Update shared checkpoint
      sharedCheckpoint.processed += batch.length;
      sharedCheckpoint.inserted += mappings.length;
      sharedCheckpoint.lastTokenId = tokenIds[tokenIds.length - 1];

      retries = 0; // Reset retry counter on success

    } catch (error: any) {
      if (error.message === 'RATE_LIMIT') {
        // Exponential backoff for rate limits
        const backoffMs = Math.min(1000 * Math.pow(2, retries), 30000);
        console.warn(`[Worker ${workerId}] Rate limited, backing off ${backoffMs}ms...`);
        await delay(backoffMs);
        retries++;

        if (retries > MAX_RETRIES) {
          console.error(`[Worker ${workerId}] Max retries exceeded, skipping batch`);
          sharedCheckpoint.lastTokenId = tokenIds[tokenIds.length - 1];
          retries = 0;
        }
        continue;
      }

      console.error(`[Worker ${workerId}] Error:`, error.message);
      retries++;

      if (retries > MAX_RETRIES) {
        console.error(`[Worker ${workerId}] Max retries exceeded, skipping batch`);
        sharedCheckpoint.lastTokenId = tokenIds[tokenIds.length - 1];
        retries = 0;
      }
    }

    // Save checkpoint every 10 batches
    if (sharedCheckpoint.processed % (BATCH_SIZE * 10) === 0) {
      await saveCheckpoint(sharedCheckpoint);
    }
  }

  workerStates.delete(workerId);
}

async function stallMonitor() {
  setInterval(() => {
    const now = Date.now();

    for (const [workerId, state] of workerStates.entries()) {
      const stallTime = now - state.lastUpdate;

      if (stallTime > STALL_TIMEOUT_MS) {
        console.warn(`⚠️  Worker ${workerId} stalled for ${(stallTime / 1000).toFixed(0)}s on ${state.processing}`);
        console.warn(`   Consider restarting if this persists.`);
      }
    }
  }, 10000); // Check every 10 seconds
}

async function main() {
  console.log('═'.repeat(80));
  console.log('GOLDSKY TOKEN MAPPING BACKFILL - FULL COVERAGE');
  console.log('═'.repeat(80));
  console.log();

  // Get total unmapped count
  const totalResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT cf.asset_id) as cnt
      FROM default.clob_fills cf
      LEFT JOIN default.ctf_token_map c ON cf.asset_id = c.token_id
      WHERE c.condition_id_norm IS NULL OR c.condition_id_norm = ''
    `,
    format: 'JSONEachRow'
  });
  const total = parseInt((await totalResult.json())[0].cnt);

  console.log(`Total unmapped tokens: ${total.toLocaleString()}`);
  console.log(`Worker count: ${WORKER_COUNT}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

  // Get current coverage
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        uniq(asset_id) as total_asset_ids,
        uniqIf(asset_id, token_id IS NOT NULL) as mapped_asset_ids
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  const cov = (await coverageResult.json())[0];
  const currentCoverage = (parseInt(cov.mapped_asset_ids) / parseInt(cov.total_asset_ids) * 100).toFixed(1);

  console.log(`Current coverage: ${currentCoverage}% (${parseInt(cov.mapped_asset_ids).toLocaleString()}/${parseInt(cov.total_asset_ids).toLocaleString()})`);
  console.log(`Target coverage: ≥95.0%`);
  console.log();

  // Load checkpoint
  sharedCheckpoint = await loadCheckpoint();

  if (sharedCheckpoint.processed > 0) {
    console.log(`Resuming from checkpoint:`);
    console.log(`  Processed: ${sharedCheckpoint.processed.toLocaleString()}`);
    console.log(`  Inserted: ${sharedCheckpoint.inserted.toLocaleString()}`);
    console.log(`  Last token: ${sharedCheckpoint.lastTokenId.substring(0, 16)}...`);
    console.log();
  }

  console.log('Starting workers...');
  console.log();

  // Start stall monitor
  stallMonitor();

  // Progress reporter
  const progressInterval = setInterval(async () => {
    const elapsed = (Date.now() - sharedCheckpoint.startTime) / 1000;
    const rate = sharedCheckpoint.processed / elapsed;
    const remaining = total - sharedCheckpoint.processed;
    const eta = remaining / rate;

    const coverage = (sharedCheckpoint.inserted / total * 100).toFixed(1);

    console.log(`[${new Date().toLocaleTimeString()}] Progress:`);
    console.log(`  Processed: ${sharedCheckpoint.processed.toLocaleString()} / ${total.toLocaleString()}`);
    console.log(`  Inserted: ${sharedCheckpoint.inserted.toLocaleString()} (${coverage}% of target)`);
    console.log(`  Rate: ${rate.toFixed(1)} tokens/sec`);
    console.log(`  ETA: ${(eta / 60).toFixed(0)} minutes`);
    console.log(`  Active workers: ${workerStates.size}/${WORKER_COUNT}`);
    console.log();
  }, 30000); // Every 30 seconds

  // Launch workers
  const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
    worker(i)
  );

  await Promise.all(workers);

  clearInterval(progressInterval);

  // Final checkpoint save
  await saveCheckpoint(sharedCheckpoint);

  // Final coverage check
  const finalCoverageResult = await clickhouse.query({
    query: `
      SELECT
        uniq(asset_id) as total_asset_ids,
        uniqIf(asset_id, token_id IS NOT NULL) as mapped_asset_ids
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  const finalCov = (await finalCoverageResult.json())[0];
  const finalCoverage = (parseInt(finalCov.mapped_asset_ids) / parseInt(finalCov.total_asset_ids) * 100).toFixed(1);

  console.log('═'.repeat(80));
  console.log('✅ BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Total processed: ${sharedCheckpoint.processed.toLocaleString()}`);
  console.log(`Total inserted: ${sharedCheckpoint.inserted.toLocaleString()}`);
  console.log(`Runtime: ${((Date.now() - sharedCheckpoint.startTime) / 60000).toFixed(1)} minutes`);
  console.log();
  console.log(`Final coverage: ${finalCoverage}% (${parseInt(finalCov.mapped_asset_ids).toLocaleString()}/${parseInt(finalCov.total_asset_ids).toLocaleString()})`);
  console.log();

  if (parseFloat(finalCoverage) >= 95.0) {
    console.log('✅ Coverage target achieved (≥95%)');
    console.log();
    console.log('Next steps:');
    console.log('  npx tsx scripts/verify-coverage-complete.ts');
    console.log('  npx tsx scripts/validate-corrected-pnl-comprehensive.ts');
  } else {
    console.log(`⚠️  Coverage below 95% target (gap: ${(95.0 - parseFloat(finalCoverage)).toFixed(1)}%)`);
    console.log();
    console.log('Options:');
    console.log('  1. Run script again to backfill remaining tokens');
    console.log('  2. Proceed with validation (may have slightly higher variance)');
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
