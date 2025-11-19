import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Executors sorted by absolute P&L (from previous analysis)
const EXECUTORS_BY_PNL = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // $2.58B bloat
  '0x461f3e886dca22e561eee224d283e08b8fb47a07', // $40.5M
  '0x0540f430df85c770e0a4fb79d8499d71ebc298eb', // $53.1M
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', // $16.5M
  '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', // $17.0M
  '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1', // $15.8M
  '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009', // $11.2M
  '0xb68a63d94676c8630eb3471d82d3d47b7533c568', // $8.4M
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', // $6.6M
  '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b', // $6.5M
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c', // $123.7M
  '0xee00ba338c59557141789b127927a55f5cc5cea1', // $2.3M
];

async function progressiveExecutorAnalysis() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET - PROGRESSIVE EXECUTOR ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Adding executors one-by-one to show cumulative impact\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Start with base wallet only
  const baseWallets = [XCN_CANONICAL];

  console.log('STEP 0: Base wallet only (no executors)\n');
  await analyzeCluster(baseWallets, 'Base wallet only');

  // Add executors one by one
  for (let i = 0; i < EXECUTORS_BY_PNL.length; i++) {
    const executor = EXECUTORS_BY_PNL[i];
    baseWallets.push(executor);

    console.log(`\nSTEP ${i + 1}: + Executor ${executor.substring(0, 10)}...\n`);
    await analyzeCluster(baseWallets, `Base + ${i + 1} executor${i === 0 ? '' : 's'}`);

    // Flag major jumps
    if (i === 0) {
      console.log('  🔴 FIRST EXECUTOR ADDED - Check if jump is reasonable\n');
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('RECOMMENDATIONS:\n');
  console.log('1. Review each step where volume/P&L jumps significantly');
  console.log('2. Remove executors that cause non-human scale increases');
  console.log('3. Require strong evidence for any executor adding >$1M volume');
  console.log('4. Consider using base wallet only until executor relationships proven\n');
}

async function analyzeCluster(wallets: string[], label: string) {
  const walletList = wallets.map(w => `'${w.toLowerCase()}'`).join(', ');

  const query = `
    SELECT
      sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl,
      sum(usd_value) AS volume,
      count() AS trades,
      uniq(condition_id_norm_v3) AS markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
      AND wallet_address IN (${walletList})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  if (data.length > 0) {
    const d = data[0];
    const pnl = parseFloat(d.trade_pnl);
    const volume = parseFloat(d.volume);
    const trades = parseInt(d.trades);
    const markets = parseInt(d.markets);

    console.log(`  ${label}:`);
    console.log(`    Wallets:   ${wallets.length}`);
    console.log(`    Trade P&L: $${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    Volume:    $${volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    Trades:    ${trades.toLocaleString()}`);
    console.log(`    Markets:   ${markets.toLocaleString()}`);

    // Flag warnings
    if (Math.abs(pnl) > 1000000) {
      console.log('    ⚠️  P&L exceeds $1M - verify executor evidence');
    }
    if (volume > 1000000) {
      console.log('    ⚠️  Volume exceeds $1M - verify executor evidence');
    }
    if (trades > 10000) {
      console.log('    ⚠️  Trades exceed 10k - verify executor evidence');
    }
    if (Math.abs(pnl) < 200000 && volume < 200000 && trades < 1000) {
      console.log('    ✅ Human scale - looks reasonable');
    }
  }
}

progressiveExecutorAnalysis()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
