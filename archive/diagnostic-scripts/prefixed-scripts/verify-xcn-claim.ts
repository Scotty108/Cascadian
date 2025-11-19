import { config } from 'dotenv';
import { getClickHouseClient } from './lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

const client = getClickHouseClient();

async function main() {
  console.log('\n=== VERIFYING XCN WALLET 12,761x DUPLICATION CLAIM ===\n');

  // Search across all tables for XCN wallet
  const tables = [
    'pm_trades_canonical_v3',
    'pm_clob_fills',
    'pm_erc1155_transfers',
    'pm_trades_raw',
  ];

  for (const table of tables) {
    console.log(`\nSEARCHING: ${table}`);
    console.log('-'.repeat(80));

    try {
      const query = await client.query({
        query: `
          SELECT
            wallet_address,
            count() AS total_rows,
            uniq(transaction_hash) AS unique_txs,
            round(total_rows / unique_txs, 2) AS duplication_factor
          FROM ${table}
          WHERE wallet_address ILIKE '%xcn%'
             OR wallet_address ILIKE '%strategy%'
          GROUP BY wallet_address
          ORDER BY total_rows DESC
        `,
        format: 'JSONEachRow',
      });
      const results = await query.json();

      if (results.length > 0) {
        console.log(`Found ${results.length} matching wallet(s):\n`);
        results.forEach((w: any) => {
          console.log(`  ${w.wallet_address}`);
          console.log(`    Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
        });
      } else {
        console.log('No matches found');
      }
    } catch (error: any) {
      console.log(`Error querying ${table}: ${error.message}`);
    }
  }

  // Check if there's a specific wallet that was referenced
  console.log('\n\nCHECKING SPECIFIC WALLET: 0x...');
  console.log('-'.repeat(80));
  console.log('Please provide the exact wallet address to check for 12,761x duplication.');

  // Let's also check for wallets with > 1000x duplication in ANY table
  console.log('\n\nSEARCHING FOR >1000x DUPLICATION IN ALL TABLES');
  console.log('-'.repeat(80));

  for (const table of tables) {
    try {
      const query = await client.query({
        query: `
          SELECT
            wallet_address,
            count() AS total_rows,
            uniq(transaction_hash) AS unique_txs,
            round(total_rows / unique_txs, 2) AS duplication_factor
          FROM ${table}
          GROUP BY wallet_address
          HAVING duplication_factor > 1000
          ORDER BY duplication_factor DESC
          LIMIT 10
        `,
        format: 'JSONEachRow',
      });
      const results = await query.json();

      if (results.length > 0) {
        console.log(`\n${table}: Found ${results.length} wallet(s) with >1000x duplication:`);
        results.forEach((w: any) => {
          console.log(`  ${w.wallet_address}`);
          console.log(`    Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
        });
      }
    } catch (error: any) {
      // Skip tables that don't exist or error out
    }
  }

  await client.close();
}

main().catch(console.error);
