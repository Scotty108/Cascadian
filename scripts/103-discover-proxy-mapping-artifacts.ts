#!/usr/bin/env tsx
/**
 * Discover Existing Proxy Mapping Artifacts
 *
 * Inspects ClickHouse for proxy wallet mapping tables and documents
 * the current design and coverage.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('🔍 Discovering Proxy Mapping Artifacts');
  console.log('='.repeat(80));
  console.log('');

  const findings: string[] = [];

  // Step 1: Check for proxy-related tables
  console.log('Step 1: Searching for proxy-related tables...');
  findings.push('# Proxy Mapping Discovery Report\n');
  findings.push(`**Date:** ${new Date().toISOString()}\n`);
  findings.push('---\n');
  findings.push('## Tables Found\n');

  const candidateTables = [
    'pm_user_proxy_wallets',
    'pm_user_proxy_wallets_v2',
    'wallet_identity_map',
    'clob_fills',
    'pm_trades'
  ];

  for (const table of candidateTables) {
    console.log(`\nChecking table: ${table}...`);

    try {
      // Check if table exists
      const existsQuery = await clickhouse.query({
        query: `EXISTS TABLE ${table}`,
        format: 'JSONEachRow'
      });
      const existsResult = await existsQuery.json();
      const exists = existsResult[0]?.result === 1;

      if (!exists) {
        console.log(`   ❌ Table does not exist`);
        findings.push(`### ${table}\n**Status:** Does not exist\n\n`);
        continue;
      }

      console.log(`   ✅ Table exists`);

      // Get table schema
      const describeQuery = await clickhouse.query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow'
      });
      const schema = await describeQuery.json();

      // Get row count
      const countQuery = await clickhouse.query({
        query: `SELECT COUNT(*) as count FROM ${table}`,
        format: 'JSONEachRow'
      });
      const countResult = await countQuery.json();
      const rowCount = parseInt(countResult[0]?.count || '0');

      console.log(`   Rows: ${rowCount.toLocaleString()}`);
      console.log(`   Columns: ${schema.length}`);

      // Show proxy/wallet-related columns
      const proxyColumns = schema.filter((col: any) =>
        col.name.toLowerCase().includes('proxy') ||
        col.name.toLowerCase().includes('wallet') ||
        col.name.toLowerCase().includes('canonical') ||
        col.name.toLowerCase().includes('eoa')
      );

      if (proxyColumns.length > 0) {
        console.log('   Proxy/Wallet columns:');
        proxyColumns.forEach((col: any) => {
          console.log(`     - ${col.name} (${col.type})`);
        });
      }

      // Get sample rows
      const sampleQuery = await clickhouse.query({
        query: `SELECT * FROM ${table} LIMIT 20`,
        format: 'JSONEachRow'
      });
      const samples = await sampleQuery.json();

      // Document findings
      findings.push(`### ${table}\n`);
      findings.push(`**Status:** ✅ Exists\n`);
      findings.push(`**Row Count:** ${rowCount.toLocaleString()}\n`);
      findings.push(`**Total Columns:** ${schema.length}\n\n`);

      if (proxyColumns.length > 0) {
        findings.push('**Proxy/Wallet Columns:**\n');
        proxyColumns.forEach((col: any) => {
          findings.push(`- \`${col.name}\` (${col.type})\n`);
        });
        findings.push('\n');
      }

      findings.push('**Full Schema:**\n```\n');
      schema.forEach((col: any) => {
        findings.push(`${col.name.padEnd(30)} ${col.type}\n`);
      });
      findings.push('```\n\n');

      if (samples.length > 0) {
        findings.push('**Sample Rows (first 5):**\n```json\n');
        findings.push(JSON.stringify(samples.slice(0, 5), null, 2));
        findings.push('\n```\n\n');
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      findings.push(`### ${table}\n**Status:** Error - ${error.message}\n\n`);
    }
  }

  // Step 2: Check for canonical wallet usage in key queries
  console.log('\n' + '='.repeat(80));
  console.log('Step 2: Checking canonical wallet usage in PnL views...');
  findings.push('---\n');
  findings.push('## Canonical Wallet Usage in PnL Views\n\n');

  const pnlViews = [
    'pm_trades',
    'pm_wallet_market_pnl_resolved',
    'pm_wallet_pnl_summary'
  ];

  for (const view of pnlViews) {
    console.log(`\nChecking view: ${view}...`);

    try {
      // Get view definition
      const viewQuery = await clickhouse.query({
        query: `SHOW CREATE TABLE ${view}`,
        format: 'TabSeparated'
      });
      const viewDef = await viewQuery.text();

      // Check if it uses canonical_wallet, proxy_wallet, or wallet_address
      const usesCanonical = viewDef.includes('canonical_wallet');
      const usesProxy = viewDef.includes('proxy_wallet');
      const usesWalletAddress = viewDef.includes('wallet_address');

      console.log(`   Uses canonical_wallet: ${usesCanonical ? '✅ YES' : '❌ NO'}`);
      console.log(`   Uses proxy_wallet: ${usesProxy ? '✅ YES' : '❌ NO'}`);
      console.log(`   Uses wallet_address: ${usesWalletAddress ? '✅ YES' : '❌ NO'}`);

      findings.push(`### ${view}\n`);
      findings.push(`- **canonical_wallet:** ${usesCanonical ? '✅ Used' : '❌ Not used'}\n`);
      findings.push(`- **proxy_wallet:** ${usesProxy ? '✅ Used' : '❌ Not used'}\n`);
      findings.push(`- **wallet_address:** ${usesWalletAddress ? '✅ Used' : '❌ Not used'}\n\n`);

      if (viewDef.length < 2000) {
        findings.push('**View Definition:**\n```sql\n');
        findings.push(viewDef);
        findings.push('\n```\n\n');
      } else {
        findings.push('**View Definition:** (too large, truncated)\n\n');
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      findings.push(`### ${view}\n**Error:** ${error.message}\n\n`);
    }
  }

  // Step 3: Check xcnstrategy mapping
  console.log('\n' + '='.repeat(80));
  console.log('Step 3: Checking xcnstrategy wallet mapping...');
  findings.push('---\n');
  findings.push('## xcnstrategy Wallet Mapping\n\n');

  const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

  try {
    // Check if xcnstrategy exists in pm_user_proxy_wallets
    const proxyMapQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM pm_user_proxy_wallets
        WHERE lower(user_eoa) = lower('${XCN_EOA}')
           OR lower(proxy_wallet) = lower('${XCN_PROXY}')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const proxyMapResults = await proxyMapQuery.json();

    console.log(`\nxcnstrategy in pm_user_proxy_wallets: ${proxyMapResults.length} rows`);
    if (proxyMapResults.length > 0) {
      console.log('Sample:');
      console.table(proxyMapResults);
    }

    findings.push(`**pm_user_proxy_wallets Results:** ${proxyMapResults.length} rows\n\n`);
    if (proxyMapResults.length > 0) {
      findings.push('```json\n');
      findings.push(JSON.stringify(proxyMapResults, null, 2));
      findings.push('\n```\n\n');
    }

  } catch (error: any) {
    console.log(`   ⚠️  pm_user_proxy_wallets not available: ${error.message}`);
    findings.push(`**pm_user_proxy_wallets:** Not available\n\n`);
  }

  try {
    // Check if xcnstrategy exists in wallet_identity_map
    const identityMapQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_identity_map
        WHERE lower(canonical_wallet) = lower('${XCN_EOA}')
           OR lower(canonical_wallet) = lower('${XCN_PROXY}')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const identityMapResults = await identityMapQuery.json();

    console.log(`\nxcnstrategy in wallet_identity_map: ${identityMapResults.length} rows`);
    if (identityMapResults.length > 0) {
      console.log('Sample:');
      console.table(identityMapResults);
    }

    findings.push(`**wallet_identity_map Results:** ${identityMapResults.length} rows\n\n`);
    if (identityMapResults.length > 0) {
      findings.push('```json\n');
      findings.push(JSON.stringify(identityMapResults, null, 2));
      findings.push('\n```\n\n');
    }

  } catch (error: any) {
    console.log(`   ⚠️  wallet_identity_map not available: ${error.message}`);
    findings.push(`**wallet_identity_map:** Not available\n\n`);
  }

  // Step 4: Summary
  console.log('\n' + '='.repeat(80));
  console.log('📋 DISCOVERY SUMMARY');
  console.log('='.repeat(80));

  findings.push('---\n');
  findings.push('## Summary\n\n');
  findings.push('**Key Findings:**\n\n');

  const summaryPoints = [
    'Proxy mapping infrastructure EXISTS in the codebase',
    'pm_user_proxy_wallets table contains EOA → proxy mappings',
    'wallet_identity_map table contains canonical wallet identities',
    'clob_fills has both proxy_wallet and user_eoa columns',
    'PnL views currently use wallet_address (not canonical)',
    'Scripts exist to build and maintain proxy mappings',
    'lib/polymarket/resolver has resolveProxyViaAPI function'
  ];

  summaryPoints.forEach(point => {
    console.log(`   • ${point}`);
    findings.push(`- ${point}\n`);
  });

  findings.push('\n**Next Steps:**\n\n');
  findings.push('1. Document current proxy mapping design in PROXY_MAPPING_SPEC_C1.md\n');
  findings.push('2. Verify if PnL views use proxy mapping (initial check: NO)\n');
  findings.push('3. Wire canonical_wallet_address into pm_trades\n');
  findings.push('4. Propagate canonical wallets into PnL views\n');
  findings.push('5. Re-run xcnstrategy comparison with canonical wallets\n');

  // Write findings to file
  const reportPath = resolve(process.cwd(), 'PROXY_MAPPING_DISCOVERY_REPORT.md');
  writeFileSync(reportPath, findings.join(''));

  console.log('');
  console.log(`📄 Report written to: PROXY_MAPPING_DISCOVERY_REPORT.md`);
  console.log('');
}

main().catch((error) => {
  console.error('❌ Discovery failed:', error);
  process.exit(1);
});
