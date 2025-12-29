import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Finding wallets for UI validation ===\n');

  // Simpler query - just find active wallets
  const query = `
    SELECT 
      wallet_address,
      count() as total_trades,
      countDistinct(condition_id) as markets,
      abs(sum(usdc_delta)) as volume
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE source_type = 'CLOB'
      AND condition_id IS NOT NULL
    GROUP BY wallet_address
    HAVING total_trades BETWEEN 200 AND 3000
      AND markets >= 5
    ORDER BY volume DESC
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  
  console.log('Found ' + rows.length + ' wallets:\n');
  
  rows.forEach((r: any, i: number) => {
    console.log((i+1) + '. ' + r.wallet_address);
    console.log('   Trades: ' + r.total_trades + ' | Markets: ' + r.markets);
    console.log('   Volume: $' + Math.round(r.volume).toLocaleString());
    console.log('   URL: https://polymarket.com/portfolio/' + r.wallet_address);
    console.log('');
  });
}

main().catch(console.error);
