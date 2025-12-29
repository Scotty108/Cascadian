import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  // Check v9_clob_tbl schema
  const schema = await clickhouse.query({
    query: 'DESCRIBE pm_unified_ledger_v9_clob_tbl',
    format: 'JSONEachRow'
  });
  const cols = await schema.json() as any[];
  console.log('=== pm_unified_ledger_v9_clob_tbl columns ===');
  cols.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));

  // Sample 1 row to see data format
  const sample = await clickhouse.query({
    query: `SELECT * FROM pm_unified_ledger_v9_clob_tbl LIMIT 1`,
    format: 'JSONEachRow'
  });
  const rows = await sample.json() as any[];
  console.log('\n=== Sample row ===');
  console.log(JSON.stringify(rows[0], null, 2));

  // Check what columns V20 needs vs what v9 has
  const neededCols = ['wallet_address', 'source_type', 'condition_id', 'outcome_index', 'usdc_delta', 'token_delta', 'payout_norm'];
  console.log('\n=== V20 Required Columns Check ===');
  const colNames = cols.map((c: any) => c.name);
  for (const needed of neededCols) {
    const found = colNames.includes(needed);
    console.log(`  ${needed}: ${found ? '✅' : '❌ MISSING'}`);
  }
}
main();
