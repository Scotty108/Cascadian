#!/usr/bin/env npx tsx
/**
 * Reset wallet_metrics table - Drop and recreate with correct schema
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  try {
    console.log('Checking existing table...\n');

    // Check if table exists
    const checkQuery = `
      SELECT name, engine, create_table_query
      FROM system.tables
      WHERE database = 'default' AND name = 'wallet_metrics'
    `;

    const checkResult = await ch.query({ query: checkQuery, format: 'JSONEachRow' });
    const tables = await checkResult.json<any[]>();

    if (tables.length > 0) {
      console.log('Existing table found:');
      console.log(tables[0].create_table_query);
      console.log('\nDropping existing table...\n');

      await ch.query({ query: 'DROP TABLE IF EXISTS default.wallet_metrics' });
      console.log('✅ Table dropped\n');
    } else {
      console.log('No existing table found\n');
    }

    console.log('Creating new wallet_metrics table...\n');

    const createTableSQL = `
      CREATE TABLE default.wallet_metrics (
        wallet_address String NOT NULL,
        time_window Enum8(
          '30d' = 1,
          '90d' = 2,
          '180d' = 3,
          'lifetime' = 4
        ) NOT NULL,
        realized_pnl Float64 DEFAULT 0,
        unrealized_payout Float64 DEFAULT 0,
        roi_pct Float64 DEFAULT 0,
        win_rate Float64 DEFAULT 0,
        sharpe_ratio Float64 DEFAULT 0,
        omega_ratio Float64 DEFAULT 0,
        total_trades UInt32 DEFAULT 0,
        markets_traded UInt32 DEFAULT 0,
        calculated_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet_address, time_window)
      PARTITION BY time_window
      PRIMARY KEY (wallet_address, time_window)
    `;

    await ch.query({ query: createTableSQL });
    console.log('✅ Table created successfully\n');

    // Verify schema
    const verifyQuery = `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default' AND table = 'wallet_metrics'
      ORDER BY position
    `;

    const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
    const columns = await verifyResult.json<any[]>();

    console.log('Table schema:');
    columns.forEach(col => {
      console.log(`  • ${col.name}: ${col.type}`);
    });
    console.log('\n✅ Schema verified - ready for population\n');

  } catch (error: any) {
    console.error(`❌ ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
