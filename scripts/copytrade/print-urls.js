const data = require('../../exports/copytrade/user-wallet-evaluation-2025-12-18.json');

console.log('POLYMARKET PROFILE URLS (sorted by 24h Markout Sharpe)');
console.log('=======================================================\n');

const sorted = data.wallets
  .filter(w => w.wallet)
  .sort((a, b) => (b.markout_sharpe || -999) - (a.markout_sharpe || -999));

for (const w of sorted) {
  const sharpe = w.markout_sharpe != null ? w.markout_sharpe.toFixed(2) : 'N/A';
  const verdict = w.markout_verdict || '';
  console.log('https://polymarket.com/profile/' + w.wallet);
  console.log('  ' + w.name + ' | Sharpe: ' + sharpe + ' | ' + verdict + '\n');
}
