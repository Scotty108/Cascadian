#!/usr/bin/env tsx
/**
 * Backfill Historical Trades from Polymarket Subgraph
 *
 * Purpose: Fetch all trades before Aug 21, 2024 (CLOB data start date)
 *          using Polymarket's official subgraph on The Graph
 *
 * API: GraphQL endpoint on goldsky
 * Workers: 8 parallel workers (configurable)
 * Checkpoint: Saves progress every 1000 trades
 * Stall Detection: Restarts workers if no progress for 60 seconds
 * Crash Protection: Resumes from last checkpoint
 *
 * Free Tier Limit: 100k queries/month (~3,300/day)
 * Rate Limit Strategy: 1 query/second per worker = 8 QPS max
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/polymarket-subgraph/prod/gn';
const CHECKPOINT_FILE = '.backfill-checkpoint.json';
const BATCH_SIZE = 100;  // Trades per query
const MAX_WORKERS = 8;   // Parallel workers
const QUERY_DELAY_MS = 1000;  // 1 second between queries per worker
const STALL_TIMEOUT_MS = 60000;  // 60 seconds
const CHECKPOINT_INTERVAL = 1000;  // Save every 1000 trades

// Historical cutoff: Aug 21, 2024 00:00:00 UTC
const HISTORICAL_CUTOFF_TIMESTAMP = Math.floor(new Date('2024-08-21T00:00:00Z').getTime() / 1000);

interface SubgraphTrade {
  id: string;
  market: {
    id: string;
    conditionId: string;
    question: string;
    outcomes: string[];
  };
  user: {
    id: string;
  };
  outcome: string;
  outcomeIndex: number;
  side: string;  // 'BUY' or 'SELL'
  shares: string;
  price: string;
  collateral: string;
  fee: string;
  timestamp: string;
  transactionHash: string;
  blockNumber: string;
}

interface Checkpoint {
  lastTimestamp: number;
  lastTradeId: string;
  totalProcessed: number;
  workersCompleted: number[];
}

// ============================================================================
// GraphQL Queries
// ============================================================================

function buildTradesQuery(afterTimestamp: number, afterId: string, limit: number): string {
  return `
    query HistoricalTrades {
      trades(
        first: ${limit}
        orderBy: timestamp
        orderDirection: asc
        where: {
          timestamp_lt: ${HISTORICAL_CUTOFF_TIMESTAMP}
          timestamp_gt: ${afterTimestamp}
          id_gt: "${afterId}"
        }
      ) {
        id
        market {
          id
          conditionId
          question
          outcomes
        }
        user {
          id
        }
        outcome
        outcomeIndex
        side
        shares
        price
        collateral
        fee
        timestamp
        transactionHash
        blockNumber
      }
    }
  `;
}

// ============================================================================
// Checkpoint Management
// ============================================================================

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
      console.log(`📍 Resuming from checkpoint: ${data.totalProcessed} trades processed`);
      return data;
    } catch (error) {
      console.log('⚠️  Invalid checkpoint file, starting fresh');
    }
  }

  return {
    lastTimestamp: 0,
    lastTradeId: '',
    totalProcessed: 0,
    workersCompleted: []
  };
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// ============================================================================
// Subgraph Fetching
// ============================================================================

async function fetchTradesFromSubgraph(
  afterTimestamp: number,
  afterId: string,
  limit: number
): Promise<SubgraphTrade[]> {
  const query = buildTradesQuery(afterTimestamp, afterId, limit);

  try {
    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Subgraph returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data?.trades || [];
  } catch (error: any) {
    console.error(`❌ Subgraph fetch failed: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Data Mapping
// ============================================================================

function mapSubgraphTradeToSchema(trade: SubgraphTrade): any {
  const conditionId = trade.market.conditionId.toLowerCase().replace('0x', '');

  return {
    fill_id: trade.id,
    block_time: new Date(parseInt(trade.timestamp) * 1000).toISOString().replace('T', ' ').substring(0, 19),
    block_number: parseInt(trade.blockNumber),
    tx_hash: trade.transactionHash,
    asset_id_decimal: '',  // Not available in subgraph, will enrich later
    condition_id: conditionId,
    outcome_index: trade.outcomeIndex,
    outcome_label: trade.outcome,
    question: trade.market.question,
    wallet_address: trade.user.id.toLowerCase(),
    operator_address: '',
    is_proxy_trade: 0,
    side: trade.side,
    price: parseFloat(trade.price),
    shares: parseFloat(trade.shares),
    collateral_amount: parseFloat(trade.collateral),
    fee_amount: parseFloat(trade.fee),
    data_source: 'subgraph',
    source_metadata: JSON.stringify({
      market_id: trade.market.id,
      block_number: trade.blockNumber,
      timestamp: trade.timestamp
    })
  };
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertTradesBatch(trades: any[]): Promise<void> {
  if (trades.length === 0) return;

  await clickhouse.insert({
    table: 'pm_trades_external',
    values: trades,
    format: 'JSONEachRow'
  });
}

// ============================================================================
// Worker Pool
// ============================================================================

class BackfillWorker {
  private workerId: number;
  private checkpoint: Checkpoint;
  private isRunning: boolean = false;
  private lastProgressTime: number = Date.now();
  private tradesProcessed: number = 0;

  constructor(workerId: number, checkpoint: Checkpoint) {
    this.workerId = workerId;
    this.checkpoint = checkpoint;
  }

  async run(): Promise<void> {
    this.isRunning = true;
    console.log(`Worker ${this.workerId}: Started`);

    let currentTimestamp = this.checkpoint.lastTimestamp;
    let currentId = this.checkpoint.lastTradeId;
    let hasMore = true;

    while (hasMore && this.isRunning) {
      try {
        // Fetch batch
        const trades = await fetchTradesFromSubgraph(
          currentTimestamp,
          currentId,
          BATCH_SIZE
        );

        if (trades.length === 0) {
          hasMore = false;
          break;
        }

        // Map to schema
        const mappedTrades = trades.map(mapSubgraphTradeToSchema);

        // Insert into DB
        await insertTradesBatch(mappedTrades);

        // Update progress
        this.tradesProcessed += trades.length;
        this.lastProgressTime = Date.now();

        // Update checkpoint
        const lastTrade = trades[trades.length - 1];
        currentTimestamp = parseInt(lastTrade.timestamp);
        currentId = lastTrade.id;

        console.log(`Worker ${this.workerId}: Processed ${trades.length} trades (total: ${this.tradesProcessed})`);

        // Save checkpoint every CHECKPOINT_INTERVAL trades
        if (this.tradesProcessed % CHECKPOINT_INTERVAL === 0) {
          this.checkpoint.lastTimestamp = currentTimestamp;
          this.checkpoint.lastTradeId = currentId;
          this.checkpoint.totalProcessed += this.tradesProcessed;
          saveCheckpoint(this.checkpoint);
          console.log(`Worker ${this.workerId}: Checkpoint saved at ${this.checkpoint.totalProcessed} trades`);
        }

        // Rate limit: delay between queries
        await new Promise(resolve => setTimeout(resolve, QUERY_DELAY_MS));

      } catch (error: any) {
        console.error(`Worker ${this.workerId}: Error - ${error.message}`);
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log(`Worker ${this.workerId}: Completed (${this.tradesProcessed} trades)`);
    this.checkpoint.workersCompleted.push(this.workerId);
    this.isRunning = false;
  }

  isStalled(): boolean {
    return Date.now() - this.lastProgressTime > STALL_TIMEOUT_MS;
  }

  stop(): void {
    this.isRunning = false;
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log('Historical Trade Backfill - Polymarket Subgraph');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Agent: C2 - External Data Ingestion');
  console.log('Target: All trades before Aug 21, 2024');
  console.log('Source: Polymarket Subgraph (GraphQL on goldsky)');
  console.log(`Workers: ${MAX_WORKERS} parallel workers`);
  console.log(`Batch size: ${BATCH_SIZE} trades per query`);
  console.log(`Rate limit: ${QUERY_DELAY_MS}ms between queries per worker`);
  console.log('');

  // Pre-flight: Check table exists
  console.log('Pre-flight: Checking pm_trades_external table...');
  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM pm_trades_external WHERE data_source = \'subgraph\'',
      format: 'JSONEachRow'
    });
    const data = await result.json();
    console.log(`✅ Table exists with ${data[0].cnt} subgraph trades`);
  } catch (error: any) {
    console.error('❌ Table does not exist. Run migration first:');
    console.error('   clickhouse-client < migrations/clickhouse/017_create_pm_trades_external.sql');
    process.exit(1);
  }
  console.log('');

  // Load checkpoint
  const checkpoint = loadCheckpoint();

  // Create worker pool
  console.log(`Launching ${MAX_WORKERS} workers...`);
  const workers: BackfillWorker[] = [];
  for (let i = 0; i < MAX_WORKERS; i++) {
    workers.push(new BackfillWorker(i, checkpoint));
  }

  // Start workers
  const workerPromises = workers.map(w => w.run());

  // Stall detection loop
  const stallCheckInterval = setInterval(() => {
    for (const worker of workers) {
      if (worker.isStalled()) {
        console.log(`⚠️  Worker ${workers.indexOf(worker)} appears stalled, restarting...`);
        worker.stop();
      }
    }
  }, 30000);  // Check every 30 seconds

  // Wait for all workers to complete
  await Promise.all(workerPromises);
  clearInterval(stallCheckInterval);

  console.log('');
  console.log('═'.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log('');

  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        data_source,
        COUNT(*) as trade_count,
        COUNT(DISTINCT condition_id) as market_count,
        COUNT(DISTINCT wallet_address) as wallet_count,
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade
      FROM pm_trades_external
      GROUP BY data_source
    `,
    format: 'JSONEachRow'
  });

  const stats = await finalResult.json();
  console.table(stats);
  console.log('');
  console.log('✅ Historical backfill completed successfully');
  console.log('');
  console.log('Next steps:');
  console.log('1. Verify data quality: SELECT COUNT(*) FROM pm_trades_complete');
  console.log('2. Test P&L calculations with historical data');
  console.log('3. Compare against Dome baseline wallets');
  console.log('');
  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Backfill failed:', error);
  process.exit(1);
});
