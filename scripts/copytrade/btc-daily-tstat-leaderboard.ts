/**
 * BTC Daily Strikes T-Stat Leaderboard
 *
 * Uses ACTUAL resolution-based t-stat, not 14-day markout proxy.
 * Filters out bots and ranks by statistical significance of edge.
 *
 * Formula:
 *   markout_bps = direction × (resolution_price - entry_price) × 10000
 *   weight = min(sqrt(notional), 1000)
 *   t_stat = weighted_sharpe × sqrt(N_eff)
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
const MIN_FILLS = 20;          // Minimum resolved fills
const MAX_TOTAL_TRADES = 50000; // Filter out bots
const MIN_VOLUME = 1000;        // $1K minimum volume in series

interface WalletTStat {
  wallet: string;
  fills: number;
  markets: number;
  volume: number;
  total_trades: number;
  mean_bps: number;
  std_bps: number;
  sharpe: number;
  t_stat: number;
  n_eff: number;
  win_rate: number;
  total_pnl: number;
}

async function main() {
  console.log('=== BTC DAILY STRIKES T-STAT LEADERBOARD ===\n');
  console.log('Using RESOLUTION-based t-stat (not 14-day markout proxy)');
  console.log(`Filters: ${MIN_FILLS}+ fills, <${MAX_TOTAL_TRADES.toLocaleString()} total trades (no bots), $${MIN_VOLUME}+ volume`);
  console.log('');

  const query = `
    WITH
    -- Get resolved BTC daily markets with resolution prices
    resolved_markets AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        -- Parse payout_numerators: [1,0] = YES won, [0,1] = NO won
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) as resolution_price
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE m.series_slug = 'bitcoin-multi-strikes-daily'
        AND r.is_deleted = 0
    ),
    -- Pre-filter trades to resolved markets
    filtered_trades AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_amount > 0
        AND token_id IN (SELECT token_id FROM resolved_markets)
    ),
    -- Dedupe trades (GROUP BY event_id pattern)
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
    -- Get total trades per wallet (for bot filtering)
    wallet_totals AS (
      SELECT
        trader_wallet,
        count() as total_trades
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING total_trades < {max_trades:UInt64}
    ),
    -- Join trades with resolution and calculate markout
    trades_with_resolution AS (
      SELECT
        t.wallet,
        t.token_id,
        t.notional,
        t.entry_price,
        rm.resolution_price,
        if(lower(t.side) = 'buy', 1, -1) as direction,
        -- Markout in bps
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * 10000 as markout_bps,
        -- PnL in dollars
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * t.notional / t.entry_price as pnl,
        -- Weight: sqrt of notional, capped
        least(sqrt(t.notional), {w_max:Float64}) as weight,
        -- Win indicator
        if(if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) > 0, 1, 0) as is_win
      FROM deduped_trades t
      JOIN resolved_markets rm ON t.token_id = rm.token_id
      WHERE t.wallet IN (SELECT trader_wallet FROM wallet_totals)
        AND t.role = 'taker'  -- Only taker trades (market orders, not MM)
    ),
    -- Aggregate per wallet
    wallet_stats AS (
      SELECT
        wallet,
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight * weight) as tw2,
        -- Weighted mean markout
        sum(weight * markout_bps) / sum(weight) as wmean,
        -- Weighted variance
        sum(weight * pow(markout_bps, 2)) / sum(weight)
          - pow(sum(weight * markout_bps) / sum(weight), 2) as wvar,
        -- Win rate
        sum(is_win) * 100.0 / count() as win_rate,
        -- Total PnL
        sum(pnl) as total_pnl
      FROM trades_with_resolution
      GROUP BY wallet
      HAVING fills >= {min_fills:UInt32}
        AND volume >= {min_volume:Float64}
    )
    SELECT
      w.wallet,
      w.fills,
      w.markets,
      w.volume,
      wt.total_trades,
      w.wmean as mean_bps,
      sqrt(greatest(w.wvar, 0)) as std_bps,
      w.wmean / (sqrt(greatest(w.wvar, 0)) + 1) as sharpe,
      (w.wmean / (sqrt(greatest(w.wvar, 0)) + 1)) * sqrt(pow(w.tw, 2) / nullIf(w.tw2, 0)) as t_stat,
      pow(w.tw, 2) / nullIf(w.tw2, 0) as n_eff,
      w.win_rate,
      w.total_pnl
    FROM wallet_stats w
    JOIN wallet_totals wt ON w.wallet = wt.trader_wallet
    WHERE w.wmean > 0  -- Only profitable wallets
    ORDER BY t_stat DESC
    LIMIT 50
  `;

  console.log('Running query...\n');

  const result = await clickhouse.query({
    query,
    query_params: {
      w_max: W_MAX,
      min_fills: MIN_FILLS,
      max_trades: MAX_TOTAL_TRADES,
      min_volume: MIN_VOLUME,
    },
    format: 'JSONEachRow',
  });

  const wallets = await result.json() as WalletTStat[];

  console.log(`Found ${wallets.length} qualifying wallets\n`);

  console.log('Rank | Wallet                                     | T-Stat | Mean(bps) | Fills | Win%  | Total PnL   | Total Trades');
  console.log('-----|------------------------------------------|---------|-----------:|-------|-------|-------------|-------------');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const verdict = w.t_stat > 4 ? '✅' : w.t_stat > 2 ? '👀' : '⚠️';
    console.log(
      `${(i + 1).toString().padStart(4)} | ${w.wallet} | ${w.t_stat.toFixed(2).padStart(7)} | ${w.mean_bps.toFixed(0).padStart(9)} | ${w.fills.toString().padStart(5)} | ${w.win_rate.toFixed(1).padStart(5)}% | $${Math.round(w.total_pnl).toLocaleString().padStart(10)} | ${w.total_trades.toLocaleString().padStart(11)} ${verdict}`
    );
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const csvRows = [
    'rank,wallet,url,t_stat,mean_bps,std_bps,sharpe,fills,markets,win_rate,total_pnl,volume,total_trades,n_eff'
  ];
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    csvRows.push([
      i + 1,
      w.wallet,
      `https://polymarket.com/profile/${w.wallet}`,
      w.t_stat.toFixed(3),
      w.mean_bps.toFixed(1),
      w.std_bps.toFixed(1),
      w.sharpe.toFixed(3),
      w.fills,
      w.markets,
      w.win_rate.toFixed(1),
      Math.round(w.total_pnl),
      Math.round(w.volume),
      w.total_trades,
      w.n_eff.toFixed(1)
    ].join(','));
  }

  fs.writeFileSync(path.join(exportDir, 'btc_daily_tstat_leaderboard.csv'), csvRows.join('\n'));
  fs.writeFileSync(path.join(exportDir, 'btc_daily_tstat_leaderboard.json'), JSON.stringify(wallets, null, 2));

  console.log('\n=== TOP 10 FOR VERIFICATION ===\n');
  for (const w of wallets.slice(0, 10)) {
    const verdict = w.t_stat > 4 ? '✅ STRONG' : w.t_stat > 2 ? '👀 SIGNIFICANT' : '⚠️ WEAK';
    console.log(`${verdict} - T-stat: ${w.t_stat.toFixed(2)}`);
    console.log(`  Wallet: ${w.wallet}`);
    console.log(`  https://polymarket.com/profile/${w.wallet}`);
    console.log(`  Mean: ${w.mean_bps.toFixed(0)} bps | Win: ${w.win_rate.toFixed(1)}% | PnL: $${Math.round(w.total_pnl).toLocaleString()}`);
    console.log(`  Fills: ${w.fills} | Markets: ${w.markets} | Total trades: ${w.total_trades.toLocaleString()}`);
    console.log('');
  }

  console.log('Exports:');
  console.log(`  ${exportDir}/btc_daily_tstat_leaderboard.csv`);
  console.log(`  ${exportDir}/btc_daily_tstat_leaderboard.json`);
}

main().catch(console.error);
