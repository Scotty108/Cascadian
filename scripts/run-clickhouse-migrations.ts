#!/usr/bin/env tsx
/**
 * ClickHouse Migration Runner
 *
 * Applies all ClickHouse migrations in order
 * Tracks applied migrations to avoid duplicates
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables from .env.local
config({ path: '.env.local' });

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations/clickhouse');

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

/**
 * Create migrations tracking table
 */
async function createMigrationsTable() {
  console.log('📋 Creating migrations tracking table...');

  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version String,
        name String,
        applied_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (version);
    `
  });

  console.log('✅ Migrations table ready');
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await clickhouse.query({
    query: 'SELECT version FROM schema_migrations ORDER BY version',
    format: 'JSONEachRow'
  });

  const data = await result.json<{ version: string }[]>();
  return new Set(data.map(row => row.version));
}

/**
 * Get list of migration files
 */
async function getMigrationFiles(): Promise<string[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter(f => f.endsWith('.sql'))
    .sort(); // Alphabetical order ensures correct sequence (001, 002, 003...)
}

/**
 * Apply a single migration
 */
async function applyMigration(filename: string) {
  const version = filename.replace('.sql', '');
  const filepath = path.join(MIGRATIONS_DIR, filename);

  console.log(`\n📦 Applying migration: ${filename}`);

  try {
    // Read SQL file
    const sql = await fs.readFile(filepath, 'utf-8');

    // Remove comments and split into statements
    const statements = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Execute each statement
    for (const statement of statements) {
      if (statement.toUpperCase().startsWith('COMMENT ON')) {
        // Skip COMMENT statements (ClickHouse doesn't support them)
        console.log('   ⏭️  Skipping COMMENT statement');
        continue;
      }

      try {
        await clickhouse.exec({ query: statement });
      } catch (error: any) {
        // Ignore "already exists" errors
        if (error.message?.includes('already exists') || error.message?.includes('ALREADY_EXISTS')) {
          console.log(`   ⚠️  Object already exists, skipping: ${error.message.split('\n')[0]}`);
        } else {
          throw error;
        }
      }
    }

    // Record migration as applied
    await clickhouse.insert({
      table: 'schema_migrations',
      values: [{
        version,
        name: filename
      }],
      format: 'JSONEachRow'
    });

    console.log(`✅ Migration applied: ${filename}`);
  } catch (error: any) {
    console.error(`❌ Error applying migration ${filename}:`, error.message);
    throw error;
  }
}

/**
 * Main migration runner
 */
async function runMigrations() {
  console.log('🚀 ClickHouse Migration Runner');
  console.log('================================\n');

  try {
    // Create migrations tracking table
    await createMigrationsTable();

    // Get applied and pending migrations
    const appliedMigrations = await getAppliedMigrations();
    const allMigrations = await getMigrationFiles();
    const pendingMigrations = allMigrations.filter(f => !appliedMigrations.has(f.replace('.sql', '')));

    console.log(`\n📊 Migration Status:`);
    console.log(`   Applied: ${appliedMigrations.size}`);
    console.log(`   Pending: ${pendingMigrations.length}`);
    console.log(`   Total: ${allMigrations.length}`);

    if (pendingMigrations.length === 0) {
      console.log('\n✨ All migrations are up to date!');
      return;
    }

    console.log('\n📝 Pending migrations:');
    pendingMigrations.forEach(m => console.log(`   - ${m}`));

    // Apply pending migrations in order
    for (const migration of pendingMigrations) {
      await applyMigration(migration);
    }

    console.log('\n✨ All migrations completed successfully!');
  } catch (error: any) {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  } finally {
    await clickhouse.close();
  }
}

// Run migrations
runMigrations();
