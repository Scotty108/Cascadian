/**
 * Step 3: Build pm_wallet_clv_60d
 *
 * Aggregates trade-level CLV to wallet-level metrics.
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
  console.log('=== Building pm_wallet_clv_60d ===\n');

  // Step 1: Create the table
  console.log('1. Creating table...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_clv_60d (
        wallet String,
        as_of_date Date,

        -- Activity
        n_trades_60d UInt32,
        n_markets_60d UInt32,
        notional_60d Float64,
        last_trade DateTime,
        active_days_60d UInt32,

        -- Coverage quality
        n_trades_with_p24 UInt32,
        p24_coverage Float64,

        -- CLV metrics (notional-weighted)
        clv_24h_weighted Float64,

        -- CLV hit rates
        clv_24h_hit_rate Float64,

        -- Entry behavior
        median_entry_price Float64,

        -- Liquidity summary
        median_liq_24h_volume Float64,
        median_liq_24h_trade_count Float64,

        -- Concentration (anti-luck)
        clv_top5_contribution_pct Float64,
        notional_top5_pct Float64

      ) ENGINE = ReplacingMergeTree(as_of_date)
      ORDER BY wallet
    `,
  });
  console.log('   Done.\n');

  // Step 2: Populate
  console.log('2. Aggregating wallet-level CLV...');
  const startTime = Date.now();

  await ch.command({
    query: `
      INSERT INTO pm_wallet_clv_60d
      SELECT
        wallet,
        today() as as_of_date,

        -- Activity
        count() as n_trades_60d,
        uniqExact(token_id) as n_markets_60d,
        sum(notional_usdc) as notional_60d,
        max(trade_time) as last_trade,
        uniqExact(toDate(trade_time)) as active_days_60d,

        -- Coverage quality
        countIf(p24h_found = 1) as n_trades_with_p24,
        countIf(p24h_found = 1) / count() as p24_coverage,

        -- CLV metrics (notional-weighted, only for trades with price data)
        sumIf(clv_24h * notional_usdc, p24h_found = 1) /
          nullIf(sumIf(notional_usdc, p24h_found = 1), 0) as clv_24h_weighted,

        -- CLV hit rates
        countIf(clv_24h > 0 AND p24h_found = 1) /
          nullIf(countIf(p24h_found = 1), 0) as clv_24h_hit_rate,

        -- Entry behavior
        median(entry_price) as median_entry_price,

        -- Liquidity summary
        medianIf(liq_24h_volume, p24h_found = 1) as median_liq_24h_volume,
        medianIf(liq_24h_trade_count, p24h_found = 1) as median_liq_24h_trade_count,

        -- Concentration (anti-luck): top 5 trades' CLV contribution
        -- Compute in separate subquery
        0 as clv_top5_contribution_pct,
        0 as notional_top5_pct

      FROM pm_trade_clv_features_60d
      GROUP BY wallet
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
      max_execution_time: 300,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Done (${elapsed}s)\n`);

  // Step 3: Stats
  console.log('3. Summary stats...');
  const statsQ = await ch.query({
    query: `
      SELECT
        count() as total_wallets,
        avg(n_trades_60d) as avg_trades,
        avg(p24_coverage) as avg_coverage,
        avg(clv_24h_weighted) as avg_clv,
        quantile(0.99)(clv_24h_weighted) as p99_clv,
        quantile(0.01)(clv_24h_weighted) as p01_clv,
        avg(clv_24h_hit_rate) as avg_hit_rate,
        countIf(n_trades_60d >= 20 AND n_trades_with_p24 >= 15) as eligible_wallets
      FROM pm_wallet_clv_60d
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json()) as any[];

  console.log(`   Total wallets: ${Number(stats[0]?.total_wallets).toLocaleString()}`);
  console.log(`   Avg trades: ${stats[0]?.avg_trades?.toFixed(1)}`);
  console.log(`   Avg 24h coverage: ${(stats[0]?.avg_coverage * 100).toFixed(1)}%`);
  console.log(`   Avg CLV (24h weighted): ${stats[0]?.avg_clv?.toFixed(4)}`);
  console.log(`   P99 CLV: ${stats[0]?.p99_clv?.toFixed(4)}`);
  console.log(`   P01 CLV: ${stats[0]?.p01_clv?.toFixed(4)}`);
  console.log(`   Avg hit rate: ${(stats[0]?.avg_hit_rate * 100).toFixed(1)}%`);
  console.log(`   Eligible wallets (20+ trades, 15+ with p24): ${Number(stats[0]?.eligible_wallets).toLocaleString()}`);

  // Top 10 by CLV
  console.log('\n4. Top 10 by CLV (24h weighted):');
  const topQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        n_trades_with_p24,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate,
        notional_60d
      FROM pm_wallet_clv_60d
      WHERE n_trades_60d >= 20
        AND n_trades_with_p24 >= 15
        AND p24_coverage >= 0.5
      ORDER BY clv_24h_weighted DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const top = (await topQ.json()) as any[];

  console.log('   ' + '-'.repeat(100));
  for (const w of top) {
    console.log(`   ${w.wallet} | ${w.n_trades_60d} trades | ${(w.p24_coverage * 100).toFixed(0)}% cov | CLV: ${w.clv_24h_weighted?.toFixed(4)} | Hit: ${(w.clv_24h_hit_rate * 100).toFixed(0)}% | $${Number(w.notional_60d).toFixed(0)}`);
  }

  console.log('\n=== Done! pm_wallet_clv_60d is ready. ===');
  await ch.close();
}

main().catch(console.error);
