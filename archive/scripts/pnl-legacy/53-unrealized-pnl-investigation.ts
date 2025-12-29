#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n=== UNREALIZED P&L DATA SOURCE INVESTIGATION ===\n');

  // 1. Check if we already have unrealized_pnl_usd column
  const schema = await client.query({
    query: 'DESCRIBE TABLE trades_raw',
    format: 'JSONEachRow'
  });
  const schemaData: any = await schema.json();
  const hasUnrealizedPnl = schemaData.some((col: any) => col.name === 'unrealized_pnl_usd');

  console.log('1. Column Check:');
  console.log('   - Has unrealized_pnl_usd column:', hasUnrealizedPnl);
  console.log('   - Has realized_pnl_usd column:', schemaData.some((col: any) => col.name === 'realized_pnl_usd'));
  console.log('   - Has entry_price column:', schemaData.some((col: any) => col.name === 'entry_price'));
  console.log('   - Has shares column:', schemaData.some((col: any) => col.name === 'shares'));

  // 2. Count trades
  const tradeCount = await client.query({
    query: 'SELECT COUNT(*) as total FROM trades_raw',
    format: 'JSONEachRow'
  });
  const tradeCountData: any = await tradeCount.json();
  console.log('\n2. Trade Count:', tradeCountData[0].total);

  // 3. Check market_last_price table
  const priceCount = await client.query({
    query: 'SELECT COUNT(*) as total, COUNT(DISTINCT market_id) as unique_markets FROM market_last_price',
    format: 'JSONEachRow'
  });
  const priceCountData: any = await priceCount.json();
  console.log('\n3. Price Data (market_last_price):');
  console.log('   - Total rows:', priceCountData[0].total);
  console.log('   - Unique markets:', priceCountData[0].unique_markets);

  // 4. Check market_candles_5m as alternative
  const candlesCheck = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT market_id) as markets_with_candles,
        MAX(bucket) as latest_candle_time
      FROM market_candles_5m
    `,
    format: 'JSONEachRow'
  });
  const candlesData: any = await candlesCheck.json();
  console.log('\n4. Candle Data (market_candles_5m):');
  console.log('   - Markets with candles:', candlesData[0].markets_with_candles);
  console.log('   - Latest candle time:', candlesData[0].latest_candle_time);

  // 5. Coverage analysis: trades vs prices
  const coverageQuery = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT market_id) as total_markets
      FROM trades_raw
      WHERE market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND market_id != ''
    `,
    format: 'JSONEachRow'
  });
  const coverageData: any = await coverageQuery.json();
  console.log('\n5. Market Coverage:');
  console.log('   - Unique markets in trades_raw:', coverageData[0].total_markets);
  console.log('   - Markets with last_price:', priceCountData[0].unique_markets);

  const coveragePct = (priceCountData[0].unique_markets / coverageData[0].total_markets * 100).toFixed(2);
  console.log('   - Coverage %:', coveragePct);

  // 6. Sample join to test data quality
  const sampleJoin = await client.query({
    query: `
      SELECT
        t.trade_id,
        t.wallet_address,
        t.market_id,
        t.shares,
        t.entry_price,
        p.last_price as current_price,
        (toFloat64(t.shares) * toFloat64OrZero(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price)) as unrealized_pnl
      FROM trades_raw t
      LEFT JOIN market_last_price p ON t.market_id = p.market_id
      WHERE t.wallet_address != ''
        AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND t.market_id != ''
        AND p.last_price IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleData: any = await sampleJoin.json();
  console.log('\n6. Sample Unrealized P&L Calculation:');
  console.log(JSON.stringify(sampleData, null, 2));

  // 7. Count trades with vs without current prices
  const withPrice = await client.query({
    query: `
      SELECT
        COUNT(*) as trades_with_price
      FROM trades_raw t
      INNER JOIN market_last_price p ON t.market_id = p.market_id
      WHERE t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND t.market_id != ''
    `,
    format: 'JSONEachRow'
  });
  const withPriceData: any = await withPrice.json();

  console.log('\n7. Trade Coverage:');
  console.log('   - Total trades:', tradeCountData[0].total);
  console.log('   - Trades with current price:', withPriceData[0].trades_with_price);
  const tradeCoveragePct = (withPriceData[0].trades_with_price / tradeCountData[0].total * 100).toFixed(2);
  console.log('   - % trades with price data:', tradeCoveragePct);

  // 8. Check data freshness
  const freshness = await client.query({
    query: `
      SELECT
        MAX(timestamp) as latest_trade_time,
        toDateTime('2025-11-08') as today,
        dateDiff('day', MAX(timestamp), toDateTime('2025-11-08')) as days_stale
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  });
  const freshnessData: any = await freshness.json();
  console.log('\n8. Data Freshness:');
  console.log('   - Latest trade time:', freshnessData[0].latest_trade_time);
  console.log('   - Days since last trade:', freshnessData[0].days_stale);

  console.log('\n=== SUMMARY ===');
  console.log(`
DATA SOURCE: market_last_price (${priceCountData[0].unique_markets} markets)
COVERAGE: ${tradeCoveragePct}% of trades have current price data
FRESHNESS: Data is ${freshnessData[0].days_stale} days old (last trade: ${freshnessData[0].latest_trade_time})

RECOMMENDED APPROACH:
1. Use market_last_price as current price source (${coveragePct}% market coverage)
2. For missing prices: Can use entry_price as fallback OR mark as NULL
3. Formula: unrealized_pnl_usd = (shares * current_price) - (shares * entry_price)
4. This works for ALL trades (resolved + unresolved)

NEXT STEPS:
- Decide on fallback strategy for missing prices
- Add unrealized_pnl_usd column to trades_raw
- Build wallet_unrealized_pnl aggregate table
  `);

  await client.close();
  process.exit(0);
})();
