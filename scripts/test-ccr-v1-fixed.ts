/**
 * Test the fixed CCR-v1 engine on f918 and Lheo
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const TEST_WALLETS = [
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'f918', uiPnl: 1.16, notes: 'Fully realized' },
  { wallet: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61', name: 'Lheo', uiPnl: 690, notes: 'Has active positions' },
];

async function main() {
  console.log('Testing CCR-v1 with MAKER-only fix\n');
  console.log('='.repeat(80));

  for (const { wallet, name, uiPnl, notes } of TEST_WALLETS) {
    console.log(`\n${name} - UI PnL: $${uiPnl} (${notes})`);
    console.log('-'.repeat(50));

    try {
      const result = await computeCCRv1(wallet);

      console.log(`\nResults:`);
      console.log(`  Realized PnL: $${result.realized_pnl}`);
      console.log(`  Unrealized PnL: $${result.unrealized_pnl}`);
      console.log(`  Total PnL: $${result.total_pnl}`);
      console.log(`  Total Trades: ${result.total_trades}`);
      console.log(`  Volume: $${result.volume_traded}`);
      console.log(`  Win Rate: ${(result.win_rate * 100).toFixed(1)}%`);
      console.log(`  Confidence: ${result.pnl_confidence}`);

      console.log(`\nCTF Attribution:`);
      console.log(`  Split Tokens: ${result.ctf_split_tokens}`);
      console.log(`  Merge Tokens: ${result.ctf_merge_tokens}`);
      console.log(`  Redemption Tokens: ${result.ctf_redemption_tokens}`);

      console.log(`\nExternal Sells:`);
      console.log(`  Tokens: ${result.external_sell_tokens}`);
      console.log(`  USDC: $${result.external_sell_usdc}`);
      console.log(`  Ratio: ${(result.external_sell_ratio * 100).toFixed(1)}%`);

      const error = ((result.total_pnl - uiPnl) / Math.abs(uiPnl)) * 100;
      console.log(`\nComparison to UI:`);
      console.log(`  UI PnL: $${uiPnl}`);
      console.log(`  Engine PnL: $${result.total_pnl}`);
      console.log(`  Error: ${error.toFixed(1)}%`, Math.abs(error) < 10 ? '✅' : '❌');
    } catch (e) {
      console.error(`Error: ${e}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Done!');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
