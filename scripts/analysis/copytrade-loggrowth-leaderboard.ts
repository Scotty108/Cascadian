#!/usr/bin/env npx tsx
import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Copytrade Log Growth Per Day Leaderboard
 *
 * Simulates copytrading performance using pm_trade_fifo_roi_v3_mat_unified
 * Ranks wallets by Log Growth per Day using FIFO V5 logic
 *
 * Filters:
 * - >50 trades
 * - >8 distinct markets
 * - ≥1 trade in last 5 days
 * - First trade >4 days ago
 * - Median ROI >0.15 (15%)
 * - Median bet size >$10
 *
 * Simulation:
 * - Start with $10,000 bankroll
 * - Percent scaling: bet_d = bankroll_{d-1} × 2%
 * - Process trades daily in chronological order
 * - g_d = ln(E_d / E_{d-1})
 * - LogGrowthPerDay = mean(g_d) over scoring window
 *
 * Walk-Forward Validation:
 * - Rolling lookback and forward windows
 * - Evaluates predictive value of rankings
 *
 * Output: CSV with top 50 wallets by log_growth_per_day
 */

import { getClickHouseClient } from "../../lib/clickhouse/client";
import type { ClickHouseClient } from "@clickhouse/client";

// ============ CONFIGURATION ============
const CONFIG = {
  // Wallet filters (from spec)
  MIN_TRADES: 50,
  MIN_MARKETS: 8,
  ACTIVITY_DAYS: 5,       // Must have trade in last N days
  MIN_WALLET_AGE_DAYS: 4, // First trade must be >N days ago
  MIN_MEDIAN_ROI: 0.15,   // Decimal (15%)
  MIN_MEDIAN_BET: 10,     // $10 minimum median bet
  MIN_COST_USD: 10,       // Minimum trade size to consider

  // Simulation parameters
  INITIAL_BANKROLL: 10000,
  BET_FRACTION: 0.02,     // 2% of bankroll per trade

  // Walk-forward parameters
  LOOKBACK_DAYS: 30,      // Training window
  FORWARD_DAYS: 7,        // Test window
  SCORING_WINDOW_DAYS: 30, // Final scoring window

  // Output
  TOP_N: 50,
};

interface Trade {
  tx_hash: string;
  wallet: string;
  condition_id: string;
  outcome_index: number;
  entry_time: Date;
  resolved_at: Date | null;
  cost_usd: number;
  pnl_usd: number;
  roi: number;
  is_closed: number;
}

interface DailyResult {
  date: string;
  trades: Trade[];
  bankroll_start: number;
  bankroll_end: number;
  pnl: number;
  log_growth: number;
}

interface SimulationOutput {
  dailyResults: DailyResult[];
  finalBankroll: number;
  tradesCopied: number;
  tradesSkipped: number;
}

interface SimulationResult {
  wallet: string;
  log_growth_per_day: number;
  log_growth_per_trade: number;
  simulated_copytrade_return_per_day: number;
  roi_per_day: number;
  win_rate_percent: number;
  median_roi_percent: number;
  trades_per_day: number;
  ev_per_trade: number;
  volatility: number;
  cvar: number;
  hold_time_per_trade_minutes: number;
  final_bankroll: number;
  trades_copied: number;
  trades_skipped: number;
  date_of_last_trade: string;
}

// ============ UTILITY FUNCTIONS ============

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squareDiffs = arr.map(x => Math.pow(x - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function cvar(arr: number[], percentile: number = 0.05): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * percentile));
  const tail = sorted.slice(0, cutoff);
  return mean(tail);
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ============ UNIT TESTS ============

