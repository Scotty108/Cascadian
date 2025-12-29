import fs from 'fs';

const coverage = JSON.parse(fs.readFileSync('tmp/ui_resolution_coverage_trader_strict_v2_2025_12_07.json', 'utf8'));

// Filter for high coverage (>=95%) and >=5 conditions
const highCov = coverage.filter((r: any) => r.base_cov >= 0.95 && r.total_conds >= 5);

console.log('High coverage wallets (>=95%, >=5 conditions):', highCov.length);
console.log('');

// Sort by coverage descending, then by total_conds descending
highCov.sort((a: any, b: any) => {
  if (b.base_cov !== a.base_cov) return b.base_cov - a.base_cov;
  return b.total_conds - a.total_conds;
});

console.log('| Wallet | Conditions | Resolved | Coverage |');
console.log('|--------|-----------|----------|----------|');
for (const r of highCov) {
  console.log(`| ${r.wallet.slice(0,6)}...${r.wallet.slice(-4)} | ${r.total_conds} | ${r.base_resolved} | ${(r.base_cov * 100).toFixed(1)}% |`);
}

// Save just the wallet addresses for the high-coverage subset
const walletList = highCov.map((r: any) => r.wallet);
fs.writeFileSync('tmp/ui_wallets_trader_strict_v2_highcov.json', JSON.stringify(walletList, null, 2));
console.log('');
console.log('Saved', walletList.length, 'high-coverage wallets to tmp/ui_wallets_trader_strict_v2_highcov.json');
