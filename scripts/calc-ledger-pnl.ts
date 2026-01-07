import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Manual calculation from the ledger data
// Sorted chronologically (oldest first by timestamp)

interface Trade {
  market: string;
  action: string;
  usdc: number;
  tokens: number;
  tokenName: string;
  timestamp: number;
}

const ledger: Trade[] = [
  // Trades in chronological order (sorted by timestamp)
  { market: '300-319 Nov21-28', action: 'Buy', usdc: 0.999987, tokens: 1.067222, tokenName: 'No', timestamp: 1764199869 },
  { market: 'Polymarket US 2025', action: 'Buy', usdc: 0.999999, tokens: 1.285346, tokenName: 'Yes', timestamp: 1764201197 },
  { market: '220-239 Nov21-28', action: 'Buy', usdc: 0.999989, tokens: 1.05262, tokenName: 'No', timestamp: 1764201357 },
  { market: '300-319 Nov21-28', action: 'Buy', usdc: 0.999994, tokens: 1.08695, tokenName: 'No', timestamp: 1764204035 },
  { market: '300-319 Nov21-28', action: 'Buy', usdc: 1.999999, tokens: 2.200219, tokenName: 'No', timestamp: 1764212461 },
  { market: '320-339 Nov21-28', action: 'Buy', usdc: 0.999995, tokens: 1.034121, tokenName: 'No', timestamp: 1764212477 },
  { market: '320-339 Nov21-28', action: 'Buy', usdc: 0.999984, tokens: 1.038405, tokenName: 'No', timestamp: 1764217017 },
  { market: '320-339 Nov21-28', action: 'Buy', usdc: 0.999984, tokens: 1.038405, tokenName: 'No', timestamp: 1764217045 },
  { market: '300-319 Nov21-28', action: 'Buy', usdc: 0.999999, tokens: 1.08225, tokenName: 'No', timestamp: 1764317297 },
  { market: '320-339 Nov21-28', action: 'Sell', usdc: 3.10689, tokens: 3.11, tokenName: 'No', timestamp: 1764344925 },
  { market: '280-299 Nov21-28', action: 'Buy', usdc: 3.809998, tokens: 3.911703, tokenName: 'Yes', timestamp: 1764345027 },
  { market: '300-319 Nov21-28', action: 'Redeem', usdc: 5.436641, tokens: 5.436641, tokenName: 'No', timestamp: 1764371159 },
  { market: '280-299 Nov21-28', action: 'Redeem', usdc: 3.911703, tokens: 3.911703, tokenName: 'Yes', timestamp: 1764371159 },
  { market: '220-239 Nov21-28', action: 'Redeem', usdc: 1.05262, tokens: 1.05262, tokenName: 'No', timestamp: 1764371159 },
  { market: '300-319 Nov25-Dec2', action: 'Buy', usdc: 1.999998, tokens: 2.400958, tokenName: 'No', timestamp: 1764371177 },
  { market: '300-319 Nov25-Dec2', action: 'Sell', usdc: 2.184, tokens: 2.4, tokenName: 'No', timestamp: 1764459062 },
  { market: 'Polymarket US 2025', action: 'Sell', usdc: 1.26848, tokens: 1.28, tokenName: 'Yes', timestamp: 1764793285 },
];

// Track positions using Polymarket's weighted average cost method
interface Position {
  tokens: number;
  totalCost: number;  // total USDC spent
  avgCost: number;    // per token
}

const positions = new Map<string, Position>();
let totalRealizedPnl = 0;

console.log('TRADE-BY-TRADE PNL CALCULATION (Polymarket Subgraph Method)');
console.log('='.repeat(90));
console.log('Formula: PnL = (sell_price - avg_cost) * tokens_sold\n');

for (const trade of ledger) {
  const key = trade.market + ':' + trade.tokenName;
  let pos = positions.get(key) || { tokens: 0, totalCost: 0, avgCost: 0 };

  if (trade.action === 'Buy') {
    // Update weighted average cost
    const newTotalCost = pos.totalCost + trade.usdc;
    const newTokens = pos.tokens + trade.tokens;
    const newAvgCost = newTotalCost / newTokens;
    const buyPrice = trade.usdc / trade.tokens;

    console.log(`BUY  ${trade.market.substring(0,35).padEnd(35)} | ${trade.tokens.toFixed(6)} @ $${buyPrice.toFixed(4)} | Total: ${newTokens.toFixed(6)} @ avg $${newAvgCost.toFixed(4)}`);

    positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: newAvgCost });
  }
  else if (trade.action === 'Sell') {
    const sellPrice = trade.usdc / trade.tokens;
    const pnl = (sellPrice - pos.avgCost) * trade.tokens;
    totalRealizedPnl += pnl;

    console.log(`SELL ${trade.market.substring(0,35).padEnd(35)} | ${trade.tokens.toFixed(6)} @ $${sellPrice.toFixed(4)} | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);

    // Reduce position
    const newTokens = pos.tokens - trade.tokens;
    const newTotalCost = pos.avgCost * newTokens;
    positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: pos.avgCost });
  }
  else if (trade.action === 'Redeem') {
    // Redemption at $1.00 per token (winner)
    const redeemPrice = 1.0;
    // Redeem uses same key
    const tokensRedeemed = Math.min(trade.tokens, pos.tokens);
    const pnl = (redeemPrice - pos.avgCost) * tokensRedeemed;
    totalRealizedPnl += pnl;

    console.log(`REDM ${trade.market.substring(0,35).padEnd(35)} | ${tokensRedeemed.toFixed(6)} @ $1.0000 | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);

    const newTokens = pos.tokens - tokensRedeemed;
    positions.set(key, { tokens: newTokens, totalCost: pos.avgCost * newTokens, avgCost: pos.avgCost });
  }
}

console.log('\n' + '='.repeat(90));
console.log(`CALCULATED REALIZED PNL: $${totalRealizedPnl.toFixed(2)}`);
console.log(`UI SHOWS:                $1.16`);
console.log(`DIFFERENCE:              $${(totalRealizedPnl - 1.16).toFixed(2)}`);
console.log('='.repeat(90));

// Show remaining positions (unrealized)
console.log('\nRemaining positions (unrealized):');
for (const [key, pos] of positions) {
  if (pos.tokens > 0.001) {
    console.log(`  ${key}: ${pos.tokens.toFixed(6)} tokens @ avg $${pos.avgCost.toFixed(4)}`);
  }
}
