#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

interface DatabaseInfo {
  name: string;
  engine: string;
  tables: TableInfo[];
}

interface TableInfo {
  name: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
  size: string;
  columns: ColumnInfo[];
  min_timestamp?: string;
  max_timestamp?: string;
  comment?: string;
  is_view: boolean;
}

interface ColumnInfo {
  name: string;
  type: string;
  default_expression?: string;
  comment?: string;
}

async function getDatabases(): Promise<string[]> {
  try {
    const result = await clickhouse.query({
      query: 'SHOW DATABASES',
      format: 'JSONEachRow'
    });

    const databases = await result.json() as Array<{ name: string }>;
    return databases.map(d => d.name);
  } catch (error) {
    console.error('Error getting databases:', error);
    return [];
  }
}

async function getTables(database: string): Promise<TableInfo[]> {
  try {
    // Get table metadata from system.tables
    const result = await clickhouse.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          total_bytes,
          formatReadableSize(total_bytes) as size,
          comment
        FROM system.tables
        WHERE database = '${database}'
        ORDER BY total_bytes DESC
      `,
      format: 'JSONEachRow'
    });

    const tables = await result.json() as any[];

    // For each table, get columns and additional info
    for (const table of tables) {
      table.is_view = table.engine === 'View' || table.engine === 'MaterializedView';
      table.columns = await getTableColumns(database, table.name);

      // Try to get timestamp range for tables with timestamp columns
      const timestampCol = table.columns.find((col: ColumnInfo) =>
        col.name.includes('timestamp') || col.name.includes('time')
      );

      if (timestampCol && !table.is_view) {
        const timestampRange = await getTimestampRange(database, table.name, timestampCol.name);
        if (timestampRange) {
          table.min_timestamp = timestampRange.min;
          table.max_timestamp = timestampRange.max;
        }
      }
    }

    return tables;
  } catch (error) {
    console.error(`Error getting tables for database ${database}:`, error);
    return [];
  }
}

async function getTableColumns(database: string, tableName: string): Promise<ColumnInfo[]> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          name,
          type,
          default_expression,
          comment
        FROM system.columns
        WHERE database = '${database}' AND table = '${tableName}'
        ORDER BY position
      `,
      format: 'JSONEachRow'
    });

    return await result.json() as ColumnInfo[];
  } catch (error) {
    console.error(`Error getting columns for ${database}.${tableName}:`, error);
    return [];
  }
}

async function getTimestampRange(database: string, tableName: string, timestampCol: string): Promise<{min: string, max: string} | null> {
  try {
    const result = await clickhouse.query({
      query: `SELECT min(${timestampCol}) as min, max(${timestampCol}) as max FROM ${database}.${tableName}`,
      format: 'JSONEachRow'
    });

    const range = await result.json() as Array<{min: string, max: string}>;
    return range[0];
  } catch (error) {
    // Ignore errors for tables without timestamp data
    return null;
  }
}

