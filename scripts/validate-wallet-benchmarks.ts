#!/usr/bin/env npx tsx
/**
 * Validate Wallet Benchmarks
 *
 * Compares 14 benchmark wallets against rebuilt wallet_metrics/trade_cashflows_v3
 * to ensure P&L fix generalizes across diverse wallet profiles.
 *
 * Outputs:
 * - tmp/wallet-benchmark-results.json (machine-readable)
 * - Console Markdown summary (for session report)
 *
 * Tolerance: $2,000 absolute delta on any metric
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';
import { writeFileSync, mkdirSync } from 'fs';

const TOLERANCE_USD = 2000; // $2K tolerance

interface BenchmarkTarget {
  wallet: string;
  target_net_pnl: number;
  target_total_gains: number;
  target_total_losses: number;
}

interface ValidationResult {
  wallet: string;
  target_net_pnl: number;
  actual_net_pnl: number;
  delta_net_pnl: number;
  target_total_gains: number;
  actual_total_gains: number;
  delta_total_gains: number;
  target_total_losses: number;
  actual_total_losses: number;
  delta_total_losses: number;
  status: 'PASS' | 'FAIL';
  failed_metrics: string[];
}

// 14 benchmark wallets from docs/mg_wallet_baselines.md
const BENCHMARKS: BenchmarkTarget[] = [
  { wallet: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', target_net_pnl: 135153, target_total_gains: 174150, target_total_losses: 38997 },
  { wallet: '0x662244931c392df70bd064fa91f838eea0bfd7a9', target_net_pnl: 131523, target_total_gains: 169515, target_total_losses: 37992 },
  { wallet: '0x2e0b70d482e6b389e81dea528be57d825dd48070', target_net_pnl: 152389, target_total_gains: 199729, target_total_losses: 47340 },
  { wallet: '0x3b6fd06a595d71c70afb3f44414be1c11304340b', target_net_pnl: 158864, target_total_gains: 210183, target_total_losses: 51319 },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', target_net_pnl: 142856, target_total_gains: 198982, target_total_losses: 56126 },
  { wallet: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', target_net_pnl: 101164, target_total_gains: 142036, target_total_losses: 40872 },
  { wallet: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', target_net_pnl: 168621, target_total_gains: 237653, target_total_losses: 69032 },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', target_net_pnl: 93181, target_total_gains: 132970, target_total_losses: 39789 },
  { wallet: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', target_net_pnl: 124705, target_total_gains: 189535, target_total_losses: 64830 },
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', target_net_pnl: 179243, target_total_gains: 179527, target_total_losses: 284 },
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', target_net_pnl: 137663, target_total_gains: 145976, target_total_losses: 8313 },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', target_net_pnl: 360492, target_total_gains: 366546, target_total_losses: 6054 },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', target_net_pnl: 94730, target_total_gains: 205410, target_total_losses: 110680 },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', target_net_pnl: 12171, target_total_gains: 16715, target_total_losses: 4544 }
];

async function main() {
  const ch = getClickHouseClient();
  const results: ValidationResult[] = [];
  const startTime = Date.now();

  console.log('\n' + '═'.repeat(100));
  console.log('WALLET BENCHMARK VALIDATION');
  console.log('═'.repeat(100));
  console.log(`\nValidating ${BENCHMARKS.length} benchmark wallets against rebuilt wallet_metrics...`);
  console.log(`Tolerance: ±$${TOLERANCE_USD.toLocaleString()} on any metric\n`);

  try {
    for (const benchmark of BENCHMARKS) {
      const query = `
        SELECT
          sum(toFloat64(cashflow_usdc)) as net_pnl,
          sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as total_gains,
          abs(sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0)) as total_losses
        FROM default.trade_cashflows_v3
        WHERE lower(wallet) = '${benchmark.wallet}'
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();

      if (data.length === 0 || !data[0].net_pnl) {
        // Wallet not found in trade_cashflows_v3
        results.push({
          wallet: benchmark.wallet,
          target_net_pnl: benchmark.target_net_pnl,
          actual_net_pnl: 0,
          delta_net_pnl: -benchmark.target_net_pnl,
          target_total_gains: benchmark.target_total_gains,
          actual_total_gains: 0,
          delta_total_gains: -benchmark.target_total_gains,
          target_total_losses: benchmark.target_total_losses,
          actual_total_losses: 0,
          delta_total_losses: -benchmark.target_total_losses,
          status: 'FAIL',
          failed_metrics: ['net_pnl', 'total_gains', 'total_losses']
        });
        continue;
      }

      const actual_net_pnl = parseFloat(data[0].net_pnl);
      const actual_total_gains = parseFloat(data[0].total_gains);
      const actual_total_losses = parseFloat(data[0].total_losses);

      const delta_net_pnl = actual_net_pnl - benchmark.target_net_pnl;
      const delta_total_gains = actual_total_gains - benchmark.target_total_gains;
      const delta_total_losses = actual_total_losses - benchmark.target_total_losses;

      const failed_metrics: string[] = [];
      if (Math.abs(delta_net_pnl) > TOLERANCE_USD) failed_metrics.push('net_pnl');
      if (Math.abs(delta_total_gains) > TOLERANCE_USD) failed_metrics.push('total_gains');
      if (Math.abs(delta_total_losses) > TOLERANCE_USD) failed_metrics.push('total_losses');

      const status = failed_metrics.length === 0 ? 'PASS' : 'FAIL';

      results.push({
        wallet: benchmark.wallet,
        target_net_pnl: benchmark.target_net_pnl,
        actual_net_pnl,
        delta_net_pnl,
        target_total_gains: benchmark.target_total_gains,
        actual_total_gains,
        delta_total_gains,
        target_total_losses: benchmark.target_total_losses,
        actual_total_losses,
        delta_total_losses,
        status,
        failed_metrics
      });
    }

    // Summary stats
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Save JSON results
    mkdirSync('tmp', { recursive: true });
    writeFileSync(
      'tmp/wallet-benchmark-results.json',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        tolerance_usd: TOLERANCE_USD,
        total_wallets: BENCHMARKS.length,
        passed: passCount,
        failed: failCount,
        elapsed_seconds: elapsed,
        results
      }, null, 2)
    );

    // Print Markdown summary
    console.log('═'.repeat(100));
    console.log('RESULTS SUMMARY');
    console.log('═'.repeat(100) + '\n');

    console.log(`**Total Wallets:** ${BENCHMARKS.length}`);
    console.log(`**Passed:** ${passCount} ✅`);
    console.log(`**Failed:** ${failCount} ${failCount > 0 ? '❌' : '✅'}`);
    console.log(`**Elapsed:** ${elapsed}s\n`);

    console.log('## Detailed Results\n');
    console.log('| Wallet | Net P&L | Total Gains | Total Losses | Status |');
    console.log('|--------|---------|-------------|--------------|--------|');

    for (const r of results) {
      const shortWallet = r.wallet.substring(0, 10) + '...';
      const netStatus = Math.abs(r.delta_net_pnl) <= TOLERANCE_USD ? '✅' : `❌ ${r.delta_net_pnl > 0 ? '+' : ''}$${Math.round(r.delta_net_pnl).toLocaleString()}`;
      const gainsStatus = Math.abs(r.delta_total_gains) <= TOLERANCE_USD ? '✅' : `❌ ${r.delta_total_gains > 0 ? '+' : ''}$${Math.round(r.delta_total_gains).toLocaleString()}`;
      const lossesStatus = Math.abs(r.delta_total_losses) <= TOLERANCE_USD ? '✅' : `❌ ${r.delta_total_losses > 0 ? '+' : ''}$${Math.round(r.delta_total_losses).toLocaleString()}`;
      const overallStatus = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';

      console.log(`| ${shortWallet} | ${netStatus} | ${gainsStatus} | ${lossesStatus} | ${overallStatus} |`);
    }

    console.log('\n## Failed Wallets (if any)\n');
    const failed = results.filter(r => r.status === 'FAIL');
    if (failed.length > 0) {
      for (const f of failed) {
        console.log(`**${f.wallet}**`);
        console.log(`- Net P&L: Target $${f.target_net_pnl.toLocaleString()}, Actual $${Math.round(f.actual_net_pnl).toLocaleString()}, Delta $${Math.round(f.delta_net_pnl).toLocaleString()}`);
        console.log(`- Total Gains: Target $${f.target_total_gains.toLocaleString()}, Actual $${Math.round(f.actual_total_gains).toLocaleString()}, Delta $${Math.round(f.delta_total_gains).toLocaleString()}`);
        console.log(`- Total Losses: Target $${f.target_total_losses.toLocaleString()}, Actual $${Math.round(f.actual_total_losses).toLocaleString()}, Delta $${Math.round(f.delta_total_losses).toLocaleString()}`);
        console.log(`- Failed Metrics: ${f.failed_metrics.join(', ')}\n`);
      }
    } else {
      console.log('_No wallets failed validation._ ✅\n');
    }

    console.log('═'.repeat(100));
    console.log('VALIDATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Results saved to: tmp/wallet-benchmark-results.json`);
    console.log(`${failCount > 0 ? '⚠️' : '✅'} Overall Status: ${failCount === 0 ? 'ALL PASS' : `${failCount} FAILURES - REVIEW REQUIRED`}\n`);

    if (failCount > 0) {
      console.log('🚨 ACTION REQUIRED: Investigate failed wallets before proceeding with publication.\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
