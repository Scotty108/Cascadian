/**
 * Backfill Consensus Counts
 *
 * Computes sf_yes_count, sf_no_count, smart_yes_count, smart_no_count
 * for existing wio_smart_money_metrics_v2 rows.
 *
 * Uses INSERT with same (market_id, ts) key - ReplacingMergeTree will merge
 * and keep the latest version with populated consensus counts.
 *
 * Usage:
 *   npx tsx scripts/backfill-consensus-counts.ts [--sample=1000] [--batch=200]
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    max_execution_time: 600,
    max_memory_usage: 15000000000, // 15GB
  },
});

interface MarketBatch {
  market_id: string;
  snapshot_count: number;
}

async function getMarketsToProcess(sample: number): Promise<MarketBatch[]> {
  const limitClause = sample > 0 ? `LIMIT ${sample}` : '';

  const result = await clickhouse.query({
    query: `
      SELECT
        market_id,
        count() as snapshot_count
      FROM wio_smart_money_metrics_v2
      WHERE sf_yes_count = 0 AND sf_no_count = 0
        AND smart_yes_count = 0 AND smart_no_count = 0
      GROUP BY market_id
      ORDER BY snapshot_count DESC
      ${limitClause}
    `,
    format: 'JSONEachRow',
  });

  return (await result.json()) as MarketBatch[];
}

async function computeConsensusForMarkets(marketIds: string[]): Promise<number> {
  if (marketIds.length === 0) return 0;

  const marketIdList = marketIds.map(id => `'${id}'`).join(',');

  // Step 1: Compute consensus counts per (market_id, ts) into temp table
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_consensus_counts`,
  });

  await clickhouse.command({
    query: `
      CREATE TABLE _tmp_consensus_counts (
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

  // Step 2: Insert updated rows (ReplacingMergeTree will keep latest)
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
      JOIN _tmp_consensus_counts c ON m.market_id = c.market_id AND m.ts = c.ts
      WHERE m.market_id IN (${marketIdList})
    `,
  });

  // Get count before cleanup
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM _tmp_consensus_counts`,
    format: 'JSONEachRow',
  });
  const rows = (await countResult.json()) as { cnt: number }[];
  const insertedCount = rows[0]?.cnt || 0;

  // Cleanup
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_consensus_counts`,
  });

  return insertedCount;
}

async function main() {
  const args = process.argv.slice(2);
  const sampleArg = args.find(a => a.startsWith('--sample='));
  const batchArg = args.find(a => a.startsWith('--batch='));
  const sample = sampleArg ? parseInt(sampleArg.split('=')[1]) : 0;
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1]) : 100;

  console.log('=== Backfill Consensus Counts ===\n');
  console.log(`Sample: ${sample || 'all'}, Batch size: ${batchSize}\n`);

  // Get markets to process
  console.log('Finding markets without consensus counts...');
  const markets = await getMarketsToProcess(sample);
  console.log(`Found ${markets.length} markets to process\n`);

  if (markets.length === 0) {
    console.log('No markets need processing!');
    await clickhouse.close();
    return;
  }

  let totalUpdated = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const batchIds = batch.map(m => m.market_id);
    const batchSnapshots = batch.reduce((sum, m) => sum + m.snapshot_count, 0);

    console.log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(markets.length / batchSize)}`);
    console.log(`  Markets: ${batch.length}, Snapshots: ${batchSnapshots}`);

    const batchStart = Date.now();
    try {
      const updated = await computeConsensusForMarkets(batchIds);
      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.log(`  Updated: ${updated} rows in ${elapsed}s\n`);
      totalUpdated += updated;
    } catch (error: any) {
      console.error(`  ERROR: ${error.message}\n`);
      // Continue with next batch
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('=== COMPLETE ===');
  console.log(`Total updated: ${totalUpdated.toLocaleString()} rows`);
  console.log(`Total time: ${totalElapsed}s`);

  // Verify results
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(sf_yes_count > 0 OR sf_no_count > 0 OR smart_yes_count > 0 OR smart_no_count > 0) as with_consensus,
        countIf(sf_yes_count > 0 AND sf_no_count = 0 AND smart_no_count = 0) as unanimous_yes,
        countIf(sf_no_count > 0 AND sf_yes_count = 0 AND smart_yes_count = 0) as unanimous_no
      FROM wio_smart_money_metrics_v2
    `,
    format: 'JSONEachRow',
  });
  const verify = (await verifyResult.json() as any[])[0];
  console.log(`\nVerification:`);
  console.log(`  Total rows: ${verify.total.toLocaleString()}`);
  console.log(`  With consensus: ${verify.with_consensus.toLocaleString()}`);
  console.log(`  Unanimous YES: ${verify.unanimous_yes.toLocaleString()}`);
  console.log(`  Unanimous NO: ${verify.unanimous_no.toLocaleString()}`);

  await clickhouse.close();
}

main().catch(console.error);
