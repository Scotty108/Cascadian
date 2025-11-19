#!/usr/bin/env npx tsx

/**
 * Goldsky CLOB Fills Ingestion - Parallel Worker Pattern with Pagination
 *
 * Purpose: Fetch CLOB fills from Goldsky GraphQL subgraph and insert into production table
 * Strategy: Query by token_id from gamma_markets, prioritize resolved markets
 * Pagination: Automatically fetches ALL fills per market (batches of 1000, up to 50k per market)
 * Runtime: ~2-4 hours for 139K markets with 128 workers
 *
 * Environment Variables:
 *   WORKER_COUNT - Number of parallel workers (default: 8, recommended: 128)
 *   TEST_LIMIT - Limit markets for testing (default: undefined = all markets)
 *   BATCH_SIZE - Markets per batch (default: 100)
 *   GOLDSKY_ENDPOINT - Override default endpoint
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';
import fs from 'fs/promises';

config({ path: resolve(process.cwd(), '.env.local') });

// Configuration
const GOLDSKY_ENDPOINT = process.env.GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn';
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '8');
const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : undefined;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100');
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
  is_resolved: boolean;
  winning_outcome?: string;
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

interface Checkpoint {
  lastProcessedMarket: number;
  marketsProcessed: number;
  fillsIngested: number;
  timestamp: string;
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function fetchMarkets(): Promise<Market[]> {
  console.log('Fetching markets from ClickHouse...');

  // Only fetch markets that don't have fills yet (targeted gap fill)
  const query = `
    SELECT
      gm.condition_id,
      gm.token_id,
      gm.question,
      IF(gr.cid IS NOT NULL, 1, 0) as is_resolved,
      gr.winning_outcome
    FROM gamma_markets gm
    LEFT JOIN gamma_resolved gr ON gm.condition_id = concat('0x', gr.cid)
    WHERE gm.condition_id NOT IN (
      SELECT DISTINCT condition_id FROM clob_fills
    )
    ORDER BY is_resolved DESC, gm.fetched_at DESC
    ${TEST_LIMIT ? `LIMIT ${TEST_LIMIT}` : ''}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const markets = await result.json();

  console.log(`  ✅ Fetched ${markets.length} markets`);
  console.log(`     Resolved: ${markets.filter((m: any) => m.is_resolved).length}`);
  console.log(`     Open: ${markets.filter((m: any) => !m.is_resolved).length}\n`);

  return markets;
}

async function queryGoldskyFills(tokenId: string): Promise<OrderFilledEvent[]> {
  const allFills: OrderFilledEvent[] = [];
  let skip = 0;
  const batchSize = 1000;
  let hasMore = true;

  // Paginate through all fills for this market
  while (hasMore) {
    const query = `
      {
        orderFilledEvents(
          first: ${batchSize}
          skip: ${skip}
          orderBy: timestamp
          orderDirection: desc
          where: {
            or: [
              { makerAssetId: "${tokenId}" }
              { takerAssetId: "${tokenId}" }
            ]
          }
        ) {
          id
          timestamp
          transactionHash
          maker
          taker
          makerAssetId
          takerAssetId
          makerAmountFilled
          takerAmountFilled
          fee
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

    const fills = data.data?.orderFilledEvents || [];
    allFills.push(...fills);

    // Check if we got a full batch (indicating more results)
    hasMore = fills.length === batchSize;
    skip += batchSize;

    // Safety limit to prevent infinite loops
    if (skip > 50000) {
      console.warn(`      ⚠️  Market ${tokenId} exceeded 50k fills, stopping pagination`);
      break;
    }
  }

  return allFills;
}

async function insertFills(market: Market, fills: OrderFilledEvent[]) {
  if (fills.length === 0) return;

  try {
    const values = fills.map(fill => {
      // Determine side based on whether this market's token was maker or taker
      const isMaker = fill.makerAssetId === market.token_id;
      const side = isMaker ? 'SELL' : 'BUY'; // Maker sells, taker buys

      // Calculate price from ratio of amounts (scale to 18 decimals)
      const makerAmount = parseFloat(fill.makerAmountFilled);
      const takerAmount = parseFloat(fill.takerAmountFilled);
      let price = isMaker
        ? (takerAmount / makerAmount)
        : (makerAmount / takerAmount);

      // Handle edge cases
      if (!isFinite(price) || price <= 0) price = 0.5; // Default to 50%

      const size = isMaker ? fill.makerAmountFilled : fill.takerAmountFilled;
      const wallet = isMaker ? fill.maker : fill.taker;

      return `(
        '${fill.id}',
        '${wallet.toLowerCase()}',
        '${wallet.toLowerCase()}',
        '',
        '${market.condition_id}',
        '${market.token_id}',
        '',
        '${side}',
        ${price},
        ${parseFloat(size)},
        ${parseInt(fill.fee) || 0},
        toDateTime(${fill.timestamp}),
        '',
        '${fill.transactionHash}',
        0,
        now()
      )`;
    }).join(',\n      ');

    const insertQuery = `
      INSERT INTO clob_fills (
        fill_id, proxy_wallet, user_eoa, market_slug, condition_id, asset_id,
        outcome, side, price, size, fee_rate_bps, timestamp, order_hash,
        tx_hash, bucket_index, ingested_at
      ) VALUES
        ${values}
    `;

    await clickhouse.exec({ query: insertQuery });
    stats.fillsIngested += fills.length;
  } catch (error: any) {
    throw new Error(`Insert failed: ${error.message}`);
  }
}

async function processMarket(market: Market, workerIdx: number) {
  try {
    const fills = await queryGoldskyFills(market.token_id);

    if (fills.length > 0) {
      await insertFills(market, fills);
      const paginationNote = fills.length > 1000 ? ` (paginated!)` : '';
      console.log(`  [W${workerIdx}] ${market.question.slice(0, 50)}... → ${fills.length} fills${paginationNote}`);
    }

    stats.marketsProcessed++;

    // Checkpoint every 100 markets
    if (stats.marketsProcessed % 100 === 0) {
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
  console.log('GOLDSKY CLOB FILLS INGESTION - PARALLEL WORKERS');
  console.log('═'.repeat(80));
  console.log(`Endpoint: ${GOLDSKY_ENDPOINT}`);
  console.log(`Workers: ${WORKER_COUNT}`);
  console.log(`Test Limit: ${TEST_LIMIT || 'None (full backfill)'}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
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
  console.log('═'.repeat(80));

  // Verify results
  console.log('\nVerifying results...');
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM clob_fills',
    format: 'JSONEachRow',
  });
  const data = await result.json();
  console.log(`Total fills in production table: ${data[0].count}\n`);
}

main().catch(console.error);
