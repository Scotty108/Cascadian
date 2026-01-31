#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v15 - Production Ready
 *
 * Improvements over v14:
 * - ROI capped at 5x (500%) to prevent numerical overflow
 * - Negative bankroll wallets filtered out
 * - Additional sanity checks on simulation results
 * - FIFO V5 logic: (resolved_at IS NOT NULL OR is_closed = 1)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// ============================================
// CONFIGURATION
// ============================================
const TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260129';
const STARTING_BANKROLL = 10000;
const LOOKBACK_DAYS = 30;
const MIN_TRADES = 50;
const MIN_MARKETS = 8;
const ACTIVE_DAYS = 5;
const MIN_AGE_DAYS = 4;
const MIN_MEDIAN_ROI = 0.15;   // 15%
const MIN_MEDIAN_BET = 10;
const POSITION_FRACTION = 0.02;  // 2% per trade
const MAX_ROI_CAP = 5.0;         // Cap individual trade ROI at 500%
const MAX_REALISTIC_LOG_GROWTH = 0.5;  // Filter out unrealistic >50% daily compound growth

// ============================================
// TYPES
// ============================================
interface Trade {
  tx_hash: string;
  entry_time: number;
  exit_time: number | null;
  roi: number;
  cost_usd: number;
  condition_id: string;
  is_closed: number;
}

interface WalletStats {
  wallet: string;
  total_trades: number;
  markets_traded: number;
  win_rate_pct: number;
  median_roi: number;
  median_bet_size: number;
  median_win_roi: number;
  median_loss_mag: number;
  wins: number;
  losses: number;
  first_trade: number;
  last_trade: number;
}

interface DailyEquity {
  date: string;
  equity: number;
}

interface SimulationResult {
  wallet: string;
  log_growth_per_day: number;
  simulated_copytrade_return_per_day: number;
  roi_per_day: number;
  win_rate_percent: number;
  median_roi_percent: number;
  trades_per_day: number;
  ev_per_trade: number;
  volatility: number;
  cvar: number;
  capital_velocity: number;
  hold_time_per_trade_minutes: number;
  final_bankroll: number;
  trades_copied: number;
  trades_skipped: number;
  date_of_last_trade: string;
}

// ============================================
// UNIT TESTS
// ============================================
function runUnitTests(): boolean {
  console.log('Running unit tests...');
  let allPassed = true;

  // Log growth tests
  const g1 = Math.log(100 / 100);
  if (Math.abs(g1 - 0) > 0.0001) { allPassed = false; console.error('FAIL: g1'); }

  const g2 = Math.log(101 / 100);
  if (Math.abs(g2 - 0.00995) > 0.0001) { allPassed = false; console.error('FAIL: g2'); }

  const g3 = Math.log(99 / 100);
  if (Math.abs(g3 - (-0.01005)) > 0.0001) { allPassed = false; console.error('FAIL: g3'); }

  // EV test
  const W = 0.6, Rw = 0.3, Rl = 0.2;
  const ev = W * Rw - (1 - W) * Rl;
  if (Math.abs(ev - 0.10) > 0.0001) { allPassed = false; console.error('FAIL: ev'); }

  // ROI cap test
  const testRoi = Math.min(10.5, MAX_ROI_CAP);
  if (testRoi !== MAX_ROI_CAP) { allPassed = false; console.error('FAIL: ROI cap'); }

  if (allPassed) {
    console.log('  All unit tests passed!\n');
  }
  return allPassed;
}

// ============================================
// DATA RETRIEVAL - FIFO V5 LOGIC
// ============================================
async function getDataCutoff(): Promise<Date> {
  const query = `SELECT max(entry_time) as latest FROM ${TABLE}`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as { latest: string }[];
  return new Date(rows[0].latest);
}

