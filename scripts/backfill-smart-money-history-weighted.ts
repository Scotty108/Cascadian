/**
 * Backfill Smart Money History - Weighted Version
 *
 * This script calculates a proper time-weighted smart money signal that:
 * 1. Tracks cumulative positions over time (not just current snapshot)
 * 2. Weights by wallet tier (superforecaster=3x, smart=2x, profitable=1x)
 * 3. Generates a dynamic signal that moves as positions change
 *
 * The signal ranges from 0-100% where:
 * - 100% = all weighted smart money on YES
 * - 50% = balanced
 * - 0% = all weighted smart money on NO
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// CLICKHOUSE_HOST contains the full URL (https://hostname:port)
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000, // 2 minute timeout for complex queries
  clickhouse_settings: {
    max_execution_time: 120,
  },
});

// Tier weights for smart money signal
const TIER_WEIGHTS: Record<string, number> = {
  superforecaster: 3.0,
  smart: 2.0,
  profitable: 1.0,
};

interface Position {
  wallet_id: string;
  tier: string;
  side: string;
  outcome_index: number;
  ts_open: Date;
  ts_close: Date | null;
  cost_usd: number;
  qty_shares_remaining: number;
}

interface HourlySnapshot {
  market_id: string;
  ts: string;
  crowd_odds: number;
  smart_money_odds: number;
  dumb_money_odds: number;
  smart_vs_crowd_delta: number;
  smart_wallet_count: number;
  smart_holdings_usd: number;
  total_open_interest_usd: number;
}

async function getMarketsWithSmartMoney(): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT p.condition_id as market_id
      FROM wio_positions_v2 p
      JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE wc.tier IN ('superforecaster', 'smart', 'profitable')
        AND p.is_resolved = 0
      ORDER BY market_id
    `,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as { market_id: string }[];
  return rows.map(r => r.market_id);
}

async function getSmartMoneyPositions(marketId: string): Promise<Position[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        p.wallet_id,
        wc.tier,
        p.side,
        p.outcome_index,
        p.ts_open,
        p.ts_close,
        p.cost_usd,
        p.qty_shares_remaining
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
  // Get token_id for YES outcome (outcome_index=0) via token map
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

  // Get hourly prices from price snapshots
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

function calculateWeightedSignal(
  positions: Position[],
  timestamp: Date
): { yesWeighted: number; noWeighted: number; yesRaw: number; noRaw: number; walletCount: number } {
  let yesWeighted = 0;
  let noWeighted = 0;
  let yesRaw = 0;
  let noRaw = 0;
  const activeWallets = new Set<string>();

  for (const pos of positions) {
    const openTime = new Date(pos.ts_open);
    const closeTime = pos.ts_close ? new Date(pos.ts_close) : null;

    // Position must be open at this timestamp
    if (openTime > timestamp) continue;
    if (closeTime && closeTime <= timestamp) continue;

    const weight = TIER_WEIGHTS[pos.tier] || 1.0;
    const weighted = pos.cost_usd * weight;

    // Normalize position to outcome_index=0 perspective (the price we track)
    // - outcome_index=0 + YES = bullish on primary outcome (YES)
    // - outcome_index=0 + NO = bearish on primary outcome (NO)
    // - outcome_index=1 + YES = bullish on opposite = bearish on primary (NO)
    // - outcome_index=1 + NO = bearish on opposite = bullish on primary (YES)
    const isYesForPrimary =
      (pos.outcome_index === 0 && pos.side === 'YES') ||
      (pos.outcome_index === 1 && pos.side === 'NO');

    if (isYesForPrimary) {
      yesWeighted += weighted;
      yesRaw += pos.cost_usd;
    } else {
      noWeighted += weighted;
      noRaw += pos.cost_usd;
    }
    activeWallets.add(pos.wallet_id);
  }

  return { yesWeighted, noWeighted, yesRaw, noRaw, walletCount: activeWallets.size };
}

async function processMarket(marketId: string): Promise<HourlySnapshot[]> {
  const positions = await getSmartMoneyPositions(marketId);
  if (positions.length === 0) return [];

  const priceMap = await getHistoricalPrices(marketId);
  if (priceMap.size === 0) return [];

  // Find the date range
  const firstOpen = new Date(Math.min(...positions.map(p => new Date(p.ts_open).getTime())));
  const now = new Date();

  const snapshots: HourlySnapshot[] = [];
  const hours = Array.from(priceMap.keys()).sort();

  for (const hourStr of hours) {
    const timestamp = new Date(hourStr);
    if (timestamp < firstOpen) continue;
    if (timestamp > now) continue;

    const crowdOdds = priceMap.get(hourStr) || 0.5;
    const { yesWeighted, noWeighted, yesRaw, noRaw, walletCount } = calculateWeightedSignal(positions, timestamp);

    const totalWeighted = yesWeighted + noWeighted;
    const totalRaw = yesRaw + noRaw;

    // Smart money odds (0-1 scale)
    // If no positions, default to 0.5 (neutral)
    const smartMoneyOdds = totalWeighted > 0 ? yesWeighted / totalWeighted : 0.5;

    // Dumb money odds (inverse of smart money weighted by their holdings)
    // This is a simplification - ideally we'd track non-smart wallets too
    const dumbMoneyOdds = crowdOdds; // Use crowd as proxy

    const delta = smartMoneyOdds - crowdOdds;

    snapshots.push({
      market_id: marketId,
      ts: hourStr,
      crowd_odds: crowdOdds,
      smart_money_odds: smartMoneyOdds,
      dumb_money_odds: dumbMoneyOdds,
      smart_vs_crowd_delta: delta,
      smart_wallet_count: walletCount,
      smart_holdings_usd: totalRaw,
      total_open_interest_usd: totalRaw, // Approximation
    });
  }

  return snapshots;
}

async function insertSnapshots(snapshots: HourlySnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;

  const values = snapshots.map(s =>
    `('${s.market_id}', '${s.ts}', ${s.crowd_odds}, ${s.smart_money_odds}, ${s.dumb_money_odds}, ${s.smart_vs_crowd_delta}, ${s.smart_wallet_count}, ${s.smart_holdings_usd}, ${s.total_open_interest_usd})`
  ).join(',');

  await clickhouse.command({
    query: `
      INSERT INTO wio_smart_money_history
      (market_id, ts, crowd_odds, smart_money_odds, dumb_money_odds, smart_vs_crowd_delta, smart_wallet_count, smart_holdings_usd, total_open_interest_usd)
      VALUES ${values}
    `,
  });
}

async function main() {
  console.log('Starting weighted smart money history backfill...');

  // First, clear existing data for fresh calculation
  console.log('Truncating existing smart money history...');
  await clickhouse.command({
    query: 'TRUNCATE TABLE wio_smart_money_history',
  });

  const markets = await getMarketsWithSmartMoney();
  console.log(`Found ${markets.length} markets with smart money positions`);

  let totalSnapshots = 0;
  const batchSize = 100;
  const concurrency = 10; // Process 10 markets in parallel

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(markets.length / batchSize)} (${batch.length} markets)...`);

    const allSnapshots: HourlySnapshot[] = [];

    // Process markets in parallel with concurrency limit
    for (let j = 0; j < batch.length; j += concurrency) {
      const chunk = batch.slice(j, j + concurrency);
      const results = await Promise.all(
        chunk.map(async (marketId) => {
          try {
            return await processMarket(marketId);
          } catch (error) {
            console.error(`Error processing market ${marketId}:`, error);
            return [];
          }
        })
      );
      for (const snapshots of results) {
        allSnapshots.push(...snapshots);
      }
    }

    if (allSnapshots.length > 0) {
      // Insert in chunks of 10000
      for (let j = 0; j < allSnapshots.length; j += 10000) {
        const chunk = allSnapshots.slice(j, j + 10000);
        await insertSnapshots(chunk);
      }
      totalSnapshots += allSnapshots.length;
      console.log(`  Inserted ${allSnapshots.length} snapshots (total: ${totalSnapshots})`);
    }
  }

  console.log(`\nBackfill complete! Total snapshots: ${totalSnapshots}`);

  // Verify the results
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        round(smart_money_odds, 1) as odds_bucket,
        count() as cnt
      FROM wio_smart_money_history
      GROUP BY odds_bucket
      ORDER BY odds_bucket
    `,
    format: 'JSONEachRow',
  });
  const verifyRows = await verifyResult.json() as { odds_bucket: number; cnt: number }[];
  console.log('\nSmart money odds distribution:');
  for (const row of verifyRows) {
    console.log(`  ${(row.odds_bucket * 100).toFixed(0)}%: ${row.cnt} snapshots`);
  }

  await clickhouse.close();
}

main().catch(console.error);