function runUnitTests(): boolean {
  console.error("Running unit tests...");
  let passed = true;
  const tests: { name: string; pass: boolean }[] = [];

  // Test 1: Log growth for unchanged bankroll
  const g1 = Math.log(10000 / 10000);
  const t1 = Math.abs(g1 - 0) < 0.0001;
  tests.push({ name: "Unchanged bankroll g_d = 0", pass: t1 });
  if (!t1) console.error("FAIL: Unchanged bankroll should have g_d = 0, got", g1);

  // Test 2: +1% bankroll → g_d ≈ 0.00995
  const g2 = Math.log(10100 / 10000);
  const t2 = Math.abs(g2 - 0.00995) < 0.0001;
  tests.push({ name: "+1% bankroll → g_d ≈ 0.00995", pass: t2 });
  if (!t2) console.error("FAIL: +1% should give g_d ≈ 0.00995, got", g2);

  // Test 3: -1% bankroll → g_d ≈ -0.01005
  const g3 = Math.log(9900 / 10000);
  const t3 = Math.abs(g3 - (-0.01005)) < 0.0001;
  tests.push({ name: "-1% bankroll → g_d ≈ -0.01005", pass: t3 });
  if (!t3) console.error("FAIL: -1% should give g_d ≈ -0.01005, got", g3);

  // Test 4: Median (odd count)
  const m1 = median([1, 3, 5, 7, 9]);
  const t4 = m1 === 5;
  tests.push({ name: "Median [1,3,5,7,9] = 5", pass: t4 });
  if (!t4) console.error("FAIL: Median should be 5, got", m1);

  // Test 5: Median (even count)
  const m2 = median([1, 2, 3, 4]);
  const t5 = m2 === 2.5;
  tests.push({ name: "Median [1,2,3,4] = 2.5", pass: t5 });
  if (!t5) console.error("FAIL: Median should be 2.5, got", m2);

  // Test 6: Win rate calculation
  const wins = [0.1, 0.2, -0.05, 0.3, -0.1];
  const winRate = wins.filter(r => r > 0).length / wins.length;
  const t6 = Math.abs(winRate - 0.6) < 0.0001;
  tests.push({ name: "Win rate 3/5 = 0.6", pass: t6 });
  if (!t6) console.error("FAIL: Win rate should be 0.6, got", winRate);

  // Test 7: EV per trade formula
  // EV = W × Rw - (1-W) × Rl
  const W = 0.6;
  const Rw = mean([0.1, 0.2, 0.3]); // 0.2
  const Rl = Math.abs(mean([-0.05, -0.1])); // 0.075
  const ev = W * Rw - (1 - W) * Rl;
  // 0.6 * 0.2 - 0.4 * 0.075 = 0.12 - 0.03 = 0.09
  const t7 = Math.abs(ev - 0.09) < 0.0001;
  tests.push({ name: "EV = 0.6*0.2 - 0.4*0.075 = 0.09", pass: t7 });
  if (!t7) console.error("FAIL: EV should be 0.09, got", ev);

  // Test 8: CVaR (bottom 5% of 20 = 1 element)
  const returns = [-0.1, -0.08, -0.05, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07,
                   0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17];
  const cvarVal = cvar(returns, 0.05);
  const t8 = Math.abs(cvarVal - (-0.1)) < 0.0001;
  tests.push({ name: "CVaR bottom 5% of 20 = -0.1", pass: t8 });
  if (!t8) console.error("FAIL: CVaR should be -0.1, got", cvarVal);

  // Test 9: Mean calculation
  const meanVal = mean([10, 20, 30]);
  const t9 = meanVal === 20;
  tests.push({ name: "Mean [10,20,30] = 20", pass: t9 });
  if (!t9) console.error("FAIL: Mean should be 20, got", meanVal);

  // Test 10: Std dev calculation
  const sdArr = [2, 4, 4, 4, 5, 5, 7, 9]; // mean = 5, variance = 4, stddev = 2
  const sdVal = stdDev(sdArr);
  const t10 = Math.abs(sdVal - 2) < 0.01;
  tests.push({ name: "StdDev of [2,4,4,4,5,5,7,9] = 2", pass: t10 });
  if (!t10) console.error("FAIL: StdDev should be 2, got", sdVal);

  passed = tests.every(t => t.pass);

  if (passed) {
    console.error(`All ${tests.length} unit tests passed ✓\n`);
  } else {
    const failCount = tests.filter(t => !t.pass).length;
    console.error(`\n${failCount}/${tests.length} tests FAILED\n`);
  }

  return passed;
}

// ============ DATABASE CLIENT ============

// Use the shared ClickHouse client from lib

// ============ DATA LOADING ============

