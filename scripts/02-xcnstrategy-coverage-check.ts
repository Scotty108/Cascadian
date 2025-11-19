import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

const CHOSEN_VIEW = 'vw_trades_canonical_current';
const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function analyzeXcnstrategyCoverage() {
  console.log('=== Step 2: Coverage Check for xcnstrategy Wallet ===\n');
  console.log('Using view:', CHOSEN_VIEW);
  console.log('Wallet:', XCNSTRATEGY_WALLET);
  console.log('');

  // Coverage check by month for last 12 months
  const coverageQuery = `
    SELECT
      toYYYYMM(timestamp) AS month,
      count() AS total_trades,
      countIf(
        canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
        AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS trades_with_condition_id,
      round(100.0 * trades_with_condition_id / total_trades, 2) AS coverage_pct
    FROM ${CHOSEN_VIEW}
    WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
      AND timestamp >= subtractMonths(now(), 12)
    GROUP BY month
    ORDER BY month
  `;

  console.log('Running coverage query...\n');
  const result = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const rawData = await result.json<any[]>();

  // Ensure numeric values (ClickHouse may return strings for large numbers)
  const data = rawData.map(row => ({
    month: Number(row.month),
    total_trades: Number(row.total_trades),
    trades_with_condition_id: Number(row.trades_with_condition_id),
    coverage_pct: Number(row.coverage_pct),
  }));

  if (data.length === 0) {
    console.log('⚠️  No trades found for xcnstrategy wallet in the last 12 months.');
    console.log('');

    // Try to find any trades for this wallet
    const anyTradesQuery = `
      SELECT
        count() as total,
        min(timestamp) as first_trade,
        max(timestamp) as last_trade
      FROM ${CHOSEN_VIEW}
      WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
    `;

    const anyTradesResult = await clickhouse.query({ query: anyTradesQuery, format: 'JSONEachRow' });
    const anyTradesData = await anyTradesResult.json<{
      total: number;
      first_trade: string;
      last_trade: string;
    }[]>();

    if (anyTradesData[0].total > 0) {
      console.log(`Found ${anyTradesData[0].total} total trades for this wallet.`);
      console.log(`  First trade: ${anyTradesData[0].first_trade}`);
      console.log(`  Last trade:  ${anyTradesData[0].last_trade}`);
      console.log('');
      console.log('Expanding search to all time...\n');

      // Retry with all time
      const allTimeCoverageQuery = `
        SELECT
          toYYYYMM(timestamp) AS month,
          count() AS total_trades,
          countIf(
            canonical_condition_id IS NOT NULL
            AND canonical_condition_id != ''
            AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
          ) AS trades_with_condition_id,
          round(100.0 * trades_with_condition_id / total_trades, 2) AS coverage_pct
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `;

      const allTimeResult = await clickhouse.query({ query: allTimeCoverageQuery, format: 'JSONEachRow' });
      const allTimeRawData = await allTimeResult.json<any[]>();

      const allTimeData = allTimeRawData.map(row => ({
        month: Number(row.month),
        total_trades: Number(row.total_trades),
        trades_with_condition_id: Number(row.trades_with_condition_id),
        coverage_pct: Number(row.coverage_pct),
      }));

      displayResults(allTimeData, true);
      writeReport(allTimeData, true);
    } else {
      console.log('No trades found at all for this wallet address.');
      console.log('');
      console.log('Possible reasons:');
      console.log('  1. Wallet address is incorrect');
      console.log('  2. Wallet has no trades in the canonical trades view');
      console.log('  3. Database is incomplete');
      process.exit(1);
    }
  } else {
    displayResults(data, false);
    writeReport(data, false);
  }
}

