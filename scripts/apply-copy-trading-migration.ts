#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration to Supabase
 *
 * This script reads and applies the copy trading tables migration
 * to the Supabase PostgreSQL database.
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

// Construct PostgreSQL connection string
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;

if (!SUPABASE_URL || !SUPABASE_PASSWORD) {
  console.error('Error: Missing Supabase credentials');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!SUPABASE_URL);
  console.error('SUPABASE_DB_PASSWORD:', !!SUPABASE_PASSWORD);
  process.exit(1);
}

// Extract project reference from URL
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('Error: Could not extract project reference from Supabase URL');
  process.exit(1);
}

// Use direct database connection (not pooler) for DDL operations
const connectionString = `postgresql://postgres:${SUPABASE_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`;

async function applyMigration() {
  console.log('📋 Copy Trading Migration Script');
  console.log('=====================================\n');

  // Read the migration file
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20251029000001_create_copy_trading_tables.sql');
  console.log(`📂 Reading migration file: ${migrationPath}`);

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(migrationPath, 'utf-8');
    console.log(`✅ Migration file loaded (${migrationSQL.length} characters)\n`);
  } catch (error) {
    console.error('❌ Failed to read migration file:', error);
    process.exit(1);
  }

  // Connect to database
  console.log('🔌 Connecting to Supabase PostgreSQL...');
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Apply the migration
    console.log('🚀 Applying migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    // Verify tables were created
    await verifyTables(client);

  } catch (error: any) {
    console.error('❌ Failed to apply migration:', error.message);
    if (error.message.includes('already exists')) {
      console.log('\nℹ️  Some tables may already exist. Verifying...\n');
      await verifyTables(client);
    } else {
      console.error('\nDetailed error:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

async function verifyTables(client: Client) {
  console.log('🔍 Verifying tables were created...\n');

  const tables = [
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  ];

  for (const table of tables) {
    try {
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      `, [table]);

      if (result.rows[0].count === '1') {
        // Get row count
        const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`  ✅ ${table}: EXISTS (${countResult.rows[0].count} rows)`);
      } else {
        console.log(`  ❌ ${table}: NOT FOUND`);
      }
    } catch (error: any) {
      console.log(`  ❌ ${table}: ERROR (${error.message})`);
    }
  }

  console.log('\n🔍 Verifying indexes...\n');

  try {
    const indexResult = await client.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('tracked_wallets', 'copy_trade_signals', 'copy_trades', 'copy_trade_performance_snapshots')
      ORDER BY tablename, indexname
    `);

    console.log(`  Found ${indexResult.rows.length} indexes:\n`);
    for (const row of indexResult.rows) {
      console.log(`    - ${row.tablename}.${row.indexname}`);
    }
  } catch (error: any) {
    console.log(`  ❌ Error checking indexes: ${error.message}`);
  }

  console.log('\n🔍 Verifying views...\n');

  const views = [
    'v_active_copy_trades',
    'v_strategy_copy_performance',
    'v_owrr_decision_quality'
  ];

  for (const view of views) {
    try {
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.views
        WHERE table_schema = 'public'
        AND table_name = $1
      `, [view]);

      if (result.rows[0].count === '1') {
        console.log(`  ✅ ${view}: EXISTS`);
      } else {
        console.log(`  ❌ ${view}: NOT FOUND`);
      }
    } catch (error: any) {
      console.log(`  ❌ ${view}: ERROR (${error.message})`);
    }
  }

  console.log('\n🎉 Migration verification complete!');
}

// Run the migration
applyMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
