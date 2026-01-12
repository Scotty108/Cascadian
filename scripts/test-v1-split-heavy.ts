import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

async function main() {
  console.log('Testing V1 for SPLIT_HEAVY...');
  const result = await getWalletPnLV1('0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba');
  console.log('V1 Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
