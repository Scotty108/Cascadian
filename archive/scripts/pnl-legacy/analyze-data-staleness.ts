/**
 * Data Staleness Analysis
 *
 * Checks how many wallets have stale/missing data
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('=== DATA STALENESS ANALYSIS ===');
  console.log('Checking how many wallets have stale data...');
  console.log('');

  // Analyze wallet data freshness
  const result = await client.query({
    query: `
      SELECT
        CASE
          WHEN last_trade >= now() - INTERVAL 7 DAY THEN '1. Active (last 7 days)'
          WHEN last_trade >= now() - INTERVAL 30 DAY THEN '2. Recent (8-30 days)'
          WHEN last_trade >= now() - INTERVAL 90 DAY THEN '3. Stale (31-90 days)'
          WHEN last_trade >= now() - INTERVAL 180 DAY THEN '4. Very Stale (91-180 days)'
          WHEN last_trade >= now() - INTERVAL 365 DAY THEN '5. Old (181-365 days)'
          ELSE '6. Ancient (>1 year)'
        END as freshness,
        COUNT(*) as wallet_count,
        SUM(trade_count) as total_trades,
        SUM(volume) as total_volume
      FROM (
        SELECT
          trader_wallet,
          MAX(trade_time) as last_trade,
          COUNT(*) as trade_count,
          SUM(usdc_amount) / 1000000.0 as volume
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY trader_wallet
      )
      GROUP BY freshness
      ORDER BY freshness
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  console.log('Freshness Category     | Wallets       | Trades           | Volume');
  console.log('-----------------------|---------------|------------------|----------------');

  let totalWallets = 0;
  let staleWallets = 0;
  let staleTrades = 0;
  let staleVolume = 0;

  for (const r of rows) {
    const wallets = parseInt(r.wallet_count);
    const trades = parseInt(r.total_trades);
    const volume = parseFloat(r.total_volume);

    totalWallets += wallets;

    // Count stale as anything older than 30 days
    const isActive = r.freshness.includes('Active') || r.freshness.includes('Recent');
    if (isActive === false) {
      staleWallets += wallets;
      staleTrades += trades;
      staleVolume += volume;
    }

    console.log(
      r.freshness.padEnd(23) + '| ' +
      wallets.toLocaleString().padStart(13) + ' | ' +
      trades.toLocaleString().padStart(16) + ' | $' +
      (volume / 1000000000).toFixed(2) + 'B'
    );
  }

  console.log('-----------------------|---------------|------------------|----------------');
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Total wallets:', totalWallets.toLocaleString());
  console.log('Stale wallets (>30 days):', staleWallets.toLocaleString(), '(' + (staleWallets/totalWallets*100).toFixed(1) + '%)');
  console.log('Stale trades:', staleTrades.toLocaleString());
  console.log('Stale volume: $' + (staleVolume / 1000000000).toFixed(2) + 'B');

  await client.close();
}

main().catch(console.error);
