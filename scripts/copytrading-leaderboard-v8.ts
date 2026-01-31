#!/usr/bin/env npx tsx
/**
 * Top 50 Copytrading Leaderboard - V8
 *
 * NO BANKROLL LIMITATIONS = every trade is copied
 * LogGrowthPerDay = ln(1 + avg_roi_winsorized) / days_active
 *
 * Run: npx tsx scripts/copytrading-leaderboard-v8.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const BET_SIZE = 2.0;
const LOOKBACK_DAYS = 90;
const ACTIVE_DAYS = 4;
const MIN_TRADES = 30;
const MIN_MARKETS = 6;
const MIN_WIN_RATE = 40;
const MIN_MEDIAN_BET = 5;
const MAX_MICRO_ARB_PCT = 10;

async function main() {
  console.log('='.repeat(80));
  console.log('COPYTRADING LEADERBOARD V8 - NO BANKROLL LIMITS');
  console.log('='.repeat(80));
  console.log(`Bet: $${BET_SIZE} | Lookback: ${LOOKBACK_DAYS}d | All trades copied\n`);

  const startTime = Date.now();

  // Two-stage query: first filter wallets, then compute winsorized stats
  const query = `
    WITH
    -- Stage 1: Pre-filter wallets (fast counts only, no winsorization)
    wallet_prefilter AS (
      SELECT
        wallet,
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,
        min(entry_time) as first_trade_time,
        max(entry_time) as last_trade_time,
        max(resolved_at) as last_resolve_time,
        countIf(roi > 0) as wins,
        countIf(roi <= 0) as losses,
        countIf(roi > 0) * 100.0 / count() as win_rate_pct,
        medianExact(abs(cost_usd)) as median_bet_size,
        countIf(
          (outcome_index = 0 AND abs(cost_usd) / nullIf(tokens, 0) > 0.95) OR
          (outcome_index = 1 AND abs(cost_usd) / nullIf(tokens, 0) < 0.05)
        ) * 100.0 / count() as micro_arb_pct,
        quantile(0.95)(roi) as p95_roi,
        medianExactIf(roi, roi > 0) as median_win_roi_raw,
        medianExactIf(abs(roi), roi <= 0) as median_loss_mag,
        (toUnixTimestamp(max(resolved_at)) - toUnixTimestamp(min(entry_time))) / 86400.0 as days_active
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND tokens > 0
        AND resolved_at > entry_time
        AND resolved_at <= now()
      GROUP BY wallet
      HAVING
        last_trade_time >= now() - INTERVAL ${ACTIVE_DAYS} DAY
        AND total_trades > ${MIN_TRADES}
        AND markets_traded > ${MIN_MARKETS}
        AND win_rate_pct > ${MIN_WIN_RATE}
        AND median_bet_size > ${MIN_MEDIAN_BET}
        AND micro_arb_pct <= ${MAX_MICRO_ARB_PCT}
        AND wins > 0
        AND losses > 0
    ),

    -- Stage 2: Compute winsorized avg ROI for filtered wallets
    wallet_winsorized AS (
      SELECT
        t.wallet,
        avg(least(t.roi, pf.p95_roi)) as avg_roi_winsorized,
        sum(least(t.roi, pf.p95_roi)) as sum_roi_winsorized
      FROM pm_trade_fifo_roi_v3 t
      INNER JOIN wallet_prefilter pf ON t.wallet = pf.wallet
      WHERE t.entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND t.tokens > 0
        AND t.resolved_at > t.entry_time
        AND t.resolved_at <= now()
      GROUP BY t.wallet
    ),

    -- Stage 3: Combine and compute final metrics
    final AS (
      SELECT
        pf.wallet,
        pf.total_trades,
        pf.first_trade_time,
        pf.last_trade_time,
        pf.days_active,
        pf.win_rate_pct,
        pf.p95_roi,
        least(pf.median_win_roi_raw, pf.p95_roi) as median_win_roi_capped,
        pf.median_loss_mag,
        w.avg_roi_winsorized,
        w.sum_roi_winsorized,

        -- LogGrowthPerDay = ln(1 + avg_roi) / days
        ln(1 + w.avg_roi_winsorized) / greatest(1, pf.days_active) as log_growth_per_day,
        -- ROI % per day
        w.avg_roi_winsorized * 100 / greatest(1, pf.days_active) as roi_pct_per_day,
        -- Trades per day
        pf.total_trades / greatest(1, pf.days_active) as trades_per_day,
        -- Final bankroll
        ${BET_SIZE} * (pf.total_trades + w.sum_roi_winsorized) as final_bankroll,
        -- EV per trade
        (pf.win_rate_pct / 100.0 * least(pf.median_win_roi_raw, pf.p95_roi)) -
        ((1 - pf.win_rate_pct / 100.0) * pf.median_loss_mag) as ev_per_trade,
        -- Compounding score
        ((pf.win_rate_pct / 100.0 * least(pf.median_win_roi_raw, pf.p95_roi)) -
         ((1 - pf.win_rate_pct / 100.0) * pf.median_loss_mag)) /
        greatest(0.01, pf.days_active / pf.total_trades) as compounding_score

      FROM wallet_prefilter pf
      INNER JOIN wallet_winsorized w ON pf.wallet = w.wallet
      WHERE w.avg_roi_winsorized > 0
        AND pf.median_win_roi_raw IS NOT NULL
        AND pf.median_loss_mag IS NOT NULL
    )

    SELECT
      wallet,
      log_growth_per_day,
      roi_pct_per_day,
      trades_per_day,
      final_bankroll,
      total_trades as trades_copied,
      0 as trades_skipped,
      ev_per_trade,
      compounding_score,
      win_rate_pct,
      median_win_roi_capped * 100 as median_roi_pct,
      formatDateTime(last_trade_time, '%Y-%m-%d') as date_last_trade
    FROM final
    WHERE log_growth_per_day > 0
    ORDER BY log_growth_per_day DESC
    LIMIT 50
    SETTINGS max_execution_time = 300
  `;

  console.log('Running leaderboard query...');
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Query completed in ${elapsed}s`);
  console.log(`Found ${rows.length} wallets\n`);

  displayLeaderboard(rows);

  const csvPath = resolve(process.cwd(), 'data/copytrading-leaderboard-v8-top50.csv');
  exportToCSV(rows, csvPath);
}

function displayLeaderboard(rows: any[]) {
  console.log('='.repeat(180));
  console.log('TOP 50 COPYTRADING LEADERBOARD - V8 (NO BANKROLL LIMITS)');
  console.log(`$2/trade | All trades copied | LogGrowthPerDay = ln(1 + avg_roi) / days`);
  console.log('='.repeat(180));

  console.log(
    'Rk'.padEnd(4) +
    'Wallet'.padEnd(44) +
    'LogGrw/D'.padEnd(10) +
    'ROI%/D'.padEnd(9) +
    'Tr/Day'.padEnd(8) +
    'Final$'.padEnd(10) +
    'Copied'.padEnd(7) +
    'Skip'.padEnd(6) +
    'EV/Tr'.padEnd(9) +
    'CompSc'.padEnd(9) +
    'Win%'.padEnd(7) +
    'MedROI%'.padEnd(9) +
    'LastTrade'
  );
  console.log('-'.repeat(180));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(
      String(i + 1).padEnd(4) +
      r.wallet.padEnd(44) +
      Number(r.log_growth_per_day).toFixed(4).padEnd(10) +
      Number(r.roi_pct_per_day).toFixed(2).padEnd(9) +
      Number(r.trades_per_day).toFixed(1).padEnd(8) +
      `$${Number(r.final_bankroll).toFixed(0)}`.padEnd(10) +
      String(r.trades_copied).padEnd(7) +
      String(r.trades_skipped).padEnd(6) +
      Number(r.ev_per_trade).toFixed(3).padEnd(9) +
      Number(r.compounding_score).toFixed(3).padEnd(9) +
      Number(r.win_rate_pct).toFixed(1).padEnd(7) +
      Number(r.median_roi_pct).toFixed(1).padEnd(9) +
      r.date_last_trade
    );
  }
  console.log('='.repeat(180));

  if (rows.length > 0) {
    console.log(`\n--- TOP RECOMMENDATIONS ---`);
    console.log(`\n#1 HIGHEST LOG GROWTH: ${rows[0].wallet}`);
    console.log(`   LogGrowth/Day: ${Number(rows[0].log_growth_per_day).toFixed(6)} | Final: $${Number(rows[0].final_bankroll).toFixed(0)} | Trades: ${rows[0].trades_copied}`);
  }
}

function exportToCSV(data: any[], filepath: string) {
  const headers = [
    'Rank', 'Wallet', 'LogGrowthPerDay', 'ROI%/Day', 'Trades/Day',
    'FinalBankroll', 'TradesCopied', 'TradesSkipped', 'EVPerTrade',
    'CompoundingScore', 'WinRate%', 'MedianROI%', 'DateLastTrade'
  ];

  const rows = data.map((r, i) => [
    i + 1, r.wallet,
    Number(r.log_growth_per_day).toFixed(8),
    Number(r.roi_pct_per_day).toFixed(6),
    Number(r.trades_per_day).toFixed(4),
    Number(r.final_bankroll).toFixed(2),
    r.trades_copied,
    r.trades_skipped,
    Number(r.ev_per_trade).toFixed(6),
    Number(r.compounding_score).toFixed(6),
    Number(r.win_rate_pct).toFixed(2),
    Number(r.median_roi_pct).toFixed(2),
    r.date_last_trade
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  writeFileSync(filepath, csv);
  console.log(`\nCSV: ${filepath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
