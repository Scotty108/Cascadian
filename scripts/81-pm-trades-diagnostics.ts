#!/usr/bin/env tsx
/**
 * pm_trades Diagnostics
 *
 * Validates pm_trades view against base clob_fills table.
 * Reports coverage, distinct counts, and data quality.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { appendFileSync } from 'fs';

async function main() {
  console.log('📊 pm_trades Diagnostics');
  console.log('='.repeat(60));
  console.log('');

  // Diagnostic 1: Row count comparison
  console.log('Diagnostic 1: Row count comparison...');
  console.log('');

  const rowCountQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM clob_fills) as fills_total,
        (SELECT COUNT(*) FROM pm_trades) as trades_total,
        (SELECT COUNT(*) FROM pm_trades) * 100.0 / (SELECT COUNT(*) FROM clob_fills) as coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const rowCounts = await rowCountQuery.json();
  console.log('Row Count Comparison:');
  console.table(rowCounts);
  console.log('');

  // Diagnostic 2: Distinct asset IDs
  console.log('Diagnostic 2: Distinct asset IDs...');
  console.log('');

  const assetCountQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(DISTINCT asset_id) FROM clob_fills) as fills_distinct_assets,
        (SELECT COUNT(DISTINCT asset_id_decimal) FROM pm_trades) as trades_distinct_assets,
        (SELECT COUNT(DISTINCT asset_id_decimal) FROM pm_trades) * 100.0 /
          (SELECT COUNT(DISTINCT asset_id) FROM clob_fills) as asset_coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const assetCounts = await assetCountQuery.json();
  console.log('Asset ID Comparison:');
  console.table(assetCounts);
  console.log('');

  // Diagnostic 3: Distinct conditions and wallets in pm_trades
  console.log('Diagnostic 3: pm_trades distinct counts...');
  console.log('');

  const distinctQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(DISTINCT operator_address) as distinct_operators,
        COUNT(DISTINCT outcome_index) as distinct_outcomes
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const distincts = await distinctQuery.json();
  console.log('pm_trades Distinct Counts:');
  console.table(distincts);
  console.log('');

  // Diagnostic 4: Time range comparison
  console.log('Diagnostic 4: Time range comparison...');
  console.log('');

  const timeRangeQuery = await clickhouse.query({
    query: `
      SELECT
        'clob_fills' as source,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest,
        dateDiff('day', MIN(timestamp), MAX(timestamp)) as days_covered
      FROM clob_fills
      UNION ALL
      SELECT
        'pm_trades' as source,
        MIN(block_time) as earliest,
        MAX(block_time) as latest,
        dateDiff('day', MIN(block_time), MAX(block_time)) as days_covered
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const timeRanges = await timeRangeQuery.json();
  console.log('Time Range Comparison:');
  console.table(timeRanges);
  console.log('');

  // Diagnostic 5: Side distribution
  console.log('Diagnostic 5: Side distribution...');
  console.log('');

  const sideDistQuery = await clickhouse.query({
    query: `
      SELECT
        side,
        COUNT(*) as trade_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM pm_trades), 2) as percentage
      FROM pm_trades
      GROUP BY side
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });

  const sideDist = await sideDistQuery.json();
  console.log('Side Distribution:');
  console.table(sideDist);
  console.log('');

  // Diagnostic 6: Outcome index distribution
  console.log('Diagnostic 6: Outcome index distribution...');
  console.log('');

  const outcomeDistQuery = await clickhouse.query({
    query: `
      SELECT
        outcome_index,
        COUNT(*) as trade_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM pm_trades), 2) as percentage
      FROM pm_trades
      GROUP BY outcome_index
      ORDER BY outcome_index
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const outcomeDist = await outcomeDistQuery.json();
  console.log('Outcome Index Distribution (top 10):');
  console.table(outcomeDist);
  console.log('');

  // Diagnostic 7: Proxy trade analysis
  console.log('Diagnostic 7: Proxy trade analysis...');
  console.log('');

  const proxyQuery = await clickhouse.query({
    query: `
      SELECT
        is_proxy_trade,
        COUNT(*) as trade_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM pm_trades), 2) as percentage
      FROM pm_trades
      GROUP BY is_proxy_trade
      ORDER BY is_proxy_trade
    `,
    format: 'JSONEachRow'
  });

  const proxyStats = await proxyQuery.json();
  console.log('Proxy Trade Analysis:');
  console.table(proxyStats);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📋 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const anomalies = [];

  // Check for anomalies
  const coverage = parseFloat(rowCounts[0].coverage_pct);
  if (coverage < 99) {
    anomalies.push(`⚠️  Row coverage is ${coverage.toFixed(2)}% (expected ~100%)`);
  }

  const assetCoverage = parseFloat(assetCounts[0].asset_coverage_pct);
  if (assetCoverage < 99) {
    anomalies.push(`⚠️  Asset coverage is ${assetCoverage.toFixed(2)}% (expected ~100%)`);
  }

  if (anomalies.length > 0) {
    console.log('Anomalies Detected:');
    anomalies.forEach(a => console.log(`  ${a}`));
    console.log('');
  } else {
    console.log('✅ No anomalies detected');
    console.log('');
  }

  console.log('Key Metrics:');
  console.log(`  Base Table: clob_fills`);
  console.log(`  Total Fills: ${parseInt(rowCounts[0].fills_total).toLocaleString()}`);
  console.log(`  Total Trades: ${parseInt(rowCounts[0].trades_total).toLocaleString()}`);
  console.log(`  Coverage: ${coverage.toFixed(2)}%`);
  console.log(`  Distinct Conditions: ${parseInt(distincts[0].distinct_conditions).toLocaleString()}`);
  console.log(`  Distinct Wallets: ${parseInt(distincts[0].distinct_wallets).toLocaleString()}`);
  console.log(`  Date Range: ${timeRanges[0].earliest} to ${timeRanges[0].latest}`);
  console.log(`  Days Covered: ${timeRanges[0].days_covered}`);
  console.log('');

  // Append to coverage report
  const report = `

## Canonical Trades (pm_trades)

**Created:** ${new Date().toISOString().split('T')[0]}

### Base Table
- **Source:** clob_fills
- **Rows:** ${parseInt(rowCounts[0].fills_total).toLocaleString()}
- **Join:** INNER JOIN on asset_id = asset_id_decimal (pm_asset_token_map)

### Coverage
- **Total Trades:** ${parseInt(rowCounts[0].trades_total).toLocaleString()}
- **Row Coverage:** ${coverage.toFixed(2)}% of clob_fills
- **Distinct Assets:** ${parseInt(assetCounts[0].trades_distinct_assets).toLocaleString()}
- **Asset Coverage:** ${assetCoverage.toFixed(2)}% of clob_fills assets

### Dimensions
- **Distinct Conditions:** ${parseInt(distincts[0].distinct_conditions).toLocaleString()}
- **Distinct Wallets:** ${parseInt(distincts[0].distinct_wallets).toLocaleString()}
- **Distinct Operators:** ${parseInt(distincts[0].distinct_operators).toLocaleString()}
- **Distinct Outcome Indices:** ${parseInt(distincts[0].distinct_outcomes).toLocaleString()}

### Temporal Coverage
- **Earliest Trade:** ${timeRanges[1].earliest}
- **Latest Trade:** ${timeRanges[1].latest}
- **Days Covered:** ${timeRanges[1].days_covered}

### Trade Distribution
- **BUY Trades:** ${sideDist.find(s => s.side === 'BUY')?.trade_count.toLocaleString() || '0'} (${sideDist.find(s => s.side === 'BUY')?.percentage || 0}%)
- **SELL Trades:** ${sideDist.find(s => s.side === 'SELL')?.trade_count.toLocaleString() || '0'} (${sideDist.find(s => s.side === 'SELL')?.percentage || 0}%)

### Proxy Analysis
- **Direct Trades:** ${proxyStats.find(p => p.is_proxy_trade === 0)?.trade_count.toLocaleString() || '0'} (${proxyStats.find(p => p.is_proxy_trade === 0)?.percentage || 0}%)
- **Proxy Trades:** ${proxyStats.find(p => p.is_proxy_trade === 1)?.trade_count.toLocaleString() || '0'} (${proxyStats.find(p => p.is_proxy_trade === 1)?.percentage || 0}%)

### Anomalies
${anomalies.length > 0 ? anomalies.map(a => `- ${a}`).join('\n') : '- None detected'}

### Schema
- Uses \`asset_id_decimal\` from clob_fills (CLOB-first)
- Joins to \`pm_asset_token_map\` for condition_id, outcome_index, question
- Proxy-aware (\`is_proxy_trade\` flag)
- Streaming-friendly (no time filters)
- Non-destructive (VIEW, not TABLE)

**Status:** ✅ Complete
`;

  try {
    appendFileSync('DATA_COVERAGE_REPORT_C1.md', report);
    console.log('✅ Report appended to DATA_COVERAGE_REPORT_C1.md');
  } catch (error) {
    console.log('⚠️  Could not append to coverage report:', error);
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Diagnostics failed:', error);
  process.exit(1);
});
