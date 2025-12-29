/**
 * Test Polymarket Subgraph PnL Engine
 *
 * Runs the V11_POLY engine (direct port of polymarket-subgraph/pnl-subgraph)
 * on benchmark wallets and compares results to:
 * - Polymarket UI values
 * - Our V9 economic PnL
 *
 * Usage: npx tsx scripts/pnl/test-polymarket-subgraph-pnl.ts
 */

import { loadPolymarketPnlEventsForWallet, getEventCountsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

function formatUsd(n: number): string {
  const prefix = n >= 0 ? '' : '-';
  return prefix + '$' + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(n: number | null): string {
  if (n === null) return 'N/A';
  return n.toFixed(1) + '%';
}

async function testWallet(wallet: string, label: string, uiPnl: number): Promise<void> {
  console.log('');
  console.log('─'.repeat(70));
  console.log(`${label}: ${wallet.substring(0, 14)}...`);
  console.log('─'.repeat(70));

  // Get raw event counts first
  const eventCounts = await getEventCountsForWallet(wallet);
  console.log('Raw event counts from ClickHouse:');
  for (const [type, count] of Object.entries(eventCounts)) {
    console.log(`  ${type}: ${count.toLocaleString()}`);
  }

  // Load events
  console.log('');
  console.log('Loading events...');
  const events = await loadPolymarketPnlEventsForWallet(wallet);
  console.log(`  Total events loaded: ${events.length.toLocaleString()}`);

  // Count by type
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1;
  }
  console.log('  Event breakdown:');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`    ${type}: ${count.toLocaleString()}`);
  }

  // Compute PnL
  console.log('');
  console.log('Computing PnL...');
  const result = computeWalletPnlFromEvents(wallet, events);

  // Calculate error
  const error = uiPnl !== 0
    ? Math.abs((result.realizedPnl - uiPnl) / Math.abs(uiPnl)) * 100
    : null;

  // Print results
  console.log('');
  console.log('Results:');
  console.log(`  UI PnL (target):      ${formatUsd(uiPnl)}`);
  console.log(`  Subgraph PnL (V11):   ${formatUsd(result.realizedPnl)}`);
  console.log(`  Error:                ${formatPct(error)}`);
  console.log('');
  console.log(`  Volume:               ${formatUsd(result.volume)}`);
  console.log(`  Unique positions:     ${result.positionCount}`);

  // Summary status
  console.log('');
  if (error !== null) {
    if (error < 1) {
      console.log('  ✅ EXCELLENT MATCH (<1% error)');
    } else if (error < 10) {
      console.log('  ✅ GOOD MATCH (<10% error)');
    } else if (error < 30) {
      console.log('  ⚠️  PARTIAL MATCH (10-30% error)');
    } else {
      console.log('  ❌ SIGNIFICANT DEVIATION (>30% error)');
    }
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('═'.repeat(70));
  console.log('POLYMARKET SUBGRAPH PnL ENGINE TEST (V11_POLY)');
  console.log('═'.repeat(70));
  console.log('');
  console.log('This engine is a direct port of:');
  console.log('  https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph');
  console.log('');
  console.log('Events tracked:');
  console.log('  - OrdersMatched (CLOB BUY/SELL)');
  console.log('  - PositionSplit (BUY both outcomes at $0.50)');
  console.log('  - PositionsMerge (SELL both outcomes at $0.50)');
  console.log('  - PayoutRedemption (SELL at payout price)');
  console.log('');
  console.log('Key algorithm features:');
  console.log('  - Weighted average cost basis');
  console.log('  - Sell amount capped at tracked position');
  console.log('  - Events sorted by (blockNumber, logIndex, txHash)');

  for (const bm of UI_BENCHMARK_WALLETS) {
    await testWallet(bm.wallet, bm.label, bm.profitLoss_all);
  }

  // Summary table
  console.log('');
  console.log('═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Label | UI PnL      | V11 PnL     | Error  | Status');
  console.log('─'.repeat(60));

  for (const bm of UI_BENCHMARK_WALLETS) {
    const events = await loadPolymarketPnlEventsForWallet(bm.wallet);
    const result = computeWalletPnlFromEvents(bm.wallet, events);
    const error = bm.profitLoss_all !== 0
      ? Math.abs((result.realizedPnl - bm.profitLoss_all) / Math.abs(bm.profitLoss_all)) * 100
      : null;

    let status = '';
    if (error !== null) {
      if (error < 1) status = '✅ EXCELLENT';
      else if (error < 10) status = '✅ GOOD';
      else if (error < 30) status = '⚠️  PARTIAL';
      else status = '❌ DEVIATION';
    }

    console.log(
      `${bm.label.padEnd(5)} | ${formatUsd(bm.profitLoss_all).padStart(11)} | ${formatUsd(result.realizedPnl).padStart(11)} | ${formatPct(error).padStart(6)} | ${status}`
    );
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
