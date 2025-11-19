#!/usr/bin/env tsx
/**
 * Xi Market Gap Investigation
 *
 * Systematically checks all data sources to determine why Xi Jinping market
 * (0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1) is missing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const XI_MARKET_CID = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const XI_MARKET_CID_BARE = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

interface TableCheckResult {
  table: string;
  rows: number;
  wallets?: number;
  error?: string;
}

async function checkTable(
  tableName: string,
  columnName: string,
  description: string
): Promise<TableCheckResult> {
  console.log(`\nChecking ${description}...`);

  try {
    const query = `
      SELECT
        count(*) AS rows,
        uniqExact(lower(wallet_address)) AS wallets
      FROM ${tableName}
      WHERE lower(${columnName}) = '${XI_MARKET_CID.toLowerCase()}'
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length > 0) {
      const rows = parseInt(data[0].rows || '0');
      const wallets = parseInt(data[0].wallets || '0');

      if (rows > 0) {
        console.log(`✅ FOUND: ${rows.toLocaleString()} rows, ${wallets} unique wallets`);
      } else {
        console.log(`❌ NOT FOUND: 0 rows`);
      }

      return { table: tableName, rows, wallets };
    }
  } catch (error: any) {
    if (error.message.includes("doesn't exist") || error.message.includes("Unknown table")) {
      console.log(`⚠️  Table does not exist: ${tableName}`);
      return { table: tableName, rows: 0, error: 'TABLE_NOT_EXIST' };
    } else if (error.message.includes("Missing columns")) {
      console.log(`⚠️  Column '${columnName}' does not exist in ${tableName}`);
      return { table: tableName, rows: 0, error: 'COLUMN_NOT_EXIST' };
    } else {
      console.log(`❌ Error: ${error.message}`);
      return { table: tableName, rows: 0, error: error.message };
    }
  }

  return { table: tableName, rows: 0 };
}

async function checkTableWithoutWallet(
  tableName: string,
  columnName: string,
  description: string
): Promise<TableCheckResult> {
  console.log(`\nChecking ${description}...`);

  try {
    const query = `
      SELECT count(*) AS rows
      FROM ${tableName}
      WHERE lower(${columnName}) = '${XI_MARKET_CID.toLowerCase()}'
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length > 0) {
      const rows = parseInt(data[0].rows || '0');

      if (rows > 0) {
        console.log(`✅ FOUND: ${rows.toLocaleString()} rows`);
      } else {
        console.log(`❌ NOT FOUND: 0 rows`);
      }

      return { table: tableName, rows };
    }
  } catch (error: any) {
    if (error.message.includes("doesn't exist") || error.message.includes("Unknown table")) {
      console.log(`⚠️  Table does not exist: ${tableName}`);
      return { table: tableName, rows: 0, error: 'TABLE_NOT_EXIST' };
    } else if (error.message.includes("Missing columns")) {
      console.log(`⚠️  Column '${columnName}' does not exist in ${tableName}`);
      return { table: tableName, rows: 0, error: 'COLUMN_NOT_EXIST' };
    } else {
      console.log(`❌ Error: ${error.message}`);
      return { table: tableName, rows: 0, error: error.message };
    }
  }

  return { table: tableName, rows: 0 };
}

async function checkFormatVariants() {
  console.log('\n--- Format/Alias Sanity Check ---\n');

  try {
    const query = `
      SELECT
        countIf(condition_id_norm_v3 = '${XI_MARKET_CID}') AS exact_prefixed,
        countIf(condition_id_norm_v3 = '${XI_MARKET_CID_BARE}') AS exact_bare,
        countIf(replaceRegexpAll(condition_id_norm_v3, '^0x', '') = '${XI_MARKET_CID_BARE}') AS normalized,
        countIf(lower(condition_id_norm_v3) = '${XI_MARKET_CID.toLowerCase()}') AS case_insensitive
      FROM pm_trades_canonical_v3
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length > 0) {
      const row = data[0];
      console.log(`Exact match (0x-prefixed): ${parseInt(row.exact_prefixed || '0').toLocaleString()}`);
      console.log(`Exact match (bare):        ${parseInt(row.exact_bare || '0').toLocaleString()}`);
      console.log(`Normalized (strip 0x):     ${parseInt(row.normalized || '0').toLocaleString()}`);
      console.log(`Case insensitive:          ${parseInt(row.case_insensitive || '0').toLocaleString()}`);

      const total = parseInt(row.exact_prefixed || '0') +
                   parseInt(row.exact_bare || '0') +
                   parseInt(row.normalized || '0') +
                   parseInt(row.case_insensitive || '0');

      if (total === 0) {
        console.log('\n❌ Xi market NOT FOUND in any format variant');
      } else {
        console.log(`\n✅ Xi market FOUND (${total.toLocaleString()} total matches across variants)`);
      }
    }
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  }
}

async function listAllTables() {
  console.log('\n--- Discovering Available Tables ---\n');

  try {
    const query = `
      SELECT name
      FROM system.tables
      WHERE database = 'default'
        AND (
          name LIKE '%trade%'
          OR name LIKE '%clob%'
          OR name LIKE '%erc1155%'
          OR name LIKE '%condition%'
          OR name LIKE '%market%'
          OR name LIKE '%fill%'
        )
      ORDER BY name
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    console.log('Available tables for investigation:');
    console.log('─'.repeat(60));

    for (const row of data) {
      console.log(`  ${row.name}`);
    }

    console.log('');
    return data.map((r: any) => r.name);
  } catch (error: any) {
    console.log(`❌ Error listing tables: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('XI MARKET GAP INVESTIGATION');
  console.log('═'.repeat(80));
  console.log(`\nTarget Market: Xi Jinping`);
  console.log(`Condition ID:  ${XI_MARKET_CID}`);
  console.log('');

  // Discover available tables
  const tables = await listAllTables();

  // ========================================================================
  // TERMINAL 1: Raw Sources
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('TERMINAL 1: RAW SOURCE TABLES');
  console.log('═'.repeat(80));

  const rawResults: TableCheckResult[] = [];

  // Check CLOB fills (try multiple naming conventions)
  const clobTables = tables.filter(t =>
    t.includes('clob') && (t.includes('fill') || t.includes('trade'))
  );

  if (clobTables.length > 0) {
    for (const table of clobTables.slice(0, 3)) {
      // Try common column names
      for (const col of ['condition_id', 'market_id', 'asset_id']) {
        const result = await checkTableWithoutWallet(table, col, `${table}.${col}`);
        if (result.error !== 'COLUMN_NOT_EXIST') {
          rawResults.push(result);
          if (result.rows > 0) break; // Found it, stop checking other columns
        }
      }
    }
  } else {
    console.log('\n⚠️  No CLOB tables found');
  }

  // Check ERC1155 tables
  const erc1155Tables = tables.filter(t => t.includes('erc1155'));

  if (erc1155Tables.length > 0) {
    for (const table of erc1155Tables.slice(0, 3)) {
      // Try common column names
      for (const col of ['condition_id', 'token_id', 'asset_id']) {
        const result = await checkTableWithoutWallet(table, col, `${table}.${col}`);
        if (result.error !== 'COLUMN_NOT_EXIST') {
          rawResults.push(result);
          if (result.rows > 0) break;
        }
      }
    }
  } else {
    console.log('\n⚠️  No ERC1155 tables found');
  }

  // Check condition/market metadata tables
  const metadataTables = tables.filter(t =>
    (t.includes('condition') || t.includes('market')) &&
    (t.includes('metadata') || t.includes('info') || t.includes('dim'))
  );

  if (metadataTables.length > 0) {
    for (const table of metadataTables.slice(0, 3)) {
      for (const col of ['condition_id', 'market_id', 'id']) {
        const result = await checkTableWithoutWallet(table, col, `${table}.${col}`);
        if (result.error !== 'COLUMN_NOT_EXIST') {
          rawResults.push(result);
          if (result.rows > 0) break;
        }
      }
    }
  } else {
    console.log('\n⚠️  No condition/market metadata tables found');
  }

  // ========================================================================
  // TERMINAL 2: Staging/Canonical/Repair
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('TERMINAL 2: STAGING/CANONICAL/REPAIR TABLES');
  console.log('═'.repeat(80));

  const stagingResults: TableCheckResult[] = [];

  // Check staging tables
  const stagingTables = tables.filter(t => t.includes('staging'));

  if (stagingTables.length > 0) {
    for (const table of stagingTables.slice(0, 2)) {
      for (const col of ['condition_id_norm_v3', 'condition_id', 'market_id']) {
        const result = await checkTable(table, col, `${table}.${col}`);
        if (result.error !== 'COLUMN_NOT_EXIST') {
          stagingResults.push(result);
          if (result.rows > 0) break;
        }
      }
    }
  }

  // Check canonical v3
  const v3Result = await checkTable(
    'pm_trades_canonical_v3',
    'condition_id_norm_v3',
    'pm_trades_canonical_v3.condition_id_norm_v3'
  );
  stagingResults.push(v3Result);

  // Check repair map tables
  const repairTables = tables.filter(t => t.includes('repair'));

  if (repairTables.length > 0) {
    console.log('\n--- Repair Map Tables ---');
    for (const table of repairTables.slice(0, 3)) {
      for (const col of ['condition_id', 'repair_condition_id', 'target_condition_id']) {
        const result = await checkTableWithoutWallet(table, col, `${table}.${col}`);
        if (result.error !== 'COLUMN_NOT_EXIST') {
          stagingResults.push(result);
          if (result.rows > 0) break;
        }
      }
    }
  }

  // ========================================================================
  // TERMINAL 3: Format Variants
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('TERMINAL 3: FORMAT/ALIAS SANITY CHECK');
  console.log('═'.repeat(80));

  await checkFormatVariants();

  // ========================================================================
  // DIAGNOSTIC SUMMARY
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('═'.repeat(80));

  const rawHasData = rawResults.some(r => r.rows > 0);
  const canonicalHasData = stagingResults.some(r => r.rows > 0);

  console.log('\n--- RAW SOURCE STATUS ---');
  if (rawHasData) {
    console.log('✅ Xi market EXISTS in raw source tables');
    const tables_with_data = rawResults.filter(r => r.rows > 0);
    for (const r of tables_with_data) {
      console.log(`   ${r.table}: ${r.rows.toLocaleString()} rows`);
    }
  } else {
    console.log('❌ Xi market NOT FOUND in any raw source tables');
  }

  console.log('\n--- CANONICAL/STAGING STATUS ---');
  if (canonicalHasData) {
    console.log('✅ Xi market EXISTS in canonical/staging tables');
    const tables_with_data = stagingResults.filter(r => r.rows > 0);
    for (const r of tables_with_data) {
      console.log(`   ${r.table}: ${r.rows.toLocaleString()} rows${r.wallets ? `, ${r.wallets} wallets` : ''}`);
    }
  } else {
    console.log('❌ Xi market NOT FOUND in canonical/staging tables');
  }

  console.log('\n' + '═'.repeat(80));
  console.log('ROOT CAUSE DIAGNOSIS');
  console.log('═'.repeat(80));
  console.log('');

  if (!rawHasData && !canonicalHasData) {
    console.log('🔍 DIAGNOSIS: INGESTION GAP AT SOURCE');
    console.log('');
    console.log('The Xi market was never ingested from Polymarket API or blockchain.');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Fetch Xi market data from Polymarket API');
    console.log('2. Backfill into raw source tables (clob_fills, erc1155_transfers)');
    console.log('3. Re-run canonical build for Xi condition_id');
    console.log('4. Verify xcnstrategy trades appear in repaired view');
  } else if (rawHasData && !canonicalHasData) {
    console.log('🔍 DIAGNOSIS: ETL/NORMALIZATION GAP');
    console.log('');
    console.log('Xi market exists in raw sources but not in canonical tables.');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Review ETL filters (date range, market type, condition_id normalization)');
    console.log('2. Check for failed joins (condition_id format mismatch)');
    console.log('3. Re-run canonical build with fixed filters');
    console.log('4. Verify Xi appears in pm_trades_canonical_v3');
  } else if (canonicalHasData) {
    console.log('🔍 DIAGNOSIS: WALLET ATTRIBUTION GAP');
    console.log('');
    console.log('Xi market exists in canonical tables but not attributed to xcnstrategy.');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Check wallet_address values for Xi market trades');
    console.log('2. Verify transaction hashes against collision repair map');
    console.log('3. Extend repair map if needed');
    console.log('4. Re-run attribution repair for Xi market');
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
}

main().catch(console.error);
