#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== TRADE TABLES COMPARISON ===\n');

  // Check all trade-related tables
  const tables = await ch.query({
    query: `
      SELECT
        database,
        name,
        engine,
        formatReadableSize(total_bytes) as size,
        total_rows
      FROM system.tables
      WHERE (name LIKE '%trade%' OR name LIKE '%canonical%')
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const data = await tables.json<Array<{
    database: string;
    name: string;
    engine: string;
    size: string;
    total_rows: number;
  }>>();

  for (const row of data) {
    console.log(`${row.database}.${row.name}`);
    console.log(`  Rows: ${parseInt(row.total_rows.toString()).toLocaleString()}`);
    console.log(`  Engine: ${row.engine}`);
    console.log(`  Size: ${row.size}`);
    console.log();
  }

  // Get specific counts for key tables
  console.log('\n=== CORRECTED TOTAL TRADES ===\n');

  try {
    const canonical = await ch.query({
      query: 'SELECT COUNT(*) as count FROM default.vw_trades_canonical',
      format: 'JSONEachRow'
    });
    const canonicalCount = (await canonical.json())[0].count;
    console.log(`vw_trades_canonical (THE TRUTH): ${parseInt(canonicalCount).toLocaleString()}`);
    console.log('  This is the COMPLETE trade dataset (all CLOB fills)\n');
  } catch (e) {
    console.log('vw_trades_canonical: Not found or error\n');
  }

  try {
    const factTrades = await ch.query({
      query: 'SELECT COUNT(*) as count FROM cascadian_clean.fact_trades_clean',
      format: 'JSONEachRow'
    });
    const factCount = (await factTrades.json())[0].count;
    console.log(`fact_trades_clean: ${parseInt(factCount).toLocaleString()}`);
    console.log('  This is FILTERED/CLEANED trades (subset for specific analysis)\n');
  } catch (e) {
    console.log('fact_trades_clean: Not found or error\n');
  }

  try {
    const tda = await ch.query({
      query: 'SELECT COUNT(*) as count FROM default.trade_direction_assignments',
      format: 'JSONEachRow'
    });
    const tdaCount = (await tda.json())[0].count;
    console.log(`trade_direction_assignments: ${parseInt(tdaCount).toLocaleString()}`);
    console.log('  This is raw trade data with direction assignments\n');
  } catch (e) {
    console.log('trade_direction_assignments: Not found or error\n');
  }

  console.log('='.repeat(80));
  console.log('CONCLUSION:');
  console.log('='.repeat(80));
  console.log('\nThe CORRECT total is vw_trades_canonical (157M) - this is ALL Polymarket trades.');
  console.log('fact_trades_clean (63M) is a filtered subset used for specific analysis.\n');

  await ch.close();
}

main().catch(console.error);
