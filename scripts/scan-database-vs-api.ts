#!/usr/bin/env tsx
/**
 * Database vs API Data Comparison
 *
 * Scans all ClickHouse tables to determine if Polymarket API data already exists
 * in our warehouse. Compares:
 *
 * 1. Wallet P&L data (cashPnl, realizedPnl fields)
 * 2. Position data (size, avgPrice, currentValue, etc.)
 * 3. Payout vector data (from Goldsky subgraph)
 * 4. Market metadata (from Gamma API)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

// Test wallet from API integration test
const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// Expected values from API test
const API_VALUES = {
  cashPnl: 320.47,
  realizedPnl: -6117.18,
  positionCount: 10,
};

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface TableInfo {
  database: string;
  name: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
}

interface ColumnInfo {
  name: string;
  type: string;
  comment: string;
}

interface ScanResult {
  tablesScanned: number;
  tablesWithWallet: string[];
  pnlColumns: { table: string; columns: string[] }[];
  payoutColumns: { table: string; columns: string[] }[];
  positionColumns: { table: string; columns: string[] }[];
  walletPnlValues: { table: string; cashPnl?: number; realizedPnl?: number; unrealizedPnl?: number }[];
  gaps: string[];
  recommendations: string[];
}

async function getAllTables(): Promise<TableInfo[]> {
  const query = `
    SELECT
      database,
      name,
      engine,
      total_rows,
      total_bytes
    FROM system.tables
    WHERE database IN ('default', 'cascadian_clean')
      AND engine NOT IN ('View', 'MaterializedView')
    ORDER BY database, name
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json() as Promise<TableInfo[]>;
}

async function getAllViews(): Promise<TableInfo[]> {
  const query = `
    SELECT
      database,
      name,
      engine,
      0 as total_rows,
      0 as total_bytes
    FROM system.tables
    WHERE database IN ('default', 'cascadian_clean')
      AND engine IN ('View', 'MaterializedView')
    ORDER BY database, name
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json() as Promise<TableInfo[]>;
}

async function getTableColumns(database: string, table: string): Promise<ColumnInfo[]> {
  const query = `
    SELECT
      name,
      type,
      comment
    FROM system.columns
    WHERE database = '${database}'
      AND table = '${table}'
    ORDER BY position
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json() as Promise<ColumnInfo[]>;
}

async function checkWalletInTable(database: string, table: string, columns: ColumnInfo[]): Promise<boolean> {
  // Find wallet column
  const walletCol = columns.find(c =>
    c.name.toLowerCase().includes('wallet') ||
    c.name.toLowerCase().includes('address') ||
    c.name.toLowerCase() === 'user'
  );

  if (!walletCol) return false;

  try {
    const query = `
      SELECT count(*) as count
      FROM ${database}.${table}
      WHERE lower(${walletCol.name}) = lower('${TEST_WALLET}')
      LIMIT 1
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];
    return data[0]?.count > 0;
  } catch (error) {
    console.error(`Error checking wallet in ${database}.${table}:`, error);
    return false;
  }
}

async function checkPnlColumns(database: string, table: string, columns: ColumnInfo[]): Promise<string[]> {
  const pnlColumns: string[] = [];

  for (const col of columns) {
    const name = col.name.toLowerCase();
    if (
      name.includes('pnl') ||
      name.includes('profit') ||
      name.includes('loss') ||
      name.includes('realized') ||
      name.includes('unrealized') ||
      name.includes('cash_pnl') ||
      name.includes('total_pnl')
    ) {
      pnlColumns.push(col.name);
    }
  }

  return pnlColumns;
}

async function checkPayoutColumns(database: string, table: string, columns: ColumnInfo[]): Promise<string[]> {
  const payoutColumns: string[] = [];

  for (const col of columns) {
    const name = col.name.toLowerCase();
    if (
      name.includes('payout') ||
      name.includes('payouts') ||
      name.includes('winning') ||
      name.includes('winner') ||
      name.includes('numerator') ||
      name.includes('denominator')
    ) {
      payoutColumns.push(col.name);
    }
  }

  return payoutColumns;
}

async function checkPositionColumns(database: string, table: string, columns: ColumnInfo[]): Promise<string[]> {
  const positionColumns: string[] = [];

  // API fields we're looking for:
  // size, avgPrice, currentValue, initialValue, outcome, outcomeIndex
  const apiFields = ['size', 'avgprice', 'currentvalue', 'initialvalue', 'outcome', 'outcomeindex', 'avg_price', 'current_value', 'initial_value', 'outcome_index'];

  for (const col of columns) {
    const name = col.name.toLowerCase();
    for (const field of apiFields) {
      if (name.includes(field)) {
        positionColumns.push(col.name);
        break;
      }
    }
  }

  return positionColumns;
}

async function getWalletPnlValues(database: string, table: string, columns: ColumnInfo[]): Promise<{ cashPnl?: number; realizedPnl?: number; unrealizedPnl?: number }> {
  const walletCol = columns.find(c =>
    c.name.toLowerCase().includes('wallet') ||
    c.name.toLowerCase().includes('address') ||
    c.name.toLowerCase() === 'user'
  );

  if (!walletCol) return {};

  const pnlCols = await checkPnlColumns(database, table, columns);
  if (pnlCols.length === 0) return {};

  try {
    // Build SELECT clause for all P&L columns
    const selectCols = pnlCols.map(col => `sum(${col}) as ${col}`).join(', ');

    const query = `
      SELECT ${selectCols}
      FROM ${database}.${table}
      WHERE lower(${walletCol.name}) = lower('${TEST_WALLET}')
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length === 0) return {};

    const row = data[0];
    const values: any = {};

    // Map to expected field names
    for (const [key, value] of Object.entries(row)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('cash') && keyLower.includes('pnl')) {
        values.cashPnl = Number(value) || 0;
      } else if (keyLower.includes('realized') && keyLower.includes('pnl')) {
        values.realizedPnl = Number(value) || 0;
      } else if (keyLower.includes('unrealized') && keyLower.includes('pnl')) {
        values.unrealizedPnl = Number(value) || 0;
      }
    }

    return values;
  } catch (error) {
    console.error(`Error getting P&L values from ${database}.${table}:`, error);
    return {};
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DATABASE vs API DATA COMPARISON');
  console.log('='.repeat(80));
  console.log();

  const result: ScanResult = {
    tablesScanned: 0,
    tablesWithWallet: [],
    pnlColumns: [],
    payoutColumns: [],
    positionColumns: [],
    walletPnlValues: [],
    gaps: [],
    recommendations: [],
  };

  // Step 1: Get all tables and views
  console.log('Step 1: Scanning all tables and views...');
  console.log();

  const tables = await getAllTables();
  const views = await getAllViews();
  const allObjects = [...tables, ...views];

  result.tablesScanned = allObjects.length;

  console.log(`📊 Database Inventory:`);
  console.log(`   Total tables: ${tables.length}`);
  console.log(`   Total views: ${views.length}`);
  console.log(`   Total objects: ${result.tablesScanned}`);
  console.log();

  // Group by database
  const byDatabase = {
    default: allObjects.filter(t => t.database === 'default'),
    cascadian_clean: allObjects.filter(t => t.database === 'cascadian_clean'),
  };

  console.log(`   default schema: ${byDatabase.default.length} objects`);
  console.log(`   cascadian_clean schema: ${byDatabase.cascadian_clean.length} objects`);
  console.log();

  // Step 2: Scan each table for wallet data and relevant columns
  console.log('Step 2: Scanning for wallet data and P&L columns...');
  console.log();

  for (const obj of allObjects) {
    process.stdout.write(`   Scanning ${obj.database}.${obj.name}...`);

    const columns = await getTableColumns(obj.database, obj.name);
    const hasWallet = await checkWalletInTable(obj.database, obj.name, columns);

    if (hasWallet) {
      result.tablesWithWallet.push(`${obj.database}.${obj.name}`);
      console.log(' ✅ HAS WALLET');

      // Get P&L values
      const pnlValues = await getWalletPnlValues(obj.database, obj.name, columns);
      if (Object.keys(pnlValues).length > 0) {
        result.walletPnlValues.push({
          table: `${obj.database}.${obj.name}`,
          ...pnlValues,
        });
      }
    } else {
      console.log(' -');
    }

    // Check for P&L columns
    const pnlCols = await checkPnlColumns(obj.database, obj.name, columns);
    if (pnlCols.length > 0) {
      result.pnlColumns.push({
        table: `${obj.database}.${obj.name}`,
        columns: pnlCols,
      });
    }

    // Check for payout columns
    const payoutCols = await checkPayoutColumns(obj.database, obj.name, columns);
    if (payoutCols.length > 0) {
      result.payoutColumns.push({
        table: `${obj.database}.${obj.name}`,
        columns: payoutCols,
      });
    }

    // Check for position columns
    const positionCols = await checkPositionColumns(obj.database, obj.name, columns);
    if (positionCols.length > 0) {
      result.positionColumns.push({
        table: `${obj.database}.${obj.name}`,
        columns: positionCols,
      });
    }
  }

  console.log();
  console.log('Step 3: Analyzing findings...');
  console.log();

  // Step 3: Compare against API data
  console.log('📋 FINDINGS:');
  console.log();

  console.log(`1. Tables containing wallet ${TEST_WALLET}:`);
  if (result.tablesWithWallet.length === 0) {
    console.log('   ❌ Wallet not found in any table');
    result.gaps.push('Wallet data not in database');
  } else {
    console.log(`   ✅ Found in ${result.tablesWithWallet.length} tables:`);
    result.tablesWithWallet.forEach(t => console.log(`      - ${t}`));
  }
  console.log();

  console.log('2. P&L Column Analysis:');
  if (result.pnlColumns.length === 0) {
    console.log('   ❌ No P&L columns found');
    result.gaps.push('No P&L columns in database');
  } else {
    console.log(`   ✅ Found P&L columns in ${result.pnlColumns.length} tables:`);
    result.pnlColumns.forEach(({ table, columns }) => {
      console.log(`      ${table}:`);
      console.log(`         ${columns.join(', ')}`);
    });
  }
  console.log();

  console.log('3. Wallet P&L Values vs API:');
  console.log(`   API Data: cashPnl=$${API_VALUES.cashPnl}, realizedPnl=$${API_VALUES.realizedPnl}`);
  console.log();

  if (result.walletPnlValues.length === 0) {
    console.log('   ❌ No P&L values found for wallet');
    result.gaps.push('No P&L values calculated for test wallet');
  } else {
    console.log(`   Database values:`);
    result.walletPnlValues.forEach(({ table, cashPnl, realizedPnl, unrealizedPnl }) => {
      console.log(`      ${table}:`);
      if (cashPnl !== undefined) console.log(`         cashPnl: $${cashPnl.toFixed(2)}`);
      if (realizedPnl !== undefined) console.log(`         realizedPnl: $${realizedPnl.toFixed(2)}`);
      if (unrealizedPnl !== undefined) console.log(`         unrealizedPnl: $${unrealizedPnl.toFixed(2)}`);

      // Check if values match API
      const cashMatch = cashPnl !== undefined && Math.abs(cashPnl - API_VALUES.cashPnl) < 1;
      const realizedMatch = realizedPnl !== undefined && Math.abs(realizedPnl - API_VALUES.realizedPnl) < 1;

      if (cashMatch || realizedMatch) {
        console.log(`         ✅ MATCHES API DATA`);
      } else {
        console.log(`         ⚠️  DOES NOT MATCH API`);
      }
    });
  }
  console.log();

  console.log('4. Payout Vector Data:');
  if (result.payoutColumns.length === 0) {
    console.log('   ❌ No payout columns found');
    result.gaps.push('No payout vector columns in database');
  } else {
    console.log(`   ✅ Found payout columns in ${result.payoutColumns.length} tables:`);
    result.payoutColumns.forEach(({ table, columns }) => {
      console.log(`      ${table}:`);
      console.log(`         ${columns.join(', ')}`);
    });

    // Check if we have actual payout data
    for (const { table, columns } of result.payoutColumns) {
      const [database, tableName] = table.split('.');
      try {
        const query = `SELECT count(*) as count FROM ${table} WHERE ${columns[0]} IS NOT NULL LIMIT 1`;
        const result = await client.query({ query, format: 'JSONEachRow' });
        const data = await result.json() as any[];
        const count = data[0]?.count || 0;

        if (count > 0) {
          console.log(`      ✅ ${table} has payout data (${count} rows)`);
        } else {
          console.log(`      ⚠️  ${table} has no payout data`);
        }
      } catch (error) {
        console.log(`      ⚠️  ${table} - error checking data`);
      }
    }
  }
  console.log();

  console.log('5. Position Data Columns:');
  if (result.positionColumns.length === 0) {
    console.log('   ❌ No position columns found matching API structure');
    result.gaps.push('No position columns matching API structure (size, avgPrice, currentValue, etc.)');
  } else {
    console.log(`   ✅ Found position columns in ${result.positionColumns.length} tables:`);
    result.positionColumns.forEach(({ table, columns }) => {
      console.log(`      ${table}:`);
      console.log(`         ${columns.join(', ')}`);
    });
  }
  console.log();

  // Step 4: Generate recommendations
  console.log('='.repeat(80));
  console.log('RECOMMENDATIONS:');
  console.log('='.repeat(80));
  console.log();

  if (result.gaps.length === 0) {
    console.log('✅ All API data appears to exist in database');
    result.recommendations.push('Focus on exposing existing data through views');
    result.recommendations.push('Verify data quality and freshness');
  } else {
    console.log('⚠️  Data gaps identified:');
    result.gaps.forEach(gap => console.log(`   - ${gap}`));
    console.log();

    if (result.walletPnlValues.length === 0) {
      result.recommendations.push('CRITICAL: Integrate Polymarket Data API for wallet P&L');
      result.recommendations.push('Create staging table: polymarket_api_positions (ReplacingMergeTree on wallet+conditionId)');
    } else {
      const hasMatchingPnl = result.walletPnlValues.some(
        ({ cashPnl, realizedPnl }) =>
          (cashPnl !== undefined && Math.abs(cashPnl - API_VALUES.cashPnl) < 1) ||
          (realizedPnl !== undefined && Math.abs(realizedPnl - API_VALUES.realizedPnl) < 1)
      );

      if (!hasMatchingPnl) {
        result.recommendations.push('WARNING: P&L values in database do not match Polymarket API');
        result.recommendations.push('Investigate: Are we calculating P&L correctly?');
        result.recommendations.push('Consider: Use Polymarket API as source of truth, calculate differences');
      }
    }

    if (result.payoutColumns.length === 0) {
      result.recommendations.push('Integrate Goldsky Subgraph for payout vectors');
      result.recommendations.push('Backfill resolutions_external_ingest table');
    }

    if (result.positionColumns.length === 0) {
      result.recommendations.push('Create position view matching API structure');
      result.recommendations.push('Add columns: size, avgPrice, currentValue, initialValue to vw_positions_open');
    }
  }

  console.log();
  console.log('Recommended Actions:');
  result.recommendations.forEach((rec, i) => console.log(`   ${i + 1}. ${rec}`));
  console.log();

  // Save results to JSON
  const fs = require('fs');
  fs.writeFileSync(
    '/Users/scotty/Projects/Cascadian-app/database-api-scan-results.json',
    JSON.stringify(result, null, 2)
  );

  console.log('='.repeat(80));
  console.log('✅ SCAN COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Results saved to: database-api-scan-results.json');
  console.log(`Tables scanned: ${result.tablesScanned}`);
  console.log(`Tables with wallet: ${result.tablesWithWallet.length}`);
  console.log(`Tables with P&L columns: ${result.pnlColumns.length}`);
  console.log(`Tables with payout columns: ${result.payoutColumns.length}`);
  console.log(`Tables with position columns: ${result.positionColumns.length}`);
  console.log();

  await client.close();
}

main().catch(console.error);
