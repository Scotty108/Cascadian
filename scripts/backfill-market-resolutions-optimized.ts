#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';
import Bottleneck from 'bottleneck';
import { Agent, setGlobalDispatcher } from 'undici';

// HTTP keep-alive pool
setGlobalDispatcher(new Agent({
  connectTimeout: 5_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
  connections: 64
}));

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const MAX_CONCURRENT = process.env.FAST === '1' ? 16 : 8;
const BATCH_SIZE = 500;

// Bottleneck with reservoir rate limiting
const limiter = new Bottleneck({
  reservoir: 125,
  reservoirRefreshAmount: 125,
  reservoirRefreshInterval: 10_000,
  maxConcurrent: MAX_CONCURRENT
});

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

async function fetchOne(cid: string): Promise<{ cid: string; body: GammaMarket | null }> {
  const url = `${GAMMA_API}?condition_id=${cid}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);

    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }

      if (res.status === 404) {
        return { cid, body: null };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      return { cid, body };
    } catch (e) {
      clearTimeout(t);
      if (attempt === 4) {
        console.error(`Failed ${cid.slice(0, 10)}... after 4 attempts:`, e);
        return { cid, body: null };
      }
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }

  return { cid, body: null };
}

function deriveResolutionData(cid: string, market: GammaMarket) {
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
    cid_hex: cid,
    resolved,
    winning_index,
    payout_numerators,
    payout_denominator,
    outcomes,
    title: market.question || '',
    category: market.category || '',
    tags: market.tags || [],
    resolution_time: market.resolvedAt || null,
    inserted_at: new Date().toISOString(),
  };
}

async function getQueueBatch(lastCid: string | null, limit = BATCH_SIZE) {
  const where = lastCid ? `WHERE cid_hex > '${lastCid}'` : '';
  const q = `
    SELECT cid_hex
    FROM cascadian_clean.backfill_progress
    WHERE status = 'pending'
    ${where ? 'AND ' + where.replace('WHERE ', '') : ''}
    ORDER BY cid_hex
    LIMIT ${limit}
  `;
  const r = await client.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json<{ cid_hex: string }[]>();
  return rows.map(x => x.cid_hex);
}

async function backfillOptimized() {
  console.log('BACKFILL: Optimized parallel fetcher with HTTP keep-alive\n');
  console.log('═'.repeat(80));
  console.log(`Max concurrent: ${MAX_CONCURRENT} requests`);
  console.log(`Reservoir: 125 requests per 10 seconds`);
  console.log(`Batch size: ${BATCH_SIZE} markets per iteration`);
  console.log(`HTTP keep-alive: enabled (64 connections)\n`);

  // Get total count
  const totalQuery = await client.query({
    query: `SELECT count() AS cnt FROM cascadian_clean.backfill_progress WHERE status = 'pending'`,
    format: 'JSONEachRow',
  });
  const total = (await totalQuery.json<Array<{ cnt: number }>>())[0].cnt;
  console.log(`Total pending: ${total.toLocaleString()}`);
  console.log(`Estimated time: ~${Math.ceil(total / 12 / 60)} minutes\n`);

  let lastCid: string | null = null;
  let processed = 0;
  let ok = 0;
  let err = 0;
  const startTime = Date.now();
  let lastProcessed = 0;

  // Adaptive speed watchdog
  const watchdog = setInterval(() => {
    const delta = processed - lastProcessed;
    lastProcessed = processed;

    if (delta === 0 && processed < total) {
      const curr = (limiter as any).store.__state__.maxConcurrent || MAX_CONCURRENT;
      const newMax = Math.max(4, Math.floor(curr / 2));
      limiter.updateSettings({ maxConcurrent: newMax });
      console.log(`⚠️  STALL detected. maxConcurrent -> ${newMax}`);
    } else if (delta > 1000) {
      const curr = (limiter as any).store.__state__.maxConcurrent || MAX_CONCURRENT;
      const newMax = Math.min(32, curr + 2);
      limiter.updateSettings({ maxConcurrent: newMax });
    }
  }, 60_000);
  watchdog.unref();

  while (true) {
    const batch = await getQueueBatch(lastCid, BATCH_SIZE);
    if (!batch.length) break;

    lastCid = batch[batch.length - 1];

    // Parallel fetch with rate limiting
    const results = await Promise.allSettled(
      batch.map(cid => limiter.schedule(() => fetchOne(cid)))
    );

    const successRows: any[] = [];
    const progressRows: any[] = [];

    for (const r of results) {
      processed++;

      if (r.status === 'fulfilled') {
        const { cid, body } = r.value;

        if (body) {
          ok++;
          const data = deriveResolutionData(cid, body);
          successRows.push(data);
          progressRows.push({
            cid_hex: cid,
            status: 'ok',
            attempts: 1,
            last_error: '',
          });
        } else {
          err++;
          progressRows.push({
            cid_hex: cid,
            status: 'error',
            attempts: 1,
            last_error: 'No data returned from API',
          });
        }
      } else {
        err++;
        const cid = batch[processed - ok - err];
        progressRows.push({
          cid_hex: cid,
          status: 'error',
          attempts: 1,
          last_error: r.reason?.message || 'Unknown error',
        });
      }
    }

    // Batch insert resolutions
    if (successRows.length > 0) {
      await client.insert({
        table: 'cascadian_clean.resolutions_src_api',
        values: successRows,
        format: 'JSONEachRow',
      });
    }

    // Batch insert progress
    if (progressRows.length > 0) {
      await client.insert({
        table: 'cascadian_clean.backfill_progress',
        values: progressRows,
        format: 'JSONEachRow',
      });
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = total - processed;
    const eta = remaining / rate;

    console.log(
      `Progress: ${processed.toLocaleString()}/${total.toLocaleString()} ` +
      `(${((processed / total) * 100).toFixed(1)}%) | ` +
      `✓ ${ok.toLocaleString()} ` +
      `✗ ${err.toLocaleString()} | ` +
      `${rate.toFixed(1)} req/s | ` +
      `ETA: ${Math.ceil(eta / 60)}m`
    );
  }

  clearInterval(watchdog);

  console.log('\n' + '═'.repeat(80));
  console.log('BACKFILL COMPLETE!\n');
  console.log(`Total processed: ${processed.toLocaleString()}`);
  console.log(`Successful: ${ok.toLocaleString()} (${((ok / processed) * 100).toFixed(1)}%)`);
  console.log(`Errors: ${err.toLocaleString()} (${((err / processed) * 100).toFixed(1)}%)`);

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
  console.log(`Average rate: ${(processed / (totalTime * 60)).toFixed(1)} req/s`);

  await client.close();
}

backfillOptimized().catch(console.error);
