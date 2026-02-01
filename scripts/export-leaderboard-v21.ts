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
  console.log('Exporting copy trading leaderboard v21...');

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
        round(total_pnl_14d, 2) as total_pnl_14d_usd,
        round(total_volume_14d, 2) as total_volume_14d_usd,
        markets_traded_14d,
        refreshed_at
      FROM pm_copy_trading_leaderboard_v21
      ORDER BY log_return_pct_per_active_day DESC
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as Record<string, unknown>[];
  console.log(`Found ${rows.length} wallets`);

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

  const outputPath = 'copy-trading-leaderboard-v21.csv';
  fs.writeFileSync(outputPath, csvLines.join('\n'));
  console.log(`Exported to ${outputPath}`);

  await client.close();
}

main().catch(console.error);
