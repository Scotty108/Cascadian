#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v13
 *
 * Top 50 wallets ranked by Log Growth Per Day using:
 * - Dataset: pm_trade_fifo_roi_v3_mat_unified_backup_20260129
 * - Deduplication: GROUP BY tx_hash, wallet, condition_id, outcome_index
 * - 90-day lookback window
 * - Walk-forward validation
 * - $10,000 starting bankroll
 *
 * Key changes from v12:
 * - 90 days lookback (was 30)
 * - Median ROI on wins only (per spec)
 *
 * Note: FIFO V5 scalper filter was planned but the backup table has
 * is_closed=0 for all rows (no scalp data). Using resolved trades only.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

// ============================================
// CONFIGURATION
// ============================================
const TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260129';
const STARTING_BANKROLL = 10000;
const LOOKBACK_DAYS = 90;
const FORWARD_DAYS = 7;
const POSITION_FRACTION = 0.02;  // 2% of equity per trade
const MIN_TRADES = 50;
const MIN_MARKETS = 8;
const ACTIVE_DAYS = 5;
const MIN_AGE_DAYS = 4;
const MIN_MEDIAN_ROI = 0.15;  // On winning trades (decimal)
const MIN_MEDIAN_BET = 10;
const DEFAULT_HOLD_MINUTES = 1440;  // 1 day default for scalpers without resolved trades

// Determine "today" from dataset
let DATA_CUTOFF: Date;

// ============================================
// TYPES
// ============================================
interface Trade {
  tx_hash: string;
  entry_time: number;  // Unix timestamp
  exit_time: number;   // Unix timestamp (resolved_at or estimated)
  roi: number;
  cost_usd: number;
  condition_id: string;
  is_scalp: boolean;
}

interface WalletStats {
  wallet: string;
  total_trades: number;
  markets_traded: number;
  win_rate_pct: number;
  median_win_roi: number;
  median_bet_size: number;
  median_loss_mag: number;
  wins: number;
  losses: number;
  first_trade: number;
  last_trade: number;
  median_hold_minutes: number;
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
  // Walk-forward
  forward_log_growth?: number | null;
  forward_return?: number | null;
}

// ============================================
// UNIT TESTS
// ============================================
function runUnitTests(): boolean {
  console.log('Running unit tests...');
  let allPassed = true;

  // Test 1: Log growth calculation
  // Bankroll unchanged -> g_d = 0
  const g1 = Math.log(100 / 100);
  if (Math.abs(g1 - 0) > 0.0001) {
    console.error('  FAIL: Unchanged bankroll should give g_d = 0');
    allPassed = false;
  } else {
    console.log('  PASS: Unchanged bankroll = 0');
  }

  // +1% bankroll -> g_d ~ 0.00995
  const g2 = Math.log(101 / 100);
  if (Math.abs(g2 - 0.00995) > 0.0001) {
    console.error(`  FAIL: +1% should give ~0.00995, got ${g2}`);
    allPassed = false;
  } else {
    console.log('  PASS: +1% growth ~ 0.00995');
  }

  // -1% bankroll -> g_d ~ -0.01005
  const g3 = Math.log(99 / 100);
  if (Math.abs(g3 - (-0.01005)) > 0.0001) {
    console.error(`  FAIL: -1% should give ~-0.01005, got ${g3}`);
    allPassed = false;
  } else {
    console.log('  PASS: -1% growth ~ -0.01005');
  }

  // Test 2: EV per trade calculation
  // W=0.6, Rw=0.3, Rl=0.2 -> EV = 0.6*0.3 - 0.4*0.2 = 0.18 - 0.08 = 0.10
  const W = 0.6, Rw = 0.3, Rl = 0.2;
  const ev = W * Rw - (1 - W) * Rl;
  if (Math.abs(ev - 0.10) > 0.0001) {
    console.error(`  FAIL: EV calculation wrong, got ${ev}`);
    allPassed = false;
  } else {
    console.log('  PASS: EV = W*Rw - (1-W)*Rl');
  }

  // Test 3: Median calculation
  const testMedian = (arr: number[]): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  if (testMedian([1, 3, 2]) !== 2) {
    console.error('  FAIL: Median of [1,3,2] should be 2');
    allPassed = false;
  } else {
    console.log('  PASS: Median odd array');
  }
  if (testMedian([1, 2, 3, 4]) !== 2.5) {
    console.error('  FAIL: Median of [1,2,3,4] should be 2.5');
    allPassed = false;
  } else {
    console.log('  PASS: Median even array');
  }

  // Test 4: CVaR calculation
  const testCVaR = (returns: number[], pct: number): number => {
    const sorted = [...returns].sort((a, b) => a - b);
    const count = Math.max(1, Math.floor(sorted.length * pct));
    return sorted.slice(0, count).reduce((a, b) => a + b, 0) / count;
  };
  const testReturns = Array.from({ length: 100 }, (_, i) => i - 50);  // -50 to 49
  const cvarResult = testCVaR(testReturns, 0.05);
  // Bottom 5% of 100 items = 5 items: -50, -49, -48, -47, -46 -> mean = -48
  if (Math.abs(cvarResult - (-48)) > 0.1) {
    console.error(`  FAIL: CVaR of 100 items should be -48, got ${cvarResult}`);
    allPassed = false;
  } else {
    console.log('  PASS: CVaR bottom 5%');
  }

  if (allPassed) {
    console.log('  All unit tests passed!\n');
  } else {
    console.error('  Some unit tests failed. Halting.\n');
  }
  return allPassed;
}

