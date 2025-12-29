/**
 * Polymarket P&L Calculator
 *
 * Supports two metrics:
 * - cash: sequential ledger w/ implicit splits (cash parity)
 * - ui: subgraph avg-cost (UI parity)
 *
 * Usage:
 *   npx tsx scripts/copytrade/polymarket-style-pnl.ts <wallet_address> --metric=cash
 *   npx tsx scripts/copytrade/polymarket-style-pnl.ts <wallet_address> --metric=ui
 *   npx tsx scripts/copytrade/polymarket-style-pnl.ts <wallet_address> --metric=both
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeLedgerV2Pnl } from '@/lib/pnl/ledgerV2';
import { computeUiParityPnl } from '@/lib/pnl/uiParityPnl';

const WALLET = process.argv[2]?.toLowerCase() || '0x0d2ea4f8d00f92e280b107e3c87f9dc9b05cf1a2';
const METRIC =
  process.argv.find((a) => a.startsWith('--metric='))?.split('=')[1] || 'cash';
const SHOW_BOTH = METRIC === 'both';

async function main() {
  console.log('=== POLYMARKET P&L CALCULATION ===');
  console.log(`Wallet: ${WALLET}`);
  const wantCash = METRIC === 'cash' || SHOW_BOTH;
  const wantUi = METRIC === 'ui' || SHOW_BOTH;

  if (wantCash) {
    const cash = await computeLedgerV2Pnl(WALLET);
    console.log('\n--- CASH PARITY (LEDGER) ---');
    console.log(`Trades: ${cash.trades}`);
    console.log(`Net token balance: ${cash.netTokenBalance.toFixed(2)} (${cash.isNetBuyer ? 'BUYER' : 'SELLER'})`);
    console.log(`Mapped tokens: ${cash.mappedTokens}/${cash.totalTokens} (${(cash.mappingCoveragePct * 100).toFixed(1)}%)`);
    console.log(`Open positions (unresolved): ${cash.openPositions}`);
    console.log('\nP&L COMPONENTS');
    console.log(`Buys:        -$${cash.buys.toFixed(2)}`);
    console.log(`Sells:       +$${cash.sells.toFixed(2)}`);
    console.log(`SplitCost:   -$${cash.splitCost.toFixed(2)}`);
    console.log(`Redemptions: +$${cash.redemptions.toFixed(2)}`);
    console.log(`HeldValue:   +$${cash.heldValue.toFixed(2)}`);
    console.log('\nFINAL REALIZED P&L');
    console.log(`Net:  $${cash.realizedPnl.toFixed(2)}`);
  }

  if (wantUi) {
    const ui = await computeUiParityPnl(WALLET);
    console.log('\n--- UI PARITY (SUBGRAPH) ---');
    console.log(`Volume: $${ui.volume.toFixed(2)}`);
    console.log(`Positions: ${ui.positionCount}`);
    console.log(
      `Mapping gaps: events=${ui.gapStats.unmapped_event_count}, ` +
        `conditions=${ui.gapStats.unmapped_condition_count}, ` +
        `skipped_usdc=$${ui.gapStats.skipped_usdc_abs.toFixed(2)}`
    );
    console.log('\nFINAL REALIZED P&L');
    console.log(`Net:  $${ui.realizedPnl.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
