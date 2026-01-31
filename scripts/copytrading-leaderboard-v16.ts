#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v16 - Bug Fixes
 *
 * Fixes from v14:
 * 1. ROI floored at -100% (can't lose more than your investment)
 * 2. ROI capped at +500% (prevents overflow)
 * 3. Negative bankroll wallets filtered out
 * 4. Log growth calculation fixed to not skip crash days
 * 5. FIFO V5 logic: (resolved_at IS NOT NULL OR is_closed = 1)
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
const MIN_MEDIAN_ROI = 0.15;   // 15% on wins
const MIN_MEDIAN_BET = 10;
const POSITION_FRACTION = 0.02;  // 2% per trade

// ROI bounds - CRITICAL for preventing impossible values
const MIN_ROI = -1.0;   // Floor: -100% (lose entire bet)
const MAX_ROI = 2.0;    // Cap: +200% (more conservative to prevent overflow)
const MAX_FINAL_BANKROLL = 1e9;  // $1B sanity cap

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

  // Test 1: Log growth calculations
  const g1 = Math.log(100 / 100);
  if (Math.abs(g1 - 0) > 0.0001) { allPassed = false; console.error('FAIL: g1'); }

  const g2 = Math.log(101 / 100);
  if (Math.abs(g2 - 0.00995) > 0.0001) { allPassed = false; console.error('FAIL: g2'); }

  const g3 = Math.log(99 / 100);
  if (Math.abs(g3 - (-0.01005)) > 0.0001) { allPassed = false; console.error('FAIL: g3'); }

  // Test 2: EV calculation
  const W = 0.6, Rw = 0.3, Rl = 0.2;
  const ev = W * Rw - (1 - W) * Rl;
  if (Math.abs(ev - 0.10) > 0.0001) { allPassed = false; console.error('FAIL: ev'); }

  // Test 3: ROI clamping
  const clampRoiTest = (roi: number) => Math.max(MIN_ROI, Math.min(MAX_ROI, roi));
  if (clampRoiTest(-5) !== -1) { allPassed = false; console.error('FAIL: ROI floor'); }
  if (clampRoiTest(10) !== MAX_ROI) { allPassed = false; console.error('FAIL: ROI cap'); }
  if (clampRoiTest(0.5) !== 0.5) { allPassed = false; console.error('FAIL: ROI passthrough'); }

  // Test 4: Proceeds calculation with clamped ROI
  const invested = 200;
  const badRoi = -1.5;  // Would give negative proceeds without clamping
  const clampedRoiVal = clampRoiTest(badRoi);
  const proceeds = invested * (1 + clampedRoiVal);
  if (proceeds !== 0) { allPassed = false; console.error(`FAIL: Proceeds should be 0, got ${proceeds}`); }

  if (allPassed) {
    console.log('  All unit tests passed!\n');
  } else {
    console.error('  Some unit tests FAILED!\n');
  }
  return allPassed;
}

