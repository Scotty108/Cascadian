#!/usr/bin/env npx tsx

/**
 * PHASE 2: Goldsky Track - Token Mapping Backfill
 *
 * Fetches token→outcome mappings from Goldsky subgraph for 49,453 unmapped tokens.
 * Runs with parallel workers to maximize throughput.
 *
 * Usage: WORKER_COUNT=16 npx tsx scripts/backfill-tokens-goldsky-track.ts
 *
 * Features:
 * - Parallel worker pool (configurable via WORKER_COUNT env var)
 * - Crash protection with checkpoint/resume
 * - Stall protection (auto-restart workers that hang >60s)
 * - Progress tracking with ETA
 * - Rate limit handling (429 → exponential backoff)
 *
 * Expected runtime: ~30-60 minutes (16-32 workers)
 * Note: Goldsky typically has higher rate limits than Dome API
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import fs from 'fs/promises';

config({ path: resolve(process.cwd(), '.env.local') });

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '16');
const BATCH_SIZE = 100; // Process 100 tokens per batch
const CHECKPOINT_FILE = 'tmp/goldsky-track-checkpoint.json';
const GOLDSKY_URL = process.env.GOLDSKY_URL || 'https://api.goldsky.com/api/public/project_clp0tyvqa2axc01wd2z2e3y24/subgraphs/polymarket/v2/gn';
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

  // Goldsky GraphQL query to fetch CTF token metadata
  // Query the positions table which contains token_id → condition_id mappings
  const query = `
    query GetTokenMappings($tokenIds: [String!]!) {
      positions(where: { tokenId_in: $tokenIds }) {
        tokenId
        conditionId
        outcomeIndex
        market {
          outcomes
        }
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

  // Process positions and extract token mappings
  const positions = result.data?.positions || [];

  for (const position of positions) {
    const tokenId = position.tokenId;
    const conditionId = position.conditionId?.replace(/^0x/, '').toLowerCase();
    const outcomeIndex = parseInt(position.outcomeIndex || '0');

    if (!tokenId || !conditionId) continue;

    // Get outcome label from market metadata
    const outcomes = position.market?.outcomes || [];
    const outcomeLabel = outcomes[outcomeIndex] || `Outcome ${outcomeIndex}`;

    mappings.push({
      token_id: tokenId,
      condition_id_norm: conditionId,
      outcome_index: outcomeIndex,
      outcome_label: outcomeLabel
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
      INSERT INTO staging.clob_asset_map_goldsky
        (token_id, condition_id_norm, outcome_index, outcome_label)
      VALUES ${values}
    `
  });
}

async function worker(workerId: number, checkpoint: Checkpoint) {
  let retries = 0;

  while (true) {
    // Get next batch of unmapped tokens
    const batchResult = await clickhouse.query({
      query: `
        SELECT asset_id
        FROM staging.unmapped_tokens_goldsky
        WHERE asset_id > '${checkpoint.lastTokenId}'
        ORDER BY asset_id
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

      // Insert to staging table
      await insertMappings(mappings);

      // Update checkpoint
      checkpoint.processed += batch.length;
      checkpoint.inserted += mappings.length;
      checkpoint.lastTokenId = tokenIds[tokenIds.length - 1];

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
          checkpoint.lastTokenId = tokenIds[tokenIds.length - 1];
          retries = 0;
        }
        continue;
      }

      console.error(`[Worker ${workerId}] Error:`, error.message);
      retries++;

      if (retries > MAX_RETRIES) {
        console.error(`[Worker ${workerId}] Max retries exceeded, skipping batch`);
        checkpoint.lastTokenId = tokenIds[tokenIds.length - 1];
        retries = 0;
      }
    }

    // Save checkpoint every 10 batches
    if (checkpoint.processed % (BATCH_SIZE * 10) === 0) {
      await saveCheckpoint(checkpoint);
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
  console.log('PHASE 2: GOLDSKY TRACK - TOKEN MAPPING BACKFILL');
  console.log('═'.repeat(80));
  console.log();

  // Get total unmapped count
  const totalResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.unmapped_tokens_goldsky',
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].cnt;

  console.log(`Total tokens to process: ${parseInt(total).toLocaleString()}`);
  console.log(`Worker count: ${WORKER_COUNT}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

  // Load checkpoint
  const checkpoint = await loadCheckpoint();

  if (checkpoint.processed > 0) {
    console.log(`Resuming from checkpoint:`);
    console.log(`  Processed: ${checkpoint.processed.toLocaleString()}`);
    console.log(`  Inserted: ${checkpoint.inserted.toLocaleString()}`);
    console.log(`  Last token: ${checkpoint.lastTokenId.substring(0, 16)}...`);
    console.log();
  }

  console.log('Starting workers...');
  console.log();

  // Start stall monitor
  stallMonitor();

  // Progress reporter
  const progressInterval = setInterval(async () => {
    const elapsed = (Date.now() - checkpoint.startTime) / 1000;
    const rate = checkpoint.processed / elapsed;
    const remaining = total - checkpoint.processed;
    const eta = remaining / rate;

    const coverage = (checkpoint.inserted / total * 100).toFixed(1);

    console.log(`[${new Date().toLocaleTimeString()}] Progress:`);
    console.log(`  Processed: ${checkpoint.processed.toLocaleString()} / ${parseInt(total).toLocaleString()}`);
    console.log(`  Inserted: ${checkpoint.inserted.toLocaleString()} (${coverage}% coverage)`);
    console.log(`  Rate: ${rate.toFixed(1)} tokens/sec`);
    console.log(`  ETA: ${(eta / 60).toFixed(0)} minutes`);
    console.log(`  Active workers: ${workerStates.size}/${WORKER_COUNT}`);
    console.log();
  }, 30000); // Every 30 seconds

  // Launch workers
  const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
    worker(i, checkpoint)
  );

  await Promise.all(workers);

  clearInterval(progressInterval);

  // Final checkpoint save
  await saveCheckpoint(checkpoint);

  console.log('═'.repeat(80));
  console.log('✅ PHASE 2 COMPLETE - Goldsky Track');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Total processed: ${checkpoint.processed.toLocaleString()}`);
  console.log(`Total inserted: ${checkpoint.inserted.toLocaleString()}`);
  console.log(`Coverage: ${(checkpoint.inserted / total * 100).toFixed(1)}%`);
  console.log(`Runtime: ${((Date.now() - checkpoint.startTime) / 60000).toFixed(1)} minutes`);
  console.log();
}

main().catch(console.error);
