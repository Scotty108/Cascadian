/**
 * Comprehensive Overnight Backfill - ALL Resolved Markets
 *
 * Processes the full 261K resolved market history for maximum backtesting data.
 * Includes market metadata (category, tags, series) for category-level signal analysis.
 *
 * Goal: Build complete dataset to find patterns above 65% accuracy across categories.
 *
 * Usage:
 *   npx tsx scripts/overnight-backfill-all-markets.ts [--resume] [--check-progress]
 *
 * Expected runtime: 4-8 hours for full backfill
 * Expected output: 10M+ snapshots across 100K+ markets
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 900000, // 15 min for big queries
  clickhouse_settings: {
    max_execution_time: 900,
    max_memory_usage: 30000000000, // 30GB
  },
});

const PROGRESS_FILE = '/tmp/overnight-backfill-progress.json';

interface Progress {
  startedAt: string;
  lastBatchEndAt: string;
  marketsProcessed: number;
  snapshotsInserted: number;
  currentBatch: number;
  totalBatches: number;
  marketIdsProcessed: string[];
}

function loadProgress(): Progress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.log('Could not load progress file, starting fresh');
  }
  return null;
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function createEnhancedTableIfNeeded(): Promise<void> {
  // Create enhanced metrics table with market metadata
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS wio_smart_money_metrics_v2 (
        -- Market identification
        market_id String,
        ts DateTime,

        -- Market metadata (for category analysis)
        category String DEFAULT '',
        series_slug String DEFAULT '',
        end_date DateTime DEFAULT '1970-01-01 00:00:00',
        is_resolved UInt8 DEFAULT 0,
        outcome_resolved UInt8 DEFAULT 255,

        -- Crowd metrics
        crowd_price Float64,

        -- Smart money metrics
        smart_money_odds Float64,
        yes_usd Float64,
        no_usd Float64,
        total_usd Float64,

        -- Wallet counts (critical for consensus signals)
        wallet_count UInt32,
        wallet_count_yes UInt32,
        wallet_count_no UInt32,

        -- Entry metrics
        avg_entry_price Float64,
        entry_edge_pct Float64,

        -- Flow metrics
        flow_1h Float64,
        flow_24h Float64,
        flow_7d Float64,
        new_wallets_1h UInt32,
        new_wallets_24h UInt32,
        new_wallets_7d UInt32,
        exits_1h UInt32,
        exits_24h UInt32,
        exits_7d UInt32,

        -- Position metrics
        avg_position_size Float64,
        max_position_size Float64,
        avg_hold_hours Float64,

        -- Tier breakdown (for tier-weighted signals)
        superforecaster_yes_usd Float64,
        superforecaster_no_usd Float64,
        smart_yes_usd Float64,
        smart_no_usd Float64,
        profitable_yes_usd Float64,
        profitable_no_usd Float64,
        superforecaster_count UInt32,
        smart_count UInt32,
        profitable_count UInt32,

        -- Computed signal metrics
        divergence Float64 DEFAULT smart_money_odds - crowd_price,
        sm_direction String DEFAULT if(smart_money_odds > 0.55, 'YES', if(smart_money_odds < 0.45, 'NO', 'NEUTRAL'))
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (market_id, ts)
    `,
  });
  console.log('Table wio_smart_money_metrics_v2 ready');
}

async function getAllResolvedMarketIds(offset: number = 0, limit: number = 10000): Promise<{
  marketIds: string[];
  totalCount: number;
  hasMore: boolean;
}> {
  // First get total count
  const countResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT p.condition_id) as cnt
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE p.is_resolved = 1
        AND wc.tier IN ('superforecaster', 'smart', 'profitable')
    `,
    format: 'JSONEachRow',
  });
  const totalCount = ((await countResult.json()) as { cnt: number }[])[0]?.cnt || 0;

  // Get batch of market IDs using OFFSET/LIMIT
  const result = await clickhouse.query({
    query: `
      SELECT
        p.condition_id as market_id,
        sum(p.cost_usd) as total_cost
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE p.is_resolved = 1
        AND wc.tier IN ('superforecaster', 'smart', 'profitable')
      GROUP BY market_id
      HAVING total_cost >= 500
      ORDER BY total_cost DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as { market_id: string; total_cost: number }[];

  if (rows.length === 0) {
    return { marketIds: [], totalCount, hasMore: false };
  }

  // Check which have price data (batch the check to avoid query size issues)
  const batchSize = 1000;
  const marketsWithPrices = new Set<string>();

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const priceCheckResult = await clickhouse.query({
      query: `
        SELECT DISTINCT tm.condition_id as market_id
        FROM pm_price_snapshots_15m ps
        JOIN pm_token_to_condition_map_current tm ON ps.token_id = tm.token_id_dec AND tm.outcome_index = 0
        WHERE tm.condition_id IN (${batch.map(r => `'${r.market_id}'`).join(',')})
      `,
      format: 'JSONEachRow',
    });

    const priceRows = (await priceCheckResult.json()) as { market_id: string }[];
    priceRows.forEach(r => marketsWithPrices.add(r.market_id));
  }

  const validMarkets = rows.filter(r => marketsWithPrices.has(r.market_id)).map(r => r.market_id);

  return {
    marketIds: validMarkets,
    totalCount,
    hasMore: offset + limit < totalCount,
  };
}

async function runBulkCalculationWithMetadata(marketIds: string[]): Promise<number> {
  if (marketIds.length === 0) return 0;

  const marketIdList = marketIds.map(id => `'${id}'`).join(',');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_overnight_markets`,
  });

  await clickhouse.command({
    query: `
      CREATE TABLE _tmp_overnight_markets (market_id String)
      ENGINE = Memory AS
      SELECT arrayJoin([${marketIdList}]) as market_id
    `,
  });

  // Insert with market metadata
  await clickhouse.command({
    query: `
      INSERT INTO wio_smart_money_metrics_v2 (
        market_id, ts, category, series_slug, end_date, is_resolved, outcome_resolved,
        crowd_price, smart_money_odds, yes_usd, no_usd, total_usd,
        wallet_count, wallet_count_yes, wallet_count_no,
        avg_entry_price, entry_edge_pct,
        flow_1h, flow_24h, flow_7d,
        new_wallets_1h, new_wallets_24h, new_wallets_7d,
        exits_1h, exits_24h, exits_7d,
        avg_position_size, max_position_size, avg_hold_hours,
        superforecaster_yes_usd, superforecaster_no_usd,
        smart_yes_usd, smart_no_usd,
        profitable_yes_usd, profitable_no_usd,
        superforecaster_count, smart_count, profitable_count
      )
      SELECT
        hp.market_id,
        hp.hour as ts,

        -- Market metadata from pm_market_metadata
        coalesce(mm.category, '') as category,
        coalesce(mm.series_slug, '') as series_slug,
        coalesce(toDateTime(mm.end_date), toDateTime('1970-01-01')) as end_date,
        1 as is_resolved,
        toUInt8(coalesce(pos_meta.outcome, 255)) as outcome_resolved,

        hp.crowd_price,

        -- Smart money odds (weighted by tier)
        sumIf(p.cost_usd * p.tier_weight, p.is_yes = 1) /
          nullIf(sum(p.cost_usd * p.tier_weight), 0) as smart_money_odds,

        -- Holdings by side
        sumIf(p.cost_usd, p.is_yes = 1) as yes_usd,
        sumIf(p.cost_usd, p.is_yes = 0) as no_usd,
        sum(p.cost_usd) as total_usd,

        -- Wallet counts
        uniqExact(p.wallet_id) as wallet_count,
        uniqExactIf(p.wallet_id, p.is_yes = 1) as wallet_count_yes,
        uniqExactIf(p.wallet_id, p.is_yes = 0) as wallet_count_no,

        -- Entry price metrics
        sumIf(p.p_entry_side * p.qty_shares_remaining, p.qty_shares_remaining > 0) /
          nullIf(sumIf(p.qty_shares_remaining, p.qty_shares_remaining > 0), 0) as avg_entry_price,

        -- Entry edge
        (hp.crowd_price - (sumIf(p.p_entry_side * p.qty_shares_remaining, p.qty_shares_remaining > 0) /
          nullIf(sumIf(p.qty_shares_remaining, p.qty_shares_remaining > 0), 0))) /
          nullIf(hp.crowd_price, 0) * 100 as entry_edge_pct,

        -- Flow metrics
        sumIf(p.cost_usd * if(p.is_yes = 1, 1, -1), p.ts_open > hp.hour - INTERVAL 1 HOUR AND p.ts_open <= hp.hour) as flow_1h,
        sumIf(p.cost_usd * if(p.is_yes = 1, 1, -1), p.ts_open > hp.hour - INTERVAL 24 HOUR AND p.ts_open <= hp.hour) as flow_24h,
        sumIf(p.cost_usd * if(p.is_yes = 1, 1, -1), p.ts_open > hp.hour - INTERVAL 7 DAY AND p.ts_open <= hp.hour) as flow_7d,

        -- New wallets
        uniqExactIf(p.wallet_id, p.ts_open > hp.hour - INTERVAL 1 HOUR AND p.ts_open <= hp.hour) as new_wallets_1h,
        uniqExactIf(p.wallet_id, p.ts_open > hp.hour - INTERVAL 24 HOUR AND p.ts_open <= hp.hour) as new_wallets_24h,
        uniqExactIf(p.wallet_id, p.ts_open > hp.hour - INTERVAL 7 DAY AND p.ts_open <= hp.hour) as new_wallets_7d,

        -- Exits
        countIf(p.ts_close > hp.hour - INTERVAL 1 HOUR AND p.ts_close <= hp.hour) as exits_1h,
        countIf(p.ts_close > hp.hour - INTERVAL 24 HOUR AND p.ts_close <= hp.hour) as exits_24h,
        countIf(p.ts_close > hp.hour - INTERVAL 7 DAY AND p.ts_close <= hp.hour) as exits_7d,

        -- Position size metrics
        avg(p.cost_usd) as avg_position_size,
        max(p.cost_usd) as max_position_size,
        avg(dateDiff('hour', p.ts_open, hp.hour)) as avg_hold_hours,

        -- Tier breakdown
        sumIf(p.cost_usd, p.is_yes = 1 AND p.tier = 'superforecaster') as superforecaster_yes_usd,
        sumIf(p.cost_usd, p.is_yes = 0 AND p.tier = 'superforecaster') as superforecaster_no_usd,
        sumIf(p.cost_usd, p.is_yes = 1 AND p.tier = 'smart') as smart_yes_usd,
        sumIf(p.cost_usd, p.is_yes = 0 AND p.tier = 'smart') as smart_no_usd,
        sumIf(p.cost_usd, p.is_yes = 1 AND p.tier = 'profitable') as profitable_yes_usd,
        sumIf(p.cost_usd, p.is_yes = 0 AND p.tier = 'profitable') as profitable_no_usd,

        -- Tier wallet counts
        uniqExactIf(p.wallet_id, p.tier = 'superforecaster') as superforecaster_count,
        uniqExactIf(p.wallet_id, p.tier = 'smart') as smart_count,
        uniqExactIf(p.wallet_id, p.tier = 'profitable') as profitable_count

      FROM (
        -- Hourly prices
        SELECT
          tm.condition_id as market_id,
          toStartOfHour(ps.bucket) as hour,
          avg(ps.last_price) as crowd_price
        FROM pm_price_snapshots_15m ps
        JOIN pm_token_to_condition_map_current tm
          ON ps.token_id = tm.token_id_dec AND tm.outcome_index = 0
        WHERE tm.condition_id IN (SELECT market_id FROM _tmp_overnight_markets)
        GROUP BY market_id, hour
      ) hp
      LEFT JOIN (
        -- Smart positions with normalized side
        SELECT
          pos.condition_id as market_id,
          pos.wallet_id,
          wc.tier,
          CASE wc.tier WHEN 'superforecaster' THEN 3.0 WHEN 'smart' THEN 2.0 ELSE 1.0 END as tier_weight,
          pos.ts_open,
          pos.ts_close,
          pos.cost_usd,
          pos.p_entry_side,
          pos.qty_shares_remaining,
          CASE WHEN (pos.outcome_index = 0 AND pos.side = 'YES') OR (pos.outcome_index = 1 AND pos.side = 'NO') THEN 1 ELSE 0 END as is_yes
        FROM wio_positions_v2 pos
        JOIN wio_wallet_classification_v1 wc ON pos.wallet_id = wc.wallet_id AND wc.window_id = 2
        WHERE pos.condition_id IN (SELECT market_id FROM _tmp_overnight_markets)
          AND wc.tier IN ('superforecaster', 'smart', 'profitable')
      ) p ON hp.market_id = p.market_id
        AND p.ts_open <= hp.hour
        AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
      LEFT JOIN pm_market_metadata mm ON hp.market_id = mm.condition_id
      LEFT JOIN (
        -- Get resolved outcome for each market (outcome_side: 0=NO won, 1=YES won)
        SELECT condition_id, any(outcome_side) as outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1 AND outcome_side IS NOT NULL
        GROUP BY condition_id
      ) pos_meta ON hp.market_id = pos_meta.condition_id
      WHERE p.wallet_id IS NOT NULL
      GROUP BY hp.market_id, hp.hour, hp.crowd_price,
               mm.category, mm.series_slug, mm.end_date,
               pos_meta.outcome
      HAVING sum(p.cost_usd) > 0
    `,
  });

  // Get count of inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM wio_smart_money_metrics_v2
      WHERE market_id IN (SELECT market_id FROM _tmp_overnight_markets)
    `,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json() as { cnt: number }[];

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_overnight_markets`,
  });

  return countRows[0]?.cnt || 0;
}

async function checkCurrentProgress(): Promise<void> {
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_snapshots,
        countDistinct(market_id) as unique_markets,
        countDistinct(category) as unique_categories,
        min(ts) as earliest,
        max(ts) as latest,
        countIf(is_resolved = 1 AND outcome_resolved IN (0, 1)) as resolved_with_outcome
      FROM wio_smart_money_metrics_v2
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json() as any[])[0];

  console.log('\n=== CURRENT BACKFILL PROGRESS ===');
  console.log(`Total snapshots: ${Number(stats.total_snapshots).toLocaleString()}`);
  console.log(`Unique markets: ${Number(stats.unique_markets).toLocaleString()}`);
  console.log(`Unique categories: ${Number(stats.unique_categories).toLocaleString()}`);
  console.log(`Markets with resolved outcome: ${Number(stats.resolved_with_outcome).toLocaleString()}`);
  console.log(`Date range: ${stats.earliest} to ${stats.latest}`);

  // Category breakdown
  const catResult = await clickhouse.query({
    query: `
      SELECT
        if(category = '', 'uncategorized', category) as cat,
        countDistinct(market_id) as markets,
        count() as snapshots
      FROM wio_smart_money_metrics_v2
      GROUP BY cat
      ORDER BY markets DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const cats = await catResult.json() as any[];

  console.log('\nTop Categories:');
  for (const cat of cats) {
    console.log(`  ${cat.cat}: ${Number(cat.markets).toLocaleString()} markets, ${Number(cat.snapshots).toLocaleString()} snapshots`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const resumeMode = args.includes('--resume');
  const checkOnly = args.includes('--check-progress');

  console.log('=== Overnight Comprehensive Backfill ===');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  await createEnhancedTableIfNeeded();

  if (checkOnly) {
    await checkCurrentProgress();
    await clickhouse.close();
    return;
  }

  // Load progress if resuming
  let progress: Progress | null = resumeMode ? loadProgress() : null;
  let currentOffset = progress?.marketsProcessed || 0;

  console.log(resumeMode && progress
    ? `Resuming from offset ${currentOffset}, ${progress.marketsProcessed} markets already processed`
    : 'Starting fresh backfill');

  // Get initial batch to know total count
  console.log('\nFetching resolved markets with smart money positions...');
  let { marketIds, totalCount, hasMore } = await getAllResolvedMarketIds(currentOffset, 5000);
  console.log(`Total markets in database: ${totalCount}`);
  console.log(`Starting from offset ${currentOffset}, first batch has ${marketIds.length} markets with price data\n`);

  if (marketIds.length === 0 && !hasMore) {
    console.log('No more markets to process!');
    await checkCurrentProgress();
    await clickhouse.close();
    return;
  }

  let snapshotsInserted = progress?.snapshotsInserted || 0;
  let marketsProcessed = currentOffset;
  let globalBatchNum = progress?.currentBatch || 0;

  // Process in outer chunks (5000 markets fetched at a time)
  while (marketIds.length > 0) {
    // Process these markets in smaller batches (300 at a time)
    const BATCH_SIZE = 300;

    for (let i = 0; i < marketIds.length; i += BATCH_SIZE) {
      globalBatchNum++;
      const batch = marketIds.slice(i, i + BATCH_SIZE);

      console.log(`[${new Date().toISOString()}] Batch ${globalBatchNum} (${batch.length} markets, offset ${marketsProcessed})...`);

      const start = Date.now();
      try {
        const count = await runBulkCalculationWithMetadata(batch);
        const elapsed = (Date.now() - start) / 1000;

        snapshotsInserted += count;
        marketsProcessed += batch.length;

        // Update progress
        progress = {
          startedAt: progress?.startedAt || new Date().toISOString(),
          lastBatchEndAt: new Date().toISOString(),
          marketsProcessed,
          snapshotsInserted,
          currentBatch: globalBatchNum,
          totalBatches: Math.ceil(totalCount / BATCH_SIZE),
          marketIdsProcessed: [], // Don't store all IDs, use offset
        };
        saveProgress(progress);

        const rate = count > 0 ? count / elapsed : 0;
        const remainingMarkets = totalCount - marketsProcessed;
        const avgTimePerMarket = elapsed / batch.length;
        const etaMinutes = (remainingMarkets * avgTimePerMarket) / 60;

        console.log(`  ✓ ${count.toLocaleString()} snapshots in ${elapsed.toFixed(1)}s (${rate.toFixed(0)}/s)`);
        console.log(`  Progress: ${marketsProcessed.toLocaleString()}/${totalCount.toLocaleString()} markets (${(marketsProcessed/totalCount*100).toFixed(1)}%)`);
        console.log(`  Total snapshots: ${snapshotsInserted.toLocaleString()}`);
        console.log(`  ETA: ~${etaMinutes.toFixed(0)} minutes remaining\n`);
      } catch (error) {
        console.error(`  ✗ Batch ${globalBatchNum} failed:`, error);
        console.log('  Saving progress and continuing...\n');

        // Save progress so we can resume
        if (progress) {
          saveProgress(progress);
        }

        // Wait a bit before continuing
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Fetch next chunk of markets
    currentOffset = marketsProcessed;
    const nextBatch = await getAllResolvedMarketIds(currentOffset, 5000);
    marketIds = nextBatch.marketIds;
    hasMore = nextBatch.hasMore;

    if (marketIds.length > 0) {
      console.log(`\nFetched next chunk: ${marketIds.length} markets with price data\n`);
    }
  }

  // Final stats
  console.log('\n=== BACKFILL COMPLETE ===');
  await checkCurrentProgress();

  // Clean up progress file
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('\nProgress file cleaned up');
  }

  await clickhouse.close();
}

main().catch(console.error);