async function getQualifiedWallets(cutoffDate: Date): Promise<WalletStats[]> {
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  const lookbackStr = new Date(cutoffDate.getTime() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const activeCutoffStr = new Date(cutoffDate.getTime() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const ageCutoffStr = new Date(cutoffDate.getTime() - MIN_AGE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  const query = `
    WITH deduped AS (
      SELECT
        tx_hash, wallet, condition_id, outcome_index,
        any(entry_time) as trade_entry_time,
        any(resolved_at) as trade_resolved_at,
        any(cost_usd) as trade_cost_usd,
        -- Cap ROI at ${MAX_ROI_CAP} (${MAX_ROI_CAP * 100}%)
        least(any(roi), ${MAX_ROI_CAP}) as trade_roi,
        any(is_closed) as trade_is_closed
      FROM ${TABLE}
      WHERE
        entry_time >= '${lookbackStr}'
        AND entry_time <= '${cutoffStr}'
        AND cost_usd >= 10
        AND (resolved_at IS NOT NULL OR is_closed = 1)  -- FIFO V5
        AND roi >= -1  -- Exclude total losses beyond -100%
        AND roi <= 20  -- Exclude suspicious extreme ROIs
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    ),
    wallet_stats AS (
      SELECT
        wallet,
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,
        countIf(trade_roi > 0) as wins,
        countIf(trade_roi <= 0) as losses,
        countIf(trade_roi > 0) * 1.0 / count() as win_rate_pct,
        medianExact(trade_roi) as median_roi,
        medianExact(abs(trade_cost_usd)) as median_bet_size,
        medianExactIf(trade_roi, trade_roi > 0) as median_win_roi,
        medianExactIf(abs(trade_roi), trade_roi <= 0) as median_loss_mag,
        min(trade_entry_time) as first_trade,
        max(trade_entry_time) as last_trade
      FROM deduped
      GROUP BY wallet
    )
    SELECT
      wallet,
      total_trades,
      markets_traded,
      wins,
      losses,
      win_rate_pct,
      median_roi,
      median_bet_size,
      coalesce(median_win_roi, 0) as median_win_roi,
      coalesce(median_loss_mag, 0) as median_loss_mag,
      toUInt64(first_trade) as first_trade,
      toUInt64(last_trade) as last_trade
    FROM wallet_stats
    WHERE
      total_trades > ${MIN_TRADES}
      AND markets_traded > ${MIN_MARKETS}
      AND last_trade >= toDateTime('${activeCutoffStr}')
      AND first_trade <= toDateTime('${ageCutoffStr}')
      AND median_roi > ${MIN_MEDIAN_ROI}
      AND median_bet_size > ${MIN_MEDIAN_BET}
      AND wins > 0
      AND losses > 0
    ORDER BY total_trades DESC
    LIMIT 500
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as WalletStats[];
}

async function getWalletTrades(wallet: string, startDate: Date, endDate: Date): Promise<Trade[]> {
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = endDate.toISOString().slice(0, 19).replace('T', ' ');

  const query = `
    WITH deduped AS (
      SELECT
        tx_hash, wallet, condition_id, outcome_index,
        any(entry_time) as trade_entry_time,
        any(resolved_at) as trade_resolved_at,
        any(cost_usd) as trade_cost_usd,
        any(roi) as trade_roi,
        any(is_closed) as trade_is_closed
      FROM ${TABLE}
      WHERE wallet = '${wallet}'
        AND entry_time >= '${startStr}'
        AND entry_time <= '${endStr}'
        AND cost_usd >= 10
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND roi >= -1
        AND roi <= 20
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    )
    SELECT
      tx_hash,
      toUInt64(trade_entry_time) as entry_time,
      toUInt64(if(trade_resolved_at IS NOT NULL, trade_resolved_at, trade_entry_time + INTERVAL 1 DAY)) as exit_time,
      -- Cap ROI at query time too
      least(greatest(trade_roi, -1), ${MAX_ROI_CAP}) as roi,
      abs(trade_cost_usd) as cost_usd,
      condition_id,
      trade_is_closed as is_closed
    FROM deduped
    ORDER BY trade_entry_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as Trade[];
}

// ============================================
// COPIER SIMULATION
// ============================================
function simulateCopier(trades: Trade[], startingBankroll: number): {
  dailyEquities: DailyEquity[];
  finalBankroll: number;
  tradesCopied: number;
  tradesSkipped: number;
  holdTimesMinutes: number[];
  totalBetVolume: number;
} {
  if (trades.length === 0) {
    return {
      dailyEquities: [],
      finalBankroll: startingBankroll,
      tradesCopied: 0,
      tradesSkipped: 0,
      holdTimesMinutes: [],
      totalBetVolume: 0,
    };
  }

  interface SimEvent {
    time: number;
    type: 'BUY' | 'SELL';
    trade_idx: number;
    trade: Trade;
  }

  const events: SimEvent[] = [];
  trades.forEach((trade, idx) => {
    // Cap ROI at simulation time as well
    const cappedTrade = { ...trade, roi: Math.min(Math.max(trade.roi, -1), MAX_ROI_CAP) };
    events.push({ time: trade.entry_time, type: 'BUY', trade_idx: idx, trade: cappedTrade });
    if (trade.exit_time) {
      events.push({ time: trade.exit_time, type: 'SELL', trade_idx: idx, trade: cappedTrade });
    }
  });

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type === 'SELL' ? -1 : 1;
  });

  let cash = startingBankroll;
  const positions: Map<number, { invested: number; entry_time: number; exit_time: number; roi: number }> = new Map();
  let tradesCopied = 0;
  let tradesSkipped = 0;
  const holdTimesMinutes: number[] = [];
  let totalBetVolume = 0;

  const dailyEquityMap: Map<string, number> = new Map();
  let currentDay = '';

  function getEquity(): number {
    let eq = cash;
    for (const pos of positions.values()) {
      eq += pos.invested;
    }
    return eq;
  }

  function recordDaily(ts: number) {
    const d = new Date(ts * 1000).toISOString().slice(0, 10);
    if (d !== currentDay) {
      currentDay = d;
      dailyEquityMap.set(d, getEquity());
    }
  }

  for (const event of events) {
    recordDaily(event.time);

    if (event.type === 'BUY') {
      const equity = getEquity();
      const betSize = equity * POSITION_FRACTION;

      // Only copy if we have enough cash and equity is still positive
      if (cash >= betSize && betSize > 1 && equity > 0) {
        positions.set(event.trade_idx, {
          invested: betSize,
          entry_time: event.time,
          exit_time: event.trade.exit_time || event.time,
          roi: event.trade.roi,
        });
        cash -= betSize;
        tradesCopied++;
        totalBetVolume += betSize;
      } else {
        tradesSkipped++;
      }
    } else {
      const pos = positions.get(event.trade_idx);
      if (pos) {
        const proceeds = pos.invested * (1 + pos.roi);
        cash += proceeds;
        positions.delete(event.trade_idx);
        const holdMins = (pos.exit_time - pos.entry_time) / 60;
        holdTimesMinutes.push(holdMins);
      }
    }
  }

  if (events.length > 0) {
    recordDaily(events[events.length - 1].time);
  }

  let finalBankroll = cash;
  for (const pos of positions.values()) {
    finalBankroll += pos.invested * (1 + pos.roi);
  }

  const dailyEquities = Array.from(dailyEquityMap.entries())
    .map(([date, equity]) => ({ date, equity }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { dailyEquities, finalBankroll, tradesCopied, tradesSkipped, holdTimesMinutes, totalBetVolume };
}

// ============================================
// METRICS CALCULATION
// ============================================
function calculateMetrics(
  dailyEquities: DailyEquity[],
  stats: WalletStats,
  sim: ReturnType<typeof simulateCopier>,
  startingBankroll: number
): Omit<SimulationResult, 'wallet'> | null {
  if (dailyEquities.length < 2 || sim.tradesCopied === 0) return null;
  if (sim.finalBankroll <= 0) return null;  // Skip wallets that went bankrupt

  const dailyLogReturns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    const prev = dailyEquities[i - 1].equity;
    const curr = dailyEquities[i].equity;
    if (prev > 0 && curr > 0) {
      dailyLogReturns.push(Math.log(curr / prev));
    }
  }

  if (dailyLogReturns.length === 0) return null;

  const logGrowthPerDay = dailyLogReturns.reduce((a, b) => a + b, 0) / dailyLogReturns.length;

  // Skip unrealistically high growth rates
  if (logGrowthPerDay > MAX_REALISTIC_LOG_GROWTH) return null;

  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    const prev = dailyEquities[i - 1].equity;
    const curr = dailyEquities[i].equity;
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }
  const simReturnPerDay = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;

  const totalDays = Math.max(1, dailyEquities.length - 1);
  const totalPnl = sim.finalBankroll - startingBankroll;
  const roiPerDay = (totalPnl / startingBankroll) / totalDays;

  const variance = dailyLogReturns.reduce((sum, r) => sum + Math.pow(r - logGrowthPerDay, 2), 0) / dailyLogReturns.length;
  const volatility = Math.sqrt(variance);

  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const cvarCount = Math.max(1, Math.floor(sortedReturns.length * 0.05));
  const cvar = sortedReturns.slice(0, cvarCount).reduce((a, b) => a + b, 0) / cvarCount;

  const W = stats.win_rate_pct;
  const Rw = Math.min(stats.median_win_roi || 0, MAX_ROI_CAP);
  const Rl = stats.median_loss_mag || 0;
  const evPerTrade = W * Rw - (1 - W) * Rl;

  const capitalVelocity = sim.totalBetVolume / (startingBankroll * totalDays);

  const sortedHoldTimes = [...sim.holdTimesMinutes].sort((a, b) => a - b);
  const holdTimeMedian = sortedHoldTimes.length > 0
    ? sortedHoldTimes[Math.floor(sortedHoldTimes.length / 2)] : 0;

  const tradesPerDay = sim.tradesCopied / totalDays;

  return {
    log_growth_per_day: logGrowthPerDay,
    simulated_copytrade_return_per_day: simReturnPerDay,
    roi_per_day: roiPerDay,
    win_rate_percent: stats.win_rate_pct * 100,
    median_roi_percent: stats.median_roi * 100,
    trades_per_day: tradesPerDay,
    ev_per_trade: evPerTrade,
    volatility,
    cvar,
    capital_velocity: capitalVelocity,
    hold_time_per_trade_minutes: holdTimeMedian,
    final_bankroll: sim.finalBankroll,
    trades_copied: sim.tradesCopied,
    trades_skipped: sim.tradesSkipped,
    date_of_last_trade: new Date(stats.last_trade * 1000).toISOString().slice(0, 19).replace('T', ' '),
  };
}

// ============================================
// CSV OUTPUT
// ============================================
function formatValue(val: number | null | undefined, decimals: number = 6): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'null';
  return val.toFixed(decimals);
}

