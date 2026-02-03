import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST.replace(/\/$/, '')
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function execute(sql: string): Promise<void> {
  await client.query({ query: sql });
}

async function queryRows<T>(sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return (await result.json()) as T[];
}

async function main() {
  console.log('Starting leaderboard v24 export...\n');

  // Cleanup
  console.log('Cleaning up temp tables...');
  const tables = [
    'tmp_export_v24_step1', 'tmp_export_v24_step2', 'tmp_export_v24_step3',
    'tmp_export_v24_step4', 'tmp_export_v24_step5', 'tmp_export_v24_active_dates',
    'tmp_export_v24_last_14d', 'tmp_export_v24_last_7d', 'tmp_export_v24_percentiles',
    'tmp_export_v24_percentiles_14d', 'tmp_export_v24_percentiles_7d',
    'tmp_export_v24_lifetime', 'tmp_export_v24_14d', 'tmp_export_v24_7d'
  ];
  for (const t of tables) {
    await execute(`DROP TABLE IF EXISTS ${t}`);
  }

  // Step 1: Markets > 10
  console.log('Step 1: Markets > 10...');
  await execute(`
    CREATE TABLE tmp_export_v24_step1 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, countDistinct(condition_id) as markets_traded
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE (resolved_at IS NOT NULL OR is_closed = 1) AND cost_usd > 0
    GROUP BY wallet
    HAVING markets_traded > 10
  `);
  const step1 = await queryRows<{c: number}>(`SELECT count() as c FROM tmp_export_v24_step1`);
  console.log(`  → ${step1[0].c} wallets`);

  // Step 2: Buy trade in last 5 days
  console.log('Step 2: Buy trade in last 5 days...');
  await execute(`
    CREATE TABLE tmp_export_v24_step2 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT DISTINCT t.wallet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_step1 s ON t.wallet = s.wallet
    WHERE t.entry_time >= now() - INTERVAL 5 DAY
  `);
  const step2 = await queryRows<{c: number}>(`SELECT count() as c FROM tmp_export_v24_step2`);
  console.log(`  → ${step2[0].c} wallets`);

  // Step 3: Average bet > $10
  console.log('Step 3: Average bet > $10...');
  await execute(`
    CREATE TABLE tmp_export_v24_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, avg(t.cost_usd) as avg_bet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_step2 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING avg_bet > 10
  `);
  const step3 = await queryRows<{c: number}>(`SELECT count() as c FROM tmp_export_v24_step3`);
  console.log(`  → ${step3[0].c} wallets`);

  // Step 4: Log growth (all time) > 10%
  console.log('Step 4: Log growth (all time) > 10%...');
  await execute(`
    CREATE TABLE tmp_export_v24_step4 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_step3 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) > 0.10
  `);
  const step4 = await queryRows<{c: number}>(`SELECT count() as c FROM tmp_export_v24_step4`);
  console.log(`  → ${step4[0].c} wallets`);

  // Active days lookup
  console.log('Building active days lookup...');
  await execute(`
    CREATE TABLE tmp_export_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_export_v24_step4)
      AND (resolved_at IS NOT NULL OR is_closed = 1) AND cost_usd > 0
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`
    CREATE TABLE tmp_export_v24_last_14d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_export_v24_active_dates WHERE date_rank <= 14
  `);

  await execute(`
    CREATE TABLE tmp_export_v24_last_7d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_export_v24_active_dates WHERE date_rank <= 7
  `);

  // Step 5: Log growth (14d) > 10%
  console.log('Step 5: Log growth (14d) > 10%...');
  await execute(`
    CREATE TABLE tmp_export_v24_step5 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN tmp_export_v24_step4 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) > 0.10
  `);
  const step5 = await queryRows<{c: number}>(`SELECT count() as c FROM tmp_export_v24_step5`);
  console.log(`  → ${step5[0].c} wallets`);

  // Rebuild active days for final wallets
  console.log('\nRebuilding active days for final wallets...');
  await execute(`DROP TABLE IF EXISTS tmp_export_v24_active_dates`);
  await execute(`
    CREATE TABLE tmp_export_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_export_v24_step5)
      AND (resolved_at IS NOT NULL OR is_closed = 1) AND cost_usd > 0
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_export_v24_last_14d`);
  await execute(`
    CREATE TABLE tmp_export_v24_last_14d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_export_v24_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_export_v24_last_7d`);
  await execute(`
    CREATE TABLE tmp_export_v24_last_7d ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_export_v24_active_dates WHERE date_rank <= 7
  `);

  // Percentiles
  console.log('Calculating percentiles...');
  await execute(`
    CREATE TABLE tmp_export_v24_percentiles ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet,
      quantile(0.025)(pnl_usd / cost_usd) as roi_floor,
      quantile(0.975)(pnl_usd / cost_usd) as roi_ceiling
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_export_v24_step5)
      AND (resolved_at IS NOT NULL OR is_closed = 1) AND cost_usd > 0
    GROUP BY wallet
  `);

  await execute(`
    CREATE TABLE tmp_export_v24_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet,
      quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_14d,
      quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  await execute(`
    CREATE TABLE tmp_export_v24_percentiles_7d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet,
      quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_7d,
      quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_7d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_last_7d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Lifetime metrics
  console.log('Calculating lifetime metrics...');
  await execute(`
    CREATE TABLE tmp_export_v24_lifetime ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      countIf(t.pnl_usd > 0) / count() as win_rate,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd <= 0)), 0) as winsorized_ev,
      any(p.roi_floor) as roi_floor,
      any(p.roi_ceiling) as roi_ceiling,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
      uniqExact(toDate(t.entry_time)) as trading_days,
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
      sum(t.pnl_usd) as total_pnl,
      sum(t.cost_usd) as total_volume,
      countDistinct(t.condition_id) as markets_traded,
      avg(t.cost_usd) as avg_bet_size,
      quantile(0.5)(t.cost_usd) as median_bet_size,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade,
      avg(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
      END) as avg_hold_time_minutes
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_step5 s ON t.wallet = s.wallet
    INNER JOIN tmp_export_v24_percentiles p ON t.wallet = p.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // 14d metrics
  console.log('Calculating 14d metrics...');
  await execute(`
    CREATE TABLE tmp_export_v24_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      countIf(t.pnl_usd > 0) / count() as win_rate_14d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd <= 0)), 0) as winsorized_ev_14d,
      any(p.roi_floor_14d) as roi_floor_14d,
      any(p.roi_ceiling_14d) as roi_ceiling_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
      sum(t.pnl_usd) as total_pnl_14d,
      sum(t.cost_usd) as total_volume_14d,
      countDistinct(t.condition_id) as markets_traded_14d,
      avg(t.cost_usd) as avg_bet_size_14d,
      avg(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
      END) as avg_hold_time_minutes_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_last_14d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN tmp_export_v24_step5 s ON t.wallet = s.wallet
    INNER JOIN tmp_export_v24_percentiles_14d p ON t.wallet = p.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // 7d metrics
  console.log('Calculating 7d metrics...');
  await execute(`
    CREATE TABLE tmp_export_v24_7d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      countIf(t.pnl_usd > 0) / count() as win_rate_7d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd <= 0)), 0) as winsorized_ev_7d,
      any(p.roi_floor_7d) as roi_floor_7d,
      any(p.roi_ceiling_7d) as roi_ceiling_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
      uniqExact(toDate(t.entry_time)) as trading_days_7d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
      sum(t.pnl_usd) as total_pnl_7d,
      sum(t.cost_usd) as total_volume_7d,
      countDistinct(t.condition_id) as markets_traded_7d,
      avg(CASE
        WHEN t.resolved_at < '1971-01-01' THEN NULL
        WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
        WHEN t.resolved_at < t.entry_time THEN NULL
        ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
      END) as avg_hold_time_minutes_7d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_export_v24_last_7d a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
    INNER JOIN tmp_export_v24_step5 s ON t.wallet = s.wallet
    INNER JOIN tmp_export_v24_percentiles_7d p ON t.wallet = p.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1) AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // Final query - join all metrics
  console.log('\nExporting final leaderboard...');
  const rows = await queryRows<Record<string, any>>(`
    SELECT
      l.wallet,
      -- Ranking metrics
      l.log_growth_per_trade * l.trades_per_active_day as daily_log_growth,
      r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d as daily_log_growth_14d,
      r7.log_growth_per_trade_7d * r7.trades_per_active_day_7d as daily_log_growth_7d,
      -- Lifetime
      l.total_trades,
      l.wins,
      l.losses,
      l.win_rate,
      l.ev,
      l.winsorized_ev,
      l.roi_floor,
      l.roi_ceiling,
      l.log_growth_per_trade,
      l.calendar_days,
      l.trading_days,
      l.trades_per_day,
      l.trades_per_active_day,
      l.total_pnl,
      l.total_volume,
      l.markets_traded,
      l.avg_bet_size,
      l.median_bet_size,
      l.first_trade,
      l.last_trade,
      l.avg_hold_time_minutes,
      -- 14d
      r14.total_trades_14d,
      r14.wins_14d,
      r14.losses_14d,
      r14.win_rate_14d,
      r14.ev_14d,
      r14.winsorized_ev_14d,
      r14.roi_floor_14d,
      r14.roi_ceiling_14d,
      r14.log_growth_per_trade_14d,
      r14.trading_days_14d,
      r14.trades_per_active_day_14d,
      r14.total_pnl_14d,
      r14.total_volume_14d,
      r14.markets_traded_14d,
      r14.avg_bet_size_14d,
      r14.avg_hold_time_minutes_14d,
      -- 7d
      r7.total_trades_7d,
      r7.wins_7d,
      r7.losses_7d,
      r7.win_rate_7d,
      r7.ev_7d,
      r7.winsorized_ev_7d,
      r7.roi_floor_7d,
      r7.roi_ceiling_7d,
      r7.log_growth_per_trade_7d,
      r7.trading_days_7d,
      r7.trades_per_active_day_7d,
      r7.total_pnl_7d,
      r7.total_volume_7d,
      r7.markets_traded_7d,
      r7.avg_hold_time_minutes_7d
    FROM tmp_export_v24_lifetime l
    INNER JOIN tmp_export_v24_14d r14 ON l.wallet = r14.wallet
    INNER JOIN tmp_export_v24_7d r7 ON l.wallet = r7.wallet
    ORDER BY daily_log_growth_14d DESC
  `);

  console.log(`\nTotal wallets: ${rows.length}`);

  // Write CSV
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
        return val;
      }).join(','))
    ].join('\n');

    const outputPath = './exports/leaderboard-v24.csv';
    fs.mkdirSync('./exports', { recursive: true });
    fs.writeFileSync(outputPath, csvContent);
    console.log(`\nCSV exported to: ${outputPath}`);
  }

  // Cleanup
  console.log('\nCleaning up temp tables...');
  for (const t of tables) {
    await execute(`DROP TABLE IF EXISTS ${t}`);
  }

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
