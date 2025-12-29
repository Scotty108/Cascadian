/**
 * Test Universal Split-Need P&L Engine
 *
 * Validate against known wallets:
 * - calibration: -$86 (cash ground truth from deposit/balance)
 * - alexma11224: +$375.59 (Polymarket UI, 2025-12-24)
 * - winner1: +$25,594.96 (Polymarket UI, 2025-12-24)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeUniversalSplitNeedPnl } from '@/lib/pnl/universalSplitNeedPnl';
import { computeEconomicParityPnl } from '@/lib/pnl/economicParityPnl';

const TEST_WALLETS = [
  { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', ui: -86, name: 'calibration' },
  { address: '0x0d0e73b88444c21094421447451e15e9c4f14049', ui: 375.59, name: 'alexma11224' },
  { address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', ui: 25594.96, name: 'winner1' },
];

async function main() {
  console.log('=== UNIVERSAL SPLIT-NEED P&L ENGINE TEST ===\n');
  console.log('Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue');
  console.log('SplitCost = max(required_split across outcomes) per condition');
  console.log('required_split = max(0, sold + redeemed + held - bought)\n');

  const results: Array<{
    name: string;
    ui: number;
    universal: number;
    economicParity: number;
    uniError: number;
    epError: number;
    uniBetter: boolean;
  }> = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${wallet.name.toUpperCase()} (${wallet.address.slice(0, 10)}...)`);
    console.log(`UI Target: $${wallet.ui.toFixed(2)}`);
    console.log('='.repeat(60));

    // Run both engines
    const [uniResult, epResult] = await Promise.all([
      computeUniversalSplitNeedPnl(wallet.address),
      computeEconomicParityPnl(wallet.address),
    ]);

    console.log(`\n[Universal Split-Need Engine]`);
    console.log(`  Buys:        $${uniResult.buys.toFixed(2)}`);
    console.log(`  Sells:       $${uniResult.sells.toFixed(2)}`);
    console.log(`  Redemptions: $${uniResult.redemptions.toFixed(2)}`);
    console.log(`  SplitCost:   $${uniResult.splitCost.toFixed(2)}`);
    console.log(`  HeldValue:   $${uniResult.heldValue.toFixed(2)}`);
    console.log(`  → P&L:       $${uniResult.realizedPnl.toFixed(2)}`);
    console.log(`  Conditions: ${uniResult.conditionsTraded} traded, ${uniResult.conditionsWithSplitNeed} with split need`);
    console.log(`  Resolved: ${uniResult.conditionsResolved}, Open: ${uniResult.conditionsOpen}`);
    console.log(`  Mapping: ${uniResult.mappedTokens}/${uniResult.totalTokens} (${(uniResult.mappingCoveragePct * 100).toFixed(1)}%)`);

    console.log('\n[Economic-Parity Engine (for comparison)]');
    console.log(`  Buys:        $${epResult.buys.toFixed(2)}`);
    console.log(`  Sells:       $${epResult.sells.toFixed(2)}`);
    console.log(`  Redemptions: $${epResult.redemptions.toFixed(2)}`);
    console.log(`  SplitCost:   $${epResult.splitCost.toFixed(2)}`);
    console.log(`  HeldValue:   $${epResult.heldValue.toFixed(2)}`);
    console.log(`  → P&L:       $${epResult.realizedPnl.toFixed(2)}`);

    const uniError = Math.abs(uniResult.realizedPnl - wallet.ui);
    const epError = Math.abs(epResult.realizedPnl - wallet.ui);
    const uniBetter = uniError < epError;

    console.log('\n[Comparison to UI Target]');
    console.log(`  Universal Error:  $${uniError.toFixed(2)} ${uniError < 100 ? '✓' : uniError < 1000 ? '~' : 'X'}`);
    console.log(`  EconParity Error: $${epError.toFixed(2)} ${epError < 100 ? '✓' : epError < 1000 ? '~' : 'X'}`);
    console.log(`  Winner:           ${uniBetter ? 'UNIVERSAL' : 'ECON-PARITY'}`);

    // Show component differences
    console.log('\n[Component Comparison: Universal vs EconParity]');
    console.log(`  SplitCost diff: $${(uniResult.splitCost - epResult.splitCost).toFixed(2)}`);
    console.log(`  Redemption diff: $${(uniResult.redemptions - epResult.redemptions).toFixed(2)}`);
    console.log(`  HeldValue diff: $${(uniResult.heldValue - epResult.heldValue).toFixed(2)}`);

    results.push({
      name: wallet.name,
      ui: wallet.ui,
      universal: uniResult.realizedPnl,
      economicParity: epResult.realizedPnl,
      uniError,
      epError,
      uniBetter,
    });
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('Wallet       | UI P&L      | Universal   | Error   | EconParity  | Error   | Winner');
  console.log('-------------|-------------|-------------|---------|-------------|---------|--------');
  for (const r of results) {
    const uniStatus = r.uniError < 100 ? '✓' : r.uniError < 1000 ? '~' : 'X';
    const epStatus = r.epError < 100 ? '✓' : r.epError < 1000 ? '~' : 'X';
    const winner = r.uniBetter ? 'UNI' : 'EP';
    console.log(
      `${r.name.padEnd(12)} | $${r.ui.toFixed(2).padStart(10)} | $${r.universal.toFixed(2).padStart(10)} | $${r.uniError.toFixed(0).padStart(5)} ${uniStatus} | $${r.economicParity.toFixed(2).padStart(10)} | $${r.epError.toFixed(0).padStart(5)} ${epStatus} | ${winner}`
    );
  }

  const uniWins = results.filter(r => r.uniBetter).length;
  console.log(`\nUniversal wins: ${uniWins}/${results.length}`);

  // Check calibration specifically
  const calibration = results.find(r => r.name === 'calibration');
  if (calibration && calibration.uniError < 5) {
    console.log('\n✓ CALIBRATION ASSERTION PASSED (error < $5)');
  } else {
    console.log('\n✗ CALIBRATION ASSERTION FAILED');
  }
}

main().catch(console.error);
