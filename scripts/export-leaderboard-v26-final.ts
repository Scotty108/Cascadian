/**
 * Export leaderboard v26 FINAL — reads from pre-computed temp tables.
 *
 * Requires these tables to exist (created step-by-step):
 *   lb26_step5_orders    — order-level deduped trades for 74K wallets
 *   lb26_step10_cutoffs  — 14ad/30ad cutoff dates per wallet
 *   lb26_step11_ev14ad   — final 1,368 wallets passing all filters
 *
 * Robust EV = (Win Rate × Median Win ROI) + (Loss Rate × Median Loss ROI)
 * Score = Robust EV × sqrt(Trades per Active Day)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const SETTINGS = {
  max_execution_time: 600,
  max_memory_usage: 20_000_000_000,
  join_use_nulls: 1,
} as Record<string, any>;

const S = `(resolved_at > '1970-01-01' OR is_closed = 1)`;

async function main() {
  console.log('=== Leaderboard v26 Final Export ===');
  console.log('Reading from pre-computed temp tables...\n');

  const s = Date.now();

  const query = `
    SELECT
      w.wallet as wallet,

      -- Lifetime
      w.total_trades, w.markets_traded, w.wins, w.losses, w.win_rate_pct,
      w.total_volume_usd, w.total_pnl_usd, w.median_bet_usd,
      w.median_win_roi_pct, w.median_loss_roi_pct, w.mean_roi_pct, w.median_roi_pct,
      w.active_days,
      round(w.total_trades / greatest(w.active_days, 1), 2) as trades_per_active_day,
      round((w._wr * w._mwr + (1 - w._wr) * w._mlr) * 100, 4) as robust_ev_pct,
      round(
        (w._wr * w._mwr + (1 - w._wr) * w._mlr) * 100
        * sqrt(w.total_trades / greatest(w.active_days, 1)), 4
      ) as score,
      w.first_trade, w.last_trade,

      -- 30 active days
      m30.total_trades_30ad, m30.markets_traded_30ad, m30.wins_30ad, m30.losses_30ad,
      m30.win_rate_30ad_pct,
      m30.total_volume_30ad_usd, m30.total_pnl_30ad_usd,
      m30.median_win_roi_30ad_pct, m30.median_loss_roi_30ad_pct,
      m30.mean_roi_30ad_pct, m30.median_roi_30ad_pct,
      m30.active_days_30ad,
      round(m30.total_trades_30ad / greatest(m30.active_days_30ad, 1), 2) as trades_per_active_day_30ad,
      round((m30._wr30 * m30._mwr30 + (1 - m30._wr30) * m30._mlr30) * 100, 4) as robust_ev_30ad_pct,
      round(
        (m30._wr30 * m30._mwr30 + (1 - m30._wr30) * m30._mlr30) * 100
        * sqrt(m30.total_trades_30ad / greatest(m30.active_days_30ad, 1)), 4
      ) as score_30ad,

      -- 14 active days
      m14.total_trades_14ad, m14.markets_traded_14ad, m14.wins_14ad, m14.losses_14ad,
      m14.win_rate_14ad_pct,
      m14.total_volume_14ad_usd, m14.total_pnl_14ad_usd,
      m14.median_win_roi_14ad_pct, m14.median_loss_roi_14ad_pct,
      m14.mean_roi_14ad_pct, m14.median_roi_14ad_pct,
      m14.active_days_14ad,
      round(m14.total_trades_14ad / greatest(m14.active_days_14ad, 1), 2) as trades_per_active_day_14ad,
      round((m14._wr14 * m14._mwr14 + (1 - m14._wr14) * m14._mlr14) * 100, 4) as robust_ev_14ad_pct,
      round(
        (m14._wr14 * m14._mwr14 + (1 - m14._wr14) * m14._mlr14) * 100
        * sqrt(m14.total_trades_14ad / greatest(m14.active_days_14ad, 1)), 4
      ) as score_14ad

    FROM (
      SELECT wallet,
        countIf(${S}) as total_trades,
        countDistinctIf(condition_id, ${S}) as markets_traded,
        countIf(pnl_usd > 0 AND ${S}) as wins,
        countIf(pnl_usd <= 0 AND ${S}) as losses,
        round(countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as win_rate_pct,
        round(sum(cost_usd), 2) as total_volume_usd,
        round(sumIf(pnl_usd, ${S}), 2) as total_pnl_usd,
        round(median(cost_usd), 2) as median_bet_usd,
        round(medianIf(roi, pnl_usd > 0 AND ${S}) * 100, 2) as median_win_roi_pct,
        round(medianIf(roi, pnl_usd <= 0 AND ${S}) * 100, 2) as median_loss_roi_pct,
        round(avgIf(roi, ${S}) * 100, 2) as mean_roi_pct,
        round(medianIf(roi, ${S}) * 100, 2) as median_roi_pct,
        count(DISTINCT toDate(entry_time)) as active_days,
        min(entry_time) as first_trade,
        max(entry_time) as last_trade,
        countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr,
        medianIf(roi, pnl_usd > 0 AND ${S}) as _mwr,
        medianIf(roi, pnl_usd <= 0 AND ${S}) as _mlr
      FROM lb26_step5_orders
      WHERE wallet IN (SELECT wallet FROM lb26_step11_ev14ad)
      GROUP BY wallet
    ) w

    INNER JOIN (
      SELECT t.wallet as wallet,
        countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1) as total_trades_30ad,
        countDistinctIf(t.condition_id, t.resolved_at > '1970-01-01' OR t.is_closed = 1) as markets_traded_30ad,
        countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as wins_30ad,
        countIf(t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as losses_30ad,
        round(countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) /
          greatest(countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1), 1) * 100, 2) as win_rate_30ad_pct,
        round(sum(t.cost_usd), 2) as total_volume_30ad_usd,
        round(sumIf(t.pnl_usd, t.resolved_at > '1970-01-01' OR t.is_closed = 1), 2) as total_pnl_30ad_usd,
        round(medianIf(t.roi, t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) * 100, 2) as median_win_roi_30ad_pct,
        round(medianIf(t.roi, t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) * 100, 2) as median_loss_roi_30ad_pct,
        round(avgIf(t.roi, t.resolved_at > '1970-01-01' OR t.is_closed = 1) * 100, 2) as mean_roi_30ad_pct,
        round(medianIf(t.roi, t.resolved_at > '1970-01-01' OR t.is_closed = 1) * 100, 2) as median_roi_30ad_pct,
        count(DISTINCT toDate(t.entry_time)) as active_days_30ad,
        countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) /
          greatest(countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1), 1) as _wr30,
        medianIf(t.roi, t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as _mwr30,
        medianIf(t.roi, t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as _mlr30
      FROM lb26_step5_orders t
      INNER JOIN lb26_step10_cutoffs c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_30ad
      GROUP BY t.wallet
    ) m30 ON w.wallet = m30.wallet

    INNER JOIN (
      SELECT t.wallet as wallet,
        countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1) as total_trades_14ad,
        countDistinctIf(t.condition_id, t.resolved_at > '1970-01-01' OR t.is_closed = 1) as markets_traded_14ad,
        countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as wins_14ad,
        countIf(t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as losses_14ad,
        round(countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) /
          greatest(countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1), 1) * 100, 2) as win_rate_14ad_pct,
        round(sum(t.cost_usd), 2) as total_volume_14ad_usd,
        round(sumIf(t.pnl_usd, t.resolved_at > '1970-01-01' OR t.is_closed = 1), 2) as total_pnl_14ad_usd,
        round(medianIf(t.roi, t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) * 100, 2) as median_win_roi_14ad_pct,
        round(medianIf(t.roi, t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) * 100, 2) as median_loss_roi_14ad_pct,
        round(avgIf(t.roi, t.resolved_at > '1970-01-01' OR t.is_closed = 1) * 100, 2) as mean_roi_14ad_pct,
        round(medianIf(t.roi, t.resolved_at > '1970-01-01' OR t.is_closed = 1) * 100, 2) as median_roi_14ad_pct,
        count(DISTINCT toDate(t.entry_time)) as active_days_14ad,
        countIf(t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) /
          greatest(countIf(t.resolved_at > '1970-01-01' OR t.is_closed = 1), 1) as _wr14,
        medianIf(t.roi, t.pnl_usd > 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as _mwr14,
        medianIf(t.roi, t.pnl_usd <= 0 AND (t.resolved_at > '1970-01-01' OR t.is_closed = 1)) as _mlr14
      FROM lb26_step5_orders t
      INNER JOIN lb26_step10_cutoffs c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_14ad
      GROUP BY t.wallet
    ) m14 ON w.wallet = m14.wallet

    ORDER BY (w._wr * w._mwr + (1 - w._wr) * w._mlr) DESC

    SETTINGS join_use_nulls = 1, max_memory_usage = 20000000000
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: SETTINGS,
  });

  const rows = (await result.json()) as any[];
  console.log(`Query completed in ${((Date.now() - s) / 1000).toFixed(0)}s — ${rows.length} wallets\n`);

  // Build CSV
  const headers = [
    'wallet',
    'total_trades', 'markets_traded', 'wins', 'losses', 'win_rate_pct',
    'total_volume_usd', 'total_pnl_usd', 'median_bet_usd',
    'median_win_roi_pct', 'median_loss_roi_pct', 'mean_roi_pct', 'median_roi_pct',
    'active_days', 'trades_per_active_day',
    'robust_ev_pct', 'score',
    'first_trade', 'last_trade',
    'total_trades_30ad', 'markets_traded_30ad', 'wins_30ad', 'losses_30ad', 'win_rate_30ad_pct',
    'total_volume_30ad_usd', 'total_pnl_30ad_usd',
    'median_win_roi_30ad_pct', 'median_loss_roi_30ad_pct', 'mean_roi_30ad_pct', 'median_roi_30ad_pct',
    'active_days_30ad', 'trades_per_active_day_30ad',
    'robust_ev_30ad_pct', 'score_30ad',
    'total_trades_14ad', 'markets_traded_14ad', 'wins_14ad', 'losses_14ad', 'win_rate_14ad_pct',
    'total_volume_14ad_usd', 'total_pnl_14ad_usd',
    'median_win_roi_14ad_pct', 'median_loss_roi_14ad_pct', 'mean_roi_14ad_pct', 'median_roi_14ad_pct',
    'active_days_14ad', 'trades_per_active_day_14ad',
    'robust_ev_14ad_pct', 'score_14ad',
  ];

  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push(headers.map(h => row[h] ?? '').join(','));
  }

  const outPath = 'exports/leaderboard-v26.csv';
  fs.mkdirSync('exports', { recursive: true });
  fs.writeFileSync(outPath, csvLines.join('\n'));
  console.log(`Exported ${rows.length} wallets to ${outPath}`);

  console.log(`\nTop 10 by Robust EV (lifetime):`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.wallet}  robust_ev=${r.robust_ev_pct}%  score=${r.score}  trades=${r.total_trades}  pnl=$${r.total_pnl_usd}  wr=${r.win_rate_pct}%  med_bet=$${r.median_bet_usd}`);
  }
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
