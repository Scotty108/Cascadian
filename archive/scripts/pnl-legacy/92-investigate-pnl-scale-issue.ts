#!/usr/bin/env tsx
/**
 * Investigate P&L Scale/Precision Issues
 *
 * Follows investigation plan from PNL_SCALE_PRECISION_INVESTIGATION.md
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 P&L Scale/Precision Investigation');
  console.log('='.repeat(60));
  console.log('');

  // === STEP 1: Check Fee Distribution ===
  console.log('Step 1: Fee Distribution in pm_trades');
  console.log('-'.repeat(60));
  console.log('');

  const feeDistQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN fee_amount = 0 THEN 1 END) as zero_fee_trades,
        COUNT(CASE WHEN fee_amount IS NULL THEN 1 END) as null_fee_trades,
        ROUND(MIN(fee_amount), 6) as min_fee,
        ROUND(MAX(fee_amount), 2) as max_fee,
        ROUND(AVG(fee_amount), 6) as avg_fee,
        ROUND(quantile(0.50)(fee_amount), 6) as median_fee,
        ROUND(quantile(0.90)(fee_amount), 6) as p90_fee,
        ROUND(quantile(0.99)(fee_amount), 2) as p99_fee
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const feeDist = await feeDistQuery.json();
  console.log('Fee Distribution:');
  console.table(feeDist);
  console.log('');

  const zeroFeePct = parseInt(feeDist[0].zero_fee_trades) / parseInt(feeDist[0].total_trades) * 100;
  console.log(`Zero fee rate: ${zeroFeePct.toFixed(2)}%`);
  console.log('');

  // === STEP 2: Check Share/Price Ranges ===
  console.log('Step 2: Share and Price Ranges in pm_trades');
  console.log('-'.repeat(60));
  console.log('');

  const rangesQuery = await clickhouse.query({
    query: `
      SELECT
        ROUND(MIN(shares), 6) as min_shares,
        ROUND(MAX(shares), 2) as max_shares,
        ROUND(AVG(shares), 6) as avg_shares,
        ROUND(quantile(0.50)(shares), 6) as median_shares,

        ROUND(MIN(price), 6) as min_price,
        ROUND(MAX(price), 6) as max_price,
        ROUND(AVG(price), 6) as avg_price,
        ROUND(quantile(0.50)(price), 6) as median_price,

        ROUND(MIN(shares * price), 6) as min_notional,
        ROUND(MAX(shares * price), 2) as max_notional,
        ROUND(AVG(shares * price), 6) as avg_notional,
        ROUND(quantile(0.50)(shares * price), 6) as median_notional
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const ranges = await rangesQuery.json();
  console.log('Share/Price/Notional Ranges:');
  console.table(ranges);
  console.log('');

  // === STEP 3: Sample Specific Trades ===
  console.log('Step 3: Sample Trades (Random 10)');
  console.log('-'.repeat(60));
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(market_id, 1, 16) || '...' as market_short,
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        side,
        ROUND(shares, 6) as shares,
        ROUND(price, 6) as price,
        ROUND(shares * price, 6) as notional,
        ROUND(fee_amount, 6) as fee_amount,
        outcome_label
      FROM pm_trades
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Trades:');
  console.table(samples);
  console.log('');

  // === STEP 4: Check Specific High-Deviation Market ===
  console.log('Step 4: Examine Top Failing Market');
  console.log('-'.repeat(60));
  console.log('');

  // Get the market with highest deviation
  const topMarketQuery = await clickhouse.query({
    query: `
      WITH market_totals AS (
        SELECT
          condition_id,
          question,
          SUM(pnl_net) + SUM(fees_paid) as deviation,
          ABS(SUM(pnl_net) + SUM(fees_paid)) as abs_deviation,
          SUM(fees_paid) as total_fees,
          SUM(pnl_net) as total_pnl,
          COUNT(DISTINCT wallet_address) as num_wallets
        FROM pm_wallet_market_pnl_resolved
        GROUP BY condition_id, question
      )
      SELECT
        condition_id,
        substring(question, 1, 60) as question_short,
        ROUND(total_pnl, 2) as total_pnl,
        ROUND(total_fees, 2) as total_fees,
        ROUND(deviation, 2) as deviation,
        num_wallets
      FROM market_totals
      ORDER BY abs_deviation DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const topMarket = await topMarketQuery.json();
  console.log('Top Failing Market:');
  console.table(topMarket);
  console.log('');

  const topConditionId = topMarket[0].condition_id;

  // Get sample trades from this market
  const marketTradesQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        side,
        outcome_index,
        outcome_label,
        ROUND(shares, 6) as shares,
        ROUND(price, 6) as price,
        ROUND(shares * price, 6) as notional,
        ROUND(fee_amount, 6) as fee_amount
      FROM pm_trades
      WHERE condition_id = '${topConditionId}'
      ORDER BY timestamp
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const marketTrades = await marketTradesQuery.json();
  console.log(`Sample Trades from Top Failing Market (${topMarket[0].question_short}):`);
  console.table(marketTrades);
  console.log('');

  // === STEP 5: Compare Aggregated Values ===
  console.log('Step 5: Aggregate Checks for Top Failing Market');
  console.log('-'.repeat(60));
  console.log('');

  const aggregateQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        COUNT(DISTINCT wallet_address) as wallet_count,
        ROUND(SUM(fee_amount), 2) as total_fees_from_trades,
        ROUND(SUM(
          CASE
            WHEN side = 'BUY' THEN shares
            ELSE -shares
          END
        ), 2) as market_net_shares,
        ROUND(SUM(shares), 2) as total_volume
      FROM pm_trades
      WHERE condition_id = '${topConditionId}'
    `,
    format: 'JSONEachRow'
  });

  const aggregate = await aggregateQuery.json();
  console.log('Market Aggregates:');
  console.table(aggregate);
  console.log('');

  // === STEP 6: Check if Price is in Correct Range ===
  console.log('Step 6: Price Range Validation');
  console.log('-'.repeat(60));
  console.log('');

  const priceCheckQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN price < 0 THEN 1 END) as negative_prices,
        COUNT(CASE WHEN price > 1 THEN 1 END) as prices_above_1,
        COUNT(CASE WHEN price >= 0 AND price <= 1 THEN 1 END) as valid_prices
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const priceCheck = await priceCheckQuery.json();
  console.log('Price Validation:');
  console.table(priceCheck);
  console.log('');

  const validPricePct = parseInt(priceCheck[0].valid_prices) / parseInt(priceCheck[0].total_trades) * 100;
  console.log(`Valid price rate (0-1): ${validPricePct.toFixed(2)}%`);
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 INVESTIGATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  console.log('Fee Analysis:');
  console.log(`  Zero fees: ${zeroFeePct.toFixed(2)}% of trades`);
  console.log(`  Min fee: $${parseFloat(feeDist[0].min_fee).toLocaleString()}`);
  console.log(`  Max fee: $${parseFloat(feeDist[0].max_fee).toLocaleString()}`);
  console.log(`  Median fee: $${parseFloat(feeDist[0].median_fee).toLocaleString()}`);
  console.log('');

  console.log('Share Analysis:');
  console.log(`  Min shares: ${parseFloat(ranges[0].min_shares).toLocaleString()}`);
  console.log(`  Max shares: ${parseFloat(ranges[0].max_shares).toLocaleString()}`);
  console.log(`  Median shares: ${parseFloat(ranges[0].median_shares).toLocaleString()}`);
  console.log('');

  console.log('Price Analysis:');
  console.log(`  Min price: ${parseFloat(ranges[0].min_price)}`);
  console.log(`  Max price: ${parseFloat(ranges[0].max_price)}`);
  console.log(`  Valid prices (0-1): ${validPricePct.toFixed(2)}%`);
  console.log('');

  console.log('Notional Analysis:');
  console.log(`  Min notional: $${parseFloat(ranges[0].min_notional).toLocaleString()}`);
  console.log(`  Max notional: $${parseFloat(ranges[0].max_notional).toLocaleString()}`);
  console.log(`  Median notional: $${parseFloat(ranges[0].median_notional).toLocaleString()}`);
  console.log('');

  // Diagnose likely issues
  const issues = [];

  if (zeroFeePct > 50) {
    issues.push(`⚠️  ${zeroFeePct.toFixed(0)}% of trades have zero fees (likely fee calculation bug)`);
  }

  if (parseFloat(ranges[0].max_shares) > 1000000000) {
    issues.push(`⚠️  Max shares = ${parseFloat(ranges[0].max_shares).toLocaleString()} (likely scale issue, shares too large)`);
  }

  if (parseFloat(ranges[0].max_notional) > 1000000000) {
    issues.push(`⚠️  Max notional = $${parseFloat(ranges[0].max_notional).toLocaleString()} (likely shares or price scale issue)`);
  }

  if (validPricePct < 99) {
    issues.push(`⚠️  ${(100 - validPricePct).toFixed(2)}% of prices outside [0, 1] range`);
  }

  if (issues.length > 0) {
    console.log('Issues Detected:');
    issues.forEach(i => console.log(`  ${i}`));
    console.log('');
  } else {
    console.log('✅ No obvious scale/precision issues detected in raw data');
    console.log('');
  }
}

main().catch((error) => {
  console.error('❌ Investigation failed:', error);
  process.exit(1);
});
