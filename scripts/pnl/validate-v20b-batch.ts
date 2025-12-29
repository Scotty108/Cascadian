/**
 * V20b Batch Validation Script
 *
 * Tests V20b PnL engine against candidate wallets and outputs validation report.
 * Designed to work without UI scraping for faster iteration.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

interface CandidateWallet {
  wallet_address: string;
  clob_rows: number;
  mapped_clob_rows: number;
  mapping_pct: number;
  markets: number;
}

interface ValidationResult {
  wallet_address: string;
  v20b_total_pnl: number;
  v20b_realized_pnl: number;
  v20b_unrealized_pnl: number;
  positions: number;
  resolved: number;
  clob_rows: number;
  markets: number;
  mapping_pct: number;
  status: 'SUCCESS' | 'ERROR';
  error?: string;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               V20b BATCH VALIDATION                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load candidate wallets
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  const candidates: CandidateWallet[] = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));

  // Take last 30 wallets (smallest in the sorted list ~76K rows each)
  const smallWallets = candidates.slice(-30);
  console.log(`Found ${candidates.length} candidates, testing ${smallWallets.length} smallest wallets (~76K-80K rows each)\n`);

  const results: ValidationResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  console.log('┌────┬──────────────┬────────────────┬────────────────┬──────────┬─────────┐');
  console.log('│ #  │ Wallet       │ Total PnL      │ Realized       │ Pos.     │ Status  │');
  console.log('├────┼──────────────┼────────────────┼────────────────┼──────────┼─────────┤');

  for (let i = 0; i < smallWallets.length; i++) {
    const wallet = smallWallets[i];
    try {
      const pnl = await calculateV20PnL(wallet.wallet_address);

      const pnlStr = pnl.total_pnl >= 0
        ? `+$${pnl.total_pnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`
        : `-$${Math.abs(pnl.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
      const realizedStr = pnl.realized_pnl >= 0
        ? `+$${pnl.realized_pnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`
        : `-$${Math.abs(pnl.realized_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`;

      console.log(
        `│ ${String(i + 1).padStart(2)} │ ${wallet.wallet_address.slice(0, 12)} │ ${pnlStr.padStart(14)} │ ${realizedStr.padStart(14)} │ ${String(pnl.positions).padStart(8)} │ ✅      │`
      );

      results.push({
        wallet_address: wallet.wallet_address,
        v20b_total_pnl: pnl.total_pnl,
        v20b_realized_pnl: pnl.realized_pnl,
        v20b_unrealized_pnl: pnl.unrealized_pnl,
        positions: pnl.positions,
        resolved: pnl.resolved,
        clob_rows: wallet.clob_rows,
        markets: wallet.markets,
        mapping_pct: wallet.mapping_pct,
        status: 'SUCCESS'
      });
      successCount++;
    } catch (e: any) {
      console.log(
        `│ ${String(i + 1).padStart(2)} │ ${wallet.wallet_address.slice(0, 12)} │ ERROR          │                │          │ ❌      │`
      );
      results.push({
        wallet_address: wallet.wallet_address,
        v20b_total_pnl: 0,
        v20b_realized_pnl: 0,
        v20b_unrealized_pnl: 0,
        positions: 0,
        resolved: 0,
        clob_rows: wallet.clob_rows,
        markets: wallet.markets,
        mapping_pct: wallet.mapping_pct,
        status: 'ERROR',
        error: e.message
      });
      errorCount++;
    }
  }

  console.log('└────┴──────────────┴────────────────┴────────────────┴──────────┴─────────┘\n');

  // Summary statistics
  const successful = results.filter(r => r.status === 'SUCCESS');
  const profitable = successful.filter(r => r.v20b_total_pnl > 0);
  const unprofitable = successful.filter(r => r.v20b_total_pnl < 0);

  const totalPnL = successful.reduce((sum, r) => sum + r.v20b_total_pnl, 0);
  const avgPnL = successful.length > 0 ? totalPnL / successful.length : 0;
  const maxProfit = Math.max(...successful.map(r => r.v20b_total_pnl), 0);
  const maxLoss = Math.min(...successful.map(r => r.v20b_total_pnl), 0);

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`  Wallets Tested:     ${results.length}`);
  console.log(`  Successful:         ${successCount} (${((successCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Errors:             ${errorCount}`);
  console.log(`  Profitable:         ${profitable.length} (${((profitable.length / successful.length) * 100).toFixed(1)}%)`);
  console.log(`  Unprofitable:       ${unprofitable.length}`);
  console.log('');
  console.log(`  Total PnL:          ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Average PnL:        ${avgPnL >= 0 ? '+' : ''}$${avgPnL.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Max Profit:         +$${maxProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Max Loss:           -$${Math.abs(maxLoss).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // Top profitable wallets
  const topProfitable = [...successful].sort((a, b) => b.v20b_total_pnl - a.v20b_total_pnl).slice(0, 10);

  console.log('\n🏆 Top 10 Most Profitable (Super Forecasters):');
  console.log('┌────┬──────────────────────────────────────────────┬────────────────┬─────────┐');
  console.log('│ #  │ Wallet                                       │ Total PnL      │ Markets │');
  console.log('├────┼──────────────────────────────────────────────┼────────────────┼─────────┤');
  topProfitable.forEach((r, i) => {
    const pnlStr = `+$${r.v20b_total_pnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    console.log(`│ ${String(i + 1).padStart(2)} │ ${r.wallet_address.padEnd(44)} │ ${pnlStr.padStart(14)} │ ${String(r.markets).padStart(7)} │`);
  });
  console.log('└────┴──────────────────────────────────────────────┴────────────────┴─────────┘');

  // Write results
  const outputPath = path.join(process.cwd(), 'data', 'v20b-batch-validation.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: {
      total: results.length,
      successful: successCount,
      errors: errorCount,
      profitable: profitable.length,
      total_pnl: totalPnL,
      avg_pnl: avgPnL
    },
    results
  }, null, 2));

  console.log(`\n✅ Results written to: ${outputPath}`);
}

main().catch(console.error);
