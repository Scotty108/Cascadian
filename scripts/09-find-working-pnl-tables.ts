import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function findWorkingPnLTables() {
  console.log('=== Finding Working PnL Tables ===\n');

  // Get all PnL-related tables
  const tablesQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%pnl%'
        OR name LIKE '%wallet%market%'
        OR name LIKE '%position%'
      )
      AND engine NOT LIKE '%View%'
      AND total_rows > 0
    ORDER BY name
  `;

  const result = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await result.json<any[]>();

  console.log(`Found ${tables.length} non-view tables with data:\n`);

  for (const table of tables) {
    console.log(`\nTesting: ${table.name} (${Number(table.total_rows).toLocaleString()} rows)`);
    console.log('─'.repeat(60));

    // Try to get schema
    try {
      const schemaQuery = `DESCRIBE ${table.name}`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json<any[]>();

      // Look for wallet-related columns
      const walletCols = schema.filter(s =>
        s.name.toLowerCase().includes('wallet') ||
        s.name.toLowerCase().includes('address') ||
        s.name.toLowerCase().includes('user')
      ).map(s => s.name);

      if (walletCols.length === 0) {
        console.log('  ✗ No wallet column found');
        continue;
      }

      console.log(`  Wallet columns: ${walletCols.join(', ')}`);

      // Try to query for our wallet
      for (const walletCol of walletCols) {
        try {
          const countQuery = `
            SELECT count() AS total
            FROM ${table.name}
            WHERE lower(toString(${walletCol})) = lower('${EOA}')
            LIMIT 1
          `;

          const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
          const countData = await countResult.json<any[]>();

          if (Number(countData[0].total) > 0) {
            console.log(`  ✓ Found ${countData[0].total} rows for xcnstrategy (column: ${walletCol})`);

            // Get sample
            const sampleQuery = `
              SELECT *
              FROM ${table.name}
              WHERE lower(toString(${walletCol})) = lower('${EOA}')
              LIMIT 1
            `;

            const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
            const sampleData = await sampleResult.json<any[]>();

            console.log('  Sample row:');
            console.log('  ', JSON.stringify(sampleData[0], null, 2).split('\n').join('\n  '));

            // Check if it has pnl-related fields
            const pnlFields = Object.keys(sampleData[0]).filter(k =>
              k.toLowerCase().includes('pnl') ||
              k.toLowerCase().includes('profit') ||
              k.toLowerCase().includes('loss') ||
              k.toLowerCase().includes('value')
            );

            if (pnlFields.length > 0) {
              console.log(`  📊 PnL fields: ${pnlFields.join(', ')}`);
            }

            break;
          }
        } catch (error) {
          // Column query failed, try next column
          continue;
        }
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message.substring(0, 100) : 'unknown'}`);
    }
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('Search complete. Tables with xcnstrategy data listed above.');
  console.log('═'.repeat(60));
}

findWorkingPnLTables().catch(console.error);
