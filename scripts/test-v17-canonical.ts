/**
 * Test canonical V17 engine on f918 wallet
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computePnLV17 } from '../lib/pnl/uiActivityEngineV17';

async function main() {
  const wallet = '0xf918977ef9d3f101385eda508621d5f835fa9052';
  const UI_PNL = 1.16;

  console.log('Testing canonical V17 on f918...\n');

  const result = await computePnLV17(wallet);

  console.log('V17 Canonical Results:');
  console.log(`  Realized PnL: $${result.realized_pnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${result.unrealized_pnl.toFixed(2)}`);
  console.log(`  Total PnL: $${result.total_pnl.toFixed(2)}`);
  console.log(`  Total Trades: ${result.total_trades}`);
  console.log(`  Positions: ${result.positions_count}`);
  console.log(`  Markets: ${result.markets_traded}`);
  console.log(`  Resolutions: ${result.resolutions}`);

  console.log('\nComparison to UI:');
  const error = ((result.total_pnl - UI_PNL) / Math.abs(UI_PNL)) * 100;
  console.log(`  UI PnL: $${UI_PNL}`);
  console.log(`  V17 PnL: $${result.total_pnl.toFixed(2)}`);
  console.log(`  Error: ${error.toFixed(1)}%`, Math.abs(error) < 10 ? '✅' : '❌');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
