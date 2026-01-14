/**
 * SQL-First Smart Money Metrics Backfill
 *
 * Does ALL calculation in ClickHouse with a single query per batch.
 * 100x faster than the per-market approach.
 *
 * Usage:
 *   npx tsx scripts/backfill-smart-money-sql.ts [--resolved] [--active] [--sample=2000]
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 min for big queries
  clickhouse_settings: {
    max_execution_time: 600,
    max_memory_usage: 20000000000, // 20GB
  },
});

async function createTableIfNeeded(): Promise<void> {
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS wio_smart_money_metrics_v1 (
        market_id String,
        ts DateTime,
        crowd_price Float64,
        smart_money_odds Float64,
        yes_usd Float64,
        no_usd Float64,
        total_usd Float64,
        wallet_count UInt32,
        wallet_count_yes UInt32,
        wallet_count_no UInt32,
        avg_entry_price Float64,
        entry_edge_pct Float64,
        pct_wallets_underwater Float64,
        total_unrealized_pnl Float64,
        flow_1h Float64,
        flow_24h Float64,
        flow_7d Float64,
        new_wallets_1h UInt32,
        new_wallets_24h UInt32,
        new_wallets_7d UInt32,
        exits_1h UInt32,
        exits_24h UInt32,
        exits_7d UInt32,
        avg_position_size Float64,
        max_position_size Float64,
        top5_concentration Float64,
        avg_hold_hours Float64,
        superforecaster_yes_usd Float64,
        superforecaster_no_usd Float64,
        smart_yes_usd Float64,
        smart_no_usd Float64,
        profitable_yes_usd Float64,
        profitable_no_usd Float64,
        superforecaster_count UInt32,
        smart_count UInt32,
        profitable_count UInt32
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (market_id, ts)
    `,
  });
}

async function getMarketIds(resolved: boolean, sample: number): Promise<string[]> {
  const whereClause = resolved ? 'p.is_resolved = 1' : 'p.is_resolved = 0';
  const limitClause = sample > 0 ? `ORDER BY rand() LIMIT ${sample}` : 'ORDER BY total_cost DESC';

  const result = await clickhouse.query({
    query: `
      SELECT p.condition_id as market_id, sum(p.cost_usd) as total_cost
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE ${whereClause}
        AND wc.tier IN ('superforecaster', 'smart', 'profitable')
      GROUP BY market_id
      HAVING total_cost >= 1000
      ${limitClause}
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as { market_id: string }[];
  return rows.map(r => r.market_id);
}

async function runBulkCalculation(marketIds: string[]): Promise<number> {
  if (marketIds.length === 0) return 0;

  // Create a temp table with the market IDs for efficient joining
  const marketIdList = marketIds.map(id => `'${id}'`).join(',');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_target_markets`,
  });

  await clickhouse.command({
    query: `
      CREATE TABLE _tmp_target_markets (market_id String)
      ENGINE = Memory AS
      SELECT arrayJoin([${marketIdList}]) as market_id
    `,
  });

  // The big SQL calculation - simplified query
  const insertResult = await clickhouse.command({
    query: `
      INSERT INTO wio_smart_money_metrics_v1
      SELECT
        hp.market_id,
        hp.hour as ts,
        hp.crowd_price,

        -- Smart money odds (weighted)
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

        -- Simplified metrics
        0 as pct_wallets_underwater,
        0 as total_unrealized_pnl,

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
        0 as top5_concentration,
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
        WHERE tm.condition_id IN (SELECT market_id FROM _tmp_target_markets)
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
        WHERE pos.condition_id IN (SELECT market_id FROM _tmp_target_markets)
          AND wc.tier IN ('superforecaster', 'smart', 'profitable')
      ) p ON hp.market_id = p.market_id
        AND p.ts_open <= hp.hour
        AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
      WHERE p.wallet_id IS NOT NULL
      GROUP BY hp.market_id, hp.hour, hp.crowd_price
      HAVING sum(p.cost_usd) > 0
    `,
  });

  // Get count of inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM wio_smart_money_metrics_v1
      WHERE market_id IN (SELECT market_id FROM _tmp_target_markets)
    `,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json() as { cnt: number }[];

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS _tmp_target_markets`,
  });

  return countRows[0]?.cnt || 0;
}

async function main() {
  const args = process.argv.slice(2);
  const doResolved = args.includes('--resolved');
  const doActive = args.includes('--active');
  const sampleArg = args.find(a => a.startsWith('--sample='));
  const sample = sampleArg ? parseInt(sampleArg.split('=')[1]) : 0;

  console.log('=== SQL-First Smart Money Metrics Backfill ===\n');

  await createTableIfNeeded();
  console.log('Table ready\n');

  let totalSnapshots = 0;

  if (doResolved || (!doResolved && !doActive)) {
    console.log(`Fetching resolved markets${sample > 0 ? ` (sample of ${sample})` : ''}...`);
    const resolvedMarkets = await getMarketIds(true, sample || 2000);
    console.log(`Found ${resolvedMarkets.length} resolved markets\n`);

    if (resolvedMarkets.length > 0) {
      // Process in batches of 500 to avoid memory issues
      const batchSize = 500;
      for (let i = 0; i < resolvedMarkets.length; i += batchSize) {
        const batch = resolvedMarkets.slice(i, i + batchSize);
        console.log(`Processing resolved batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(resolvedMarkets.length/batchSize)} (${batch.length} markets)...`);

        const start = Date.now();
        const count = await runBulkCalculation(batch);
        const elapsed = (Date.now() - start) / 1000;

        totalSnapshots += count;
        console.log(`  Inserted ${count.toLocaleString()} snapshots in ${elapsed.toFixed(1)}s\n`);
      }
    }
  }

  if (doActive || (!doResolved && !doActive)) {
    console.log('Fetching active markets...');
    const activeMarkets = await getMarketIds(false, 0);
    console.log(`Found ${activeMarkets.length} active markets\n`);

    if (activeMarkets.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < activeMarkets.length; i += batchSize) {
        const batch = activeMarkets.slice(i, i + batchSize);
        console.log(`Processing active batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(activeMarkets.length/batchSize)} (${batch.length} markets)...`);

        const start = Date.now();
        const count = await runBulkCalculation(batch);
        const elapsed = (Date.now() - start) / 1000;

        totalSnapshots += count;
        console.log(`  Inserted ${count.toLocaleString()} snapshots in ${elapsed.toFixed(1)}s\n`);
      }
    }
  }

  // Final stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_snapshots,
        countDistinct(market_id) as unique_markets,
        min(ts) as earliest,
        max(ts) as latest
      FROM wio_smart_money_metrics_v1
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json() as any[])[0];

  console.log('=== COMPLETE ===');
  console.log(`Total snapshots: ${stats.total_snapshots.toLocaleString()}`);
  console.log(`Unique markets: ${stats.unique_markets.toLocaleString()}`);
  console.log(`Date range: ${stats.earliest} to ${stats.latest}`);

  await clickhouse.close();
}

main().catch(console.error);
