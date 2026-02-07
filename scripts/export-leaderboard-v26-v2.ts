/**
 * Export leaderboard v26 v2 — Fixed ROI methodology.
 *
 * Fixes from v1:
 *   - SHORT positions now have correct ROI (pnl / abs(cost)) instead of 0
 *   - bet_usd = abs(cost_usd), always positive
 *   - Median win/loss ROI computed from LONGS ONLY (shorts always = 100%, distorts median)
 *   - ROI capped at 10x (1000%) for median calculations (prevents penny-bet distortion)
 *   - Loss ROI floored at -1.0 (-100%)
 *   - PnL > 0 filter (must be net profitable)
 *   - Expectancy (PnL/Volume) as additional ranking metric
 *
 * Temp tables:
 *   lb26_step5_orders        — order-level deduped trades (105.9M rows)
 *   lb26_step5b_positions_v2 — position-level with fixed ROI (22.7M rows)
 *   lb26_step10b_v2          — 14ad/30ad cutoff dates
 *   lb26_step11b_v2          — final 2,240 wallets
 *
 * Robust EV = (WinRate_all × MedianWinROI_longs_capped) + (LossRate_all × MedianLossROI_longs_floored)
 * Score = Robust EV × sqrt(Positions per Active Day)
 * Expectancy = Total PnL / Total Volume (return per dollar deployed)
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
  console.log('=== Leaderboard v26 v2 Export ===');
  console.log('Fixed ROI: longs-only, capped at 10x, abs(cost) for bet size');
  console.log('Ranked by expectancy (PnL / Volume)\n');

  const s = Date.now();

  const query = `
    SELECT
      p.wallet as wallet,

      -- Position-level lifetime (fixed methodology)
      p.pos_trades, p.pos_markets, p.pos_wins, p.pos_losses,
      round(p.pos_wr * 100, 2) as pos_wr_pct,
      round(p.pos_volume, 2) as pos_volume,
      round(p.p_pnl, 2) as pos_pnl,
      round(p.pos_med_bet, 2) as pos_med_bet,
      round(p.pos_mwr_long_c * 100, 2) as pos_med_win_roi_pct,
      round(p.pos_mlr_long_c * 100, 2) as pos_med_loss_roi_pct,
      p.pos_active_days,
      round(p.pos_trades / greatest(p.pos_active_days, 1), 2) as pos_trades_per_day,
      round((p.pos_wr * p.pos_mwr_long_c + (1 - p.pos_wr) * p.pos_mlr_long_c) * 100, 4) as pos_robust_ev_pct,
      round(
        (p.pos_wr * p.pos_mwr_long_c + (1 - p.pos_wr) * p.pos_mlr_long_c) * 100
        * sqrt(p.pos_trades / greatest(p.pos_active_days, 1)), 4
      ) as pos_score,
      round(p.p_pnl / greatest(p.pos_volume, 1) * 100, 2) as pos_expectancy_pct,
      p.pos_short_pct,
      p.pos_first as first_trade,
      p.pos_last as last_trade,

      -- Order-level lifetime (also fixed)
      o.ord_trades, o.ord_markets, o.ord_wins, o.ord_losses,
      round(o.ord_wr * 100, 2) as ord_wr_pct,
      round(o.ord_volume, 2) as ord_volume,
      round(o.o_pnl, 2) as ord_pnl,
      round(o.ord_med_bet, 2) as ord_med_bet,
      o.ord_active_days,
      round(o.ord_trades / greatest(o.ord_active_days, 1), 2) as ord_trades_per_day,
      round(o.o_pnl / greatest(o.ord_volume, 1) * 100, 2) as ord_expectancy_pct,

      -- Position-level 30ad
      p30.pos_trades_30ad, p30.pos_markets_30ad, p30.pos_wins_30ad, p30.pos_losses_30ad,
      round(p30.pos_wr_30ad * 100, 2) as pos_wr_30ad_pct,
      round(p30.p_pnl_30ad, 2) as pos_pnl_30ad,
      round(p30.pos_mwr30_c * 100, 2) as pos_med_win_roi_30ad_pct,
      round(p30.pos_mlr30_c * 100, 2) as pos_med_loss_roi_30ad_pct,
      round((p30.pos_wr_30ad * p30.pos_mwr30_c + (1 - p30.pos_wr_30ad) * p30.pos_mlr30_c) * 100, 4) as pos_robust_ev_30ad_pct,
      round(p30.p_pnl_30ad / greatest(p30.pos_vol_30ad, 1) * 100, 2) as pos_expectancy_30ad_pct,

      -- Position-level 14ad
      p14.pos_trades_14ad, p14.pos_markets_14ad, p14.pos_wins_14ad, p14.pos_losses_14ad,
      round(p14.pos_wr_14ad * 100, 2) as pos_wr_14ad_pct,
      round(p14.p_pnl_14ad, 2) as pos_pnl_14ad,
      round(p14.pos_mwr14_c * 100, 2) as pos_med_win_roi_14ad_pct,
      round(p14.pos_mlr14_c * 100, 2) as pos_med_loss_roi_14ad_pct,
      round((p14.pos_wr_14ad * p14.pos_mwr14_c + (1 - p14.pos_wr_14ad) * p14.pos_mlr14_c) * 100, 4) as pos_robust_ev_14ad_pct,
      round(p14.p_pnl_14ad / greatest(p14.pos_vol_14ad, 1) * 100, 2) as pos_expectancy_14ad_pct

    FROM (
      SELECT wallet,
        countIf(${S}) as pos_trades,
        countDistinctIf(condition_id, ${S}) as pos_markets,
        countIf(pos_pnl > 0 AND ${S}) as pos_wins,
        countIf(pos_pnl <= 0 AND ${S}) as pos_losses,
        countIf(pos_pnl > 0 AND ${S}) / greatest(countIf(${S}), 1) as pos_wr,
        sum(bet_usd) as pos_volume,
        sumIf(pos_pnl, ${S}) as p_pnl,
        median(bet_usd) as pos_med_bet,
        medianIf(least(roi, 10.0), pos_pnl > 0 AND is_short = 0 AND ${S}) as pos_mwr_long_c,
        medianIf(greatest(roi, -1.0), pos_pnl <= 0 AND is_short = 0 AND ${S}) as pos_mlr_long_c,
        count(DISTINCT toDate(entry_time)) as pos_active_days,
        round(countIf(is_short = 1) * 100.0 / greatest(count(), 1), 1) as pos_short_pct,
        min(entry_time) as pos_first,
        max(entry_time) as pos_last
      FROM lb26_step5b_positions_v2
      WHERE wallet IN (SELECT wallet FROM lb26_step11b_v2)
      GROUP BY wallet
    ) p

    INNER JOIN (
      SELECT wallet,
        countIf(${S}) as ord_trades,
        countDistinctIf(condition_id, ${S}) as ord_markets,
        countIf(pnl_usd > 0 AND ${S}) as ord_wins,
        countIf(pnl_usd <= 0 AND ${S}) as ord_losses,
        countIf(pnl_usd > 0 AND ${S}) / greatest(countIf(${S}), 1) as ord_wr,
        sum(abs(cost_usd)) as ord_volume,
        sumIf(pnl_usd, ${S}) as o_pnl,
        median(abs(cost_usd)) as ord_med_bet,
        count(DISTINCT toDate(entry_time)) as ord_active_days
      FROM lb26_step5_orders
      WHERE wallet IN (SELECT wallet FROM lb26_step11b_v2)
      GROUP BY wallet
    ) o ON p.wallet = o.wallet

    INNER JOIN (
      SELECT t.wallet as wallet,
        countIf(${S}) as pos_trades_30ad,
        countDistinctIf(t.condition_id, ${S}) as pos_markets_30ad,
        countIf(t.pos_pnl > 0 AND ${S}) as pos_wins_30ad,
        countIf(t.pos_pnl <= 0 AND ${S}) as pos_losses_30ad,
        countIf(t.pos_pnl > 0 AND ${S}) / greatest(countIf(${S}), 1) as pos_wr_30ad,
        sumIf(t.pos_pnl, ${S}) as p_pnl_30ad,
        sum(t.bet_usd) as pos_vol_30ad,
        medianIf(least(t.roi, 10.0), t.pos_pnl > 0 AND t.is_short = 0 AND ${S}) as pos_mwr30_c,
        medianIf(greatest(t.roi, -1.0), t.pos_pnl <= 0 AND t.is_short = 0 AND ${S}) as pos_mlr30_c
      FROM lb26_step5b_positions_v2 t
      INNER JOIN lb26_step10b_v2 c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_30ad
      GROUP BY t.wallet
    ) p30 ON p.wallet = p30.wallet

    INNER JOIN (
      SELECT t.wallet as wallet,
        countIf(${S}) as pos_trades_14ad,
        countDistinctIf(t.condition_id, ${S}) as pos_markets_14ad,
        countIf(t.pos_pnl > 0 AND ${S}) as pos_wins_14ad,
        countIf(t.pos_pnl <= 0 AND ${S}) as pos_losses_14ad,
        countIf(t.pos_pnl > 0 AND ${S}) / greatest(countIf(${S}), 1) as pos_wr_14ad,
        sumIf(t.pos_pnl, ${S}) as p_pnl_14ad,
        sum(t.bet_usd) as pos_vol_14ad,
        medianIf(least(t.roi, 10.0), t.pos_pnl > 0 AND t.is_short = 0 AND ${S}) as pos_mwr14_c,
        medianIf(greatest(t.roi, -1.0), t.pos_pnl <= 0 AND t.is_short = 0 AND ${S}) as pos_mlr14_c
      FROM lb26_step5b_positions_v2 t
      INNER JOIN lb26_step10b_v2 c ON t.wallet = c.wallet
      WHERE toDate(t.entry_time) >= c.cutoff_14ad
      GROUP BY t.wallet
    ) p14 ON p.wallet = p14.wallet

    ORDER BY p.p_pnl / greatest(p.pos_volume, 1) DESC

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
    'pos_med_win_roi_pct', 'pos_med_loss_roi_pct',
    'pos_active_days', 'pos_trades_per_day',
    'pos_robust_ev_pct', 'pos_score', 'pos_expectancy_pct', 'pos_short_pct',
    'first_trade', 'last_trade',
    // Order-level lifetime
    'ord_trades', 'ord_markets', 'ord_wins', 'ord_losses', 'ord_wr_pct',
    'ord_volume', 'ord_pnl', 'ord_med_bet',
    'ord_active_days', 'ord_trades_per_day', 'ord_expectancy_pct',
    // Position 30ad
    'pos_trades_30ad', 'pos_markets_30ad', 'pos_wins_30ad', 'pos_losses_30ad', 'pos_wr_30ad_pct',
    'pos_pnl_30ad', 'pos_med_win_roi_30ad_pct', 'pos_med_loss_roi_30ad_pct',
    'pos_robust_ev_30ad_pct', 'pos_expectancy_30ad_pct',
    // Position 14ad
    'pos_trades_14ad', 'pos_markets_14ad', 'pos_wins_14ad', 'pos_losses_14ad', 'pos_wr_14ad_pct',
    'pos_pnl_14ad', 'pos_med_win_roi_14ad_pct', 'pos_med_loss_roi_14ad_pct',
    'pos_robust_ev_14ad_pct', 'pos_expectancy_14ad_pct',
  ];

  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push(headers.map(h => row[h] ?? '').join(','));
  }

  const outPath = 'exports/leaderboard-v26-v2.csv';
  fs.mkdirSync('exports', { recursive: true });
  fs.writeFileSync(outPath, csvLines.join('\n'));
  console.log(`Exported ${rows.length} wallets to ${outPath}`);

  console.log(`\nTop 15 by Expectancy (PnL / Volume):`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.wallet}  expect=${r.pos_expectancy_pct}%  rev=${r.pos_robust_ev_pct}%  trades=${r.pos_trades}  pnl=$${r.pos_pnl}  wr=${r.pos_wr_pct}%  vol=$${r.pos_volume}  short=${r.pos_short_pct}%`);
  }

  console.log(`\nBottom 5 by Expectancy:`);
  for (const r of rows.slice(-5)) {
    console.log(`  ${r.wallet}  expect=${r.pos_expectancy_pct}%  rev=${r.pos_robust_ev_pct}%  trades=${r.pos_trades}  pnl=$${r.pos_pnl}  wr=${r.pos_wr_pct}%`);
  }
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
