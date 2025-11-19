#!/usr/bin/env npx tsx

/**
 * Goldsky CLOB Fills Ingestion - OPTIMIZED with Batched Inserts
 *
 * Purpose: Fetch CLOB fills from Goldsky GraphQL and insert with batching
 * Optimizations:
 *   - Batch inserts across multiple markets (reduces ClickHouse lock contention)
 *   - Configurable batch sizes
 *   - Atomic checkpoint writes
 *   - Reduced checkpoint frequency
 *
 * Environment Variables:
 *   WORKER_COUNT - Number of parallel workers (default: 128)
 *   INSERT_BATCH_SIZE - Fills to accumulate before insert (default: 5000)
 *   CHECKPOINT_INTERVAL - Markets between checkpoints (default: 500)
 *   TEST_LIMIT - Limit markets for testing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';
import fs from 'fs/promises';

config({ path: resolve(process.cwd(), '.env.local') });

// Configuration
const GOLDSKY_ENDPOINT = process.env.GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn';
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '128');
const INSERT_BATCH_SIZE = parseInt(process.env.INSERT_BATCH_SIZE || '5000');
const CHECKPOINT_INTERVAL = parseInt(process.env.CHECKPOINT_INTERVAL || '500');
const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : undefined;
const CHECKPOINT_FILE = 'tmp/goldsky-fills-checkpoint.json';

// Stats tracking
let stats = {
  marketsProcessed: 0,
  fillsIngested: 0,
  errors: 0,
  startTime: Date.now(),
};

interface Market {
  condition_id: string;
  token_id: string;
  question: string;
}

interface OrderFilledEvent {
  id: string;
  timestamp: string;
  transactionHash: string;
  maker: string;
  taker: string;
  makerAssetId: string;
  takerAssetId: string;
  makerAmountFilled: string;
  takerAmountFilled: string;
  fee: string;
}

interface FillRow {
  fill_id: string;
  proxy_wallet: string;
  user_eoa: string;
  market_slug: string;
  condition_id: string;
  asset_id: string;
  outcome: string;
  side: string;
  price: number;
  size: number;
  fee_rate_bps: number;
  timestamp: number;
  order_hash: string;
  tx_hash: string;
  bucket_index: number;
}

interface Checkpoint {
  lastProcessedMarket: number;
  marketsProcessed: number;
  fillsIngested: number;
  timestamp: string;
}

// Shared fill buffer and mutex
let fillBuffer: FillRow[] = [];
let bufferLock = Promise.resolve();

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  // Atomic write: temp file + rename
  const tempFile = CHECKPOINT_FILE + '.tmp';
  await fs.writeFile(tempFile, JSON.stringify(checkpoint, null, 2));
  await fs.rename(tempFile, CHECKPOINT_FILE);
}

async function fetchMarkets(): Promise<Market[]> {
  console.log('Fetching markets from ClickHouse...');

  const query = `
    SELECT
      gm.condition_id,
      gm.token_id,
      gm.question
    FROM gamma_markets gm
    LEFT JOIN gamma_resolved gr ON gm.condition_id = concat('0x', gr.cid)
    WHERE gr.cid IS NOT NULL
    ORDER BY gm.fetched_at DESC
    ${TEST_LIMIT ? `LIMIT ${TEST_LIMIT}` : ''}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const markets = await result.json();

  console.log(`  ✅ Fetched ${markets.length} markets (resolved)`);
  console.log();

  return markets;
}

async function queryGoldskyFills(tokenId: string): Promise<OrderFilledEvent[]> {
  const query = `
    {
      orderFilledEvents(
        first: 1000
        orderBy: timestamp
        orderDirection: desc
        where: {
          or: [
            { makerAssetId: "${tokenId}" }
            { takerAssetId: "${tokenId}" }
          ]
        }
      ) {
        id timestamp transactionHash maker taker
        makerAssetId takerAssetId makerAmountFilled takerAmountFilled fee
      }
    }
  `;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data?.orderFilledEvents || [];
}

function transformFills(market: Market, fills: OrderFilledEvent[]): FillRow[] {
  return fills.map(fill => {
    const isMaker = fill.makerAssetId === market.token_id;
    const side = isMaker ? 'SELL' : 'BUY';

    const makerAmount = parseFloat(fill.makerAmountFilled);
    const takerAmount = parseFloat(fill.takerAmountFilled);
    let price = isMaker ? (takerAmount / makerAmount) : (makerAmount / takerAmount);

    if (!isFinite(price) || price <= 0) price = 0.5;

    const size = parseFloat(isMaker ? fill.makerAmountFilled : fill.takerAmountFilled);
    const wallet = (isMaker ? fill.maker : fill.taker).toLowerCase();

    return {
      fill_id: fill.id,
      proxy_wallet: wallet,
      user_eoa: wallet,
      market_slug: '',
      condition_id: market.condition_id,
      asset_id: market.token_id,
      outcome: '',
      side,
      price,
      size,
      fee_rate_bps: parseInt(fill.fee) || 0,
      timestamp: parseInt(fill.timestamp),
      order_hash: '',
      tx_hash: fill.transactionHash,
      bucket_index: 0,
    };
  });
}

async function flushFillBuffer() {
  if (fillBuffer.length === 0) return;

  const values = fillBuffer.map(fill => `(
    '${fill.fill_id}',
    '${fill.proxy_wallet}',
    '${fill.user_eoa}',
    '${fill.market_slug}',
    '${fill.condition_id}',
    '${fill.asset_id}',
    '${fill.outcome}',
    '${fill.side}',
    ${fill.price},
    ${fill.size},
    ${fill.fee_rate_bps},
    toDateTime(${fill.timestamp}),
    '${fill.order_hash}',
    '${fill.tx_hash}',
    ${fill.bucket_index},
    now()
  )`).join(',\n    ');

  const query = `
    INSERT INTO clob_fills_v2 (
      fill_id, proxy_wallet, user_eoa, market_slug, condition_id, asset_id,
      outcome, side, price, size, fee_rate_bps, timestamp, order_hash,
      tx_hash, bucket_index, ingested_at
    ) VALUES
      ${values}
  `;

  await clickhouse.exec({ query });
  stats.fillsIngested += fillBuffer.length;
  fillBuffer = [];
}

async function addToBuffer(fills: FillRow[]) {
  // Use lock to prevent concurrent buffer modifications
  bufferLock = bufferLock.then(async () => {
    fillBuffer.push(...fills);

    // Flush if buffer exceeds batch size
    if (fillBuffer.length >= INSERT_BATCH_SIZE) {
      await flushFillBuffer();
    }
  });

  await bufferLock;
}

async function processMarket(market: Market, workerIdx: number) {
  try {
    const fills = await queryGoldskyFills(market.token_id);

    if (fills.length > 0) {
      const rows = transformFills(market, fills);
      await addToBuffer(rows);

      console.log(`  [W${workerIdx}] ${market.question.slice(0, 50)}... → ${fills.length} fills`);
    }

    stats.marketsProcessed++;

    // Checkpoint less frequently
    if (stats.marketsProcessed % CHECKPOINT_INTERVAL === 0) {
      // Flush buffer before checkpointing
      await flushFillBuffer();

      await saveCheckpoint({
        lastProcessedMarket: stats.marketsProcessed,
        marketsProcessed: stats.marketsProcessed,
        fillsIngested: stats.fillsIngested,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error: any) {
    console.error(`  [W${workerIdx}] ❌ ${market.question.slice(0, 50)}... → ${error.message}`);
    stats.errors++;
  }
}

async function workerLoop(workerIdx: number, markets: Market[], startIdx: number) {
  for (let i = startIdx; i < markets.length; i += WORKER_COUNT) {
    await processMarket(markets[i], workerIdx);
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('GOLDSKY CLOB FILLS INGESTION - OPTIMIZED');
  console.log('═'.repeat(80));
  console.log(`Endpoint: ${GOLDSKY_ENDPOINT}`);
  console.log(`Workers: ${WORKER_COUNT}`);
  console.log(`Insert batch size: ${INSERT_BATCH_SIZE} fills`);
  console.log(`Checkpoint interval: ${CHECKPOINT_INTERVAL} markets`);
  console.log(`Test Limit: ${TEST_LIMIT || 'None (full backfill)'}`);
  console.log('═'.repeat(80));
  console.log();

  // Load checkpoint
  const checkpoint = await loadCheckpoint();
  if (checkpoint) {
    console.log(`📍 Resuming from checkpoint:`);
    console.log(`   Last processed: ${checkpoint.lastProcessedMarket} markets`);
    console.log(`   Fills ingested: ${checkpoint.fillsIngested}`);
    console.log(`   Timestamp: ${checkpoint.timestamp}\n`);
  }

  // Fetch markets
  const markets = await fetchMarkets();
  const startIdx = checkpoint?.lastProcessedMarket || 0;
  const remainingMarkets = markets.slice(startIdx);

  console.log(`Starting ingestion with ${WORKER_COUNT} workers...`);
  console.log(`Markets to process: ${remainingMarkets.length}\n`);

  // Launch workers
  const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
    workerLoop(i, remainingMarkets, i)
  );

  await Promise.all(workers);

  // Final flush
  await flushFillBuffer();

  // Final stats
  const duration = (Date.now() - stats.startTime) / 1000;
  console.log();
  console.log('═'.repeat(80));
  console.log('✅ INGESTION COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Markets processed: ${stats.marketsProcessed}`);
  console.log(`Fills ingested: ${stats.fillsIngested}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`);
  console.log(`Rate: ${(stats.marketsProcessed / duration * 60).toFixed(1)} markets/min`);
  console.log(`Rate: ${(stats.marketsProcessed / duration).toFixed(1)} markets/sec`);
  console.log('═'.repeat(80));

  // Verify results
  console.log('\nVerifying results...');
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM clob_fills_v2',
    format: 'JSONEachRow',
  });
  const data = await result.json();
  console.log(`Total fills in table: ${data[0].count}\n`);
}

main().catch(console.error);
