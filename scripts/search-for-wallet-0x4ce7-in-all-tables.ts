#!/usr/bin/env npx tsx
/**
 * Search for Wallet 0x4ce7 in ALL ClickHouse Tables
 * Maybe the historical trades exist but in different tables
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TARGET_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n🔍 SEARCHING FOR WALLET 0x4ce7 IN ALL TABLES\n');
  console.log('═'.repeat(80));

  // Get all tables
  const tablesQuery = await ch.query({
    query: `
      SELECT database, name
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine NOT LIKE '%View%'
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesQuery.json<any>();

  console.log(`\nSearching ${tables.length} tables...\n`);

  const results: any[] = [];

  for (const table of tables) {
    const fullName = `${table.database}.${table.name}`;

    try {
      // Get columns
      const columnsQuery = await ch.query({
        query: `DESCRIBE ${fullName}`,
        format: 'JSONEachRow'
      });

      const columns = await columnsQuery.json<any>();
      const columnNames = columns.map((c: any) => c.name.toLowerCase());

      // Check if table has wallet/address column
      const walletColumns = columnNames.filter((col: string) =>
        col.includes('wallet') ||
        col.includes('address') ||
        col.includes('user') ||
        col === 'from' ||
        col === 'to'
      );

      if (walletColumns.length > 0) {
        // Try to search for our wallet in each potential column
        for (const walletCol of walletColumns) {
          try {
            const searchQuery = await ch.query({
              query: `
                SELECT COUNT(*) as count
                FROM ${fullName}
                WHERE lower(${walletCol}) = lower('${TARGET_WALLET}')
              `,
              format: 'JSONEachRow'
            });

            const searchResult = await searchQuery.json<any>();
            const count = parseInt(searchResult[0].count);

            if (count > 0) {
              results.push({
                table: fullName,
                column: walletCol,
                count: count
              });

              console.log(`  ✓ ${fullName}.${walletCol}: ${count.toLocaleString()} rows`);
            }
          } catch (e) {
            // Skip columns that error
          }
        }
      }
    } catch (e) {
      // Skip tables that error
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 RESULTS\n');

  if (results.length === 0) {
    console.log('❌ Wallet not found in any other tables');
    console.log('   Need to backfill from external source (API or blockchain)\n');
  } else {
    console.log(`✅ Found wallet in ${results.length} table(s):\n`);

    results.forEach(r => {
      console.log(`  ${r.table}`);
      console.log(`    Column: ${r.column}`);
      console.log(`    Rows: ${r.count.toLocaleString()}\n`);
    });

    // If found in other tables, check time range
    for (const result of results) {
      if (result.count > 100) {
        console.log(`Checking time range in ${result.table}:\n`);

        try {
          const timeQuery = await ch.query({
            query: `
              SELECT
                MIN(block_time) as earliest,
                MAX(block_time) as latest,
                COUNT(*) as total
              FROM ${result.table}
              WHERE lower(${result.column}) = lower('${TARGET_WALLET}')
            `,
            format: 'JSONEachRow'
          });

          const timeData = await timeQuery.json<any>();
          console.log(`  Time range: ${timeData[0].earliest} to ${timeData[0].latest}`);
          console.log(`  Total rows: ${parseInt(timeData[0].total).toLocaleString()}\n`);
        } catch (e) {
          console.log(`  (No block_time column)\n`);
        }
      }
    }
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
