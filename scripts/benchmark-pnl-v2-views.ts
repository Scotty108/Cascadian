#!/usr/bin/env tsx
/**
 * Benchmark PnL V2 Views
 *
 * Performance testing for vw_wallet_leaderboard_v2 and vw_wallet_positions_v2
 *
 * Targets:
 * - Leaderboard queries: < 200ms
 * - Wallet position queries: < 50ms
 *
 * Output: reports/pnl_v2_view_benchmark.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkResult {
  query_name: string;
  query_sql: string;
  row_count: number;
  execution_time_ms: number;
  target_ms: number;
  passed: boolean;
}

interface BenchmarkReport {
  timestamp: string;
  summary: {
    total_queries: number;
    passed: number;
    failed: number;
    avg_execution_time_ms: number;
  };
  results: BenchmarkResult[];
}

async function runBenchmark(
  name: string,
  query: string,
  targetMs: number
): Promise<BenchmarkResult> {
  console.log(`\n⏱️  Running: ${name}`);
  console.log('-'.repeat(80));

  const startTime = Date.now();
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json();
  const executionTime = Date.now() - startTime;

  const rowCount = rows.length;
  const passed = executionTime <= targetMs;

  console.log(`  Rows returned:    ${rowCount.toLocaleString()}`);
  console.log(`  Execution time:   ${executionTime} ms`);
  console.log(`  Target:           ${targetMs} ms`);
  console.log(`  Status:           ${passed ? '✅ PASSED' : '⚠️  EXCEEDED TARGET'}`);

  return {
    query_name: name,
    query_sql: query,
    row_count: rowCount,
    execution_time_ms: executionTime,
    target_ms: targetMs,
    passed,
  };
}

async function main() {
  console.log('🎯 PnL V2 View Performance Benchmark');
  console.log('='.repeat(80));
  console.log('Testing vw_wallet_leaderboard_v2 and vw_wallet_positions_v2');
  console.log('');

  const results: BenchmarkResult[] = [];

  // ============================================================================
  // 1. Leaderboard: Top 100 by total P&L
  // ============================================================================
  const leaderboardByPnLQuery = `
    SELECT *
    FROM vw_wallet_leaderboard_v2
    ORDER BY total_pnl_usd DESC
    LIMIT 100
  `;

  results.push(
    await runBenchmark(
      'Leaderboard: Top 100 by total_pnl_usd',
      leaderboardByPnLQuery,
      200
    )
  );

  // ============================================================================
  // 2. Leaderboard: Top 100 by volume
  // ============================================================================
  const leaderboardByVolumeQuery = `
    SELECT *
    FROM vw_wallet_leaderboard_v2
    ORDER BY total_volume_usd DESC
    LIMIT 100
  `;

  results.push(
    await runBenchmark(
      'Leaderboard: Top 100 by total_volume_usd',
      leaderboardByVolumeQuery,
      200
    )
  );

  // ============================================================================
  // 3. Get sample wallets for position queries
  // ============================================================================
  console.log('\n\n📊 Finding sample wallets for position queries...');
  console.log('-'.repeat(80));

  const topVolumeQuery = `
    SELECT wallet_address, total_volume_usd
    FROM vw_wallet_leaderboard_v2
    ORDER BY total_volume_usd DESC
    LIMIT 2
  `;

  const topVolumeResult = await clickhouse.query({
    query: topVolumeQuery,
    format: 'JSONEachRow',
  });
  const topVolumeWallets = (await topVolumeResult.json()) as any[];

  const sampleWallets = [
    { address: '0xcnstrategy', label: 'xcnstrategy (control wallet)' },
    {
      address: topVolumeWallets[0].wallet_address,
      label: `Top volume wallet #1 ($${parseFloat(topVolumeWallets[0].total_volume_usd).toFixed(0)})`,
    },
    {
      address: topVolumeWallets[1].wallet_address,
      label: `Top volume wallet #2 ($${parseFloat(topVolumeWallets[1].total_volume_usd).toFixed(0)})`,
    },
  ];

  console.log('Sample wallets:');
  for (const wallet of sampleWallets) {
    console.log(`  - ${wallet.address.slice(0, 10)}... (${wallet.label})`);
  }

  // ============================================================================
  // 4. Wallet positions queries
  // ============================================================================
  for (const wallet of sampleWallets) {
    const positionsQuery = `
      SELECT *
      FROM vw_wallet_positions_v2
      WHERE wallet_address = '${wallet.address}'
      ORDER BY abs(total_pnl_usd) DESC
    `;

    results.push(
      await runBenchmark(
        `Wallet Positions: ${wallet.label}`,
        positionsQuery,
        50
      )
    );
  }

  // ============================================================================
  // 5. Generate report
  // ============================================================================
  console.log('\n\n📊 Benchmark Summary');
  console.log('='.repeat(80));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const avgExecutionTime =
    results.reduce((sum, r) => sum + r.execution_time_ms, 0) / results.length;

  console.log(`Total queries:        ${results.length}`);
  console.log(`Passed:               ${passed} ✅`);
  console.log(`Exceeded target:      ${failed} ⚠️`);
  console.log(`Avg execution time:   ${avgExecutionTime.toFixed(2)} ms`);

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total_queries: results.length,
      passed,
      failed,
      avg_execution_time_ms: parseFloat(avgExecutionTime.toFixed(2)),
    },
    results,
  };

  // ============================================================================
  // 6. Write report to file
  // ============================================================================
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, 'pnl_v2_view_benchmark.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('');
  console.log(`Report written to: ${reportPath}`);
  console.log('');

  // ============================================================================
  // 7. Final status
  // ============================================================================
  console.log('='.repeat(80));
  if (failed === 0) {
    console.log('✅ ALL BENCHMARKS PASSED');
  } else {
    console.log('⚠️  SOME BENCHMARKS EXCEEDED TARGET');
    console.log('');
    console.log('Queries that exceeded target:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.query_name}: ${result.execution_time_ms} ms (target: ${result.target_ms} ms)`);
    }
  }
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