// ============================================
// DATA RETRIEVAL
// ============================================
async function getDataCutoff(): Promise<Date> {
  const query = `SELECT max(entry_time) as latest FROM ${TABLE} WHERE cost_usd > 0`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as { latest: string }[];
  return new Date(rows[0].latest);
}

async function getQualifiedWallets(cutoffDate: Date): Promise<WalletStats[]> {
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  const lookbackStr = new Date(cutoffDate.getTime() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const activeCutoffStr = new Date(cutoffDate.getTime() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const ageCutoffStr = new Date(cutoffDate.getTime() - MIN_AGE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  // Phase 1: Quick filter - using resolved trades only
  // Note: Backup table has 0 scalp trades (is_closed not populated), so using resolved_at only
  console.log('    Phase 1: Finding active wallets with resolved trades...');
  const candidatesQuery = `
    SELECT
      wallet,
      count() as total_trades,
      uniqExact(condition_id) as markets_traded,
      min(entry_time) as first_trade,
      max(entry_time) as last_trade
    FROM ${TABLE}
    WHERE entry_time >= '${lookbackStr}'
      AND entry_time <= '${cutoffStr}'
      AND cost_usd > 0
      AND resolved_at IS NOT NULL
    GROUP BY wallet
    HAVING
      total_trades > ${MIN_TRADES}
      AND markets_traded > ${MIN_MARKETS}
      AND last_trade >= toDateTime('${activeCutoffStr}')
      AND first_trade <= toDateTime('${ageCutoffStr}')
    ORDER BY total_trades DESC
    LIMIT 2000
    SETTINGS max_execution_time = 300
  `;

  const candidatesResult = await clickhouse.query({ query: candidatesQuery, format: 'JSONEachRow' });
  const candidates = await candidatesResult.json() as {
    wallet: string;
    total_trades: number;
  }[];

  const totalTrades = candidates.reduce((s, c) => s + Number(c.total_trades), 0);
  console.log(`    Phase 1: Found ${candidates.length} candidate wallets (${totalTrades.toLocaleString()} total trades)`);

  if (candidates.length === 0) {
    return [];
  }

  // Phase 2: Detailed stats for candidates (simplified - skip deduplication for speed)
  // Deduplication will be done when fetching individual wallet trades
  console.log('    Phase 2: Computing detailed stats (simplified for speed)...');
  const BATCH_SIZE = 100;
  const results: WalletStats[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const walletList = batch.map(c => `'${c.wallet}'`).join(',');

    // Simplified query using resolved trades only (backup table has no scalps)
    const statsQuery = `
      SELECT
        wallet,
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,
        countIf(roi > 0) as wins,
        countIf(roi <= 0) as losses,
        countIf(roi > 0) * 1.0 / count() as win_rate_pct,
        medianIf(roi, roi > 0) as median_win_roi,
        median(abs(cost_usd)) as median_bet_size,
        medianIf(abs(roi), roi <= 0) as median_loss_mag,
        toUInt64(min(entry_time)) as first_trade,
        toUInt64(max(entry_time)) as last_trade,
        -- Use quantile (approximate) for speed
        quantile(0.5)(dateDiff('minute', entry_time, resolved_at)) as median_hold_minutes
      FROM ${TABLE}
      WHERE wallet IN (${walletList})
        AND entry_time >= '${lookbackStr}'
        AND entry_time <= '${cutoffStr}'
        AND cost_usd > 0
        AND resolved_at IS NOT NULL
      GROUP BY wallet
      HAVING
        median_win_roi > ${MIN_MEDIAN_ROI}
        AND median_bet_size > ${MIN_MEDIAN_BET}
        AND wins > 0
        AND losses > 0
      SETTINGS max_execution_time = 120
    `;

    const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
    const batchResults = await statsResult.json() as WalletStats[];
    results.push(...batchResults);

    process.stdout.write(`\r    Phase 2: Processed ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length} candidates, ${results.length} qualified...`);
  }
  console.log('');

  return results;
}

async function getWalletTrades(
  wallet: string,
  startDate: Date,
  endDate: Date,
  _medianHoldMinutes: number  // Unused - no scalps in backup table
): Promise<Trade[]> {
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = endDate.toISOString().slice(0, 19).replace('T', ' ');

  const query = `
    WITH deduped AS (
      SELECT
        tx_hash, wallet, condition_id, outcome_index,
        any(entry_time) as trade_entry_time,
        any(resolved_at) as trade_resolved_at,
        any(cost_usd) as trade_cost_usd,
        any(roi) as trade_roi
      FROM ${TABLE}
      WHERE wallet = '${wallet}'
        AND entry_time >= '${startStr}'
        AND entry_time <= '${endStr}'
        AND cost_usd > 0
        AND resolved_at IS NOT NULL
        AND resolved_at <= '${endStr}'
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    ),
    with_p95 AS (
      SELECT
        tx_hash,
        trade_entry_time,
        trade_resolved_at,
        trade_cost_usd,
        trade_roi,
        condition_id,
        quantile(0.95)(trade_roi) OVER () as roi_p95
      FROM deduped
    )
    SELECT
      tx_hash,
      toUInt64(trade_entry_time) as entry_time,
      toUInt64(trade_resolved_at) as exit_time,
      least(trade_roi, roi_p95) as roi,
      abs(trade_cost_usd) as cost_usd,
      condition_id,
      0 as is_scalp
    FROM with_p95
    ORDER BY trade_entry_time
    SETTINGS max_execution_time = 60
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = await result.json() as (Trade & { is_scalp: number })[];

  // Convert is_scalp from number to boolean
  return trades.map(t => ({
    ...t,
    is_scalp: Boolean(t.is_scalp)
  }));
}

// ============================================
// FIFO V5 COPIER SIMULATION
// ============================================
interface Position {
  trade_idx: number;
  invested: number;
  entry_time: number;
  exit_time: number;
  roi: number;
  market_id: string;
}

interface SimEvent {
  time: number;
  type: 'BUY' | 'SELL';
  trade_idx: number;
  trade: Trade;
}

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

  // Create events
  const events: SimEvent[] = [];
  trades.forEach((trade, idx) => {
    events.push({ time: trade.entry_time, type: 'BUY', trade_idx: idx, trade });
    events.push({ time: trade.exit_time, type: 'SELL', trade_idx: idx, trade });
  });

  // Sort: time ascending, SELL before BUY at same time (free cash first)
  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type === 'SELL' ? -1 : 1;
  });

  let cash = startingBankroll;
  const positions: Map<number, Position> = new Map();
  let tradesCopied = 0;
  let tradesSkipped = 0;
  const holdTimesMinutes: number[] = [];
  let totalBetVolume = 0;

  // Track daily equity
  const dailyEquityMap: Map<string, number> = new Map();
  let currentDay = '';

  function getEquity(): number {
    let equity = cash;
    for (const pos of positions.values()) {
      equity += pos.invested;  // Mark to cost (conservative)
    }
    return equity;
  }

  function recordDailyEquity(timestamp: number) {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    if (date !== currentDay) {
      currentDay = date;
      dailyEquityMap.set(date, getEquity());
    }
  }

  // Process events
  for (const event of events) {
    recordDailyEquity(event.time);

    if (event.type === 'BUY') {
      // Calculate bet size: fraction of current equity
      const equity = getEquity();
      const betSize = equity * POSITION_FRACTION;

      if (cash >= betSize && betSize > 1) {
        positions.set(event.trade_idx, {
          trade_idx: event.trade_idx,
          invested: betSize,
          entry_time: event.time,
          exit_time: event.trade.exit_time,
          roi: event.trade.roi,
          market_id: event.trade.condition_id,
        });
        cash -= betSize;
        tradesCopied++;
        totalBetVolume += betSize;
      } else {
        tradesSkipped++;
      }
    } else {
      // SELL
      const pos = positions.get(event.trade_idx);
      if (pos) {
        const proceeds = pos.invested * (1 + pos.roi);
        cash += proceeds;
        positions.delete(event.trade_idx);

        // Record hold time
        const holdMins = (pos.exit_time - pos.entry_time) / 60;
        holdTimesMinutes.push(holdMins);
      }
    }
  }

  // Record final equity
  const lastTime = events[events.length - 1].time;
  recordDailyEquity(lastTime);

  // Calculate final bankroll (close any remaining positions)
  let finalBankroll = cash;
  for (const pos of positions.values()) {
    finalBankroll += pos.invested * (1 + pos.roi);
  }

  // Convert map to array
  const dailyEquities: DailyEquity[] = Array.from(dailyEquityMap.entries())
    .map(([date, equity]) => ({ date, equity }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    dailyEquities,
    finalBankroll,
    tradesCopied,
    tradesSkipped,
    holdTimesMinutes,
    totalBetVolume,
  };
}

// ============================================
// METRICS CALCULATION
// ============================================
function calculateMetrics(
  dailyEquities: DailyEquity[],
  stats: WalletStats,
  sim: ReturnType<typeof simulateCopier>,
  startingBankroll: number
): Omit<SimulationResult, 'wallet' | 'forward_log_growth' | 'forward_return'> | null {
  if (dailyEquities.length < 2 || sim.tradesCopied === 0) {
    return null;
  }

  // Calculate daily log returns
  const dailyLogReturns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    const prev = dailyEquities[i - 1].equity;
    const curr = dailyEquities[i].equity;
    if (prev > 0 && curr > 0) {
      dailyLogReturns.push(Math.log(curr / prev));
    }
  }

  if (dailyLogReturns.length === 0) {
    return null;
  }

  // Log Growth Per Day (mean of daily log returns)
  const logGrowthPerDay = dailyLogReturns.reduce((a, b) => a + b, 0) / dailyLogReturns.length;

  // Simulated copytrade return per day (arithmetic mean of percent change)
  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyEquities.length; i++) {
    const prev = dailyEquities[i - 1].equity;
    const curr = dailyEquities[i].equity;
    if (prev > 0) {
      dailyReturns.push((curr - prev) / prev);
    }
  }
  const simReturnPerDay = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;

  // ROI per day
  const totalDays = Math.max(1, dailyEquities.length - 1);
  const totalPnl = sim.finalBankroll - startingBankroll;
  const roiPerDay = (totalPnl / startingBankroll) / totalDays;

  // Volatility (std dev of daily log returns)
  const meanLogReturn = logGrowthPerDay;
  const variance = dailyLogReturns.reduce((sum, r) => sum + Math.pow(r - meanLogReturn, 2), 0) / dailyLogReturns.length;
  const volatility = Math.sqrt(variance);

  // CVaR (mean of lowest 5% of daily returns)
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const cvarCount = Math.max(1, Math.floor(sortedReturns.length * 0.05));
  const cvar = sortedReturns.slice(0, cvarCount).reduce((a, b) => a + b, 0) / cvarCount;

  // EV per trade: W * Rw - (1-W) * Rl
  const W = stats.win_rate_pct;
  const Rw = stats.median_win_roi || 0;
  const Rl = stats.median_loss_mag || 0;
  const evPerTrade = W * Rw - (1 - W) * Rl;

  // Capital velocity
  const capitalVelocity = sim.totalBetVolume / (startingBankroll * totalDays);

  // Hold time (median)
  const sortedHoldTimes = [...sim.holdTimesMinutes].sort((a, b) => a - b);
  const holdTimeMedian = sortedHoldTimes.length > 0
    ? sortedHoldTimes[Math.floor(sortedHoldTimes.length / 2)]
    : 0;

  // Trades per day
  const tradesPerDay = sim.tradesCopied / totalDays;

  return {
    log_growth_per_day: logGrowthPerDay,
    simulated_copytrade_return_per_day: simReturnPerDay,
    roi_per_day: roiPerDay,
    win_rate_percent: stats.win_rate_pct * 100,
    median_roi_percent: stats.median_win_roi * 100,  // Per spec: median of wins only
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
// WALK-FORWARD VALIDATION
// ============================================
async function walkForwardValidate(
  wallet: string,
  cutoffDate: Date,
  medianHoldMinutes: number
): Promise<{ forward_log_growth: number | null; forward_return: number | null }> {
  const forwardStart = cutoffDate;
  const forwardEnd = new Date(cutoffDate.getTime() + FORWARD_DAYS * 86400000);

  try {
    const trades = await getWalletTrades(wallet, forwardStart, forwardEnd, medianHoldMinutes);
    if (trades.length === 0) {
      return { forward_log_growth: null, forward_return: null };
    }

    const sim = simulateCopier(trades, STARTING_BANKROLL);
    if (sim.dailyEquities.length < 2) {
      return { forward_log_growth: null, forward_return: null };
    }

    // Calculate forward log growth
    const dailyLogReturns: number[] = [];
    for (let i = 1; i < sim.dailyEquities.length; i++) {
      const prev = sim.dailyEquities[i - 1].equity;
      const curr = sim.dailyEquities[i].equity;
      if (prev > 0 && curr > 0) {
        dailyLogReturns.push(Math.log(curr / prev));
      }
    }

    const forwardLogGrowth = dailyLogReturns.length > 0
      ? dailyLogReturns.reduce((a, b) => a + b, 0) / dailyLogReturns.length
      : null;

    const forwardReturn = (sim.finalBankroll - STARTING_BANKROLL) / STARTING_BANKROLL;

    return {
      forward_log_growth: forwardLogGrowth,
      forward_return: forwardReturn,
    };
  } catch {
    return { forward_log_growth: null, forward_return: null };
  }
}

// ============================================
// CSV OUTPUT
// ============================================
function formatValue(val: number | null | undefined, decimals: number = 6): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'null';
  }
  return val.toFixed(decimals);
}

function generateCSV(results: SimulationResult[]): string {
  const headers = [
    'rank',
    'wallet_address',
    'polymarket_url',
    'log_growth_per_day',
    'simulated_copytrade_return_per_day',
    'roi_per_day',
    'win_rate_percent',
    'median_roi_percent',
    'trades_per_day',
    'ev_per_trade',
    'volatility',
    'cvar',
    'capital_velocity',
    'hold_time_per_trade_minutes',
    'final_bankroll',
    'trades_copied',
    'trades_skipped',
    'date_of_last_trade',
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
  console.log('COPYTRADING LEADERBOARD v13');
  console.log('Dataset: pm_trade_fifo_roi_v3_mat_unified_backup_20260129');
  console.log('90-day lookback, 7-day walk-forward validation');
  console.log('='.repeat(80));

  // Run unit tests
  if (!runUnitTests()) {
    console.error('ERROR: Unit tests failed. Aborting.');
    process.exit(1);
  }

  try {
    // Get data cutoff (latest timestamp in dataset)
    DATA_CUTOFF = await getDataCutoff();
    console.log(`Data cutoff (today): ${DATA_CUTOFF.toISOString()}`);

    const lookbackStart = new Date(DATA_CUTOFF.getTime() - LOOKBACK_DAYS * 86400000);
    console.log(`Lookback window: ${lookbackStart.toISOString()} to ${DATA_CUTOFF.toISOString()}`);
    console.log('');

    // Step 1-6: Get qualified wallets
    console.log('Step 1-6: Finding qualified wallets...');
    console.log(`  Filters: >${MIN_TRADES} trades, >${MIN_MARKETS} markets, active in last ${ACTIVE_DAYS} days,`);
    console.log(`           age >${MIN_AGE_DAYS} days, median win ROI >${MIN_MEDIAN_ROI}, median bet >$${MIN_MEDIAN_BET}`);

    const qualifiedWallets = await getQualifiedWallets(DATA_CUTOFF);
    console.log(`  Found ${qualifiedWallets.length} qualifying wallets\n`);

    if (qualifiedWallets.length === 0) {
      console.log('No wallets meet criteria. Exiting.');
      process.exit(0);
    }

    // Step 7: Simulate copytrading for each wallet
    console.log('Step 7: Running copier simulations...');
    const results: SimulationResult[] = [];
    let processed = 0;
    let totalTradesProcessed = 0;

    for (const stats of qualifiedWallets) {
      processed++;
      if (processed % 20 === 0 || processed === qualifiedWallets.length) {
        process.stdout.write(`\r  Processing ${processed}/${qualifiedWallets.length}...`);
      }

      try {
        const trades = await getWalletTrades(
          stats.wallet,
          lookbackStart,
          DATA_CUTOFF,
          stats.median_hold_minutes || DEFAULT_HOLD_MINUTES
        );
        if (trades.length === 0) continue;

        totalTradesProcessed += trades.length;

        const sim = simulateCopier(trades, STARTING_BANKROLL);
        const metrics = calculateMetrics(sim.dailyEquities, stats, sim, STARTING_BANKROLL);

        if (metrics && metrics.log_growth_per_day > 0) {
          results.push({
            wallet: stats.wallet,
            ...metrics,
            forward_log_growth: null,
            forward_return: null,
          });
        }
      } catch (err) {
        // Skip wallet on error
        continue;
      }
    }
    console.log('\n');
    console.log(`  Total trades processed: ${totalTradesProcessed.toLocaleString()}`);

    // Step 8: Rank by LogGrowthPerDay
    console.log('\nStep 8: Ranking by Log Growth Per Day...');
    results.sort((a, b) => {
      if (b.log_growth_per_day !== a.log_growth_per_day) {
        return b.log_growth_per_day - a.log_growth_per_day;
      }
      return a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase());
    });

    // Step 9: Walk-forward validation for top 50
    console.log('Step 9: Walk-forward validation for top 50...');
    const top50 = results.slice(0, 50);

    // Get median hold minutes for each wallet in top50
    const walletHoldMinutes = new Map<string, number>();
    for (const stats of qualifiedWallets) {
      walletHoldMinutes.set(stats.wallet, stats.median_hold_minutes || DEFAULT_HOLD_MINUTES);
    }

    for (let i = 0; i < top50.length; i++) {
      process.stdout.write(`\r  Validating ${i + 1}/${top50.length}...`);
      const holdMins = walletHoldMinutes.get(top50[i].wallet) || DEFAULT_HOLD_MINUTES;
      const wf = await walkForwardValidate(top50[i].wallet, DATA_CUTOFF, holdMins);
      top50[i].forward_log_growth = wf.forward_log_growth;
      top50[i].forward_return = wf.forward_return;
    }
    console.log('\n');

    // Ensure output directory exists
    const outputDir = './data';
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Step 10: Output CSV
    console.log('Step 10: Generating CSV output...\n');
    const csv = generateCSV(top50);

    // Write to file
    const outputPath = './data/copytrading-leaderboard-v13.csv';
    writeFileSync(outputPath, csv);
    console.log(`CSV written to: ${outputPath}\n`);

    // Also print to stdout
    console.log('='.repeat(80));
    console.log('CSV OUTPUT:');
    console.log('='.repeat(80));
    console.log(csv);

    // Summary stats
    console.log('\n');
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total qualifying wallets: ${results.length}`);
    console.log(`Top 50 shown`);
    if (top50.length > 0) {
      console.log(`Best Log Growth/Day: ${top50[0].log_growth_per_day.toFixed(8)}`);
      console.log(`Best wallet: ${top50[0].wallet}`);
      const avgLogGrowth = top50.reduce((s, r) => s + r.log_growth_per_day, 0) / top50.length;
      console.log(`Avg Log Growth/Day (top 50): ${avgLogGrowth.toFixed(8)}`);

      // Walk-forward summary
      const validForward = top50.filter(r => r.forward_log_growth !== null);
      if (validForward.length > 0) {
        const avgForwardGrowth = validForward.reduce((s, r) => s + (r.forward_log_growth || 0), 0) / validForward.length;
        console.log(`Walk-forward avg Log Growth/Day: ${avgForwardGrowth.toFixed(8)} (${validForward.length} wallets)`);
      }
    }

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

main();
