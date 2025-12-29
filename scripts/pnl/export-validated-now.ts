/**
 * Export validated wallets we already have - FAST
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';

// Read existing validated data
const uiParityPath = path.join(process.cwd(), 'data', 'ui-parity-results.json');
const validatedPath = path.join(process.cwd(), 'data', 'validated-wallets.json');

const uiParity = JSON.parse(fs.readFileSync(uiParityPath, 'utf-8'));
const validated = JSON.parse(fs.readFileSync(validatedPath, 'utf-8'));

// Combine all validated wallets
const allWallets: any[] = [];

// From ui-parity-results
uiParity.results.forEach((r: any) => {
  allWallets.push({
    wallet: r.wallet_address,
    polymarket_url: `https://polymarket.com/profile/${r.wallet_address}`,
    n_trades: r.clob_trade_count || 0,
    pnl_realized_net: r.v20b_net,
    ui_net: r.ui_net,
    delta_pct: r.pct_delta,
    status: r.status,
    source: 'ui-parity',
  });
});

// From validated-wallets
validated.validated_wallets.forEach((r: any) => {
  if (!allWallets.find(w => w.wallet === r.wallet)) {
    allWallets.push({
      wallet: r.wallet,
      polymarket_url: `https://polymarket.com/profile/${r.wallet}`,
      n_trades: r.mapped_clob_rows || 0,
      n_markets: r.markets || 0,
      pnl_realized_net: r.v20b_net,
      ui_net: r.ui_net,
      delta_pct: r.delta_pct,
      external_sell_pct: r.clamp_pct || 0,
      status: r.status,
      source: 'validated-wallets',
    });
  }
});

// Export
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const exportsDir = path.join(process.cwd(), 'data', 'exports');

// CSV
const csvPath = path.join(exportsDir, `clob_validated_wallets.${timestamp}.csv`);
const csvHeader = 'wallet,polymarket_url,n_trades,n_markets,pnl_realized_net,ui_net,delta_pct,external_sell_pct,status,source';
const csvRows = allWallets.map(w =>
  `${w.wallet},${w.polymarket_url},${w.n_trades || ''},${w.n_markets || ''},${w.pnl_realized_net},${w.ui_net},${w.delta_pct},${w.external_sell_pct || ''},${w.status},${w.source}`
);
fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

// JSON
const jsonPath = path.join(exportsDir, `clob_validated_wallets.${timestamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  total: allWallets.length,
  wallets: allWallets,
}, null, 2));

console.log(`Exported ${allWallets.length} validated wallets`);
console.log(`CSV: ${csvPath}`);
console.log(`JSON: ${jsonPath}`);
console.log('');
allWallets.forEach((w, i) => {
  const pnlStr = w.pnl_realized_net >= 0
    ? `+$${w.pnl_realized_net?.toLocaleString()}`
    : `-$${Math.abs(w.pnl_realized_net)?.toLocaleString()}`;
  console.log(`${i+1}. ${w.wallet.slice(0,12)}... | PnL: ${pnlStr.padStart(14)} | delta: ${w.delta_pct}%`);
});
