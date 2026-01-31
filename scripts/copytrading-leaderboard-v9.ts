#!/usr/bin/env npx tsx
/**
 * Top 50 Copytrading Leaderboard - V9
 *
 * Uses pm_trade_fifo_roi_v3_mat_deduped (deduplicated, materialized table)
 *
 * NO BANKROLL LIMITATIONS = every trade is copied with $2
 * LogGrowthPerDay = ln(1 + avg_roi_winsorized) / days_active
 *
 * Run: npx tsx scripts/copytrading-leaderboard-v9.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Configuration
const BET_SIZE = 2.0;
const LOOKBACK_DAYS = 90;
const MIN_TRADES = 30;
const MIN_MARKETS = 6;
const MIN_WIN_RATE = 40;
const MIN_MEDIAN_BET = 5;
const MAX_MICRO_ARB_PCT = 10;

async function main() {
  console.log('='.repeat(100));
  console.log('COPYTRADING LEADERBOARD V9 - USING pm_trade_fifo_roi_v3_mat_deduped');
  console.log('='.repeat(100));
  console.log(`Bet: $${BET_SIZE} | Lookback: ${LOOKBACK_DAYS}d | No bankroll limit = all trades copied\n`);
  console.log('Filters:');
  console.log(`  - > ${MIN_TRADES} trades`);
  console.log(`  - > ${MIN_MARKETS} markets`);
  console.log(`  - Win rate > ${MIN_WIN_RATE}%`);
  console.log(`  - Median bet > $${MIN_MEDIAN_BET}`);
  console.log(`  - Micro-arb trades < ${MAX_MICRO_ARB_PCT}%\n`);

  const startTime = Date.now();

  // Step 1: Get candidate wallets with basic filters (fast aggregation)
  console.log('Step 1: Finding candidate wallets...');
  const candidateQuery = `
    SELECT
      wallet,
      count() as total_trades,
      uniqExact(condition_id) as markets_traded,
      min(entry_time) as first_trade_time,
      max(entry_time) as last_trade_time,
      max(resolved_at) as last_resolve_time,
      (toUnixTimestamp(max(resolved_at)) - toUnixTimestamp(min(entry_time))) / 86400.0 as days_active,
      countIf(roi > 0) as wins,
      countIf(roi <= 0) as losses,
      countIf(roi > 0) * 100.0 / count() as win_rate_pct,
      median(abs(cost_usd)) as median_bet_size,
      countIf(
        (outcome_index = 0 AND cost_usd / nullIf(tokens, 0) > 0.95) OR
        (outcome_index = 1 AND cost_usd / nullIf(tokens, 0) < 0.05)
      ) * 100.0 / count() as micro_arb_pct,
      quantile(0.95)(roi) as p95_roi,
      avg(roi) as avg_roi_raw,
      sum(roi) as sum_roi_raw
    FROM pm_trade_fifo_roi_v3_mat_deduped
    WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND resolved_at IS NOT NULL
      AND resolved_at > entry_time
      AND resolved_at <= now()
      AND tokens > 0
      AND cost_usd > 0
    GROUP BY wallet
    HAVING
      total_trades > ${MIN_TRADES}
      AND markets_traded > ${MIN_MARKETS}
      AND win_rate_pct > ${MIN_WIN_RATE}
      AND median_bet_size > ${MIN_MEDIAN_BET}
      AND micro_arb_pct <= ${MAX_MICRO_ARB_PCT}
      AND wins > 0
      AND losses > 0
      AND days_active > 0
    SETTINGS max_execution_time = 300
  `;

  const candidateResult = await clickhouse.query({ query: candidateQuery, format: 'JSONEachRow' });
  const candidates = await candidateResult.json() as any[];
  console.log(`Found ${candidates.length} candidate wallets after initial filters`);

  if (candidates.length === 0) {
    console.log('No candidates found. Exiting.');
    return;
  }

  // Step 2: For top 500 candidates by raw avg_roi, compute winsorized stats
  // Sort by raw performance and take top 500 to process further
  const topCandidates = candidates
    .filter(c => c.avg_roi_raw > 0)
    .sort((a, b) => {
      const logGrowthA = Math.log(1 + Number(a.avg_roi_raw)) / Math.max(1, Number(a.days_active));
      const logGrowthB = Math.log(1 + Number(b.avg_roi_raw)) / Math.max(1, Number(b.days_active));
      return logGrowthB - logGrowthA;
    })
    .slice(0, 500);

  console.log(`Processing top ${topCandidates.length} candidates for winsorized metrics...`);

  // Step 3: Compute winsorized avg ROI for top candidates
  const walletList = topCandidates.map(c => `'${c.wallet}'`).join(',');

  console.log('Step 2: Computing winsorized ROI...');
  const winsorizedQuery = `
    SELECT
      wallet,
      avg(least(roi, p95)) as avg_roi_winsorized,
      sum(least(roi, p95)) as sum_roi_winsorized,
      medianIf(roi, roi > 0) as median_win_roi,
      medianIf(abs(roi), roi <= 0) as median_loss_mag
    FROM (
      SELECT
        t.wallet,
        t.roi,
        c.p95_roi as p95
      FROM pm_trade_fifo_roi_v3_mat_deduped t
      INNER JOIN (
        SELECT wallet, quantile(0.95)(roi) as p95_roi
        FROM pm_trade_fifo_roi_v3_mat_deduped
        WHERE wallet IN (${walletList})
          AND entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
          AND resolved_at IS NOT NULL
          AND resolved_at > entry_time
          AND resolved_at <= now()
          AND tokens > 0
          AND cost_usd > 0
        GROUP BY wallet
      ) c ON t.wallet = c.wallet
      WHERE t.wallet IN (${walletList})
        AND t.entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND t.resolved_at IS NOT NULL
        AND t.resolved_at > t.entry_time
        AND t.resolved_at <= now()
        AND t.tokens > 0
        AND t.cost_usd > 0
    )
    GROUP BY wallet
    SETTINGS max_execution_time = 300
  `;

  const winsorizedResult = await clickhouse.query({ query: winsorizedQuery, format: 'JSONEachRow' });
  const winsorizedData = await winsorizedResult.json() as any[];

  // Create lookup map
  const winsorizedMap = new Map(winsorizedData.map(w => [w.wallet, w]));

  // Step 4: Combine and compute final metrics
  console.log('Step 3: Computing final rankings...');
  const results: any[] = [];

  for (const c of topCandidates) {
    const w = winsorizedMap.get(c.wallet);
    if (!w || Number(w.avg_roi_winsorized) <= 0) continue;

    const days_active = Number(c.days_active);
    const total_trades = Number(c.total_trades);
    const avg_roi_winsorized = Number(w.avg_roi_winsorized);
    const sum_roi_winsorized = Number(w.sum_roi_winsorized);
    const win_rate_pct = Number(c.win_rate_pct);
    const p95_roi = Number(c.p95_roi);
    const median_win_roi = Number(w.median_win_roi) || 0;
    const median_loss_mag = Number(w.median_loss_mag) || 0;

    // LogGrowthPerDay = ln(1 + avg_roi) / days
    const log_growth_per_day = Math.log(1 + avg_roi_winsorized) / Math.max(1, days_active);

    // ROI % per day
    const roi_pct_per_day = avg_roi_winsorized * 100 / Math.max(1, days_active);

    // Trades per day
    const trades_per_day = total_trades / Math.max(1, days_active);

    // Final bankroll: $2 per trade * (N + sum(roi))
    const final_bankroll = BET_SIZE * (total_trades + sum_roi_winsorized);

    // Cap median win ROI at p95
    const median_win_roi_capped = Math.min(median_win_roi, p95_roi);

    // EV per trade = win_rate * median_win - loss_rate * median_loss
    const ev_per_trade = (win_rate_pct / 100 * median_win_roi_capped) - ((1 - win_rate_pct / 100) * median_loss_mag);

    // Compounding score = EV per trade / avg days between trades
    const avg_days_per_trade = days_active / total_trades;
    const compounding_score = ev_per_trade / Math.max(0.01, avg_days_per_trade);

    results.push({
      wallet: c.wallet,
      log_growth_per_day,
      roi_pct_per_day,
      trades_per_day,
      final_bankroll,
      trades_copied: total_trades,
      trades_skipped: 0,
      ev_per_trade,
      compounding_score,
      win_rate_pct,
      median_roi_pct: median_win_roi_capped * 100,
      markets_traded: Number(c.markets_traded),
      wins: Number(c.wins),
      losses: Number(c.losses),
      days_active,
      date_last_trade: new Date(c.last_trade_time).toISOString().split('T')[0]
    });
  }

  // Sort by log_growth_per_day and take top 50
  results.sort((a, b) => b.log_growth_per_day - a.log_growth_per_day);
  const top50 = results.slice(0, 50);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);
  console.log(`Final result: ${top50.length} wallets\n`);

  displayLeaderboard(top50);

  // Export to CSV
  try {
    mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
    const csvPath = resolve(process.cwd(), 'data/copytrading-leaderboard-v9-top50.csv');
    exportToCSV(top50, csvPath);
    console.log(`\nExported to: ${csvPath}`);
  } catch (e) {
    console.error('Export error:', e);
  }
}

function displayLeaderboard(rows: any[]) {
  console.log('='.repeat(200));
  console.log('TOP 50 COPYTRADING LEADERBOARD - V9 (NO BANKROLL LIMITS)');
  console.log(`$${BET_SIZE}/trade | All trades copied | LogGrowthPerDay = ln(1 + avg_roi) / days`);
  console.log('='.repeat(200));

  const header = [
    'Rk'.padEnd(4),
    'Wallet'.padEnd(44),
    'LogGrw/D'.padEnd(10),
    'ROI%/D'.padEnd(9),
    'Tr/Day'.padEnd(8),
    'Final$'.padEnd(10),
    'Copied'.padEnd(7),
    'Skip'.padEnd(6),
    'EV/Tr'.padEnd(9),
    'CompSc'.padEnd(9),
    'Win%'.padEnd(7),
    'MedROI%'.padEnd(9),
    'Markets'.padEnd(8),
    'Days'.padEnd(6),
    'LastTrade'
  ].join('');

  console.log(header);
  console.log('-'.repeat(200));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const row = [
      String(i + 1).padEnd(4),
      r.wallet.padEnd(44),
      r.log_growth_per_day.toFixed(4).padEnd(10),
      r.roi_pct_per_day.toFixed(2).padEnd(9),
      r.trades_per_day.toFixed(1).padEnd(8),
      `$${r.final_bankroll.toFixed(0)}`.padEnd(10),
      String(r.trades_copied).padEnd(7),
      String(r.trades_skipped).padEnd(6),
      r.ev_per_trade.toFixed(3).padEnd(9),
      r.compounding_score.toFixed(3).padEnd(9),
      r.win_rate_pct.toFixed(1).padEnd(7),
      r.median_roi_pct.toFixed(1).padEnd(9),
      String(r.markets_traded).padEnd(8),
      r.days_active.toFixed(1).padEnd(6),
      r.date_last_trade
    ].join('');

    console.log(row);
  }
}

function exportToCSV(rows: any[], filePath: string) {
  const headers = [
    'rank',
    'wallet',
    'log_growth_per_day',
    'roi_pct_per_day',
    'trades_per_day',
    'final_bankroll',
    'trades_copied',
    'trades_skipped',
    'ev_per_trade',
    'compounding_score',
    'win_rate_pct',
    'median_roi_pct',
    'markets_traded',
    'wins',
    'losses',
    'days_active',
    'date_last_trade'
  ];

  const csvRows = [headers.join(',')];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    csvRows.push([
      i + 1,
      r.wallet,
      r.log_growth_per_day.toFixed(6),
      r.roi_pct_per_day.toFixed(4),
      r.trades_per_day.toFixed(2),
      r.final_bankroll.toFixed(2),
      r.trades_copied,
      r.trades_skipped,
      r.ev_per_trade.toFixed(6),
      r.compounding_score.toFixed(6),
      r.win_rate_pct.toFixed(2),
      r.median_roi_pct.toFixed(2),
      r.markets_traded,
      r.wins,
      r.losses,
      r.days_active.toFixed(2),
      r.date_last_trade
    ].join(','));
  }

  writeFileSync(filePath, csvRows.join('\n'));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
