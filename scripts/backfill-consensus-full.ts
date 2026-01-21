/**
 * Full Backfill Consensus Counts (with checkpointing)
 *
 * Processes ALL markets, saves progress, and can restart where it left off.
 * Uses unique temp table names to avoid collisions.
 *
 * Usage:
 *   npx tsx scripts/backfill-consensus-full.ts [--batch=20]
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const CHECKPOINT_FILE = '/tmp/consensus-backfill-checkpoint.json';
const PROGRESS_LOG_INTERVAL = 10; // Log progress every N batches

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    max_execution_time: 600,
    max_memory_usage: 10000000000, // 10GB (reduced for safety)
  },
});

interface Checkpoint {
  processedMarkets: string[];
  totalUpdated: number;
  startTime: number;
  lastBatch: number;
}

interface MarketBatch {
  market_id: string;
  snapshot_count: number;
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.log('No valid checkpoint found, starting fresh');
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function getMarketsToProcess(excludeIds: Set<string>): Promise<MarketBatch[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        market_id,
        count() as snapshot_count
      FROM wio_smart_money_metrics_v2
      WHERE sf_yes_count = 0 AND sf_no_count = 0
        AND smart_yes_count = 0 AND smart_no_count = 0
      GROUP BY market_id
      ORDER BY snapshot_count ASC
    `,
    format: 'JSONEachRow',
  });

  const all = (await result.json()) as MarketBatch[];

  // Filter out already processed markets
  return all.filter(m => !excludeIds.has(m.market_id));
}

async function computeConsensusForMarkets(marketIds: string[], batchNum: number): Promise<number> {
  if (marketIds.length === 0) return 0;

  const marketIdList = marketIds.map(id => `'${id}'`).join(',');
  const tempTable = `_tmp_consensus_${batchNum}_${Date.now()}`;

  try {
    // Step 1: Compute consensus counts into temp table
    await clickhouse.command({
      query: `
        CREATE TABLE ${tempTable} (
          market_id String,
          ts DateTime,
          sf_yes_count UInt16,
          sf_no_count UInt16,
          smart_yes_count UInt16,
          smart_no_count UInt16
        ) ENGINE = Memory AS
        SELECT
          m.market_id,
          m.ts,
          toUInt16(countDistinctIf(p.wallet_id,
            c.tier = 'superforecaster' AND p.side = 'YES'
            AND p.ts_open <= m.ts AND (p.ts_close IS NULL OR p.ts_close > m.ts)
          )) as sf_yes_count,
          toUInt16(countDistinctIf(p.wallet_id,
            c.tier = 'superforecaster' AND p.side = 'NO'
            AND p.ts_open <= m.ts AND (p.ts_close IS NULL OR p.ts_close > m.ts)
          )) as sf_no_count,
          toUInt16(countDistinctIf(p.wallet_id,
            c.tier = 'smart' AND p.side = 'YES'
            AND p.ts_open <= m.ts AND (p.ts_close IS NULL OR p.ts_close > m.ts)
          )) as smart_yes_count,
          toUInt16(countDistinctIf(p.wallet_id,
            c.tier = 'smart' AND p.side = 'NO'
            AND p.ts_open <= m.ts AND (p.ts_close IS NULL OR p.ts_close > m.ts)
          )) as smart_no_count
        FROM wio_smart_money_metrics_v2 m
        LEFT JOIN wio_positions_v2 p ON m.market_id = p.condition_id
        LEFT JOIN wio_wallet_classification_v1 c
          ON p.wallet_id = c.wallet_id AND c.window_id = '90d'
        WHERE m.market_id IN (${marketIdList})
          AND (c.tier IN ('superforecaster', 'smart') OR c.tier IS NULL)
        GROUP BY m.market_id, m.ts
      `,
    });

    // Step 2: Insert updated rows
    await clickhouse.command({
      query: `
        INSERT INTO wio_smart_money_metrics_v2
        SELECT
          m.market_id,
          m.ts,
          m.category,
          m.series_slug,
          m.end_date,
          m.is_resolved,
          m.outcome_resolved,
          m.crowd_price,
          m.smart_money_odds,
          m.yes_usd,
          m.no_usd,
          m.total_usd,
          m.wallet_count,
          m.wallet_count_yes,
          m.wallet_count_no,
          m.avg_entry_price,
          m.entry_edge_pct,
          m.flow_1h,
          m.flow_24h,
          m.flow_7d,
          m.new_wallets_1h,
          m.new_wallets_24h,
          m.new_wallets_7d,
          m.exits_1h,
          m.exits_24h,
          m.exits_7d,
          m.avg_position_size,
          m.max_position_size,
          m.avg_hold_hours,
          m.superforecaster_yes_usd,
          m.superforecaster_no_usd,
          m.smart_yes_usd,
          m.smart_no_usd,
          m.profitable_yes_usd,
          m.profitable_no_usd,
          m.superforecaster_count,
          m.smart_count,
          m.profitable_count,
          m.divergence,
          m.sm_direction,
          c.sf_yes_count,
          c.sf_no_count,
          c.smart_yes_count,
          c.smart_no_count
        FROM wio_smart_money_metrics_v2 m
        JOIN ${tempTable} c ON m.market_id = c.market_id AND m.ts = c.ts
        WHERE m.market_id IN (${marketIdList})
      `,
    });

    // Get count
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${tempTable}`,
      format: 'JSONEachRow',
    });
    const rows = (await countResult.json()) as { cnt: number }[];
    const insertedCount = rows[0]?.cnt || 0;

    // Cleanup
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS ${tempTable}`,
    });

    return insertedCount;
  } catch (error: any) {
    // Cleanup on error
    try {
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${tempTable}` });
    } catch {}
    throw error;
  }
}

async function getStats(): Promise<{ total: number; withConsensus: number; unanimousYes: number; unanimousNo: number }> {
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(sf_yes_count > 0 OR sf_no_count > 0 OR smart_yes_count > 0 OR smart_no_count > 0) as with_consensus,
        countIf((sf_yes_count + smart_yes_count) >= 3 AND (sf_no_count + smart_no_count) = 0) as unanimous_yes,
        countIf((sf_no_count + smart_no_count) >= 3 AND (sf_yes_count + smart_yes_count) = 0) as unanimous_no
      FROM wio_smart_money_metrics_v2
    `,
    format: 'JSONEachRow',
  });
  return (await result.json() as any[])[0];
}

async function main() {
  const args = process.argv.slice(2);
  const batchArg = args.find(a => a.startsWith('--batch='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1]) : 20;
  const resetArg = args.includes('--reset');

  console.log('=== Full Consensus Backfill (with checkpointing) ===\n');

  // Load or create checkpoint
  let checkpoint = resetArg ? null : loadCheckpoint();
  if (checkpoint) {
    const elapsed = ((Date.now() - checkpoint.startTime) / 1000 / 60).toFixed(1);
    console.log(`Resuming from checkpoint: ${checkpoint.processedMarkets.length} markets done, ${checkpoint.totalUpdated.toLocaleString()} rows, ${elapsed} min elapsed\n`);
  } else {
    checkpoint = {
      processedMarkets: [],
      totalUpdated: 0,
      startTime: Date.now(),
      lastBatch: 0,
    };
  }

  const processedSet = new Set(checkpoint.processedMarkets);

  // Get markets to process
  console.log('Finding markets without consensus counts...');
  const markets = await getMarketsToProcess(processedSet);
  console.log(`Found ${markets.length} markets remaining to process`);
  console.log(`Batch size: ${batchSize} (smaller = safer for memory)\n`);

  if (markets.length === 0) {
    console.log('All markets processed!');
    const stats = await getStats();
    console.log(`\nFinal stats:`);
    console.log(`  Total rows: ${stats.total.toLocaleString()}`);
    console.log(`  With consensus: ${stats.withConsensus.toLocaleString()}`);
    console.log(`  Unanimous YES (3+): ${stats.unanimousYes.toLocaleString()}`);
    console.log(`  Unanimous NO (3+): ${stats.unanimousNo.toLocaleString()}`);
    await clickhouse.close();
    return;
  }

  const totalBatches = Math.ceil(markets.length / batchSize);
  let batchNum = checkpoint.lastBatch;

  // Process in batches
  for (let i = 0; i < markets.length; i += batchSize) {
    batchNum++;
    const batch = markets.slice(i, i + batchSize);
    const batchIds = batch.map(m => m.market_id);
    const batchSnapshots = batch.reduce((sum, m) => sum + m.snapshot_count, 0);

    console.log(`Batch ${batchNum}/${totalBatches + checkpoint.lastBatch} | Markets: ${batch.length} | Snapshots: ${batchSnapshots}`);

    const batchStart = Date.now();
    try {
      const updated = await computeConsensusForMarkets(batchIds, batchNum);
      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.log(`  ✓ Updated ${updated.toLocaleString()} rows in ${elapsed}s`);

      // Update checkpoint
      checkpoint.processedMarkets.push(...batchIds);
      checkpoint.totalUpdated += updated;
      checkpoint.lastBatch = batchNum;
      saveCheckpoint(checkpoint);

    } catch (error: any) {
      console.error(`  ✗ ERROR: ${error.message}`);
      console.log('  Saving checkpoint and continuing...');
      saveCheckpoint(checkpoint);
    }

    // Periodic progress log
    if (batchNum % PROGRESS_LOG_INTERVAL === 0) {
      const totalElapsed = ((Date.now() - checkpoint.startTime) / 1000 / 60).toFixed(1);
      const marketsPerMin = (checkpoint.processedMarkets.length / parseFloat(totalElapsed)).toFixed(1);
      const remaining = markets.length - i - batchSize;
      const etaMins = remaining > 0 ? (remaining / batchSize / parseFloat(marketsPerMin) * batchSize).toFixed(0) : 0;

      console.log(`\n--- Progress: ${checkpoint.processedMarkets.length} markets | ${checkpoint.totalUpdated.toLocaleString()} rows | ${totalElapsed} min | ETA: ${etaMins} min ---\n`);
    }
  }

  const totalElapsed = ((Date.now() - checkpoint.startTime) / 1000 / 60).toFixed(1);
  console.log('\n=== COMPLETE ===');
  console.log(`Total markets: ${checkpoint.processedMarkets.length.toLocaleString()}`);
  console.log(`Total rows updated: ${checkpoint.totalUpdated.toLocaleString()}`);
  console.log(`Total time: ${totalElapsed} minutes`);

  // Final verification
  const stats = await getStats();
  console.log(`\nVerification:`);
  console.log(`  Total rows: ${stats.total.toLocaleString()}`);
  console.log(`  With consensus: ${stats.withConsensus.toLocaleString()}`);
  console.log(`  Unanimous YES (3+): ${stats.unanimousYes.toLocaleString()}`);
  console.log(`  Unanimous NO (3+): ${stats.unanimousNo.toLocaleString()}`);

  // Cleanup checkpoint on success
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
    console.log('\nCheckpoint file cleaned up.');
  }

  await clickhouse.close();
}

main().catch(console.error);
