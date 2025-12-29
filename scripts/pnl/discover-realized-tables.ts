/**
 * Discover Canonical Realized PnL Tables
 *
 * Searches ClickHouse for tables related to realized PnL, redemption, and ledger data.
 * Compares values against V29 engine and UI tooltip truth.
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function searchTables(pattern: string): Promise<string[]> {
  const query = `SHOW TABLES LIKE '%${pattern}%'`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map((r: any) => r.name);
}

async function describeTable(tableName: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TABLE: ${tableName}`);
  console.log('='.repeat(80));

  try {
    const descQuery = `DESCRIBE TABLE ${tableName}`;
    const descResult = await clickhouse.query({ query: descQuery, format: 'JSONEachRow' });
    const columns = await descResult.json() as any[];

    console.log('Columns:');
    for (const col of columns) {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`);
    }

    // Get row count
    const countQuery = `SELECT count() as cnt FROM ${tableName}`;
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const countRows = await countResult.json() as any[];
    console.log(`\nRow count: ${countRows[0].cnt}`);

    // Sample a few rows
    const sampleQuery = `SELECT * FROM ${tableName} LIMIT 3`;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleRows = await sampleResult.json() as any[];

    if (sampleRows.length > 0) {
      console.log('\nSample rows:');
      console.log(JSON.stringify(sampleRows, null, 2));
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }
}

async function compareTableValues(tableName: string, wallets: string[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`COMPARING: ${tableName}`);
  console.log('='.repeat(80));

  for (const wallet of wallets) {
    try {
      // Try to find PnL-like columns
      const query = `
        SELECT *
        FROM ${tableName}
        WHERE lower(wallet) = lower('${wallet}') OR lower(wallet_address) = lower('${wallet}')
        LIMIT 1
      `;

      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = await result.json() as any[];

      if (rows.length > 0) {
        console.log(`\n${wallet.slice(0, 10)}...`);
        console.log(JSON.stringify(rows[0], null, 2));
      }
    } catch (e: any) {
      // Table might not have wallet column
      console.log(`  ${wallet.slice(0, 10)}... - Column not found or error`);
    }
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DISCOVER CANONICAL REALIZED PNL TABLES');
  console.log('='.repeat(80));

  const patterns = ['realiz', 'pnl', 'ledger', 'redempt'];
  const outlierWallets = [
    '0xd04f7c90bc6f15a29c744b4e974a19fcd7aa5acd',
    '0x61a10eac439207396992885a78dacc2ca1766657',
    '0x65b8e0082af7a5f53356755520d596516421aca8',
  ];

  const allTables = new Set<string>();

  for (const pattern of patterns) {
    console.log(`\nSearching for tables matching: %${pattern}%`);
    const tables = await searchTables(pattern);
    console.log(`Found ${tables.length} tables`);

    for (const table of tables) {
      allTables.add(table);
      console.log(`  - ${table}`);
    }
  }

  console.log(`\n\nTotal unique tables found: ${allTables.size}`);

  // Describe and sample promising tables
  const promisingTables = Array.from(allTables).filter(t =>
    t.includes('pnl') || t.includes('realiz') || t.includes('ledger')
  );

  console.log(`\n\nDescribing ${promisingTables.length} promising tables...`);

  for (const table of promisingTables) {
    await describeTable(table);
  }

  // Compare values for outlier wallets
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('COMPARING VALUES FOR OUTLIER WALLETS');
  console.log('='.repeat(80));

  for (const table of promisingTables) {
    await compareTableValues(table, outlierWallets);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('DISCOVERY COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
