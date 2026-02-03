#!/usr/bin/env npx tsx
/**
 * Leaderboard Export v24
 *
 * Filters:
 * 1. > 10 unique markets
 * 2. Buy trade in last 5 days
 * 3. Average bet > $10
 * 4. Log growth per trade (all time) > 10%
 * 5. Log growth per trade (14d) > 10%
 *
 * Ranked by: daily_log_growth_14d = log_growth_per_trade_14d × trades_per_active_day_14d (DESC)
 *
 * Includes 2.5%/97.5% winsorization for EV calculations
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

async function main() {
  console.log('=== Leaderboard Export v24 ===\n');
  console.log('Filters:');
  console.log('  1. > 10 unique markets');
  console.log('  2. Buy trade in last 5 days');
  console.log('  3. Average bet > $10');
  console.log('  4. Log growth per trade (all time) > 10%');
  console.log('  5. Log growth per trade (14d) > 10%');
  console.log('\nRanking: daily_log_growth_14d DESC\n');

  // Step 1: Markets > 10
  console.log('Step 1: Filtering to wallets with > 10 markets...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_step1`);
  await execute(`
    CREATE TABLE tmp_v24_step1 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, countDistinct(condition_id) as markets_traded
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet
    HAVING markets_traded > 10
  `);
  const step1 = await query<{c: number}>(`SELECT count() as c FROM tmp_v24_step1`);
  console.log(`  → ${step1[0].c.toLocaleString()} wallets\n`);

  // Step 2: Buy trade in last 5 days
  console.log('Step 2: Filtering to wallets with buy trade in last 5 days...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_step2`);
  await execute(`
    CREATE TABLE tmp_v24_step2 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT DISTINCT t.wallet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_step1 s ON t.wallet = s.wallet
    WHERE t.entry_time >= now() - INTERVAL 5 DAY
  `);
  const step2 = await query<{c: number}>(`SELECT count() as c FROM tmp_v24_step2`);
  console.log(`  → ${step2[0].c.toLocaleString()} wallets\n`);

  // Step 3: Average bet > $10
  console.log('Step 3: Filtering to wallets with average bet > $10...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_step3`);
  await execute(`
    CREATE TABLE tmp_v24_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, avg(t.cost_usd) as avg_bet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_step2 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING avg_bet > 10
  `);
  const step3 = await query<{c: number}>(`SELECT count() as c FROM tmp_v24_step3`);
  console.log(`  → ${step3[0].c.toLocaleString()} wallets\n`);

  // Step 4: Log growth per trade (all time) > 10%
  console.log('Step 4: Filtering to wallets with log growth (all time) > 10%...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_step4`);
  await execute(`
    CREATE TABLE tmp_v24_step4 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_step3 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING log_growth_per_trade > 0.10
  `);
  const step4 = await query<{c: number}>(`SELECT count() as c FROM tmp_v24_step4`);
  console.log(`  → ${step4[0].c.toLocaleString()} wallets\n`);

  // Create active days lookup for step 5
  console.log('Creating active days lookup tables...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_active_dates`);
  await execute(`
    CREATE TABLE tmp_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT
      wallet,
      toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_v24_step4)
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_v24_last_14d`);
  await execute(`
    CREATE TABLE tmp_v24_last_14d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_v24_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_v24_last_7d`);
  await execute(`
    CREATE TABLE tmp_v24_last_7d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_v24_active_dates WHERE date_rank <= 7
  `);

  // Step 5: Log growth per trade (14d) > 10%
  console.log('Step 5: Filtering to wallets with log growth (14d) > 10%...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_step5`);
  await execute(`
    CREATE TABLE tmp_v24_step5 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN tmp_v24_step4 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING log_growth_per_trade_14d > 0.10
  `);
  const step5 = await query<{c: number}>(`SELECT count() as c FROM tmp_v24_step5`);
  console.log(`  → ${step5[0].c.toLocaleString()} wallets (FINAL)\n`);

  // Rebuild lookups for final wallets only
  console.log('Rebuilding lookup tables for final wallets...');
  await execute(`DROP TABLE IF EXISTS tmp_v24_active_dates`);
  await execute(`
    CREATE TABLE tmp_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT
      wallet,
      toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_v24_step5)
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_v24_last_14d`);
  await execute(`
    CREATE TABLE tmp_v24_last_14d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_v24_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_v24_last_7d`);
  await execute(`
    CREATE TABLE tmp_v24_last_7d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_v24_active_dates WHERE date_rank <= 7
  `);

  // Fetch all metrics
  const walletCount = step5[0].c;
  console.log(`Fetching metrics for ${walletCount} wallets...`);

  // Get wallet list
  const finalWallets = await query<{wallet: string}>(`SELECT wallet FROM tmp_v24_step5`);
  console.log(`  Got ${finalWallets.length} wallets from step5`);
  if (finalWallets.length === 0) {
    console.log('No wallets found! Exiting.');
    await client.close();
    return;
  }
  const walletList = finalWallets.map(w => `'${w.wallet}'`).join(',');
  console.log(`  First 3 wallets: ${finalWallets.slice(0, 3).map(w => w.wallet).join(', ')}`);

  // Lifetime metrics with winsorization
  console.log('Fetching lifetime metrics...');
  const lifetime = await query<Record<string, any>>(`
    WITH percentiles AS (
      SELECT
        wallet,
        quantile(0.025)(pnl_usd / cost_usd) as roi_floor,
        quantile(0.975)(pnl_usd / cost_usd) as roi_ceiling
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (${walletList})
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet
    )
    SELECT
      t.wallet,
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 2) as win_rate_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 4) as ev_pct,
      round((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd <= 0)) * 100, 4) as winsorized_ev_pct,
      round(any(p.roi_floor) * 100, 4) as roi_floor_pct,
      round(any(p.roi_ceiling) * 100, 4) as roi_ceiling_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_pct,
      uniqExact(toDate(t.entry_time)) as trading_days,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 2) as trades_per_active_day,
      round(sum(t.pnl_usd), 2) as total_pnl_usd,
      round(sum(t.cost_usd), 2) as total_volume_usd,
      countDistinct(t.condition_id) as markets_traded,
      round(avg(t.cost_usd), 2) as avg_bet_size_usd,
      round(quantile(0.5)(t.cost_usd), 2) as median_bet_size_usd,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade,
      dateDiff('day', min(t.entry_time), max(t.entry_time)) as wallet_age_days,
      round(avgIf(
        dateDiff('second', t.entry_time, t.resolved_at) / 60.0,
        t.resolved_at > t.entry_time AND toYear(t.resolved_at) > 1970
      ), 2) as avg_hold_time_minutes
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN percentiles p ON t.wallet = p.wallet
    WHERE t.wallet IN (${walletList})
      AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // 14d metrics with winsorization
  console.log('Fetching 14d metrics...');
  const metrics14d = await query<Record<string, any>>(`
    WITH percentiles_14d AS (
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_14d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (${walletList})
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    )
    SELECT
      t.wallet as wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 2) as win_rate_14d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 4) as ev_14d_pct,
      round((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd <= 0)) * 100, 4) as winsorized_ev_14d_pct,
      round(any(p.roi_floor_14d) * 100, 4) as roi_floor_14d_pct,
      round(any(p.roi_ceiling_14d) * 100, 4) as roi_ceiling_14d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_14d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 2) as trades_per_active_day_14d,
      round(sum(t.pnl_usd), 2) as total_pnl_14d_usd,
      round(sum(t.cost_usd), 2) as total_volume_14d_usd,
      countDistinct(t.condition_id) as markets_traded_14d,
      round(avgIf(
        dateDiff('second', t.entry_time, t.resolved_at) / 60.0,
        t.resolved_at > t.entry_time AND toYear(t.resolved_at) > 1970
      ), 2) as avg_hold_time_14d_minutes
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN percentiles_14d p ON t.wallet = p.wallet
    WHERE t.wallet IN (${walletList})
      AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // 7d metrics with winsorization
  console.log('Fetching 7d metrics...');
  const metrics7d = await query<Record<string, any>>(`
    WITH percentiles_7d AS (
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_7d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_v24_last_7d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (${walletList})
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    )
    SELECT
      t.wallet as wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 2) as win_rate_7d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 4) as ev_7d_pct,
      round((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd <= 0)) * 100, 4) as winsorized_ev_7d_pct,
      round(any(p.roi_floor_7d) * 100, 4) as roi_floor_7d_pct,
      round(any(p.roi_ceiling_7d) * 100, 4) as roi_ceiling_7d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_7d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_7d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 2) as trades_per_active_day_7d,
      round(sum(t.pnl_usd), 2) as total_pnl_7d_usd,
      round(sum(t.cost_usd), 2) as total_volume_7d_usd,
      countDistinct(t.condition_id) as markets_traded_7d,
      round(avgIf(
        dateDiff('second', t.entry_time, t.resolved_at) / 60.0,
        t.resolved_at > t.entry_time AND toYear(t.resolved_at) > 1970
      ), 2) as avg_hold_time_7d_minutes
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v24_last_7d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN percentiles_7d p ON t.wallet = p.wallet
    WHERE t.wallet IN (${walletList})
      AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Debug output
  console.log(`\nLifetime results: ${lifetime.length} wallets`);
  console.log(`14d results: ${metrics14d.length} wallets`);
  console.log(`7d results: ${metrics7d.length} wallets`);

  if (lifetime.length > 0) {
    console.log(`Lifetime first wallet keys: ${Object.keys(lifetime[0]).join(', ')}`);
  }
  if (metrics14d.length > 0) {
    console.log(`14d first wallet keys: ${Object.keys(metrics14d[0]).join(', ')}`);
  }

  // Merge data
  const metrics14dMap = new Map(metrics14d.map(m => [m.wallet, m]));
  const metrics7dMap = new Map(metrics7d.map(m => [m.wallet, m]));

  const data: Record<string, any>[] = [];
  for (const l of lifetime) {
    const m14 = metrics14dMap.get(l.wallet);
    const m7 = metrics7dMap.get(l.wallet);
    if (m14 && m7) {
      // Calculate daily log growth (the ranking metric)
      const dailyLogGrowth14d = (m14.log_growth_per_trade_14d_pct / 100) * m14.trades_per_active_day_14d * 100;
      const dailyLogGrowth7d = (m7.log_growth_per_trade_7d_pct / 100) * m7.trades_per_active_day_7d * 100;
      const dailyLogGrowthLifetime = (l.log_growth_per_trade_pct / 100) * l.trades_per_active_day * 100;

      data.push({
        wallet: l.wallet,
        // RANKING METRICS
        daily_log_growth_14d_pct: Math.round(dailyLogGrowth14d * 10000) / 10000,
        daily_log_growth_7d_pct: Math.round(dailyLogGrowth7d * 10000) / 10000,
        daily_log_growth_lifetime_pct: Math.round(dailyLogGrowthLifetime * 10000) / 10000,
        // Lifetime
        ...l,
        // 14d
        ...m14,
        // 7d
        ...m7,
      });
    }
  }

  // Sort by daily_log_growth_14d descending
  data.sort((a, b) => b.daily_log_growth_14d_pct - a.daily_log_growth_14d_pct);

  console.log(`\nMerged ${data.length} wallets with all metrics\n`);

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
    const outputPath = `exports/leaderboard-v24-${timestamp}.csv`;

    fs.writeFileSync(outputPath, csvLines.join('\n'));
    console.log(`Exported to ${outputPath}\n`);

    // Show top 20
    console.log('=== TOP 20 BY DAILY LOG GROWTH (14d) ===\n');
    console.log('Rank | Wallet                                     | DailyGrowth14d | LogGrowth/Trade | Trades/Day | WinRate | PnL 14d');
    console.log('-----|--------------------------------------------|--------------:|----------------:|-----------:|--------:|------------:');

    data.slice(0, 20).forEach((w: any, i: number) => {
      console.log(
        `${String(i + 1).padStart(4)} | ${w.wallet} | ${String(w.daily_log_growth_14d_pct.toFixed(2) + '%').padStart(13)} | ${String(w.log_growth_per_trade_14d_pct + '%').padStart(15)} | ${String(w.trades_per_active_day_14d).padStart(10)} | ${String(w.win_rate_14d_pct + '%').padStart(7)} | $${String(Number(w.total_pnl_14d_usd).toLocaleString()).padStart(10)}`
      );
    });

    console.log('\n=== FILTER FUNNEL ===');
    console.log(`${step1[0].c.toLocaleString()} → > 10 markets`);
    console.log(`${step2[0].c.toLocaleString()} → Buy trade in last 5 days`);
    console.log(`${step3[0].c.toLocaleString()} → Average bet > $10`);
    console.log(`${step4[0].c.toLocaleString()} → Log growth (all time) > 10%`);
    console.log(`${step5[0].c.toLocaleString()} → Log growth (14d) > 10% (FINAL)`);
  }

  // Cleanup
  console.log('\nCleaning up temp tables...');
  for (let i = 1; i <= 5; i++) {
    await execute(`DROP TABLE IF EXISTS tmp_v24_step${i}`);
  }
  await execute(`DROP TABLE IF EXISTS tmp_v24_active_dates`);
  await execute(`DROP TABLE IF EXISTS tmp_v24_last_14d`);
  await execute(`DROP TABLE IF EXISTS tmp_v24_last_7d`);

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
