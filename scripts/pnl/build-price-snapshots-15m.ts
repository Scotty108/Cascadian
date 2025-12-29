/**
 * Step 1: Build pm_price_snapshots_15m
 *
 * Creates 15-minute price snapshots from CLOB trades for CLV calculation.
 * This is the foundation for the Super Forecaster Discovery Pipeline.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minutes
});

async function main() {
  console.log('=== Building pm_price_snapshots_15m ===\n');

  // Step 1: Create the table
  console.log('1. Creating table...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_price_snapshots_15m (
        token_id String,
        bucket DateTime,
        last_price Float64,
        vwap Float64,
        volume_usdc Float64,
        trade_count UInt32
      ) ENGINE = ReplacingMergeTree()
      PARTITION BY toYYYYMM(bucket)
      ORDER BY (token_id, bucket)
      TTL bucket + INTERVAL 120 DAY
    `,
  });
  console.log('   Table created (or already exists).\n');

  // Step 2: Populate the table
  console.log('\n4. Populating price snapshots (this may take a few minutes)...');
  const startTime = Date.now();

  await ch.command({
    query: `
      INSERT INTO pm_price_snapshots_15m
      SELECT
        token_id,
        toStartOfFifteenMinutes(trade_time) as bucket,
        -- Last price: use argMax to get price from most recent trade in bucket
        argMax(
          toFloat64(usdc_amount) / toFloat64(token_amount),
          trade_time
        ) as last_price,
        -- VWAP: volume-weighted average price
        sum(toFloat64(usdc_amount)) / sum(toFloat64(token_amount)) as vwap,
        -- Volume in USDC (divide by 1e6 for human-readable)
        sum(toFloat64(usdc_amount)) / 1000000.0 as volume_usdc,
        -- Trade count
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 60 DAY
        AND token_amount > 0
        AND usdc_amount > 0
      GROUP BY token_id, bucket
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Completed in ${elapsed}s`);

  // Step 5: Verify results
  console.log('\n5. Verifying results...');
  const countAfter = await ch.query({
    query: `SELECT count() as cnt FROM pm_price_snapshots_15m`,
    format: 'JSONEachRow',
  });
  const afterRows = (await countAfter.json()) as { cnt: string }[];
  console.log(`   Total rows: ${Number(afterRows[0]?.cnt).toLocaleString()}`);

  // Sample data
  const sampleQ = await ch.query({
    query: `
      SELECT
        token_id,
        bucket,
        last_price,
        vwap,
        volume_usdc,
        trade_count
      FROM pm_price_snapshots_15m
      ORDER BY volume_usdc DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const samples = (await sampleQ.json()) as any[];

  console.log('\n   Top 10 buckets by volume:');
  console.log('   ' + '-'.repeat(90));
  for (const s of samples) {
    console.log(`   ${s.token_id.slice(0, 16)}... | ${s.bucket} | $${Number(s.last_price).toFixed(4)} | ${Number(s.volume_usdc).toFixed(0)} USDC | ${s.trade_count} trades`);
  }

  // Coverage stats
  const coverageQ = await ch.query({
    query: `
      SELECT
        uniqExact(token_id) as unique_tokens,
        count() as total_buckets,
        min(bucket) as earliest_bucket,
        max(bucket) as latest_bucket,
        sum(trade_count) as total_trades_covered
      FROM pm_price_snapshots_15m
    `,
    format: 'JSONEachRow',
  });
  const coverage = (await coverageQ.json()) as any[];

  console.log('\n6. Coverage summary:');
  console.log(`   Unique tokens: ${Number(coverage[0]?.unique_tokens).toLocaleString()}`);
  console.log(`   Total 15m buckets: ${Number(coverage[0]?.total_buckets).toLocaleString()}`);
  console.log(`   Date range: ${coverage[0]?.earliest_bucket} to ${coverage[0]?.latest_bucket}`);
  console.log(`   Trades covered: ${Number(coverage[0]?.total_trades_covered).toLocaleString()}`);

  console.log('\n=== Done! pm_price_snapshots_15m is ready. ===');
  await ch.close();
}

main().catch(console.error);
