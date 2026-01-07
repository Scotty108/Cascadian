/**
 * Test V19s engine on f918
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { calculateV19sPnL } from '../lib/pnl/uiActivityEngineV19s';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

async function main() {
  console.log('Testing V19s on f918...\n');

  const result = await calculateV19sPnL(WALLET);

  console.log('V19s Results:');
  console.log(`  Realized PnL: $${result.realized_pnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${result.unrealized_pnl.toFixed(2)}`);
  console.log(`  Total PnL: $${result.total_pnl.toFixed(2)}`);

  console.log('\nComparison to UI:');
  const error = ((result.total_pnl - UI_PNL) / Math.abs(UI_PNL)) * 100;
  console.log(`  UI PnL: $${UI_PNL}`);
  console.log(`  V19s PnL: $${result.total_pnl.toFixed(2)}`);
  console.log(`  Error: ${error.toFixed(1)}%`, Math.abs(error) < 10 ? '✅' : '❌');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
