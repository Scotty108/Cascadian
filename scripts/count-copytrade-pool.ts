/**
 * Count wallets matching copy trade filters
 *
 * Filters:
 * - Wallet age > 14 days (first trade to last trade)
 * - 10+ trades
 * - Active in last 7 days
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Copy Trade Pool Size Estimation ===\n');

  console.log('Filters:');
  console.log('  - Wallet age: > 14 days (2 weeks)');
  console.log('  - Min trades: 10+');
  console.log('  - Recency: active in last 7 days');
  console.log('');

  const query = `
    WITH wallet_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as trades,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        dateDiff('day', min(trade_time), max(trade_time)) as wallet_age_days,
        dateDiff('day', max(trade_time), now()) as days_since_last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
    )
    SELECT
      count() as total_wallets,

      -- Your exact filters
      countIf(wallet_age_days >= 14 AND trades >= 10 AND days_since_last_trade <= 7) as "YOUR_FILTER",

      -- Variations to compare
      countIf(wallet_age_days >= 14 AND trades >= 10) as "14d_10t_anyRecency",
      countIf(wallet_age_days >= 14 AND trades >= 20 AND days_since_last_trade <= 7) as "14d_20t_7dRecent",
      countIf(wallet_age_days >= 14 AND trades >= 50 AND days_since_last_trade <= 7) as "14d_50t_7dRecent",
      countIf(wallet_age_days >= 30 AND trades >= 10 AND days_since_last_trade <= 7) as "30d_10t_7dRecent",
      countIf(wallet_age_days >= 30 AND trades >= 50 AND days_since_last_trade <= 7) as "30d_50t_7dRecent",

      -- Breakdown by recency
      countIf(days_since_last_trade <= 1) as "active_1d",
      countIf(days_since_last_trade <= 7) as "active_7d",
      countIf(days_since_last_trade <= 14) as "active_14d",
      countIf(days_since_last_trade <= 30) as "active_30d"

    FROM wallet_stats
  `;

  console.log('Running query...\n');
  const startTime = Date.now();

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  const stats = rows[0];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Query time: ${elapsed}s\n`);

  console.log('='.repeat(60));
  console.log('YOUR FILTER: 14+ days old, 10+ trades, active in last 7 days');
  console.log('='.repeat(60));
  const yourCount = Number(stats['YOUR_FILTER']);
  console.log(`\n  >>> ${yourCount.toLocaleString()} wallets <<<\n`);
  console.log(`  Est. runtime @ 1 wallet/sec: ${(yourCount / 3600).toFixed(1)} hours`);
  console.log(`  Est. runtime @ 2 wallet/sec: ${(yourCount / 7200).toFixed(1)} hours`);
  console.log('');

  console.log('='.repeat(60));
  console.log('VARIATIONS');
  console.log('='.repeat(60));
  console.log('');
  console.log('Filter                              | Wallets    | Hours (@1/s)');
  console.log('------------------------------------|------------|-------------');

  const format = (key: string, label: string) => {
    const count = Number(stats[key]);
    const hours = (count / 3600).toFixed(1);
    console.log(`${label.padEnd(35)} | ${count.toLocaleString().padStart(10)} | ${hours.padStart(11)}`);
  };

  format('YOUR_FILTER', '14d age, 10t, 7d recent (YOURS)');
  format('14d_10t_anyRecency', '14d age, 10t, any recency');
  format('14d_20t_7dRecent', '14d age, 20t, 7d recent');
  format('14d_50t_7dRecent', '14d age, 50t, 7d recent');
  format('30d_10t_7dRecent', '30d age, 10t, 7d recent');
  format('30d_50t_7dRecent', '30d age, 50t, 7d recent');

  console.log('');
  console.log('='.repeat(60));
  console.log('RECENCY BREAKDOWN (all wallets)');
  console.log('='.repeat(60));
  console.log('');
  format('active_1d', 'Active in last 1 day');
  format('active_7d', 'Active in last 7 days');
  format('active_14d', 'Active in last 14 days');
  format('active_30d', 'Active in last 30 days');
  format('total_wallets', 'Total wallets (any time)');
}

main().catch(console.error);
