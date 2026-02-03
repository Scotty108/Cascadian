#!/usr/bin/env npx tsx
/**
 * Leaderboard Export v23
 *
 * Filters:
 * 1. > 9 markets
 * 2. Buy trade in last 5 days
 * 3. Median bet > $10
 * 4. Log growth per trade (14d) > 0
 *
 * Ranked by: daily_log_growth_14d = log_growth_per_trade_14d × trades_per_active_day_14d (DESC)
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

async function main() {
  console.log('=== Leaderboard Export v23 ===\n');
  console.log('Filters: > 9 markets, buy in 5d, median bet > $10, log growth (14d) > 0');
  console.log('Ranking: daily_log_growth_14d = log_growth_per_trade × trades_per_active_day\n');

  // Get final wallet list from step 4
  const finalWallets = await query<{wallet: string}>(`SELECT wallet FROM tmp_v23_step4`);
  console.log(`Found ${finalWallets.length} wallets passing all filters\n`);

  const walletList = finalWallets.map(w => `'${w.wallet}'`).join(',');

  // Query lifetime metrics
  console.log('Fetching lifetime metrics...');
  const lifetime = await query<Record<string, any>>(`
    SELECT
      wallet,
      count() as total_trades,
      countIf(pnl_usd > 0) as wins,
      countIf(pnl_usd <= 0) as losses,
      round(countIf(pnl_usd > 0) * 100.0 / count(), 2) as win_rate_pct,
      round(((countIf(pnl_usd > 0) / count()) * quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd > 0)
        - (1 - countIf(pnl_usd > 0) / count()) * abs(quantileIf(0.5)(pnl_usd / cost_usd, pnl_usd <= 0))) * 100, 4) as ev_pct,
      round(avg(log1p(greatest(pnl_usd / cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_pct,
      uniqExact(toDate(entry_time)) as trading_days,
      round(count() * 1.0 / uniqExact(toDate(entry_time)), 2) as trades_per_active_day,
      round(sum(pnl_usd), 2) as total_pnl_usd,
      round(sum(cost_usd), 2) as total_volume_usd,
      countDistinct(condition_id) as markets_traded,
      min(entry_time) as first_trade,
      max(entry_time) as last_trade,
      dateDiff('day', min(entry_time), max(entry_time)) as wallet_age_days,
      round(quantile(0.5)(cost_usd), 2) as median_bet_size_usd
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (${walletList})
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet
  `);

  // Query 14d metrics
  console.log('Fetching 14d metrics...');
  const metrics14d = await query<Record<string, any>>(`
    SELECT
      t.wallet as wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 2) as win_rate_14d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 4) as ev_14d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_14d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 2) as trades_per_active_day_14d,
      round(sum(t.pnl_usd), 2) as total_pnl_14d_usd,
      round(sum(t.cost_usd), 2) as total_volume_14d_usd,
      countDistinct(t.condition_id) as markets_traded_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v23_last_14d d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE t.wallet IN (${walletList})
      AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Query 7d metrics
  console.log('Fetching 7d metrics...');
  const metrics7d = await query<Record<string, any>>(`
    SELECT
      t.wallet as wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      round(countIf(t.pnl_usd > 0) * 100.0 / count(), 2) as win_rate_7d_pct,
      round(((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0))) * 100, 4) as ev_7d_pct,
      round(avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) * 100, 4) as log_growth_per_trade_7d_pct,
      uniqExact(toDate(t.entry_time)) as trading_days_7d,
      round(count() * 1.0 / uniqExact(toDate(t.entry_time)), 2) as trades_per_active_day_7d,
      round(sum(t.pnl_usd), 2) as total_pnl_7d_usd,
      round(sum(t.cost_usd), 2) as total_volume_7d_usd,
      countDistinct(t.condition_id) as markets_traded_7d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_v23_last_7d d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE t.wallet IN (${walletList})
      AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

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
        // RANKING METRIC
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
    const outputPath = `exports/leaderboard-v23-${timestamp}.csv`;

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
    console.log('650,954 → > 9 markets');
    console.log(' 26,485 → Buy trade in last 5 days');
    console.log(' 11,513 → Median bet > $10');
    console.log(`  ${data.length} → Log growth (14d) > 0 (FINAL)`);
  }

  await client.close();
}

main().catch(console.error);
