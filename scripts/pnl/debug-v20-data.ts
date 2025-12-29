import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallets = [
  '0x35f0a66aeea6b22dce4b0e4fdea20e8d4de7b776',
  '0x343934e5f1c2ba3f8f09cad21a1e83c8a74e3f64',
  '0x227c55e83eb5ae05e6f14bbfcc4f9bf6d6bda303',
  '0x222adce7f89c1c69f1f0dca8a2bc3c87d9cc103c',
  '0x0e5f63cc299bf78e46da9971aad9a36a13e5cf38',
];

async function main() {
  console.log('=== Checking 5 test wallets across tables ===\n');
  
  for (const wallet of wallets) {
    const shortAddr = wallet.slice(0, 12);
    
    // Check v9_clob_tbl
    const v9Query = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v9_clob_tbl 
              WHERE lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const v9 = (await v9Query.json() as any[])[0]?.cnt || 0;

    // Check pm_trader_events_v2
    const v2Query = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_trader_events_v2 
              WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0`,
      format: 'JSONEachRow'
    });
    const v2 = (await v2Query.json() as any[])[0]?.cnt || 0;

    console.log(shortAddr + '...:  v9_clob=' + v9 + '  v2=' + v2);
  }

  // Get a random wallet that EXISTS in v9_clob_tbl
  console.log('\n=== Finding a wallet with actual data in v9_clob_tbl ===');
  const existsQuery = await clickhouse.query({
    query: `SELECT wallet_address, count() as trades 
            FROM pm_unified_ledger_v9_clob_tbl 
            GROUP BY wallet_address 
            HAVING trades > 100 
            LIMIT 3`,
    format: 'JSONEachRow'
  });
  const exists = await existsQuery.json() as any[];
  console.log('Wallets with data in v9_clob_tbl:');
  exists.forEach((e: any) => console.log('  ' + e.wallet_address + ': ' + e.trades + ' trades'));
}
main();
