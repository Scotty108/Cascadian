/**
 * Backfill Smart Money History for a single market
 * Usage: npx tsx scripts/backfill-single-market-smart-money.ts <market_id>
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
  clickhouse_settings: {
    max_execution_time: 120,
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
  if (positions.length === 0) {
    console.log('No smart money positions found for this market');
    return [];
  }
  console.log(`Found ${positions.length} smart money positions`);

  const priceMap = await getHistoricalPrices(marketId);
  if (priceMap.size === 0) {
    console.log('No price history found for this market');
    return [];
  }
  console.log(`Found ${priceMap.size} hourly price points`);

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
    const smartMoneyOdds = totalWeighted > 0 ? yesWeighted / totalWeighted : 0.5;
    const dumbMoneyOdds = crowdOdds;
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
      total_open_interest_usd: totalRaw,
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
  const marketId = process.argv[2];
  if (!marketId) {
    console.error('Usage: npx tsx scripts/backfill-single-market-smart-money.ts <market_id>');
    process.exit(1);
  }

  console.log(`Backfilling smart money history for market: ${marketId}`);

  // Delete existing data for this market first
  await clickhouse.command({
    query: `ALTER TABLE wio_smart_money_history DELETE WHERE market_id = '${marketId}'`,
  });
  console.log('Cleared existing data for this market');

  const snapshots = await processMarket(marketId);
  if (snapshots.length > 0) {
    await insertSnapshots(snapshots);
    console.log(`Inserted ${snapshots.length} snapshots`);
  }

  await clickhouse.close();
}

main().catch(console.error);
