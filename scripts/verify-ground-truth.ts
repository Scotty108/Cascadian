#!/usr/bin/env npx tsx

/**
 * Ground Truth Verification Script
 *
 * Systematically verifies all claims about:
 * - Trade table architecture
 * - ERC1155 coverage
 * - Test wallet status
 * - Data pipeline completeness
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';
import { writeFileSync } from 'fs';

interface VerificationResult {
  section: string;
  checks: Array<{
    claim: string;
    verified: boolean;
    evidence: any;
    notes: string;
  }>;
}

const results: VerificationResult[] = [];

async function verifyTradeTables() {
  console.log('🔍 SECTION 1: Trade Table Architecture\n');

  const checks: VerificationResult['checks'] = [];

  // Check 1: What trade tables exist?
  try {
    const tablesResult = await clickhouse.query({
      query: `
        SELECT
          database,
          name,
          engine,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE (database = 'default' OR database = 'cascadian_clean')
          AND (name LIKE '%trade%' OR name LIKE '%fact%')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    });

    const tables = await tablesResult.json<Array<any>>();

    console.log('📊 All trade-related tables:\n');
    tables.forEach(t => {
      console.log(`  ${t.database}.${t.name}`);
      console.log(`    Rows: ${parseInt(t.total_rows).toLocaleString()}`);
      console.log(`    Engine: ${t.engine}`);
      console.log(`    Size: ${(parseInt(t.total_bytes) / 1024 / 1024).toFixed(2)} MB\n`);
    });

    checks.push({
      claim: 'Multiple trade tables exist',
      verified: tables.length > 3,
      evidence: tables.map(t => ({ name: `${t.database}.${t.name}`, rows: t.total_rows })),
      notes: `Found ${tables.length} trade-related tables`
    });

    // Find the largest table (likely the canonical one)
    const largest = tables[0];
    console.log(`✅ Largest table: ${largest.database}.${largest.name} (${parseInt(largest.total_rows).toLocaleString()} rows)\n`);

    checks.push({
      claim: 'Canonical trade table identified',
      verified: true,
      evidence: { table: `${largest.database}.${largest.name}`, rows: largest.total_rows },
      notes: 'Largest table by row count'
    });

  } catch (error) {
    console.error('❌ Error checking trade tables:', error);
    checks.push({
      claim: 'Trade tables queryable',
      verified: false,
      evidence: error,
      notes: 'Database query failed'
    });
  }

  results.push({ section: 'Trade Tables', checks });
}

async function verifyERC1155Coverage() {
  console.log('\n🔍 SECTION 2: ERC1155 Coverage\n');

  const checks: VerificationResult['checks'] = [];

  // Check 1: ERC1155 table stats
  try {
    const statsResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_transfers,
          count(DISTINCT from_address) as unique_from,
          count(DISTINCT to_address) as unique_to,
          count(DISTINCT token_id) as unique_tokens,
          min(block_number) as earliest_block,
          max(block_number) as latest_block,
          quantile(0.1)(block_number) as p10_block,
          quantile(0.5)(block_number) as p50_block,
          quantile(0.9)(block_number) as p90_block
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    });

    const stats = await statsResult.json<Array<any>>();
    const s = stats[0];

    console.log('📊 ERC1155 Transfer Stats:\n');
    console.log(`  Total transfers: ${parseInt(s.total_transfers).toLocaleString()}`);
    console.log(`  Unique senders: ${parseInt(s.unique_from).toLocaleString()}`);
    console.log(`  Unique receivers: ${parseInt(s.unique_to).toLocaleString()}`);
    console.log(`  Unique tokens: ${parseInt(s.unique_tokens).toLocaleString()}`);
    console.log(`  Block range: ${parseInt(s.earliest_block).toLocaleString()} → ${parseInt(s.latest_block).toLocaleString()}`);
    console.log(`  Block distribution: p10=${parseInt(s.p10_block).toLocaleString()}, p50=${parseInt(s.p50_block).toLocaleString()}, p90=${parseInt(s.p90_block).toLocaleString()}\n`);

    checks.push({
      claim: 'ERC1155 data exists',
      verified: parseInt(s.total_transfers) > 1000000,
      evidence: { total: s.total_transfers, block_range: `${s.earliest_block}-${s.latest_block}` },
      notes: `${parseInt(s.total_transfers).toLocaleString()} transfers found`
    });

    // Check 2: Block distribution (gaps?)
    const gapsResult = await clickhouse.query({
      query: `
        SELECT
          floor(block_number / 1000000) as block_million,
          count() as transfers_in_range
        FROM default.erc1155_transfers
        GROUP BY block_million
        ORDER BY block_million
      `,
      format: 'JSONEachRow'
    });

    const gaps = await gapsResult.json<Array<any>>();

    console.log('📊 Block distribution (by million):\n');
    gaps.forEach(g => {
      console.log(`  ${g.block_million}M-${parseInt(g.block_million)+1}M: ${parseInt(g.transfers_in_range).toLocaleString()} transfers`);
    });
    console.log();

    const hasEarlyData = gaps.some(g => parseInt(g.block_million) < 10);

    checks.push({
      claim: 'ERC1155 has early Polymarket data (blocks < 10M)',
      verified: hasEarlyData,
      evidence: gaps,
      notes: hasEarlyData ? 'Early blocks present' : 'No data before block 10M'
    });

  } catch (error) {
    console.error('❌ Error checking ERC1155:', error);
    checks.push({
      claim: 'ERC1155 table queryable',
      verified: false,
      evidence: error,
      notes: 'Query failed'
    });
  }

  results.push({ section: 'ERC1155 Coverage', checks });
}

async function verifyTestWallet() {
  console.log('\n🔍 SECTION 3: Test Wallet (0x4ce73141)\n');

  const checks: VerificationResult['checks'] = [];
  const testWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  // Check 1: ERC1155 transfers
  try {
    const erc1155Result = await clickhouse.query({
      query: `
        SELECT
          count() as total_transfers,
          count(DISTINCT token_id) as unique_tokens,
          min(block_number) as earliest_block,
          max(block_number) as latest_block
        FROM default.erc1155_transfers
        WHERE to_address = '${testWallet}' OR from_address = '${testWallet}'
      `,
      format: 'JSONEachRow'
    });

    const erc1155 = await erc1155Result.json<Array<any>>();
    const e = erc1155[0];

    console.log('📊 Test Wallet ERC1155 Transfers:\n');
    console.log(`  Total transfers: ${parseInt(e.total_transfers).toLocaleString()}`);
    console.log(`  Unique tokens: ${parseInt(e.unique_tokens).toLocaleString()}`);
    if (parseInt(e.total_transfers) > 0) {
      console.log(`  Block range: ${parseInt(e.earliest_block).toLocaleString()} → ${parseInt(e.latest_block).toLocaleString()}\n`);
    } else {
      console.log(`  ❌ NO TRANSFERS FOUND\n`);
    }

    checks.push({
      claim: 'Test wallet has ERC1155 transfers',
      verified: parseInt(e.total_transfers) > 100,
      evidence: { transfers: e.total_transfers, tokens: e.unique_tokens },
      notes: parseInt(e.total_transfers) === 0 ? 'ZERO transfers - this is the problem!' : 'Has transfers'
    });

  } catch (error) {
    console.error('❌ Error checking test wallet ERC1155:', error);
  }

  // Check 2: Coverage in various trade tables
  const tradeTables = [
    'default.trade_direction_assignments',
    'default.trades_with_direction',
    'cascadian_clean.fact_trades_clean'
  ];

  for (const table of tradeTables) {
    try {
      const coverageResult = await clickhouse.query({
        query: `
          SELECT
            count() as total_trades,
            uniqExact(condition_id_norm) as unique_markets
          FROM ${table}
          WHERE wallet_address = '${testWallet}'
            AND length(replaceAll(condition_id_norm, '0x', '')) = 64
        `,
        format: 'JSONEachRow'
      });

      const coverage = await coverageResult.json<Array<any>>();
      const c = coverage[0];

      console.log(`📊 ${table}:`);
      console.log(`  Trades: ${parseInt(c.total_trades).toLocaleString()}`);
      console.log(`  Markets: ${parseInt(c.unique_markets).toLocaleString()}`);
      console.log(`  Coverage: ${(parseInt(c.unique_markets) / 2816 * 100).toFixed(1)}%\n`);

      checks.push({
        claim: `Test wallet coverage in ${table}`,
        verified: parseInt(c.unique_markets) > 2000,
        evidence: { trades: c.total_trades, markets: c.unique_markets },
        notes: `${(parseInt(c.unique_markets) / 2816 * 100).toFixed(1)}% of expected 2,816`
      });

    } catch (error) {
      console.log(`  ⚠️ Table ${table} not accessible or doesn't exist\n`);
    }
  }

  results.push({ section: 'Test Wallet', checks });
}

async function verifyDataPipeline() {
  console.log('\n🔍 SECTION 4: Data Pipeline Completeness\n');

  const checks: VerificationResult['checks'] = [];

  // Check USDC transfers
  try {
    const usdcResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_transfers,
          min(block_number) as earliest_block,
          max(block_number) as latest_block
        FROM default.erc20_transfers_staging
      `,
      format: 'JSONEachRow'
    });

    const usdc = await usdcResult.json<Array<any>>();
    const u = usdc[0];

    console.log('📊 USDC Transfers (Trading Activity):\n');
    console.log(`  Total: ${parseInt(u.total_transfers).toLocaleString()}`);
    console.log(`  Block range: ${parseInt(u.earliest_block).toLocaleString()} → ${parseInt(u.latest_block).toLocaleString()}\n`);

    checks.push({
      claim: 'USDC transfer data exists',
      verified: parseInt(u.total_transfers) > 100000000,
      evidence: { total: u.total_transfers, block_range: `${u.earliest_block}-${u.latest_block}` },
      notes: 'Trading activity tracked'
    });

  } catch (error) {
    console.error('❌ Error checking USDC:', error);
  }

  // Check mapping tables
  try {
    const mappingResult = await clickhouse.query({
      query: `
        SELECT count() as total_mappings
        FROM cascadian_clean.token_condition_market_map
      `,
      format: 'JSONEachRow'
    });

    const mapping = await mappingResult.json<Array<any>>();

    console.log('📊 Token→Condition Mappings:\n');
    console.log(`  Total mappings: ${parseInt(mapping[0].total_mappings).toLocaleString()}\n`);

    checks.push({
      claim: 'Token mapping table exists',
      verified: parseInt(mapping[0].total_mappings) > 100000,
      evidence: { mappings: mapping[0].total_mappings },
      notes: 'Enables linking ERC1155 to markets'
    });

  } catch (error) {
    console.error('❌ Error checking mappings:', error);
  }

  results.push({ section: 'Data Pipeline', checks });
}

async function generateSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('GROUND TRUTH VERIFICATION SUMMARY');
  console.log('='.repeat(80) + '\n');

  let totalChecks = 0;
  let passedChecks = 0;

  results.forEach(section => {
    console.log(`\n${section.section}:`);
    section.checks.forEach(check => {
      totalChecks++;
      if (check.verified) passedChecks++;

      const status = check.verified ? '✅' : '❌';
      console.log(`  ${status} ${check.claim}`);
      console.log(`     ${check.notes}`);
    });
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`VERIFICATION SCORE: ${passedChecks}/${totalChecks} checks passed (${(passedChecks/totalChecks*100).toFixed(1)}%)`);
  console.log('='.repeat(80) + '\n');

  // Save to file
  const reportPath = resolve(process.cwd(), 'GROUND_TRUTH_REPORT.json');
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total_checks: totalChecks,
      passed_checks: passedChecks,
      pass_rate: passedChecks/totalChecks
    }
  }, null, 2));

  console.log(`📄 Full report saved to: ${reportPath}\n`);
}

async function main() {
  console.log('🚀 GROUND TRUTH VERIFICATION STARTING\n');
  console.log('This will systematically verify all claims about the database.\n');

  await verifyTradeTables();
  await verifyERC1155Coverage();
  await verifyTestWallet();
  await verifyDataPipeline();
  await generateSummary();

  console.log('✅ Verification complete!\n');
}

main().catch(console.error);
