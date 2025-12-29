/**
 * Test V11 engine without any synthetic redemptions
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('V11_POLY ENGINE - NO SYNTHETIC REDEMPTIONS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Label | UI PnL       | Engine PnL   | Error %');
  console.log('─'.repeat(55));

  for (const bm of UI_BENCHMARK_WALLETS) {
    const events = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
    });
    const result = computeWalletPnlFromEvents(bm.wallet, events);

    const uiPnl = bm.profitLoss_all;
    const enginePnl = result.realizedPnl;

    const error = uiPnl !== 0
      ? Math.abs((enginePnl - uiPnl) / Math.abs(uiPnl)) * 100
      : Math.abs(enginePnl) * 100;

    const formatUsd = (n: number) => {
      const prefix = n >= 0 ? '' : '-';
      return prefix + '$' + Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    console.log(
      `${bm.label.padEnd(5)} | ${formatUsd(uiPnl).padStart(12)} | ${formatUsd(enginePnl).padStart(12)} | ${error.toFixed(1).padStart(6)}%`
    );
  }

  console.log('');
  console.log('═'.repeat(80));
}

main().catch(console.error);
