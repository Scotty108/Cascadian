#!/usr/bin/env npx tsx
/**
 * Top 50 Copytrading Leaderboard - V7
 *
 * Uses pm_trade_fifo_roi_v3 with TRUE FIFO (V5 logic):
 * - is_closed=1: Positions closed early (proper FIFO matching)
 * - is_closed=0: Positions held to resolution
 *
 * Key metrics:
 * - LogGrowthPerDay: ln(1 + avg_roi) / days_active
 * - EV per trade: (winRate * medianWinROI) - ((1-winRate) * medianLossMag)
 * - Compounding score: EV / avg_hold_days
 *
 * Filters:
 * - Last 90 days
 * - Active in last 4 days
 * - > 30 trades
 * - > 6 markets
 * - Win rate > 40%
 * - Median bet > $5
 * - Micro-arb < 10%
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// ============================================
// CONFIGURATION
// ============================================
const BET_SIZE = 2.0;              // Bet size per trade (> $1)
const LOOKBACK_DAYS = 30;          // Last 30 days (optimized for speed)
const ACTIVE_DAYS = 4;             // Must trade in last 4 days
const MIN_TRADES = 30;             // > 30 trades
const MIN_MARKETS = 6;             // > 6 markets
const MIN_WIN_RATE = 40;           // > 40% win rate
const MIN_MEDIAN_BET = 5;          // Median bet > $5
const MAX_MICRO_ARB_PCT = 10;      // < 10% micro-arb trades

interface LeaderboardRow {
  wallet: string;
  log_growth_per_day: number;
  roi_pct_per_day: number;
  trades_per_day: number;
  final_bankroll: number;
  trades_copied: number;
  ev_per_trade: number;
  compounding_score: number;
  win_rate_pct: number;
  median_roi_pct: number;
  total_pnl: number;
  date_last_trade: string;
}

async function main() {
  console.log('='.repeat(80));
  console.log('COPYTRADING LEADERBOARD V7 - TRUE FIFO (pm_trade_fifo_roi_v3)');
  console.log('='.repeat(80));
  console.log(`\nConfiguration:`);
  console.log(`  Bet size: $${BET_SIZE} per trade`);
  console.log(`  Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`  Active window: ${ACTIVE_DAYS} days`);
  console.log(`  Min trades: >${MIN_TRADES}`);
  console.log(`  Min markets: >${MIN_MARKETS}`);
  console.log(`  Min win rate: >${MIN_WIN_RATE}%`);
  console.log(`  Min median bet: >$${MIN_MEDIAN_BET}`);
  console.log(`  Max micro-arb: <${MAX_MICRO_ARB_PCT}%`);
  console.log('');

  // Run the comprehensive query
  console.log('Running leaderboard query...\n');
  const startTime = Date.now();
  const results = await getLeaderboard();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Query completed in ${elapsed}s`);
  console.log(`Found ${results.length} wallets with positive LogGrowthPerDay\n`);

  if (results.length === 0) {
    console.log('No wallets matched all criteria.');
    return;
  }

  // Display leaderboard
  displayLeaderboard(results);

  // Export to CSV
  const csvPath = resolve(process.cwd(), 'data/copytrading-leaderboard-v7-top50.csv');
  exportToCSV(results.slice(0, 50), csvPath);

  // JSON output for programmatic use
  console.log('\n\n--- JSON Output (Top 10) ---');
  console.log(JSON.stringify(results.slice(0, 10).map((r, i) => ({
    rank: i + 1,
    ...r
  })), null, 2));
}

async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const query = `
    WITH
    -- ============================================================
    -- STEP 0: Pre-filter to lookback period
    -- No dedup needed - table is already computed
    -- ============================================================
    trades_window AS (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        abs(cost_usd) as cost_usd,
        pnl_usd,
        roi,
        is_maker,
        is_closed,
        pct_sold_early,
        abs(cost_usd) / nullIf(tokens, 0) as entry_price,
        (toUnixTimestamp(resolved_at) - toUnixTimestamp(entry_time)) / 86400.0 as hold_days
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND tokens > 0
        AND resolved_at > entry_time
        AND resolved_at <= now()
    ),

    -- ============================================================
    -- STEP 1-7: Apply all filters and compute base stats
    -- ============================================================
    wallet_base AS (
      SELECT
        wallet,

        -- Basic counts
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,

        -- Timestamps for activity check
        min(entry_time) as first_trade_time,
        max(entry_time) as last_trade_time,
        max(resolved_at) as last_resolve_time,

        -- Win rate calculation (roi > 0 means profit)
        countIf(roi > 0) as wins,
        countIf(roi <= 0) as losses,
        countIf(roi > 0) * 100.0 / count() as win_rate_pct,

        -- Median bet size
        medianExact(cost_usd) as median_bet_size,

        -- Micro-arb detection
        -- YES trades (outcome_index=0) with entry_price > 0.95
        -- NO trades (outcome_index=1) with entry_price < 0.05
        countIf(
          (outcome_index = 0 AND entry_price > 0.95) OR
          (outcome_index = 1 AND entry_price < 0.05)
        ) * 100.0 / count() as micro_arb_pct,

        -- Winsorization - compute p95 ROI
        quantile(0.95)(roi) as p95_roi,

        -- Median win ROI (among winners)
        medianExactIf(roi, roi > 0) as median_win_roi,

        -- Median loss magnitude (absolute value, among losers)
        medianExactIf(abs(roi), roi <= 0) as median_loss_mag,

        -- For simulation: average ROI
        avg(roi) as avg_roi_raw,

        -- Sum of ROI for final bankroll
        sum(roi) as sum_roi_raw,

        -- Total PnL
        sum(pnl_usd) as total_pnl,

        -- Average hold time for compounding score
        avg(if(hold_days > 0 AND hold_days < 90, hold_days, null)) as avg_hold_days,

        -- Days active for LogGrowthPerDay calculation
        (toUnixTimestamp(max(resolved_at)) - toUnixTimestamp(min(entry_time))) / 86400.0 as days_active

      FROM trades_window
      GROUP BY wallet
      HAVING
        -- Active in last 4 days
        last_trade_time >= now() - INTERVAL ${ACTIVE_DAYS} DAY
        -- > 30 trades
        AND total_trades > ${MIN_TRADES}
        -- > 6 markets
        AND markets_traded > ${MIN_MARKETS}
        -- Win rate > 40%
        AND win_rate_pct > ${MIN_WIN_RATE}
        -- Median bet > $5
        AND median_bet_size > ${MIN_MEDIAN_BET}
        -- Micro-arb < 10%
        AND micro_arb_pct <= ${MAX_MICRO_ARB_PCT}
        -- Safety: must have both wins and losses for EV calc
        AND wins > 0
        AND losses > 0
    ),

    -- ============================================================
    -- Apply winsorization and compute EV
    -- ============================================================
    wallet_with_ev AS (
      SELECT
        *,
        -- Winsorized median win ROI (capped at p95)
        least(median_win_roi, p95_roi) as median_win_roi_capped,
        -- Cap the raw average if it exceeds p95
        least(avg_roi_raw, p95_roi) as avg_roi_winsorized,
        least(sum_roi_raw, total_trades * p95_roi) as sum_roi_winsorized,
        -- EV per trade with winsorized median win
        (win_rate_pct / 100.0 * least(median_win_roi, p95_roi)) -
        ((1 - win_rate_pct / 100.0) * median_loss_mag) as ev_per_trade
      FROM wallet_base
      WHERE median_win_roi IS NOT NULL
        AND median_loss_mag IS NOT NULL
    ),

    -- ============================================================
    -- Calculate simulation metrics
    -- ============================================================
    simulation_results AS (
      SELECT
        wallet,

        -- Ranking metric: LogGrowthPerDay
        ln(1 + avg_roi_winsorized) / greatest(1, days_active) as log_growth_per_day,

        -- ROI % per day
        avg_roi_winsorized * 100 / greatest(1, days_active) as roi_pct_per_day,

        -- Trades per day
        total_trades / greatest(1, days_active) as trades_per_day,

        -- Final bankroll: B_T = bet_size * (N + sum_roi)
        ${BET_SIZE} * (total_trades + sum_roi_winsorized) as final_bankroll,

        -- All trades copied
        total_trades as trades_copied,

        -- EV per trade
        ev_per_trade,

        -- Compounding score = EV / avg_hold_days
        ev_per_trade / greatest(0.01, coalesce(avg_hold_days, 1)) as compounding_score,

        -- Win rate %
        win_rate_pct,

        -- Median ROI % (winsorized)
        least(median_win_roi, p95_roi) * 100 as median_roi_pct,

        -- Total PnL
        total_pnl,

        -- Date of last trade
        formatDateTime(last_trade_time, '%Y-%m-%d') as date_last_trade,

        -- For final filter
        avg_roi_winsorized

      FROM wallet_with_ev
      WHERE ev_per_trade > 0  -- Positive expected value
    )

    -- ============================================================
    -- Final output - Top 50 by LogGrowthPerDay DESC
    -- ============================================================
    SELECT
      wallet,
      log_growth_per_day,
      roi_pct_per_day,
      trades_per_day,
      final_bankroll,
      trades_copied,
      ev_per_trade,
      compounding_score,
      win_rate_pct,
      median_roi_pct,
      total_pnl,
      date_last_trade
    FROM simulation_results
    WHERE avg_roi_winsorized > 0  -- Must be profitable overall
      AND log_growth_per_day > 0  -- Positive growth only
    ORDER BY log_growth_per_day DESC
    LIMIT 100
    SETTINGS max_execution_time = 600
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet: r.wallet,
    log_growth_per_day: Number(r.log_growth_per_day),
    roi_pct_per_day: Number(r.roi_pct_per_day),
    trades_per_day: Number(r.trades_per_day),
    final_bankroll: Number(r.final_bankroll),
    trades_copied: Number(r.trades_copied),
    ev_per_trade: Number(r.ev_per_trade),
    compounding_score: Number(r.compounding_score),
    win_rate_pct: Number(r.win_rate_pct),
    median_roi_pct: Number(r.median_roi_pct),
    total_pnl: Number(r.total_pnl),
    date_last_trade: r.date_last_trade
  }));
}

function displayLeaderboard(results: LeaderboardRow[]) {
  console.log('='.repeat(200));
  console.log('TOP 50 COPYTRADING LEADERBOARD (Last 90 Days) - V7 TRUE FIFO');
  console.log('Ranked by LogGrowthPerDay | $2 per trade | Full Compounding');
  console.log('='.repeat(200));

  // Header
  console.log(
    'Rank'.padEnd(5) +
    'Wallet Address'.padEnd(44) +
    'LogGrw/Day'.padEnd(12) +
    'ROI%/Day'.padEnd(10) +
    'Trades/Day'.padEnd(11) +
    'FinalBank'.padEnd(12) +
    'Trades'.padEnd(8) +
    'EV/Trade'.padEnd(10) +
    'CompScore'.padEnd(10) +
    'WinRate%'.padEnd(10) +
    'MedROI%'.padEnd(10) +
    'TotalPnL'.padEnd(14) +
    'LastTrade'
  );
  console.log('-'.repeat(200));

  // Data rows
  const top50 = results.slice(0, 50);
  for (let i = 0; i < top50.length; i++) {
    const r = top50[i];
    console.log(
      String(i + 1).padEnd(5) +
      r.wallet.padEnd(44) +
      r.log_growth_per_day.toFixed(5).padEnd(12) +
      r.roi_pct_per_day.toFixed(3).padEnd(10) +
      r.trades_per_day.toFixed(2).padEnd(11) +
      `$${r.final_bankroll.toFixed(0)}`.padEnd(12) +
      String(r.trades_copied).padEnd(8) +
      r.ev_per_trade.toFixed(4).padEnd(10) +
      r.compounding_score.toFixed(4).padEnd(10) +
      r.win_rate_pct.toFixed(1).padEnd(10) +
      r.median_roi_pct.toFixed(1).padEnd(10) +
      `$${r.total_pnl.toFixed(0)}`.padEnd(14) +
      r.date_last_trade
    );
  }
  console.log('='.repeat(200));

  // Summary statistics
  if (top50.length > 0) {
    console.log('\n--- LEADERBOARD SUMMARY ---');
    console.log(`  Total wallets qualifying: ${results.length}`);
    console.log(`  Top wallet LogGrowth/Day: ${top50[0].log_growth_per_day.toFixed(6)}`);
    console.log(`  Avg LogGrowth/Day (top 50): ${(top50.reduce((s, r) => s + r.log_growth_per_day, 0) / top50.length).toFixed(6)}`);
    console.log(`  Avg Win Rate (top 50): ${(top50.reduce((s, r) => s + r.win_rate_pct, 0) / top50.length).toFixed(1)}%`);
    console.log(`  Avg EV/Trade (top 50): ${(top50.reduce((s, r) => s + r.ev_per_trade, 0) / top50.length).toFixed(4)}`);
    console.log(`  Total PnL (top 50): $${top50.reduce((s, r) => s + r.total_pnl, 0).toFixed(0)}`);

    // Top recommendations
    console.log('\n--- TOP RECOMMENDATIONS ---');

    console.log(`\n  #1 HIGHEST LOG GROWTH:`);
    console.log(`     Wallet: ${top50[0].wallet}`);
    console.log(`     LogGrowth/Day: ${top50[0].log_growth_per_day.toFixed(6)}`);
    console.log(`     Win Rate: ${top50[0].win_rate_pct.toFixed(1)}%`);
    console.log(`     Total PnL: $${top50[0].total_pnl.toFixed(0)}`);
    console.log(`     Trades: ${top50[0].trades_copied}`);

    // Best EV
    const bestEV = [...top50].sort((a, b) => b.ev_per_trade - a.ev_per_trade)[0];
    console.log(`\n  HIGHEST EV/TRADE:`);
    console.log(`     Wallet: ${bestEV.wallet}`);
    console.log(`     EV/Trade: ${bestEV.ev_per_trade.toFixed(4)}`);
    console.log(`     Win Rate: ${bestEV.win_rate_pct.toFixed(1)}%`);
    console.log(`     Total PnL: $${bestEV.total_pnl.toFixed(0)}`);

    // Best PnL
    const bestPnL = [...top50].sort((a, b) => b.total_pnl - a.total_pnl)[0];
    console.log(`\n  HIGHEST TOTAL PnL:`);
    console.log(`     Wallet: ${bestPnL.wallet}`);
    console.log(`     Total PnL: $${bestPnL.total_pnl.toFixed(0)}`);
    console.log(`     Win Rate: ${bestPnL.win_rate_pct.toFixed(1)}%`);
    console.log(`     Trades: ${bestPnL.trades_copied}`);

    // Best compounding
    const bestComp = [...top50].sort((a, b) => b.compounding_score - a.compounding_score)[0];
    console.log(`\n  HIGHEST COMPOUNDING SCORE:`);
    console.log(`     Wallet: ${bestComp.wallet}`);
    console.log(`     Compounding Score: ${bestComp.compounding_score.toFixed(4)}`);
    console.log(`     Trades/Day: ${bestComp.trades_per_day.toFixed(2)}`);
  }
}

function exportToCSV(data: LeaderboardRow[], filepath: string) {
  const headers = [
    'Rank',
    'Wallet Address',
    'LogGrowthPerDay',
    'ROI%/Day',
    'Trades/Day',
    'FinalBankroll',
    'TradesCopied',
    'EVPerTrade',
    'CompoundingScore',
    'WinRate%',
    'MedianROI%',
    'TotalPnL',
    'DateLastTrade'
  ];

  const rows = data.map((r, i) => [
    i + 1,
    r.wallet,
    r.log_growth_per_day.toFixed(8),
    r.roi_pct_per_day.toFixed(6),
    r.trades_per_day.toFixed(4),
    r.final_bankroll.toFixed(2),
    r.trades_copied,
    r.ev_per_trade.toFixed(6),
    r.compounding_score.toFixed(6),
    r.win_rate_pct.toFixed(2),
    r.median_roi_pct.toFixed(2),
    r.total_pnl.toFixed(2),
    r.date_last_trade
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  // Ensure data directory exists
  const dataDir = resolve(process.cwd(), 'data');
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    // Directory already exists
  }

  writeFileSync(filepath, csv);
  console.log(`\nCSV exported to: ${filepath}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