function displayResults(
  data: Array<{
    month: number;
    total_trades: number;
    trades_with_condition_id: number;
    coverage_pct: number;
  }>,
  isAllTime: boolean
) {
  console.log('Coverage Results' + (isAllTime ? ' (All Time - Last 12 Months)' : ' (Last 12 Months)') + ':');
  console.log('');
  console.log('┌─────────┬──────────────┬──────────────────────────┬──────────────┐');
  console.log('│  Month  │ Total Trades │ Trades w/ Condition ID   │ Coverage %   │');
  console.log('├─────────┼──────────────┼──────────────────────────┼──────────────┤');

  data.forEach((row) => {
    const monthStr = String(row.month);
    const year = monthStr.substring(0, 4);
    const month = monthStr.substring(4, 6);
    const monthDisplay = `${year}-${month}`;
    const totalPadded = String(row.total_trades).padStart(12);
    const withIdPadded = String(row.trades_with_condition_id).padStart(24);
    const coveragePadded = String(row.coverage_pct + '%').padStart(12);

    console.log(`│ ${monthDisplay} │ ${totalPadded} │ ${withIdPadded} │ ${coveragePadded} │`);
  });

  console.log('└─────────┴──────────────┴──────────────────────────┴──────────────┘');
  console.log('');

  // Summary stats
  const totalTrades = data.reduce((sum, row) => sum + row.total_trades, 0);
  const totalWithId = data.reduce((sum, row) => sum + row.trades_with_condition_id, 0);
  const avgCoverage = totalTrades > 0 ? (100.0 * totalWithId / totalTrades).toFixed(2) : '0.00';
  const minCoverage = Math.min(...data.map(row => row.coverage_pct));
  const maxCoverage = Math.max(...data.map(row => row.coverage_pct));

  console.log('Summary:');
  console.log(`  Total trades:              ${totalTrades.toLocaleString()}`);
  console.log(`  Trades with condition ID:  ${totalWithId.toLocaleString()}`);
  console.log(`  Overall coverage:          ${avgCoverage}%`);
  console.log(`  Min monthly coverage:      ${minCoverage}%`);
  console.log(`  Max monthly coverage:      ${maxCoverage}%`);
  console.log('');
}

function writeReport(
  data: Array<{
    month: number;
    total_trades: number;
    trades_with_condition_id: number;
    coverage_pct: number;
  }>,
  isAllTime: boolean
) {
  const totalTrades = data.reduce((sum, row) => sum + row.total_trades, 0);
  const totalWithId = data.reduce((sum, row) => sum + row.trades_with_condition_id, 0);
  const avgCoverage = totalTrades > 0 ? (100.0 * totalWithId / totalTrades).toFixed(2) : '0.00';
  const minCoverage = Math.min(...data.map(row => row.coverage_pct));
  const maxCoverage = Math.max(...data.map(row => row.coverage_pct));

  const report = `# V3 xcnstrategy Coverage Check

**Analysis Date:** ${new Date().toISOString().split('T')[0]}
**Canonical View Used:** \`${CHOSEN_VIEW}\`
**Wallet Address:** \`${XCNSTRATEGY_WALLET}\`
**Time Period:** ${isAllTime ? 'All Time (Last 12 Months of Activity)' : 'Last 12 Calendar Months'}

---

## Monthly Coverage Breakdown

| Month   | Total Trades | Trades w/ Condition ID | Coverage % |
|---------|-------------:|------------------------:|------------:|
${data.map(row => {
  const monthStr = String(row.month);
  const year = monthStr.substring(0, 4);
  const month = monthStr.substring(4, 6);
  return `| ${year}-${month} | ${row.total_trades.toLocaleString()} | ${row.trades_with_condition_id.toLocaleString()} | ${row.coverage_pct}% |`;
}).join('\n')}

---

## Summary Statistics

- **Total Trades:** ${totalTrades.toLocaleString()}
- **Trades with Condition ID:** ${totalWithId.toLocaleString()}
- **Overall Coverage:** ${avgCoverage}%
- **Min Monthly Coverage:** ${minCoverage}%
- **Max Monthly Coverage:** ${maxCoverage}%

---

## Analysis

Over the ${isAllTime ? 'last 12 months of trading activity' : 'last 12 calendar months'}, the xcnstrategy wallet shows **${avgCoverage}% condition ID coverage** under the v3 canonical trades setup.

${parseFloat(avgCoverage) > 10
  ? `This is **significantly better** than the old v2 baseline of ~10%, representing a **${(parseFloat(avgCoverage) - 10).toFixed(1)}pp improvement**.`
  : `This is approximately the same as or below the old v2 baseline of ~10%.`
}

${parseFloat(avgCoverage) >= 80
  ? `✅ **Coverage is excellent** - the vast majority of trades have usable condition IDs.`
  : parseFloat(avgCoverage) >= 50
    ? `⚠️  **Coverage is moderate** - about half of trades have usable condition IDs. There may be room for improvement.`
    : `❌ **Coverage is low** - less than half of trades have usable condition IDs. Investigation needed.`
}

${minCoverage < 20 && maxCoverage > 80
  ? `📊 **Note:** Coverage varies significantly by month (${minCoverage}% to ${maxCoverage}%), suggesting possible data quality issues in certain time periods.`
  : ''
}

---

**Generated by:** C3 - xcnstrategy Wallet Validator
**Report Type:** Step 2 - Coverage Check
`;

  writeFileSync('/tmp/V3_XCNSTRATEGY_COVERAGE_CHECK.md', report);
  console.log('✅ Report written to: /tmp/V3_XCNSTRATEGY_COVERAGE_CHECK.md');
  console.log('');
}

analyzeXcnstrategyCoverage().catch(console.error);
