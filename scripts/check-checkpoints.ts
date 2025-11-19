#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT 
        batch_number,
        wallets_processed,
        trades_inserted,
        status
      FROM global_ghost_ingestion_checkpoints
      ORDER BY batch_number
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await result.json();
  
  console.log('Checkpoint table contents:');
  console.log('');
  rows.forEach(row => {
    console.log(`Batch ${row.batch_number}: ${row.wallets_processed} wallets, ${row.trades_inserted} trades, status: ${row.status}`);
  });
  
  console.log('');
  const completed = rows.filter(r => r.status === 'completed');
  const totalWallets = completed.reduce((sum, r) => sum + r.wallets_processed, 0);
  const totalTrades = completed.reduce((sum, r) => sum + r.trades_inserted, 0);
  
  console.log(`Total completed batches: ${completed.length}`);
  console.log(`Total wallets processed: ${totalWallets}`);
  console.log(`Total trades inserted: ${totalTrades}`);
}

main().catch(console.error);