async function getLatestTimestamp(client: ClickHouseClient): Promise<Date> {
  const result = await client.query({
    query: `SELECT max(entry_time) as latest FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ latest: string }>();
  return new Date(rows[0].latest);
}

async function loadCandidateWallets(
  client: ClickHouseClient,
  latestDate: Date
): Promise<string[]> {
  const activityCutoff = new Date(latestDate);
  activityCutoff.setDate(activityCutoff.getDate() - CONFIG.ACTIVITY_DAYS);

  console.error(`Loading candidate wallets...`);
  console.error(`  Must be active after: ${formatDateOnly(activityCutoff)}`);

  // Step 1: Get wallets with >50 trades in last 7 days (simpler query to avoid memory issues)
  const step1Query = `
    SELECT
      wallet,
      count() as trade_count,
      max(entry_time) as last_trade
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE entry_time >= toDateTime('${activityCutoff.toISOString().slice(0, 19)}') - INTERVAL 7 DAY
      AND cost_usd >= ${CONFIG.MIN_COST_USD}
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND wallet != '0x0000000000000000000000000000000000000000'
    GROUP BY wallet
    HAVING
      trade_count BETWEEN ${CONFIG.MIN_TRADES + 1} AND 5000
      AND last_trade >= toDateTime('${activityCutoff.toISOString().slice(0, 19)}')
    ORDER BY trade_count DESC
    LIMIT 500
  `;

  const result1 = await client.query({ query: step1Query, format: "JSONEachRow" });
  const step1Wallets = await result1.json<{ wallet: string; trade_count: number }>();

  console.error(`  Step 1: Found ${step1Wallets.length} wallets with >50 trades`);

  if (step1Wallets.length === 0) {
    return [];
  }

  // Step 2: Filter for >8 markets and ROI/bet filters (process in batches)
  const validWallets: string[] = [];
  const batchSize = 20;

  for (let i = 0; i < step1Wallets.length; i += batchSize) {
    const batch = step1Wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w.wallet}'`).join(",");

    const step2Query = `
      SELECT
        wallet,
        uniqExact(condition_id) as markets,
        medianExactIf(roi, roi > 0) as median_win_roi,
        medianExact(cost_usd) as median_bet
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= toDateTime('${activityCutoff.toISOString().slice(0, 19)}') - INTERVAL 7 DAY
        AND cost_usd >= ${CONFIG.MIN_COST_USD}
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND wallet IN (${walletList})
      GROUP BY wallet
      HAVING
        markets > ${CONFIG.MIN_MARKETS}
        AND median_win_roi > ${CONFIG.MIN_MEDIAN_ROI}
        AND median_bet > ${CONFIG.MIN_MEDIAN_BET}
    `;

    try {
      const result2 = await client.query({ query: step2Query, format: "JSONEachRow" });
      const qualified = await result2.json<{ wallet: string }>();
      validWallets.push(...qualified.map(w => w.wallet));
    } catch (err) {
      console.error(`  Batch ${i / batchSize + 1} error: ${err}`);
    }
  }

  console.error(`  Step 2: ${validWallets.length} wallets pass all filters\n`);
  return validWallets;
}

async function loadWalletTrades(
  client: ClickHouseClient,
  wallet: string,
  startDate: Date,
  endDate: Date
): Promise<Trade[]> {
  // ALWAYS DEDUPE using GROUP BY tx_hash, wallet, condition_id, outcome_index
  // Use different alias names to avoid ClickHouse confusion with column names
  const query = `
    WITH deduped AS (
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as trade_entry_time,
        any(resolved_at) as trade_resolved_at,
        any(cost_usd) as trade_cost_usd,
        any(pnl_usd) as trade_pnl_usd,
        any(roi) as trade_roi,
        any(is_closed) as trade_is_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet = {wallet:String}
        AND entry_time >= toDateTime({startDate:String})
        AND entry_time <= toDateTime({endDate:String})
        AND cost_usd >= ${CONFIG.MIN_COST_USD}
        AND (resolved_at IS NOT NULL OR is_closed = 1)
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    )
    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      trade_entry_time as entry_time,
      trade_resolved_at as resolved_at,
      trade_cost_usd as cost_usd,
      trade_pnl_usd as pnl_usd,
      trade_roi as roi,
      trade_is_closed as is_closed
    FROM deduped
    ORDER BY trade_entry_time ASC
  `;

  const result = await client.query({
    query,
    format: "JSONEachRow",
    query_params: {
      wallet,
      startDate: startDate.toISOString().slice(0, 19),
      endDate: endDate.toISOString().slice(0, 19),
    },
  });
  const rows = await result.json<any>();

  return rows.map((r: any) => ({
    tx_hash: r.tx_hash,
    wallet: r.wallet,
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    entry_time: new Date(r.entry_time),
    resolved_at: r.resolved_at ? new Date(r.resolved_at) : null,
    cost_usd: Number(r.cost_usd),
    pnl_usd: Number(r.pnl_usd),
    roi: Number(r.roi),
    is_closed: Number(r.is_closed),
  }));
}

