/**
 * Export leaderboard v26: Order-level deduped, Robust EV ranked.
 *
 * Filters (in order):
 *   1. Active last 7 days (at least one entry)
 *   2. > 12 SETTLED markets, wallet age > 3 days
 *   3. Median Win ROI > 10%
 *   4. Win Rate > 30%
 *   5. Robust EV (lifetime) > 0
 *   6. Median bet size > $5
 *   7. Max 100K order-level trades (bot filter)
 *   8. Robust EV (last 14 active days) > 0
 *   9. Ranked by Robust EV (lifetime) descending
 *
 * Robust EV = (Win Rate x Median Win ROI) + (Loss Rate x Median Loss ROI)
 * Score = Robust EV x sqrt(Trades per Active Day)
 * Trade unit = order_id (falls back to tx_hash when empty)
 * Settled = resolved_at > '1970-01-01' OR is_closed = 1
 *
 * Usage: npx tsx scripts/export-leaderboard-v26.ts
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

const SETTLED = `(resolved_at > '1970-01-01' OR is_closed = 1)`;

async function main() {
  console.log('=== Leaderboard v26 Export (Order-Level Dedup) ===');
  console.log('Robust EV = (Win Rate x Median Win ROI) + (Loss Rate x Median Loss ROI)');
  console.log('Score = Robust EV x sqrt(Trades per Active Day)');
  console.log('Trade unit = order_id (falls back to tx_hash when empty)\n');

  const ts = Date.now();
  const TEMP_PRE = `temp_lb26_pre_${ts}`;
  const TEMP_TRADES = `temp_lb26_trades_${ts}`;
  const TEMP_WALLETS = `temp_lb26_wallets_${ts}`;
  const TEMP_CUTOFFS = `temp_lb26_cutoffs_${ts}`;

  try {
    // ─── Stage 1: All fill-level filters 1-5 (approximate, to minimize Stage 2 wallet set) ───
    console.log('Stage 1: Pre-filter at fill level (filters 1-5 approx)...');
    const s1 = Date.now();

    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_PRE}` });
    await clickhouse.command({
      query: `CREATE TABLE ${TEMP_PRE} (wallet String) ENGINE = Memory`,
    });
    await clickhouse.command({
      query: `
        INSERT INTO ${TEMP_PRE}
        SELECT wallet FROM (
          SELECT wallet,
            countIf(pnl_usd > 0 AND ${SETTLED}) / greatest(countIf(${SETTLED}), 1) as wr,
            medianIf(roi, pnl_usd > 0 AND ${SETTLED}) as mwr,
            medianIf(roi, pnl_usd <= 0 AND ${SETTLED}) as mlr
          FROM pm_trade_fifo_roi_v3_mat_unified
          GROUP BY wallet
          HAVING
            max(entry_time) >= now() - INTERVAL 7 DAY
            AND countDistinctIf(condition_id, ${SETTLED}) > 12
            AND dateDiff('day', min(entry_time), now()) > 3
            AND median(cost_usd) > 5
            AND mwr > 0.10
            AND wr > 0.30
            AND (wr * mwr + (1 - wr) * mlr) > 0
        )
      `,
      clickhouse_settings: SETTINGS,
    });

    const r1 = await clickhouse.query({ query: `SELECT count() as c FROM ${TEMP_PRE}`, format: 'JSONEachRow' });
    const c1 = ((await r1.json()) as any[])[0].c;
    console.log(`  ${Number(c1).toLocaleString()} wallets pass fill-level pre-filter (${((Date.now() - s1) / 1000).toFixed(0)}s)\n`);

    // ─── Stage 2: Order-level trades for pre-filtered wallets ───
    console.log('Stage 2: Aggregating fills into order-level trades...');
    const s2 = Date.now();

    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_TRADES}` });
    await clickhouse.command({
      query: `
        CREATE TABLE ${TEMP_TRADES} (
          wallet String,
          condition_id String,
          outcome_index UInt8,
          trade_id String,
          entry_time DateTime,
          resolved_at DateTime,
          cost_usd Float64,
          pnl_usd Float64,
          exit_value Float64,
          tokens_held Float64,
          roi Float64,
          is_closed UInt8,
          is_short UInt8
        ) ENGINE = MergeTree() ORDER BY (wallet, condition_id)
      `,
    });
    await clickhouse.command({
      query: `
        INSERT INTO ${TEMP_TRADES}
        SELECT
          wallet, condition_id, outcome_index,
          if(order_id != '', order_id, tx_hash),
          min(entry_time),
          any(resolved_at),
          sum(cost_usd),
          sum(pnl_usd),
          sum(exit_value),
          sum(tokens_held),
          if(sum(cost_usd) > 0.01, sum(pnl_usd) / sum(cost_usd), 0),
          if(sum(tokens_held) < 0.01, toUInt8(1), toUInt8(0)),
          any(is_short)
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE wallet IN (SELECT wallet FROM ${TEMP_PRE})
        GROUP BY wallet, condition_id, outcome_index, if(order_id != '', order_id, tx_hash)
      `,
      clickhouse_settings: SETTINGS,
    });

    const r2 = await clickhouse.query({ query: `SELECT count() as c FROM ${TEMP_TRADES}`, format: 'JSONEachRow' });
    const c2 = ((await r2.json()) as any[])[0].c;
    console.log(`  ${Number(c2).toLocaleString()} order-level trades (${((Date.now() - s2) / 1000).toFixed(0)}s)\n`);

    // ─── Stage 3: Filters 3-5 on order-level trades ───
    // Re-filter at order level: median_win_roi>10%, wr>30%, robust_ev>0, median_bet>$5, trades<=100K
    console.log('Stage 3: Order-level filters (wr>30%, mwr>10%, ev>0, bet>$5, trades<=100K)...');
    const s3 = Date.now();

    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_WALLETS}` });
    await clickhouse.command({
      query: `CREATE TABLE ${TEMP_WALLETS} (wallet String) ENGINE = Memory`,
    });
    await clickhouse.command({
      query: `
        INSERT INTO ${TEMP_WALLETS}
        SELECT wallet FROM (
          SELECT wallet,
            count() as n_trades,
            countIf(pnl_usd > 0 AND ${SETTLED}) / greatest(countIf(${SETTLED}), 1) as wr,
            medianIf(roi, pnl_usd > 0 AND ${SETTLED}) as mwr,
            medianIf(roi, pnl_usd <= 0 AND ${SETTLED}) as mlr,
            median(cost_usd) as mbet
          FROM ${TEMP_TRADES}
          GROUP BY wallet
          HAVING mwr > 0.10
            AND wr > 0.30
            AND mbet > 5
            AND n_trades <= 100000
            AND (wr * mwr + (1 - wr) * mlr) > 0
        )
      `,
      clickhouse_settings: SETTINGS,
    });

    const r3 = await clickhouse.query({ query: `SELECT count() as c FROM ${TEMP_WALLETS}`, format: 'JSONEachRow' });
    const c3 = ((await r3.json()) as any[])[0].c;
    console.log(`  ${Number(c3).toLocaleString()} wallets pass filters 3-5 (${((Date.now() - s3) / 1000).toFixed(0)}s)\n`);

    // ─── Stage 4: Active-day cutoffs (14ad, 30ad) ───
    console.log('Stage 4: Computing active-day cutoffs (14ad, 30ad)...');
    const s4 = Date.now();

    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_CUTOFFS}` });
    await clickhouse.command({
      query: `CREATE TABLE ${TEMP_CUTOFFS} (wallet String, cutoff_14ad Date, cutoff_30ad Date) ENGINE = Memory`,
    });
    await clickhouse.command({
      query: `
        INSERT INTO ${TEMP_CUTOFFS}
        SELECT wallet,
          arrayElement(arrayReverseSort(groupUniqArray(toDate(entry_time))),
            least(14, length(groupUniqArray(toDate(entry_time))))) as cutoff_14ad,
          arrayElement(arrayReverseSort(groupUniqArray(toDate(entry_time))),
            least(30, length(groupUniqArray(toDate(entry_time))))) as cutoff_30ad
        FROM ${TEMP_TRADES}
        WHERE wallet IN (SELECT wallet FROM ${TEMP_WALLETS})
        GROUP BY wallet
      `,
      clickhouse_settings: SETTINGS,
    });
    console.log(`  Done (${((Date.now() - s4) / 1000).toFixed(0)}s)\n`);

    // ─── Stage 5: All metrics (lifetime + 30ad + 14ad) + Filter 6 ───
    console.log('Stage 5: Computing all metrics (lifetime + 30ad + 14ad)...');
    const s5 = Date.now();

    // Settled filter for temp_trades columns
    const S = `(resolved_at > '1970-01-01' OR is_closed = 1)`;

    const fullQuery = `
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
          countIf(${SETTLED}) as total_trades,
          countDistinctIf(condition_id, ${SETTLED}) as markets_traded,
          countIf(pnl_usd > 0 AND ${SETTLED}) as wins,
          countIf(pnl_usd <= 0 AND ${SETTLED}) as losses,
          round(countIf(pnl_usd > 0 AND ${SETTLED}) / greatest(countIf(${SETTLED}), 1) * 100, 2) as win_rate_pct,
          round(sum(cost_usd), 2) as total_volume_usd,
          round(sumIf(pnl_usd, ${SETTLED}), 2) as total_pnl_usd,
          round(medianIf(roi, pnl_usd > 0 AND ${SETTLED}) * 100, 2) as median_win_roi_pct,
          round(medianIf(roi, pnl_usd <= 0 AND ${SETTLED}) * 100, 2) as median_loss_roi_pct,
          round(avgIf(roi, ${SETTLED}) * 100, 2) as mean_roi_pct,
          round(medianIf(roi, ${SETTLED}) * 100, 2) as median_roi_pct,
          count(DISTINCT toDate(entry_time)) as active_days,
          round(median(cost_usd), 2) as median_bet_usd,
          min(entry_time) as first_trade,
          max(entry_time) as last_trade,
          countIf(pnl_usd > 0 AND ${SETTLED}) / greatest(countIf(${SETTLED}), 1) as _wr,
          medianIf(roi, pnl_usd > 0 AND ${SETTLED}) as _mwr,
          medianIf(roi, pnl_usd <= 0 AND ${SETTLED}) as _mlr
        FROM ${TEMP_TRADES}
        WHERE wallet IN (SELECT wallet FROM ${TEMP_WALLETS})
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
        FROM ${TEMP_TRADES} t
        INNER JOIN ${TEMP_CUTOFFS} c ON t.wallet = c.wallet
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
        FROM ${TEMP_TRADES} t
        INNER JOIN ${TEMP_CUTOFFS} c ON t.wallet = c.wallet
        WHERE toDate(t.entry_time) >= c.cutoff_14ad
        GROUP BY t.wallet
      ) m14 ON w.wallet = m14.wallet

      -- Filter 6: Robust EV (14 active days) > 0
      WHERE (m14._wr14 * m14._mwr14 + (1 - m14._wr14) * m14._mlr14) > 0

      ORDER BY (w._wr * w._mwr + (1 - w._wr) * w._mlr) DESC

      SETTINGS join_use_nulls = 1, max_memory_usage = 20000000000
    `;

    const result = await clickhouse.query({
      query: fullQuery,
      format: 'JSONEachRow',
      clickhouse_settings: SETTINGS,
    });

    const rows = (await result.json()) as any[];
    console.log(`  Query completed in ${((Date.now() - s5) / 1000).toFixed(0)}s — ${rows.length} wallets\n`);

    // ─── Stage 6: Build CSV ───
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
      console.log(`  ${r.wallet}  robust_ev=${r.robust_ev_pct}%  score=${r.score}  trades=${r.total_trades}  pnl=$${r.total_pnl_usd}  win_rate=${r.win_rate_pct}%`);
    }

  } finally {
    console.log('\nCleaning up temp tables...');
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_PRE}` }).catch(() => {});
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_TRADES}` }).catch(() => {});
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_WALLETS}` }).catch(() => {});
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_CUTOFFS}` }).catch(() => {});
  }
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0); })
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