async function generateReport(databaseInfo: DatabaseInfo[]) {
  console.log('='.repeat(120));
  console.log('CLICKHOUSE DATABASE INVENTORY REPORT');
  console.log('='.repeat(120));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Total Databases: ${databaseInfo.length}`);

  let totalTables = 0;
  let totalViews = 0;
  let totalRows = 0;
  let totalBytes = 0;

  databaseInfo.forEach(db => {
    db.tables.forEach(table => {
      totalTables++;
      if (table.is_view) totalViews++;
      totalRows += table.total_rows || 0;
      totalBytes += table.total_bytes || 0;
    });
  });

  console.log(`Total Tables: ${totalTables} (${totalViews} views)`);
  console.log(`Total Rows: ${totalRows.toLocaleString()}`);
  console.log(`Total Size: ${formatBytes(totalBytes)}`);
  console.log();

  // Executive Summary
  console.log('EXECUTIVE SUMMARY');
  console.log('-'.repeat(80));

  // Find key Polymarket tables
  const keyTables = [
    'trades_raw', 'clob_fills', 'erc1155_transfers', 'market_resolutions',
    'wallet_positions', 'wallet_metrics', 'fact_pnl', 'gamma_markets'
  ];

  console.log('Key Polymarket Tables Found:');
  databaseInfo.forEach(db => {
    db.tables.forEach(table => {
      if (keyTables.includes(table.name)) {
        console.log(`  ✅ ${db.name}.${table.name}: ${table.total_rows.toLocaleString()} rows, ${table.size}`);
      }
    });
  });
  console.log();

  // Detailed breakdown by database
  for (const db of databaseInfo) {
    console.log(`\nDATABASE: ${db.name.toUpperCase()}`);
    console.log('='.repeat(60));

    if (db.tables.length === 0) {
      console.log('  (No tables found)');
      continue;
    }

    for (const table of db.tables) {
      console.log(`\n📊 ${table.name}`);
      console.log(`   Engine: ${table.engine}`);
      console.log(`   Type: ${table.is_view ? 'VIEW' : 'TABLE'}`);
      console.log(`   Rows: ${table.total_rows?.toLocaleString() || 'N/A'}`);
      console.log(`   Size: ${table.size || 'N/A'}`);

      if (table.min_timestamp && table.max_timestamp) {
        console.log(`   Time Range: ${table.min_timestamp} → ${table.max_timestamp}`);
      }

      if (table.columns.length > 0) {
        console.log(`   Columns (${table.columns.length}):`);
        table.columns.slice(0, 10).forEach((col, i) => {
          console.log(`     ${(i + 1).toString().padStart(2)}. ${col.name.padEnd(25)} : ${col.type}`);
        });
        if (table.columns.length > 10) {
          console.log(`     ... and ${table.columns.length - 10} more columns`);
        }
      }

      if (table.comment) {
        console.log(`   Comment: ${table.comment}`);
      }

      console.log();
    }
  }

  // Data Quality Observations
  console.log('\nDATA QUALITY OBSERVATIONS');
  console.log('='.repeat(80));

  const emptyTables = [];
  const hugeTables = [];
  const unusualEngines = [];

  databaseInfo.forEach(db => {
    db.tables.forEach(table => {
      if (table.total_rows === 0) {
        emptyTables.push(`${db.name}.${table.name}`);
      } else if (table.total_rows > 100000000) { // 100M+ rows
        hugeTables.push({
          name: `${db.name}.${table.name}`,
          rows: table.total_rows,
          size: table.size
        });
      }

      if (!['MergeTree', 'ReplacingMergeTree', 'SummingMergeTree', 'View', 'MaterializedView'].includes(table.engine)) {
        unusualEngines.push({
          name: `${db.name}.${table.name}`,
          engine: table.engine
        });
      }
    });
  });

  if (emptyTables.length > 0) {
    console.log(`\nEmpty Tables Found (${emptyTables.length}):`);
    emptyTables.slice(0, 20).forEach(name => console.log(`  - ${name}`));
    if (emptyTables.length > 20) {
      console.log(`  ... and ${emptyTables.length - 20} more`);
    }
  }

  if (hugeTables.length > 0) {
    console.log(`\nLarge Tables Found (100M+ rows, ${hugeTables.length}):`);
    hugeTables.slice(0, 10).forEach(table => {
      console.log(`  📈 ${table.name}: ${table.rows.toLocaleString()} rows, ${table.size}`);
    });
    if (hugeTables.length > 10) {
      console.log(`  ... and ${hugeTables.length - 10} more`);
    }
  }

  if (unusualEngines.length > 0) {
    console.log(`\nUnusual Table Engines Found (${unusualEngines.length}):`);
    unusualEngines.slice(0, 10).forEach(table => {
      console.log(`  ⚠️  ${table.name}: ${table.engine}`);
    });
    if (unusualEngines.length > 10) {
      console.log(`  ... and ${unusualEngines.length - 10} more`);
    }
  }

  // Architecture Insights
  console.log('\nARCHITECTURE INSIGHTS');
  console.log('='.repeat(80));

  // Polymarket-specific analysis
  const hasClobTables = databaseInfo.some(db =>
    db.tables.some(t => t.name.startsWith('clob_'))
  );
  const hasGammaTables = databaseInfo.some(db =>
    db.tables.some(t => t.name.startsWith('gamma_'))
  );
  const hasErc1155Tables = databaseInfo.some(db =>
    db.tables.some(t => t.name.startsWith('erc1155_'))
  );

  console.log('Polymarket Infrastructure:');
  console.log(`  ✅ CLOB Data: ${hasClobTables ? 'PRESENT' : 'MISSING'}`);
  console.log(`  ✅ Gamma Markets: ${hasGammaTables ? 'PRESENT' : 'MISSING'}`);
  console.log(`  ✅ ERC1155 Transfers: ${hasErc1155Tables ? 'PRESENT' : 'MISSING'}`);

  // Currency Analysis
  const hasUSDC = databaseInfo.some(db =>
    db.tables.some(t => t.columns.some(c => c.name.includes('usdc')))
  );
  const hasPnL = databaseInfo.some(db =>
    db.tables.some(t => t.columns.some(c => c.name.includes('pnl')))
  );

  console.log('\nFinancial Data:');
  console.log(`  ✅ USDC Trading: ${hasUSDC ? 'PRESENT' : 'MISSING'}`);
  console.log(`  ✅ P&L Calculation: ${hasPnL ? 'PRESENT' : 'MISSING'}`);
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function main() {
  console.log('🚀 Starting ClickHouse Database Exploration...');

  try {
    // Test connection first
    const connectionTest = await clickhouse.query({
      query: 'SELECT version() as version, currentDatabase() as current_db',
      format: 'JSONEachRow'
    });

    const connInfo = await connectionTest.json() as Array<{version: string, current_db: string}>;
    console.log(`✅ Connected to ClickHouse ${connInfo[0].version}`);
    console.log(`✅ Current database: ${connInfo[0].current_db}`);
    console.log();

    // Get all databases
    const databaseNames = await getDatabases();
    console.log(`Found ${databaseNames.length} databases: ${databaseNames.join(', ')}`);

    const databaseInfo: DatabaseInfo[] = [];

    // Explore each database
    for (const dbName of databaseNames) {
      console.log(`\n🔍 Exploring database: ${dbName}`);
      const tables = await getTables(dbName);

      databaseInfo.push({
        name: dbName,
        engine: 'Database', // Will be filled if system.databases has this info
        tables
      });

      console.log(`  Found ${tables.length} tables in ${dbName}`);
    }

    // Generate comprehensive report
    await generateReport(databaseInfo);

    // Also save detailed JSON for further analysis
    const report = {
      timestamp: new Date().toISOString(),
      databases: databaseInfo,
      summary: {
        total_databases: databaseInfo.length,
        total_tables: databaseInfo.reduce((sum, db) => sum + db.tables.length, 0),
        total_views: databaseInfo.reduce((sum, db) => sum + db.tables.filter(t => t.is_view).length, 0),
        total_rows: databaseInfo.reduce((sum, db) => sum + db.tables.reduce((tSum, t) => tSum + (t.total_rows || 0), 0), 0),
        total_bytes: databaseInfo.reduce((sum, db) => sum + db.tables.reduce((tSum, t) => tSum + (t.total_bytes || 0), 0), 0)
      }
    };

    const fs = require('fs');
    fs.writeFileSync('CLICKHOUSE_TABLE_INVENTORY.json', JSON.stringify(report, null, 2));
    console.log('\n💾 Detailed JSON report saved to: CLICKHOUSE_TABLE_INVENTORY.json');

  } catch (error) {
    console.error('❌ Error during exploration:', error);
    process.exit(1);
  }
}

main().catch(console.error);