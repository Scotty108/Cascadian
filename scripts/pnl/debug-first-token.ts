/**
 * Debug first token's events step by step
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { COLLATERAL_SCALE, FIFTY_CENTS } from '../../lib/pnl/polymarketConstants';

async function main(): Promise<void> {
  const wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';
  const events = await loadPolymarketPnlEventsForWallet(wallet);

  // Track positions manually with debug output
  const positions = new Map<string, { amount: bigint; avgPrice: bigint; realizedPnl: bigint }>();

  // Process first market's events (first buy and its matching redemption)
  const firstToken = events[0]?.tokenId.toString() || '';
  console.log('=== First Token Events ===');
  console.log('First token ID:', firstToken.substring(0,20), '...');
  console.log('');

  for (const event of events) {
    if (event.tokenId.toString() !== firstToken) continue;

    const posKey = event.tokenId.toString();
    let pos = positions.get(posKey);
    if (!pos) {
      pos = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };
      positions.set(posKey, pos);
    }

    const price = event.eventType === 'SPLIT' ? FIFTY_CENTS :
                  event.eventType === 'MERGE' ? FIFTY_CENTS :
                  event.price;

    console.log(`${event.eventType}: price=${Number(price)/1e6} amount=${Number(event.amount)/1e6}`);
    console.log(`  Before: pos.amount=${Number(pos.amount)/1e6} avgPrice=${Number(pos.avgPrice)/1e6}`);

    if (event.eventType === 'ORDER_MATCHED_BUY' || event.eventType === 'SPLIT') {
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
      const adjustedAmount = event.amount > pos.amount ? pos.amount : event.amount;
      if (adjustedAmount > 0n) {
        const deltaPnL = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.realizedPnl += deltaPnL;
        pos.amount -= adjustedAmount;
        console.log(`  deltaPnL=${Number(deltaPnL)/1e6}`);
      } else {
        console.log('  SKIPPED - no position');
      }
    }

    console.log(`  After: pos.amount=${Number(pos.amount)/1e6} avgPrice=${Number(pos.avgPrice)/1e6} realizedPnl=${Number(pos.realizedPnl)/1e6}`);
    console.log('');
  }

  console.log('=== Summary for first token ===');
  const pos = positions.get(firstToken);
  if (pos) {
    console.log(`Final amount: ${Number(pos.amount)/1e6}`);
    console.log(`Final avgPrice: ${Number(pos.avgPrice)/1e6}`);
    console.log(`Final realizedPnl: $${Number(pos.realizedPnl)/1e6}`);
  }
}

main().catch(console.error);
