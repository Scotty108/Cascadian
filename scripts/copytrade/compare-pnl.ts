/**
 * Compare Cash vs UI P&L for one or more wallets.
 *
 * Usage:
 *   npx tsx scripts/copytrade/compare-pnl.ts <wallet1> <wallet2> ...
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeLedgerV2Pnl } from '@/lib/pnl/ledgerV2';
import { computeUiParityPnl } from '@/lib/pnl/uiParityPnl';

const wallets = process.argv.slice(2);
if (wallets.length === 0) {
  console.error('Usage: npx tsx scripts/copytrade/compare-pnl.ts <wallet1> <wallet2> ...');
  process.exit(1);
}

async function main() {
  console.log('=== CASH vs UI P&L COMPARISON ===\n');
  for (const w of wallets) {
    const wallet = w.toLowerCase();
    const [cash, ui] = await Promise.all([
      computeLedgerV2Pnl(wallet),
      computeUiParityPnl(wallet),
    ]);

    console.log(`Wallet: ${wallet}`);
    console.log(`  Cash P&L: $${cash.realizedPnl.toFixed(2)}`);
    console.log(`    Buys: -$${cash.buys.toFixed(2)} | Sells: +$${cash.sells.toFixed(2)} | SplitCost: -$${cash.splitCost.toFixed(2)}`);
    console.log(`    Redemptions: +$${cash.redemptions.toFixed(2)} | HeldValue: +$${cash.heldValue.toFixed(2)}`);
    console.log(`    Mapping: ${cash.mappedTokens}/${cash.totalTokens} (${(cash.mappingCoveragePct * 100).toFixed(1)}%)`);

    console.log(`  UI P&L:   $${ui.realizedPnl.toFixed(2)}`);
    console.log(`    Volume: $${ui.volume.toFixed(2)} | Positions: ${ui.positionCount}`);
    console.log(
      `    Mapping gaps: events=${ui.gapStats.unmapped_event_count}, ` +
        `conditions=${ui.gapStats.unmapped_condition_count}, ` +
        `skipped_usdc=$${ui.gapStats.skipped_usdc_abs.toFixed(2)}`
    );
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
