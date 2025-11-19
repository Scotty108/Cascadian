#!/usr/bin/env tsx
/**
 * Phase 8: Coverage and Integration Metrics
 *
 * Purpose: Report on how much external trade ingestion has improved coverage
 *          at both wallet and market levels.
 *
 * Strategy:
 *   1. Wallet-level: Compare internal (CLOB) vs external trade counts
 *   2. Market-level: Count markets that only exist in CLOB, external, or both
 *   3. Generate EXTERNAL_COVERAGE_STATUS.md markdown report
 *   4. Provide metrics C1 can use to validate PnL and Omega
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

interface WalletCoverage {
  wallet_address: string;
  internal_trades: number;
  external_trades: number;
  internal_notional: number;
  external_notional: number;
  external_share_pct: number;
  backfill_status: string;
}

interface MarketCoverage {
  condition_id: string;
  question: string;
  internal_trades: number;
  external_trades: number;
  internal_wallets: number;
  external_wallets: number;
}

async function getWalletLevelCoverage(): Promise<WalletCoverage[]> {
  console.log('Analyzing wallet-level coverage...');
  console.log('');

  const query = `
    WITH internal_stats AS (
      SELECT
        wallet_address,
        COUNT(*) as internal_trades,
        SUM(abs(collateral_amount)) as internal_notional
      FROM pm_trades
      WHERE data_source = 'clob_fills'
      GROUP BY wallet_address
    ),
    external_stats AS (
      SELECT
        wallet_address,
        COUNT(*) as external_trades,
        SUM(abs(cash_value)) as external_notional
      FROM external_trades_raw
      GROUP BY wallet_address
    )
    SELECT
      COALESCE(i.wallet_address, e.wallet_address) as wallet_address,
      COALESCE(i.internal_trades, 0) as internal_trades,
      COALESCE(e.external_trades, 0) as external_trades,
      COALESCE(i.internal_notional, 0) as internal_notional,
      COALESCE(e.external_notional, 0) as external_notional,
      COALESCE(
        100.0 * e.external_notional / NULLIF(i.internal_notional + e.external_notional, 0),
        0
      ) as external_share_pct,
      COALESCE(bp.status, 'not_planned') as backfill_status
    FROM internal_stats i
    FULL OUTER JOIN external_stats e ON i.wallet_address = e.wallet_address
    LEFT JOIN wallet_backfill_plan bp ON COALESCE(i.wallet_address, e.wallet_address) = bp.wallet_address
    WHERE COALESCE(e.external_trades, 0) > 0
    ORDER BY external_notional DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  return result.json<WalletCoverage[]>();
}

async function getMarketLevelCoverage(): Promise<{
  clobOnly: number;
  externalOnly: number;
  both: number;
  samples: MarketCoverage[];
}> {
  console.log('Analyzing market-level coverage...');
  console.log('');

  // Count markets by coverage type
  const countsQuery = `
    WITH internal_markets AS (
      SELECT DISTINCT condition_id
      FROM pm_trades
      WHERE data_source = 'clob_fills'
    ),
    external_markets AS (
      SELECT DISTINCT condition_id
      FROM external_trades_raw
    )
    SELECT
      countIf(condition_id IN (SELECT * FROM internal_markets) AND condition_id NOT IN (SELECT * FROM external_markets)) as clob_only,
      countIf(condition_id NOT IN (SELECT * FROM internal_markets) AND condition_id IN (SELECT * FROM external_markets)) as external_only,
      countIf(condition_id IN (SELECT * FROM internal_markets) AND condition_id IN (SELECT * FROM external_markets)) as both
    FROM (
      SELECT condition_id FROM internal_markets
      UNION DISTINCT
      SELECT condition_id FROM external_markets
    )
  `;

  const countsResult = await clickhouse.query({
    query: countsQuery,
    format: 'JSONEachRow'
  });

  const counts = (await countsResult.json())[0];

  // Get sample markets with external trades
  const samplesQuery = `
    WITH internal_stats AS (
      SELECT
        condition_id,
        COUNT(*) as internal_trades,
        COUNT(DISTINCT wallet_address) as internal_wallets
      FROM pm_trades
      WHERE data_source = 'clob_fills'
      GROUP BY condition_id
    ),
    external_stats AS (
      SELECT
        condition_id,
        COUNT(*) as external_trades,
        COUNT(DISTINCT wallet_address) as external_wallets,
        any(market_question) as question
      FROM external_trades_raw
      GROUP BY condition_id
    )
    SELECT
      e.condition_id,
      e.question,
      COALESCE(i.internal_trades, 0) as internal_trades,
      e.external_trades,
      COALESCE(i.internal_wallets, 0) as internal_wallets,
      e.external_wallets
    FROM external_stats e
    LEFT JOIN internal_stats i ON e.condition_id = i.condition_id
    ORDER BY e.external_trades DESC
    LIMIT 20
  `;

  const samplesResult = await clickhouse.query({
    query: samplesQuery,
    format: 'JSONEachRow'
  });

  const samples = await samplesResult.json<MarketCoverage[]>();

  return {
    clobOnly: parseInt(counts.clob_only),
    externalOnly: parseInt(counts.external_only),
    both: parseInt(counts.both),
    samples
  };
}

async function getUnionViewValidation(): Promise<{
  pmTradesCount: number;
  unionViewCount: number;
  externalCount: number;
  hasDuplicates: boolean;
}> {
  console.log('Validating pm_trades_with_external view...');
  console.log('');

  // Count rows in each source
  const pmTradesResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM pm_trades',
    format: 'JSONEachRow'
  });
  const pmTradesCount = parseInt((await pmTradesResult.json())[0].cnt);

  const unionViewResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM pm_trades_with_external',
    format: 'JSONEachRow'
  });
  const unionViewCount = parseInt((await unionViewResult.json())[0].cnt);

  const externalResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM external_trades_raw',
    format: 'JSONEachRow'
  });
  const externalCount = parseInt((await externalResult.json())[0].cnt);

  // Check for duplicates (CLOB + external for same trade)
  const dupCheckResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        block_time,
        COUNT(*) as cnt
      FROM pm_trades_with_external
      GROUP BY wallet_address, condition_id, block_time
      HAVING COUNT(*) > 1
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const duplicates = await dupCheckResult.json();
  const hasDuplicates = duplicates.length > 0;

  return {
    pmTradesCount,
    unionViewCount,
    externalCount,
    hasDuplicates
  };
}

function generateMarkdownReport(
  walletCoverage: WalletCoverage[],
  marketCoverage: {
    clobOnly: number;
    externalOnly: number;
    both: number;
    samples: MarketCoverage[];
  },
  unionValidation: {
    pmTradesCount: number;
    unionViewCount: number;
    externalCount: number;
    hasDuplicates: boolean;
  }
): string {
  const timestamp = new Date().toISOString();

  let report = `# External Trade Coverage Status\n\n`;
  report += `**Generated:** ${timestamp}\n`;
  report += `**Agent:** C2 - External Data Ingestion\n`;
  report += `**Mission:** Phase 8 - Coverage and Integration Metrics\n\n`;
  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `**External trades ingested:** ${unionValidation.externalCount.toLocaleString()}\n`;
  report += `**Wallets with external trades:** ${walletCoverage.length}\n`;
  report += `**Markets with external-only trades:** ${marketCoverage.externalOnly}\n`;
  report += `**Markets with both CLOB + external:** ${marketCoverage.both}\n\n`;

  const totalWalletExternal = walletCoverage.reduce((sum, w) => sum + w.external_notional, 0);
  const totalWalletInternal = walletCoverage.reduce((sum, w) => sum + w.internal_notional, 0);
  const overallExternalShare = (100.0 * totalWalletExternal / (totalWalletInternal + totalWalletExternal)).toFixed(2);

  report += `**External share of total volume:** ${overallExternalShare}%\n`;
  report += `  - Internal (CLOB): $${totalWalletInternal.toLocaleString()}\n`;
  report += `  - External (AMM/Data-API): $${totalWalletExternal.toLocaleString()}\n\n`;

  report += `---\n\n`;

  // Wallet-Level Coverage
  report += `## Wallet-Level Coverage\n\n`;
  report += `Wallets that have external trades ingested:\n\n`;
  report += `| Wallet | Internal Trades | External Trades | Internal Notional | External Notional | External % | Status |\n`;
  report += `|--------|----------------|-----------------|-------------------|-------------------|------------|--------|\n`;

  for (const wallet of walletCoverage.slice(0, 20)) {
    const walletShort = wallet.wallet_address.substring(0, 16) + '...';
    report += `| \`${walletShort}\` | ${wallet.internal_trades.toLocaleString()} | ${wallet.external_trades.toLocaleString()} | $${wallet.internal_notional.toFixed(2)} | $${wallet.external_notional.toFixed(2)} | ${wallet.external_share_pct.toFixed(2)}% | ${wallet.backfill_status} |\n`;
  }

  if (walletCoverage.length > 20) {
    report += `\n*...and ${walletCoverage.length - 20} more wallets*\n`;
  }

  report += `\n---\n\n`;

  // Market-Level Coverage
  report += `## Market-Level Coverage\n\n`;
  report += `Distribution of markets by data source:\n\n`;
  report += `| Coverage Type | Market Count | Description |\n`;
  report += `|---------------|--------------|-------------|\n`;
  report += `| **CLOB Only** | ${marketCoverage.clobOnly.toLocaleString()} | Markets with only CLOB trades (no external data) |\n`;
  report += `| **External Only** | ${marketCoverage.externalOnly.toLocaleString()} | Markets with only external trades (ghost markets, AMM-only) |\n`;
  report += `| **Both** | ${marketCoverage.both.toLocaleString()} | Markets with both CLOB and external trades |\n\n`;

  report += `### Sample Markets with External Trades\n\n`;
  report += `| Condition ID | Question | Internal Trades | External Trades | Internal Wallets | External Wallets |\n`;
  report += `|--------------|----------|----------------|-----------------|------------------|------------------|\n`;

  for (const market of marketCoverage.samples.slice(0, 10)) {
    const cidShort = market.condition_id.substring(0, 16) + '...';
    const questionShort = market.question.substring(0, 50) + (market.question.length > 50 ? '...' : '');
    report += `| \`${cidShort}\` | ${questionShort} | ${market.internal_trades.toLocaleString()} | ${market.external_trades.toLocaleString()} | ${market.internal_wallets} | ${market.external_wallets} |\n`;
  }

  report += `\n---\n\n`;

  // UNION View Validation
  report += `## UNION View Validation\n\n`;
  report += `**pm_trades_with_external** integrity check:\n\n`;
  report += `| Metric | Count |\n`;
  report += `|--------|-------|\n`;
  report += `| pm_trades (CLOB only) | ${unionValidation.pmTradesCount.toLocaleString()} |\n`;
  report += `| external_trades_raw | ${unionValidation.externalCount.toLocaleString()} |\n`;
  report += `| pm_trades_with_external (UNION) | ${unionValidation.unionViewCount.toLocaleString()} |\n\n`;

  const expectedUnionCount = unionValidation.pmTradesCount + unionValidation.externalCount;
  const actualUnionCount = unionValidation.unionViewCount;

  if (actualUnionCount === expectedUnionCount) {
    report += `✅ **Row count validated:** ${actualUnionCount.toLocaleString()} = ${unionValidation.pmTradesCount.toLocaleString()} (CLOB) + ${unionValidation.externalCount.toLocaleString()} (external)\n\n`;
  } else {
    report += `⚠️  **Row count mismatch:** Expected ${expectedUnionCount.toLocaleString()}, got ${actualUnionCount.toLocaleString()}\n\n`;
  }

  if (unionValidation.hasDuplicates) {
    report += `⚠️  **Duplicate trades detected** - Same trade appears in both CLOB and external sources\n\n`;
  } else {
    report += `✅ **No duplicate trades** - CLOB and external trades are non-overlapping\n\n`;
  }

  report += `---\n\n`;

  // C1 Integration Guidance
  report += `## For C1: Trusted Wallets and Markets\n\n`;
  report += `### Fully Backfilled Wallets\n\n`;
  report += `Wallets with status='done' in wallet_backfill_plan:\n\n`;

  const doneWallets = walletCoverage.filter(w => w.backfill_status === 'done');

  if (doneWallets.length > 0) {
    report += `\`\`\`sql\n`;
    report += `-- Query for fully backfilled wallets\n`;
    report += `SELECT * FROM pm_trades_with_external\n`;
    report += `WHERE wallet_address IN (\n`;
    for (let i = 0; i < doneWallets.length; i++) {
      report += `  '${doneWallets[i].wallet_address}'${i < doneWallets.length - 1 ? ',' : ''}\n`;
    }
    report += `)\n`;
    report += `\`\`\`\n\n`;

    report += `These ${doneWallets.length} wallet(s) have complete trade history from both CLOB and external sources.\n\n`;
  } else {
    report += `⚠️  No wallets marked as fully backfilled yet.\n\n`;
  }

  report += `### Ghost Markets (External-Only)\n\n`;
  report += `Markets that exist ONLY in external sources:\n\n`;
  report += `\`\`\`sql\n`;
  report += `-- Ghost markets query\n`;
  report += `SELECT DISTINCT condition_id, market_question\n`;
  report += `FROM external_trades_raw\n`;
  report += `WHERE condition_id NOT IN (\n`;
  report += `  SELECT DISTINCT condition_id FROM pm_trades WHERE data_source = 'clob_fills'\n`;
  report += `)\n`;
  report += `\`\`\`\n\n`;

  report += `These ${marketCoverage.externalOnly} markets have **zero CLOB coverage** and rely entirely on external ingestion.\n\n`;

  report += `---\n\n`;

  // Next Steps
  report += `## Next Steps\n\n`;
  report += `1. **For C1:** Switch P&L views to \`pm_trades_with_external\`\n`;
  report += `2. **For C1:** Validate P&L calculations for fully backfilled wallets\n`;
  report += `3. **For C1:** Compare computed P&L against Dome baseline\n`;
  report += `4. **For C2:** Continue backfilling remaining pending wallets\n`;
  report += `5. **For C2:** Monitor for API errors or data quality issues\n\n`;

  report += `---\n\n`;
  report += `**Report Generated:** ${timestamp}\n`;
  report += `**C2 - External Data Ingestion Agent**\n`;

  return report;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 8: Coverage and Integration Metrics');
  console.log('═'.repeat(80));
  console.log('');

  try {
    // Step 1: Wallet-level coverage
    const walletCoverage = await getWalletLevelCoverage();
    console.log(`✅ Found ${walletCoverage.length} wallets with external trades`);
    console.log('');

    // Step 2: Market-level coverage
    const marketCoverage = await getMarketLevelCoverage();
    console.log(`✅ Market breakdown:`);
    console.log(`   CLOB only:     ${marketCoverage.clobOnly.toLocaleString()} markets`);
    console.log(`   External only: ${marketCoverage.externalOnly.toLocaleString()} markets (ghost markets)`);
    console.log(`   Both:          ${marketCoverage.both.toLocaleString()} markets`);
    console.log('');

    // Step 3: UNION view validation
    const unionValidation = await getUnionViewValidation();
    console.log(`✅ UNION view validation:`);
    console.log(`   pm_trades:                ${unionValidation.pmTradesCount.toLocaleString()} rows`);
    console.log(`   external_trades_raw:      ${unionValidation.externalCount.toLocaleString()} rows`);
    console.log(`   pm_trades_with_external:  ${unionValidation.unionViewCount.toLocaleString()} rows`);
    console.log(`   Has duplicates:           ${unionValidation.hasDuplicates ? 'YES ⚠️' : 'NO ✅'}`);
    console.log('');

    // Step 4: Generate markdown report
    console.log('Generating EXTERNAL_COVERAGE_STATUS.md...');
    console.log('');

    const report = generateMarkdownReport(walletCoverage, marketCoverage, unionValidation);

    writeFileSync(
      resolve(process.cwd(), 'EXTERNAL_COVERAGE_STATUS.md'),
      report,
      'utf-8'
    );

    console.log('✅ Report written to EXTERNAL_COVERAGE_STATUS.md');
    console.log('');

    // Summary
    console.log('═'.repeat(80));
    console.log('PHASE 8 COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log('✅ Wallet-level coverage analyzed');
    console.log('✅ Market-level coverage analyzed');
    console.log('✅ UNION view validated');
    console.log('✅ Markdown report generated');
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Review EXTERNAL_COVERAGE_STATUS.md');
    console.log('  2. Update C2_HANDOFF_FOR_C1.md with coverage metrics section');
    console.log('  3. Proceed to Phase 9: Prepare broader rollout with runbook');
    console.log('');

  } catch (error: any) {
    console.error('❌ Failed to generate coverage report:', error.message);
    throw error;
  }

  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
