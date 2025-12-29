/**
 * Test V11 engine in both modes
 *
 * Compares results WITH and WITHOUT synthetic redemptions
 * to understand which mode is appropriate for each wallet.
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('V11_POLY ENGINE - COMPARING SYNTHETIC REDEMPTION MODES');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Label | UI PnL      | Without Synth | With Synth   | Best Match | Best Error');
  console.log('─'.repeat(80));

  for (const bm of UI_BENCHMARK_WALLETS) {
    // Without synthetic redemptions
    const eventsWithout = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
    });
    const resultWithout = computeWalletPnlFromEvents(bm.wallet, eventsWithout);

    // With synthetic redemptions
    const eventsWith = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: true,
    });
    const resultWith = computeWalletPnlFromEvents(bm.wallet, eventsWith);

    // Calculate errors
    const errorWithout = bm.profitLoss_all !== 0
      ? Math.abs((resultWithout.realizedPnl - bm.profitLoss_all) / Math.abs(bm.profitLoss_all)) * 100
      : Math.abs(resultWithout.realizedPnl) * 100;

    const errorWith = bm.profitLoss_all !== 0
      ? Math.abs((resultWith.realizedPnl - bm.profitLoss_all) / Math.abs(bm.profitLoss_all)) * 100
      : Math.abs(resultWith.realizedPnl) * 100;

    // Determine best mode
    const bestMode = errorWithout <= errorWith ? 'Without' : 'With';
    const bestError = Math.min(errorWithout, errorWith);

    const formatUsd = (n: number) => {
      const prefix = n >= 0 ? '' : '-';
      return prefix + '$' + Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    console.log(
      `${bm.label.padEnd(5)} | ${formatUsd(bm.profitLoss_all).padStart(11)} | ${formatUsd(resultWithout.realizedPnl).padStart(13)} | ${formatUsd(resultWith.realizedPnl).padStart(12)} | ${bestMode.padStart(10)} | ${bestError.toFixed(1).padStart(6)}%`
    );
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('');
  console.log('KEY FINDINGS:');
  console.log('- "Without Synth" = Only actual CLOB + CTF events, no synthetic redemptions');
  console.log('- "With Synth" = Adds synthetic redemption events for resolved markets');
  console.log('');
  console.log('Use "With Synth" for wallets where user has redeemed all resolved positions.');
  console.log('Use "Without Synth" for wallets with active/unredeemed positions.');
  console.log('');
}

main().catch(console.error);
