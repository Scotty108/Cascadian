/**
 * Test CCR-v1 engine with unified event stream (CLOB + CTF)
 *
 * This tests the refactored engine that processes CTF events as proper trades
 * per the Polymarket subgraph logic.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const TEST_WALLETS = [
  { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052', uiPnl: 1.16 },
  { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61', uiPnl: 690 },
];

async function main() {
  console.log('Testing CCR-v1 with unified event stream (CLOB + CTF)');
  console.log('='.repeat(70));

  for (const w of TEST_WALLETS) {
    console.log(`\n${w.name} - UI PnL: $${w.uiPnl.toLocaleString()}`);
    console.log('-'.repeat(50));

    try {
      const start = Date.now();
      const metrics = await computeCCRv1(w.addr);
      const elapsed = Date.now() - start;

      console.log(`\nResults (${elapsed}ms):`);
      console.log(`  Realized PnL: $${metrics.realized_pnl.toFixed(2)}`);
      console.log(`  Unrealized PnL: $${metrics.unrealized_pnl.toFixed(2)}`);
      console.log(`  Total PnL: $${metrics.total_pnl.toFixed(2)}`);
      console.log(`  Total Trades: ${metrics.total_trades}`);
      console.log(`  Volume: $${metrics.volume_traded.toFixed(2)}`);
      console.log(`  Win Rate: ${(metrics.win_rate * 100).toFixed(1)}%`);
      console.log(`  Confidence: ${metrics.pnl_confidence}`);

      console.log(`\nCTF Attribution:`);
      console.log(`  Split Tokens: ${metrics.ctf_split_tokens.toFixed(2)}`);
      console.log(`  Merge Tokens: ${metrics.ctf_merge_tokens.toFixed(2)}`);
      console.log(`  Redemption Tokens: ${metrics.ctf_redemption_tokens.toFixed(2)}`);

      console.log(`\nExternal Sells:`);
      console.log(`  Tokens: ${metrics.external_sell_tokens.toFixed(2)}`);
      console.log(`  USDC: $${metrics.external_sell_usdc.toFixed(2)}`);
      console.log(`  Ratio: ${(metrics.external_sell_ratio * 100).toFixed(1)}%`);

      const error = ((metrics.total_pnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100;
      console.log(`\nComparison to UI:`);
      console.log(`  UI PnL: $${w.uiPnl.toLocaleString()}`);
      console.log(`  Engine PnL: $${metrics.total_pnl.toFixed(2)}`);
      console.log(`  Error: ${error.toFixed(1)}% ${Math.abs(error) < 10 ? '✅' : '❌'}`);
    } catch (err) {
      console.error(`Error: ${err}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('Done!');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
