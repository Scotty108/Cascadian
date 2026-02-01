#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard with Walk-Forward Validation
 *
 * Implements rolling window validation to test if past performance predicts future results.
 * Ranks wallets by Log Growth per Day using percent-of-bankroll simulation.
 *
 * Method:
 * 1. Split historical data into overlapping lookback/forward windows (30/7 days, step weekly)
 * 2. Rank wallets by log growth in lookback window
 * 3. Evaluate ranked wallets in forward window
 * 4. Aggregate results across all windows
 *
 * Output: CSV with top 50 wallets ranked by average forward log growth per day
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { mean, median, stdDev, expectancy } from '../../lib/wallet-intelligence/utils';

// ============ Configuration ============

const CONFIG = {
  lookback_days: 30,
  forward_days: 7,
  step_days: 7,
  initial_bankroll: 10000,
  percent_per_trade: 0.01,  // 1% of bankroll
  top_n: 50,
  history_days: 180  // 6 months of data
};

const FILTERS = {
  min_trades: 50,
  min_markets: 8,
  min_median_roi: 0.15,
  min_median_bet: 10,
  min_wallet_age_days: 4,
  active_within_days: 5
};

// ============ Type Definitions ============

interface WalkForwardConfig {
  lookback_days: number;
  forward_days: number;
  step_days: number;
  min_date: Date;
  max_date: Date;
}

interface TimeWindow {
  window_id: number;
  lookback_start: Date;
  lookback_end: Date;
  forward_start: Date;
  forward_end: Date;
}

interface Trade {
  wallet: string;
  tx_hash: string;
  condition_id: string;
  entry_time: Date;
  resolved_at: Date | null;
  cost_usd: number;
  pnl_usd: number;
  roi: number;
  tokens_held: number;
  is_closed: number;
}

interface DailySimulation {
  date: Date;
  trades_on_day: Trade[];
  bankroll_start: number;
  bankroll_end: number;
  pnl_day: number;
  log_growth_day: number;
}

interface SimulationResult {
  wallet: string;
  final_bankroll: number;
  log_growth_per_day: number;
  daily_results: DailySimulation[];
  trades_copied: number;
  trades_skipped: number;
}

interface WalletLookbackResult {
  wallet: string;
  log_growth_per_day: number;
  final_bankroll: number;
  rank_in_window: number;
  trades_copied: number;
}

interface ForwardEvaluation {
  wallet: string;
  window_id: number;
  lookback_rank: number;
  forward_log_growth_per_day: number;
  forward_roi_per_day: number;
  forward_win_rate: number;
  forward_trades_copied: number;
}

interface WalletAggregatedPerformance {
  wallet: string;
  appearances: number;
  avg_lookback_rank: number;
  avg_forward_log_growth_per_day: number;
  median_forward_log_growth_per_day: number;
  avg_forward_roi_per_day: number;
  avg_forward_win_rate: number;
  total_forward_trades: number;
  consistency_score: number;
}

interface LeaderboardRow {
  rank: number;
  wallet_address: string;
  polymarket_url: string;
  log_growth_per_day: number;
  simulated_copytrade_return_per_day: number;
  roi_per_day: number;
  win_rate_percent: number;
  median_roi_percent: number;
  trades_per_day: number;
  ev_per_trade: number;
  volatility: number;
  hold_time_per_trade_minutes: number;
  final_bankroll: number;
  trades_copied: number;
  trades_skipped: number;
  date_of_last_trade: string;
}

