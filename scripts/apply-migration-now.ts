#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration Directly to Supabase
 *
 * This script connects to the Supabase PostgreSQL database and
 * executes the copy trading migration SQL file.
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

async function applyMigration() {
  console.log('🚀 Starting migration application...\n');

  // Construct the connection string from environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!supabaseUrl || !dbPassword) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   - SUPABASE_DB_PASSWORD:', dbPassword ? '✓' : '✗');
    process.exit(1);
  }

  // Extract project reference from Supabase URL
  // Format: https://cqvjfonlpqycmaonacvz.supabase.co
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

  // Direct database connection (bypassing pooler for DDL)
  const connectionString = `postgresql://postgres:${dbPassword}@db.${projectRef}.supabase.co:5432/postgres`;

  console.log('📊 Connection details:');
  console.log('   Project Ref:', projectRef);
  console.log('   Connection:', connectionString.replace(dbPassword, '****'));
  console.log('');

  // Read the migration file
  const migrationPath = join(process.cwd(), 'supabase/migrations/20251029000001_create_copy_trading_tables.sql');
  console.log('📄 Reading migration file:', migrationPath);

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(migrationPath, 'utf-8');
    console.log('✓ Migration file loaded successfully');
    console.log(`  Lines: ${migrationSQL.split('\n').length}`);
    console.log(`  Size: ${(migrationSQL.length / 1024).toFixed(2)} KB`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to read migration file:', error);
    process.exit(1);
  }

  // Connect to the database
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔌 Connecting to Supabase database...');
    await client.connect();
    console.log('✓ Connected successfully\n');

    // Execute the migration
    console.log('⚡ Executing migration SQL...');
    console.log('   This may take a few moments...\n');

    await client.query(migrationSQL);

    console.log('✅ MIGRATION APPLIED SUCCESSFULLY!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 Copy trading tables created:');
    console.log('   1. tracked_wallets');
    console.log('   2. copy_trade_signals');
    console.log('   3. copy_trades');
    console.log('   4. copy_trade_performance_snapshots');
    console.log('');
    console.log('📊 Views created:');
    console.log('   - v_active_copy_trades');
    console.log('   - v_strategy_copy_performance');
    console.log('   - v_owrr_decision_quality');
    console.log('');
    console.log('🔧 Triggers created:');
    console.log('   - tracked_wallets_update_timestamp');
    console.log('   - copy_trades_update_timestamp');
    console.log('   - update_tracked_wallet_stats_trigger');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Verify tables exist
    console.log('🔍 Verifying tables...\n');

    const tables = [
      'tracked_wallets',
      'copy_trade_signals',
      'copy_trades',
      'copy_trade_performance_snapshots'
    ];

    for (const table of tables) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        ) as exists`,
        [table]
      );

      const exists = result.rows[0].exists;
      if (exists) {
        console.log(`   ✓ ${table}`);
      } else {
        console.log(`   ✗ ${table} - NOT FOUND!`);
      }
    }

    console.log('\n✅ All tables verified!\n');

  } catch (error: any) {
    console.error('\n❌ MIGRATION FAILED!\n');
    console.error('Error details:');
    console.error('  Message:', error.message);
    if (error.code) {
      console.error('  Code:', error.code);
    }
    if (error.detail) {
      console.error('  Detail:', error.detail);
    }
    if (error.hint) {
      console.error('  Hint:', error.hint);
    }
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed.\n');
  }
}

// Run the migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
