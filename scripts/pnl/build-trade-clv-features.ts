/**
 * Step 2: Build pm_trade_clv_features_60d
 *
 * Computes CLV (Closing Line Value) for each trade by joining with
 * future price snapshots at 1h, 6h, 24h, 7d horizons.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
});

async function main() {
  console.log('=== Building pm_trade_clv_features_60d ===\n');

  // Step 1: Create the table
  console.log('1. Creating table...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_trade_clv_features_60d (
        wallet String,
        token_id String,
        condition_id String,
        trade_time DateTime,
        side String,
        entry_price Float64,
        notional_usdc Float64,

        -- Price references (NULL if not found within tolerance)
        price_1h Nullable(Float64),
        price_6h Nullable(Float64),
        price_24h Nullable(Float64),
        price_7d Nullable(Float64),

        -- CLV values (side-adjusted)
        clv_1h Nullable(Float64),
        clv_6h Nullable(Float64),
        clv_24h Nullable(Float64),
        clv_7d Nullable(Float64),

        -- Quality flags
        p1h_found UInt8,
        p6h_found UInt8,
        p24h_found UInt8,
        p7d_found UInt8,

        -- Liquidity context at +24h window
        liq_24h_volume Float64,
        liq_24h_trade_count UInt32,

        -- Impact detection
        wallet_share_of_bucket Float64
      ) ENGINE = ReplacingMergeTree()
      PARTITION BY toYYYYMM(trade_time)
      ORDER BY (wallet, trade_time, token_id)
    `,
  });
  console.log('   Table created.\n');

  // Step 2: Count existing rows
  const countBefore = await ch.query({
    query: `SELECT count() as cnt FROM pm_trade_clv_features_60d`,
    format: 'JSONEachRow',
  });
  const beforeRows = (await countBefore.json()) as { cnt: string }[];
  console.log(`2. Current row count: ${beforeRows[0]?.cnt || 0}`);

  // Step 3: Populate in weekly batches to avoid memory limits
  console.log('\n3. Populating trade CLV features in weekly batches...');
  console.log('   Processing 60 days in 9 weekly chunks.\n');

  const startTime = Date.now();

  // Process week by week (oldest first)
  // Week 1: -60d to -53d, Week 2: -53d to -46d, ... Week 9: -7d to now
  for (let weekNum = 1; weekNum <= 9; weekNum++) {
    const daysAgoEnd = 60 - (weekNum - 1) * 7;    // 60, 53, 46, ...
    const daysAgoStart = daysAgoEnd - 7;          // 53, 46, 39, ...
    console.log(`   Week ${weekNum}/9: -${daysAgoEnd}d to -${Math.max(daysAgoStart, 0)}d...`);

    const weekStartTime = Date.now();
    // Simplified: only 24h CLV (the primary signal) to reduce memory usage
    await ch.command({
      query: `
        INSERT INTO pm_trade_clv_features_60d
        SELECT
          lower(t.trader_wallet) as wallet,
          t.token_id,
          '' as condition_id,
          t.trade_time,
          t.side,
          toFloat64(t.usdc_amount) / toFloat64(t.token_amount) as entry_price,
          toFloat64(t.usdc_amount) / 1000000.0 as notional_usdc,

          NULL as price_1h,
          NULL as price_6h,
          p24.last_price as price_24h,
          NULL as price_7d,

          NULL as clv_1h,
          NULL as clv_6h,
          if(p24.last_price > 0, p24.last_price - toFloat64(t.usdc_amount) / toFloat64(t.token_amount), NULL) as clv_24h,
          NULL as clv_7d,

          0 as p1h_found,
          0 as p6h_found,
          if(p24.last_price > 0, 1, 0) as p24h_found,
          0 as p7d_found,

          coalesce(p24.volume_usdc, 0) as liq_24h_volume,
          coalesce(p24.trade_count, 0) as liq_24h_trade_count,

          0 as wallet_share_of_bucket

        FROM pm_trader_events_v2 t

        LEFT JOIN pm_price_snapshots_15m p24 ON p24.token_id = t.token_id
          AND p24.bucket = toStartOfFifteenMinutes(t.trade_time + INTERVAL 24 HOUR)

        WHERE t.is_deleted = 0
          AND t.trade_time >= now() - INTERVAL ${daysAgoEnd} DAY
          AND t.trade_time < now() - INTERVAL ${Math.max(daysAgoStart, 0)} DAY
          AND t.token_amount > 0
          AND t.usdc_amount > 0
          AND t.side = 'buy'
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        max_execution_time: 300,
      },
    });
    const weekElapsed = ((Date.now() - weekStartTime) / 1000).toFixed(1);
    console.log(`      Done (${weekElapsed}s)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Completed in ${elapsed}s`);

  // Step 4: Verify results
  console.log('\n4. Verifying results...');
  const countAfter = await ch.query({
    query: `SELECT count() as cnt FROM pm_trade_clv_features_60d`,
    format: 'JSONEachRow',
  });
  const afterRows = (await countAfter.json()) as { cnt: string }[];
  console.log(`   Total rows: ${Number(afterRows[0]?.cnt).toLocaleString()}`);

  // Coverage stats
  const statsQ = await ch.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(wallet) as unique_wallets,
        uniqExact(token_id) as unique_tokens,
        avg(p24h_found) as p24_coverage,
        avg(p1h_found) as p1h_coverage,
        avg(clv_24h) as avg_clv_24h,
        quantile(0.5)(clv_24h) as median_clv_24h,
        countIf(clv_24h > 0) / countIf(p24h_found = 1) as clv_24h_hit_rate
      FROM pm_trade_clv_features_60d
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json()) as any[];

  console.log('\n5. CLV stats:');
  console.log(`   Total trades: ${Number(stats[0]?.total_trades).toLocaleString()}`);
  console.log(`   Unique wallets: ${Number(stats[0]?.unique_wallets).toLocaleString()}`);
  console.log(`   Unique tokens: ${Number(stats[0]?.unique_tokens).toLocaleString()}`);
  console.log(`   24h price coverage: ${(stats[0]?.p24_coverage * 100).toFixed(1)}%`);
  console.log(`   1h price coverage: ${(stats[0]?.p1h_coverage * 100).toFixed(1)}%`);
  console.log(`   Average CLV (24h): ${stats[0]?.avg_clv_24h?.toFixed(4)}`);
  console.log(`   Median CLV (24h): ${stats[0]?.median_clv_24h?.toFixed(4)}`);
  console.log(`   CLV hit rate (24h): ${(stats[0]?.clv_24h_hit_rate * 100).toFixed(1)}%`);

  console.log('\n=== Done! pm_trade_clv_features_60d is ready. ===');
  await ch.close();
}

main().catch(console.error);
