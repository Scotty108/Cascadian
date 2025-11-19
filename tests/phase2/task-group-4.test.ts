#!/usr/bin/env npx tsx
/**
 * Task Group 4: Data Export Pipelines
 *
 * 4 focused tests validating export functionality:
 * 1. Export wallet_metrics to JSON (nested by wallet, time window)
 * 2. Export wallet_metrics to CSV (flat rows for analysis)
 * 3. Export whale_leaderboard to JSON with metadata
 * 4. Verify export integrity (no NULLs, correct format, UTF-8 encoding)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { execSync } from 'child_process';

// Test utilities
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      error: error.message
    });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const exportsDir = resolve(process.cwd(), 'exports');

  console.log('\n' + '═'.repeat(100));
  console.log('TASK GROUP 4: DATA EXPORT PIPELINES');
  console.log('═'.repeat(100) + '\n');

  try {
    // Test 1: Export wallet_metrics to JSON (nested)
    console.log('Test 1: Export wallet_metrics to JSON (nested by wallet, time window)\n');
    await test('Should export wallet_metrics to nested JSON format', async () => {
      // Run export script
      console.log('    Running export-wallet-metrics-json.ts...');
      execSync('npx tsx scripts/export-wallet-metrics-json.ts', { stdio: 'pipe' });

      // Find the most recent export file
      const files = readdirSync(exportsDir).filter(f => f.startsWith('wallet_metrics_') && f.endsWith('.json'));
      assert(files.length > 0, 'No JSON export file found');

      const latestFile = files.sort().reverse()[0];
      const filepath = resolve(exportsDir, latestFile);

      // Verify file exists
      assert(existsSync(filepath), `Export file not found: ${filepath}`);

      // Read and parse JSON
      const content = readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);

      // Verify structure
      assert(data.metadata !== undefined, 'JSON should have metadata');
      assert(data.data !== undefined, 'JSON should have data');
      assert(typeof data.data === 'object', 'data should be an object');

      // Verify metadata
      assert(data.metadata.total_wallets > 0, 'Should have wallets');
      assert(data.metadata.time_windows.length === 4, 'Should have 4 time windows');

      // Verify nested structure (sample wallet)
      const wallets = Object.keys(data.data);
      assert(wallets.length > 0, 'Should have wallet data');

      const sampleWallet = data.data[wallets[0]];
      assert(sampleWallet.lifetime !== undefined, 'Wallet should have lifetime window');
      assert(typeof sampleWallet.lifetime.realized_pnl === 'number', 'realized_pnl should be a number');

      console.log(`    ✓ Exported ${data.metadata.total_wallets.toLocaleString()} wallets`);
      console.log(`    ✓ File: ${latestFile}`);
      console.log(`    ✓ Valid nested JSON structure`);
    });

    // Test 2: Export wallet_metrics to CSV (flat)
    console.log('\nTest 2: Export wallet_metrics to CSV (flat rows for analysis)\n');
    await test('Should export wallet_metrics to flat CSV format', async () => {
      // Run export script
      console.log('    Running export-wallet-metrics-csv.ts...');
      execSync('npx tsx scripts/export-wallet-metrics-csv.ts', { stdio: 'pipe' });

      // Find the most recent CSV file
      const files = readdirSync(exportsDir).filter(f => f.startsWith('wallet_metrics_flat_') && f.endsWith('.csv'));
      assert(files.length > 0, 'No CSV export file found');

      const latestFile = files.sort().reverse()[0];
      const filepath = resolve(exportsDir, latestFile);

      // Verify file exists
      assert(existsSync(filepath), `Export file not found: ${filepath}`);

      // Read CSV
      const content = readFileSync(filepath, 'utf-8');
      const lines = content.trim().split('\n');

      // Verify header
      const header = lines[0].replace('\uFEFF', ''); // Remove BOM
      const expectedColumns = [
        'wallet_address',
        'time_window',
        'realized_pnl',
        'unrealized_payout',
        'roi_pct',
        'win_rate',
        'sharpe_ratio',
        'omega_ratio',
        'total_trades',
        'markets_traded',
        'calculated_at'
      ];

      const actualColumns = header.split(',');
      assert(
        actualColumns.length === expectedColumns.length,
        `CSV should have ${expectedColumns.length} columns, got ${actualColumns.length}`
      );

      // Verify data rows
      assert(lines.length > 1, 'CSV should have data rows');

      // Sample first data row
      const firstDataRow = lines[1].split(',');
      assert(
        firstDataRow.length === expectedColumns.length,
        'Data row should have same number of columns as header'
      );

      console.log(`    ✓ Exported ${(lines.length - 1).toLocaleString()} rows`);
      console.log(`    ✓ File: ${latestFile}`);
      console.log(`    ✓ Valid CSV format with ${actualColumns.length} columns`);
      console.log(`    ✓ UTF-8 with BOM (Excel compatible)`);
    });

    // Test 3: Export whale_leaderboard to JSON
    console.log('\nTest 3: Export whale_leaderboard to JSON with metadata\n');
    await test('Should export all leaderboards to JSON with metadata', async () => {
      // Run export script
      console.log('    Running export-leaderboards-json.ts...');
      execSync('npx tsx scripts/export-leaderboards-json.ts', { stdio: 'pipe' });

      // Verify all three leaderboard files exist
      const leaderboards = ['whale', 'omega', 'roi'];

      for (const lb of leaderboards) {
        const files = readdirSync(exportsDir).filter(f => f.startsWith(`leaderboard_${lb}_`) && f.endsWith('.json'));
        assert(files.length > 0, `No ${lb} leaderboard export found`);

        const latestFile = files.sort().reverse()[0];
        const filepath = resolve(exportsDir, latestFile);

        // Read and parse JSON
        const content = readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content);

        // Verify structure
        assert(data.metadata !== undefined, `${lb} should have metadata`);
        assert(data.leaderboard !== undefined, `${lb} should have leaderboard array`);
        assert(Array.isArray(data.leaderboard), `${lb} leaderboard should be an array`);

        // Verify metadata
        assert(data.metadata.leaderboard_type === lb, `Should be ${lb} leaderboard`);
        assert(data.metadata.total_entries <= 50, 'Should have ≤50 entries');

        // Verify leaderboard entries
        assert(data.leaderboard.length > 0, `${lb} should have entries`);
        assert(data.leaderboard[0].rank === 1, `First entry should have rank 1`);
        assert(data.leaderboard[0].wallet_address !== undefined, 'Entry should have wallet_address');

        console.log(`    ✓ ${lb} leaderboard: ${data.leaderboard.length} entries`);
      }

      console.log(`    ✓ All 3 leaderboards exported successfully`);
    });

    // Test 4: Verify export integrity
    console.log('\nTest 4: Verify export integrity (no NULLs, correct format, UTF-8 encoding)\n');
    await test('Should have valid format, no NULLs in critical fields, correct encoding', async () => {
      // Check JSON wallet metrics
      const jsonFiles = readdirSync(exportsDir).filter(f => f.startsWith('wallet_metrics_') && f.endsWith('.json'));
      const latestJson = jsonFiles.sort().reverse()[0];
      const jsonContent = readFileSync(resolve(exportsDir, latestJson), 'utf-8');
      const jsonData = JSON.parse(jsonContent);

      // Verify no NULLs in sample wallet
      const wallets = Object.keys(jsonData.data);
      const sampleWallet = jsonData.data[wallets[0]];

      Object.keys(sampleWallet).forEach(window => {
        const metrics = sampleWallet[window];
        assert(
          metrics.realized_pnl !== null && metrics.realized_pnl !== undefined,
          `realized_pnl should not be null in ${window}`
        );
        assert(
          metrics.total_trades !== null && metrics.total_trades !== undefined,
          `total_trades should not be null in ${window}`
        );
      });

      console.log(`    ✓ JSON: No NULLs in critical fields`);

      // Check CSV format
      const csvFiles = readdirSync(exportsDir).filter(f => f.startsWith('wallet_metrics_flat_') && f.endsWith('.csv'));
      const latestCsv = csvFiles.sort().reverse()[0];
      const csvContent = readFileSync(resolve(exportsDir, latestCsv), 'utf-8');

      // Verify UTF-8 BOM
      assert(
        csvContent.charCodeAt(0) === 0xFEFF,
        'CSV should have UTF-8 BOM'
      );

      console.log(`    ✓ CSV: UTF-8 with BOM`);

      // Check leaderboard JSON
      const lbFiles = readdirSync(exportsDir).filter(f => f.startsWith('leaderboard_') && f.endsWith('.json'));
      assert(lbFiles.length >= 3, 'Should have at least 3 leaderboard files');

      lbFiles.slice(0, 3).forEach(file => {
        const content = readFileSync(resolve(exportsDir, file), 'utf-8');
        const data = JSON.parse(content);

        // Verify rank sequence
        data.leaderboard.forEach((entry: any, i: number) => {
          assert(
            entry.rank === i + 1,
            `Entry ${i} should have rank ${i + 1}, got ${entry.rank}`
          );
        });
      });

      console.log(`    ✓ Leaderboards: Sequential rankings verified`);
      console.log(`    ✓ All exports have valid format and encoding`);
    });

    // Summary
    console.log('\n' + '═'.repeat(100));
    console.log('TEST RESULTS');
    console.log('═'.repeat(100) + '\n');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach(r => {
      const status = r.passed ? '✓' : '✗';
      console.log(`${status} ${r.name}`);
    });

    console.log(`\n${passed}/${total} tests passed\n`);

    if (passed === total) {
      console.log('✅ ALL TESTS PASSED - Export pipelines ready for production\n');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - Check errors above\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);
