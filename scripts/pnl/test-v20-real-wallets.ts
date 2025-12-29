import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

async function main() {
  console.log('=== Finding real wallets with trades ===\n');
  
  // Get 5 wallets with significant activity from v9_clob_tbl
  const walletsQuery = await clickhouse.query({
    query: `SELECT 
              wallet_address, 
              count() as trades,
              abs(sum(usdc_delta)) as volume
            FROM pm_unified_ledger_v9_clob_tbl 
            GROUP BY wallet_address 
            HAVING trades > 500 AND trades < 10000
            ORDER BY volume DESC
            LIMIT 5`,
    format: 'JSONEachRow'
  });
  const wallets = await walletsQuery.json() as any[];
  
  console.log('Testing these wallets:');
  wallets.forEach((w: any) => console.log('  ' + w.wallet_address + ': ' + w.trades + ' trades, $' + Math.round(w.volume) + ' volume'));
  console.log('');

  // Test V20 on each
  console.log('=== V20 Results ===\n');
  for (const w of wallets) {
    const result = await calculateV20PnL(w.wallet_address);
    console.log(w.wallet_address.slice(0, 12) + '...');
    console.log('  Total PnL: $' + result.total_pnl.toFixed(2));
    console.log('  Realized: $' + result.realized_pnl.toFixed(2));
    console.log('  Unrealized: $' + result.unrealized_pnl.toFixed(2));
    console.log('  Positions: ' + result.positions + ' (' + result.resolved + ' resolved)');
    console.log('');
  }
}
main();
