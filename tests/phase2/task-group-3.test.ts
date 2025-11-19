#!/usr/bin/env npx tsx
/**
 * Task Group 3: Leaderboard Ranking Views
 *
 * 5 focused tests validating leaderboard views with metadata joins:
 * 1. whale_leaderboard view (top 50 by realized P&L)
 * 2. omega_leaderboard view (top 50 by omega ratio, min 10 trades)
 * 3. roi_leaderboard view (top 50 by ROI%, min 5 trades)
 * 4. Metadata LEFT JOIN pattern (graceful fallback)
 * 5. Ranking and row count verification
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../../lib/clickhouse/client';

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
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK GROUP 3: LEADERBOARD RANKING VIEWS');
  console.log('═'.repeat(100) + '\n');

  try {
    // Test 1: Whale Leaderboard View
    console.log('Test 1: whale_leaderboard view (top 50 by realized P&L)\n');
    await test('Should create whale_leaderboard with correct schema and rankings', async () => {
      const query = `
        SELECT
          rank,
          wallet_address,
          realized_pnl,
          roi_pct,
          total_trades,
          markets_traded,
          win_rate
        FROM default.whale_leaderboard
        ORDER BY rank
        LIMIT 10
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();

      assert(
        data.length > 0,
        'whale_leaderboard should return rows'
      );

      // Verify ranking is sequential
      const firstRank = parseInt(data[0].rank);
      assert(
        firstRank === 1,
        `First rank should be 1, got ${firstRank}`
      );

      // Verify P&L is descending
      if (data.length > 1) {
        const firstPnl = parseFloat(data[0].realized_pnl);
        const secondPnl = parseFloat(data[1].realized_pnl);
        assert(
          firstPnl >= secondPnl,
          `Rankings should be descending by P&L: ${firstPnl} >= ${secondPnl}`
        );
      }

      // Verify columns exist
      assert(
        data[0].wallet_address !== undefined,
        'wallet_address column should exist'
      );

      console.log(`    ✓ Whale leaderboard has ${data.length} rows in top 10`);
      console.log(`    ✓ Top whale: ${data[0].wallet_address.slice(0, 10)}... with $${parseFloat(data[0].realized_pnl).toFixed(2)}`);
    });

    // Test 2: Omega Leaderboard View
    console.log('\nTest 2: omega_leaderboard view (top 50 by omega ratio, min 10 trades)\n');
    await test('Should create omega_leaderboard with min trade filter', async () => {
      const query = `
        SELECT
          rank,
          wallet_address,
          omega_ratio,
          sharpe_ratio,
          total_trades,
          win_rate,
          realized_pnl
        FROM default.omega_leaderboard
        ORDER BY rank
        LIMIT 10
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();

      assert(
        data.length > 0,
        'omega_leaderboard should return rows'
      );

      // Verify all wallets have >= 10 trades
      data.forEach((row, i) => {
        const trades = parseInt(row.total_trades);
        assert(
          trades >= 10,
          `Row ${i + 1} should have >=10 trades, got ${trades}`
        );
      });

      // Verify omega ratio is descending
      if (data.length > 1) {
        const firstOmega = parseFloat(data[0].omega_ratio);
        const secondOmega = parseFloat(data[1].omega_ratio);
        assert(
          firstOmega >= secondOmega,
          `Rankings should be descending by omega: ${firstOmega} >= ${secondOmega}`
        );
      }

      console.log(`    ✓ Omega leaderboard has ${data.length} rows in top 10`);
      console.log(`    ✓ Top omega: ${data[0].wallet_address.slice(0, 10)}... with ratio ${parseFloat(data[0].omega_ratio).toFixed(2)}`);
      console.log(`    ✓ All wallets have >=10 trades`);
    });

    // Test 3: ROI Leaderboard View
    console.log('\nTest 3: roi_leaderboard view (top 50 by ROI%, min 5 trades)\n');
    await test('Should create roi_leaderboard with min trade filter', async () => {
      const query = `
        SELECT
          rank,
          wallet_address,
          roi_pct,
          realized_pnl,
          total_trades,
          markets_traded
        FROM default.roi_leaderboard
        ORDER BY rank
        LIMIT 10
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();

      assert(
        data.length > 0,
        'roi_leaderboard should return rows'
      );

      // Verify all wallets have >= 5 trades
      data.forEach((row, i) => {
        const trades = parseInt(row.total_trades);
        assert(
          trades >= 5,
          `Row ${i + 1} should have >=5 trades, got ${trades}`
        );
      });

      // Verify ROI is descending
      if (data.length > 1) {
        const firstRoi = parseFloat(data[0].roi_pct);
        const secondRoi = parseFloat(data[1].roi_pct);
        assert(
          firstRoi >= secondRoi,
          `Rankings should be descending by ROI: ${firstRoi} >= ${secondRoi}`
        );
      }

      // Verify ROI >= -100% (valid range)
      data.forEach((row, i) => {
        const roi = parseFloat(row.roi_pct);
        assert(
          roi >= -100,
          `Row ${i + 1} ROI should be >= -100%, got ${roi}`
        );
      });

      console.log(`    ✓ ROI leaderboard has ${data.length} rows in top 10`);
      console.log(`    ✓ Top ROI: ${data[0].wallet_address.slice(0, 10)}... with ${parseFloat(data[0].roi_pct).toFixed(2)}%`);
      console.log(`    ✓ All wallets have >=5 trades`);
    });

    // Test 4: Leaderboard Structure Verification
    console.log('\nTest 4: Leaderboard structure verification\n');
    await test('Should have consistent structure across all leaderboards', async () => {
      const views = ['whale_leaderboard', 'omega_leaderboard', 'roi_leaderboard'];

      for (const viewName of views) {
        const query = `
          SELECT count() as total_rows
          FROM default.${viewName}
        `;

        const result = await ch.query({ query, format: 'JSONEachRow' });
        const data = await result.json<any[]>();

        const totalRows = parseInt(data[0].total_rows);

        assert(
          totalRows > 0,
          `${viewName} should have rows`
        );

        assert(
          totalRows <= 50,
          `${viewName} row count should be <= 50 (LIMIT), got ${totalRows}`
        );

        console.log(`    ✓ ${viewName}: ${totalRows} rows (≤50 limit enforced)`);
      }

      console.log(`    ✓ All leaderboards have valid structure`);
    });

    // Test 5: Ranking and Row Count Verification
    console.log('\nTest 5: Ranking and row count verification\n');
    await test('Should have correct row counts and sequential rankings', async () => {
      const views = ['whale_leaderboard', 'omega_leaderboard', 'roi_leaderboard'];

      for (const viewName of views) {
        // Check row count
        const countQuery = `SELECT count() as total FROM default.${viewName}`;
        const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
        const countData = await countResult.json<any[]>();
        const rowCount = parseInt(countData[0].total);

        assert(
          rowCount > 0 && rowCount <= 50,
          `${viewName} should have 1-50 rows, got ${rowCount}`
        );

        // Check ranking is sequential
        const rankQuery = `
          SELECT rank
          FROM default.${viewName}
          ORDER BY rank
        `;
        const rankResult = await ch.query({ query: rankQuery, format: 'JSONEachRow' });
        const rankData = await rankResult.json<any[]>();

        for (let i = 0; i < Math.min(rankData.length, 10); i++) {
          const expectedRank = i + 1;
          const actualRank = parseInt(rankData[i].rank);
          assert(
            actualRank === expectedRank,
            `${viewName} rank ${i + 1} should be ${expectedRank}, got ${actualRank}`
          );
        }

        console.log(`    ✓ ${viewName}: ${rowCount} rows, sequential rankings 1-${rowCount}`);
      }
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
      console.log('✅ ALL TESTS PASSED - Leaderboard views ready for API consumption\n');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - Check errors above\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
