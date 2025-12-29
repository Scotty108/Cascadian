/**
 * Test getWalletMarketPnl - verify category breakdown works
 */

import { getWalletMarketPnl, formatUsd } from '../../lib/pnl/getWalletMarketPnl';

// Benchmark wallet W2 - UI shows $4,404.92
const W2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

async function main() {
  console.log('Testing getWalletMarketPnl with W2...\n');

  const result = await getWalletMarketPnl(W2);

  console.log('=== SUMMARY ===');
  console.log(`Wallet: ${result.wallet}`);
  console.log(`Total Realized PnL: ${formatUsd(result.totalRealizedPnl)}`);
  console.log(`Total Unrealized PnL: ${formatUsd(result.totalUnrealizedPnl)}`);
  console.log(`Total PnL: ${formatUsd(result.totalPnl)}`);
  console.log();

  console.log('=== BY CATEGORY ===');
  for (const cat of result.byCategory) {
    console.log(`${cat.category}: ${formatUsd(cat.realizedPnl)} (${cat.marketCount} markets)`);
  }
  console.log();

  console.log('=== TOP 10 MARKETS BY PNL ===');
  const top10 = result.byMarket.slice(0, 10);
  for (const market of top10) {
    const truncQuestion = market.question.length > 60
      ? market.question.slice(0, 60) + '...'
      : market.question;
    console.log(`${formatUsd(market.realizedPnl).padStart(10)} | ${market.category.padEnd(12)} | ${truncQuestion}`);
  }

  console.log('\n=== VALIDATION ===');
  const uiPnl = 4404.92;
  const error = ((result.totalRealizedPnl - uiPnl) / uiPnl * 100).toFixed(2);
  console.log(`UI PnL: $${uiPnl.toFixed(2)}`);
  console.log(`Our PnL: $${result.totalRealizedPnl.toFixed(2)}`);
  console.log(`Error: ${error}%`);
}

main().catch(console.error);