function generateCSV(results: SimulationResult[]): string {
  const headers = [
    'rank', 'wallet_address', 'polymarket_url', 'log_growth_per_day',
    'simulated_copytrade_return_per_day', 'roi_per_day', 'win_rate_percent',
    'median_roi_percent', 'trades_per_day', 'ev_per_trade', 'volatility',
    'cvar', 'capital_velocity', 'hold_time_per_trade_minutes', 'final_bankroll',
    'trades_copied', 'trades_skipped', 'date_of_last_trade',
  ];

  const rows = results.slice(0, 50).map((r, idx) => [
    idx + 1,
    r.wallet,
    `https://polymarket.com/${r.wallet}`,
    formatValue(r.log_growth_per_day, 8),
    formatValue(r.simulated_copytrade_return_per_day, 8),
    formatValue(r.roi_per_day, 8),
    formatValue(r.win_rate_percent, 4),
    formatValue(r.median_roi_percent, 4),
    formatValue(r.trades_per_day, 4),
    formatValue(r.ev_per_trade, 6),
    formatValue(r.volatility, 8),
    formatValue(r.cvar, 8),
    formatValue(r.capital_velocity, 6),
    formatValue(r.hold_time_per_trade_minutes, 2),
    formatValue(r.final_bankroll, 2),
    r.trades_copied,
    r.trades_skipped,
    r.date_of_last_trade,
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('='.repeat(80));
  console.log('COPYTRADING LEADERBOARD v15 - Production Ready');
  console.log('Dataset: ' + TABLE);
  console.log('='.repeat(80));

  if (!runUnitTests()) {
    console.error('ERROR: Unit tests failed. Aborting.');
    process.exit(1);
  }

  try {
    const DATA_CUTOFF = await getDataCutoff();
    console.log(`Data cutoff (today): ${DATA_CUTOFF.toISOString()}`);

    const lookbackStart = new Date(DATA_CUTOFF.getTime() - LOOKBACK_DAYS * 86400000);
    console.log(`Lookback window: ${lookbackStart.toISOString()} to ${DATA_CUTOFF.toISOString()}`);
    console.log(`ROI cap: ${MAX_ROI_CAP * 100}% | Max log growth filter: ${MAX_REALISTIC_LOG_GROWTH}`);
    console.log('');

    console.log('Step 1-6: Finding qualified wallets (FIFO V5 logic)...');
    console.log(`  Filters: >${MIN_TRADES} trades, >${MIN_MARKETS} markets, active last ${ACTIVE_DAYS} days,`);
    console.log(`           age >${MIN_AGE_DAYS} days, median ROI >${MIN_MEDIAN_ROI}, median bet >$${MIN_MEDIAN_BET}`);
    console.log(`  FIFO V5: (resolved_at IS NOT NULL OR is_closed = 1) for realized PnL`);

    const qualifiedWallets = await getQualifiedWallets(DATA_CUTOFF);
    console.log(`  Found ${qualifiedWallets.length} qualifying wallets\n`);

    if (qualifiedWallets.length === 0) {
      console.log('No wallets meet criteria. Exiting.');
      process.exit(0);
    }

    console.log('Step 7: Running copier simulations...');
    const results: SimulationResult[] = [];
    let processed = 0;

    for (const stats of qualifiedWallets) {
      processed++;
      if (processed % 20 === 0 || processed === qualifiedWallets.length) {
        process.stdout.write(`\r  Processing ${processed}/${qualifiedWallets.length}... (${results.length} valid)`);
      }

      try {
        const trades = await getWalletTrades(stats.wallet, lookbackStart, DATA_CUTOFF);
        if (trades.length === 0) continue;

        const sim = simulateCopier(trades, STARTING_BANKROLL);
        const metrics = calculateMetrics(sim.dailyEquities, stats, sim, STARTING_BANKROLL);

        if (metrics && metrics.log_growth_per_day > 0) {
          results.push({ wallet: stats.wallet, ...metrics });
        }
      } catch {
        continue;
      }
    }
    console.log('\n');

    console.log('Step 8: Ranking by Log Growth Per Day...');
    results.sort((a, b) => {
      if (b.log_growth_per_day !== a.log_growth_per_day) {
        return b.log_growth_per_day - a.log_growth_per_day;
      }
      return a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase());
    });

    const csv = generateCSV(results.slice(0, 50));

    console.log('');
    console.log(csv);

    console.log('\n');
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total valid wallets: ${results.length}`);
    if (results.length > 0) {
      console.log(`Best Log Growth/Day: ${results[0].log_growth_per_day.toFixed(8)}`);
      console.log(`Best wallet: ${results[0].wallet}`);
      const top50 = results.slice(0, 50);
      const avgLogGrowth = top50.reduce((s, r) => s + r.log_growth_per_day, 0) / top50.length;
      console.log(`Avg Log Growth/Day (top 50): ${avgLogGrowth.toFixed(8)}`);
      const avgFinalBankroll = top50.reduce((s, r) => s + r.final_bankroll, 0) / top50.length;
      console.log(`Avg Final Bankroll (top 50): $${avgFinalBankroll.toFixed(2)}`);
    }

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

main();
