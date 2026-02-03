import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('Exporting custom filtered leaderboard...');
  console.log('Filters:');
  console.log('  - trading_days > 5');
  console.log('  - markets_traded > 8');
  console.log('  - total_trades > 30');
  console.log('  - ev > 5%');
  console.log('  - log_growth_per_trade_14d > 0');
  console.log('  - Ranked by quality_score_14d DESC');
  console.log('');

  const result = await client.query({
    query: `
      SELECT
        wallet,
        total_trades,
        wins,
        losses,
        round(win_rate * 100, 2) as win_rate_pct,
        round(ev * 100, 4) as ev_pct,
        round(log_growth_per_trade * 100, 4) as log_growth_per_trade_pct,
        calendar_days,
        trading_days,
        round(trades_per_day, 2) as trades_per_day,
        round(trades_per_active_day, 2) as trades_per_active_day,
        round(log_return_pct_per_day, 4) as log_return_pct_per_day,
        round(log_return_pct_per_active_day, 4) as log_return_pct_per_active_day,
        round(ev_per_day, 4) as ev_per_day,
        round(ev_per_active_day, 4) as ev_per_active_day,
        round(mean_roi * 100, 4) as mean_roi_pct,
        round(volatility * 100, 4) as volatility_pct,
        round(downside_deviation * 100, 4) as downside_deviation_pct,
        round(sortino_ratio, 4) as sortino_ratio,
        round(quality_score, 4) as quality_score,
        round(total_pnl, 2) as total_pnl_usd,
        round(total_volume, 2) as total_volume_usd,
        markets_traded,
        first_trade,
        last_trade,
        total_trades_14d,
        wins_14d,
        losses_14d,
        round(win_rate_14d * 100, 2) as win_rate_14d_pct,
        round(ev_14d * 100, 4) as ev_14d_pct,
        round(log_growth_per_trade_14d * 100, 4) as log_growth_per_trade_14d_pct,
        calendar_days_14d,
        trading_days_14d,
        round(trades_per_day_14d, 2) as trades_per_day_14d,
        round(trades_per_active_day_14d, 2) as trades_per_active_day_14d,
        round(log_return_pct_per_day_14d, 4) as log_return_pct_per_day_14d,
        round(log_return_pct_per_active_day_14d, 4) as log_return_pct_per_active_day_14d,
        round(ev_per_day_14d, 4) as ev_per_day_14d,
        round(ev_per_active_day_14d, 4) as ev_per_active_day_14d,
        round(mean_roi_14d * 100, 4) as mean_roi_14d_pct,
        round(volatility_14d * 100, 4) as volatility_14d_pct,
        round(downside_deviation_14d * 100, 4) as downside_deviation_14d_pct,
        round(sortino_ratio_14d, 4) as sortino_ratio_14d,
        round(quality_score_14d, 4) as quality_score_14d,
        round(consistency_score, 4) as consistency_score,
        round(total_pnl_14d, 2) as total_pnl_14d_usd,
        round(total_volume_14d, 2) as total_volume_14d_usd,
        markets_traded_14d,
        refreshed_at
      FROM pm_copy_trading_leaderboard_v21
      WHERE trading_days > 5
        AND markets_traded > 8
        AND total_trades > 30
        AND ev > 0.05
        AND log_growth_per_trade_14d > 0
      ORDER BY quality_score_14d DESC
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as Record<string, unknown>[];
  console.log(`Found ${rows.length} wallets passing all filters`);

  if (rows.length === 0) {
    console.log('No data found!');
    await client.close();
    return;
  }

  // Get headers from first row
  const headers = Object.keys(rows[0]);

  // Build CSV
  const csvLines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
      return String(v);
    });
    csvLines.push(values.join(','));
  }

  const outputPath = 'copy-trading-custom-filtered.csv';
  fs.writeFileSync(outputPath, csvLines.join('\n'));
  console.log(`\nExported to ${outputPath}`);

  // Show top 10
  console.log('\n=== TOP 10 BY QUALITY SCORE 14D ===\n');
  console.log('Wallet                                     | Trades | Win% | EV%   | Quality 14d | Consistency | PnL 14d');
  console.log('-------------------------------------------|--------|------|-------|-------------|-------------|--------');
  rows.slice(0, 10).forEach((w: any) => {
    console.log(
      `${w.wallet} | ${String(w.total_trades).padStart(6)} | ${String(w.win_rate_pct).padStart(4)} | ${String(w.ev_pct).padStart(5)} | ${String(w.quality_score_14d).padStart(11)} | ${String(w.consistency_score || 'NULL').padStart(11)} | $${Number(w.total_pnl_14d_usd).toLocaleString()}`
    );
  });

  await client.close();
}

main().catch(console.error);
