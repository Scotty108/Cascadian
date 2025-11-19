import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function reconcileTradesCounts() {
  console.log('=== Reconciling Trade Counts for xcnstrategy ===\n');

  // Find all trade-related tables
  const tablesQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%trade%'
        OR name LIKE '%fill%'
        OR name LIKE '%clob%'
      )
      AND total_rows > 0
      AND engine NOT LIKE '%View%'
    ORDER BY total_rows DESC
  `;

  const tablesResult = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json<any[]>();

  console.log('Available trade-related tables:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  tables.forEach(table => {
    console.log(`  ${table.name.padEnd(50)} ${Number(table.total_rows).toLocaleString().padStart(15)} rows`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('CHECKING XCNSTRATEGY TRADE COUNTS IN EACH TABLE:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const results: Array<{table: string, count: number, error?: string}> = [];

  // Check each table for xcnstrategy trades
  for (const table of tables.slice(0, 20)) { // Check top 20 tables
    try {
      // Get column names first
      const schemaQuery = `DESCRIBE ${table.name}`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json<any[]>();
      const columns = schema.map(s => s.name);

      // Look for wallet/address column
      const walletCol = columns.find(c =>
        c.toLowerCase().includes('wallet') ||
        c.toLowerCase().includes('address') ||
        c.toLowerCase().includes('owner') ||
        c.toLowerCase().includes('trader')
      );

      if (!walletCol) {
        results.push({table: table.name, count: 0, error: 'No wallet column'});
        continue;
      }

      // Count trades
      const countQuery = `
        SELECT count() AS trade_count
        FROM ${table.name}
        WHERE lower(toString(${walletCol})) = lower('${EOA}')
      `;

      const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
      const countData = await countResult.json<any[]>();
      const count = Number(countData[0].trade_count);

      results.push({table: table.name, count});

      if (count > 0) {
        console.log(`✅ ${table.name.padEnd(50)} ${count.toString().padStart(6)} trades`);
      }
    } catch (error) {
      results.push({table: table.name, count: 0, error: error instanceof Error ? error.message.substring(0, 50) : 'unknown'});
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY (sorted by count):');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const nonZero = results.filter(r => r.count > 0);
  nonZero.forEach(r => {
    console.log(`  ${r.table.padEnd(50)} ${r.count.toLocaleString().padStart(10)} trades`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('KEY QUESTION: Which table is source of truth?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  if (nonZero.length > 0) {
    const max = nonZero[0];
    console.log(`Largest count: ${max.table} with ${max.count} trades`);
    console.log('');

    // Compare with what we're using
    const canonical = nonZero.find(r => r.table === 'pm_trades_canonical_v3');
    if (canonical) {
      console.log(`pm_trades_canonical_v3: ${canonical.count} trades`);
      if (canonical.count < max.count) {
        console.log(`  ⚠️  Missing ${max.count - canonical.count} trades compared to ${max.table}!`);
      }
    }
  }

  // Now check: what trades are in the largest table but NOT in pm_trades_canonical_v3?
  if (nonZero.length >= 2) {
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('INVESTIGATING TRADE DIFFERENCES:');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const largest = nonZero[0];
    const canonical = nonZero.find(r => r.table === 'pm_trades_canonical_v3');

    if (canonical && largest.table !== canonical.table) {
      console.log(`Comparing ${largest.table} (${largest.count}) vs ${canonical.table} (${canonical.count})\n`);

      // Try to find what's different
      try {
        // Get schema of largest table
        const schemaQuery = `DESCRIBE ${largest.table}`;
        const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
        const schema = await schemaResult.json<any[]>();
        const columns = schema.map(s => s.name);

        console.log(`Columns in ${largest.table}:`,columns.slice(0, 10).join(', '));
        console.log('');

        // Sample 5 records from largest table
        const walletCol = columns.find(c =>
          c.toLowerCase().includes('wallet') ||
          c.toLowerCase().includes('address') ||
          c.toLowerCase().includes('trader')
        );

        if (walletCol) {
          const sampleQuery = `
            SELECT *
            FROM ${largest.table}
            WHERE lower(toString(${walletCol})) = lower('${EOA}')
            LIMIT 5
          `;

          const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
          const sample = await sampleResult.json<any[]>();

          console.log(`Sample records from ${largest.table}:`);
          sample.forEach((rec, i) => {
            console.log(`\n[${i + 1}]`, JSON.stringify(rec, null, 2).substring(0, 300));
          });
        }
      } catch (error) {
        console.log(`Error investigating: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }

  console.log('\n');
}

reconcileTradesCounts().catch(console.error);
