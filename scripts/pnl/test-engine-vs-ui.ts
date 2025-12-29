/**
 * Engine vs UI Comparison
 *
 * Compares the V11_POLY engine output (with transfers) against Polymarket UI values.
 * This uses the subgraph-style engine with ERC1155 transfers enabled.
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface ComparisonResult {
  label: string;
  wallet: string;
  uiPnl: number;
  enginePnlNoXfers: number;
  enginePnlWithXfers: number;
  diffNoXfers: number;
  diffWithXfers: number;
  transferInCount: number;
  transferOutCount: number;
}

async function main(): Promise<void> {
  console.log('═'.repeat(100));
  console.log('ENGINE vs UI COMPARISON - V11_POLY with ERC1155 Transfers');
  console.log('═'.repeat(100));
  console.log('');

  const results: ComparisonResult[] = [];

  for (const bm of UI_BENCHMARK_WALLETS) {
    // Load events without transfers
    const eventsNoXfers = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: true,
      includeErc1155Transfers: false,
    });
    const resultNoXfers = computeWalletPnlFromEvents(bm.wallet, eventsNoXfers);

    // Load events with transfers
    const eventsWithXfers = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: true,
      includeErc1155Transfers: true,
    });
    const resultWithXfers = computeWalletPnlFromEvents(bm.wallet, eventsWithXfers);

    const transferInCount = eventsWithXfers.filter(e => e.eventType === 'TRANSFER_IN').length;
    const transferOutCount = eventsWithXfers.filter(e => e.eventType === 'TRANSFER_OUT').length;

    results.push({
      label: bm.label,
      wallet: bm.wallet,
      uiPnl: bm.profitLoss_all,
      enginePnlNoXfers: resultNoXfers.realizedPnl,
      enginePnlWithXfers: resultWithXfers.realizedPnl,
      diffNoXfers: resultNoXfers.realizedPnl - bm.profitLoss_all,
      diffWithXfers: resultWithXfers.realizedPnl - bm.profitLoss_all,
      transferInCount,
      transferOutCount,
    });
  }

  // Print results table
  console.log('─'.repeat(100));
  console.log(
    '| Wallet | UI PnL      | No Xfers    | With Xfers  | Diff (No)   | Diff (With) | IN/OUT |'
  );
  console.log('─'.repeat(100));

  for (const r of results) {
    const uiStr = r.uiPnl.toFixed(2).padStart(10);
    const noXfersStr = r.enginePnlNoXfers.toFixed(2).padStart(10);
    const withXfersStr = r.enginePnlWithXfers.toFixed(2).padStart(10);
    const diffNoStr = r.diffNoXfers.toFixed(2).padStart(10);
    const diffWithStr = r.diffWithXfers.toFixed(2).padStart(10);
    const xferStr = `${r.transferInCount}/${r.transferOutCount}`.padStart(6);

    console.log(
      `| ${r.label.padEnd(6)} | $${uiStr} | $${noXfersStr} | $${withXfersStr} | $${diffNoStr} | $${diffWithStr} | ${xferStr} |`
    );
  }
  console.log('─'.repeat(100));

  // Summary
  console.log('');
  console.log('LEGEND:');
  console.log('  UI PnL      = Value shown on Polymarket UI (All Time)');
  console.log('  No Xfers    = Engine realized PnL without ERC1155 transfers');
  console.log('  With Xfers  = Engine realized PnL with ERC1155 transfers enabled');
  console.log('  Diff (No)   = Engine - UI (without transfers)');
  console.log('  Diff (With) = Engine - UI (with transfers)');
  console.log('  IN/OUT      = TRANSFER_IN / TRANSFER_OUT event counts');
  console.log('');
  console.log('ANALYSIS:');
  console.log('  - Positive diff = engine shows MORE profit than UI');
  console.log('  - Negative diff = engine shows LESS profit than UI');
  console.log('  - Transfers generally increase engine PnL (zero cost basis)');
  console.log('  - Remaining gaps are due to data coverage or UI-specific rules');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
