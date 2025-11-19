import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkNewTables() {
  console.log('Checking for new tables created during XCN update...\n');

  // Check if blacklist table exists
  console.log('1. wallet_identity_blacklist\n');

  try {
    const blacklistExistsQuery = `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'wallet_identity_blacklist'
    `;

    const existsResult = await clickhouse.query({ query: blacklistExistsQuery, format: 'JSONEachRow' });
    const existsData = await existsResult.json();

    if (existsData.length > 0) {
      console.log('  ✅ Table exists');
      console.log(`  Engine: ${existsData[0].engine}`);
      console.log(`  Total rows: ${existsData[0].total_rows}\n`);

      // Show schema
      const schemaQuery = `DESCRIBE TABLE wallet_identity_blacklist`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schemaData = await schemaResult.json();

      console.log('  Schema:');
      schemaData.forEach(col => {
        console.log(`    ${col.name}: ${col.type}`);
      });
      console.log();

      // Show all rows
      const rowsQuery = `SELECT * FROM wallet_identity_blacklist`;
      const rowsResult = await clickhouse.query({ query: rowsQuery, format: 'JSONEachRow' });
      const rowsData = await rowsResult.json();

      console.log(`  Rows: ${rowsData.length}`);
      if (rowsData.length > 0) {
        rowsData.forEach((row, i) => {
          console.log(`    [${i + 1}] ${row.executor_wallet} - ${row.reason}`);
        });
      }
      console.log();
    } else {
      console.log('  ❌ Table does not exist\n');
    }
  } catch (err) {
    console.log(`  ❌ Error checking blacklist table: ${err.message}\n`);
  }

  // Check if decisions table exists
  console.log('2. wallet_clustering_decisions\n');

  try {
    const decisionsExistsQuery = `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'wallet_clustering_decisions'
    `;

    const existsResult = await clickhouse.query({ query: decisionsExistsQuery, format: 'JSONEachRow' });
    const existsData = await existsResult.json();

    if (existsData.length > 0) {
      console.log('  ✅ Table exists');
      console.log(`  Engine: ${existsData[0].engine}`);
      console.log(`  Total rows: ${existsData[0].total_rows}\n`);

      // Show schema
      const schemaQuery = `DESCRIBE TABLE wallet_clustering_decisions`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schemaData = await schemaResult.json();

      console.log('  Schema:');
      schemaData.forEach(col => {
        console.log(`    ${col.name}: ${col.type}`);
      });
      console.log();

      // Show all rows
      const rowsQuery = `SELECT * FROM wallet_clustering_decisions`;
      const rowsResult = await clickhouse.query({ query: rowsQuery, format: 'JSONEachRow' });
      const rowsData = await rowsResult.json();

      console.log(`  Rows: ${rowsData.length}`);
      if (rowsData.length > 0) {
        rowsData.forEach((row, i) => {
          console.log(`    [${i + 1}] ${row.canonical_wallet} - ${row.decision}`);
        });
      }
      console.log();
    } else {
      console.log('  ❌ Table does not exist\n');
    }
  } catch (err) {
    console.log(`  ❌ Error checking decisions table: ${err.message}\n`);
  }

  // Check wallet_identity_overrides for XCN
  console.log('3. wallet_identity_overrides (XCN wallet)\n');

  try {
    const overridesQuery = `
      SELECT *
      FROM wallet_identity_overrides
      WHERE canonical_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `;

    const overridesResult = await clickhouse.query({ query: overridesQuery, format: 'JSONEachRow' });
    const overridesData = await overridesResult.json();

    console.log(`  XCN overrides: ${overridesData.length}`);
    if (overridesData.length === 0) {
      console.log('  ✅ All overrides removed (as intended)\n');
    } else {
      console.log('  ⚠️  Overrides still present:');
      overridesData.forEach(row => {
        console.log(`    - ${row.executor_wallet}`);
      });
      console.log();
    }
  } catch (err) {
    console.log(`  ❌ Error checking overrides: ${err.message}\n`);
  }
}

checkNewTables()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
