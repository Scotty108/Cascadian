import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeLedgerV3Pnl } from '@/lib/pnl/ledgerV3';

const TEST_WALLETS = [
  { name: 'calibration', address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', target: -86 },
  { name: 'alexma11224', address: '0x0d0e73b88444c21094421447451e15e9c4f14049', target: 375 },
  { name: 'winner1', address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', target: 25594 },
];

async function main() {
  console.log('=== LEDGER V3 P&L TEST ===\n');
  for (const wallet of TEST_WALLETS) {
    const res = await computeLedgerV3Pnl(wallet.address);
    console.log(`--- ${wallet.name} (${wallet.address}) ---`);
    console.log(`Target (UI): $${wallet.target}`);
    console.log(`Buys:        $${res.buys.toFixed(2)}`);
    console.log(`Sells:       $${res.sells.toFixed(2)}`);
    console.log(`Redemptions: $${res.redemptions.toFixed(2)}`);
    console.log(`Merges:      $${res.merges.toFixed(2)}`);
    console.log(`SplitCost:   $${res.splitCost.toFixed(2)} (implicit $${res.implicitSplits.toFixed(2)}, explicit $${res.explicitSplits.toFixed(2)})`);
    console.log(`HeldValue:   $${res.heldValue.toFixed(2)}`);
    console.log(`Net:         $${res.realizedPnl.toFixed(2)}`);
    console.log(`Trades: ${res.trades}, Tx: ${res.txCount}`);
    console.log(`Mapping: ${res.mappedTokens}/${res.totalTokens} (${(res.mappingCoveragePct * 100).toFixed(1)}%)`);
    console.log(`Open positions: ${res.openPositions}`);
    console.log(`Redemptions: events=${res.redemptionEvents}, applied=${res.redemptionApplied}, skipped(no res)=${res.redemptionSkippedNoResolution}, skipped(no token)=${res.redemptionSkippedNoToken}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
