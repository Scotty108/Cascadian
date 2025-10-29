#!/usr/bin/env tsx
/**
 * Apply Critical Database Migrations - Direct Execution
 *
 * This script directly executes SQL migrations using the pg library
 * to resolve connection pool exhaustion.
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';

// Construct connection string from Supabase credentials
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL');
  process.exit(1);
}

// Extract project ref from URL
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('❌ Could not extract project ref from URL');
  process.exit(1);
}

// Construct direct connection string (bypassing pooler)
const connectionString = `postgresql://postgres.${projectRef}:${process.env.SUPABASE_DB_PASSWORD || 'YOUR_PASSWORD'}@aws-1-us-east-2.pooler.supabase.com:6543/postgres`;

console.log('🚀 Applying Critical Database Migrations\n');
console.log(`Project: ${projectRef}`);
console.log(`Using direct connection to database\n`);

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 60000,
  max: 1, // Use only 1 connection to avoid pool exhaustion
});

async function executeMigration(filePath: string, name: string): Promise<boolean> {
  console.log(`📋 Applying: ${name}`);
  console.log(`   File: ${filePath}`);

  try {
    const sql = readFileSync(filePath, 'utf-8');

    // Execute the entire SQL file
    const client = await pool.connect();
    try {
      await client.query(sql);
      console.log(`   ✅ SUCCESS\n`);
      return true;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error(`   ❌ FAILED: ${error.message}\n`);
    return false;
  }
}

async function verifyIndexes(pool: Pool): Promise<void> {
  console.log('📊 Verifying indexes...');

  const query = `
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_strategy_definitions_active_scheduled',
        'idx_strategy_definitions_mode_active',
        'idx_strategy_definitions_archived_predefined',
        'idx_notifications_user_read'
      )
    ORDER BY indexname;
  `;

  try {
    const result = await pool.query(query);
    if (result.rows.length > 0) {
      result.rows.forEach((row: any) => {
        console.log(`   ✓ ${row.indexname} on ${row.tablename}`);
      });
    } else {
      console.log('   ⚠️  No indexes found');
    }
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
  }
  console.log();
}

async function verifyStrategies(pool: Pool): Promise<void> {
  console.log('📊 Verifying strategies...');

  const query = `
    SELECT
      COUNT(*) FILTER (WHERE is_archived = false) as active_count,
      COUNT(*) FILTER (WHERE is_archived = true) as archived_count,
      COUNT(*) as total_count,
      STRING_AGG(
        CASE WHEN is_archived = false THEN strategy_name ELSE NULL END,
        ', '
      ) as active_strategies
    FROM strategy_definitions
    WHERE is_predefined = true;
  `;

  try {
    const result = await pool.query(query);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`   Total predefined strategies: ${row.total_count}`);
      console.log(`   Active (unarchived): ${row.active_count}`);
      console.log(`   Archived: ${row.archived_count}`);

      if (row.active_strategies) {
        console.log(`\n   Active strategies:`);
        row.active_strategies.split(', ').forEach((name: string) => {
          console.log(`   ✓ ${name}`);
        });
      }
    }
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
  }
  console.log();
}

async function main() {
  const projectRoot = '/Users/scotty/Projects/Cascadian-app';
  const migrations = [
    {
      file: `${projectRoot}/supabase/migrations/20251029000002_unarchive_default_strategies.sql`,
      name: 'Unarchive Default Strategies'
    },
    {
      file: `${projectRoot}/supabase/migrations/20251029000003_add_performance_indexes.sql`,
      name: 'Add Performance Indexes'
    }
  ];

  const results: Array<{ name: string; success: boolean }> = [];

  // Test connection first
  console.log('Testing database connection...');
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Connection successful\n');
  } catch (error: any) {
    console.error('❌ Connection failed:', error.message);
    console.error('\n💡 The database may still be recovering from connection pool saturation.');
    console.error('   Try again in 30-60 seconds, or check if SUPABASE_DB_PASSWORD is set.\n');
    process.exit(1);
  }

  // Apply migrations
  for (const migration of migrations) {
    const success = await executeMigration(migration.file, migration.name);
    results.push({ name: migration.name, success });

    // Wait between migrations
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Verify results
  console.log('='.repeat(60));
  console.log('MIGRATION RESULTS');
  console.log('='.repeat(60));

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
  });
  console.log();

  // Verify the changes
  await verifyIndexes(pool);
  await verifyStrategies(pool);

  await pool.end();

  const allSuccess = results.every(r => r.success);

  console.log('='.repeat(60));
  if (allSuccess) {
    console.log('✅ ALL MIGRATIONS APPLIED SUCCESSFULLY');
  } else {
    console.log('❌ SOME MIGRATIONS FAILED');
    process.exit(1);
  }
  console.log('='.repeat(60) + '\n');
}

main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
