/**
 * Debug V11 engine on W2 wallet
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { COLLATERAL_SCALE, FIFTY_CENTS } from '../../lib/pnl/polymarketConstants';

async function main(): Promise<void> {
  const wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

  const events = await loadPolymarketPnlEventsForWallet(wallet);

  console.log('=== W2 Event Sample (first 10) ===');
  for (const e of events.slice(0, 10)) {
    console.log(`${e.eventType.padEnd(20)} token=${e.tokenId.toString().substring(0, 20)}... price=${Number(e.price) / Number(COLLATERAL_SCALE)} amount=${Number(e.amount)}`);
  }

  console.log('');
  console.log('=== Computing PnL step by step ===');

  // Manual computation with logging
  const positions = new Map<string, { amount: bigint; avgPrice: bigint; realizedPnl: bigint }>();
  let totalRealizedPnl = 0n;

  for (const event of events) {
    const posKey = event.tokenId.toString();
    let pos = positions.get(posKey);
    if (!pos) {
      pos = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };
      positions.set(posKey, pos);
    }

    const price = event.eventType === 'SPLIT' ? FIFTY_CENTS :
                  event.eventType === 'MERGE' ? FIFTY_CENTS :
                  event.price;

    if (event.eventType === 'ORDER_MATCHED_BUY' || event.eventType === 'SPLIT') {
      // BUY
      const amount = event.amount;
      if (amount > 0n) {
        const numerator = pos.avgPrice * pos.amount + price * amount;
        const denominator = pos.amount + amount;
        if (denominator > 0n) {
          pos.avgPrice = numerator / denominator;
        }
        pos.amount += amount;
      }
    } else {
      // SELL
      const adjustedAmount = event.amount > pos.amount ? pos.amount : event.amount;
      if (adjustedAmount > 0n) {
        const deltaPnL = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.realizedPnl += deltaPnL;
        pos.amount -= adjustedAmount;

        // Log significant PnL events
        if (Math.abs(Number(deltaPnL)) > 100) {
          console.log(`  ${event.eventType}: qty=${Number(adjustedAmount)/1e6} price=${Number(price)/1e6} avgPrice=${Number(pos.avgPrice)/1e6} deltaPnL=$${Number(deltaPnL)}`);
        }
      } else {
        console.log(`  ${event.eventType}: SKIPPED (no position to sell)`);
      }
    }
  }

  // Sum PnL
  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;
  }

  console.log('');
  console.log(`Total Realized PnL: $${Number(totalRealizedPnl) / Number(COLLATERAL_SCALE)}`);

  // Also check what positions have non-zero amounts
  console.log('');
  console.log('=== Positions with remaining amounts ===');
  for (const [tokenId, pos] of positions.entries()) {
    if (pos.amount > 1000000n) {  // More than 1 token
      console.log(`  Token ${tokenId.substring(0, 20)}... amount=${Number(pos.amount)/1e6} avgPrice=$${Number(pos.avgPrice)/1e6}`);
    }
  }

  // Event type breakdown
  console.log('');
  console.log('=== Event Type Breakdown ===');
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
