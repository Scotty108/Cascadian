import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function testSimpleTable() {
  console.log('Testing basic ClickHouse INSERT/SELECT functionality...\n');

  // Create a simple test table
  console.log('1. Creating test table...\n');

  const createTable = `
    CREATE TABLE IF NOT EXISTS test_insert_visibility (
      id UInt32,
      name String,
      created_at DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY id
  `;

  try {
    await clickhouse.query({ query: createTable });
    console.log('  ✅ Test table created\n');
  } catch (err) {
    console.log(`  ❌ Error creating table: ${err.message}\n`);
    return;
  }

  // Insert test data
  console.log('2. Inserting test data...\n');

  const insertData = `
    INSERT INTO test_insert_visibility (id, name)
    VALUES (1, 'test_row_1'), (2, 'test_row_2'), (3, 'test_row_3')
  `;

  try {
    await clickhouse.query({ query: insertData });
    console.log('  ✅ Test data inserted\n');
  } catch (err) {
    console.log(`  ❌ Error inserting: ${err.message}\n`);
    return;
  }

  // Immediate verification
  console.log('3. Immediate verification...\n');

  const selectQuery = `SELECT * FROM test_insert_visibility ORDER BY id`;

  const selectResult = await clickhouse.query({ query: selectQuery, format: 'JSONEachRow' });
  const selectData = await selectResult.json();

  console.log(`  Rows returned: ${selectData.length}\n`);

  if (selectData.length > 0) {
    console.log('  Data:');
    selectData.forEach(row => {
      console.log(`    ${row.id}: ${row.name} (${row.created_at})`);
    });
    console.log();
  }

  // Cleanup
  console.log('4. Cleaning up...\n');

  try {
    await clickhouse.query({ query: 'DROP TABLE test_insert_visibility' });
    console.log('  ✅ Test table dropped\n');
  } catch (err) {
    console.log(`  ⚠️  Could not drop table: ${err.message}\n`);
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (selectData.length === 3) {
    console.log('✅ Basic INSERT/SELECT works fine\n');
    console.log('The issue is specific to wallet_identity_blacklist and');
    console.log('wallet_clustering_decisions tables.\n');
    console.log('Possible causes:');
    console.log('  - ReplacingMergeTree engine behavior');
    console.log('  - Table permissions or ownership');
    console.log('  - SharedReplacingMergeTree Cloud-specific issue\n');
  } else {
    console.log('❌ Basic INSERT/SELECT is broken\n');
    console.log('This indicates a fundamental ClickHouse connection or permission issue.\n');
  }
}

testSimpleTable()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
