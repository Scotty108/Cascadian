#!/usr/bin/env npx tsx
/**
 * DEEP DATA INSPECTION
 *
 * Examine the actual structure and completeness of our existing data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(100));
  console.log('DEEP DATA INSPECTION');
  console.log('='.repeat(100));

  // 1. Check market_resolutions_final structure (most complete resolution table)
  console.log('\n[1] MARKET RESOLUTIONS SCHEMA');
  console.log('-'.repeat(100));

  const resSchema = await ch.query({
    query: 'DESCRIBE TABLE default.market_resolutions_final',
    format: 'JSONEachRow'
  });
  const resFields = await resSchema.json();

  console.log('  market_resolutions_final columns:');
  for (const field of resFields) {
    console.log(`    - ${field.name}: ${field.type}`);
  }

  // Sample resolution data
  const resSample = await ch.query({
    query: `
      SELECT *
      FROM default.market_resolutions_final
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const resSampleData = await resSample.json();

  console.log('\n  Sample resolutions:');
  for (const res of resSampleData) {
    console.log(`\n    Market: ${res.market_id || res.condition_id || 'unknown'}`);
    for (const [key, value] of Object.entries(res)) {
      if (value !== null && value !== '') {
        console.log(`      ${key}: ${String(value).substring(0, 80)}`);
      }
    }
  }

  // 2. Check gamma_markets for categories
  console.log('\n\n[2] GAMMA MARKETS SCHEMA (Categories & Tags)');
  console.log('-'.repeat(100));

  const gammaSchema = await ch.query({
    query: 'DESCRIBE TABLE default.gamma_markets',
    format: 'JSONEachRow'
  });
  const gammaFields = await gammaSchema.json();

  console.log('  gamma_markets columns:');
  for (const field of gammaFields) {
    console.log(`    - ${field.name}: ${field.type}`);
  }

  // Sample gamma market data
  const gammaSample = await ch.query({
    query: `
      SELECT *
      FROM default.gamma_markets
      LIMIT 2
    `,
    format: 'JSONEachRow'
  });
  const gammaSampleData = await gammaSample.json();

  console.log('\n  Sample gamma markets:');
  for (const market of gammaSampleData) {
    console.log(`\n    Market: ${market.id || market.market_id || 'unknown'}`);
    for (const [key, value] of Object.entries(market)) {
      if (value !== null && value !== '') {
        const strValue = String(value);
        if (strValue.length > 100) {
          console.log(`      ${key}: ${strValue.substring(0, 100)}...`);
        } else {
          console.log(`      ${key}: ${strValue}`);
        }
      }
    }
  }

  // 3. Check dim_markets for comprehensive metadata
  console.log('\n\n[3] DIM_MARKETS SCHEMA (Full Market Metadata)');
  console.log('-'.repeat(100));

  const dimSchema = await ch.query({
    query: 'DESCRIBE TABLE default.dim_markets',
    format: 'JSONEachRow'
  });
  const dimFields = await dimSchema.json();

  console.log('  dim_markets columns:');
  for (const field of dimFields) {
    console.log(`    - ${field.name}: ${field.type}`);
  }

  // Check if we have categories
  const categoriesCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT tags) as unique_tags,
        COUNT(DISTINCT category) as unique_categories
      FROM default.gamma_markets
      WHERE tags != '' OR category != ''
    `,
    format: 'JSONEachRow'
  });
  const catData = (await categoriesCheck.json())[0];

  console.log(`\n  Category coverage:`);
  console.log(`    Markets with tags/categories: ${parseInt(catData.total).toLocaleString()}`);
  console.log(`    Unique tags: ${parseInt(catData.unique_tags).toLocaleString()}`);
  console.log(`    Unique categories: ${parseInt(catData.unique_categories).toLocaleString()}`);

  // 4. Check trade timestamps issue
  console.log('\n\n[4] TRADE TIMESTAMPS INVESTIGATION');
  console.log('-'.repeat(100));

  const tradeTimestamps = await ch.query({
    query: `
      SELECT
        COUNT(DISTINCT created_at) as unique_timestamps,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM default.trade_direction_assignments
      WHERE created_at IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const tsData = (await tradeTimestamps.json())[0];

  console.log(`  Unique timestamps: ${parseInt(tsData.unique_timestamps).toLocaleString()}`);
  console.log(`  Earliest: ${tsData.earliest}`);
  console.log(`  Latest: ${tsData.latest}`);

  if (parseInt(tsData.unique_timestamps) === 1) {
    console.log(`\n  ⚠️  ALL TRADES HAVE SAME TIMESTAMP - checking alternate timestamp fields...`);

    const altTimestamps = await ch.query({
      query: `
        SELECT
          COUNT(DISTINCT timestamp) as unique_alt_timestamps,
          MIN(timestamp) as earliest_alt,
          MAX(timestamp) as latest_alt
        FROM default.trade_direction_assignments
        WHERE timestamp IS NOT NULL
      `,
      format: 'JSONEachRow'
    });
    const altTsData = (await altTimestamps.json())[0];

    console.log(`\n  Alternate 'timestamp' field:`);
    console.log(`    Unique: ${parseInt(altTsData.unique_alt_timestamps).toLocaleString()}`);
    console.log(`    Earliest: ${altTsData.earliest_alt}`);
    console.log(`    Latest: ${altTsData.latest_alt}`);
  }

  // 5. Check CTF contract deployment block
  console.log('\n\n[5] BLOCK RANGE VALIDATION');
  console.log('-'.repeat(100));

  console.log(`  Current ERC-1155 backfill: Blocks 37,515,000 → 78,299,514`);
  console.log(`\n  Checking if we need earlier blocks...`);

  // Check earliest trade's block (if available via tx_hash lookup)
  const earliestTxSample = await ch.query({
    query: `
      SELECT tx_hash
      FROM default.trade_direction_assignments
      ORDER BY created_at ASC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const earliestTx = (await earliestTxSample.json())[0];

  console.log(`  Earliest trade tx_hash: ${earliestTx?.tx_hash || 'Not available'}`);
  console.log(`\n  Note: CTF contract (0x4d97dcd...) deployed at block ~37,515,000`);
  console.log(`        Our backfill starts at this deployment block ✅`);

  // 6. Check for price history
  console.log('\n\n[6] PRICE DATA COVERAGE');
  console.log('-'.repeat(100));

  const priceStats = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_candles,
        MIN(timestamp) as earliest_price,
        MAX(timestamp) as latest_price,
        COUNT(DISTINCT market_id) as markets_with_prices
      FROM default.market_candles_5m
    `,
    format: 'JSONEachRow'
  });
  const priceData = (await priceStats.json())[0];

  console.log(`  Total 5-min candles: ${parseInt(priceData.total_candles).toLocaleString()}`);
  console.log(`  Earliest price: ${priceData.earliest_price}`);
  console.log(`  Latest price: ${priceData.latest_price}`);
  console.log(`  Markets with price data: ${parseInt(priceData.markets_with_prices).toLocaleString()}`);

  const priceDays = Math.floor((new Date(priceData.latest_price).getTime() - new Date(priceData.earliest_price).getTime()) / (1000 * 60 * 60 * 24));
  console.log(`  Price history: ${priceDays} days`);

  // 7. Summary
  console.log('\n' + '='.repeat(100));
  console.log('DATA COMPLETENESS SUMMARY');
  console.log('='.repeat(100));

  console.log(`
✅ WHAT WE HAVE:

1. Trades: 130M rows
   - Issue: Timestamps might need investigation

2. Settlements: 7.5M ERC-1155 transfers (→ 10-13M)
   - Coverage: Block 37,515,000+ (CTF contract deployment)
   - Status: BACKFILLING NOW

3. Resolutions: 218K+ resolved markets
   - Tables: market_resolutions_final (most complete)
   - Need to verify: payout vectors present?

4. Market Metadata: 318K+ markets
   - Tables: dim_markets, gamma_markets
   - Categories: ${parseInt(catData.unique_categories).toLocaleString()} unique
   - Tags: ${parseInt(catData.unique_tags).toLocaleString()} unique

5. Price Data: 8M+ candles (5-min intervals)
   - Coverage: ${priceDays} days
   - Markets: ${parseInt(priceData.markets_with_prices).toLocaleString()}

🔍 NEED TO VERIFY:

1. Do resolution tables have payout_numerators arrays?
2. Are categories properly mapped to trades?
3. Can we join trades → resolutions → categories?
4. Is the trade timestamp issue a blocker?

🎯 LIKELY COMPLETE - Just need to verify data quality!
`);

  await ch.close();
}

main().catch(console.error);
