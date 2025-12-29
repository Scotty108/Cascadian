/**
 * Test Condition-Deficit P&L Engine v3
 *
 * Validate against known ground truth wallets:
 * - calibration: -$86 (splitter/arbitrage pattern)
 * - alexma11224: $268 (buyer pattern)
 * - winner1: $31,167 (big winner)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeConditionDeficitPnl } from '@/lib/pnl/conditionDeficitPnl';
import { computeEconomicParityPnl } from '@/lib/pnl/economicParityPnl';

const TEST_WALLETS = [
  { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', ui: -86, name: 'calibration' },
  { address: '0x0d0e73b88444c21094421447451e15e9c4f14049', ui: 268.21, name: 'alexma11224' },
  { address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', ui: 31167.77, name: 'winner1' },
];

async function main() {
  console.log('=== CONDITION-DEFICIT P&L ENGINE v3 TEST ===\n');
  console.log('Pattern-based split attribution:');
  console.log('  SELLER (balance < -100): Full split cost');
  console.log('  BUYER (balance > 100): No split cost');
  console.log('  MIXED: Deficit-based\n');

  const results: Array<{
    name: string;
    pattern: string;
    tokenBalance: number;
    ui: number;
    conditionDeficit: number;
    economicParity: number;
    cdError: number;
    epError: number;
    cdBetter: boolean;
  }> = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`\n--- ${wallet.name.toUpperCase()} (${wallet.address.slice(0, 10)}...) ---`);
    console.log(`UI Target: $${wallet.ui.toFixed(2)}`);

    // Run both engines
    const [cdResult, epResult] = await Promise.all([
      computeConditionDeficitPnl(wallet.address),
      computeEconomicParityPnl(wallet.address),
    ]);

    console.log(`\n[Condition-Deficit Engine v3]`);
    console.log(`  Pattern:     ${cdResult.pattern} (token balance: ${cdResult.tokenBalance.toFixed(0)})`);
    console.log(`  Buys:        $${cdResult.buys.toFixed(2)}`);
    console.log(`  Sells:       $${cdResult.sells.toFixed(2)}`);
    console.log(`  Redemptions: $${cdResult.redemptions.toFixed(2)}`);
    console.log(`  SplitCost:   $${cdResult.splitCostAttributed.toFixed(2)} (available: $${cdResult.splitCostAvailable.toFixed(2)})`);
    console.log(`  HeldValue:   $${cdResult.heldValue.toFixed(2)}`);
    console.log(`  → P&L:       $${cdResult.realizedPnl.toFixed(2)}`);
    console.log(`  Tokens: ${cdResult.tokensWithDeficit} deficit, ${cdResult.tokensWithSurplus} surplus, ${cdResult.openPositions} open`);
    console.log(`  Mapping: ${cdResult.mappedTokens}/${cdResult.totalTokens} (${(cdResult.mappingCoveragePct * 100).toFixed(1)}%)`);

    console.log('\n[Economic-Parity Engine]');
    console.log(`  Buys:        $${epResult.buys.toFixed(2)}`);
    console.log(`  Sells:       $${epResult.sells.toFixed(2)}`);
    console.log(`  Redemptions: $${epResult.redemptions.toFixed(2)}`);
    console.log(`  SplitCost:   $${epResult.splitCost.toFixed(2)}`);
    console.log(`  HeldValue:   $${epResult.heldValue.toFixed(2)}`);
    console.log(`  → P&L:       $${epResult.realizedPnl.toFixed(2)}`);

    const cdError = Math.abs(cdResult.realizedPnl - wallet.ui);
    const epError = Math.abs(epResult.realizedPnl - wallet.ui);
    const cdBetter = cdError < epError;

    console.log('\n[Comparison]');
    console.log(`  CD Error: $${cdError.toFixed(2)} ${cdError < 100 ? '✓' : 'X'}`);
    console.log(`  EP Error: $${epError.toFixed(2)} ${epError < 100 ? '✓' : 'X'}`);
    console.log(`  Winner:   ${cdBetter ? 'Condition-Deficit' : 'Economic-Parity'}`);

    results.push({
      name: wallet.name,
      pattern: cdResult.pattern,
      tokenBalance: cdResult.tokenBalance,
      ui: wallet.ui,
      conditionDeficit: cdResult.realizedPnl,
      economicParity: epResult.realizedPnl,
      cdError,
      epError,
      cdBetter,
    });
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Wallet       | Pattern | Balance   | UI P&L      | CD P&L      | Error   | EP P&L      | Error   | Winner');
  console.log('-------------|---------|-----------|-------------|-------------|---------|-------------|---------|-------');
  for (const r of results) {
    const cdStatus = r.cdError < 100 ? '✓' : 'X';
    const epStatus = r.epError < 100 ? '✓' : 'X';
    const winner = r.cdBetter ? 'CD' : 'EP';
    console.log(
      `${r.name.padEnd(12)} | ${r.pattern.padEnd(7)} | ${r.tokenBalance.toFixed(0).padStart(9)} | $${r.ui.toFixed(2).padStart(10)} | $${r.conditionDeficit.toFixed(2).padStart(10)} | $${r.cdError.toFixed(0).padStart(5)} ${cdStatus} | $${r.economicParity.toFixed(2).padStart(10)} | $${r.epError.toFixed(0).padStart(5)} ${epStatus} | ${winner}`
    );
  }

  const cdWins = results.filter(r => r.cdBetter).length;
  const epWins = results.length - cdWins;
  console.log(`\nOverall: Condition-Deficit wins ${cdWins}/${results.length}, Economic-Parity wins ${epWins}/${results.length}`);
}

main().catch(console.error);
