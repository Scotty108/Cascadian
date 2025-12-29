import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

// One of the test wallets
const wallet = '0x227c55e83eb5ae05e6f14bbfcc4f9bf6d6bda303';

async function main() {
  console.log('Searching for wallet:', wallet, '\n');
  
  // List of all tables to check
  const tableChecks = [
    { table: 'pm_trader_events_v2', col: 'trader_wallet', filter: 'is_deleted = 0' },
    { table: 'pm_unified_ledger_v9_clob_tbl', col: 'wallet_address', filter: '1=1' },
    { table: 'pm_unified_ledger_v8_tbl', col: 'wallet_address', filter: '1=1' },
    { table: 'pm_ctf_events', col: 'trader', filter: '1=1' },
    { table: 'pm_erc1155_transfers', col: 'from_address', filter: '1=1' },
    { table: 'pm_erc1155_transfers', col: 'to_address', filter: '1=1' },
    { table: 'pm_erc20_usdc_flows', col: 'from_address', filter: '1=1' },
    { table: 'pm_erc20_usdc_flows', col: 'to_address', filter: '1=1' },
    { table: 'pm_fpmm_trades', col: 'user_address', filter: '1=1' },
  ];

  for (const check of tableChecks) {
    try {
      const query = `SELECT count() as cnt FROM ${check.table} 
                     WHERE lower(${check.col}) = lower('${wallet}') 
                     AND ${check.filter}`;
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = await result.json() as any[];
      const cnt = rows[0]?.cnt || 0;
      if (cnt > 0) {
        console.log('✅ ' + check.table + '.' + check.col + ': ' + cnt + ' rows');
      } else {
        console.log('   ' + check.table + '.' + check.col + ': 0');
      }
    } catch (e: any) {
      console.log('❌ ' + check.table + ': ' + e.message.slice(0, 50));
    }
  }

  // Also check: maybe we need exact case match?
  console.log('\n=== Case sensitivity check ===');
  const caseQuery = await clickhouse.query({
    query: `SELECT trader_wallet, count() as cnt FROM pm_trader_events_v2 
            WHERE trader_wallet LIKE '%227c55%' 
            GROUP BY trader_wallet LIMIT 5`,
    format: 'JSONEachRow'
  });
  const caseRows = await caseQuery.json() as any[];
  console.log('Wallets containing 227c55:', caseRows);
}
main();
