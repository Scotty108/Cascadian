import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: SCHEMA INSPECTION ===\n');

  const tablesToCheck = [
    'vw_trades_canonical',
    'clob_fills',
    'fact_trades_clean',
    'erc1155_transfers',
    'wallet_metrics_complete',
    'outcome_positions_v2_backup_20251112T061455'
  ];

  for (const tableName of tablesToCheck) {
    console.log(`\n=== ${tableName} ===\n`);

    try {
      const schemaQuery = await clickhouse.query({
        query: `DESCRIBE TABLE ${tableName}`,
        format: 'JSONEachRow'
      });

      const schema: any[] = await schemaQuery.json();

      // Look for wallet-related columns
      const walletCols = schema.filter(col =>
        col.name.toLowerCase().includes('wallet') ||
        col.name.toLowerCase().includes('address') ||
        col.name.toLowerCase().includes('user') ||
        col.name.toLowerCase().includes('trader')
      );

      if (walletCols.length > 0) {
        console.log('Wallet-related columns:');
        walletCols.forEach(col => {
          console.log(`   ${col.name.padEnd(30)} ${col.type}`);
        });
      } else {
        console.log('❌ No obvious wallet columns found');
      }

      // Show first few columns for context
      console.log('\nAll columns:');
      schema.slice(0, 10).forEach(col => {
        console.log(`   ${col.name.padEnd(30)} ${col.type}`);
      });
      if (schema.length > 10) {
        console.log(`   ... and ${schema.length - 10} more columns`);
      }

    } catch (error: any) {
      console.log(`ERROR: ${error.message}`);
    }
  }
}

main().catch(console.error);
