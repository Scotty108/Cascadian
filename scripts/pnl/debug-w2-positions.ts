/**
 * Debug W2 position-level PnL
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { COLLATERAL_SCALE } from '../../lib/pnl/polymarketConstants';

async function main(): Promise<void> {
  const wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';
  const events = await loadPolymarketPnlEventsForWallet(wallet);

  // Check unique tokens
  const uniqueTokens = new Set(events.map(e => e.tokenId.toString()));
  console.log('Unique tokens:', uniqueTokens.size);
  console.log('Total events:', events.length);

  // Count events by type
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1;
  }
  console.log('Events by type:', typeCounts);

  // Run engine and check positions
  const result = computeWalletPnlFromEvents(wallet, events);

  console.log('');
  console.log('Engine result:');
  console.log('  realizedPnl:', result.realizedPnl);
  console.log('  positionCount:', result.positionCount);

  // Check positions with non-zero PnL
  let posWithPnl = 0;
  let totalPnl = 0n;
  for (const pos of result.positions.values()) {
    if (pos.realizedPnl !== 0n) {
      posWithPnl++;
      totalPnl += pos.realizedPnl;
    }
  }
  console.log('  positions with non-zero PnL:', posWithPnl);
  console.log('  calculated total PnL:', Number(totalPnl) / 1e6);

  // Show top PnL positions
  console.log('');
  console.log('Top 10 positions by absolute PnL:');
  const sortedPositions = [...result.positions.values()]
    .sort((a, b) => Math.abs(Number(b.realizedPnl)) - Math.abs(Number(a.realizedPnl)))
    .slice(0, 10);

  for (const pos of sortedPositions) {
    console.log(`  token=${pos.tokenId.toString().substring(0,16)}... pnl=$${(Number(pos.realizedPnl)/1e6).toFixed(4)} amount=${(Number(pos.amount)/1e6).toFixed(2)}`);
  }

  // Also check if there are positions with large remaining amounts (unrealized)
  console.log('');
  console.log('Positions with >100 tokens remaining (unrealized):');
  const largePositions = [...result.positions.values()]
    .filter(p => Number(p.amount) > 100 * 1e6)
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  for (const pos of largePositions) {
    console.log(`  token=${pos.tokenId.toString().substring(0,16)}... amount=${(Number(pos.amount)/1e6).toFixed(2)} avgPrice=$${(Number(pos.avgPrice)/1e6).toFixed(4)}`);
  }
}

main().catch(console.error);