// ============ SIMULATION (FIFO V5 Logic) ============

function simulateCopytrading(trades: Trade[], initialBankroll: number): SimulationOutput {
  if (trades.length === 0) {
    return { dailyResults: [], finalBankroll: initialBankroll, tradesCopied: 0, tradesSkipped: 0 };
  }

  // Group trades by date
  const tradesByDate = new Map<string, Trade[]>();
  for (const trade of trades) {
    const dateKey = formatDateOnly(trade.entry_time);
    if (!tradesByDate.has(dateKey)) {
      tradesByDate.set(dateKey, []);
    }
    tradesByDate.get(dateKey)!.push(trade);
  }

  // Sort dates chronologically
  const dates = Array.from(tradesByDate.keys()).sort();

  let bankroll = initialBankroll;
  const dailyResults: DailyResult[] = [];
  let tradesCopied = 0;
  let tradesSkipped = 0;

  for (const dateKey of dates) {
    const dayTrades = tradesByDate.get(dateKey)!;
    const bankrollStart = bankroll;
    let dayPnl = 0;

    for (const trade of dayTrades) {
      // Percent scaling: bet = prior bankroll × fraction
      const betSize = bankrollStart * CONFIG.BET_FRACTION;

      // Skip if bet would be too small or bankroll depleted
      if (betSize < 1 || bankroll <= 0) {
        tradesSkipped++;
        continue;
      }

      // FIFO V5 logic: pnl = bet_size × roi
      // The roi already incorporates the FIFO matching from the source table
      const tradePnl = betSize * trade.roi;
      dayPnl += tradePnl;
      tradesCopied++;
    }

    const bankrollEnd = bankrollStart + dayPnl;

    // g_d = ln(E_d / E_{d-1})
    const logGrowth =
      bankrollEnd > 0 && bankrollStart > 0
        ? Math.log(bankrollEnd / bankrollStart)
        : 0;

    dailyResults.push({
      date: dateKey,
      trades: dayTrades,
      bankroll_start: bankrollStart,
      bankroll_end: bankrollEnd,
      pnl: dayPnl,
      log_growth: logGrowth,
    });

    bankroll = Math.max(0, bankrollEnd);
  }

  return { dailyResults, finalBankroll: bankroll, tradesCopied, tradesSkipped };
}

// ============ METRICS CALCULATION ============