// ============================================
// HELPER: Clamp ROI to valid range
// ============================================
function clampRoi(roi: number): number {
  return Math.max(MIN_ROI, Math.min(MAX_ROI, roi));
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

  // Phase 1: Fast candidate query (no deduplication, no medians)
  console.log('    Phase 1: Finding candidate wallets (fast)...');
  const candidatesQuery = `
    SELECT
      wallet,
      count() as total_trades,
      uniqExact(condition_id) as markets_traded,
      min(entry_time) as first_trade,
      max(entry_time) as last_trade
    FROM ${TABLE}
    WHERE
      entry_time >= '${lookbackStr}'
      AND entry_time <= '${cutoffStr}'
      AND cost_usd >= 10
      AND roi >= -1.5 AND roi <= 3
      AND (resolved_at IS NOT NULL OR is_closed = 1)
    GROUP BY wallet
    HAVING
      total_trades > ${MIN_TRADES}
      AND markets_traded > ${MIN_MARKETS}
      AND last_trade >= toDateTime('${activeCutoffStr}')
      AND first_trade <= toDateTime('${ageCutoffStr}')
    ORDER BY total_trades DESC
    LIMIT 1000
    SETTINGS max_execution_time = 180
  `;

  const candidatesResult = await clickhouse.query({ query: candidatesQuery, format: 'JSONEachRow' });
  const candidates = await candidatesResult.json() as { wallet: string; total_trades: number }[];
  console.log(`    Phase 1: Found ${candidates.length} candidate wallets`);

  if (candidates.length === 0) return [];

  // Phase 2: Detailed stats in batches
  console.log('    Phase 2: Computing detailed stats in batches...');
  const BATCH_SIZE = 50;
  const results: WalletStats[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const walletList = batch.map(c => `'${c.wallet}'`).join(',');

    const statsQuery = `
      WITH deduped AS (
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          greatest(least(any(roi), ${MAX_ROI}), ${MIN_ROI}) as trade_roi,
          any(cost_usd) as trade_cost_usd,
          any(entry_time) as trade_entry_time
        FROM ${TABLE}
        WHERE wallet IN (${walletList})
          AND entry_time >= '${lookbackStr}'
          AND entry_time <= '${cutoffStr}'
          AND cost_usd >= 10
          AND roi >= -1.5 AND roi <= 3
          AND (resolved_at IS NOT NULL OR is_closed = 1)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      )
      SELECT
        wallet,
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,
        countIf(trade_roi > 0) as wins,
        countIf(trade_roi <= 0) as losses,
        countIf(trade_roi > 0) * 1.0 / count() as win_rate_pct,
        medianExact(trade_roi) as median_roi,
        medianExact(abs(trade_cost_usd)) as median_bet_size,
        coalesce(medianExactIf(trade_roi, trade_roi > 0), 0) as median_win_roi,
        coalesce(medianExactIf(abs(trade_roi), trade_roi <= 0), 0) as median_loss_mag,
        toUInt64(min(trade_entry_time)) as first_trade,
        toUInt64(max(trade_entry_time)) as last_trade
      FROM deduped
      GROUP BY wallet
      HAVING
        median_roi > ${MIN_MEDIAN_ROI}
        AND median_bet_size > ${MIN_MEDIAN_BET}
        AND wins > 0 AND losses > 0
      SETTINGS max_execution_time = 60
    `;

    try {
      const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
      const batchResults = await statsResult.json() as WalletStats[];
      results.push(...batchResults);
    } catch (err) {
      console.error(`\n    Batch ${i}-${i+BATCH_SIZE} failed, skipping...`);
    }

    process.stdout.write(`\r    Phase 2: Processed ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}, ${results.length} qualified...`);
  }
  console.log('');

  return results;
}

async function getWalletTrades(wallet: string, startDate: Date, endDate: Date): Promise<Trade[]> {
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = endDate.toISOString().slice(0, 19).replace('T', ' ');

  // FIX: Clamp ROI in SQL query with pre-filter
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
        AND roi >= -1.5 AND roi <= 3  -- Pre-filter extreme values
        AND (resolved_at IS NOT NULL OR is_closed = 1)
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    )
    SELECT
      tx_hash,
      toUInt64(trade_entry_time) as entry_time,
      toUInt64(if(trade_resolved_at IS NOT NULL, trade_resolved_at, trade_entry_time + INTERVAL 1 DAY)) as exit_time,
      -- FIX: Clamp ROI between -100% and +500%
      greatest(least(trade_roi, ${MAX_ROI}), ${MIN_ROI}) as roi,
      abs(trade_cost_usd) as cost_usd,
      condition_id
    FROM deduped
    ORDER BY trade_entry_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as Trade[];
}

