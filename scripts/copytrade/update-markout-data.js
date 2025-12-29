const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./exports/copytrade/user-wallet-evaluation-2025-12-18.json'));

// All markout results
const allMarkout = {
  // Original batch
  '@eightpenguins': 0.41,
  '@scottilicious': 0.33,
  '@completion': 0.31,
  '@gmanas': 0.24,
  '@Hans323': 0.21,
  '@kch123': 0.20,
  '@kingofcoinflips': 0.15,
  '@ZerOptimist': 0.12,
  '@justdance': 0.12,
  '@LlamaEnjoyer': 0.09,
  '@Sharky6999': 0.08,
  '@chungguskhan': 0.07,
  '@Anjun': 0.03,
  '@easyclap': -0.01,
  '@primm': -0.02,
  '@darkrider11': -0.10,
  '@piastri': -0.69,
  // New batch
  '@RN1': 0.25,
  '@0x066423...': -16.19,
  '@Qualitative': 0.01,
  '@FirstOrder': 0.82,
  'Profile link 1': 0.19,
  '@0xheavy888': 0.29,
  '@VvVv': 0.10,
  '@1TickWonder2': -0.19,
  '@25usdc': 0.10,
  'Super forecaster': 0.39,
  '@SynthDataDotCo': 0.06,
  '@esports095': -0.12,
  '@HolyMoses7': 0.00,
  '@Toncar16': 0.17,
  'Profile link 3': -0.25,
  'Profile link 4': null,
  'Profile link 2': 0.22,
  '@coinman2': 0.00,
  '@antman-batman': -0.32,
  '@jeb2016': 0.28,
};

function getVerdict(sharpe) {
  if (sharpe === null) return 'NO_DATA';
  if (sharpe > 0.3) return 'STRONG';
  if (sharpe >= 0.15) return 'OKAY';
  if (sharpe >= 0) return 'WEAK';
  return 'NEGATIVE';
}

// Update all wallets
for (const w of data.wallets) {
  const sharpe = allMarkout[w.name];
  if (sharpe !== undefined) {
    w.markout_sharpe = sharpe;
    w.markout_verdict = getVerdict(sharpe);
  }
}

// Update the top 5 based on ALL markout data
data.top_5_by_markout = {
  methodology: 'Wallets with Sharpe >= 0.15 AND (active positions OR strong track record)',
  note: '@FirstOrder has 0.82 Sharpe but only 57 trades - not statistically reliable',
  picks: [
    { rank: 1, name: 'Super forecaster', sharpe: 0.39, reason: 'Strong Sharpe + good trade count (4281)' },
    { rank: 2, name: '@gmanas', sharpe: 0.24, positions: 584300, reason: 'High skill + huge active positions' },
    { rank: 3, name: '@0xheavy888', sharpe: 0.29, reason: 'Strong Sharpe, esports specialist' },
    { rank: 4, name: '@jeb2016', sharpe: 0.28, reason: 'Strong Sharpe + 25k trades' },
    { rank: 5, name: '@RN1', sharpe: 0.25, reason: 'Good Sharpe + 29k trades' },
  ],
  honorable_mentions: [
    { name: '@Hans323', sharpe: 0.21, reason: 'Weather specialist' },
    { name: '@kch123', sharpe: 0.20, reason: 'Good but 77k views (crowded)' },
    { name: 'Profile link 1', sharpe: 0.19, reason: '94k trades - massive volume' },
    { name: '@Toncar16', sharpe: 0.17, reason: 'Decent Sharpe + 10k trades' },
  ],
  avoid: [
    { name: '@0x066423...', sharpe: -16.19, reason: 'Extreme negative - worst in dataset' },
    { name: '@primm', sharpe: -0.02, reason: 'Despite $1.1M PnL, negative edge' },
    { name: '@antman-batman', sharpe: -0.32, reason: 'Strong negative edge' },
    { name: '@easyclap', sharpe: -0.01, reason: 'Despite $353k PnL, slight negative' },
  ],
};

fs.writeFileSync('./exports/copytrade/user-wallet-evaluation-2025-12-18.json', JSON.stringify(data, null, 2));
console.log('Updated all wallets with markout data');

// Print summary
console.log('');
console.log('FINAL TOP 10 BY MARKOUT SHARPE (all wallets):');
const sorted = data.wallets
  .filter(w => w.markout_sharpe !== null && w.markout_sharpe !== undefined)
  .sort((a, b) => b.markout_sharpe - a.markout_sharpe);

let rank = 1;
for (const w of sorted.slice(0, 10)) {
  const verdict = w.markout_verdict;
  const pnl = Math.round(w.pnl_60d || 0).toLocaleString();
  console.log(`  #${rank++}: ${w.name.padEnd(18)} Sharpe: ${w.markout_sharpe.toFixed(2).padStart(6)} | PnL: $${pnl.padStart(10)} | ${verdict}`);
}

console.log('');
console.log('WORST 5 BY MARKOUT SHARPE (avoid these):');
const worst = sorted.slice(-5).reverse();
for (const w of worst) {
  const verdict = w.markout_verdict;
  const pnl = Math.round(w.pnl_60d || 0).toLocaleString();
  console.log(`  ${w.name.padEnd(18)} Sharpe: ${w.markout_sharpe.toFixed(2).padStart(7)} | PnL: $${pnl.padStart(10)} | ${verdict}`);
}
