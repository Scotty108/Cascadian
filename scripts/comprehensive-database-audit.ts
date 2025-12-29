/**
 * COMPREHENSIVE CLICKHOUSE DATABASE AUDIT
 *
 * Creates a complete inventory of all tables in the ClickHouse database:
 * - Table metadata (name, engine, size, row count)
 * - Full schema (all columns with types)
 * - Sample data (first few rows)
 * - Key column identification
 * - Data quality notes
 *
 * Usage: npx tsx scripts/comprehensive-database-audit.ts > database_audit.txt
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../lib/clickhouse/client';

const client = getClickHouseClient();

interface TableInfo {
  name: string;
  engine: string;
  total_rows: string;
  total_bytes: string;
  readable_size: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  default_type: string;
  default_expression: string;
  comment: string;
  codec_expression: string;
  ttl_expression: string;
}

async function getAllTables(): Promise<TableInfo[]> {
  const result = await client.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        total_bytes,
        formatReadableSize(total_bytes) as readable_size
      FROM system.tables
      WHERE database = 'default'
        AND engine NOT LIKE '%View%'
        AND name NOT LIKE '.%'
      ORDER BY total_bytes DESC
    `,
    format: 'JSONEachRow'
  });

  return await result.json() as TableInfo[];
}

async function getTableSchema(tableName: string): Promise<ColumnInfo[]> {
  const result = await client.query({
    query: `DESCRIBE TABLE ${tableName}`,
    format: 'JSONEachRow'
  });

  return await result.json() as ColumnInfo[];
}

async function getSampleData(tableName: string, limit: number = 3): Promise<any[]> {
  try {
    const result = await client.query({
      query: `SELECT * FROM ${tableName} LIMIT ${limit}`,
      format: 'JSONEachRow'
    });

    return await result.json();
  } catch (error) {
    return [];
  }
}

async function getTableEngineDetails(tableName: string): Promise<any> {
  try {
    const result = await client.query({
      query: `
        SELECT
          engine,
          engine_full,
          sorting_key,
          primary_key,
          partition_key
        FROM system.tables
        WHERE database = 'default' AND name = '${tableName}'
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    return data[0] || {};
  } catch (error) {
    return {};
  }
}

function categorizeTable(tableName: string): string[] {
  const categories: string[] = [];

  const name = tableName.toLowerCase();

  // CLOB / Trading
  if (name.includes('trader') || name.includes('fill') || name.includes('trade') || name.includes('clob')) {
    categories.push('TRADING/CLOB');
  }

  // ERC1155 / Blockchain
  if (name.includes('erc1155') || name.includes('transfer') || name.includes('ctf') || name.includes('conditional')) {
    categories.push('ERC1155/BLOCKCHAIN');
  }

  // Positions
  if (name.includes('position') || name.includes('balance')) {
    categories.push('POSITIONS');
  }

  // Markets / Conditions
  if (name.includes('market') || name.includes('condition') || name.includes('outcome')) {
    categories.push('MARKETS');
  }

  // Wallets
  if (name.includes('wallet') || name.includes('user')) {
    categories.push('WALLETS');
  }

  // PnL
  if (name.includes('pnl') || name.includes('profit') || name.includes('loss')) {
    categories.push('PNL');
  }

  // Resolutions
  if (name.includes('resolution') || name.includes('resolve') || name.includes('payout')) {
    categories.push('RESOLUTIONS');
  }

  // Metadata
  if (name.includes('metadata') || name.includes('meta') || name.includes('tags')) {
    categories.push('METADATA');
  }

  // Aggregations / Summaries
  if (name.includes('summary') || name.includes('aggregate') || name.includes('agg')) {
    categories.push('AGGREGATIONS');
  }

  // Goldsky (external data source)
  if (name.includes('goldsky')) {
    categories.push('GOLDSKY');
  }

  // FPMM (AMM pools)
  if (name.includes('fpmm') || name.includes('pool')) {
    categories.push('FPMM/AMM');
  }

  if (categories.length === 0) {
    categories.push('OTHER');
  }

  return categories;
}

function identifyKeyColumns(columns: ColumnInfo[]): string[] {
  const keyIndicators = ['id', 'hash', 'address', 'wallet', 'market', 'condition', 'event_id'];
  const keys: string[] = [];

  for (const col of columns) {
    const lowerName = col.name.toLowerCase();
    if (keyIndicators.some(indicator => lowerName.includes(indicator))) {
      keys.push(col.name);
    }
  }

  return keys;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function auditDatabase() {
  console.log('═'.repeat(100));
  console.log('CLICKHOUSE DATABASE COMPREHENSIVE AUDIT');
  console.log('Generated:', new Date().toISOString());
  console.log('Database: default');
  console.log('═'.repeat(100));
  console.log();

  // Get all tables
  console.log('Fetching table list...');
  const tables = await getAllTables();
  console.log(`Found ${tables.length} tables\n`);

  // Summary by category
  const categoryMap = new Map<string, TableInfo[]>();
  for (const table of tables) {
    const categories = categorizeTable(table.name);
    for (const category of categories) {
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(table);
    }
  }

  console.log('─'.repeat(100));
  console.log('TABLE SUMMARY BY CATEGORY');
  console.log('─'.repeat(100));
  for (const [category, categoryTables] of categoryMap.entries()) {
    console.log(`\n${category}: ${categoryTables.length} tables`);
    for (const table of categoryTables) {
      console.log(`  - ${table.name.padEnd(50)} ${table.readable_size.padStart(12)} (${parseInt(table.total_rows).toLocaleString()} rows)`);
    }
  }
  console.log();

  // Detailed table information
  console.log('\n');
  console.log('═'.repeat(100));
  console.log('DETAILED TABLE INVENTORY');
  console.log('═'.repeat(100));

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    console.log();
    console.log('━'.repeat(100));
    console.log(`TABLE ${i + 1}/${tables.length}: ${table.name}`);
    console.log('━'.repeat(100));

    const categories = categorizeTable(table.name);
    console.log(`Categories: ${categories.join(', ')}`);
    console.log(`Engine: ${table.engine}`);
    console.log(`Row Count: ${parseInt(table.total_rows).toLocaleString()}`);
    console.log(`Size: ${table.readable_size} (${parseInt(table.total_bytes).toLocaleString()} bytes)`);

    // Get engine details
    const engineDetails = await getTableEngineDetails(table.name);
    if (engineDetails.sorting_key) {
      console.log(`Sort Key: ${engineDetails.sorting_key}`);
    }
    if (engineDetails.primary_key) {
      console.log(`Primary Key: ${engineDetails.primary_key}`);
    }
    if (engineDetails.partition_key) {
      console.log(`Partition Key: ${engineDetails.partition_key}`);
    }

    // Get schema
    console.log('\nSCHEMA:');
    const columns = await getTableSchema(table.name);
    const keyColumns = identifyKeyColumns(columns);

    for (const col of columns) {
      const isKey = keyColumns.includes(col.name);
      const keyMarker = isKey ? ' [KEY]' : '';
      console.log(`  ${col.name.padEnd(40)} ${col.type.padEnd(30)}${keyMarker}`);
    }

    console.log(`\nTotal columns: ${columns.length}`);
    if (keyColumns.length > 0) {
      console.log(`Key columns identified: ${keyColumns.join(', ')}`);
    }

    // Sample data
    console.log('\nSAMPLE DATA (first 3 rows):');
    const samples = await getSampleData(table.name, 3);

    if (samples.length === 0) {
      console.log('  (No data or query failed)');
    } else {
      for (let j = 0; j < samples.length; j++) {
        console.log(`\n  Row ${j + 1}:`);
        const sample = samples[j];

        // Show only first 10 columns to avoid overwhelming output
        const sampleKeys = Object.keys(sample).slice(0, 10);
        for (const key of sampleKeys) {
          let value = sample[key];

          // Truncate long values
          if (typeof value === 'string' && value.length > 100) {
            value = value.substring(0, 100) + '...';
          }

          console.log(`    ${key.padEnd(35)}: ${value}`);
        }

        if (Object.keys(sample).length > 10) {
          console.log(`    ... (${Object.keys(sample).length - 10} more columns)`);
        }
      }
    }

    // Data quality notes
    console.log('\nDATA QUALITY NOTES:');
    if (parseInt(table.total_rows) === 0) {
      console.log('  ⚠️  Table is empty');
    }
    if (table.engine.includes('Replacing')) {
      console.log('  ℹ️  ReplacingMergeTree: May have duplicates before final merge');
    }
    if (table.engine.includes('Shared')) {
      console.log('  ℹ️  SharedMergeTree: Duplicates possible, use GROUP BY for deduplication');
    }
    if (table.name.includes('trader_events')) {
      console.log('  ⚠️  Known duplicates: Use GROUP BY event_id pattern for accurate aggregations');
    }
  }

  console.log();
  console.log('═'.repeat(100));
  console.log('AUDIT COMPLETE');
  console.log('═'.repeat(100));
  console.log(`Total tables audited: ${tables.length}`);
  console.log(`Total rows across all tables: ${tables.reduce((sum, t) => sum + parseInt(t.total_rows), 0).toLocaleString()}`);
  console.log(`Total storage: ${formatBytes(tables.reduce((sum, t) => sum + parseInt(t.total_bytes), 0))}`);
  console.log('═'.repeat(100));
}

// Run audit
auditDatabase()
  .then(() => {
    console.log('\n✅ Audit completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Audit failed:', error);
    process.exit(1);
  });
