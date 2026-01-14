/**
 * Step 3: Build wallet-level CLV aggregation
 *
 * Aggregates trade CLV to wallet level for use in WIO metrics.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('=== Building wallet CLV aggregation ===\n');

  // Step 1: Create aggregation table
  console.log('1. Creating pm_wallet_clv_agg table...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_clv_agg (
        wallet_id String,
        window_id String,

        -- Trade counts
        n_trades UInt32,
        n_trades_with_clv24 UInt32,
        clv24_coverage Float64,

        -- CLV metrics (notional-weighted)
        clv_24h_weighted Float64,
        clv_24h_hit_rate Float64,

        -- Notional
        total_notional_usd Float64,

        computed_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY (wallet_id, window_id)
    `,
  });
  console.log('   Table created.\n');

  // Step 2: Aggregate for different windows
  const windows = [
    { name: 'ALL', filter: '1=1' },
    { name: '90d', filter: 'trade_time >= now() - INTERVAL 90 DAY' },
    { name: '30d', filter: 'trade_time >= now() - INTERVAL 30 DAY' },
  ];

  for (const window of windows) {
    console.log(`2. Aggregating for window: ${window.name}...`);
    const startTime = Date.now();

    await ch.command({
      query: `
        INSERT INTO pm_wallet_clv_agg
        SELECT
          wallet as wallet_id,
          '${window.name}' as window_id,

          count() as n_trades,
          countIf(p24h_found = 1) as n_trades_with_clv24,
          countIf(p24h_found = 1) / count() as clv24_coverage,

          -- CLV weighted by notional (only for trades with CLV data)
          sumIf(clv_24h * notional_usdc, p24h_found = 1) /
            nullIf(sumIf(notional_usdc, p24h_found = 1), 0) as clv_24h_weighted,

          -- Hit rate: % of trades where price moved favorably
          countIf(clv_24h > 0 AND p24h_found = 1) /
            nullIf(countIf(p24h_found = 1), 0) as clv_24h_hit_rate,

          sum(notional_usdc) as total_notional_usd,

          now() as computed_at

        FROM pm_trade_clv_features_60d
        WHERE ${window.filter}
        GROUP BY wallet
        HAVING n_trades_with_clv24 >= 5  -- Minimum CLV data points
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        max_execution_time: 300,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done (${elapsed}s)\n`);
  }

  // Step 3: Verify results
  console.log('3. Verification stats:');
  const stats = await ch.query({
    query: `
      SELECT
        window_id,
        count() as wallets,
        avg(clv_24h_weighted) as avg_clv,
        avg(clv_24h_hit_rate) as avg_hit_rate,
        quantile(0.9)(clv_24h_weighted) as clv_p90,
        quantile(0.99)(clv_24h_weighted) as clv_p99
      FROM pm_wallet_clv_agg
      GROUP BY window_id
      ORDER BY window_id
    `,
    format: 'JSONEachRow',
  });

  const rows = await stats.json() as any[];
  console.log('\n   Window     | Wallets   | Avg CLV  | Hit Rate | P90 CLV  | P99 CLV');
  console.log('   -----------|-----------|----------|----------|----------|----------');
  for (const row of rows) {
    console.log(`   ${row.window_id.padEnd(10)} | ${row.wallets.toString().padStart(9)} | ${(row.avg_clv * 100).toFixed(2).padStart(7)}% | ${(row.avg_hit_rate * 100).toFixed(1).padStart(7)}% | ${(row.clv_p90 * 100).toFixed(2).padStart(7)}% | ${(row.clv_p99 * 100).toFixed(2).padStart(7)}%`);
  }

  console.log('\n=== Done! pm_wallet_clv_agg is ready. ===');
  await ch.close();
}

main().catch(console.error);
