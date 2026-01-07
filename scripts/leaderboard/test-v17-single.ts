import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

async function testV17(wallet: string) {
  console.log(`Testing V17 for wallet: ${wallet}\n`);
  
  const engine = createV17Engine();
  const pnl = await engine.compute(wallet);
  
  console.log(`V17 Results:`);
  console.log(`  Realized PnL: $${pnl.realized_pnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${pnl.unrealized_pnl.toFixed(2)}`);
  console.log(`  Total PnL: $${pnl.total_pnl.toFixed(2)}`);
  console.log(`  Total Gain: $${pnl.total_gain.toFixed(2)}`);
  console.log(`  Total Loss: $${pnl.total_loss.toFixed(2)}`);
  console.log(`  Positions: ${pnl.positions.length}`);
  
  console.log(`\nUI shows: -$3,452.32`);
}

testV17('0xda5fff24aa9d889d6366da205029c73093102e9b').catch(console.error);
