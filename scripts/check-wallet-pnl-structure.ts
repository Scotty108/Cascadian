import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';

async function checkStructure() {
  console.log('Checking wallet_pnl_summary_final structure...\n');
  
  const schema = await clickhouse.query({
    query: `DESCRIBE TABLE wallet_pnl_summary_final`,
    format: 'JSONEachRow',
  });
  
  const columns = await schema.json();
  console.log('Columns:', JSON.stringify(columns, null, 2));
  console.log('\n');
  
  console.log('Sample data for wallet:', WALLET, '\n');
  const sample = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_pnl_summary_final
      WHERE wallet = '${WALLET}'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  
  const data = await sample.json();
  console.log('Sample:', JSON.stringify(data, null, 2));
  console.log('\n');
  
  console.log('Total P&L for this wallet:\n');
  const total = await clickhouse.query({
    query: `
      SELECT 
        wallet,
        SUM(total_pnl_usd) as sum_total_pnl,
        SUM(realized_pnl_usd) as sum_realized,
        SUM(unrealized_pnl_usd) as sum_unrealized,
        COUNT(*) as row_count
      FROM wallet_pnl_summary_final
      WHERE wallet = '${WALLET}'
      GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });
  
  const totals = await total.json();
  console.log('Totals:', JSON.stringify(totals, null, 2));
}

checkStructure().catch(console.error);
