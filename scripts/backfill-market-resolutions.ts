#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';
import Bottleneck from 'bottleneck';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Rate limiting: Default 3 req/s (safe), 12.4 req/s with FAST=1 (max safe: 12.5)
const FAST_MODE = process.env.FAST === '1';
const reqPerSec = FAST_MODE ? 12.4 : 3;

const limiter = new Bottleneck({
  minTime: 1000 / reqPerSec,
  reservoir: 125,
  reservoirRefreshAmount: 125,
  reservoirRefreshInterval: 10_000, // 125 requests per 10 seconds (Gamma limit)
});

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const BATCH_SIZE = 100; // Fetch this many pending targets at a time

interface GammaMarket {
  condition_id: string;
  question?: string;
  outcomes?: string[];
  outcomePrices?: string[];
  outcome?: string; // Winning outcome (if resolved)
  closed?: boolean;
  resolvedAt?: string;
  category?: string;
  tags?: string[];
}

async function fetchMarketData(cid_hex: string): Promise<GammaMarket | null> {
  try {
    const url = `${GAMMA_API}?condition_id=${cid_hex}`;
    const response = await fetch(url);

    if (response.status === 429) {
      // Rate limited - limiter should prevent this, but handle gracefully
      console.warn(`⚠️  Rate limited on ${cid_hex.slice(0, 10)}... (retrying)`);
      throw new Error('RATE_LIMITED');
    }

    if (response.status >= 500) {
      console.warn(`⚠️  Server error ${response.status} on ${cid_hex.slice(0, 10)}...`);
      throw new Error('SERVER_ERROR');
    }

    if (!response.ok) {
      console.warn(`⚠️  HTTP ${response.status} on ${cid_hex.slice(0, 10)}...`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    if (err instanceof Error && (err.message === 'RATE_LIMITED' || err.message === 'SERVER_ERROR')) {
      throw err; // Re-throw for retry logic
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
    // Find winning index
    winning_index = outcomes.findIndex(o =>
      o.toLowerCase() === winningOutcome.toLowerCase()
    );

    if (winning_index >= 0) {
      // One-hot payout vector
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

async function processBatch(targets: Array<{ cid_hex: string }>) {
  const results: Array<{
    cid_hex: string;
    status: 'ok' | 'error';
    error: string;
    data?: any;
  }> = [];

  for (const target of targets) {
    const { cid_hex } = target;

    try {
      // Rate-limited fetch
      const market = await limiter.schedule(() => fetchMarketData(cid_hex));

      if (!market) {
        results.push({
          cid_hex,
          status: 'error',
          error: 'No data returned from API',
        });
        continue;
      }

      const resolutionData = deriveResolutionData(market);

      results.push({
        cid_hex,
        status: 'ok',
        error: '',
        data: resolutionData,
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        cid_hex,
        status: 'error',
        error,
      });
    }
  }

  return results;
}

async function saveResults(results: Array<any>) {
  // Save successful results to resolutions_src_api
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

async function backfillMarketResolutions() {
  console.log('BACKFILL: Fetching market resolutions from Gamma API\n');
  console.log('═'.repeat(80));
  console.log(`Rate limit: ${reqPerSec} req/s (${FAST_MODE ? 'FAST MODE' : 'safe mode'})`);
  console.log(`Batch size: ${BATCH_SIZE} markets per batch\n`);

  // Get initial counts
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
  console.log(`Estimated time: ~${Math.ceil(total / reqPerSec / 60)} minutes\n`);

  let processed = 0;
  let successful = 0;
  let errors = 0;

  const startTime = Date.now();

  while (true) {
    // Fetch next batch of pending targets
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

    // Process batch
    const results = await processBatch(batch);

    // Save results
    await saveResults(results);

    // Update stats
    processed += results.length;
    successful += results.filter(r => r.status === 'ok').length;
    errors += results.filter(r => r.status === 'error').length;

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = total - processed;
    const eta = remaining / rate;

    console.log(
      `Progress: ${processed.toLocaleString()}/${total.toLocaleString()} ` +
      `(${((processed / total) * 100).toFixed(1)}%) | ` +
      `✓ ${successful.toLocaleString()} ` +
      `✗ ${errors.toLocaleString()} | ` +
      `${rate.toFixed(1)} req/s | ` +
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

  await client.close();
}

backfillMarketResolutions().catch(console.error);
