import { readFileSync } from 'fs';

const fixture = JSON.parse(readFileSync('fixture_track_b_wallets.json', 'utf-8'));

// Take first wallet's trades
const wallet1 = fixture[0];
const topLocalTrades = wallet1.trades.slice(0,3);

console.log('Local wallet trades (first 3):');
topLocalTrades.forEach((trade, i) => {
  console.log(`  Trade ${i+1}: size=${trade.size} (≈${Number(trade.size/1000000).toFixed(1)}K in API terms)`);
});

console.log('\nScale Analysis:');
console.log('Total local volume:', wallet1.summary.total_volume.toLocaleString('en-US', {style: 'currency', currency: 'USD'}));
console.log('Implied API volume (÷1M):', (wallet1.summary.total_volume/1000000).toLocaleString('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 0}));
