/**
 * Phase 1: Check ERC1155 Transfer Coverage
 *
 * Determines if we can recover condition_ids from existing ERC1155 data
 * or if we need to hit blockchain API.
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

const WALLETS = {
  wallet2: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  wallet3: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  wallet4: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
};

async function main() {
  try {
    console.log('\n=== PHASE 1: ERC1155 RECOVERY COVERAGE CHECK ===\n');

    // 1. Check if erc1155_transfers table exists
    console.log('1. Checking for ERC1155 transfer tables...\n');
    const tablesQuery = `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
      AND name LIKE '%erc1155%' OR name LIKE '%transfer%'
      ORDER BY name
    `;

    const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
    const tables = await tablesResult.json();
    console.table(tables);

    if (tables.length === 0) {
      console.log('\n❌ NO ERC1155 TABLES FOUND');
      console.log('RECOMMENDATION: Use Option A (Blockchain Reconstruction)');
      await client.close();
      return;
    }

    // 2. Check coverage of invalid trades in available transfer tables
    console.log('\n2. Checking coverage for each transfer table...\n');

    for (const table of tables) {
      const tableName = table.name;

      try {
        // Get table schema to find relevant columns
        const schemaQuery = `DESCRIBE TABLE ${tableName}`;
        const schemaResult = await client.query({ query: schemaQuery, format: 'JSONEachRow' });
        const schema = await schemaResult.json<{ name: string }>();

        const hasTokenId = schema.some(col => col.name.toLowerCase().includes('token'));
        const hasTxHash = schema.some(col => col.name.toLowerCase().includes('hash') || col.name.toLowerCase().includes('tx'));

        if (!hasTokenId && !hasTxHash) {
          console.log(`  [SKIP] ${tableName}: No token_id or tx_hash columns`);
          continue;
        }

        console.log(`\n  Analyzing: ${tableName}`);
        console.log(`    Has token_id: ${hasTokenId}`);
        console.log(`    Has tx_hash: ${hasTxHash}`);

        // Sample the table
        const sampleQuery = `SELECT * FROM ${tableName} LIMIT 3`;
        const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
        const samples = await sampleResult.json();
        console.log('\n    Sample rows:');
        console.table(samples);

      } catch (err: any) {
        console.log(`  [ERROR] ${tableName}: ${err.message.substring(0, 60)}`);
      }
    }

    // 3. If we have a good candidate table, check coverage
    console.log('\n3. Checking if we can match invalid trades to any transfer data...\n');

    // Get sample invalid transaction hashes
    const invalidTxQuery = `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE condition_id = ''
      AND wallet_address IN (
        '${WALLETS.wallet2}',
        '${WALLETS.wallet3}',
        '${WALLETS.wallet4}'
      )
      LIMIT 10
    `;

    const invalidTxResult = await client.query({ query: invalidTxQuery, format: 'JSONEachRow' });
    const invalidTxs = await invalidTxResult.json<{ transaction_hash: string }>();

    console.log(`Found ${invalidTxs.length} sample invalid transaction hashes`);

    // Try to find matches in any table with similar tx structure
    if (invalidTxs.length > 0) {
      const sampleTx = invalidTxs[0].transaction_hash;
      console.log(`\nSearching for sample tx: ${sampleTx.substring(0, 20)}...\n`);

      // Search in all tables
      for (const table of tables) {
        const tableName = table.name;

        try {
          const searchQuery = `
            SELECT COUNT(*) as matches
            FROM ${tableName}
            WHERE toString(transaction_hash) LIKE '%${sampleTx.substring(2, 20)}%'
               OR toString(tx_hash) LIKE '%${sampleTx.substring(2, 20)}%'
               OR toString(transactionHash) LIKE '%${sampleTx.substring(2, 20)}%'
          `;

          const searchResult = await client.query({ query: searchQuery, format: 'JSONEachRow' });
          const searchRows = await searchResult.json<{ matches: string }>();

          if (parseInt(searchRows[0].matches) > 0) {
            console.log(`  ✅ FOUND in ${tableName}: ${searchRows[0].matches} matches`);
          }
        } catch (err) {
          // Ignore tables without these columns
        }
      }
    }

    console.log('\n=== RECOMMENDATION ===\n');
    console.log('Based on available tables, please check manually:');
    console.log('- If you have a table with both tx_hash AND token_id/condition_id → Option C (ERC1155 Recovery)');
    console.log('- If no such table exists → Option A (Blockchain Reconstruction)');
    console.log('\nNext: Implement chosen option in separate script');

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
