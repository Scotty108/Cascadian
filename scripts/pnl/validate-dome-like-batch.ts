/**
 * Batch validation: Dome-like realized PnL vs Dome API
 * Tests the formula: dome_like_realized = cash_realized + resolved_unredeemed_winning_value
 *
 * Uses the canonical calculateRealizedDomeLike function from lib/pnl/realizedDomeLikeV1.ts
 */
import fs from 'fs';
import { calculateRealizedDomeLike } from '../../lib/pnl/realizedDomeLikeV1';

interface DomeWallet {
  wallet: string;
  realizedPnl: number;
  confidence?: string;
}

async function main() {
  // Load Dome benchmark
  const domeFile = process.argv[2] || 'tmp/dome_realized_omega_top50_2025_12_07.json';

  if (!fs.existsSync(domeFile)) {
    console.error(`Dome file not found: ${domeFile}`);
    process.exit(1);
  }

  const domeData = JSON.parse(fs.readFileSync(domeFile, 'utf8'));
  const domeWallets: DomeWallet[] = domeData.wallets || [];

  console.log(`\nValidating Dome-like formula against ${domeWallets.length} wallets...`);
  console.log(`Dome file: ${domeFile}\n`);

  const results: any[] = [];
  let pass = 0;
  let fail = 0;

  for (let i = 0; i < domeWallets.length; i++) {
    const dw = domeWallets[i];
    const wallet = dw.wallet.toLowerCase();
    const domeRealized = dw.realizedPnl;

    try {
      const calc = await calculateRealizedDomeLike(wallet);
      const errPct = Math.abs(calc.realized_dome_like - domeRealized) / Math.max(1, Math.abs(domeRealized)) * 100;
      const status = errPct < 6 ? 'PASS' : 'FAIL';

      if (status === 'PASS') pass++;
      else fail++;

      results.push({
        wallet,
        dome_realized: domeRealized,
        our_realized: calc.realized_dome_like,
        cash_realized: calc.cash_realized,
        unredeemed_value: calc.resolved_unredeemed_winning_value,
        winning_positions: calc.winning_positions_held,
        conditions_resolved: calc.total_conditions_resolved,
        error_pct: errPct,
        status
      });

      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${domeWallets.length}] Pass: ${pass}, Fail: ${fail}`);
      }
    } catch (err: any) {
      fail++;
      results.push({
        wallet,
        dome_realized: domeRealized,
        error: err.message,
        status: 'ERROR'
      });
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`DOME-LIKE REALIZED VALIDATION RESULTS`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`\nTotal wallets:  ${domeWallets.length}`);
  console.log(`Passing (<6%):  ${pass} (${(pass / domeWallets.length * 100).toFixed(1)}%)`);
  console.log(`Failing (>=6%): ${fail} (${(fail / domeWallets.length * 100).toFixed(1)}%)`);

  // Show top 10 passes and fails
  const passing = results.filter(r => r.status === 'PASS').sort((a, b) => a.error_pct - b.error_pct);
  const failing = results.filter(r => r.status === 'FAIL').sort((a, b) => b.error_pct - a.error_pct);

  console.log(`\nTop 10 Best Matches:`);
  console.log(`${'─'.repeat(70)}`);
  for (const r of passing.slice(0, 10)) {
    console.log(`  ${r.wallet.slice(0, 10)}... Dome=$${r.dome_realized.toLocaleString()} Ours=$${r.our_realized.toLocaleString()} Err=${r.error_pct.toFixed(2)}%`);
  }

  if (failing.length > 0) {
    console.log(`\nTop 10 Worst Errors:`);
    console.log(`${'─'.repeat(70)}`);
    for (const r of failing.slice(0, 10)) {
      console.log(`  ${r.wallet.slice(0, 10)}... Dome=$${r.dome_realized.toLocaleString()} Ours=$${r.our_realized?.toLocaleString() || 'ERR'} Err=${r.error_pct?.toFixed(2) || 'N/A'}%`);
    }
  }

  // Save results
  const outFile = domeFile.replace('.json', '_validation.json');
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: domeFile,
    summary: { total: domeWallets.length, pass, fail, pass_rate: `${(pass / domeWallets.length * 100).toFixed(1)}%` },
    results
  }, null, 2));
  console.log(`\nWrote: ${outFile}`);
}

main().catch(console.error);
