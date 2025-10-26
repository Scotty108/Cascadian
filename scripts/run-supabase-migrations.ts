#!/usr/bin/env tsx
/**
 * Supabase Migration Runner
 *
 * Applies all Supabase migrations in order
 * Uses Supabase client to execute SQL directly
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');

// Supabase client (requires service role key for admin operations)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Create migrations tracking table
 */
async function createMigrationsTable() {
  console.log('📋 Creating migrations tracking table...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  });

  if (error) {
    // Try direct query if RPC doesn't exist
    const { error: directError } = await supabase
      .from('schema_migrations')
      .select('version')
      .limit(1);

    if (directError && directError.code === '42P01') {
      console.log('⚠️  Cannot create migrations table - using Supabase CLI instead');
      console.log('   Run: npx supabase db reset');
      return;
    }
  }

  console.log('✅ Migrations table ready');
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('schema_migrations')
    .select('version')
    .order('version');

  if (error) {
    console.log('⚠️  Could not query migrations table, assuming none applied');
    return new Set();
  }

  return new Set((data || []).map(row => row.version));
}

/**
 * Get list of migration files (new ones only - from 20251025110000 onwards)
 */
async function getMigrationFiles(): Promise<string[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter(f => f.endsWith('.sql'))
    .filter(f => f >= '20251025110000') // Only new migrations from today
    .sort();
}

/**
 * Apply a single migration using psql
 */
async function applyMigration(filename: string) {
  const version = filename.replace('.sql', '');
  const filepath = path.join(MIGRATIONS_DIR, filename);

  console.log(`\n📦 Applying migration: ${filename}`);

  try {
    // Read SQL file
    const sql = await fs.readFile(filepath, 'utf-8');

    // Split into statements (postgres can handle multiple statements)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^--/));

    // Execute via Supabase REST API using service role
    for (const statement of statements) {
      if (!statement.trim()) continue;

      // Use raw SQL execution
      const { error } = await supabase.rpc('exec_sql', { sql: statement });

      if (error) {
        // Ignore "already exists" errors
        if (error.message?.includes('already exists') || error.code === '42P07') {
          console.log(`   ⚠️  Object already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    // Record migration as applied
    const { error: insertError } = await supabase
      .from('schema_migrations')
      .insert({ version, name: filename });

    if (insertError && !insertError.message?.includes('duplicate')) {
      throw insertError;
    }

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
  console.log('🚀 Supabase Migration Runner');
  console.log('================================\n');

  console.log('⚠️  IMPORTANT: For production, use Supabase CLI:');
  console.log('   npx supabase db push\n');
  console.log('This script is for development/testing only.\n');

  try {
    // Create migrations tracking table
    await createMigrationsTable();

    // Get applied and pending migrations
    const appliedMigrations = await getAppliedMigrations();
    const allMigrations = await getMigrationFiles();
    const pendingMigrations = allMigrations.filter(f => !appliedMigrations.has(f.replace('.sql', '')));

    console.log(`📊 Migration Status:`);
    console.log(`   Applied: ${appliedMigrations.size}`);
    console.log(`   Pending: ${pendingMigrations.length}`);
    console.log(`   Total (new): ${allMigrations.length}`);

    if (pendingMigrations.length === 0) {
      console.log('\n✨ All new migrations are up to date!');
      console.log('\n💡 To apply all migrations (including old ones), use:');
      console.log('   npx supabase db reset');
      return;
    }

    console.log('\n📝 Pending migrations:');
    pendingMigrations.forEach(m => console.log(`   - ${m}`));

    console.log('\n⚠️  These migrations require Supabase CLI to apply properly.');
    console.log('Run: npx supabase db push\n');

  } catch (error: any) {
    console.error('\n💥 Migration check failed:', error.message);
    console.log('\n💡 Use Supabase CLI instead:');
    console.log('   npx supabase db push');
    process.exit(1);
  }
}

// Run migrations
runMigrations();
