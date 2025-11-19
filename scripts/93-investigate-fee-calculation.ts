#!/usr/bin/env tsx
/**
 * Investigate Fee Calculation Issue
 *
 * Why are 99.98% of trades showing $0 fees?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 Fee Calculation Investigation');
  console.log('='.repeat(60));
  console.log('');

  // === STEP 1: Check fee_rate_bps in clob_fills ===
  console.log('Step 1: Check fee_rate_bps in clob_fills source');
  console.log('-'.repeat(60));
  console.log('');

  const feeRateQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_fills,
        COUNT(CASE WHEN fee_rate_bps = 0 THEN 1 END) as zero_fee_rate,
        COUNT(CASE WHEN fee_rate_bps IS NULL THEN 1 END) as null_fee_rate,
        COUNT(CASE WHEN fee_rate_bps > 0 THEN 1 END) as nonzero_fee_rate,
        MIN(fee_rate_bps) as min_fee_rate,
        MAX(fee_rate_bps) as max_fee_rate,
        AVG(fee_rate_bps) as avg_fee_rate,
        quantile(0.50)(fee_rate_bps) as median_fee_rate
      FROM clob_fills
    `,
    format: 'JSONEachRow'
  });

  const feeRate = await feeRateQuery.json();
  console.log('Fee Rate Distribution in clob_fills:');
  console.table(feeRate);
  console.log('');

  const zeroRatePct = parseInt(feeRate[0].zero_fee_rate) / parseInt(feeRate[0].total_fills) * 100;
  console.log(`Zero fee_rate_bps: ${zeroRatePct.toFixed(2)}%`);
  console.log('');

  // === STEP 2: Sample some fills with non-zero fees ===
  console.log('Step 2: Sample fills with non-zero fee_rate_bps');
  console.log('-'.repeat(60));
  console.log('');

  const nonzeroFeeQuery = await clickhouse.query({
    query: `
      SELECT
        substring(fill_id, 1, 20) || '...' as fill_id_short,
        ROUND(size, 2) as size_raw,
        ROUND(price, 6) as price,
        fee_rate_bps,
        ROUND((size / 1000000.0) * price, 6) as notional,
        ROUND((size / 1000000.0) * price * (fee_rate_bps / 10000.0), 6) as calculated_fee
      FROM clob_fills
      WHERE fee_rate_bps > 0
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const nonzeroFees = await nonzeroFeeQuery.json();
  console.log('Sample Fills with Non-Zero Fee Rate:');
  console.table(nonzeroFees);
  console.log('');

  // === STEP 3: Sample some fills with zero fees ===
  console.log('Step 3: Sample fills with zero fee_rate_bps');
  console.log('-'.repeat(60));
  console.log('');

  const zeroFeeQuery = await clickhouse.query({
    query: `
      SELECT
        substring(fill_id, 1, 20) || '...' as fill_id_short,
        ROUND(size, 2) as size_raw,
        ROUND(price, 6) as price,
        fee_rate_bps,
        ROUND((size / 1000000.0) * price, 6) as notional,
        ROUND((size / 1000000.0) * price * (fee_rate_bps / 10000.0), 6) as calculated_fee
      FROM clob_fills
      WHERE fee_rate_bps = 0
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const zeroFees = await zeroFeeQuery.json();
  console.log('Sample Fills with Zero Fee Rate:');
  console.table(zeroFees);
  console.log('');

  // === STEP 4: Check if there are other fee columns ===
  console.log('Step 4: Check clob_fills schema for fee columns');
  console.log('-'.repeat(60));
  console.log('');

  const schemaQuery = await clickhouse.query({
    query: `
      SELECT
        name,
        type
      FROM system.columns
      WHERE table = 'clob_fills'
        AND database = currentDatabase()
        AND (name LIKE '%fee%' OR name LIKE '%maker%' OR name LIKE '%taker%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const schema = await schemaQuery.json();
  console.log('Fee-related columns in clob_fills:');
  console.table(schema);
  console.log('');

  // === STEP 5: Check the top losing wallet trades ===
  console.log('Step 5: Examine top losing wallet (0xb78e52c3...)');
  console.log('-'.repeat(60));
  console.log('');

  const topLoserQuery = await clickhouse.query({
    query: `
      SELECT
        fill_id,
        timestamp,
        ROUND(size, 2) as size_raw,
        ROUND(price, 6) as price,
        fee_rate_bps,
        ROUND((size / 1000000.0), 6) as shares,
        ROUND((size / 1000000.0) * price, 6) as notional,
        ROUND((size / 1000000.0) * price * (fee_rate_bps / 10000.0), 6) as calculated_fee
      FROM clob_fills
      WHERE lower(proxy_wallet) = '0xb78e52c30a7ca51aa1457f0d265dab0e4c87a4f6'
      ORDER BY timestamp
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const topLoser = await topLoserQuery.json();
  console.log('Top Loser Wallet Trades:');
  console.table(topLoser);
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 INVESTIGATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  console.log('Fee Rate Analysis:');
  console.log(`  Zero fee_rate_bps: ${zeroRatePct.toFixed(2)}% of fills`);
  console.log(`  Non-zero fee_rate_bps: ${((100 - zeroRatePct)).toFixed(2)}% of fills`);
  console.log(`  Median fee_rate_bps: ${parseFloat(feeRate[0].median_fee_rate)}`);
  console.log('');

  if (zeroRatePct > 95) {
    console.log('🚨 CRITICAL: >95% of fills have fee_rate_bps = 0');
    console.log('This explains why conservation check fails.');
    console.log('');
    console.log('Possible causes:');
    console.log('  1. Polymarket API does not provide fee data in CLOB fills');
    console.log('  2. Fee data is in a separate table/field');
    console.log('  3. Fees are computed differently (maker/taker tiers)');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Check Polymarket API documentation for fee structure');
    console.log('  2. Look for maker_fee/taker_fee columns');
    console.log('  3. Consider using default fee rate (e.g., 20-100 bps)');
    console.log('');
  }
}

main().catch((error) => {
  console.error('❌ Investigation failed:', error);
  process.exit(1);
});
