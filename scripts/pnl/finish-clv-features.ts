/**
 * Complete CLV features for remaining days (weeks 7-9)
 * Uses daily batches to avoid memory limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('=== Completing CLV features (days -18 to -1 in daily batches) ===\n');

  // Days 18 back to 1 (current), one day at a time
  for (let daysAgo = 18; daysAgo >= 1; daysAgo--) {
    console.log(`Day -${daysAgo}d...`);
    const startTime = Date.now();

    const query = `
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
        AND t.trade_time >= now() - INTERVAL ${daysAgo} DAY
        AND t.trade_time < now() - INTERVAL ${daysAgo - 1} DAY
        AND t.token_amount > 0
        AND t.usdc_amount > 0
        AND t.side = 'buy'
    `;

    await ch.command({
      query,
      clickhouse_settings: {
        wait_end_of_query: 1,
        max_execution_time: 120,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done (${elapsed}s)`);
  }

  // Check final count
  const countQ = await ch.query({
    query: 'SELECT count() as cnt FROM pm_trade_clv_features_60d',
    format: 'JSONEachRow',
  });
  const result = (await countQ.json()) as any[];
  console.log(`\nTotal rows: ${Number(result[0]?.cnt).toLocaleString()}`);

  // Stats
  const statsQ = await ch.query({
    query: `
      SELECT
        uniqExact(wallet) as wallets,
        avg(p24h_found) as p24_coverage,
        avg(clv_24h) as avg_clv_24h,
        countIf(clv_24h > 0) / countIf(p24h_found = 1) as hit_rate
      FROM pm_trade_clv_features_60d
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json()) as any[];
  console.log(`\nStats:`);
  console.log(`  Wallets: ${Number(stats[0]?.wallets).toLocaleString()}`);
  console.log(`  24h coverage: ${(stats[0]?.p24_coverage * 100).toFixed(1)}%`);
  console.log(`  Avg CLV (24h): ${stats[0]?.avg_clv_24h?.toFixed(4)}`);
  console.log(`  Hit rate: ${(stats[0]?.hit_rate * 100).toFixed(1)}%`);

  await ch.close();
}

main().catch(console.error);
