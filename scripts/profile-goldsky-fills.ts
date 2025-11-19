#!/usr/bin/env npx tsx

/**
 * Profile Goldsky CLOB Fills Ingestion - Single Batch Timing
 *
 * Purpose: Measure timing for GraphQL query, transform, and insert steps
 * to identify bottlenecks in the ingestion pipeline
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const GOLDSKY_ENDPOINT = process.env.GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn';

const BATCH_SIZE = 10; // Profile 10 markets

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

interface Timing {
  market: string;
  graphqlMs: number;
  transformMs: number;
  insertMs: number;
  totalMs: number;
  fillCount: number;
}

async function fetchMarkets(): Promise<Market[]> {
  const query = `
    SELECT
      gm.condition_id,
      gm.token_id,
      gm.question
    FROM gamma_markets gm
    LEFT JOIN gamma_resolved gr ON gm.condition_id = concat('0x', gr.cid)
    WHERE gr.cid IS NOT NULL
    ORDER BY gm.fetched_at DESC
    LIMIT ${BATCH_SIZE}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json();
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

function transformFills(market: Market, fills: OrderFilledEvent[]): string {
  if (fills.length === 0) return '';

  const values = fills.map(fill => {
    const isMaker = fill.makerAssetId === market.token_id;
    const side = isMaker ? 'SELL' : 'BUY';

    const makerAmount = parseFloat(fill.makerAmountFilled);
    const takerAmount = parseFloat(fill.takerAmountFilled);
    let price = isMaker ? (takerAmount / makerAmount) : (makerAmount / takerAmount);

    if (!isFinite(price) || price <= 0) price = 0.5;

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

  return `
    INSERT INTO clob_fills_v2 (
      fill_id, proxy_wallet, user_eoa, market_slug, condition_id, asset_id,
      outcome, side, price, size, fee_rate_bps, timestamp, order_hash,
      tx_hash, bucket_index, ingested_at
    ) VALUES
      ${values}
  `;
}

async function profileMarket(market: Market): Promise<Timing> {
  const totalStart = performance.now();

  // 1. GraphQL query
  const graphqlStart = performance.now();
  const fills = await queryGoldskyFills(market.token_id);
  const graphqlMs = performance.now() - graphqlStart;

  if (fills.length === 0) {
    return {
      market: market.question.slice(0, 50),
      graphqlMs,
      transformMs: 0,
      insertMs: 0,
      totalMs: performance.now() - totalStart,
      fillCount: 0,
    };
  }

  // 2. Transform
  const transformStart = performance.now();
  const insertQuery = transformFills(market, fills);
  const transformMs = performance.now() - transformStart;

  // 3. Insert
  const insertStart = performance.now();
  await clickhouse.exec({ query: insertQuery });
  const insertMs = performance.now() - insertStart;

  const totalMs = performance.now() - totalStart;

  return {
    market: market.question.slice(0, 50),
    graphqlMs,
    transformMs,
    insertMs,
    totalMs,
    fillCount: fills.length,
  };
}

async function main() {
  console.log('═'.repeat(80));
  console.log('GOLDSKY CLOB FILLS PROFILING');
  console.log('═'.repeat(80));
  console.log(`Batch size: ${BATCH_SIZE} markets`);
  console.log('═'.repeat(80));
  console.log();

  // Fetch test markets
  console.log('Fetching test markets...');
  const markets = await fetchMarkets();
  console.log(`Loaded ${markets.length} markets\n`);

  // Profile each market
  const timings: Timing[] = [];

  for (const market of markets) {
    const timing = await profileMarket(market);
    timings.push(timing);

    console.log(`${timing.market}...`);
    console.log(`  GraphQL: ${timing.graphqlMs.toFixed(0)}ms`);
    console.log(`  Transform: ${timing.transformMs.toFixed(0)}ms`);
    console.log(`  Insert: ${timing.insertMs.toFixed(0)}ms`);
    console.log(`  Total: ${timing.totalMs.toFixed(0)}ms`);
    console.log(`  Fills: ${timing.fillCount}`);
    console.log();
  }

  // Calculate averages
  const avg = {
    graphqlMs: timings.reduce((sum, t) => sum + t.graphqlMs, 0) / timings.length,
    transformMs: timings.reduce((sum, t) => sum + t.transformMs, 0) / timings.length,
    insertMs: timings.reduce((sum, t) => sum + t.insertMs, 0) / timings.length,
    totalMs: timings.reduce((sum, t) => sum + t.totalMs, 0) / timings.length,
    fillCount: timings.reduce((sum, t) => sum + t.fillCount, 0) / timings.length,
  };

  console.log('═'.repeat(80));
  console.log('AVERAGES');
  console.log('═'.repeat(80));
  console.log(`GraphQL query: ${avg.graphqlMs.toFixed(0)}ms (${(avg.graphqlMs / avg.totalMs * 100).toFixed(1)}%)`);
  console.log(`Transform: ${avg.transformMs.toFixed(0)}ms (${(avg.transformMs / avg.totalMs * 100).toFixed(1)}%)`);
  console.log(`ClickHouse insert: ${avg.insertMs.toFixed(0)}ms (${(avg.insertMs / avg.totalMs * 100).toFixed(1)}%)`);
  console.log(`Total: ${avg.totalMs.toFixed(0)}ms`);
  console.log(`Average fills per market: ${avg.fillCount.toFixed(0)}`);
  console.log();

  // Project performance
  const marketsPerSecond = 1000 / avg.totalMs;
  const totalMarkets = 171305;
  const etaSeconds = totalMarkets / marketsPerSecond;
  const etaHours = etaSeconds / 3600;

  console.log('PROJECTION (single worker):');
  console.log(`  Markets/second: ${marketsPerSecond.toFixed(2)}`);
  console.log(`  ETA for 171,305 markets: ${etaHours.toFixed(1)} hours`);
  console.log();

  console.log('PROJECTION (64 workers):');
  console.log(`  Markets/second: ${(marketsPerSecond * 64).toFixed(0)}`);
  console.log(`  ETA for 171,305 markets: ${(etaHours / 64).toFixed(1)} hours`);
  console.log();

  console.log('BOTTLENECK ANALYSIS:');
  if (avg.graphqlMs > avg.insertMs * 2) {
    console.log('  ⚠️  BOTTLENECK: GraphQL queries (Goldsky latency)');
    console.log('  Recommendation: Increase workers or batch markets');
  } else if (avg.insertMs > avg.graphqlMs * 2) {
    console.log('  ⚠️  BOTTLENECK: ClickHouse inserts');
    console.log('  Recommendation: Batch inserts or optimize table structure');
  } else {
    console.log('  ✅ Balanced - no clear bottleneck');
    console.log('  Recommendation: Increase worker count');
  }
  console.log();
}

main().catch(console.error);
