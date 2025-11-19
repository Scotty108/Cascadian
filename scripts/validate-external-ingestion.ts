#!/usr/bin/env tsx
/**
 * Validate External Data Ingestion Integration
 *
 * Purpose: Verify that pm_trades_external and pm_trades_complete are working correctly
 *
 * Tests:
 * 1. Row count integrity (UNION math)
 * 2. No duplicate trades
 * 3. Ghost market coverage
 * 4. Historical gap filled
 * 5. Dome baseline wallet coverage
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Ghost markets from investigation
const GHOST_MARKETS = [
  '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
].map(cid => cid.toLowerCase().replace('0x', ''));

// Baseline wallet from Dome investigation
const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Historical cutoff
const HISTORICAL_CUTOFF = '2024-08-21 00:00:00';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(result: TestResult): void {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${result.status}: ${result.name}`);
  console.log(`   ${result.message}`);
  if (result.details) {
    console.log(`   Details:`, result.details);
  }
  console.log('');
  results.push(result);
}

async function test1_RowCountIntegrity(): Promise<void> {
  console.log('Test 1: Row Count Integrity');
  console.log('─'.repeat(80));

  try {
    // Get counts from each source
    const pmTradesResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM pm_trades',
      format: 'JSONEachRow'
    });
    const pmTradesCount = (await pmTradesResult.json())[0].cnt;

    const pmTradesExternalResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM pm_trades_external',
      format: 'JSONEachRow'
    });
    const pmTradesExternalCount = (await pmTradesExternalResult.json())[0].cnt;

    const pmTradesCompleteResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM pm_trades_complete',
      format: 'JSONEachRow'
    });
    const pmTradesCompleteCount = (await pmTradesCompleteResult.json())[0].cnt;

    const expected = BigInt(pmTradesCount) + BigInt(pmTradesExternalCount);
    const actual = BigInt(pmTradesCompleteCount);

    if (expected === actual) {
      logTest({
        name: 'Row count integrity',
        status: 'PASS',
        message: `pm_trades (${pmTradesCount}) + pm_trades_external (${pmTradesExternalCount}) = pm_trades_complete (${pmTradesCompleteCount})`,
        details: { pmTradesCount, pmTradesExternalCount, pmTradesCompleteCount }
      });
    } else {
      logTest({
        name: 'Row count integrity',
        status: 'FAIL',
        message: `Expected ${expected}, got ${actual}. Possible duplicate or missing rows.`,
        details: { expected: expected.toString(), actual: actual.toString() }
      });
    }
  } catch (error: any) {
    logTest({
      name: 'Row count integrity',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function test2_NoDuplicates(): Promise<void> {
  console.log('Test 2: No Duplicate Trades');
  console.log('─'.repeat(80));

  try {
    const result = await clickhouse.query({
      query: `
        SELECT fill_id, COUNT(*) as cnt
        FROM pm_trades_complete
        GROUP BY fill_id
        HAVING COUNT(*) > 1
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const duplicates = await result.json();

    if (duplicates.length === 0) {
      logTest({
        name: 'No duplicates',
        status: 'PASS',
        message: 'No duplicate fill_id found in pm_trades_complete'
      });
    } else {
      logTest({
        name: 'No duplicates',
        status: 'FAIL',
        message: `Found ${duplicates.length} duplicate fill_id values`,
        details: duplicates
      });
    }
  } catch (error: any) {
    logTest({
      name: 'No duplicates',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function test3_GhostMarketCoverage(): Promise<void> {
  console.log('Test 3: Ghost Market Coverage');
  console.log('─'.repeat(80));

  try {
    // Check how many ghost markets now have data in pm_trades_complete
    const result = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          COUNT(*) as trade_count,
          data_source
        FROM pm_trades_complete
        WHERE condition_id IN (${GHOST_MARKETS.map(m => `'${m}'`).join(', ')})
        GROUP BY condition_id, data_source
      `,
      format: 'JSONEachRow'
    });

    const coverage = await result.json();
    const marketsWithData = new Set(coverage.map((r: any) => r.condition_id));

    const coverageCount = marketsWithData.size;
    const totalGhostMarkets = GHOST_MARKETS.length;

    if (coverageCount === totalGhostMarkets) {
      logTest({
        name: 'Ghost market coverage',
        status: 'PASS',
        message: `All ${totalGhostMarkets} ghost markets now have trades`,
        details: coverage
      });
    } else if (coverageCount > 0) {
      logTest({
        name: 'Ghost market coverage',
        status: 'WARN',
        message: `${coverageCount}/${totalGhostMarkets} ghost markets have trades`,
        details: coverage
      });
    } else {
      logTest({
        name: 'Ghost market coverage',
        status: 'FAIL',
        message: 'No ghost markets have trades in pm_trades_complete',
        details: { expected: GHOST_MARKETS, found: coverage }
      });
    }
  } catch (error: any) {
    logTest({
      name: 'Ghost market coverage',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function test4_HistoricalCoverage(): Promise<void> {
  console.log('Test 4: Historical Coverage (Pre-Aug 21, 2024)');
  console.log('─'.repeat(80));

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          data_source,
          MIN(block_time) as earliest,
          MAX(block_time) as latest,
          COUNT(*) as trade_count
        FROM pm_trades_complete
        WHERE block_time < '${HISTORICAL_CUTOFF}'
        GROUP BY data_source
      `,
      format: 'JSONEachRow'
    });

    const historical = await result.json();

    if (historical.length > 0) {
      const totalHistorical = historical.reduce((sum: number, r: any) => sum + parseInt(r.trade_count), 0);
      const earliest = historical.reduce((min: string, r: any) =>
        r.earliest < min ? r.earliest : min, '9999-12-31'
      );

      logTest({
        name: 'Historical coverage',
        status: 'PASS',
        message: `Found ${totalHistorical.toLocaleString()} historical trades (earliest: ${earliest})`,
        details: historical
      });
    } else {
      logTest({
        name: 'Historical coverage',
        status: 'WARN',
        message: `No trades found before ${HISTORICAL_CUTOFF}. Backfill may not have run yet.`
      });
    }
  } catch (error: any) {
    logTest({
      name: 'Historical coverage',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function test5_BaselineWalletCoverage(): Promise<void> {
  console.log('Test 5: Baseline Wallet Coverage (xcnstrategy)');
  console.log('─'.repeat(80));

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          data_source,
          COUNT(*) as trade_count,
          COUNT(DISTINCT condition_id) as market_count
        FROM pm_trades_complete
        WHERE wallet_address = '${BASELINE_WALLET.toLowerCase()}'
        GROUP BY data_source
      `,
      format: 'JSONEachRow'
    });

    const walletCoverage = await result.json();

    if (walletCoverage.length > 0) {
      const totalTrades = walletCoverage.reduce((sum: number, r: any) => sum + parseInt(r.trade_count), 0);
      const totalMarkets = walletCoverage.reduce((sum: number, r: any) => sum + parseInt(r.market_count), 0);

      logTest({
        name: 'Baseline wallet coverage',
        status: 'PASS',
        message: `Found ${totalTrades} trades across ${totalMarkets} markets for ${BASELINE_WALLET}`,
        details: walletCoverage
      });
    } else {
      logTest({
        name: 'Baseline wallet coverage',
        status: 'WARN',
        message: `No trades found for baseline wallet ${BASELINE_WALLET}`
      });
    }
  } catch (error: any) {
    logTest({
      name: 'Baseline wallet coverage',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function test6_DataSourceBreakdown(): Promise<void> {
  console.log('Test 6: Data Source Breakdown');
  console.log('─'.repeat(80));

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          data_source,
          COUNT(*) as trade_count,
          COUNT(DISTINCT condition_id) as market_count,
          COUNT(DISTINCT wallet_address) as wallet_count,
          MIN(block_time) as earliest,
          MAX(block_time) as latest
        FROM pm_trades_complete
        GROUP BY data_source
        ORDER BY trade_count DESC
      `,
      format: 'JSONEachRow'
    });

    const breakdown = await result.json();

    console.table(breakdown);

    logTest({
      name: 'Data source breakdown',
      status: 'PASS',
      message: `Found ${breakdown.length} data sources`,
      details: breakdown
    });
  } catch (error: any) {
    logTest({
      name: 'Data source breakdown',
      status: 'FAIL',
      message: `Error: ${error.message}`
    });
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('EXTERNAL DATA INGESTION VALIDATION');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Agent: C2 - External Data Ingestion');
  console.log('Validating: pm_trades_external and pm_trades_complete integration');
  console.log('');
  console.log('═'.repeat(80));
  console.log('');

  // Run all tests
  await test1_RowCountIntegrity();
  await test2_NoDuplicates();
  await test3_GhostMarketCoverage();
  await test4_HistoricalCoverage();
  await test5_BaselineWalletCoverage();
  await test6_DataSourceBreakdown();

  // Summary
  console.log('═'.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;

  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Passed: ${passCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⚠️  Warnings: ${warnCount}`);
  console.log('');

  if (failCount === 0) {
    console.log('✅ ALL TESTS PASSED');
    console.log('');
    console.log('External data ingestion is working correctly.');
    console.log('pm_trades_complete is ready for use with C1 PnL calculations.');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('');
    console.log('Review failed tests above and fix issues before using in production.');
    console.log('');
    console.log('Common fixes:');
    console.log('- Table not created: Run migration 017_create_pm_trades_external.sql');
    console.log('- No external data: Run ingest-amm-trades-from-data-api.ts');
    console.log('- No historical data: Run backfill-historical-trades-from-subgraph.ts');
    process.exit(1);
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});