function calculateMetrics(
  wallet: string,
  trades: Trade[],
  dailyResults: DailyResult[],
  finalBankroll: number,
  tradesCopied: number,
  tradesSkipped: number
): SimulationResult {
  // LogGrowthPerDay = mean of all g_d values
  const logGrowths = dailyResults.map(d => d.log_growth);
  const logGrowthPerDay = mean(logGrowths);

  // LogGrowthPerTrade = ln(B_T / B_0) / num_trades
  const logGrowthPerTrade = tradesCopied > 0 && finalBankroll > 0
    ? Math.log(finalBankroll / CONFIG.INITIAL_BANKROLL) / tradesCopied
    : 0;

  // Simulated copytrade return per day (arithmetic mean of daily percent changes)
  const dailyReturns = dailyResults.map(d => d.pnl / d.bankroll_start);
  const simReturnPerDay = mean(dailyReturns);

  // ROI per day: total PnL / initial bankroll / number of days
  const totalDays = dailyResults.length;
  const totalPnl = dailyResults.reduce((sum, d) => sum + d.pnl, 0);
  const roiPerDay = totalDays > 0 ? totalPnl / CONFIG.INITIAL_BANKROLL / totalDays : 0;

  // Win rate: % of trades with ROI > 0
  const winningTrades = trades.filter(t => t.roi > 0);
  const winRatePercent = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

  // Median ROI: median of ROI values where ROI > 0 (wins only), as percentage
  const winningRois = winningTrades.map(t => t.roi);
  const medianRoiPercent = median(winningRois) * 100;

  // Trades per day
  const tradesPerDay = totalDays > 0 ? tradesCopied / totalDays : 0;

  // EV per trade: W × Rw - (1-W) × Rl
  const W = winRatePercent / 100;
  const Rw = winningRois.length > 0 ? mean(winningRois) : 0;
  const losingTrades = trades.filter(t => t.roi <= 0);
  const losingRois = losingTrades.map(t => Math.abs(t.roi));
  const Rl = losingRois.length > 0 ? mean(losingRois) : 0;
  const evPerTrade = W * Rw - (1 - W) * Rl;

  // Volatility: std dev of daily log returns (g_d values)
  const volatility = stdDev(logGrowths);

  // CVaR: mean of lowest 5% of daily simulated copier returns
  const cvarValue = cvar(dailyReturns, 0.05);

  // Hold time: median time from entry to resolution (in minutes)
  const holdTimes: number[] = [];
  for (const trade of trades) {
    if (trade.resolved_at) {
      const holdMinutes = (trade.resolved_at.getTime() - trade.entry_time.getTime()) / 60000;
      if (holdMinutes > 0 && holdMinutes < 525600 * 5) {
        // Max 5 years sanity check
        holdTimes.push(holdMinutes);
      }
    }
  }
  const holdTimeMedian = median(holdTimes);

  // Last trade date
  const lastTrade = trades.length > 0
    ? trades.reduce((latest, t) => (t.entry_time > latest.entry_time ? t : latest))
    : null;

  return {
    wallet,
    log_growth_per_day: logGrowthPerDay,
    log_growth_per_trade: logGrowthPerTrade,
    simulated_copytrade_return_per_day: simReturnPerDay,
    roi_per_day: roiPerDay,
    win_rate_percent: winRatePercent,
    median_roi_percent: medianRoiPercent,
    trades_per_day: tradesPerDay,
    ev_per_trade: evPerTrade,
    volatility,
    cvar: cvarValue,
    hold_time_per_trade_minutes: holdTimeMedian,
    final_bankroll: finalBankroll,
    trades_copied: tradesCopied,
    trades_skipped: tradesSkipped,
    date_of_last_trade: lastTrade ? formatDate(lastTrade.entry_time) : "null",
  };
}

// ============ WALK-FORWARD VALIDATION ============

interface WalkForwardResult {
  wallet: string;
  lookback_log_growth: number;
  forward_log_growth: number;
  forward_final_bankroll: number;
  forward_trades_copied: number;
}

async function runWalkForward(
  client: ClickHouseClient,
  wallet: string,
  latestDate: Date
): Promise<WalkForwardResult | null> {
  // Define windows
  const forwardEnd = latestDate;
  const forwardStart = new Date(latestDate);
  forwardStart.setDate(forwardStart.getDate() - CONFIG.FORWARD_DAYS);

  const lookbackEnd = new Date(forwardStart);
  lookbackEnd.setDate(lookbackEnd.getDate() - 1);
  const lookbackStart = new Date(lookbackEnd);
  lookbackStart.setDate(lookbackStart.getDate() - CONFIG.LOOKBACK_DAYS);

  // Load trades for both windows
  const [lookbackTrades, forwardTrades] = await Promise.all([
    loadWalletTrades(client, wallet, lookbackStart, lookbackEnd),
    loadWalletTrades(client, wallet, forwardStart, forwardEnd),
  ]);

  if (lookbackTrades.length < 5 || forwardTrades.length < 1) {
    return null;
  }

  // Simulate both windows
  const lookbackSim = simulateCopytrading(lookbackTrades, CONFIG.INITIAL_BANKROLL);
  const forwardSim = simulateCopytrading(forwardTrades, CONFIG.INITIAL_BANKROLL);

  if (lookbackSim.dailyResults.length === 0) {
    return null;
  }

  const lookbackLogGrowth = mean(lookbackSim.dailyResults.map(d => d.log_growth));
  const forwardLogGrowth =
    forwardSim.dailyResults.length > 0
      ? mean(forwardSim.dailyResults.map(d => d.log_growth))
      : 0;

  return {
    wallet,
    lookback_log_growth: lookbackLogGrowth,
    forward_log_growth: forwardLogGrowth,
    forward_final_bankroll: forwardSim.finalBankroll,
    forward_trades_copied: forwardSim.tradesCopied,
  };
}

