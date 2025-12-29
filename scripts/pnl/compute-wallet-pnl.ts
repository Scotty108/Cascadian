/**
 * Compute Wallet PnL - CLI Tool
 *
 * Simple CLI for computing PnL for any wallet in either mode.
 *
 * Usage:
 *   npx tsx scripts/pnl/compute-wallet-pnl.ts <wallet> [mode]
 *
 * Examples:
 *   npx tsx scripts/pnl/compute-wallet-pnl.ts 0x1234...
 *   npx tsx scripts/pnl/compute-wallet-pnl.ts 0x1234... strict
 *   npx tsx scripts/pnl/compute-wallet-pnl.ts 0x1234... ui_like
 */

import { loadPolymarketPnlEventsForWallet, getLoaderOptionsForMode } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents, PnlMode } from '../../lib/pnl/polymarketSubgraphEngine';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/pnl/compute-wallet-pnl.ts <wallet> [mode]');
    console.log('');
    console.log('Modes:');
    console.log('  strict   - Conservative (default). CLOB + CTF only. Verified accurate.');
    console.log('  ui_like  - Includes ERC1155 transfers. Best-effort UI parity.');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/pnl/compute-wallet-pnl.ts 0x1234...');
    console.log('  npx tsx scripts/pnl/compute-wallet-pnl.ts 0x1234... ui_like');
    process.exit(1);
  }

  const wallet = args[0];
  const mode: PnlMode = (args[1] as PnlMode) || 'strict';

  if (mode !== 'strict' && mode !== 'ui_like') {
    console.error(`Invalid mode: ${mode}. Use 'strict' or 'ui_like'.`);
    process.exit(1);
  }

  console.log(`Computing PnL for ${wallet.substring(0, 12)}... (mode: ${mode})`);
  console.log('');

  // Load events with mode-appropriate options
  const loaderOptions = getLoaderOptionsForMode(mode);
  const events = await loadPolymarketPnlEventsForWallet(wallet, loaderOptions);

  // Compute PnL
  const result = computeWalletPnlFromEvents(wallet, events, { mode });

  // Print summary
  console.log('═'.repeat(60));
  console.log('PnL RESULT');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`Wallet:       ${result.wallet}`);
  console.log(`Mode:         ${mode}`);
  console.log(`Realized PnL: $${result.realizedPnl.toFixed(2)}`);
  console.log(`Volume:       $${result.volume.toFixed(2)}`);
  console.log(`Positions:    ${result.positionCount}`);
  console.log('');
  console.log('Event Counts:');
  for (const [eventType, count] of Object.entries(result.eventCounts)) {
    if (count > 0) {
      console.log(`  ${eventType}: ${count}`);
    }
  }
  console.log('');

  // If running both modes, show comparison
  if (args.length === 1) {
    console.log('─'.repeat(60));
    console.log('Comparing both modes...');
    console.log('─'.repeat(60));

    const uiLikeOptions = getLoaderOptionsForMode('ui_like');
    const uiLikeEvents = await loadPolymarketPnlEventsForWallet(wallet, uiLikeOptions);
    const uiLikeResult = computeWalletPnlFromEvents(wallet, uiLikeEvents, { mode: 'ui_like' });

    const diff = uiLikeResult.realizedPnl - result.realizedPnl;
    const transferIn = uiLikeResult.eventCounts.TRANSFER_IN;
    const transferOut = uiLikeResult.eventCounts.TRANSFER_OUT;

    console.log('');
    console.log('| Mode     | Realized PnL     | Transfers IN/OUT |');
    console.log('|----------|------------------|------------------|');
    console.log(`| strict   | $${result.realizedPnl.toFixed(2).padStart(14)} | N/A              |`);
    console.log(`| ui_like  | $${uiLikeResult.realizedPnl.toFixed(2).padStart(14)} | ${transferIn}/${transferOut}`.padEnd(18) + '|');
    console.log('');
    console.log(`Difference (ui_like - strict): ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`);
    console.log('');

    if (transferIn === 0 && transferOut === 0) {
      console.log('Note: No ERC1155 transfers found. Both modes produce identical results.');
    } else if (Math.abs(diff) < 1) {
      console.log('Note: Difference is negligible (<$1). Transfer impact is minimal.');
    } else {
      console.log('Note: Significant difference due to ERC1155 transfers.');
      console.log('      Use ui_like mode for better UI approximation if needed.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
