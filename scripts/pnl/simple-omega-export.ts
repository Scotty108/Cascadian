/**
 * Simple Omega Export for Copy-Trading
 *
 * Exports: wallet, avg_pct_return_per_trade, omega, n_events, pnl_60d
 * Filter: Omega > 1, events > 5, Tier A (CLOB-only)
 *
 * User can filter in spreadsheet (e.g., Omega > 2)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('=== Simple Omega Export ===\n');

  const query = `
    WITH
      now() AS t_now

    SELECT
      lower(wallet) AS wallet,

      -- Core metrics
      count() AS n_trades,
      uniqExact(token_id) AS n_events,
      countIf(p24h_found = 1) AS n_with_clv,

      -- Win/Loss
      countIf(clv_24h > 0 AND p24h_found = 1) AS n_wins,
      countIf(clv_24h <= 0 AND p24h_found = 1) AS n_losses,
      round(countIf(clv_24h > 0 AND p24h_found = 1) / nullIf(countIf(p24h_found = 1), 0) * 100, 1) AS win_pct,

      -- Omega (Profit Factor) = gross_wins / gross_losses
      round(
        sumIf(clv_24h * notional_usdc, clv_24h > 0 AND p24h_found = 1) /
        nullIf(abs(sumIf(clv_24h * notional_usdc, clv_24h <= 0 AND p24h_found = 1)), 0)
      , 2) AS omega,

      -- Average % return per trade (CLV is already a %)
      round(avgIf(clv_24h * 100, p24h_found = 1), 2) AS avg_pct_return,

      -- Total P&L
      round(sumIf(clv_24h * notional_usdc, p24h_found = 1), 2) AS pnl_60d,

      -- Volume
      round(sum(notional_usdc), 2) AS volume_60d,

      -- Activity
      max(trade_time) AS last_trade,
      uniqExact(toDate(trade_time)) AS active_days

    FROM pm_trade_clv_features_60d
    WHERE trade_time >= t_now - INTERVAL 60 DAY
    GROUP BY wallet
    HAVING
      n_events >= 5                              -- At least 5 markets
      AND omega > 1                              -- Profitable (Omega > 1)
      AND omega < 100                            -- Cap absurd ratios
      AND n_with_clv >= 5                        -- Enough CLV data
      AND last_trade >= t_now - INTERVAL 14 DAY  -- Active in last 2 weeks
    ORDER BY omega DESC
    LIMIT 200
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const allRows = await result.json() as any[];

  console.log(`Found ${allRows.length} wallets with Omega > 1\n`);

  // Filter to Tier A only
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  // Add tier and filter
  const rows = allRows
    .map(r => ({
      ...r,
      tier: tierMap.get(r.wallet) || 'Unknown',
    }))
    .filter(r => r.tier === 'A')  // CLOB-only
    .slice(0, 100);

  console.log(`After Tier A filter: ${rows.length} wallets\n`);

  // Display top 20
  console.log('Top 20 by Omega (Tier A only):\n');
  console.log('Wallet                                     | Events | Win% | Omega | Avg%Ret | PnL 60d   | Volume');
  console.log('-------------------------------------------|--------|------|-------|---------|-----------|--------');

  for (const r of rows.slice(0, 20)) {
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.win_pct).padStart(4)}% | ${String(r.omega).padStart(5)}x | ${String(r.avg_pct_return).padStart(6)}% | ${('$' + Number(r.pnl_60d).toLocaleString()).padStart(9)} | $${Number(r.volume_60d).toLocaleString()}`
    );
  }

  // Export CSV
  const dateStr = new Date().toISOString().slice(0, 10);
  const csvPath = `exports/copytrade/omega_export_${dateStr}.csv`;

  const header = 'wallet,n_events,n_trades,n_wins,n_losses,win_pct,omega,avg_pct_return,pnl_60d,volume_60d,active_days,tier,profile_url';
  const csvRows = rows.map(r =>
    [
      r.wallet,
      r.n_events,
      r.n_trades,
      r.n_wins,
      r.n_losses,
      r.win_pct,
      r.omega,
      r.avg_pct_return,
      r.pnl_60d,
      r.volume_60d,
      r.active_days,
      r.tier,
      `https://polymarket.com/profile/${r.wallet}`,
    ].join(',')
  );

  fs.writeFileSync(csvPath, [header, ...csvRows].join('\n'));
  console.log(`\n\nExported ${rows.length} wallets to: ${csvPath}`);

  // Also export JSON
  const jsonPath = `exports/copytrade/omega_export_${dateStr}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    filters: {
      omega: '> 1 (profitable)',
      events: '>= 5 markets',
      tier: 'A (CLOB-only)',
      active: 'within 14 days',
    },
    note: 'Filter in spreadsheet: Omega > 2 for higher quality',
    wallets: rows,
  }, null, 2));
  console.log(`Exported to: ${jsonPath}`);

  console.log('\n=== Done ===');
  console.log('\nTip: Open CSV in Google Sheets, filter by Omega > 2 to get best candidates');

  await ch.close();
}

main().catch(console.error);
