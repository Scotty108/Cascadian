/**
 * 50: INSPECT WALLET SCHEMA
 *
 * Track B - Step B1.1
 *
 * Systematically discover all wallet-related columns across our ClickHouse tables
 * to understand wallet identity semantics.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

// Patterns to search for in column names
const WALLET_PATTERNS = [
  'wallet',
  'user_',
  'proxy_',
  'owner',
  'account',
  'address',
  'maker',
  'taker',
  'funder'
];

interface ColumnInfo {
  table_name: string;
  column_name: string;
  type: string;
  sample_value: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('50: INSPECT WALLET SCHEMA');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Discover all wallet-related columns\n');

  const results: ColumnInfo[] = [];

  // Step 1: Get all tables in the database
  console.log('📊 Step 1: Discovering all tables...\n');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND engine NOT LIKE '%System%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesQuery.json();
  console.log(`Found ${tables.length} tables\n`);

  // Step 2: For key tables, get full schema
  const keyTables = [
    'clob_fills',
    'clob_positions',
    'positions',
    'wallet_positions',
    'wallet_metrics',
    'trades_raw',
    'erc1155_transfers'
  ];

  console.log('📋 Step 2: Inspecting key tables...\n');

  for (const table of tables) {
    const tableName = table.name;

    // Focus on wallet/position/balance tables
    const isKeyTable = keyTables.includes(tableName) ||
                       tableName.includes('wallet') ||
                       tableName.includes('position') ||
                       tableName.includes('balance');

    if (!isKeyTable) continue;

    console.log(`  🔍 ${tableName}`);

    // Get schema
    const descQuery = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow'
    });

    const schema: any[] = await descQuery.json();

    // Find wallet-related columns
    for (const col of schema) {
      const colName = col.name.toLowerCase();
      const isWalletRelated = WALLET_PATTERNS.some(pattern => colName.includes(pattern));

      if (isWalletRelated) {
        // Get sample value
        let sampleValue = 'N/A';
        try {
          const sampleQuery = await clickhouse.query({
            query: `
              SELECT ${col.name}
              FROM ${tableName}
              WHERE ${col.name} IS NOT NULL
                AND ${col.name} != ''
              LIMIT 1
            `,
            format: 'JSONEachRow'
          });

          const sampleResult: any[] = await sampleQuery.json();
          if (sampleResult.length > 0) {
            sampleValue = String(sampleResult[0][col.name]);
            // Truncate long values
            if (sampleValue.length > 50) {
              sampleValue = sampleValue.substring(0, 50) + '...';
            }
          }
        } catch (error) {
          sampleValue = `Error: ${error}`;
        }

        results.push({
          table_name: tableName,
          column_name: col.name,
          type: col.type,
          sample_value: sampleValue
        });

        console.log(`     ✓ ${col.name} (${col.type})`);
      }
    }
  }

  // Step 3: Print results as markdown table
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('WALLET-RELATED COLUMNS DISCOVERED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('| Table | Column | Type | Sample Value |');
  console.log('|-------|--------|------|--------------|');

  for (const row of results) {
    const sample = row.sample_value.replace(/\|/g, '\\|'); // Escape pipes
    console.log(`| ${row.table_name} | ${row.column_name} | ${row.type} | ${sample} |`);
  }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Total wallet-related columns: ${results.length}`);
  console.log(`Tables with wallet columns: ${new Set(results.map(r => r.table_name)).size}`);
  console.log('');

  // Group by column name to see patterns
  const columnCounts = new Map<string, number>();
  for (const row of results) {
    columnCounts.set(row.column_name, (columnCounts.get(row.column_name) || 0) + 1);
  }

  console.log('Most common column names:');
  const sorted = Array.from(columnCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted.slice(0, 10)) {
    console.log(`  ${name}: ${count} tables`);
  }

  console.log('\n✅ Schema inspection complete\n');
}

main().catch(console.error);
