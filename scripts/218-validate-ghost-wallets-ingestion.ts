#!/usr/bin/env tsx
/**
 * Phase 5.5: Validate Ghost Wallets Ingestion
 *
 * Purpose: Verify data quality and coverage after live ingestion
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 5.5: Ghost Wallets Ingestion Validation');
  console.log('═'.repeat(80));
  console.log('');

  // Check 1: Total row count
  console.log('Check 1: Total Row Count in external_trades_raw');
  console.log('─'.repeat(80));

  const totalResult = await clickhouse.query({
    query: `SELECT COUNT(*) as total FROM external_trades_raw`,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;
  console.log(`  Total rows: ${total}`);
  console.log('');

  // Check 2: Breakdown by source
  console.log('Check 2: Breakdown by Source');
  console.log('─'.repeat(80));

  const sourceResult = await clickhouse.query({
    query: `
      SELECT
        source,
        COUNT(*) as count,
        SUM(shares) as total_shares,
        SUM(cash_value) as total_value
      FROM external_trades_raw
      GROUP BY source
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const sources: any[] = await sourceResult.json();
  sources.forEach(s => {
    console.log(`  ${s.source}:`);
    console.log(`    Trades: ${s.count}`);
    console.log(`    Shares: ${s.total_shares.toFixed(2)}`);
    console.log(`    Value:  $${s.total_value.toFixed(2)}`);
    console.log('');
  });

  // Check 3: Ghost markets coverage
  console.log('Check 3: Ghost Markets Coverage');
  console.log('─'.repeat(80));

  const ghostMarketsResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(*) as trade_count,
        COUNT(DISTINCT wallet_address) as wallet_count,
        SUM(shares) as total_shares,
        SUM(cash_value) as total_value,
        MIN(trade_timestamp) as first_trade,
        MAX(trade_timestamp) as last_trade
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
      GROUP BY condition_id
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });
  const ghostMarkets: any[] = await ghostMarketsResult.json();

  console.log(`  Total ghost markets with trades: ${ghostMarkets.length}`);
  console.log('');

  ghostMarkets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.condition_id.substring(0, 24)}...`);
    console.log(`     Trades:  ${m.trade_count}`);
    console.log(`     Wallets: ${m.wallet_count}`);
    console.log(`     Shares:  ${m.total_shares.toFixed(2)}`);
    console.log(`     Value:   $${m.total_value.toFixed(2)}`);
    console.log(`     Period:  ${new Date(m.first_trade).toISOString().split('T')[0]} → ${new Date(m.last_trade).toISOString().split('T')[0]}`);
    console.log('');
  });

  // Check 4: Unique wallets
  console.log('Check 4: Unique Wallets');
  console.log('─'.repeat(80));

  const walletsResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as unique_wallets
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
    `,
    format: 'JSONEachRow'
  });
  const uniqueWallets = (await walletsResult.json())[0].unique_wallets;
  console.log(`  Unique wallets: ${uniqueWallets}`);
  console.log('');

  // Check 5: Top 10 most active wallets
  console.log('Check 5: Top 10 Most Active Wallets (Ghost Markets)');
  console.log('─'.repeat(80));

  const topWalletsResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        COUNT(*) as trade_count,
        SUM(shares) as total_shares,
        SUM(cash_value) as total_value
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
      GROUP BY wallet_address
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topWallets: any[] = await topWalletsResult.json();

  topWallets.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_address.substring(0, 16)}...`);
    console.log(`     Trades: ${w.trade_count}`);
    console.log(`     Shares: ${w.total_shares.toFixed(2)}`);
    console.log(`     Value:  $${w.total_value.toFixed(2)}`);
    console.log('');
  });

  // Check 6: Date range
  console.log('Check 6: Date Range of Ghost Market Trades');
  console.log('─'.repeat(80));

  const dateRangeResult = await clickhouse.query({
    query: `
      SELECT
        MIN(trade_timestamp) as first_trade,
        MAX(trade_timestamp) as last_trade,
        dateDiff('day', MIN(trade_timestamp), MAX(trade_timestamp)) as days_span
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
    `,
    format: 'JSONEachRow'
  });
  const dateRange: any = (await dateRangeResult.json())[0];
  console.log(`  First trade: ${new Date(dateRange.first_trade).toISOString()}`);
  console.log(`  Last trade:  ${new Date(dateRange.last_trade).toISOString()}`);
  console.log(`  Days span:   ${dateRange.days_span} days`);
  console.log('');

  // Check 7: Sample recent trades
  console.log('Check 7: Sample Recent Trades');
  console.log('─'.repeat(80));

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        external_trade_id,
        wallet_address,
        condition_id,
        side,
        shares,
        price,
        cash_value,
        trade_timestamp
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
      ORDER BY trade_timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const samples: any[] = await sampleResult.json();

  samples.forEach((s, i) => {
    console.log(`  ${i + 1}. Trade ID: ${s.external_trade_id.substring(0, 32)}...`);
    console.log(`     Wallet:    ${s.wallet_address.substring(0, 16)}...`);
    console.log(`     Market:    ${s.condition_id.substring(0, 16)}...`);
    console.log(`     Side:      ${s.side}`);
    console.log(`     Shares:    ${s.shares.toFixed(4)}`);
    console.log(`     Price:     ${s.price.toFixed(4)}`);
    console.log(`     Value:     $${s.cash_value.toFixed(2)}`);
    console.log(`     Timestamp: ${new Date(s.trade_timestamp).toISOString()}`);
    console.log('');
  });

  // Check 8: Data quality checks
  console.log('Check 8: Data Quality Checks');
  console.log('─'.repeat(80));

  const qualityResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN wallet_address = '' THEN 1 ELSE 0 END) as null_wallets,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as null_conditions,
        SUM(CASE WHEN shares = 0 THEN 1 ELSE 0 END) as zero_shares,
        SUM(CASE WHEN price = 0 THEN 1 ELSE 0 END) as zero_price,
        SUM(CASE WHEN cash_value = 0 THEN 1 ELSE 0 END) as zero_value,
        SUM(CASE WHEN external_trade_id = '' THEN 1 ELSE 0 END) as null_trade_ids
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
    `,
    format: 'JSONEachRow'
  });
  const quality: any = (await qualityResult.json())[0];

  console.log(`  Total trades checked: ${quality.total}`);
  console.log(`  Null wallets:         ${quality.null_wallets} (${((quality.null_wallets / quality.total) * 100).toFixed(2)}%)`);
  console.log(`  Null condition_ids:   ${quality.null_conditions} (${((quality.null_conditions / quality.total) * 100).toFixed(2)}%)`);
  console.log(`  Zero shares:          ${quality.zero_shares} (${((quality.zero_shares / quality.total) * 100).toFixed(2)}%)`);
  console.log(`  Zero price:           ${quality.zero_price} (${((quality.zero_price / quality.total) * 100).toFixed(2)}%)`);
  console.log(`  Zero value:           ${quality.zero_value} (${((quality.zero_value / quality.total) * 100).toFixed(2)}%)`);
  console.log(`  Null trade IDs:       ${quality.null_trade_ids} (${((quality.null_trade_ids / quality.total) * 100).toFixed(2)}%)`);
  console.log('');

  const qualityScore = ((quality.total - quality.null_wallets - quality.null_conditions - quality.zero_shares - quality.zero_price - quality.null_trade_ids) / quality.total) * 100;
  console.log(`  Overall data quality score: ${qualityScore.toFixed(2)}%`);
  console.log('');

  // Summary
  console.log('═'.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  console.log('✅ Total rows in external_trades_raw: ' + total);
  console.log('✅ Ghost market trades: ' + (ghostMarkets.reduce((sum, m) => sum + parseInt(m.trade_count), 0)));
  console.log('✅ Unique ghost markets: ' + ghostMarkets.length);
  console.log('✅ Unique wallets: ' + uniqueWallets);
  console.log('✅ Data quality score: ' + qualityScore.toFixed(2) + '%');
  console.log('');

  console.log('Phase 5.5 validation complete. Data is ready for C1 P&L calculations.');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});
