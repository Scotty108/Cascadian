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

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const BATCH_SIZE = 100;

// Adaptive rate limiting
let currentReqPerSec = process.env.FAST === '1' ? 12 : 3; // Start at 12 or 3
const MIN_REQ_PER_SEC = 2; // Never go below 2 req/s
const MAX_REQ_PER_SEC = 12; // Never exceed 12 req/s (safe limit)
const FALLBACK_REQ_PER_SEC = 10; // Fallback speed after rate limit

// Stall detection
let lastProgressTime = Date.now();
let lastProcessedCount = 0;
const STALL_THRESHOLD_SEC = 60; // If no progress for 60s, consider stalled

// Health tracking
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;

interface GammaMarket {
  condition_id: string;
  question?: string;
  outcomes?: string[];
  outcome?: string;
  closed?: boolean;
  resolvedAt?: string;
  category?: string;
  tags?: string[];
}

// Fetch with timeout and retry
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchMarketData(cid_hex: string, retryCount = 0): Promise<GammaMarket | null> {
  const MAX_RETRIES = 3;

  try {
    const url = `${GAMMA_API}?condition_id=${cid_hex}`;
    const response = await fetchWithTimeout(url);

    // Handle rate limiting
    if (response.status === 429) {
      console.warn(`⚠️  Rate limited! Slowing down from ${currentReqPerSec} to ${FALLBACK_REQ_PER_SEC} req/s`);
      currentReqPerSec = FALLBACK_REQ_PER_SEC;

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (retryCount < MAX_RETRIES) {
        return fetchMarketData(cid_hex, retryCount + 1);
      }
      throw new Error('RATE_LIMITED_MAX_RETRIES');
    }

    // Handle server errors with retry
    if (response.status >= 500) {
      console.warn(`⚠️  Server error ${response.status}, retrying...`);
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return fetchMarketData(cid_hex, retryCount + 1);
      }
      throw new Error('SERVER_ERROR_MAX_RETRIES');
    }

    // 404 or other client errors - not retryable
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    consecutiveErrors = 0; // Reset error counter on success
    return data;

  } catch (err) {
    consecutiveErrors++;

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`🔴 ${MAX_CONSECUTIVE_ERRORS} consecutive errors! Slowing down significantly...`);
      currentReqPerSec = Math.max(MIN_REQ_PER_SEC, currentReqPerSec / 2);
      consecutiveErrors = 0; // Reset to try recovery
    }

    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return fetchMarketData(cid_hex, retryCount + 1);
    }

    console.error(`Error fetching ${cid_hex.slice(0, 10)}...`, err);
    return null;
  }
}

function deriveResolutionData(market: GammaMarket) {
  const outcomes = market.outcomes || [];
  const winningOutcome = market.outcome || '';
  const resolved = market.closed && winningOutcome.length > 0 ? 1 : 0;

  let winning_index = -1;
  let payout_numerators: number[] = [];
  let payout_denominator: number | null = null;

  if (resolved && outcomes.length > 0) {
    winning_index = outcomes.findIndex(o =>
      o.toLowerCase() === winningOutcome.toLowerCase()
    );

    if (winning_index >= 0) {
      payout_numerators = outcomes.map((_, i) => i === winning_index ? 1 : 0);
      payout_denominator = 1;
    }
  }

  return {
    resolved,
    winning_index,
    payout_numerators,
    payout_denominator,
    outcomes,
    title: market.question || '',
    category: market.category || '',
    tags: market.tags || [],
    resolution_time: market.resolvedAt || null,
  };
}