// ============ MAIN EXECUTION ============

async function main() {
  console.error("=== Copytrade Log Growth Per Day Leaderboard ===\n");

  // Run unit tests first
  if (!runUnitTests()) {
    console.error("Unit tests failed. Halting.");
    process.exit(1);
  }

  const client = getClickHouseClient();

  try {
    // Get latest timestamp as "today"
    const latestDate = await getLatestTimestamp(client);
    console.error(`Latest data timestamp: ${formatDate(latestDate)}`);

    // Calculate scoring window
    const windowStart = new Date(latestDate);
    windowStart.setDate(windowStart.getDate() - CONFIG.SCORING_WINDOW_DAYS);
    console.error(`Scoring window: ${formatDateOnly(windowStart)} to ${formatDateOnly(latestDate)}\n`);

    // Load candidate wallets matching filters
    const candidateWallets = await loadCandidateWallets(client, latestDate);

    if (candidateWallets.length === 0) {
      console.error("No candidate wallets found matching filters. Halting.");
      process.exit(1);
    }

    // Process each wallet
    console.error(`Processing ${candidateWallets.length} wallets...\n`);
    const results: SimulationResult[] = [];
    const walkForwardResults: WalkForwardResult[] = [];
    let processed = 0;

    for (const wallet of candidateWallets) {
      try {
        // Load trades for scoring window
        const trades = await loadWalletTrades(client, wallet, windowStart, latestDate);

        // Re-check trade count in window (may differ from historical count)
        if (trades.length < CONFIG.MIN_TRADES) {
          continue;
        }

        // Simulate copytrading with percent scaling
        const { dailyResults, finalBankroll, tradesCopied, tradesSkipped } = simulateCopytrading(
          trades,
          CONFIG.INITIAL_BANKROLL
        );

        // Need at least 3 days of data for meaningful metrics
        if (dailyResults.length < 3) {
          continue;
        }

        // Calculate all metrics
        const metrics = calculateMetrics(
          wallet,
          trades,
          dailyResults,
          finalBankroll,
          tradesCopied,
          tradesSkipped
        );

        // Filter: must have positive log growth
        if (metrics.log_growth_per_day > 0) {
          results.push(metrics);

          // Run walk-forward validation for qualifying wallets
          const wf = await runWalkForward(client, wallet, latestDate);
          if (wf) {
            walkForwardResults.push(wf);
          }
        }

        processed++;
        if (processed % 100 === 0) {
          console.error(`  Processed ${processed}/${candidateWallets.length}, ${results.length} qualified`);
        }
      } catch (err) {
        console.error(`  Error processing ${wallet}: ${err}`);
      }
    }

    console.error(`\nProcessed ${processed} wallets, ${results.length} qualified with positive log growth\n`);

    // Walk-forward summary
    if (walkForwardResults.length > 0) {
      const positiveLookback = walkForwardResults.filter(r => r.lookback_log_growth > 0);
      const posForward = positiveLookback.filter(r => r.forward_log_growth > 0);
      const hitRate = positiveLookback.length > 0 ? (posForward.length / positiveLookback.length) * 100 : 0;

      console.error("=== Walk-Forward Validation Summary ===");
      console.error(`  Wallets with positive lookback: ${positiveLookback.length}`);
      console.error(`  Wallets with positive forward: ${posForward.length}`);
      console.error(`  Predictive hit rate: ${hitRate.toFixed(1)}%\n`);
    }

    // Helper to format numbers (handles NaN, Infinity, etc.)
    const fmt = (val: number, decimals: number = 6): string => {
      if (!isFinite(val) || isNaN(val)) return "null";
      return val.toFixed(decimals);
    };

    // Helper function to output a leaderboard
    const outputLeaderboard = (
      sortedResults: SimulationResult[],
      rankingMetric: "log_growth_per_day" | "log_growth_per_trade"
    ) => {
      const headerMetric = rankingMetric === "log_growth_per_day" ? "log_growth_per_day" : "log_growth_per_trade";
      console.log(
        `rank,wallet_address,polymarket_url,${headerMetric},simulated_copytrade_return_per_day,roi_per_day,` +
          "win_rate_percent,median_roi_percent,trades_per_day,ev_per_trade,volatility,cvar," +
          "hold_time_per_trade_minutes,final_bankroll,trades_copied,trades_skipped,date_of_last_trade"
      );

      for (let i = 0; i < sortedResults.length; i++) {
        const r = sortedResults[i];
        const metricValue = rankingMetric === "log_growth_per_day" ? r.log_growth_per_day : r.log_growth_per_trade;
        const row = [
          i + 1,
          r.wallet,
          `polymarket.com/${r.wallet}`,
          fmt(metricValue, 8),
          fmt(r.simulated_copytrade_return_per_day, 8),
          fmt(r.roi_per_day, 8),
          fmt(r.win_rate_percent, 2),
          fmt(r.median_roi_percent, 2),
          fmt(r.trades_per_day, 4),
          fmt(r.ev_per_trade, 6),
          fmt(r.volatility, 8),
          fmt(r.hold_time_per_trade_minutes, 2),
          fmt(r.final_bankroll, 2),
          r.trades_copied,
          r.trades_skipped,
          r.date_of_last_trade,
        ].join(",");
        console.log(row);
      }
    };

    // ========================================
    // LEADERBOARD 1: Ranked by LogGrowthPerDay
    // ========================================
    console.log("\n# LEADERBOARD 1: Ranked by Log Growth Per Day");
    console.log("# LogGrowthPerDay = mean(g_d) where g_d = ln(E_d / E_{d-1})");
    console.log("");

    const resultsByDay = [...results].sort((a, b) => {
      const diff = b.log_growth_per_day - a.log_growth_per_day;
      if (Math.abs(diff) < 1e-10) {
        return a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase());
      }
      return diff;
    });
    const topByDay = resultsByDay.slice(0, CONFIG.TOP_N);
    outputLeaderboard(topByDay, "log_growth_per_day");

    // ========================================
    // LEADERBOARD 2: Ranked by LogGrowthPerTrade
    // ========================================
    console.log("\n\n# LEADERBOARD 2: Ranked by Log Growth Per Trade");
    console.log("# LogGrowthPerTrade = ln(B_T / B_0) / num_trades");
    console.log("");

    const resultsByTrade = [...results].sort((a, b) => {
      const diff = b.log_growth_per_trade - a.log_growth_per_trade;
      if (Math.abs(diff) < 1e-10) {
        return a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase());
      }
      return diff;
    });
    const topByTrade = resultsByTrade.slice(0, CONFIG.TOP_N);
    outputLeaderboard(topByTrade, "log_growth_per_trade");

    console.error(`\n=== Leaderboards Complete ===`);
    console.error(`\nLeaderboard 1 (by Day):`);
    console.error(`  Top performer: ${topByDay[0]?.wallet || "N/A"}`);
    console.error(`  Best log_growth_per_day: ${topByDay[0]?.log_growth_per_day.toFixed(6) || "N/A"}`);
    console.error(`\nLeaderboard 2 (by Trade):`);
    console.error(`  Top performer: ${topByTrade[0]?.wallet || "N/A"}`);
    console.error(`  Best log_growth_per_trade: ${topByTrade[0]?.log_growth_per_trade.toFixed(6) || "N/A"}`);
  } catch (err) {
    console.error("Error during execution:", err);
    throw err;
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
