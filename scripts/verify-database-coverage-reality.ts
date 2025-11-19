#!/usr/bin/env npx tsx

/**
 * Verify Database Coverage - Reality Check
 *
 * Check what data ACTUALLY exists in the database vs what docs claim
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== DATABASE COVERAGE REALITY CHECK ===\n');
  console.log('Verifying actual data vs documentation claims...\n');

  // 1. Global date range
  console.log('--- STEP 1: Global Date Range ---\n');

  const dateRangeQuery = `
    SELECT
      min(block_time) as earliest_trade,
      max(block_time) as latest_trade,
      count() as total_trades,
      dateDiff('day', earliest_trade, latest_trade) as days_span
    FROM default.trades_raw
    WHERE length(replaceAll(condition_id, '0x', '')) = 64
  `;

  const dateResult = await clickhouse.query({
    query: dateRangeQuery,
    format: 'JSONEachRow'
  });
  const dateRange = await dateResult.json<Array<any>>();

  console.log(`Earliest Trade: ${dateRange[0].earliest_trade}`);
  console.log(`Latest Trade:   ${dateRange[0].latest_trade}`);
  console.log(`Total Trades:   ${parseInt(dateRange[0].total_trades).toLocaleString()}`);
  console.log(`Days Span:      ${dateRange[0].days_span} days\n`);

  // Compare to documentation claim
  const docClaim = '2022-12-18';
  const actualEarliest = dateRange[0].earliest_trade;

  if (actualEarliest.startsWith('2022') || actualEarliest.startsWith('2023')) {
    console.log('✅ Documentation is CORRECT - Data goes back to 2022/2023\n');
  } else {
    console.log(`❌ Documentation is INCORRECT`);
    console.log(`   Claims: ${docClaim}`);
    console.log(`   Reality: ${actualEarliest}\n`);
  }

  // 2. Monthly distribution
  console.log('--- STEP 2: Monthly Distribution ---\n');

  const monthlyQuery = `
    SELECT
      toYear(block_time) as year,
      toMonth(block_time) as month,
      count() as trades,
      uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
      min(block_time) as month_start,
      max(block_time) as month_end
    FROM default.trades_raw
    WHERE length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY year, month
    ORDER BY year, month
  `;

  const monthlyResult = await clickhouse.query({
    query: monthlyQuery,
    format: 'JSONEachRow'
  });
  const monthly = await monthlyResult.json<Array<any>>();

  console.log('Year-Month | Trades | Markets | Period');
  console.log('-----------|--------|---------|-------');

  monthly.forEach(m => {
    const monthStr = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const trades = parseInt(m.trades).toLocaleString().padStart(10);
    const markets = parseInt(m.unique_markets).toLocaleString().padStart(7);
    console.log(`${monthStr}   | ${trades} | ${markets} | ${m.month_start.split(' ')[0]} to ${m.month_end.split(' ')[0]}`);
  });
  console.log();

  // 3. Check for gaps
  console.log('--- STEP 3: Gap Analysis ---\n');

  const firstYear = monthly[0].year;
  const firstMonth = monthly[0].month;
  const lastYear = monthly[monthly.length - 1].year;
  const lastMonth = monthly[monthly.length - 1].month;

  console.log(`First data: ${firstYear}-${String(firstMonth).padStart(2, '0')}`);
  console.log(`Last data:  ${lastYear}-${String(lastMonth).padStart(2, '0')}\n`);

  // Check for missing months
  const existingMonths = new Set(monthly.map(m => `${m.year}-${String(m.month).padStart(2, '0')}`));
  const gaps: string[] = [];

  for (let year = firstYear; year <= lastYear; year++) {
    const startMonth = (year === firstYear) ? firstMonth : 1;
    const endMonth = (year === lastYear) ? lastMonth : 12;

    for (let month = startMonth; month <= endMonth; month++) {
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      if (!existingMonths.has(monthKey)) {
        gaps.push(monthKey);
      }
    }
  }

  if (gaps.length > 0) {
    console.log(`⚠️  GAPS DETECTED: ${gaps.length} missing months\n`);
    console.log('Missing months:');
    gaps.forEach(g => console.log(`  - ${g}`));
    console.log();
  } else {
    console.log('✅ NO GAPS - Continuous monthly coverage\n');
  }

  // 4. Yearly summary
  console.log('--- STEP 4: Yearly Summary ---\n');

  const yearlyQuery = `
    SELECT
      toYear(block_time) as year,
      count() as trades,
      uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
      min(block_time) as year_start,
      max(block_time) as year_end
    FROM default.trades_raw
    WHERE length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY year
    ORDER BY year
  `;

  const yearlyResult = await clickhouse.query({
    query: yearlyQuery,
    format: 'JSONEachRow'
  });
  const yearly = await yearlyResult.json<Array<any>>();

  console.log('Year | Trades     | Markets | Coverage');
  console.log('-----|------------|---------|----------');

  yearly.forEach(y => {
    const trades = parseInt(y.trades).toLocaleString().padStart(10);
    const markets = parseInt(y.unique_markets).toLocaleString().padStart(7);
    const start = y.year_start.split(' ')[0];
    const end = y.year_end.split(' ')[0];
    console.log(`${y.year} | ${trades} | ${markets} | ${start} to ${end}`);
  });
  console.log();

  // 5. Check specific wallet again
  console.log('--- STEP 5: Test Wallet Verification ---\n');

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const walletQuery = `
    SELECT
      min(block_time) as first_trade,
      max(block_time) as last_trade,
      count() as total_trades,
      uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;

  const walletResult = await clickhouse.query({
    query: walletQuery,
    format: 'JSONEachRow',
    query_params: { wallet: testWallet }
  });
  const walletData = await walletResult.json<Array<any>>();

  console.log(`Wallet: ${testWallet.substring(0, 10)}...${testWallet.substring(testWallet.length - 6)}`);
  console.log(`First Trade: ${walletData[0].first_trade}`);
  console.log(`Last Trade:  ${walletData[0].last_trade}`);
  console.log(`Trades:      ${parseInt(walletData[0].total_trades).toLocaleString()}`);
  console.log(`Markets:     ${walletData[0].unique_markets}\n`);

  // 6. Final verdict
  console.log('=== FINAL VERDICT ===\n');

  const earliestYear = parseInt(dateRange[0].earliest_trade.split('-')[0]);
  const earliestMonth = parseInt(dateRange[0].earliest_trade.split('-')[1]);

  if (earliestYear <= 2022) {
    console.log('✅ DOCUMENTATION CORRECT: Data exists from 2022');
    console.log(`   Actual start: ${dateRange[0].earliest_trade}`);
    console.log(`   Coverage: ${dateRange[0].days_span} days\n`);

    if (gaps.length > 0) {
      console.log(`⚠️  BUT: ${gaps.length} missing months detected (see gap analysis above)\n`);
    }
  } else if (earliestYear === 2023) {
    console.log('⚠️  DOCUMENTATION PARTIALLY INCORRECT');
    console.log(`   Claims: Dec 2022 start`);
    console.log(`   Reality: Data starts ${dateRange[0].earliest_trade}`);
    console.log(`   Missing: ~${12 - earliestMonth + 1} months of 2023\n`);
  } else {
    console.log('❌ DOCUMENTATION COMPLETELY INCORRECT');
    console.log(`   Claims: Dec 2022 start (1,048 days)`);
    console.log(`   Reality: Data starts ${dateRange[0].earliest_trade}`);
    console.log(`   Missing: ALL of 2022-2023 data\n`);
  }

  console.log('Summary:');
  console.log(`  - Earliest trade in database: ${dateRange[0].earliest_trade}`);
  console.log(`  - Total trades: ${parseInt(dateRange[0].total_trades).toLocaleString()}`);
  console.log(`  - Coverage span: ${dateRange[0].days_span} days`);
  console.log(`  - Years with data: ${yearly.map(y => y.year).join(', ')}`);
  console.log(`  - Missing months: ${gaps.length}`);
  console.log();
}

main().catch(console.error);
