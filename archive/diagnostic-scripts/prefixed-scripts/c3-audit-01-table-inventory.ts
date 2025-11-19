import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 DATABASE COVERAGE AUDIT ===');
  console.log('=== STEP 1: TABLE INVENTORY ===\n');

  // Get all populated tables
  const tablesQuery = await clickhouse.query({
    query: `
      SELECT
        database,
        name as table_name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        total_bytes
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean', 'staging')
        AND total_rows > 0
      ORDER BY total_rows DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesQuery.json();

  console.log(`\n📊 Total Populated Tables: ${tables.length}\n`);

  // Group by category
  const categories = {
    wallet: tables.filter(t => t.table_name.includes('wallet')),
    pnl: tables.filter(t => t.table_name.includes('pnl') || t.table_name.includes('p_l')),
    position: tables.filter(t => t.table_name.includes('position')),
    trade: tables.filter(t => t.table_name.includes('trade') || t.table_name.includes('fill')),
    market: tables.filter(t => t.table_name.includes('market')),
    resolution: tables.filter(t => t.table_name.includes('resolution')),
    erc1155: tables.filter(t => t.table_name.includes('erc1155')),
    clob: tables.filter(t => t.table_name.includes('clob'))
  };

  console.log('=== TABLES BY CATEGORY ===\n');

  for (const [category, categoryTables] of Object.entries(categories)) {
    if (categoryTables.length > 0) {
      console.log(`\n${category.toUpperCase()} Tables (${categoryTables.length}):`);
      categoryTables.slice(0, 10).forEach(t => {
        console.log(`  ${t.table_name.padEnd(50)} ${t.total_rows.toLocaleString().padStart(12)} rows  ${t.size}`);
      });
      if (categoryTables.length > 10) {
        console.log(`  ... and ${categoryTables.length - 10} more`);
      }
    }
  }

  // Look for key tables
  console.log('\n\n=== KEY TABLE ANALYSIS ===\n');

  const keyTables = [
    'vw_wallet_pnl',
    'wallet_pnl_summary',
    'wallet_metrics',
    'wallet_metrics_complete',
    'vw_trades_canonical',
    'clob_fills',
    'erc1155_transfers',
    'market_resolutions',
    'outcome_positions'
  ];

  for (const tableName of keyTables) {
    const table = tables.find(t => t.table_name.includes(tableName));
    if (table) {
      console.log(`✅ ${table.table_name.padEnd(40)} ${table.total_rows.toLocaleString().padStart(12)} rows  ${table.size}`);
    } else {
      console.log(`❌ ${tableName.padEnd(40)} NOT FOUND or EMPTY`);
    }
  }

  // Export summary
  const summary = {
    timestamp: new Date().toISOString(),
    totalTables: tables.length,
    categories: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v.length])
    ),
    topTables: tables.slice(0, 20).map(t => ({
      name: t.table_name,
      rows: t.total_rows,
      size: t.size
    }))
  };

  console.log('\n\n=== SUMMARY JSON ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
