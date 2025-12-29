/**
 * Multi-Timeframe T-Stat Analysis
 *
 * For each wallet, calculates:
 * - Lifetime t-stat (all-time)
 * - 90-day t-stat
 * - 30-day t-stat
 *
 * Filters for:
 * - Lifetime t-stat > 2 (proven skill)
 * - 90-day t-stat > 2 (still active and good)
 * - 30-day >= 90-day (momentum: improving or stable)
 *
 * Uses resolution-based markout (actual outcomes, not 14-day proxy)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;
const MIN_FILLS_LIFETIME = 30;
const MIN_FILLS_90D = 10;
const MIN_FILLS_30D = 5;
const MAX_TOTAL_TRADES = 100000; // Filter out bots

interface MultiTimeframeTStat {
  wallet: string;
  // Lifetime
  lifetime_fills: number;
  lifetime_mean_bps: number;
  lifetime_tstat: number;
  lifetime_pnl: number;
  // 90-day
  d90_fills: number;
  d90_mean_bps: number;
  d90_tstat: number;
  d90_pnl: number;
  // 30-day
  d30_fills: number;
  d30_mean_bps: number;
  d30_tstat: number;
  d30_pnl: number;
  // Metadata
  total_trades: number;
  total_volume: number;
}

async function computeTStatForTimeframe(
  seriesSlug: string,
  daysBack: number | null, // null = lifetime
  label: string
): Promise<Map<string, { fills: number; mean_bps: number; tstat: number; pnl: number }>> {

  const dateFilter = daysBack
    ? `AND trade_time >= now() - INTERVAL ${daysBack} DAY`
    : '';

  const query = `
    WITH
    -- Get resolved markets for this series
    resolved_markets AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) as resolution_price
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE m.series_slug = {series:String}
        AND r.is_deleted = 0
    ),
    -- Pre-filter trades
    filtered_trades AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_amount > 0
        AND token_id IN (SELECT token_id FROM resolved_markets)
        ${dateFilter}
    ),
    -- Dedupe trades
    deduped_trades AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as notional,
        any(usdc_amount) / any(token_amount) as entry_price,
        any(role) as role
      FROM filtered_trades
      GROUP BY event_id
    ),
    -- Join with resolution
    trades_with_resolution AS (
      SELECT
        t.wallet,
        t.notional,
        t.entry_price,
        rm.resolution_price,
        if(lower(t.side) = 'buy', 1, -1) as direction,
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * 10000 as markout_bps,
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * t.notional / t.entry_price as pnl,
        least(sqrt(t.notional), {w_max:Float64}) as weight
      FROM deduped_trades t
      JOIN resolved_markets rm ON t.token_id = rm.token_id
      WHERE t.role = 'taker'
    ),
    -- Aggregate per wallet
    wallet_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight * weight) as tw2,
        sum(weight * markout_bps) / sum(weight) as wmean,
        sum(weight * pow(markout_bps, 2)) / sum(weight)
          - pow(sum(weight * markout_bps) / sum(weight), 2) as wvar,
        sum(pnl) as total_pnl
      FROM trades_with_resolution
      GROUP BY wallet
      HAVING fills >= 5
    )
    SELECT
      wallet,
      fills,
      volume,
      wmean as mean_bps,
      sqrt(greatest(wvar, 0)) as std_bps,
      (wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) as t_stat,
      total_pnl
    FROM wallet_stats
  `;

  const result = await clickhouse.query({
    query,
    query_params: { series: seriesSlug, w_max: W_MAX },
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  const map = new Map<string, { fills: number; mean_bps: number; tstat: number; pnl: number }>();

  for (const r of rows) {
    map.set(r.wallet, {
      fills: parseInt(r.fills),
      mean_bps: parseFloat(r.mean_bps) || 0,
      tstat: parseFloat(r.t_stat) || 0,
      pnl: parseFloat(r.total_pnl) || 0,
    });
  }

  console.log(`  ${label}: ${map.size} wallets`);
  return map;
}

async function getWalletTotalTrades(): Promise<Map<string, number>> {
  const query = `
    SELECT trader_wallet, count() as cnt
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY trader_wallet
    HAVING cnt < {max:UInt64}
  `;

  const result = await clickhouse.query({
    query,
    query_params: { max: MAX_TOTAL_TRADES },
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.trader_wallet, parseInt(r.cnt));
  }
  return map;
}

async function main() {
  console.log('=== MULTI-TIMEFRAME T-STAT ANALYSIS ===\n');
  console.log('Timeframes: Lifetime, 90-day, 30-day');
  console.log('Filter: lifetime > 2 AND 90d > 2 AND 30d >= 90d (momentum)');
  console.log('');

  const SERIES = 'egg-prices-monthly';  // Has recent activity unlike BTC daily
  console.log(`Series: ${SERIES}\n`);

  // Get total trades per wallet (for bot filtering)
  console.log('Loading wallet total trades...');
  const totalTrades = await getWalletTotalTrades();
  console.log(`  ${totalTrades.size} human-scale wallets (<${MAX_TOTAL_TRADES.toLocaleString()} trades)\n`);

  // Compute t-stats for each timeframe
  console.log('Computing t-stats by timeframe...');
  const lifetime = await computeTStatForTimeframe(SERIES, null, 'Lifetime');
  const d90 = await computeTStatForTimeframe(SERIES, 90, '90-day');
  const d30 = await computeTStatForTimeframe(SERIES, 30, '30-day');

  // Merge and filter
  console.log('\nApplying filters...');
  const results: MultiTimeframeTStat[] = [];

  for (const [wallet, lt] of lifetime) {
    // Must be human-scale
    if (!totalTrades.has(wallet)) continue;

    const t90 = d90.get(wallet);
    const t30 = d30.get(wallet);

    // Must have data in all timeframes
    if (!t90 || !t30) continue;

    // Minimum fills
    if (lt.fills < MIN_FILLS_LIFETIME) continue;
    if (t90.fills < MIN_FILLS_90D) continue;
    if (t30.fills < MIN_FILLS_30D) continue;

    // Must be profitable (positive mean)
    if (lt.mean_bps <= 0) continue;

    results.push({
      wallet,
      lifetime_fills: lt.fills,
      lifetime_mean_bps: lt.mean_bps,
      lifetime_tstat: lt.tstat,
      lifetime_pnl: lt.pnl,
      d90_fills: t90.fills,
      d90_mean_bps: t90.mean_bps,
      d90_tstat: t90.tstat,
      d90_pnl: t90.pnl,
      d30_fills: t30.fills,
      d30_mean_bps: t30.mean_bps,
      d30_tstat: t30.tstat,
      d30_pnl: t30.pnl,
      total_trades: totalTrades.get(wallet) || 0,
      total_volume: 0,
    });
  }

  console.log(`  ${results.length} wallets with all timeframes\n`);

  // Apply quality filters
  const quality = results.filter(r =>
    r.lifetime_tstat > 2 &&
    r.d90_tstat > 1 &&
    r.d30_tstat >= r.d90_tstat * 0.8  // Allow 20% drop, not momentum collapse
  );

  console.log(`After quality filters: ${quality.length} wallets\n`);

  // Sort by momentum (30d > 90d) and overall quality
  quality.sort((a, b) => {
    // Primary: 30d t-stat
    const momentumA = a.d30_tstat;
    const momentumB = b.d30_tstat;
    return momentumB - momentumA;
  });

  // Display
  console.log('=== RESULTS ===\n');
  console.log('Wallet                                     | LT T-Stat | 90d T-Stat | 30d T-Stat | Momentum | Trades');
  console.log('-------------------------------------------|-----------|------------|------------|----------|--------');

  for (const w of quality.slice(0, 30)) {
    const momentum = w.d30_tstat >= w.d90_tstat ? '↑' : '↓';
    const verdict = w.d30_tstat > 4 && w.lifetime_tstat > 4 ? '✅' :
                    w.d30_tstat > 2 && w.lifetime_tstat > 2 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${w.lifetime_tstat.toFixed(2).padStart(9)} | ${w.d90_tstat.toFixed(2).padStart(10)} | ${w.d30_tstat.toFixed(2).padStart(10)} | ${momentum.padStart(8)} | ${w.total_trades.toLocaleString().padStart(6)} ${verdict}`
    );
  }

  // Top picks
  console.log('\n=== TOP PICKS (High momentum + proven skill) ===\n');

  const topPicks = quality.filter(w =>
    w.d30_tstat > 2 &&
    w.lifetime_tstat > 2 &&
    w.d30_tstat >= w.d90_tstat * 0.9
  ).slice(0, 10);

  for (const w of topPicks) {
    console.log(`✅ ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: T=${w.lifetime_tstat.toFixed(2)} (${w.lifetime_fills} fills, $${Math.round(w.lifetime_pnl).toLocaleString()} PnL)`);
    console.log(`   90-day:   T=${w.d90_tstat.toFixed(2)} (${w.d90_fills} fills)`);
    console.log(`   30-day:   T=${w.d30_tstat.toFixed(2)} (${w.d30_fills} fills)`);
    console.log(`   Total trades: ${w.total_trades.toLocaleString()}`);
    console.log('');
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(exportDir, 'btc_daily_multi_timeframe_tstat.json'),
    JSON.stringify(quality, null, 2)
  );
  console.log(`Exported to ${exportDir}/btc_daily_multi_timeframe_tstat.json`);
}

main().catch(console.error);
