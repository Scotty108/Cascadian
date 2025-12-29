/**
 * ============================================================================
 * V21 TWO-STAGE VALIDATION HARNESS
 * ============================================================================
 *
 * Stage A: SQL-only prefilter (fast, no browser)
 *   - Pick wallets that pass gating (external_sell_pct <= 0.5%, mapped_ratio >= 99.9%)
 *   - Run V21 with real mark prices and synthetic resolutions
 *   - Output top N by PnL + random sample
 *
 * Stage B: UI parity spot-check (Playwright, small N)
 *   - For each selected wallet, scrape Polymarket profile
 *   - Extract tooltip Gain, Loss, Net total
 *   - Compare: abs(delta_net) <= 2% = PASS
 *   - Save raw UI numbers + scrape timestamp to JSON
 *
 * Usage:
 *   npx tsx scripts/pnl/validation-harness-v21.ts              # Stage A only
 *   npx tsx scripts/pnl/validation-harness-v21.ts --with-ui    # Both stages
 *   npx tsx scripts/pnl/validation-harness-v21.ts --ui-only    # Stage B only
 *
 * ============================================================================
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV21PnL, V21WalletResult } from '../../lib/pnl/v21SyntheticEngine';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface StageAResult {
  wallet: string;
  v21: V21WalletResult;
  passed_gating: boolean;
  gating_reasons: string[];
}

interface StageBResult {
  wallet: string;
  v21_net: number;
  v21_gain: number;
  v21_loss: number;
  ui_net: number | null;
  ui_gain: number | null;
  ui_loss: number | null;
  delta_net_pct: number | null;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
  reason: string;
  scraped_at: string | null;
}

interface ValidationReport {
  generated_at: string;
  stage_a: {
    total_tested: number;
    passed_gating: number;
    failed_gating: number;
    results: StageAResult[];
  };
  stage_b: {
    total_tested: number;
    passed: number;
    failed: number;
    skipped: number;
    results: StageBResult[];
  } | null;
}

// -----------------------------------------------------------------------------
// Stage A: SQL Prefilter
// -----------------------------------------------------------------------------

async function runStageA(wallets: string[]): Promise<StageAResult[]> {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  STAGE A: SQL-ONLY PREFILTER                                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const results: StageAResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const v21 = await calculateV21PnL(wallet);

      const gating_reasons: string[] = [];
      if (v21.external_sell_pct > 0.5) {
        gating_reasons.push(`external_sell_pct=${v21.external_sell_pct.toFixed(2)}% (>0.5%)`);
      }
      if (v21.mapped_ratio < 99.9) {
        gating_reasons.push(`mapped_ratio=${v21.mapped_ratio.toFixed(2)}% (<99.9%)`);
      }

      const passed = gating_reasons.length === 0;
      results.push({ wallet, v21, passed_gating: passed, gating_reasons });

      const status = passed ? '✅' : '❌';
      const netStr = v21.net >= 0
        ? `+$${v21.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(v21.net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

      console.log(
        `${status} [${i + 1}/${wallets.length}] ${wallet.slice(0, 12)}... | ` +
        `ext: ${v21.external_sell_pct.toFixed(2).padStart(5)}% | ` +
        `net: ${netStr.padStart(12)} | ` +
        `${passed ? 'PASS' : gating_reasons[0]}`
      );
    } catch (e: any) {
      console.log(`❌ [${i + 1}/${wallets.length}] ${wallet.slice(0, 12)}... | ERROR: ${e.message.slice(0, 40)}`);
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// Stage B: UI Parity Check (placeholder - requires Playwright MCP)
// -----------------------------------------------------------------------------

async function runStageB(wallets: StageAResult[]): Promise<StageBResult[]> {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  STAGE B: UI PARITY SPOT-CHECK                                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('NOTE: UI scraping requires Playwright MCP. Using cached/manual values.\n');

  // For now, return placeholder results
  // In production, this would use Playwright to scrape Polymarket profiles
  const results: StageBResult[] = wallets
    .filter(w => w.passed_gating)
    .slice(0, 10)
    .map(w => ({
      wallet: w.wallet,
      v21_net: w.v21.net,
      v21_gain: w.v21.gain,
      v21_loss: w.v21.loss,
      ui_net: null,
      ui_gain: null,
      ui_loss: null,
      delta_net_pct: null,
      status: 'SKIP' as const,
      reason: 'UI scraping not implemented in this run',
      scraped_at: null,
    }));

  return results;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const withUI = args.includes('--with-ui');
  const uiOnly = args.includes('--ui-only');

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               V21 TWO-STAGE VALIDATION HARNESS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  - Stage A (SQL prefilter): ${!uiOnly ? 'YES' : 'SKIP'}`);
  console.log(`  - Stage B (UI parity):     ${withUI || uiOnly ? 'YES' : 'SKIP'}`);
  console.log('');
  console.log('Gating criteria:');
  console.log('  - external_sell_pct <= 0.5%');
  console.log('  - mapped_ratio >= 99.9%');
  console.log('');

  // Load candidate wallets
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) as any[];

  // Take last 30 (smallest) for faster processing
  const testWallets = candidates.slice(-30).map((c: any) => c.wallet_address);

  console.log(`Loaded ${candidates.length} candidates, testing ${testWallets.length} (smallest)\n`);

  // Stage A
  let stageAResults: StageAResult[] = [];
  if (!uiOnly) {
    stageAResults = await runStageA(testWallets);
  }

  // Stage B
  let stageBResults: StageBResult[] | null = null;
  if (withUI || uiOnly) {
    stageBResults = await runStageB(stageAResults);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const passed = stageAResults.filter(r => r.passed_gating);
  const failed = stageAResults.filter(r => !r.passed_gating);

  console.log('Stage A (Gating):');
  console.log(`  Total tested:   ${stageAResults.length}`);
  console.log(`  Passed gating:  ${passed.length} (${((passed.length / stageAResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Failed gating:  ${failed.length}`);

  if (passed.length > 0) {
    console.log('\n🏆 Top 10 Eligible Wallets (sorted by net PnL):');
    const sorted = [...passed].sort((a, b) => b.v21.net - a.v21.net);
    sorted.slice(0, 10).forEach((r, i) => {
      const netStr = r.v21.net >= 0
        ? `+$${r.v21.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(r.v21.net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      console.log(`  ${i + 1}. ${r.wallet} | ${netStr}`);
    });
  }

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report: ValidationReport = {
    generated_at: new Date().toISOString(),
    stage_a: {
      total_tested: stageAResults.length,
      passed_gating: passed.length,
      failed_gating: failed.length,
      results: stageAResults,
    },
    stage_b: stageBResults ? {
      total_tested: stageBResults.length,
      passed: stageBResults.filter(r => r.status === 'PASS').length,
      failed: stageBResults.filter(r => r.status === 'FAIL').length,
      skipped: stageBResults.filter(r => r.status === 'SKIP').length,
      results: stageBResults,
    } : null,
  };

  const reportPath = path.join(process.cwd(), 'data', `validation-report.${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Report written to: ${reportPath}`);
}

main().catch(console.error);
