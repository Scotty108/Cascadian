/**
 * Estimate pool sizes with different filter thresholds
 *
 * For copy trading, we need:
 * - Enough history (30+ days)
 * - Enough trades (50-100+) for statistical significance
 * - CLOB-only (already filtered by using pm_trader_events_v2)
 *
 * We DON'T need:
 * - Recent activity (dormant traders with good stats are fine)
 * - Minimum markets (specialists are fine)
 * - High volume (we're betting $1/trade anyway)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Estimating Copy Trade Pool Sizes ===\n');

  const query = `
    WITH wallet_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as trades,
        dateDiff('day', min(trade_time), max(trade_time)) as days_active,
        sum(usdc_amount) / 1e6 as volume,
        max(trade_time) as last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
    )
    SELECT
      count() as total_wallets,

      -- Very loose
      countIf(days_active >= 30 AND trades >= 30) as "d30_t30",
      countIf(days_active >= 30 AND trades >= 50) as "d30_t50",
      countIf(days_active >= 30 AND trades >= 100) as "d30_t100",

      -- With volume floor
      countIf(days_active >= 30 AND trades >= 50 AND volume >= 50) as "d30_t50_v50",
      countIf(days_active >= 30 AND trades >= 100 AND volume >= 100) as "d30_t100_v100",

      -- Current-ish (for comparison)
      countIf(days_active >= 30 AND trades >= 200 AND volume >= 200) as "d30_t200_v200",

      -- With recency (active in last 90 days)
      countIf(days_active >= 30 AND trades >= 50 AND last_trade >= now() - INTERVAL 90 DAY) as "d30_t50_recent90",
      countIf(days_active >= 30 AND trades >= 100 AND last_trade >= now() - INTERVAL 90 DAY) as "d30_t100_recent90"

    FROM wallet_stats
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  const stats = rows[0];

  console.log('Pool Size Estimates:\n');
  console.log('Filter                              | Wallets    | Time Est (@ 1/sec)');
  console.log('------------------------------------|------------|-------------------');

  const format = (key: string, label: string) => {
    const count = Number(stats[key]);
    const hours = (count / 3600).toFixed(1);
    console.log(`${label.padEnd(35)} | ${count.toLocaleString().padStart(10)} | ${hours} hours`);
  };

  format('total_wallets', 'Total wallets (no filter)');
  console.log('------------------------------------|------------|-------------------');
  format('d30_t30', '30+ days, 30+ trades');
  format('d30_t50', '30+ days, 50+ trades');
  format('d30_t100', '30+ days, 100+ trades');
  console.log('------------------------------------|------------|-------------------');
  format('d30_t50_v50', '30+ days, 50+ trades, $50+ vol');
  format('d30_t100_v100', '30+ days, 100+ trades, $100+ vol');
  format('d30_t200_v200', '30+ days, 200+ trades, $200+ vol');
  console.log('------------------------------------|------------|-------------------');
  format('d30_t50_recent90', '30+ days, 50+ trades, active <90d');
  format('d30_t100_recent90', '30+ days, 100+ trades, active <90d');

  console.log('\n=== Recommendation ===\n');
  console.log('For copy trading discovery, use:');
  console.log('  - 30+ days history (statistical significance)');
  console.log('  - 50+ trades (minimum sample size)');
  console.log('  - No volume minimum (we bet $1 anyway)');
  console.log('  - No recency requirement (dormant traders are fine)');
  console.log('  - No market count requirement (specialists are fine)');
  console.log('');
  console.log(`This gives ~${Number(stats['d30_t50']).toLocaleString()} wallets`);
  console.log(`Est. runtime: ${(Number(stats['d30_t50']) / 3600).toFixed(1)} hours at 1 wallet/sec`);
}

main().catch(console.error);
