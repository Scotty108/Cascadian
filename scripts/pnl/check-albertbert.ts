/**
 * Quick check of V19s for the top CLV wallet to verify synthetic realized
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { calculateV19sPnL } from '../../lib/pnl/uiActivityEngineV19s';

async function main() {
  // Check the problematic wallet #4
  const wallet = '0xbd5decf7c10f667f631e3fc8cfcf6b27bdfe9a7f';
  console.log(`\nRunning V19s for ${wallet}...\n`);

  const result = await calculateV19sPnL(wallet);

  console.log('V19s Result:');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n--- Compare to UI ---');
  console.log('UI All-Time P&L: -$3,205.50');
  console.log('UI shows many losing sports bets at 0¢');
  console.log('CLV showed: 67.9% with 100% hit rate');

  const totalPnL = result.total_pnl;
  const uiPnL = -3205.50;
  const delta = totalPnL - uiPnL;
  console.log(`\nV19s: $${totalPnL.toFixed(2)}`);
  console.log(`UI:   $${uiPnL.toFixed(2)}`);
  console.log(`Delta: $${delta.toFixed(2)}`);
}

main().catch(console.error);
