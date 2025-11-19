import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

const CHOSEN_VIEW = 'vw_trades_canonical_current';
const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function analyzeXcnstrategyPnL() {
  console.log('=== Step 3: PnL Sanity Slice for xcnstrategy Wallet ===\n');
  console.log('Using view:', CHOSEN_VIEW);
  console.log('Wallet:', XCNSTRATEGY_WALLET);
  console.log('');

  // First, check if there are PnL-related tables/views we can use
  console.log('Checking for PnL-related tables...\n');

  const pnlTablesQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%pnl%'
        OR name LIKE '%resolution%'
        OR name LIKE '%settled%'
        OR name LIKE '%outcome%'
      )
    ORDER BY name
  `;

  const pnlTablesResult = await clickhouse.query({ query: pnlTablesQuery, format: 'JSONEachRow' });
  const pnlTables = await pnlTablesResult.json<{ name: string; engine: string }[]>();

  console.log(`Found ${pnlTables.length} PnL-related tables/views:`);
  pnlTables.slice(0, 20).forEach((t) => console.log(`  - ${t.name}`));
  if (pnlTables.length > 20) {
    console.log(`  ... and ${pnlTables.length - 20} more`);
  }
  console.log('');

  // Look for resolution data that we can join to
  // Common patterns: vw_market_resolutions_final, pm_market_resolutions, etc.
  const resolutionTables = pnlTables.filter(t =>
    t.name.toLowerCase().includes('resolution') &&
    !t.name.toLowerCase().includes('staging') &&
    !t.name.toLowerCase().includes('backup')
  );

  let resolutionTable = '';
  if (resolutionTables.length > 0) {
    // Prefer tables with "final" or "current" in the name
    const preferredTable = resolutionTables.find(t =>
      t.name.toLowerCase().includes('final') ||
      t.name.toLowerCase().includes('current')
    );

    resolutionTable = preferredTable ? preferredTable.name : resolutionTables[0].name;
    console.log(`Using resolution table: ${resolutionTable}\n`);

    // Check the schema of the resolution table
    const schemaQuery = `DESCRIBE ${resolutionTable}`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schema = await schemaResult.json<{ name: string; type: string }[]>();

    console.log(`Schema of ${resolutionTable}:`);
    schema.forEach((col) => console.log(`  - ${col.name}: ${col.type}`));
    console.log('');
  }

  // Now run the PnL analysis
  console.log('Running PnL eligibility analysis...\n');

  // Strategy: Count trades by month that have condition IDs (these are PnL-eligible)
  // and compare with distinct markets
  const pnlQuery = `
    SELECT
      toYYYYMM(timestamp) AS month,
      count() AS total_trades,
      countIf(
        canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
        AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS pnl_eligible_trades_v3,
      uniqIf(
        canonical_condition_id,
        canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
        AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS distinct_markets_v3,
      sumIf(
        usd_value * if(trade_direction = 'BUY', 1, -1),
        canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
        AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS net_flow_v3
    FROM ${CHOSEN_VIEW}
    WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
      AND timestamp >= subtractMonths(now(), 6)
    GROUP BY month
    ORDER BY month
  `;

  const result = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const rawData = await result.json<any[]>();

  const data = rawData.map(row => ({
    month: Number(row.month),
    total_trades: Number(row.total_trades),
    pnl_eligible_trades_v3: Number(row.pnl_eligible_trades_v3),
    distinct_markets_v3: Number(row.distinct_markets_v3),
    net_flow_v3: Number(row.net_flow_v3),
  }));

  if (data.length === 0) {
    console.log('⚠️  No trades found in the last 6 months.');
    console.log('');
    process.exit(1);
  }

  displayPnLResults(data, resolutionTable);
  writePnLReport(data, resolutionTable);
}

function displayPnLResults(
  data: Array<{
    month: number;
    total_trades: number;
    pnl_eligible_trades_v3: number;
    distinct_markets_v3: number;
    net_flow_v3: number;
  }>,
  resolutionTable: string
) {
  console.log('PnL Eligibility Results (Last 6 Months):');
  console.log('');
  console.log('┌─────────┬──────────────┬────────────────────┬───────────────────┬──────────────────┐');
  console.log('│  Month  │ Total Trades │ PnL Eligible (v3)  │ Distinct Markets  │  Net Flow (USD)  │');
  console.log('├─────────┼──────────────┼────────────────────┼───────────────────┼──────────────────┤');

  data.forEach((row) => {
    const monthStr = String(row.month);
    const year = monthStr.substring(0, 4);
    const month = monthStr.substring(4, 6);
    const monthDisplay = `${year}-${month}`;
    const totalPadded = String(row.total_trades).padStart(12);
    const eligiblePadded = String(row.pnl_eligible_trades_v3).padStart(18);
    const marketsPadded = String(row.distinct_markets_v3).padStart(17);
    const netFlowFormatted = row.net_flow_v3.toFixed(2);
    const netFlowPadded = (row.net_flow_v3 >= 0 ? '+' : '') + netFlowFormatted;

    console.log(`│ ${monthDisplay} │ ${totalPadded} │ ${eligiblePadded} │ ${marketsPadded} │ ${netFlowPadded.padStart(16)} │`);
  });

  console.log('└─────────┴──────────────┴────────────────────┴───────────────────┴──────────────────┘');
  console.log('');

  // Summary stats
  const totalTrades = data.reduce((sum, row) => sum + row.total_trades, 0);
  const totalEligible = data.reduce((sum, row) => sum + row.pnl_eligible_trades_v3, 0);
  const totalMarkets = data.reduce((sum, row) => sum + row.distinct_markets_v3, 0);
  const totalNetFlow = data.reduce((sum, row) => sum + row.net_flow_v3, 0);

  console.log('Summary:');
  console.log(`  Total trades (6 months):         ${totalTrades.toLocaleString()}`);
  console.log(`  PnL eligible trades (v3):        ${totalEligible.toLocaleString()} (${(100 * totalEligible / totalTrades).toFixed(1)}%)`);
  console.log(`  Distinct markets (v3):           ${totalMarkets.toLocaleString()}`);
  console.log(`  Total net flow (v3):             ${totalNetFlow >= 0 ? '+' : ''}${totalNetFlow.toFixed(2)} USD`);
  console.log('');

  if (resolutionTable) {
    console.log(`Note: Resolution table '${resolutionTable}' is available for full PnL calculations.`);
  } else {
    console.log('Note: No resolution table found. Full realized PnL calculations may not be available.');
  }
  console.log('');
}

function writePnLReport(
  data: Array<{
    month: number;
    total_trades: number;
    pnl_eligible_trades_v3: number;
    distinct_markets_v3: number;
    net_flow_v3: number;
  }>,
  resolutionTable: string
) {
  const totalTrades = data.reduce((sum, row) => sum + row.total_trades, 0);
  const totalEligible = data.reduce((sum, row) => sum + row.pnl_eligible_trades_v3, 0);
  const totalMarkets = data.reduce((sum, row) => sum + row.distinct_markets_v3, 0);
  const totalNetFlow = data.reduce((sum, row) => sum + row.net_flow_v3, 0);

  const report = `# V3 xcnstrategy PnL Check

**Analysis Date:** ${new Date().toISOString().split('T')[0]}
**Canonical View Used:** \`${CHOSEN_VIEW}\`
**Wallet Address:** \`${XCNSTRATEGY_WALLET}\`
**Time Period:** Last 6 Calendar Months
**Resolution Table:** ${resolutionTable ? `\`${resolutionTable}\`` : 'Not found'}

---

## Monthly PnL Eligibility Breakdown

| Month   | Total Trades | PnL Eligible (v3) | Distinct Markets | Net Flow (USD) |
|---------|-------------:|------------------:|-----------------:|---------------:|
${data.map(row => {
  const monthStr = String(row.month);
  const year = monthStr.substring(0, 4);
  const month = monthStr.substring(4, 6);
  const netFlow = row.net_flow_v3 >= 0 ? '+' + row.net_flow_v3.toFixed(2) : row.net_flow_v3.toFixed(2);
  return `| ${year}-${month} | ${row.total_trades.toLocaleString()} | ${row.pnl_eligible_trades_v3.toLocaleString()} | ${row.distinct_markets_v3.toLocaleString()} | ${netFlow} |`;
}).join('\n')}

---

## Summary Statistics

- **Total Trades (6 months):** ${totalTrades.toLocaleString()}
- **PnL Eligible Trades (v3):** ${totalEligible.toLocaleString()} (${(100 * totalEligible / totalTrades).toFixed(1)}%)
- **Distinct Markets (v3):** ${totalMarkets.toLocaleString()}
- **Total Net Flow (v3):** ${totalNetFlow >= 0 ? '+' : ''}${totalNetFlow.toFixed(2)} USD

---

## Analysis

Over the last 6 months, the xcnstrategy wallet has **${totalEligible.toLocaleString()} PnL-eligible trades** out of ${totalTrades.toLocaleString()} total trades (**${(100 * totalEligible / totalTrades).toFixed(1)}%**).

These trades span **${totalMarkets.toLocaleString()} distinct markets** under the v3 canonical setup.

### Data Quality Assessment

${(100 * totalEligible / totalTrades) >= 70
  ? `✅ **Excellent** - Over 70% of trades are PnL-eligible with valid condition IDs.`
  : (100 * totalEligible / totalTrades) >= 50
    ? `⚠️  **Moderate** - About half of trades are PnL-eligible. Some improvement possible.`
    : `❌ **Poor** - Less than half of trades are PnL-eligible. Significant gaps exist.`
}

### Net Flow

The net flow over 6 months is **${totalNetFlow >= 0 ? '+' : ''}${totalNetFlow.toFixed(2)} USD**, which represents the difference between buy and sell activity (not realized PnL).

${resolutionTable
  ? `### PnL Calculation Readiness

✅ **Resolution data is available** via \`${resolutionTable}\`. This can be joined with the canonical trades to calculate realized PnL for resolved markets.

To calculate full realized PnL, join:
- \`${CHOSEN_VIEW}\` (trades with canonical_condition_id)
- \`${resolutionTable}\` (market resolutions and outcomes)

on \`canonical_condition_id\` to determine which positions won/lost and compute actual profit/loss.`
  : `### PnL Calculation Readiness

⚠️  **No resolution table found**. Full realized PnL calculations may require additional data sources or table setup.`
}

---

## Comparison Context (v2 vs v3)

**Note:** This analysis focuses on v3 data only. If v2 comparison data is needed, the analysis would need to be extended to include:
- A query against v2 canonical trades (if available)
- Side-by-side comparison of PnL-eligible trades and markets

Based on the coverage analysis from Step 2, we know that v3 provides **76.42% condition ID coverage** compared to the old v2 baseline of ~10%. This suggests that:

- **v3 includes significantly more PnL-eligible trades** than v2
- **More markets are trackable** under v3
- **PnL calculations will be more accurate and comprehensive** with v3 data

---

**Generated by:** C3 - xcnstrategy Wallet Validator
**Report Type:** Step 3 - PnL Sanity Check
`;

  writeFileSync('/tmp/V3_XCNSTRATEGY_PNL_CHECK.md', report);
  console.log('✅ Report written to: /tmp/V3_XCNSTRATEGY_PNL_CHECK.md');
  console.log('');
}

analyzeXcnstrategyPnL().catch(console.error);
