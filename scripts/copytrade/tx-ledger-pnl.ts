/**
 * Tx-Ledger P&L Calculator
 *
 * Sequentially applies trades inside each tx to infer implicit splits when
 * sells would go negative. This avoids tx_hash split attribution ambiguity.
 *
 * Usage: npx tsx scripts/copytrade/tx-ledger-pnl.ts <wallet_address>
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeLedgerV2Pnl } from '@/lib/pnl/ledgerV2';

const WALLET = process.argv[2]?.toLowerCase() || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== TX LEDGER P&L CALCULATION ===');
  console.log(`Wallet: ${WALLET}\n`);

  const result = await computeLedgerV2Pnl(WALLET);
  const {
    realizedPnl,
    trades,
    openPositions,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    buys,
    sells,
    splitCost,
    redemptions,
    heldValue,
    implicitSplits,
    implicitSplitFromTrades,
    implicitSplitFromRedemptions,
    explicitSplits,
    redemptionEvents,
    redemptionApplied,
    redemptionSkippedNoResolution,
    redemptionSkippedNoToken,
  } = result;

  console.log('--- SUMMARY ---');
  console.log(`Trades: ${trades}`);
  console.log(`Net token balance: ${result.netTokenBalance.toFixed(2)} (${result.isNetBuyer ? 'BUYER' : 'SELLER'})`);
  console.log(`Mapped tokens: ${mappedTokens}/${totalTokens} (${(mappingCoveragePct * 100).toFixed(1)}%)`);
  console.log(`Open positions (unresolved): ${openPositions}`);
  console.log(`Implicit split tokens: ${implicitSplits.toFixed(2)}`);
  console.log(`  from trades: ${implicitSplitFromTrades.toFixed(2)}`);
  console.log(`  from redemptions: ${implicitSplitFromRedemptions.toFixed(2)}`);
  console.log(`Explicit split tokens: ${explicitSplits.toFixed(2)}`);
  console.log(
    `Redemptions: events=${redemptionEvents}, applied=${redemptionApplied}, ` +
      `noResolution=${redemptionSkippedNoResolution}, noToken=${redemptionSkippedNoToken}`,
  );

  console.log('\nP&L COMPONENTS');
  console.log(`Buys:        -$${buys.toFixed(2)}`);
  console.log(`Sells:       +$${sells.toFixed(2)}`);
  console.log(`SplitCost:   -$${splitCost.toFixed(2)}`);
  console.log(`Redemptions: +$${redemptions.toFixed(2)}`);
  console.log(`HeldValue:   +$${heldValue.toFixed(2)}`);

  console.log('\nFINAL REALIZED P&L');
  console.log(`Net:  $${realizedPnl.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
