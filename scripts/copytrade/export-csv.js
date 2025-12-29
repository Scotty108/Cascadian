const data = require('../../exports/copytrade/user-wallet-evaluation-2025-12-18.json');

// Header
console.log('wallet,name,category,pnl_60d,omega,win_pct,avg_entry,max_roi_pct,hold_hours,markout_sharpe,markout_verdict,positions_value,views,verdict,flags');

// Sort by markout Sharpe descending (nulls at end)
const sorted = data.wallets.sort((a, b) => {
  const aS = a.markout_sharpe ?? -999;
  const bS = b.markout_sharpe ?? -999;
  return bS - aS;
});

for (const w of sorted) {
  const entry = w.avg_entry || 0;
  const maxRoi = entry > 0 ? Math.round((1/entry - 1) * 100) : '';
  const flags = (w.flags || []).join(';') || '';
  const sharpe = w.markout_sharpe !== null && w.markout_sharpe !== undefined ? w.markout_sharpe : '';
  console.log([
    w.wallet,
    w.name,
    w.category || '',
    w.pnl_60d || '',
    w.omega || '',
    w.win_pct || '',
    w.avg_entry || '',
    maxRoi,
    w.hold_hours || '',
    sharpe,
    w.markout_verdict || '',
    w.positions_value || '',
    w.views || '',
    w.verdict,
    flags
  ].join(','));
}
