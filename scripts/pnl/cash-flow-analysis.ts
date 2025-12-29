/**
 * Pure cash flow analysis to compute true realized PnL
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function analyze() {
  console.log('Cash flow analysis for wallet:', wallet);

  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });

  const buys = events.filter(e => e.eventType === 'ORDER_MATCHED_BUY');
  const sells = events.filter(e => e.eventType === 'ORDER_MATCHED_SELL');
  const redemptions = events.filter(e => e.eventType === 'REDEMPTION');

  const totalBuyUsdc = buys.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;
  const totalSellUsdc = sells.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;

  // For redemptions, track first occurrence per token to avoid duplicate counting
  const redemptionsByToken = new Map<string, { amount: number; payoutPrice: number }>();
  for (const r of redemptions) {
    const tid = r.tokenId.toString();
    if (!redemptionsByToken.has(tid)) {
      redemptionsByToken.set(tid, {
        amount: Number(r.amount) / 1e6,
        payoutPrice: Number(r.payoutPrice || 0) / 1e6
      });
    }
  }

  let totalRedemptionUsdc = 0;
  let winnerCount = 0;
  let loserCount = 0;
  let totalWinPayout = 0;

  for (const [, data] of redemptionsByToken) {
    const payout = data.amount * data.payoutPrice;
    totalRedemptionUsdc += payout;
    if (data.payoutPrice > 0) {
      winnerCount++;
      totalWinPayout += payout;
    } else {
      loserCount++;
    }
  }

  console.log('\n=== Cash Flow Analysis ===');
  console.log('Cash OUT (buys): $' + totalBuyUsdc.toFixed(2));
  console.log('Cash IN (sells): $' + totalSellUsdc.toFixed(2));
  console.log('Cash IN (redemptions): $' + totalRedemptionUsdc.toFixed(2));
  console.log('');
  const netPnl = totalSellUsdc + totalRedemptionUsdc - totalBuyUsdc;
  console.log('Net PnL (cash flow): $' + netPnl.toFixed(2));
  console.log('');
  console.log('=== Token Breakdown ===');
  console.log('Unique tokens redeemed:', redemptionsByToken.size);
  console.log('Winning tokens:', winnerCount, '(payout: $' + totalWinPayout.toFixed(2) + ')');
  console.log('Losing tokens:', loserCount, '(payout: $0)');
  console.log('');
  console.log('=== Comparison ===');
  console.log('V11 engine: $16,004.50');
  console.log('PolymarketAnalytics: $5,454');
  console.log('Cash flow: $' + netPnl.toFixed(2));
}

analyze().catch(console.error);
