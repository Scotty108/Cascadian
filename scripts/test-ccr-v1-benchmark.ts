import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

async function main() {
  const wallet = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
  console.log(`Testing CCR-v1 for wallet: ${wallet}`);

  const result = await computeCCRv1(wallet);

  console.log('\n=== CCR-v1 Results ===');
  console.log(`Realized PnL:   $${result.realized_pnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${result.unrealized_pnl.toFixed(2)}`);
  console.log(`Total PnL:      $${result.total_pnl.toFixed(2)}`);
  console.log(`Positions:      ${result.positions_count}`);
  console.log(`Resolved:       ${result.resolved_count}`);
  console.log(`Unresolved:     ${result.unresolved_count}`);
  console.log(`Win Rate:       ${(result.win_rate * 100).toFixed(1)}%`);
  console.log(`Confidence:     ${result.pnl_confidence}`);

  console.log('\nUI shows: $57.76 total, $10.68 positions value');
  console.log(`Delta from UI: $${(result.total_pnl - 57.76).toFixed(2)}`);

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