// Process batch with controlled parallelism
async function processBatchParallel(targets: Array<{ cid_hex: string }>) {
  const delayMs = 1000 / currentReqPerSec;
  const results: Array<{
    cid_hex: string;
    status: 'ok' | 'error';
    error: string;
    data?: any;
  }> = [];

  // Process in parallel but with rate limiting
  for (let i = 0; i < targets.length; i++) {
    const { cid_hex } = targets[i];

    try {
      const market = await fetchMarketData(cid_hex);

      if (!market) {
        results.push({
          cid_hex,
          status: 'error',
          error: 'No data returned from API',
        });
      } else {
        const resolutionData = deriveResolutionData(market);
        results.push({
          cid_hex,
          status: 'ok',
          error: '',
          data: resolutionData,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        cid_hex,
        status: 'error',
        error,
      });
    }

    // Rate limiting delay (except for last item)
    if (i < targets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

async function saveResults(results: Array<any>) {
  const successfulResults = results.filter(r => r.status === 'ok' && r.data);

  if (successfulResults.length > 0) {
    const values = successfulResults.map(r => {
      const { cid_hex, data } = r;
      return `(
        '${cid_hex}',
        ${data.resolved},
        ${data.winning_index},
        [${data.payout_numerators.join(',')}],
        ${data.payout_denominator !== null ? data.payout_denominator : 'NULL'},
        [${data.outcomes.map((o: string) => `'${o.replace(/'/g, "\\'")}'`).join(',')}],
        '${data.title.replace(/'/g, "\\'")}',
        '${data.category.replace(/'/g, "\\'")}',
        [${data.tags.map((t: string) => `'${t.replace(/'/g, "\\'")}'`).join(',')}],
        ${data.resolution_time ? `'${data.resolution_time}'` : 'NULL'}
      )`;
    });

    await client.exec({
      query: `
        INSERT INTO cascadian_clean.resolutions_src_api
        (cid_hex, resolved, winning_index, payout_numerators, payout_denominator,
         outcomes, title, category, tags, resolution_time)
        VALUES ${values.join(',')}
      `,
    });
  }

  // Update backfill_progress for all results
  for (const result of results) {
    await client.exec({
      query: `
        INSERT INTO cascadian_clean.backfill_progress
        (cid_hex, status, attempts, last_error)
        VALUES (
          '${result.cid_hex}',
          '${result.status}',
          1,
          '${result.error.replace(/'/g, "\\'")}'
        )
      `,
    });
  }
}

// Stall detection function
function checkStall(processed: number) {
  const now = Date.now();
  const timeSinceProgress = (now - lastProgressTime) / 1000;

  if (processed > lastProcessedCount) {
    // Progress made
    lastProgressTime = now;
    lastProcessedCount = processed;
  } else if (timeSinceProgress > STALL_THRESHOLD_SEC) {
    console.warn(`⚠️  STALL DETECTED! No progress for ${timeSinceProgress.toFixed(0)}s`);
    console.warn(`⚠️  Reducing rate from ${currentReqPerSec} to ${currentReqPerSec / 2} req/s`);
    currentReqPerSec = Math.max(MIN_REQ_PER_SEC, currentReqPerSec / 2);
    lastProgressTime = now; // Reset to avoid repeated warnings
  }
}

async function backfillMarketResolutions() {
  console.log('BACKFILL: Fetching market resolutions from Gamma API (IMPROVED)\n');
  console.log('═'.repeat(80));
  console.log(`Initial rate: ${currentReqPerSec} req/s (adaptive, will adjust as needed)`);
  console.log(`Batch size: ${BATCH_SIZE} markets per batch`);
  console.log(`Features: Auto-recovery from rate limits, stall detection, health monitoring\n`);

  const totalPending = await client.query({
    query: `
      SELECT count() AS cnt
      FROM cascadian_clean.backfill_progress
      WHERE status = 'pending'
    `,
    format: 'JSONEachRow',
  });
  const total = (await totalPending.json<Array<{ cnt: number }>>())[0].cnt;

  console.log(`Total pending: ${total.toLocaleString()}`);
  console.log(`Estimated time: ~${Math.ceil(total / currentReqPerSec / 60)} minutes\n`);

  let processed = 0;
  let successful = 0;
  let errors = 0;
  const startTime = Date.now();

  while (true) {
    // Check for stalls
    checkStall(processed);

    // Fetch next batch
    const batchQuery = await client.query({
      query: `
        SELECT cid_hex
        FROM cascadian_clean.backfill_progress
        WHERE status = 'pending'
        LIMIT ${BATCH_SIZE}
      `,
      format: 'JSONEachRow',
    });

    const batch = await batchQuery.json<Array<{ cid_hex: string }>>();

    if (batch.length === 0) {
      console.log('\n✅ No more pending targets!');
      break;
    }

    // Process batch with current rate limit
    const results = await processBatchParallel(batch);

    // Save results
    await saveResults(results);

    // Update stats
    processed += results.length;
    successful += results.filter(r => r.status === 'ok').length;
    errors += results.filter(r => r.status === 'error').length;

    const elapsed = (Date.now() - startTime) / 1000;
    const actualRate = processed / elapsed;
    const remaining = total - processed;
    const eta = remaining / actualRate;

    // Adaptive rate adjustment (speed up if doing well)
    if (consecutiveErrors === 0 && actualRate > currentReqPerSec * 0.9) {
      // We're hitting our target rate and no errors - try speeding up slightly
      const newRate = Math.min(MAX_REQ_PER_SEC, currentReqPerSec * 1.05);
      if (newRate > currentReqPerSec) {
        currentReqPerSec = newRate;
      }
    }

    console.log(
      `Progress: ${processed.toLocaleString()}/${total.toLocaleString()} ` +
      `(${((processed / total) * 100).toFixed(1)}%) | ` +
      `✓ ${successful.toLocaleString()} ` +
      `✗ ${errors.toLocaleString()} | ` +
      `${actualRate.toFixed(1)} req/s (target: ${currentReqPerSec.toFixed(1)}) | ` +
      `ETA: ${Math.ceil(eta / 60)}m`
    );
  }

  console.log('\n' + '═'.repeat(80));
  console.log('BACKFILL COMPLETE!\n');
  console.log(`Total processed: ${processed.toLocaleString()}`);
  console.log(`Successful: ${successful.toLocaleString()} (${((successful / processed) * 100).toFixed(1)}%)`);
  console.log(`Errors: ${errors.toLocaleString()} (${((errors / processed) * 100).toFixed(1)}%)`);

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
  console.log(`Final rate: ${currentReqPerSec.toFixed(1)} req/s`);

  await client.close();
}

backfillMarketResolutions().catch(console.error);
