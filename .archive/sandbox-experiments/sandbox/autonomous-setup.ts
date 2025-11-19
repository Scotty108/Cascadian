import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface DbStatus {
  name: string;
  engine: string;
  total_rows?: number;
  total_bytes?: number;
}

interface TableInfo {
  name: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
}

export async function setupInvestigation(): Promise<void> {
  console.log('🔍 Autonomous P&L Investigation - Setup Phase');

  try {
    // Test database connection
    console.log('Testing ClickHouse connection...');
    const testResult = await clickhouse.query({
      query: 'SELECT 1 as test',
      format: 'JSONEachRow'
    });
    const testData = await testResult.json();
    console.log('✅ Connection test:', testData);

    // Create sandbox database
    console.log('\nSetting up sandbox database...');
    await clickhouse.query({
      query: 'CREATE DATABASE IF NOT EXISTS sandbox',
      format: 'JSONEachRow'
    });
    console.log('✅ Sandbox database created/verified');

    // Show available databases
    console.log('\n📊 Database inventory:');
    const dbResult = await clickhouse.query({
      query: `
        SELECT name, engine
        FROM system.databases
        WHERE name IN ('default', 'cascadian_clean', 'sandbox')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const databases = await dbResult.json();
    databases.forEach((db: DbStatus) => {
      console.log(`- ${db.name}: ${db.engine}`);
    });

    // Show critical tables in default schema
    console.log('\n📋 Critical tables in default schema:');
    const tablesResult = await clickhouse.query({
      query: `
        SELECT name, formatReadableSize(total_bytes) AS size,
               total_rows, engine
        FROM system.tables
        WHERE database = 'default'
          AND name IN ('clob_fills', 'erc1155_transfers', 'market_key_map',
                      'market_resolutions_by_market', 'ctf_to_market_bridge_mat')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    });
    const tables = await tablesResult.json();
    tables.forEach((table: TableInfo) => {
      console.log(`- ${table.name}: ${table.total_rows.toLocaleString()} rows, ${table.engine}`);
    });

    // Show important cascadian_clean tables
    console.log('\n📋 Critical tables in cascadian_clean schema:');
    const cascResult = await clickhouse.query({
      query: `
        SELECT name, formatReadableSize(total_bytes) AS size,
               total_rows, engine
        FROM system.tables
        WHERE database = 'cascadian_clean'
          AND name IN ('token_to_cid_bridge')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    });
    const cascTables = await cascResult.json();
    cascTables.forEach((table: TableInfo) => {
      console.log(`- ${table.name}: ${table.total_rows.toLocaleString()} rows, ${table.engine}`);
    });

    console.log('\n🚀 Setup complete! Ready to proceed with investigation.');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupInvestigation()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}