// ============ Utility Functions ============

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function groupByDay(trades: Trade[], dateField: 'entry_time'): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>();

  for (const trade of trades) {
    const date = new Date(trade[dateField]);
    const dateKey = date.toISOString().split('T')[0];

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(trade);
  }

  return groups;
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((groups, item) => {
    const groupKey = String(item[key]);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

// ============ Window Generation ============

function generateWalkForwardWindows(config: WalkForwardConfig): TimeWindow[] {
  const windows: TimeWindow[] = [];
  let window_id = 0;
  let current_lookback_start = config.min_date;

  while (true) {
    const lookback_end = addDays(current_lookback_start, config.lookback_days);
    const forward_start = lookback_end;
    const forward_end = addDays(forward_start, config.forward_days);

    if (forward_end > config.max_date) break;

    windows.push({
      window_id: window_id++,
      lookback_start: current_lookback_start,
      lookback_end,
      forward_start,
      forward_end
    });

    current_lookback_start = addDays(current_lookback_start, config.step_days);
  }

  return windows;
}

async function getLatestDataTimestamp(): Promise<Date> {
  const result = await clickhouse.query({
    query: `
      SELECT max(entry_time) as latest_trade_time
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE is_closed = 1
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<{ latest_trade_time: string }>();
  return new Date(data[0].latest_trade_time);
}

// ============ Wallet Filtering ============

async function getQualifyingWallets(window: TimeWindow): Promise<string[]> {
  const lookback_start = window.lookback_start.toISOString().replace('T', ' ').substring(0, 19);
  const lookback_end = window.lookback_end.toISOString().replace('T', ' ').substring(0, 19);

  const query = `
    WITH
    wallet_age AS (
      SELECT
        wallet,
        min(entry_time) as first_ever_trade
      FROM pm_trade_fifo_roi_v3_mat_unified
      GROUP BY wallet
    ),

    lookback_trades AS (
      SELECT *
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= '${lookback_start}'
        AND entry_time < '${lookback_end}'
        AND is_closed = 1
        AND cost_usd >= 0.01
    ),

    recent_activity AS (
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= toDateTime('${lookback_end}') - INTERVAL ${FILTERS.active_within_days} DAY
        AND entry_time < '${lookback_end}'
    ),

    wallet_stats AS (
      SELECT
        wallet,
        count() as total_trades,
        uniq(condition_id) as unique_markets,
        quantile(0.5)(roi) as median_roi,
        quantile(0.5)(cost_usd) as median_bet_size
      FROM lookback_trades
      GROUP BY wallet
    )

    SELECT ws.wallet
    FROM wallet_stats ws
    INNER JOIN wallet_age wa ON ws.wallet = wa.wallet
    INNER JOIN recent_activity ra ON ws.wallet = ra.wallet
    WHERE
      wa.first_ever_trade < toDateTime('${lookback_end}') - INTERVAL ${FILTERS.min_wallet_age_days} DAY
      AND ws.total_trades > ${FILTERS.min_trades}
      AND ws.unique_markets > ${FILTERS.min_markets}
      AND ws.median_roi > ${FILTERS.min_median_roi}
      AND ws.median_bet_size > ${FILTERS.min_median_bet}
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const data = (await result.json()) as Array<{ wallet: string }>;
  return data.map(d => d.wallet);
}

// ============ Trade Fetching ============

async function getTradesForWindow(wallets: string[], start: Date, end: Date): Promise<Trade[]> {
  if (wallets.length === 0) return [];

  const start_str = start.toISOString().replace('T', ' ').substring(0, 19);
  const end_str = end.toISOString().replace('T', ' ').substring(0, 19);

  const BATCH_SIZE = 500;
  const all_trades: Trade[] = [];

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const walletList = batch.map(w => `'${w}'`).join(', ');

    const query = `
      SELECT
        wallet,
        tx_hash,
        condition_id,
        entry_time,
        resolved_at,
        cost_usd,
        pnl_usd,
        roi,
        tokens_held,
        is_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN [${walletList}]
        AND entry_time >= '${start_str}'
        AND entry_time < '${end_str}'
        AND is_closed = 1
        AND cost_usd >= 0.01
      ORDER BY wallet, entry_time
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    });

    const batch_trades = (await result.json()) as Array<any>;
    for (const trade of batch_trades) {
      all_trades.push({
        wallet: trade.wallet,
        tx_hash: trade.tx_hash,
        condition_id: trade.condition_id,
        entry_time: new Date(trade.entry_time),
        resolved_at: trade.resolved_at ? new Date(trade.resolved_at) : null,
        cost_usd: trade.cost_usd,
        pnl_usd: trade.pnl_usd,
        roi: trade.roi,
        tokens_held: trade.tokens_held,
        is_closed: trade.is_closed
      });
    }
  }

  return all_trades;
}

// ============ Simulation Logic ============

function simulateCopytrading(
  wallet_trades: Trade[],
  initial_bankroll: number,
  percent_per_trade: number
): SimulationResult {
  if (wallet_trades.length === 0) {
    return {
      wallet: '',
      final_bankroll: initial_bankroll,
      log_growth_per_day: 0,
      daily_results: [],
      trades_copied: 0,
      trades_skipped: 0
    };
  }

  const tradesByDay = groupByDay(wallet_trades, 'entry_time');

  let bankroll = initial_bankroll;
  const dailyResults: DailySimulation[] = [];
  let trades_copied = 0;
  let trades_skipped = 0;

  for (const [dateKey, dayTrades] of Array.from(tradesByDay.entries())) {
    const bankroll_start = bankroll;
    let pnl_day = 0;

    for (const trade of dayTrades) {
      const bet_amount = bankroll * percent_per_trade;

      if (bet_amount < 0.01) {
        trades_skipped++;
        continue;
      }

      const pnl_trade = bet_amount * trade.roi;
      pnl_day += pnl_trade;
      bankroll += pnl_trade;
      trades_copied++;

      if (bankroll <= 0) {
        bankroll = 0.01;
        break;
      }
    }

    const log_growth_day = Math.log(bankroll / bankroll_start);

    dailyResults.push({
      date: new Date(dateKey),
      trades_on_day: dayTrades,
      bankroll_start,
      bankroll_end: bankroll,
      pnl_day,
      log_growth_day
    });
  }

  const total_days = dailyResults.length;
  const log_growth_per_day = total_days > 0
    ? dailyResults.reduce((sum, d) => sum + d.log_growth_day, 0) / total_days
    : 0;

  return {
    wallet: wallet_trades[0].wallet,
    final_bankroll: bankroll,
    log_growth_per_day,
    daily_results: dailyResults,
    trades_copied,
    trades_skipped
  };
}

// ============ Ranking Logic ============

function rankWallets(simulations: Map<string, SimulationResult>): WalletLookbackResult[] {
  const results = Array.from(simulations.entries())
    .map(([wallet, sim]) => ({
      wallet,
      log_growth_per_day: sim.log_growth_per_day,
      final_bankroll: sim.final_bankroll,
      trades_copied: sim.trades_copied,
      rank_in_window: 0
    }))
    .sort((a, b) => b.log_growth_per_day - a.log_growth_per_day);

  results.forEach((r, i) => r.rank_in_window = i + 1);

  return results;
}

// ============ Forward Evaluation ============

function evaluateForwardPerformance(
  wallet: string,
  forward_trades: Trade[],
  lookback_rank: number,
  window_id: number
): ForwardEvaluation {
  const sim = simulateCopytrading(forward_trades, CONFIG.initial_bankroll, CONFIG.percent_per_trade);

  const total_days = forward_trades.length > 0
    ? (forward_trades[forward_trades.length - 1].entry_time.getTime() - forward_trades[0].entry_time.getTime()) / 86400000
    : 1;
  const roi_per_day = ((sim.final_bankroll - CONFIG.initial_bankroll) / CONFIG.initial_bankroll) / total_days;
  const wins = forward_trades.filter(t => t.pnl_usd > 0).length;
  const win_rate = forward_trades.length > 0 ? wins / forward_trades.length : 0;

  return {
    wallet,
    window_id,
    lookback_rank,
    forward_log_growth_per_day: sim.log_growth_per_day,
    forward_roi_per_day: roi_per_day,
    forward_win_rate: win_rate,
    forward_trades_copied: sim.trades_copied
  };
}

// ============ Aggregation ============

function aggregateAcrossWindows(
  forward_evals: ForwardEvaluation[]
): WalletAggregatedPerformance[] {
  const byWallet = groupBy(forward_evals, 'wallet');

  return Object.entries(byWallet).map(([wallet, evals]) => {
    const forward_log_growths = evals.map(e => e.forward_log_growth_per_day);

    return {
      wallet,
      appearances: evals.length,
      avg_lookback_rank: mean(evals.map(e => e.lookback_rank)),
      avg_forward_log_growth_per_day: mean(forward_log_growths),
      median_forward_log_growth_per_day: median(forward_log_growths),
      avg_forward_roi_per_day: mean(evals.map(e => e.forward_roi_per_day)),
      avg_forward_win_rate: mean(evals.map(e => e.forward_win_rate)),
      total_forward_trades: evals.reduce((sum, e) => sum + e.forward_trades_copied, 0),
      consistency_score: stdDev(forward_log_growths)
    };
  });
}

// ============ Metrics Calculation ============

async function getTradesForWallet(wallet: string, min_date: Date, max_date: Date): Promise<Trade[]> {
  const start_str = min_date.toISOString().replace('T', ' ').substring(0, 19);
  const end_str = max_date.toISOString().replace('T', ' ').substring(0, 19);

  const query = `
    SELECT
      wallet,
      tx_hash,
      condition_id,
      entry_time,
      resolved_at,
      cost_usd,
      pnl_usd,
      roi,
      tokens_held,
      is_closed
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet = '${wallet}'
      AND entry_time >= '${start_str}'
      AND entry_time < '${end_str}'
      AND is_closed = 1
      AND cost_usd >= 0.01
    ORDER BY entry_time
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const trades = (await result.json()) as Array<any>;
  return trades.map((t: any) => ({
    wallet: t.wallet,
    tx_hash: t.tx_hash,
    condition_id: t.condition_id,
    entry_time: new Date(t.entry_time),
    resolved_at: t.resolved_at ? new Date(t.resolved_at) : null,
    cost_usd: t.cost_usd,
    pnl_usd: t.pnl_usd,
    roi: t.roi,
    tokens_held: t.tokens_held,
    is_closed: t.is_closed
  }));
}

function calculateMetrics(
  wallet: string,
  aggregated: WalletAggregatedPerformance,
  all_trades: Trade[]
): LeaderboardRow {
  const rois = all_trades.map(t => t.roi);
  const win_trades = all_trades.filter(t => t.pnl_usd > 0);
  const loss_trades = all_trades.filter(t => t.pnl_usd <= 0);

  const avg_win_roi = win_trades.length > 0 ? mean(win_trades.map(t => t.roi)) : 0;
  const avg_loss_roi = loss_trades.length > 0 ? mean(loss_trades.map(t => Math.abs(t.roi))) : 0;
  const win_rate = all_trades.length > 0 ? win_trades.length / all_trades.length : 0;

  const ev_per_trade = expectancy(win_rate, avg_win_roi, avg_loss_roi);

  const tradesByDay = groupByDay(all_trades, 'entry_time');
  const daily_rois = Array.from(tradesByDay.values()).map(trades => {
    const day_pnl = trades.reduce((sum, t) => sum + t.pnl_usd, 0);
    const day_cost = trades.reduce((sum, t) => sum + t.cost_usd, 0);
    return day_cost > 0 ? day_pnl / day_cost : 0;
  });
  const volatility = stdDev(daily_rois);

  const hold_times = all_trades
    .filter(t => t.resolved_at !== null)
    .map(t => (t.resolved_at!.getTime() - t.entry_time.getTime()) / 60000);
  const hold_time_per_trade_minutes = hold_times.length > 0 ? median(hold_times) : 0;

  const total_days = all_trades.length > 1
    ? (all_trades[all_trades.length - 1].entry_time.getTime() - all_trades[0].entry_time.getTime()) / 86400000
    : 1;

  return {
    rank: 0,
    wallet_address: wallet,
    polymarket_url: `https://polymarket.com/profile/${wallet}`,
    log_growth_per_day: aggregated.avg_forward_log_growth_per_day,
    simulated_copytrade_return_per_day: (Math.exp(aggregated.avg_forward_log_growth_per_day) - 1) * 100,
    roi_per_day: aggregated.avg_forward_roi_per_day * 100,
    win_rate_percent: aggregated.avg_forward_win_rate * 100,
    median_roi_percent: rois.length > 0 ? median(rois) * 100 : 0,
    trades_per_day: aggregated.total_forward_trades / total_days,
    ev_per_trade,
    volatility,
    hold_time_per_trade_minutes,
    final_bankroll: 0,
    trades_copied: aggregated.total_forward_trades,
    trades_skipped: 0,
    date_of_last_trade: all_trades.length > 0
      ? all_trades[all_trades.length - 1].entry_time.toISOString().split('T')[0]
      : ''
  };
}

// ============ CSV Output ============

function generateCSV(leaderboard: LeaderboardRow[]): string {
  const headers = [
    'rank', 'wallet_address', 'polymarket_url', 'log_growth_per_day',
    'simulated_copytrade_return_per_day', 'roi_per_day', 'win_rate_percent',
    'median_roi_percent', 'trades_per_day', 'ev_per_trade', 'volatility',
    'hold_time_per_trade_minutes', 'final_bankroll', 'trades_copied',
    'trades_skipped', 'date_of_last_trade'
  ].join(',');

  const rows = leaderboard.map(row => [
    row.rank,
    row.wallet_address,
    row.polymarket_url,
    row.log_growth_per_day.toFixed(6),
    row.simulated_copytrade_return_per_day.toFixed(4),
    row.roi_per_day.toFixed(4),
    row.win_rate_percent.toFixed(2),
    row.median_roi_percent.toFixed(2),
    row.trades_per_day.toFixed(2),
    row.ev_per_trade.toFixed(4),
    row.volatility.toFixed(4),
    row.hold_time_per_trade_minutes.toFixed(1),
    row.final_bankroll.toFixed(2),
    row.trades_copied,
    row.trades_skipped,
    row.date_of_last_trade
  ].join(','));

  return [headers, ...rows].join('\n');
}

// ============ Main Execution ============

async function main() {
  try {
    // 1. Get latest data timestamp
    const latest_date = await getLatestDataTimestamp();
    const min_date = new Date(latest_date.getTime() - CONFIG.history_days * 86400000);

    console.error(`[DEBUG] Data range: ${min_date.toISOString()} to ${latest_date.toISOString()}`);

    // 2. Generate windows
    const windows = generateWalkForwardWindows({
      lookback_days: CONFIG.lookback_days,
      forward_days: CONFIG.forward_days,
      step_days: CONFIG.step_days,
      min_date,
      max_date: latest_date
    });

    console.error(`[DEBUG] Generated ${windows.length} windows`);

    // 3. For each window
    const all_forward_evals: ForwardEvaluation[] = [];

    for (const window of windows) {
      console.error(`[DEBUG] Window ${window.window_id}: lookback ${window.lookback_start.toISOString()} to ${window.lookback_end.toISOString()}`);

      // 3a. Filter wallets in lookback
      const qualifying_wallets = await getQualifyingWallets(window);
      console.error(`[DEBUG] Window ${window.window_id}: found ${qualifying_wallets.length} qualifying wallets`);
      if (qualifying_wallets.length === 0) continue;

      // 3b. Get trades (batched)
      console.error(`[DEBUG] Window ${window.window_id}: fetching trades for ${qualifying_wallets.length} wallets...`);
      const lookback_trades = await getTradesForWindow(
        qualifying_wallets,
        window.lookback_start,
        window.lookback_end
      );
      console.error(`[DEBUG] Window ${window.window_id}: fetched ${lookback_trades.length} lookback trades`);

      // 3c. Simulate and rank
      const simulations = new Map<string, SimulationResult>();
      const tradesByWallet = groupBy(lookback_trades, 'wallet');

      for (const wallet of qualifying_wallets) {
        const wallet_trades = tradesByWallet[wallet] || [];
        if (wallet_trades.length === 0) continue;

        const sim = simulateCopytrading(wallet_trades, CONFIG.initial_bankroll, CONFIG.percent_per_trade);
        simulations.set(wallet, sim);
      }

      const ranked = rankWallets(simulations);
      console.error(`[DEBUG] Window ${window.window_id}: ranked ${ranked.length} wallets, top log_growth=${ranked[0]?.log_growth_per_day.toFixed(6) || 'N/A'}`);

      // 3d. Evaluate top N in forward window
      const top_n_wallets = ranked.slice(0, CONFIG.top_n).map(r => r.wallet);
      console.error(`[DEBUG] Window ${window.window_id}: evaluating top ${top_n_wallets.length} in forward window...`);
      const forward_trades = await getTradesForWindow(
        top_n_wallets,
        window.forward_start,
        window.forward_end
      );
      console.error(`[DEBUG] Window ${window.window_id}: fetched ${forward_trades.length} forward trades`);

      const forwardTradesByWallet = groupBy(forward_trades, 'wallet');

      for (const wallet_result of ranked.slice(0, CONFIG.top_n)) {
        const wallet_forward_trades = forwardTradesByWallet[wallet_result.wallet] || [];
        if (wallet_forward_trades.length === 0) continue;

        const forward_eval = evaluateForwardPerformance(
          wallet_result.wallet,
          wallet_forward_trades,
          wallet_result.rank_in_window,
          window.window_id
        );

        all_forward_evals.push(forward_eval);
      }
      console.error(`[DEBUG] Window ${window.window_id}: added ${all_forward_evals.length} forward evaluations total`);
    }

    console.error(`[DEBUG] All windows complete. Total forward evaluations: ${all_forward_evals.length}`);

    // 4. Aggregate across windows
    console.error(`[DEBUG] Aggregating results across windows...`);
    const aggregated = aggregateAcrossWindows(all_forward_evals);
    console.error(`[DEBUG] Aggregated ${aggregated.length} unique wallets`);

    // 5. Calculate final metrics
    const leaderboard: LeaderboardRow[] = [];
    for (const agg of aggregated) {
      console.error(`[DEBUG] Calculating metrics for wallet ${agg.wallet}...`);
      const all_trades = await getTradesForWallet(agg.wallet, min_date, latest_date);
      const row = calculateMetrics(agg.wallet, agg, all_trades);
      leaderboard.push(row);
    }

    // 4. Aggregate across windows
    const aggregated = aggregateAcrossWindows(all_forward_evals);

    // 5. Calculate final metrics
    const leaderboard: LeaderboardRow[] = [];
    for (const agg of aggregated) {
      const all_trades = await getTradesForWallet(agg.wallet, min_date, latest_date);
      const row = calculateMetrics(agg.wallet, agg, all_trades);
      leaderboard.push(row);
    }

    leaderboard.sort((a, b) => b.log_growth_per_day - a.log_growth_per_day);
    leaderboard.forEach((row, i) => row.rank = i + 1);

    const top50 = leaderboard.slice(0, 50);

    // 6. Output CSV ONLY
    const csv = generateCSV(top50);
    process.stdout.write(csv);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
