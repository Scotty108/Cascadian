/**
 * Parallel Comprehensive Smart Money Metrics Backfill
 *
 * Faster version that processes multiple markets concurrently.
 * Focuses on active markets with meaningful smart money presence.
 *
 * Usage:
 *   npx tsx scripts/backfill-smart-money-comprehensive-parallel.ts [--active-only] [--min-usd=1000] [--concurrency=20]
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
  clickhouse_settings: {
    max_execution_time: 300,
  },
});

const TIER_WEIGHTS: Record<string, number> = {
  superforecaster: 3.0,
  smart: 2.0,
  profitable: 1.0,
};

interface Position {
  wallet_id: string;
  tier: string;
  outcome_index: number;
  side: string;
  ts_open: Date;
  ts_close: Date | null;
  cost_usd: number;
  qty_shares_remaining: number;
  p_entry_side: number;
}

interface HourlyMetrics {
  market_id: string;
  ts: string;
  crowd_price: number;
  smart_money_odds: number;
  yes_usd: number;
  no_usd: number;
  total_usd: number;
  wallet_count: number;
  wallet_count_yes: number;
  wallet_count_no: number;
  avg_entry_price: number;
  entry_edge_pct: number;
  pct_wallets_underwater: number;
  total_unrealized_pnl: number;
  flow_1h: number;
  flow_24h: number;
  flow_7d: number;
  new_wallets_1h: number;
  new_wallets_24h: number;
  new_wallets_7d: number;
  exits_1h: number;
  exits_24h: number;
  exits_7d: number;
  avg_position_size: number;
  max_position_size: number;
  top5_concentration: number;
  avg_hold_hours: number;
  superforecaster_yes_usd: number;
  superforecaster_no_usd: number;
  smart_yes_usd: number;
  smart_no_usd: number;
  profitable_yes_usd: number;
  profitable_no_usd: number;
  superforecaster_count: number;
  smart_count: number;
  profitable_count: number;
}

async function getSmartMoneyPositions(marketId: string): Promise<Position[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        p.wallet_id,
        wc.tier,
        p.outcome_index,
        p.side,
        p.ts_open,
        p.ts_close,
        p.cost_usd,
        p.qty_shares_remaining,
        p.p_entry_side
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE p.condition_id = '${marketId}'
        AND wc.tier IN ('superforecaster', 'smart', 'profitable')
      ORDER BY p.ts_open
    `,
    format: 'JSONEachRow',
  });
  return result.json() as Promise<Position[]>;
}

async function getHistoricalPrices(marketId: string): Promise<Map<string, number>> {
  const tokenResult = await clickhouse.query({
    query: `
      SELECT token_id_dec
      FROM pm_token_to_condition_map_current
      WHERE condition_id = '${marketId}' AND outcome_index = 0
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const tokenRows = await tokenResult.json() as { token_id_dec: string }[];
  if (tokenRows.length === 0) return new Map();

  const tokenId = tokenRows[0].token_id_dec;

  const priceResult = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(toStartOfHour(bucket), '%Y-%m-%dT%H:00:00') as hour,
        avg(last_price) as price
      FROM pm_price_snapshots_15m
      WHERE token_id = '${tokenId}'
      GROUP BY hour
      ORDER BY hour
    `,
    format: 'JSONEachRow',
  });

  const priceMap = new Map<string, number>();
  const rows = await priceResult.json() as { hour: string; price: number }[];
  for (const row of rows) {
    priceMap.set(row.hour, row.price);
  }
  return priceMap;
}

function isYesForPrimary(pos: Position): boolean {
  return (pos.outcome_index === 0 && pos.side === 'YES') ||
         (pos.outcome_index === 1 && pos.side === 'NO');
}

function calculateMetricsAtTimestamp(
  positions: Position[],
  timestamp: Date,
  crowdPrice: number
): Omit<HourlyMetrics, 'market_id' | 'ts'> {
  const activePositions = positions.filter(pos => {
    const openTime = new Date(pos.ts_open);
    const closeTime = pos.ts_close ? new Date(pos.ts_close) : null;
    return openTime <= timestamp && (!closeTime || closeTime > timestamp);
  });

  let yesUsd = 0, noUsd = 0;
  let yesWeighted = 0, noWeighted = 0;
  const yesWallets = new Set<string>();
  const noWallets = new Set<string>();
  const allWallets = new Set<string>();

  let totalEntryValue = 0;
  let totalShares = 0;
  let underwaterCount = 0;
  let totalUnrealizedPnl = 0;

  let superforecasterYes = 0, superforecasterNo = 0;
  let smartYes = 0, smartNo = 0;
  let profitableYes = 0, profitableNo = 0;

  const superforecasterWallets = new Set<string>();
  const smartWallets = new Set<string>();
  const profitableWallets = new Set<string>();

  const positionSizes: number[] = [];
  let totalHoldHours = 0;

  for (const pos of activePositions) {
    const weight = TIER_WEIGHTS[pos.tier] || 1.0;
    const weighted = pos.cost_usd * weight;
    const isYes = isYesForPrimary(pos);

    if (isYes) {
      yesUsd += pos.cost_usd;
      yesWeighted += weighted;
      yesWallets.add(pos.wallet_id);
    } else {
      noUsd += pos.cost_usd;
      noWeighted += weighted;
      noWallets.add(pos.wallet_id);
    }
    allWallets.add(pos.wallet_id);

    if (pos.p_entry_side > 0 && pos.qty_shares_remaining > 0) {
      totalEntryValue += pos.p_entry_side * pos.qty_shares_remaining;
      totalShares += pos.qty_shares_remaining;

      const currentValue = isYes ? crowdPrice : (1 - crowdPrice);
      const pnl = (currentValue - pos.p_entry_side) * pos.qty_shares_remaining;
      totalUnrealizedPnl += pnl;

      if (pnl < 0) underwaterCount++;
    }

    if (pos.tier === 'superforecaster') {
      if (isYes) superforecasterYes += pos.cost_usd;
      else superforecasterNo += pos.cost_usd;
      superforecasterWallets.add(pos.wallet_id);
    } else if (pos.tier === 'smart') {
      if (isYes) smartYes += pos.cost_usd;
      else smartNo += pos.cost_usd;
      smartWallets.add(pos.wallet_id);
    } else if (pos.tier === 'profitable') {
      if (isYes) profitableYes += pos.cost_usd;
      else profitableNo += pos.cost_usd;
      profitableWallets.add(pos.wallet_id);
    }

    positionSizes.push(pos.cost_usd);

    const openTime = new Date(pos.ts_open);
    const holdMs = timestamp.getTime() - openTime.getTime();
    totalHoldHours += holdMs / (1000 * 60 * 60);
  }

  // Flow metrics
  const oneHourAgo = new Date(timestamp.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(timestamp.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(timestamp.getTime() - 7 * 24 * 60 * 60 * 1000);

  let flow1h = 0, flow24h = 0, flow7d = 0;
  const walletsOpened1h = new Set<string>();
  const walletsOpened24h = new Set<string>();
  const walletsOpened7d = new Set<string>();
  let exits1h = 0, exits24h = 0, exits7d = 0;

  for (const pos of positions) {
    const openTime = new Date(pos.ts_open);
    const closeTime = pos.ts_close ? new Date(pos.ts_close) : null;
    const isYes = isYesForPrimary(pos);
    const flowSign = isYes ? 1 : -1;

    if (openTime > oneHourAgo && openTime <= timestamp) {
      flow1h += pos.cost_usd * flowSign;
      walletsOpened1h.add(pos.wallet_id);
    }
    if (openTime > oneDayAgo && openTime <= timestamp) {
      flow24h += pos.cost_usd * flowSign;
      walletsOpened24h.add(pos.wallet_id);
    }
    if (openTime > sevenDaysAgo && openTime <= timestamp) {
      flow7d += pos.cost_usd * flowSign;
      walletsOpened7d.add(pos.wallet_id);
    }

    if (closeTime && closeTime > oneHourAgo && closeTime <= timestamp) exits1h++;
    if (closeTime && closeTime > oneDayAgo && closeTime <= timestamp) exits24h++;
    if (closeTime && closeTime > sevenDaysAgo && closeTime <= timestamp) exits7d++;
  }

  positionSizes.sort((a, b) => b - a);
  const top5Sum = positionSizes.slice(0, 5).reduce((a, b) => a + b, 0);
  const totalSum = yesUsd + noUsd;

  const totalWeighted = yesWeighted + noWeighted;
  const smartMoneyOdds = totalWeighted > 0 ? yesWeighted / totalWeighted : 0.5;
  const avgEntryPrice = totalShares > 0 ? totalEntryValue / totalShares : 0.5;
  const entryEdgePct = crowdPrice > 0 ? (crowdPrice - avgEntryPrice) / crowdPrice * 100 : 0;
  const pctUnderwaterWallets = activePositions.length > 0 ? (underwaterCount / activePositions.length) * 100 : 0;
  const avgPositionSize = allWallets.size > 0 ? totalSum / allWallets.size : 0;
  const maxPositionSize = positionSizes.length > 0 ? positionSizes[0] : 0;
  const top5Concentration = totalSum > 0 ? (top5Sum / totalSum) * 100 : 0;
  const avgHoldHours = activePositions.length > 0 ? totalHoldHours / activePositions.length : 0;

  return {
    crowd_price: crowdPrice,
    smart_money_odds: smartMoneyOdds,
    yes_usd: yesUsd,
    no_usd: noUsd,
    total_usd: totalSum,
    wallet_count: allWallets.size,
    wallet_count_yes: yesWallets.size,
    wallet_count_no: noWallets.size,
    avg_entry_price: avgEntryPrice,
    entry_edge_pct: entryEdgePct,
    pct_wallets_underwater: pctUnderwaterWallets,
    total_unrealized_pnl: totalUnrealizedPnl,
    flow_1h: flow1h,
    flow_24h: flow24h,
    flow_7d: flow7d,
    new_wallets_1h: walletsOpened1h.size,
    new_wallets_24h: walletsOpened24h.size,
    new_wallets_7d: walletsOpened7d.size,
    exits_1h: exits1h,
    exits_24h: exits24h,
    exits_7d: exits7d,
    avg_position_size: avgPositionSize,
    max_position_size: maxPositionSize,
    top5_concentration: top5Concentration,
    avg_hold_hours: avgHoldHours,
    superforecaster_yes_usd: superforecasterYes,
    superforecaster_no_usd: superforecasterNo,
    smart_yes_usd: smartYes,
    smart_no_usd: smartNo,
    profitable_yes_usd: profitableYes,
    profitable_no_usd: profitableNo,
    superforecaster_count: superforecasterWallets.size,
    smart_count: smartWallets.size,
    profitable_count: profitableWallets.size,
  };
}

async function processMarketWithTimeout(marketId: string, timeoutMs: number = 30000): Promise<HourlyMetrics[]> {
  return Promise.race([
    processMarket(marketId),
    new Promise<HourlyMetrics[]>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ]);
}

async function processMarket(marketId: string): Promise<HourlyMetrics[]> {
  const positions = await getSmartMoneyPositions(marketId);
  if (positions.length === 0) return [];

  const priceMap = await getHistoricalPrices(marketId);
  if (priceMap.size === 0) return [];

  const firstOpen = new Date(Math.min(...positions.map(p => new Date(p.ts_open).getTime())));
  const now = new Date();

  const metrics: HourlyMetrics[] = [];
  const hours = Array.from(priceMap.keys()).sort();

  for (const hourStr of hours) {
    const timestamp = new Date(hourStr);
    if (timestamp < firstOpen) continue;
    if (timestamp > now) continue;

    const crowdPrice = priceMap.get(hourStr) || 0.5;
    const hourMetrics = calculateMetricsAtTimestamp(positions, timestamp, crowdPrice);

    metrics.push({
      market_id: marketId,
      ts: hourStr,
      ...hourMetrics,
    });
  }

  return metrics;
}

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

async function insertMetricsBatch(allMetrics: HourlyMetrics[]): Promise<void> {
  if (allMetrics.length === 0) return;

  const batchSize = 5000;
  for (let i = 0; i < allMetrics.length; i += batchSize) {
    const batch = allMetrics.slice(i, i + batchSize);

    const values = batch.map(m => `(
      '${m.market_id}',
      '${m.ts}',
      ${m.crowd_price},
      ${m.smart_money_odds},
      ${m.yes_usd},
      ${m.no_usd},
      ${m.total_usd},
      ${m.wallet_count},
      ${m.wallet_count_yes},
      ${m.wallet_count_no},
      ${m.avg_entry_price},
      ${m.entry_edge_pct},
      ${m.pct_wallets_underwater},
      ${m.total_unrealized_pnl},
      ${m.flow_1h},
      ${m.flow_24h},
      ${m.flow_7d},
      ${m.new_wallets_1h},
      ${m.new_wallets_24h},
      ${m.new_wallets_7d},
      ${m.exits_1h},
      ${m.exits_24h},
      ${m.exits_7d},
      ${m.avg_position_size},
      ${m.max_position_size},
      ${m.top5_concentration},
      ${m.avg_hold_hours},
      ${m.superforecaster_yes_usd},
      ${m.superforecaster_no_usd},
      ${m.smart_yes_usd},
      ${m.smart_no_usd},
      ${m.profitable_yes_usd},
      ${m.profitable_no_usd},
      ${m.superforecaster_count},
      ${m.smart_count},
      ${m.profitable_count}
    )`).join(',');

    await clickhouse.command({
      query: `INSERT INTO wio_smart_money_metrics_v1 VALUES ${values}`,
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const activeOnly = args.includes('--active-only');
  const resolvedOnly = args.includes('--resolved-only');
  const skipExisting = args.includes('--skip-existing');
  const minUsdArg = args.find(a => a.startsWith('--min-usd='));
  const minUsd = minUsdArg ? parseInt(minUsdArg.split('=')[1]) : 100;
  const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : 10;

  console.log('=== Parallel Comprehensive Smart Money Metrics Backfill ===\n');
  console.log(`Settings: activeOnly=${activeOnly}, resolvedOnly=${resolvedOnly}, minUsd=$${minUsd}, concurrency=${concurrency}\n`);

  await createTableIfNeeded();
  console.log('Table wio_smart_money_metrics_v1 ready\n');

  // Get markets with meaningful smart money presence, sorted by most recent activity
  let whereClause = 'wc.tier IN (\'superforecaster\', \'smart\', \'profitable\')';
  if (activeOnly) {
    whereClause += ' AND p.is_resolved = 0';
  } else if (resolvedOnly) {
    whereClause += ' AND p.is_resolved = 1';
  }

  console.log('Querying markets by recent activity...');
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        p.condition_id as market_id,
        sum(p.cost_usd) as total_cost,
        max(p.ts_open) as latest_activity
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE ${whereClause}
      GROUP BY market_id
      HAVING total_cost >= ${minUsd}
      ORDER BY latest_activity DESC
    `,
    format: 'JSONEachRow',
  });

  let markets = (await marketsResult.json() as { market_id: string; total_cost: number; latest_activity: string }[]);
  console.log(`Found ${markets.length} markets with >=$${minUsd} smart money presence (most recent first)\n`);

  // Filter out already processed markets if --skip-existing
  if (skipExisting && markets.length > 0) {
    console.log('Checking for existing markets to skip...');
    const existingResult = await clickhouse.query({
      query: `SELECT DISTINCT market_id FROM wio_smart_money_metrics_v1`,
      format: 'JSONEachRow',
    });
    const existingMarkets = new Set((await existingResult.json() as { market_id: string }[]).map(r => r.market_id));
    const beforeCount = markets.length;
    markets = markets.filter(m => !existingMarkets.has(m.market_id));
    console.log(`Skipping ${beforeCount - markets.length} already processed markets, ${markets.length} remaining\n`);
  }

  if (markets.length > 0) {
    console.log(`First market (most recent): ${markets[0].market_id.slice(0, 16)}... activity: ${markets[0].latest_activity}`);
    console.log(`Last market (oldest): ${markets[markets.length - 1].market_id.slice(0, 16)}... activity: ${markets[markets.length - 1].latest_activity}\n`);
  }

  if (markets.length === 0) {
    console.log('No markets to process. Try lowering --min-usd threshold.');
    await clickhouse.close();
    return;
  }

  let totalMetrics = 0;
  let processedMarkets = 0;
  let errorCount = 0;
  const startTime = Date.now();

  // Process in batches with concurrency
  const batchSize = concurrency * 2; // Smaller batches for more frequent updates

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const batchMetrics: HourlyMetrics[] = [];

    // Process batch with limited concurrency
    for (let j = 0; j < batch.length; j += concurrency) {
      const chunk = batch.slice(j, j + concurrency);

      // Log which markets we're processing
      if (j === 0) {
        console.log(`\n[Batch ${Math.floor(i / batchSize) + 1}] Processing ${chunk[0].market_id.slice(0, 16)}...`);
      }

      const results = await Promise.all(
        chunk.map(async ({ market_id }) => {
          try {
            return await processMarketWithTimeout(market_id, 180000); // 3 min timeout per market
          } catch (error: any) {
            if (error.message === 'timeout') {
              console.log(`  [SKIP] ${market_id.slice(0, 12)}... timed out`);
            }
            errorCount++;
            return [];
          }
        })
      );

      for (const metrics of results) {
        if (metrics.length > 0) {
          batchMetrics.push(...metrics);
          processedMarkets++;
        }
      }
    }

    // Insert batch
    if (batchMetrics.length > 0) {
      await insertMetricsBatch(batchMetrics);
      totalMetrics += batchMetrics.length;
    }

    // Progress update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? processedMarkets / elapsed : 0;
    const remaining = markets.length - (i + batch.length);
    const eta = rate > 0 ? remaining / rate : 0;

    console.log(
      `[${i + batch.length}/${markets.length}] ${processedMarkets} markets, ` +
      `${totalMetrics.toLocaleString()} snapshots | ${rate.toFixed(1)}/s | ETA: ${Math.round(eta)}s`
    );
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n=== Complete! ===`);
  console.log(`Markets processed: ${processedMarkets}`);
  console.log(`Total snapshots: ${totalMetrics.toLocaleString()}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Time: ${totalTime.toFixed(1)}s (${(processedMarkets / totalTime).toFixed(1)} markets/s)`);

  // Verify
  const verifyResult = await clickhouse.query({
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
  const verify = (await verifyResult.json() as any[])[0];
  console.log(`\nTable stats:`);
  console.log(`  Total snapshots: ${verify.total_snapshots}`);
  console.log(`  Unique markets: ${verify.unique_markets}`);
  console.log(`  Date range: ${verify.earliest} to ${verify.latest}`);

  await clickhouse.close();
}

main().catch(console.error);
