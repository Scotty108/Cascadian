/**
 * Analyze V11 losses for a specific wallet
 * This script investigates why V11 is calculating $16k instead of $5,454
 */
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

interface TokenActivity {
  buys: number;
  sells: number;
  redemptions: number;
  redemptionPrice: number | null;
  buyUsdc: number;
  sellUsdc: number;
}

async function analyze() {
  console.log('Analyzing wallet:', wallet);

  // Load events
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false
  });

  // Get unique token IDs
  const tokenIds = new Set(events.map(e => e.tokenId.toString()));
  console.log('Unique tokens traded:', tokenIds.size);

  // For each token, compute buy/sell/redemption activity
  const tokenActivity: Record<string, TokenActivity> = {};
  for (const e of events) {
    const tid = e.tokenId.toString();
    if (!tokenActivity[tid]) {
      tokenActivity[tid] = { buys: 0, sells: 0, redemptions: 0, redemptionPrice: null, buyUsdc: 0, sellUsdc: 0 };
    }
    if (e.eventType === 'ORDER_MATCHED_BUY') {
      tokenActivity[tid].buys += Number(e.amount) / 1e6;
      tokenActivity[tid].buyUsdc += Number(e.usdcAmountRaw || 0) / 1e6;
    }
    if (e.eventType === 'ORDER_MATCHED_SELL') {
      tokenActivity[tid].sells += Number(e.amount) / 1e6;
      tokenActivity[tid].sellUsdc += Number(e.usdcAmountRaw || 0) / 1e6;
    }
    if (e.eventType === 'REDEMPTION') {
      tokenActivity[tid].redemptions += Number(e.amount) / 1e6;
      tokenActivity[tid].redemptionPrice = Number(e.payoutPrice || 0) / 1e6;
    }
  }

  // Count tokens with redemptions
  console.log('\n=== Tokens with redemption activity ===');
  let winningTokens = 0;
  let losingTokens = 0;
  let winningWithPosition = 0;
  let losingWithPosition = 0;

  for (const [tid, act] of Object.entries(tokenActivity)) {
    if (act.redemptions > 0) {
      const netPosition = act.buys - act.sells;
      const isWinner = (act.redemptionPrice || 0) > 0;

      if (isWinner) {
        winningTokens++;
        if (netPosition > 0) winningWithPosition++;
      } else {
        losingTokens++;
        if (netPosition > 0) losingWithPosition++;
      }
    }
  }

  console.log('Winning tokens (price>0):', winningTokens, '| With position:', winningWithPosition);
  console.log('Losing tokens (price=0):', losingTokens, '| With position:', losingWithPosition);

  // Show the specific positions for tokens with losses
  console.log('\n=== Losing tokens with position (should have losses) ===');
  let losingPnlTotal = 0;
  for (const [tid, act] of Object.entries(tokenActivity)) {
    if (act.redemptions > 0 && act.redemptionPrice === 0) {
      const netPosition = act.buys - act.sells;
      if (netPosition > 0.01) {
        const avgBuyPrice = act.buyUsdc / act.buys;
        const expectedLoss = netPosition * avgBuyPrice;
        console.log('Token:', tid.substring(0, 25) + '...');
        console.log('  buys:', act.buys.toFixed(2), 'sells:', act.sells.toFixed(2), 'net:', netPosition.toFixed(2));
        console.log('  buy USDC:', act.buyUsdc.toFixed(2), 'avg price:', avgBuyPrice.toFixed(4));
        console.log('  Expected loss: -$' + expectedLoss.toFixed(2));
        losingPnlTotal += expectedLoss;
      }
    }
  }
  console.log('\nTotal expected losses: -$' + losingPnlTotal.toFixed(2));

  // Also show winning tokens for comparison
  console.log('\n=== Winning tokens with position (should have gains) ===');
  let winningPnlTotal = 0;
  for (const [tid, act] of Object.entries(tokenActivity)) {
    if (act.redemptions > 0 && (act.redemptionPrice || 0) > 0) {
      const netPosition = act.buys - act.sells;
      if (netPosition > 0.01) {
        const avgBuyPrice = act.buyUsdc / act.buys;
        const expectedGain = netPosition * (1 - avgBuyPrice);
        console.log('Token:', tid.substring(0, 25) + '...');
        console.log('  buys:', act.buys.toFixed(2), 'sells:', act.sells.toFixed(2), 'net:', netPosition.toFixed(2));
        console.log('  buy USDC:', act.buyUsdc.toFixed(2), 'avg price:', avgBuyPrice.toFixed(4));
        console.log('  Expected gain: +$' + expectedGain.toFixed(2));
        winningPnlTotal += expectedGain;
      }
    }
  }
  console.log('\nTotal expected gains: +$' + winningPnlTotal.toFixed(2));
  console.log('\nNet expected PnL: $' + (winningPnlTotal - losingPnlTotal).toFixed(2));

  // Now run the V11 engine
  console.log('\n=== V11 Engine Result ===');
  const result = computeWalletPnlFromEvents(wallet, events);
  console.log('V11 Realized PnL: $' + (Number(result.realizedPnlRaw) / 1e6).toFixed(2));

  // Check each position's realized PnL
  console.log('\n=== V11 Position PnL breakdown ===');
  let sumPositionPnL = 0n;
  let positivePositions = 0;
  let negativePositions = 0;

  for (const [id, pos] of result.positions.entries()) {
    if (pos.realizedPnl !== 0n) {
      sumPositionPnL += pos.realizedPnl;
      if (pos.realizedPnl > 0n) {
        positivePositions++;
      } else {
        negativePositions++;
      }
    }
  }

  console.log('Positions with positive PnL:', positivePositions);
  console.log('Positions with negative PnL:', negativePositions);
  console.log('Sum of position PnL: $' + (Number(sumPositionPnL) / 1e6).toFixed(2));
}

analyze().catch(console.error);
