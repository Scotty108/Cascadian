#!/usr/bin/env node
/**
 * Run Polymarket Database Migration
 *
 * This script connects to Supabase via PostgreSQL and executes the migration.
 * Run with: node scripts/run-migration.js
 */

const { readFileSync } = require('fs');
const { join } = require('path');

// Construct DATABASE_URL from .env.local values
const SUPABASE_URL = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const DB_PASSWORD = 'EwchTep6Zw97GLw';
const DATABASE_URL = `postgresql://postgres:${DB_PASSWORD}@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres`;

async function runMigration() {
  console.log('🚀 Polymarket Database Migration\n');
  console.log(`📡 Connecting to: db.cqvjfonlpqycmaonacvz.supabase.co`);

  // Dynamic import of pg
  const { Client } = await import('pg');

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Supabase requires SSL
  });

  try {
    // Connect to database
    await client.connect();
    console.log('✅ Connected to Supabase\n');

    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase/migrations/20251022131000_create_polymarket_tables.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log(`📄 Migration file: ${(sql.length / 1024).toFixed(1)}KB`);
    console.log(`🔧 Executing SQL...\n`);

    // Execute migration
    await client.query(sql);

    console.log('✅ Migration executed successfully!\n');

    // Verify tables
    console.log('🔍 Verifying tables...');
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('markets', 'sync_logs')
      ORDER BY table_name;
    `);

    if (result.rows.length === 2) {
      console.log('✅ Tables created:');
      result.rows.forEach(row => console.log(`   - ${row.table_name}`));
    } else {
      console.warn('⚠️  Expected 2 tables, found:', result.rows.length);
    }

    // Check indexes
    console.log('\n🔍 Checking indexes...');
    const indexResult = await client.query(`
      SELECT schemaname, tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('markets', 'sync_logs')
      ORDER BY tablename, indexname;
    `);

    console.log(`✅ Created ${indexResult.rows.length} indexes:`);
    indexResult.rows.forEach(row => {
      console.log(`   - ${row.tablename}.${row.indexname}`);
    });

    console.log('\n🎉 Migration complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.position) {
      console.error('   Position in SQL:', error.position);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
