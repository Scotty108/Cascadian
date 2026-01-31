#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v18 - Log Return % Per Day
 *
 * Ranking metric: Log Return % Per Day (geometric growth rate)
 *
 * Filter criteria:
 * 1. Total PnL > $0 (positive overall)
 * 2. Trade in last 4 days (recently active)
 * 3. >35 trades total
 * 4. >8 markets traded
 * 5. First trade >14 days ago (established trader)
 * 6. Median ROI >10%
 * 7. Median win ROI != 100% (exclude split arbiters)
 * 8. Winsorize: remove top/bottom 2.5% ROI trades per wallet
 *
 * CRITICAL: Always deduplicate using GROUP BY tx_hash, wallet, condition_id, outcome_index
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// ============================================
// CONFIGURATION
// ============================================
// Use the smaller backup table for faster queries
const TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260130';
const MIN_TRADES = 35;
const MIN_MARKETS = 8;
const ACTIVE_DAYS = 4;
const MIN_AGE_DAYS = 14;
const MIN_MEDIAN_ROI = 0.10;  // 10%
const WINSORIZE_PCT = 0.025;  // Remove top/bottom 2.5%

// ROI bounds
const MIN_ROI = -1.0;   // Floor at -100%
const MAX_ROI = 2.0;    // Cap at +200%

// Query timeouts
const CANDIDATE_TIMEOUT = 600;  // 10 minutes for candidate search
const WALLET_TIMEOUT = 120;     // 2 minutes per wallet

// ============================================
// TYPES
// ============================================
interface Trade {
  tx_hash: string;
  entry_time: number;
  roi: number;
  condition_id: string;
}

interface WalletCandidate {
  wallet: string;
  raw_trades: number;
  total_pnl: number;
  markets_traded: number;
  first_trade: string;
  last_trade: string;
}

interface LeaderboardEntry {
  wallet: string;
  log_return_pct_per_day: number;
  avg_roi_pct: number;
  win_rate_pct: number;
  median_win_roi_pct: number;
  median_loss_roi_pct: number;
  winning_trades: number;
  losing_trades: number;
  trades_per_day: number;
  total_trades: number;
  days_active: number;
  edge_per_trade: number;
  volatility: number;
  markets_traded: number;
  first_trade: string;
  last_trade: string;
}