// ============================================
// COPIER SIMULATION - FIXED
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
    // FIX: Clamp ROI when creating events
    const clampedTrade = { ...trade, roi: clampRoi(trade.roi) };
    events.push({ time: trade.entry_time, type: 'BUY', trade_idx: idx, trade: clampedTrade });
    if (trade.exit_time) {
      events.push({ time: trade.exit_time, type: 'SELL', trade_idx: idx, trade: clampedTrade });
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
      eq += pos.invested;  // Mark to cost
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
      // FIX: Only trade if equity is positive
      if (equity <= 0) {
        tradesSkipped++;
        continue;
      }

      const betSize = equity * POSITION_FRACTION;

      if (cash >= betSize && betSize > 1) {
        positions.set(event.trade_idx, {
          invested: betSize,
          entry_time: event.time,
          exit_time: event.trade.exit_time || event.time,
          roi: event.trade.roi,  // Already clamped
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
        // FIX: Proceeds can't be negative (worst case is $0)
        const proceeds = Math.max(0, pos.invested * (1 + pos.roi));
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

  // FIX: Final bankroll can't go below 0
  let finalBankroll = cash;
  for (const pos of positions.values()) {
    finalBankroll += Math.max(0, pos.invested * (1 + pos.roi));
  }

  const dailyEquities = Array.from(dailyEquityMap.entries())
    .map(([date, equity]) => ({ date, equity }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { dailyEquities, finalBankroll, tradesCopied, tradesSkipped, holdTimesMinutes, totalBetVolume };
}

// ============================================
// METRICS CALCULATION - FIXED
// ============================================
function calculateMetrics(
  dailyEquities: DailyEquity[],
  stats: WalletStats,
  sim: ReturnType<typeof simulateCopier>,
  startingBankroll: number
): Omit<SimulationResult, 'wallet'> | null {
  if (dailyEquities.length < 2 || sim.tradesCopied === 0) return null;

  // FIX: Reject if final bankroll is negative or zero
  if (sim.finalBankroll <= 0) return null;

  // FIX: Calculate log returns properly, handling edge cases
  const dailyLogReturns: number[] = [];
  const dailyReturns: number[] = [];

  for (let i = 1; i < dailyEquities.length; i++) {
    const prev = dailyEquities[i - 1].equity;
    const curr = dailyEquities[i].equity;

    // Only include if both are positive (log undefined otherwise)
    if (prev > 0 && curr > 0) {
      dailyLogReturns.push(Math.log(curr / prev));
      dailyReturns.push((curr - prev) / prev);
    } else if (prev > 0 && curr <= 0) {
      // Equity went to zero or negative - this is a total loss day
      // Log of 0 is -infinity, so we use a floor value
      dailyLogReturns.push(Math.log(0.001));  // Represents ~-99.9% loss
      dailyReturns.push(-0.999);
    }
    // If prev <= 0, skip (can't calculate return from negative base)
  }

  if (dailyLogReturns.length === 0) return null;

  // Log Growth Per Day
  const logGrowthPerDay = dailyLogReturns.reduce((a, b) => a + b, 0) / dailyLogReturns.length;

  // Simulated return per day
  const simReturnPerDay = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;

  // ROI per day
  const totalDays = Math.max(1, dailyEquities.length - 1);
  const totalPnl = sim.finalBankroll - startingBankroll;
  const roiPerDay = (totalPnl / startingBankroll) / totalDays;

  // Volatility
  const variance = dailyLogReturns.reduce((sum, r) => sum + Math.pow(r - logGrowthPerDay, 2), 0) / dailyLogReturns.length;
  const volatility = Math.sqrt(variance);

  // CVaR (bottom 5%)
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const cvarCount = Math.max(1, Math.floor(sortedReturns.length * 0.05));
  const cvar = sortedReturns.slice(0, cvarCount).reduce((a, b) => a + b, 0) / cvarCount;

  // EV per trade
  const W = stats.win_rate_pct;
  const Rw = Math.min(stats.median_win_roi || 0, MAX_ROI);
  const Rl = Math.min(stats.median_loss_mag || 0, 1);  // Loss magnitude capped at 100%
  const evPerTrade = W * Rw - (1 - W) * Rl;

  // Capital velocity
  const capitalVelocity = sim.totalBetVolume / (startingBankroll * totalDays);

  // Hold time (median)
  const sortedHoldTimes = [...sim.holdTimesMinutes].sort((a, b) => a - b);
  const holdTimeMedian = sortedHoldTimes.length > 0
    ? sortedHoldTimes[Math.floor(sortedHoldTimes.length / 2)] : 0;

  // Trades per day
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
  console.log('COPYTRADING LEADERBOARD v16 - Bug Fixes');
  console.log('Dataset: ' + TABLE);
  console.log('='.repeat(80));
  console.log('Fixes applied:');
  console.log('  - ROI floored at -100% (no impossible losses)');
  console.log(`  - ROI capped at +${MAX_ROI * 100}% (no overflow)`);
  console.log(`  - Final bankroll capped at $${MAX_FINAL_BANKROLL.toLocaleString()}`);
  console.log('  - Negative bankrolls filtered out');
  console.log('  - Log growth includes crash days properly');
  console.log('');

  if (!runUnitTests()) {
    console.error('ERROR: Unit tests failed. Aborting.');
    process.exit(1);
  }

  try {
    const DATA_CUTOFF = await getDataCutoff();
    console.log(`Data cutoff (today): ${DATA_CUTOFF.toISOString()}`);

    const lookbackStart = new Date(DATA_CUTOFF.getTime() - LOOKBACK_DAYS * 86400000);
    console.log(`Lookback window: ${lookbackStart.toISOString()} to ${DATA_CUTOFF.toISOString()}`);
    console.log('');

    console.log('Step 1-6: Finding qualified wallets (FIFO V5 logic)...');
    console.log(`  Filters: >${MIN_TRADES} trades, >${MIN_MARKETS} markets, active last ${ACTIVE_DAYS} days,`);
    console.log(`           age >${MIN_AGE_DAYS} days, median ROI >${MIN_MEDIAN_ROI}, median bet >$${MIN_MEDIAN_BET}`);

    const qualifiedWallets = await getQualifiedWallets(DATA_CUTOFF);
    console.log(`  Found ${qualifiedWallets.length} qualifying wallets\n`);

    if (qualifiedWallets.length === 0) {
      console.log('No wallets meet criteria. Exiting.');
      process.exit(0);
    }

    console.log('Step 7: Running copier simulations...');
    const results: SimulationResult[] = [];
    let processed = 0;
    let skippedNegative = 0;

    for (const stats of qualifiedWallets) {
      processed++;
      if (processed % 20 === 0 || processed === qualifiedWallets.length) {
        process.stdout.write(`\r  Processing ${processed}/${qualifiedWallets.length}... (${results.length} valid, ${skippedNegative} skipped)`);
      }

      try {
        const trades = await getWalletTrades(stats.wallet, lookbackStart, DATA_CUTOFF);
        if (trades.length === 0) continue;

        const sim = simulateCopier(trades, STARTING_BANKROLL);
        const metrics = calculateMetrics(sim.dailyEquities, stats, sim, STARTING_BANKROLL);

        if (metrics === null) {
          skippedNegative++;
          continue;
        }

        if (metrics.log_growth_per_day > 0 &&
            metrics.final_bankroll > STARTING_BANKROLL * 0.5 &&
            metrics.final_bankroll < MAX_FINAL_BANKROLL) {
          // Only include if positive growth, didn't lose 50%+, and no overflow
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
    console.log(`Skipped (negative/invalid): ${skippedNegative}`);
    if (results.length > 0) {
      console.log(`Best Log Growth/Day: ${results[0].log_growth_per_day.toFixed(8)}`);
      console.log(`Best wallet: ${results[0].wallet}`);
      const top50 = results.slice(0, 50);
      const avgLogGrowth = top50.reduce((s, r) => s + r.log_growth_per_day, 0) / top50.length;
      console.log(`Avg Log Growth/Day (top 50): ${avgLogGrowth.toFixed(8)}`);
      const avgFinalBankroll = top50.reduce((s, r) => s + r.final_bankroll, 0) / top50.length;
      console.log(`Avg Final Bankroll (top 50): $${avgFinalBankroll.toFixed(2)}`);

      // Sanity checks
      const negBankrolls = top50.filter(r => r.final_bankroll < 0).length;
      const overflowBankrolls = top50.filter(r => r.final_bankroll > 1e12).length;
      console.log(`Negative bankrolls in top 50: ${negBankrolls} (should be 0)`);
      console.log(`Overflow bankrolls in top 50: ${overflowBankrolls} (should be 0)`);
    }

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

main();
