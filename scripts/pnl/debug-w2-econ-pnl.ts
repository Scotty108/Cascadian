/**
 * Debug W2 economic PnL vs engine PnL
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { COLLATERAL_SCALE, FIFTY_CENTS } from '../../lib/pnl/polymarketConstants';

interface TokenStats {
  bought: number;
  cost: number;
  sold: number;
  proceeds: number;
}

async function main(): Promise<void> {
  const wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';
  const events = await loadPolymarketPnlEventsForWallet(wallet);

  // Calculate per-token economic PnL
  const tokenStats = new Map<string, TokenStats>();

  for (const e of events) {
    const tokenId = e.tokenId.toString();
    let stats = tokenStats.get(tokenId);
    if (!stats) {
      stats = { bought: 0, cost: 0, sold: 0, proceeds: 0 };
      tokenStats.set(tokenId, stats);
    }

    const price = Number(e.price) / 1e6;
    const tokens = Number(e.amount) / 1e6;

    if (e.eventType === 'ORDER_MATCHED_BUY' || e.eventType === 'SPLIT') {
      stats.bought += tokens;
      stats.cost += e.eventType === 'SPLIT' ? tokens * 0.5 : price * tokens;
    } else {
      const effectivePrice = e.eventType === 'MERGE' ? 0.5 : price;
      stats.sold += tokens;
      stats.proceeds += effectivePrice * tokens;
    }
  }

  // Calculate PnL for each token
  let totalEconPnl = 0;
  const tokenPnls: Array<{
    tokenId: string;
    bought: number;
    cost: number;
    sold: number;
    proceeds: number;
    econPnl: number;
  }> = [];

  for (const [tokenId, stats] of tokenStats.entries()) {
    const econPnl = stats.proceeds - stats.cost;
    totalEconPnl += econPnl;
    if (Math.abs(econPnl) > 0.01) {
      tokenPnls.push({
        tokenId: tokenId.substring(0, 16),
        bought: stats.bought,
        cost: stats.cost,
        sold: stats.sold,
        proceeds: stats.proceeds,
        econPnl,
      });
    }
  }

  tokenPnls.sort((a, b) => Math.abs(b.econPnl) - Math.abs(a.econPnl));

  console.log('=== Per-Token Economic PnL (top 15) ===');
  for (const p of tokenPnls.slice(0, 15)) {
    console.log(
      `token=${p.tokenId}... bought=${p.bought.toFixed(1)} cost=$${p.cost.toFixed(2)} sold=${p.sold.toFixed(1)} proceeds=$${p.proceeds.toFixed(2)} pnl=$${p.econPnl.toFixed(2)}`
    );
  }

  console.log('');
  console.log('Total Economic PnL (all tokens):', totalEconPnl.toFixed(2));

  // Compare with engine
  const result = computeWalletPnlFromEvents(wallet, events);
  console.log('Engine PnL:', result.realizedPnl.toFixed(2));
  console.log('Difference:', (result.realizedPnl - totalEconPnl).toFixed(2));

  // Show tokens with remaining balance
  console.log('');
  console.log('=== Tokens with remaining balance (unrealized) ===');
  for (const [tokenId, stats] of tokenStats.entries()) {
    const remaining = stats.bought - stats.sold;
    if (remaining > 1) {
      const avgCost = stats.cost / stats.bought;
      console.log(
        `token=${tokenId.substring(0, 16)}... remaining=${remaining.toFixed(2)} avgCost=$${avgCost.toFixed(4)}`
      );
    }
  }
}

main().catch(console.error);
