#!/usr/bin/env npx tsx

/**
 * Build Current Prices Table - Pre-aggregated for Unrealized P&L
 *
 * Creates a cached table of the most recent price for each market.
 * Used by unrealized P&L calculations to avoid expensive JOINs on 8M+ candles.
 *
 * Source: default.market_candles_5m (8M rows, 151K unique markets)
 * Output: default.dim_current_prices (151K rows, 1 per market)
 *
 * Runtime: ~30 seconds
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const ch = clickhouse;

  console.log('💰 Building current prices table for unrealized P&L...\n');

  // Step 1: Create staging table with latest prices
  console.log('Step 1: Extracting latest prices from market_candles_5m...');

  const createStagingQuery = `
    CREATE TABLE IF NOT EXISTS default.dim_current_prices_staging
    ENGINE = ReplacingMergeTree()
    ORDER BY condition_id_norm
    AS
    WITH
    -- Get latest candle for each market (no time filter for max coverage)
    latest_candles AS (
      SELECT
        market_id,
        bucket,
        close,
        vwap,
        volume,
        row_number() OVER (PARTITION BY market_id ORDER BY bucket DESC) as rn
      FROM default.market_candles_5m
    ),
    -- Filter to most recent only
    most_recent AS (
      SELECT
        market_id,
        bucket,
        close,
        vwap,
        volume
      FROM latest_candles
      WHERE rn = 1
    )
    SELECT
      -- Normalized condition_id (strip 0x, lowercase)
      lower(replaceAll(market_id, '0x', '')) as condition_id_norm,

      -- Original market_id
      market_id as market_id_original,

      -- Current price (use close, fallback to vwap)
      toFloat64OrDefault(close, toFloat64OrDefault(vwap, toFloat64(0.5))) as current_price,

      -- VWAP as alternative price
      toFloat64OrDefault(vwap, toFloat64(0)) as vwap_price,

      -- Volume (indicates liquidity/activity)
      toFloat64OrDefault(volume, toFloat64(0)) as volume_24h,

      -- Timestamp of this price
      bucket as price_timestamp,

      -- Data freshness indicator
      dateDiff('hour', bucket, now()) as hours_stale,

      -- Updated timestamp
      now() as updated_at
    FROM most_recent
  `;

  await ch.command({ query: createStagingQuery });
  console.log('✅ Staging table created\n');

  // Step 2: Validate row count
  console.log('Step 2: Validating data...');

  const countResult = await ch.query({
    query: 'SELECT count() as count FROM default.dim_current_prices_staging',
    format: 'JSONEachRow'
  });

  const rows = await countResult.json<Array<{ count: string }>>();
  const rowCount = parseInt(rows[0].count);

  console.log(`  Total markets with prices: ${rowCount.toLocaleString()}`);

  if (rowCount < 100000) {
    console.warn(`  ⚠️  Expected ~151K markets, got ${rowCount}. Check source data.`);
  }

  // Step 3: Check data quality
  console.log('\nStep 3: Checking data quality...');

  const qualityResult = await ch.query({
    query: `
      SELECT
        count() as total,
        countIf(current_price > 0 AND current_price <= 1) as valid_prices,
        countIf(hours_stale < 24) as fresh_24h,
        countIf(hours_stale < 168) as fresh_7d,
        avg(current_price) as avg_price,
        median(current_price) as median_price,
        avg(hours_stale) as avg_age_hours
      FROM default.dim_current_prices_staging
    `,
    format: 'JSONEachRow'
  });

  const quality = await qualityResult.json<Array<any>>();
  const q = quality[0];

  console.log(`  Valid prices (0-1): ${parseInt(q.valid_prices).toLocaleString()} (${(parseInt(q.valid_prices)/rowCount*100).toFixed(1)}%)`);
  console.log(`  Fresh (<24h): ${parseInt(q.fresh_24h).toLocaleString()} (${(parseInt(q.fresh_24h)/rowCount*100).toFixed(1)}%)`);
  console.log(`  Fresh (<7d): ${parseInt(q.fresh_7d).toLocaleString()} (${(parseInt(q.fresh_7d)/rowCount*100).toFixed(1)}%)`);
  console.log(`  Average price: $${parseFloat(q.avg_price).toFixed(4)}`);
  console.log(`  Median price: $${parseFloat(q.median_price).toFixed(4)}`);
  console.log(`  Average age: ${parseFloat(q.avg_age_hours).toFixed(1)} hours\n`);

  // Step 4: Sample check
  console.log('Step 4: Sample validation...');

  const sampleResult = await ch.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) as cid_preview,
        current_price,
        vwap_price,
        volume_24h,
        hours_stale,
        price_timestamp
      FROM default.dim_current_prices_staging
      WHERE current_price > 0
      ORDER BY volume_24h DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json<Array<any>>();

  console.log('\n  Top 5 markets by volume:');
  samples.forEach((s, i) => {
    console.log(`\n  ${i + 1}. Condition: ${s.cid_preview}...`);
    console.log(`     Current price: $${parseFloat(s.current_price).toFixed(4)}`);
    console.log(`     VWAP: $${parseFloat(s.vwap_price).toFixed(4)}`);
    console.log(`     Volume: ${parseFloat(s.volume_24h).toLocaleString()}`);
    console.log(`     Age: ${s.hours_stale} hours`);
    console.log(`     Timestamp: ${s.price_timestamp}`);
  });

  // Step 5: Atomic swap
  console.log('\n\nStep 5: Performing atomic swap...');

  // Drop old table if exists
  await ch.command({ query: 'DROP TABLE IF EXISTS default.dim_current_prices_old' });

  // Rename current table to old (if exists)
  try {
    await ch.command({
      query: 'RENAME TABLE default.dim_current_prices TO default.dim_current_prices_old'
    });
    console.log('  Backed up existing dim_current_prices');
  } catch (e) {
    console.log('  No existing dim_current_prices to backup');
  }

  // Rename staging to final
  await ch.command({
    query: 'RENAME TABLE default.dim_current_prices_staging TO default.dim_current_prices'
  });
  console.log('  Promoted staging to dim_current_prices');

  // Step 6: Usage example
  console.log('\n\n✅ Current prices table built successfully!');
  console.log(`   Total markets: ${rowCount.toLocaleString()}`);
  console.log(`   Table: default.dim_current_prices`);
  console.log(`   Old backup: default.dim_current_prices_old (can be dropped)\n`);

  console.log('Usage in unrealized P&L query:');
  console.log(`
    SELECT
      t.wallet_address,
      t.condition_id_norm,
      t.shares_held,
      t.cost_basis,
      p.current_price,
      -- Unrealized P&L calculation
      (t.shares_held * p.current_price) - t.cost_basis as unrealized_pnl
    FROM default.wallet_positions t
    LEFT JOIN default.dim_current_prices p
      ON p.condition_id_norm = t.condition_id_norm
    WHERE t.shares_held != 0
  `);

  console.log('\nRefresh frequency:');
  console.log('  Recommended: Every 15 minutes during market hours');
  console.log('  Cron: */15 * * * * cd /path/to/project && npx tsx build-current-prices.ts\n');
}

main().catch(console.error);
