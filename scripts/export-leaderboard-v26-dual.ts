/**
 * Export leaderboard v26 DUAL — position-level filtered, both metric sets.
 *
 * Reads from pre-computed temp tables:
 *   lb26_step5_orders      — order-level deduped trades
 *   lb26_step5b_positions   — position-level deduped trades
 *   lb26_step10b_cutoffs    — 14ad/30ad cutoff dates (position-level)
 *   lb26_step11b_ev14ad     — final wallets (position-level filtered)
 *
 * Ranked by position-level Robust EV (lifetime) descending.
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

function metricsBlock(table: string, prefix: string, suffix: string, entryFilter: string = '') {
  const p = prefix ? `${prefix}_` : '';
  const s = suffix ? `_${suffix}` : '';
  const where = entryFilter ? `AND ${entryFilter}` : '';
  return `
    SELECT wallet,
      countIf(${S}) as ${p}trades${s},
      countDistinctIf(condition_id, ${S}) as ${p}markets${s},
      countIf(pnl_usd > 0 AND ${S}) as ${p}wins${s},
      countIf(pnl_usd <= 0 AND ${S}) as ${p}losses${s},
      round(countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as ${p}wr_pct${s},
      round(sum(cost_usd), 2) as ${p}volume${s},
      round(sumIf(pnl_usd, ${S}), 2) as ${p}pnl${s},
      round(median(cost_usd), 2) as ${p}med_bet${s},
      round(medianIf(roi, pnl_usd > 0 AND ${S}) * 100, 2) as ${p}med_win_roi${s},
      round(medianIf(roi, pnl_usd <= 0 AND ${S}) * 100, 2) as ${p}med_loss_roi${s},
      round(avgIf(roi, ${S}) * 100, 2) as ${p}mean_roi${s},
      round(medianIf(roi, ${S}) * 100, 2) as ${p}med_roi${s},
      count(DISTINCT toDate(entry_time)) as ${p}active_days${s},
      countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr_${prefix}${s},
      medianIf(roi, pnl_usd > 0 AND ${S}) as _mwr_${prefix}${s},
      medianIf(roi, pnl_usd <= 0 AND ${S}) as _mlr_${prefix}${s}
    FROM ${table}
    WHERE wallet IN (SELECT wallet FROM lb26_step11b_ev14ad) ${where}
    GROUP BY wallet
  `;
}

async function main() {
  console.log('=== Leaderboard v26 Dual Export ===');
  console.log('Position-level filtered, both order + position metrics\n');

  const s = Date.now();

  const query = `
    SELECT
      p.wallet as wallet,

      -- Position-level lifetime
      p.pos_trades as pos_trades, p.pos_markets as pos_markets,
      p.pos_wins as pos_wins, p.pos_losses as pos_losses, p.pos_wr_pct as pos_wr_pct,
      p.pos_volume as pos_volume, p.pos_pnl as pos_pnl, p.pos_med_bet as pos_med_bet,
      p.pos_med_win_roi as pos_med_win_roi, p.pos_med_loss_roi as pos_med_loss_roi,
      p.pos_mean_roi as pos_mean_roi, p.pos_med_roi as pos_med_roi,
      p.pos_active_days as pos_active_days,
      round(p.pos_trades / greatest(p.pos_active_days, 1), 2) as pos_trades_per_day,
      round((p._wr_pos * p._mwr_pos + (1 - p._wr_pos) * p._mlr_pos) * 100, 4) as pos_robust_ev_pct,
      round((p._wr_pos * p._mwr_pos + (1 - p._wr_pos) * p._mlr_pos) * 100
        * sqrt(p.pos_trades / greatest(p.pos_active_days, 1)), 4) as pos_score,

      -- Order-level lifetime
      o.ord_trades as ord_trades, o.ord_markets as ord_markets,
      o.ord_wins as ord_wins, o.ord_losses as ord_losses, o.ord_wr_pct as ord_wr_pct,
      o.ord_volume as ord_volume, o.ord_pnl as ord_pnl, o.ord_med_bet as ord_med_bet,
      o.ord_med_win_roi as ord_med_win_roi, o.ord_med_loss_roi as ord_med_loss_roi,
      o.ord_mean_roi as ord_mean_roi, o.ord_med_roi as ord_med_roi,
      o.ord_active_days as ord_active_days,
      round(o.ord_trades / greatest(o.ord_active_days, 1), 2) as ord_trades_per_day,
      round((o._wr_ord * o._mwr_ord + (1 - o._wr_ord) * o._mlr_ord) * 100, 4) as ord_robust_ev_pct,
      round((o._wr_ord * o._mwr_ord + (1 - o._wr_ord) * o._mlr_ord) * 100
        * sqrt(o.ord_trades / greatest(o.ord_active_days, 1)), 4) as ord_score,

      min(p.pos_first) as first_trade,
      max(p.pos_last) as last_trade,

      -- Position-level 30ad
      p30.pos_trades_30ad, p30.pos_markets_30ad, p30.pos_wins_30ad, p30.pos_losses_30ad, p30.pos_wr_pct_30ad,
      p30.pos_pnl_30ad, p30.pos_med_win_roi_30ad, p30.pos_med_loss_roi_30ad,
      round((p30._wr_pos_30ad * p30._mwr_pos_30ad + (1 - p30._wr_pos_30ad) * p30._mlr_pos_30ad) * 100, 4) as pos_robust_ev_30ad_pct,

      -- Position-level 14ad
      p14.pos_trades_14ad, p14.pos_markets_14ad, p14.pos_wins_14ad, p14.pos_losses_14ad, p14.pos_wr_pct_14ad,
      p14.pos_pnl_14ad, p14.pos_med_win_roi_14ad, p14.pos_med_loss_roi_14ad,
      round((p14._wr_pos_14ad * p14._mwr_pos_14ad + (1 - p14._wr_pos_14ad) * p14._mlr_pos_14ad) * 100, 4) as pos_robust_ev_14ad_pct

    FROM (
      SELECT wallet,
        countIf(${S}) as pos_trades,
        countDistinctIf(condition_id, ${S}) as pos_markets,
        countIf(pnl_usd > 0 AND ${S}) as pos_wins,
        countIf(pnl_usd <= 0 AND ${S}) as pos_losses,
        round(countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as pos_wr_pct,
        round(sum(cost_usd), 2) as pos_volume,
        round(sumIf(pnl_usd, ${S}), 2) as pos_pnl,
        round(median(cost_usd), 2) as pos_med_bet,
        round(medianIf(roi, pnl_usd > 0 AND ${S}) * 100, 2) as pos_med_win_roi,
        round(medianIf(roi, pnl_usd <= 0 AND ${S}) * 100, 2) as pos_med_loss_roi,
        round(avgIf(roi, ${S}) * 100, 2) as pos_mean_roi,
        round(medianIf(roi, ${S}) * 100, 2) as pos_med_roi,
        count(DISTINCT toDate(entry_time)) as pos_active_days,
        min(entry_time) as pos_first,
        max(entry_time) as pos_last,
        countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr_pos,
        medianIf(roi, pnl_usd > 0 AND ${S}) as _mwr_pos,
        medianIf(roi, pnl_usd <= 0 AND ${S}) as _mlr_pos
      FROM lb26_step5b_positions
      WHERE wallet IN (SELECT wallet FROM lb26_step11b_ev14ad)
      GROUP BY wallet
    ) p

    INNER JOIN (
      SELECT wallet,
        countIf(${S}) as ord_trades,
        countDistinctIf(condition_id, ${S}) as ord_markets,
        countIf(pnl_usd > 0 AND ${S}) as ord_wins,
        countIf(pnl_usd <= 0 AND ${S}) as ord_losses,
        round(countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as ord_wr_pct,
        round(sum(cost_usd), 2) as ord_volume,
        round(sumIf(pnl_usd, ${S}), 2) as ord_pnl,
        round(median(cost_usd), 2) as ord_med_bet,
        round(medianIf(roi, pnl_usd > 0 AND ${S}) * 100, 2) as ord_med_win_roi,
        round(medianIf(roi, pnl_usd <= 0 AND ${S}) * 100, 2) as ord_med_loss_roi,
        round(avgIf(roi, ${S}) * 100, 2) as ord_mean_roi,
        round(medianIf(roi, ${S}) * 100, 2) as ord_med_roi,
        count(DISTINCT toDate(entry_time)) as ord_active_days,
        countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr_ord,
        medianIf(roi, pnl_usd > 0 AND ${S}) as _mwr_ord,
        medianIf(roi, pnl_usd <= 0 AND ${S}) as _mlr_ord
      FROM lb26_step5_orders
      WHERE wallet IN (SELECT wallet FROM lb26_step11b_ev14ad)
      GROUP BY wallet
    ) o ON p.wallet = o.wallet

    INNER JOIN (
      SELECT t.wallet,
        countIf(${S}) as pos_trades_30ad,
        countDistinctIf(t.condition_id, ${S}) as pos_markets_30ad,
        countIf(t.pnl_usd > 0 AND ${S}) as pos_wins_30ad,
        countIf(t.pnl_usd <= 0 AND ${S}) as pos_losses_30ad,
        round(countIf(t.pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as pos_wr_pct_30ad,
        round(sumIf(t.pnl_usd, ${S}), 2) as pos_pnl_30ad,
        round(medianIf(t.roi, t.pnl_usd > 0 AND ${S}) * 100, 2) as pos_med_win_roi_30ad,
        round(medianIf(t.roi, t.pnl_usd <= 0 AND ${S}) * 100, 2) as pos_med_loss_roi_30ad,
        countIf(t.pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr_pos_30ad,
        medianIf(t.roi, t.pnl_usd > 0 AND ${S}) as _mwr_pos_30ad,
        medianIf(t.roi, t.pnl_usd <= 0 AND ${S}) as _mlr_pos_30ad
      FROM lb26_step5b_positions t
      INNER JOIN lb26_step10b_cutoffs c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_30ad
      GROUP BY t.wallet
    ) p30 ON p.wallet = p30.wallet

    INNER JOIN (
      SELECT t.wallet,
        countIf(${S}) as pos_trades_14ad,
        countDistinctIf(t.condition_id, ${S}) as pos_markets_14ad,
        countIf(t.pnl_usd > 0 AND ${S}) as pos_wins_14ad,
        countIf(t.pnl_usd <= 0 AND ${S}) as pos_losses_14ad,
        round(countIf(t.pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) * 100, 2) as pos_wr_pct_14ad,
        round(sumIf(t.pnl_usd, ${S}), 2) as pos_pnl_14ad,
        round(medianIf(t.roi, t.pnl_usd > 0 AND ${S}) * 100, 2) as pos_med_win_roi_14ad,
        round(medianIf(t.roi, t.pnl_usd <= 0 AND ${S}) * 100, 2) as pos_med_loss_roi_14ad,
        countIf(t.pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as _wr_pos_14ad,
        medianIf(t.roi, t.pnl_usd > 0 AND ${S}) as _mwr_pos_14ad,
        medianIf(t.roi, t.pnl_usd <= 0 AND ${S}) as _mlr_pos_14ad
      FROM lb26_step5b_positions t
      INNER JOIN lb26_step10b_cutoffs c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_14ad
      GROUP BY t.wallet
    ) p14 ON p.wallet = p14.wallet

    GROUP BY
      p.wallet,
      p.pos_trades, p.pos_markets, p.pos_wins, p.pos_losses, p.pos_wr_pct,
      p.pos_volume, p.pos_pnl, p.pos_med_bet,
      p.pos_med_win_roi, p.pos_med_loss_roi, p.pos_mean_roi, p.pos_med_roi,
      p.pos_active_days, p._wr_pos, p._mwr_pos, p._mlr_pos,
      o.ord_trades, o.ord_markets, o.ord_wins, o.ord_losses, o.ord_wr_pct,
      o.ord_volume, o.ord_pnl, o.ord_med_bet,
      o.ord_med_win_roi, o.ord_med_loss_roi, o.ord_mean_roi, o.ord_med_roi,
      o.ord_active_days, o._wr_ord, o._mwr_ord, o._mlr_ord,
      p30.pos_trades_30ad, p30.pos_markets_30ad, p30.pos_wins_30ad, p30.pos_losses_30ad, p30.pos_wr_pct_30ad,
      p30.pos_pnl_30ad, p30.pos_med_win_roi_30ad, p30.pos_med_loss_roi_30ad,
      p30._wr_pos_30ad, p30._mwr_pos_30ad, p30._mlr_pos_30ad,
      p14.pos_trades_14ad, p14.pos_markets_14ad, p14.pos_wins_14ad, p14.pos_losses_14ad, p14.pos_wr_pct_14ad,
      p14.pos_pnl_14ad, p14.pos_med_win_roi_14ad, p14.pos_med_loss_roi_14ad,
      p14._wr_pos_14ad, p14._mwr_pos_14ad, p14._mlr_pos_14ad

    ORDER BY (p._wr_pos * p._mwr_pos + (1 - p._wr_pos) * p._mlr_pos) DESC

    SETTINGS join_use_nulls = 1, max_memory_usage = 20000000000
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: SETTINGS,
  });

  const rows = (await result.json()) as any[];
  console.log(`Query completed in ${((Date.now() - s) / 1000).toFixed(0)}s — ${rows.length} wallets\n`);

  const headers = [
    'wallet',
    // Position-level lifetime
    'pos_trades', 'pos_markets', 'pos_wins', 'pos_losses', 'pos_wr_pct',
    'pos_volume', 'pos_pnl', 'pos_med_bet',
    'pos_med_win_roi', 'pos_med_loss_roi', 'pos_mean_roi', 'pos_med_roi',
    'pos_active_days', 'pos_trades_per_day', 'pos_robust_ev_pct', 'pos_score',
    // Order-level lifetime
    'ord_trades', 'ord_markets', 'ord_wins', 'ord_losses', 'ord_wr_pct',
    'ord_volume', 'ord_pnl', 'ord_med_bet',
    'ord_med_win_roi', 'ord_med_loss_roi', 'ord_mean_roi', 'ord_med_roi',
    'ord_active_days', 'ord_trades_per_day', 'ord_robust_ev_pct', 'ord_score',
    // Dates
    'first_trade', 'last_trade',
    // Position-level 30ad
    'pos_trades_30ad', 'pos_markets_30ad', 'pos_wins_30ad', 'pos_losses_30ad', 'pos_wr_pct_30ad',
    'pos_pnl_30ad', 'pos_med_win_roi_30ad', 'pos_med_loss_roi_30ad', 'pos_robust_ev_30ad_pct',
    // Position-level 14ad
    'pos_trades_14ad', 'pos_markets_14ad', 'pos_wins_14ad', 'pos_losses_14ad', 'pos_wr_pct_14ad',
    'pos_pnl_14ad', 'pos_med_win_roi_14ad', 'pos_med_loss_roi_14ad', 'pos_robust_ev_14ad_pct',
  ];

  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push(headers.map(h => row[h] ?? '').join(','));
  }

  const outPath = 'exports/leaderboard-v26.csv';
  fs.mkdirSync('exports', { recursive: true });
  fs.writeFileSync(outPath, csvLines.join('\n'));
  console.log(`Exported ${rows.length} wallets to ${outPath}`);

  console.log(`\nTop 10 by Position-Level Robust EV:`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.wallet}  pos_ev=${r.pos_robust_ev_pct}%  ord_ev=${r.ord_robust_ev_pct}%  pos_trades=${r.pos_trades}  ord_trades=${r.ord_trades}  pnl=$${r.pos_pnl}  wr=${r.pos_wr_pct}%`);
  }
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