// ============================================
// HELPERS
// ============================================
function clampRoi(roi: number): number {
  return Math.max(MIN_ROI, Math.min(MAX_ROI, roi));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function winsorize(trades: Trade[]): Trade[] {
  if (trades.length < 10) return trades;  // Don't winsorize very small sets

  const sorted = [...trades].sort((a, b) => a.roi - b.roi);
  const lowerIdx = Math.floor(sorted.length * WINSORIZE_PCT);
  const upperIdx = Math.ceil(sorted.length * (1 - WINSORIZE_PCT));
  return sorted.slice(lowerIdx, upperIdx);
}

// ============================================
// DATA RETRIEVAL
// ============================================
async function getDataCutoff(): Promise<Date> {
  const query = `SELECT max(entry_time) as latest FROM ${TABLE} SETTINGS max_execution_time = 30`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as { latest: string }[];
  return new Date(rows[0].latest);
}

async function getCandidateWallets(cutoffDate: Date): Promise<WalletCandidate[]> {
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  const activeStr = new Date(cutoffDate.getTime() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const ageStr = new Date(cutoffDate.getTime() - MIN_AGE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  // Phase 1: Fast candidate filtering (no dedup, approximation)
  // This is intentionally approximate - we'll verify with deduped data later
  const query = `
    SELECT
      wallet,
      count() as raw_trades,
      sum(pnl_usd) as total_pnl,
      uniqExact(condition_id) as markets_traded,
      toString(min(entry_time)) as first_trade,
      toString(max(entry_time)) as last_trade
    FROM ${TABLE}
    WHERE (is_closed = 1 OR resolved_at IS NOT NULL)
      AND entry_time <= '${cutoffStr}'
    GROUP BY wallet
    HAVING
      total_pnl > 0                                        -- Step 1
      AND max(entry_time) >= toDateTime('${activeStr}')    -- Step 2
      AND raw_trades > ${MIN_TRADES}                       -- Step 3 (may have dupes, so relaxed)
      AND markets_traded > ${MIN_MARKETS}                  -- Step 4
      AND min(entry_time) <= toDateTime('${ageStr}')       -- Step 5
    ORDER BY total_pnl DESC
    LIMIT 3000
    SETTINGS max_execution_time = ${CANDIDATE_TIMEOUT}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as WalletCandidate[];
}

async function getWalletTrades(wallet: string, cutoffDate: Date): Promise<Trade[]> {
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');

  // Deduplicated query
  // Note: Alias output columns to avoid conflict with raw table columns in WHERE
  const query = `
    SELECT
      tx_hash,
      toUInt64(any(entry_time)) as trade_time,
      GREATEST(${MIN_ROI}, LEAST(any(roi), ${MAX_ROI})) as roi,
      condition_id
    FROM ${TABLE}
    WHERE wallet = '${wallet}'
      AND (is_closed = 1 OR resolved_at IS NOT NULL)
      AND entry_time <= '${cutoffStr}'
    GROUP BY tx_hash, wallet, condition_id, outcome_index
    ORDER BY trade_time
    SETTINGS max_execution_time = ${WALLET_TIMEOUT}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  // Map trade_time back to entry_time for the Trade interface
  const rows = await result.json() as { tx_hash: string; trade_time: number; roi: number; condition_id: string }[];
  return rows.map(r => ({
    tx_hash: r.tx_hash,
    entry_time: r.trade_time,
    roi: r.roi,
    condition_id: r.condition_id,
  }));
}

// ============================================
// METRICS CALCULATION
// ============================================
// Debug counters
const DEBUG = true;
const rejectReasons: Record<string, number> = {
  low_trades: 0,
  low_markets: 0,
  low_median_roi: 0,
  split_arber: 0,
  low_winsorized: 0,
  invalid_result: 0,
};

function calculateMetrics(wallet: string, trades: Trade[]): LeaderboardEntry | null {
  if (trades.length < MIN_TRADES) {
    rejectReasons.low_trades++;
    if (DEBUG) console.error(`  ${wallet}: rejected - only ${trades.length} trades (need >${MIN_TRADES})`);
    return null;
  }

  // Get unique markets
  const markets = new Set(trades.map(t => t.condition_id));
  if (markets.size <= MIN_MARKETS) {
    rejectReasons.low_markets++;
    if (DEBUG) console.error(`  ${wallet}: rejected - only ${markets.size} markets (need >${MIN_MARKETS})`);
    return null;
  }

  // Calculate median ROI
  const allRois = trades.map(t => t.roi);
  const medianRoi = median(allRois);
  if (medianRoi <= MIN_MEDIAN_ROI) {
    rejectReasons.low_median_roi++;
    if (DEBUG) console.error(`  ${wallet}: rejected - median ROI ${(medianRoi*100).toFixed(2)}% (need >${MIN_MEDIAN_ROI*100}%)`);
    return null;
  }

  // Filter step 7: exclude 100% median win ROI (split arbiters)
  const winningRois = allRois.filter(r => r > 0);
  const medianWinRoi = median(winningRois);
  if (Math.abs(medianWinRoi - 1.0) < 0.001) {
    rejectReasons.split_arber++;
    if (DEBUG) console.error(`  ${wallet}: rejected - median win ROI is 100% (split arber)`);
    return null;
  }

  // Step 8: Winsorize
  const winsorizedTrades = winsorize(trades);
  if (winsorizedTrades.length < 10) {
    rejectReasons.low_winsorized++;
    if (DEBUG) console.error(`  ${wallet}: rejected - only ${winsorizedTrades.length} trades after winsorization`);
    return null;
  }

  // Calculate metrics on winsorized data
  const rois = winsorizedTrades.map(t => t.roi);
  const wins = rois.filter(r => r > 0);
  const losses = rois.filter(r => r <= 0);

  // Time calculations
  const timestamps = winsorizedTrades.map(t => t.entry_time);
  const firstTs = Math.min(...timestamps);
  const lastTs = Math.max(...timestamps);
  const daysActive = Math.max(1, Math.floor((lastTs - firstTs) / 86400) + 1);

  // Log Return % Per Day (the ranking metric)
  // Sum of ln(1 + ROI) divided by days active
  // Note: Floor ROI at -0.99 for log calculation to avoid ln(0) = -Infinity
  const logReturns = rois.map(r => Math.log(1 + Math.max(-0.99, r)));
  const sumLogReturns = logReturns.reduce((a, b) => a + b, 0);
  const logReturnPctPerDay = (sumLogReturns / daysActive) * 100;

  // Skip if invalid
  if (!Number.isFinite(logReturnPctPerDay)) {
    rejectReasons.invalid_result++;
    if (DEBUG) console.error(`  ${wallet}: rejected - invalid log return calculation`);
    return null;
  }

  // Other metrics
  const avgRoiPct = (rois.reduce((a, b) => a + b, 0) / rois.length) * 100;
  const winRatePct = (wins.length / rois.length) * 100;
  const medianWinRoiPct = median(wins) * 100;
  const medianLossRoiPct = median(losses) * 100;
  const tradesPerDay = rois.length / daysActive;
  const volatility = stddev(rois);

  // Edge per trade = win_rate * median_win_roi - loss_rate * |median_loss_roi|
  const winRate = wins.length / rois.length;
  const lossRate = losses.length / rois.length;
  const edgePerTrade = winRate * median(wins) - lossRate * Math.abs(median(losses));

  // Unique markets in winsorized set
  const winsorizedMarkets = new Set(winsorizedTrades.map(t => t.condition_id));

  return {
    wallet,
    log_return_pct_per_day: logReturnPctPerDay,
    avg_roi_pct: avgRoiPct,
    win_rate_pct: winRatePct,
    median_win_roi_pct: medianWinRoiPct,
    median_loss_roi_pct: medianLossRoiPct,
    winning_trades: wins.length,
    losing_trades: losses.length,
    trades_per_day: tradesPerDay,
    total_trades: rois.length,
    days_active: daysActive,
    edge_per_trade: edgePerTrade,
    volatility,
    markets_traded: winsorizedMarkets.size,
    first_trade: new Date(firstTs * 1000).toISOString().slice(0, 19).replace('T', ' '),
    last_trade: new Date(lastTs * 1000).toISOString().slice(0, 19).replace('T', ' '),
  };
}

// ============================================
// OUTPUT
// ============================================
function formatValue(val: number | null | undefined, decimals: number = 4): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'null';
  return val.toFixed(decimals);
}

function generateCSV(results: LeaderboardEntry[]): string {
  const headers = [
    'rank',
    'wallet_address',
    'polymarket_url',
    'log_return_pct_per_day',
    'avg_roi_pct_per_trade',
    'win_rate_pct',
    'median_win_roi_pct',
    'median_loss_roi_pct',
    'winning_trades',
    'losing_trades',
    'trades_per_day',
    'total_trades',
    'days_active',
    'edge_per_trade',
    'volatility',
    'markets_traded',
    'first_trade',
    'last_trade',
  ];

  const rows = results.slice(0, 50).map((r, idx) => [
    idx + 1,
    r.wallet,
    `https://polymarket.com/${r.wallet}`,
    formatValue(r.log_return_pct_per_day, 6),
    formatValue(r.avg_roi_pct, 4),
    formatValue(r.win_rate_pct, 2),
    formatValue(r.median_win_roi_pct, 4),
    formatValue(r.median_loss_roi_pct, 4),
    r.winning_trades,
    r.losing_trades,
    formatValue(r.trades_per_day, 2),
    r.total_trades,
    r.days_active,
    formatValue(r.edge_per_trade, 6),
    formatValue(r.volatility, 6),
    r.markets_traded,
    r.first_trade,
    r.last_trade,
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

function printTable(results: LeaderboardEntry[]): void {
  console.log('\n' + '='.repeat(200));
  console.log('TOP 50 WALLETS BY LOG RETURN % PER DAY');
  console.log('='.repeat(200));

  console.log(
    'Rank'.padEnd(6) +
    'Wallet'.padEnd(44) +
    'LogRet%/Day'.padStart(12) +
    'AvgROI%'.padStart(10) +
    'WinRate%'.padStart(10) +
    'MedWin%'.padStart(10) +
    'MedLoss%'.padStart(10) +
    'Wins'.padStart(6) +
    'Losses'.padStart(8) +
    'Trds/Day'.padStart(10) +
    'Total'.padStart(8) +
    'Days'.padStart(6) +
    'Edge'.padStart(10) +
    'Vol'.padStart(8) +
    'Markets'.padStart(8)
  );
  console.log('-'.repeat(200));

  results.slice(0, 50).forEach((r, idx) => {
    console.log(
      String(idx + 1).padEnd(6) +
      r.wallet.padEnd(44) +
      formatValue(r.log_return_pct_per_day, 4).padStart(12) +
      formatValue(r.avg_roi_pct, 2).padStart(10) +
      formatValue(r.win_rate_pct, 1).padStart(10) +
      formatValue(r.median_win_roi_pct, 2).padStart(10) +
      formatValue(r.median_loss_roi_pct, 2).padStart(10) +
      String(r.winning_trades).padStart(6) +
      String(r.losing_trades).padStart(8) +
      formatValue(r.trades_per_day, 2).padStart(10) +
      String(r.total_trades).padStart(8) +
      String(r.days_active).padStart(6) +
      formatValue(r.edge_per_trade, 4).padStart(10) +
      formatValue(r.volatility, 4).padStart(8) +
      String(r.markets_traded).padStart(8)
    );
  });
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('='.repeat(80));
  console.log('COPYTRADING LEADERBOARD v18 - LOG RETURN % PER DAY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Filter criteria:');
  console.log(`  1. Total PnL > $0`);
  console.log(`  2. Trade in last ${ACTIVE_DAYS} days`);
  console.log(`  3. >${MIN_TRADES} trades`);
  console.log(`  4. >${MIN_MARKETS} markets`);
  console.log(`  5. First trade >${MIN_AGE_DAYS} days ago`);
  console.log(`  6. Median ROI >${MIN_MEDIAN_ROI * 100}%`);
  console.log(`  7. Median win ROI != 100% (exclude split arbiters)`);
  console.log(`  8. Winsorize: remove top/bottom ${WINSORIZE_PCT * 100}% ROI trades`);
  console.log('');

  try {
    const DATA_CUTOFF = await getDataCutoff();
    console.log(`Data cutoff: ${DATA_CUTOFF.toISOString()}`);
    console.log('');

    // Phase 1: Get candidate wallets
    console.log('Phase 1: Finding candidate wallets (fast pre-filter)...');
    const candidates = await getCandidateWallets(DATA_CUTOFF);
    console.log(`  Found ${candidates.length} candidate wallets\n`);

    if (candidates.length === 0) {
      console.log('No wallets meet initial criteria. Exiting.');
      process.exit(0);
    }

    // Phase 2: Process each wallet
    console.log('Phase 2: Processing wallets with full deduplication & winsorization...');
    const results: LeaderboardEntry[] = [];
    let processed = 0;
    let qualified = 0;

    for (const candidate of candidates) {
      processed++;
      if (processed % 50 === 0 || processed === candidates.length) {
        process.stdout.write(`\r  Processing ${processed}/${candidates.length}... (${qualified} qualified)`);

        // Dump rejection stats every 100 wallets
        if (processed % 100 === 0) {
          console.error(`\n    Rejections at ${processed}: trades=${rejectReasons.low_trades}, markets=${rejectReasons.low_markets}, medianROI=${rejectReasons.low_median_roi}, splitArb=${rejectReasons.split_arber}, winsorize=${rejectReasons.low_winsorized}, invalid=${rejectReasons.invalid_result}`);
        }
      }

      try {
        const trades = await getWalletTrades(candidate.wallet, DATA_CUTOFF);
        const metrics = calculateMetrics(candidate.wallet, trades);

        if (metrics) {
          // Note: We no longer require positive log returns
          // Just rank all qualifying wallets by log return (higher is better)
          results.push(metrics);
          qualified++;
          // Debug: Show first few qualified wallets
          if (qualified <= 5) {
            console.error(`\n  QUALIFIED #${qualified}: ${candidate.wallet} (log return: ${metrics.log_return_pct_per_day.toFixed(4)}%/day)`);
          }
        }
      } catch (err) {
        // Track errors
        if (processed <= 10) {
          console.error(`\n  ERROR on ${candidate.wallet}: ${err}`);
        }
        continue;
      }
    }
    console.log('\n');

    // Print rejection summary
    console.log('Rejection breakdown:');
    for (const [reason, count] of Object.entries(rejectReasons)) {
      if (count > 0) {
        console.log(`  ${reason}: ${count}`);
      }
    }
    console.log('');

    // Sort by Log Return % Per Day (descending)
    results.sort((a, b) => b.log_return_pct_per_day - a.log_return_pct_per_day);

    // Output
    printTable(results);

    const csv = generateCSV(results);
    console.log('\n\nCSV OUTPUT:');
    console.log(csv);

    // Summary
    console.log('\n');
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total qualified wallets: ${results.length}`);
    if (results.length > 0) {
      console.log(`\nBEST WALLET: ${results[0].wallet}`);
      console.log(`  Log Return % Per Day: ${results[0].log_return_pct_per_day.toFixed(4)}%`);
      console.log(`  Win Rate: ${results[0].win_rate_pct.toFixed(1)}%`);
      console.log(`  Total Trades: ${results[0].total_trades}`);
      console.log(`  Days Active: ${results[0].days_active}`);

      const top50 = results.slice(0, 50);
      const avgLogReturn = top50.reduce((s, r) => s + r.log_return_pct_per_day, 0) / top50.length;
      console.log(`\nAvg Log Return %/Day (top 50): ${avgLogReturn.toFixed(4)}%`);
    }

    // Save to CSV
    const fs = await import('fs');
    const csvPath = resolve(process.cwd(), 'data', 'copytrading-leaderboard-v18.csv');
    fs.mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
    fs.writeFileSync(csvPath, csv);
    console.log(`\nCSV saved to: ${csvPath}`);

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

main();
