import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLWithConfidence } from '../lib/pnl/pnlEngineV1';

async function check() {
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  console.log('Running V1 engine for:', wallet);
  const result = await getWalletPnLWithConfidence(wallet);
  
  console.log('\n=== V1 Engine Result ===');
  console.log(JSON.stringify(result, null, 2));
  
  process.exit(0);
}
check();
