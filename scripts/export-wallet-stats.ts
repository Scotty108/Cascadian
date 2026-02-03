#!/usr/bin/env npx tsx
/**
 * Export comprehensive stats for specific wallets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.query({ query: sql });
}

const WALLETS = [
  '0xf0ec554fe75d57fef3f2404fce070b5c71d46064',
  '0xda3a9b7afff7b44ad4fd75308723194e0a11381f',
  '0x9ad091ca2e8f1bd69f27662edcb49dceeaa5bf3d',
  '0x9aeb534c42b58b21673d5e03e9da14fbd15b2729',
  '0x2cad53bb58c266ea91eea0d7ca54303a10bceb66',
  '0x9e8ecc4cb3c4e48f544cba2fbbb252a6a65e8db8',
  '0x75177693e4ecdd01a33cb43ba3fe606dcf750353',
  '0xba0c57dcba0cd24cef505ef3f4b0c8c0044bf837',
  '0xacbdc11ba2823bb5ba9ca327071632e931586af3',
  '0x4264c89c255da3094b338d33da241e50b1ed007c',
  '0xb11f82599bb6036ef801851f03254de53b1a9953',
  '0xd19810d60a7487e5eae726e3fac270bf73e78797',
  '0xcad4dd748092c65f339ea1b30a163e9ba6a4c108',
  '0x29aefda7ce9c7b0269fa318f66196e9796834d2c',
  '0xcf0aca0d7a395202aec661c3666be9cc098e320a',
  '0x31864feb9d25dee93728c6225ba891530967e9ca',
  '0xef51ebb7ed5c84e5049fc76e1ae4db3b5799c0d3',
];

async function main() {
  console.log('=== Comprehensive Wallet Stats Export ===\n');

  const walletList = WALLETS.map(w => `'${w}'`).join(',');

  // Create temp table for these wallets
  await execute(`DROP TABLE IF EXISTS tmp_target_wallets`);
  await execute(`
    CREATE TABLE tmp_target_wallets ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet FROM (
      ${WALLETS.map(w => `SELECT '${w}' as wallet`).join(' UNION ALL ')}
    )
  `);

  // Build active days lookup
  console.log('Building active days lookup...');
  await execute(`DROP TABLE IF EXISTS tmp_stats_active_dates`);
  await execute(`
    CREATE TABLE tmp_stats_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT
      wallet,
      toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_target_wallets)
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_stats_last_14d`);
  await execute(`
    CREATE TABLE tmp_stats_last_14d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_stats_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_stats_last_7d`);
  await execute(`
    CREATE TABLE tmp_stats_last_7d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_stats_active_dates WHERE date_rank <= 7
  `);

  // Calculate lifetime metrics
  console.log('Calculating lifetime metrics...');
  const lifetime = await query<Record<string, any>>(`
    SELECT
      wallet,
      -- COUNTS
      count() as total_trades,
      countIf(pnl_usd > 0) as wins,
      countIf(pnl_usd <= 0) as losses,
      round(countIf(pnl_usd > 0) * 100.0 / count(), 4) as win_rate_pct,
      -- ACTIVE DAYS
      uniqExact(toDate(entry_time)) as trading_days,
      round(count() * 1.0 / uniqExact(toDate(entry_time)), 4) as trades_per_active_day,
      dateDiff('day', min(entry_time), max(entry_time)) as wallet_age_days,
      -- PNL & VOLUME
      round(sum(pnl_usd), 4) as total_pnl_usd,
      round(sum(cost_usd), 4) as total_volume_usd,
      countDistinct(condition_id) as markets_traded,
      -- BET SIZES
      round(avg(cost_usd), 4) as avg_bet_size_usd,
      round(quantile(0.5)(cost_usd), 4) as median_bet_size_usd,
      -- LOG GROWTH
      round(avg(log1p(greatest(pnl_usd / cost_usd, -0.99))) * 100, 6) as log_growth_per_trade_pct,
      round(avg(log1p(greatest(pnl_usd / cost_usd, -0.99))) * count() / uniqExact(toDate(entry_time)) * 100, 6) as daily_log_growth_pct,
      -- LOG GROWTH FOR WINS ONLY
      round(avgIf(log1p(greatest(pnl_usd / cost_usd, -0.99)), pnl_usd > 0) * 100, 6) as log_growth_per_winning_trade_pct,
      -- LOG GROWTH FOR LOSSES ONLY
      round(avgIf(log1p(greatest(pnl_usd / cost_usd, -0.99)), pnl_usd <= 0) * 100, 6) as log_growth_per_losing_trade_pct,
      -- EV
      round(((countIf(pnl_usd > 0) / count()) * quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd > 0)
        - (1 - countIf(pnl_usd > 0) / count()) * abs(quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd <= 0))) * 100, 6) as ev_pct,
      -- MEDIAN RETURNS
      round(quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd > 0) * 100, 6) as median_win_roi_pct,
      round(quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd <= 0) * 100, 6) as median_loss_roi_pct,
      round(quantile(0.5)(pnl_usd / cost_usd) * 100, 6) as median_roi_pct,
      -- MEAN RETURNS
      round(avgIf(pnl_usd / cost_usd, pnl_usd > 0) * 100, 6) as mean_win_roi_pct,
      round(avgIf(pnl_usd / cost_usd, pnl_usd <= 0) * 100, 6) as mean_loss_roi_pct,
      round(avg(pnl_usd / cost_usd) * 100, 6) as mean_roi_pct,
      -- WINSORIZATION BOUNDS
      round(quantile(0.025)(pnl_usd / cost_usd) * 100, 6) as roi_p2_5_pct,
      round(quantile(0.975)(pnl_usd / cost_usd) * 100, 6) as roi_p97_5_pct,
      -- VOLATILITY
      round(stddevPop(pnl_usd / cost_usd) * 100, 6) as roi_volatility_pct,
      round(stddevPopIf(pnl_usd / cost_usd, pnl_usd <= 0) * 100, 6) as downside_volatility_pct,
      -- HOLD TIME (seconds)
      round(avg(CASE
        WHEN resolved_at < '1971-01-01' THEN NULL
        WHEN resolved_at < entry_time AND dateDiff('second', resolved_at, entry_time) <= 300 THEN 1
        WHEN resolved_at < entry_time THEN NULL
        ELSE greatest(dateDiff('second', entry_time, resolved_at), 1)
      END), 4) as avg_hold_time_seconds,
      round(quantile(0.5)(CASE
        WHEN resolved_at < '1971-01-01' THEN NULL
        WHEN resolved_at < entry_time AND dateDiff('second', resolved_at, entry_time) <= 300 THEN 1
        WHEN resolved_at < entry_time THEN NULL
        ELSE greatest(dateDiff('second', entry_time, resolved_at), 1)
      END), 4) as median_hold_time_seconds,
      -- TIMESTAMPS
      min(entry_time) as first_trade,
      max(entry_time) as last_trade
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (${walletList})
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet
  `);

  // Calculate 14d metrics
  console.log('Calculating 14d metrics...');
  const metrics14d = await query<Record<string, any>>(`
    SELECT
      t.wallet as wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 4) as win_rate_14d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 4) as trades_per_active_day_14d,
      round(sum(t.pnl_usd), 4) as total_pnl_14d_usd,
      round(sum(t.cost_usd), 4) as total_volume_14d_usd,
      countDistinct(t.condition_id) as markets_traded_14d,
      round(avg(t.cost_usd), 4) as avg_bet_size_14d_usd,
      round(quantile(0.5)(t.cost_usd), 4) as median_bet_size_14d_usd,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 6) as log_growth_per_trade_14d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * count() / uniqExact(toDate(t.entry_time)) * 100, 6) as daily_log_growth_14d_pct,
      round(avgIf(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)), t.pnl_usd > 0) * 100, 6) as log_growth_per_winning_trade_14d_pct,
      round(avgIf(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)), t.pnl_usd <= 0) * 100, 6) as log_growth_per_losing_trade_14d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 6) as ev_14d_pct,
      round(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0) * 100, 6) as median_win_roi_14d_pct,
      round(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as median_loss_roi_14d_pct,
      round(quantile(0.5)(t.pnl_usd / t.cost_usd) * 100, 6) as median_roi_14d_pct,
      round(avgIf(t.pnl_usd / t.cost_usd, t.pnl_usd > 0) * 100, 6) as mean_win_roi_14d_pct,
      round(avgIf(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as mean_loss_roi_14d_pct,
      round(avg(t.pnl_usd / t.cost_usd) * 100, 6) as mean_roi_14d_pct,
      round(quantile(0.025)(t.pnl_usd / t.cost_usd) * 100, 6) as roi_p2_5_14d_pct,
      round(quantile(0.975)(t.pnl_usd / t.cost_usd) * 100, 6) as roi_p97_5_14d_pct,
      round(stddevPop(t.pnl_usd / t.cost_usd) * 100, 6) as roi_volatility_14d_pct,
      round(stddevPopIf(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as downside_volatility_14d_pct,
      round(avg(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('second', t.resolved_at, t.entry_time) <= 300 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('second', t.entry_time, t.resolved_at), 1)
      END), 4) as avg_hold_time_14d_seconds,
      round(quantile(0.5)(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('second', t.resolved_at, t.entry_time) <= 300 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('second', t.entry_time, t.resolved_at), 1)
      END), 4) as median_hold_time_14d_seconds
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_stats_last_14d d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Calculate 7d metrics
  console.log('Calculating 7d metrics...');
  const metrics7d = await query<Record<string, any>>(`
    SELECT
      t.wallet as wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 4) as win_rate_7d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_7d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 4) as trades_per_active_day_7d,
      round(sum(t.pnl_usd), 4) as total_pnl_7d_usd,
      round(sum(t.cost_usd), 4) as total_volume_7d_usd,
      countDistinct(t.condition_id) as markets_traded_7d,
      round(avg(t.cost_usd), 4) as avg_bet_size_7d_usd,
      round(quantile(0.5)(t.cost_usd), 4) as median_bet_size_7d_usd,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 6) as log_growth_per_trade_7d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * count() / uniqExact(toDate(t.entry_time)) * 100, 6) as daily_log_growth_7d_pct,
      round(avgIf(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)), t.pnl_usd > 0) * 100, 6) as log_growth_per_winning_trade_7d_pct,
      round(avgIf(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)), t.pnl_usd <= 0) * 100, 6) as log_growth_per_losing_trade_7d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 6) as ev_7d_pct,
      round(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0) * 100, 6) as median_win_roi_7d_pct,
      round(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as median_loss_roi_7d_pct,
      round(quantile(0.5)(t.pnl_usd / t.cost_usd) * 100, 6) as median_roi_7d_pct,
      round(avgIf(t.pnl_usd / t.cost_usd, t.pnl_usd > 0) * 100, 6) as mean_win_roi_7d_pct,
      round(avgIf(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as mean_loss_roi_7d_pct,
      round(avg(t.pnl_usd / t.cost_usd) * 100, 6) as mean_roi_7d_pct,
      round(quantile(0.025)(t.pnl_usd / t.cost_usd) * 100, 6) as roi_p2_5_7d_pct,
      round(quantile(0.975)(t.pnl_usd / t.cost_usd) * 100, 6) as roi_p97_5_7d_pct,
      round(stddevPop(t.pnl_usd / t.cost_usd) * 100, 6) as roi_volatility_7d_pct,
      round(stddevPopIf(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0) * 100, 6) as downside_volatility_7d_pct,
      round(avg(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('second', t.resolved_at, t.entry_time) <= 300 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('second', t.entry_time, t.resolved_at), 1)
      END), 4) as avg_hold_time_7d_seconds,
      round(quantile(0.5)(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('second', t.resolved_at, t.entry_time) <= 300 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('second', t.entry_time, t.resolved_at), 1)
      END), 4) as median_hold_time_7d_seconds
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_stats_last_7d d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Merge all data
  console.log('Merging data...');
  const metrics14dMap = new Map(metrics14d.map(m => [m.wallet, m]));
  const metrics7dMap = new Map(metrics7d.map(m => [m.wallet, m]));

  const data: Record<string, any>[] = [];
  for (const l of lifetime) {
    const m14 = metrics14dMap.get(l.wallet) || {};
    const m7 = metrics7dMap.get(l.wallet) || {};
    data.push({
      wallet: l.wallet,
      ...l,
      ...m14,
      ...m7,
    });
  }

  // Sort by daily_log_growth_14d_pct descending
  data.sort((a, b) => (b.daily_log_growth_14d_pct || 0) - (a.daily_log_growth_14d_pct || 0));

  // Export to CSV
  if (data.length > 0) {
    const headers = Object.keys(data[0]);
    const csvLines = [headers.join(',')];

    for (const row of data) {
      const values = headers.map((h) => {
        const v = row[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
        return String(v);
      });
      csvLines.push(values.join(','));
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = `exports/wallet-stats-${timestamp}.csv`;

    fs.writeFileSync(outputPath, csvLines.join('\n'));
    console.log(`\nExported to ${outputPath}`);
    console.log(`\n${data.length} wallets with ${headers.length} metrics each`);

    // Print summary
    console.log('\n=== SUMMARY (Ranked by Daily Log Growth 14d) ===\n');
    console.log('Wallet                                     | DailyLogGrowth14d | LogGrowth/Trade14d | Trades/Day14d | WinRate14d | PnL 14d');
    console.log('-------------------------------------------|-------------------|--------------------|--------------:|-----------:|------------:');

    for (const w of data) {
      const dlg = w.daily_log_growth_14d_pct?.toFixed(2) || 'N/A';
      const lgt = w.log_growth_per_trade_14d_pct?.toFixed(4) || 'N/A';
      const tpd = w.trades_per_active_day_14d?.toFixed(2) || 'N/A';
      const wr = w.win_rate_14d_pct?.toFixed(2) || 'N/A';
      const pnl = w.total_pnl_14d_usd?.toLocaleString() || 'N/A';
      console.log(`${w.wallet} | ${dlg.padStart(17)}% | ${lgt.padStart(18)}% | ${tpd.padStart(13)} | ${wr.padStart(10)}% | $${pnl.padStart(10)}`);
    }
  }

  // Cleanup
  await execute(`DROP TABLE IF EXISTS tmp_target_wallets`);
  await execute(`DROP TABLE IF EXISTS tmp_stats_active_dates`);
  await execute(`DROP TABLE IF EXISTS tmp_stats_last_14d`);
  await execute(`DROP TABLE IF EXISTS tmp_stats_last_7d`);

  await client.close();
}

main().catch(console.error);
