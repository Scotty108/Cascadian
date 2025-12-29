/**
 * Unified P&L Calculator
 *
 * Single formula that handles:
 * - Pure buyers (no splits): behaves like subgraph avg-cost
 * - Splitters/sellers: infers implicit splits on deficit sells
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeUnifiedPnl } from '@/lib/pnl/unifiedPnl';

const WALLET = process.argv[2]?.toLowerCase() || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== UNIFIED P&L CALCULATION ===');
  console.log(`Wallet: ${WALLET}`);
  console.log('Mode: Unified (implicit splits on deficit sells + synthetic resolution)\n');

  const result = await computeUnifiedPnl(WALLET);
  const {
    realizedPnl,
    trades,
    openPositions,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    buys,
    sells,
    redemptions,
    splitCost,
    heldValue,
    implicitSplitTokens,
    explicitSplitTokens,
    redemptionEvents,
    redemptionApplied,
    redemptionSkippedNoResolution,
    redemptionSkippedNoToken,
    sellDeficitNoMapping,
    sellDeficitNoSplitEvidence,
    redeemDeficitNoSplitEvidence,
    txSplitPoolTotal,
    txSplitTokensUsed,
  } = result;

  console.log('--- SUMMARY ---');
  console.log(`Trades: ${trades}`);
  console.log(`Open positions (unresolved): ${openPositions}`);
  console.log(`Mapped tokens: ${mappedTokens}/${totalTokens} (${(mappingCoveragePct * 100).toFixed(1)}%)`);
  console.log(`Implicit split tokens: ${implicitSplitTokens.toFixed(2)}`);
  console.log(`Explicit split tokens: ${explicitSplitTokens.toFixed(2)}`);
  console.log(`Tx-hash split pool total: ${txSplitPoolTotal.toFixed(2)}`);
  console.log(`Tx-hash split tokens used: ${txSplitTokensUsed.toFixed(2)}`);
  console.log(`Sell deficit (no mapping): ${sellDeficitNoMapping.toFixed(2)}`);
  console.log(`Sell deficit (no split evidence): ${sellDeficitNoSplitEvidence.toFixed(2)}`);
  console.log(`Redeem deficit (no split evidence): ${redeemDeficitNoSplitEvidence.toFixed(2)}`);
  console.log(`Redemptions: events=${redemptionEvents} applied=${redemptionApplied} ` +
    `skipped(no-resolution)=${redemptionSkippedNoResolution} skipped(no-token)=${redemptionSkippedNoToken}`);

  console.log('\nP&L COMPONENTS');
  console.log(`Buys:        -$${buys.toFixed(2)}`);
  console.log(`Sells:       +$${sells.toFixed(2)}`);
  console.log(`SplitCost:   -$${splitCost.toFixed(2)} (explicit+implicit)`);
  console.log(`Redemptions: +$${redemptions.toFixed(2)}`);
  console.log(`HeldValue:   +$${heldValue.toFixed(2)}`);

  console.log('\nFINAL REALIZED P&L');
  console.log(`Net:  $${realizedPnl.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
