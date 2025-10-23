#!/usr/bin/env tsx
/**
 * Apply Polymarket database migration to Supabase
 *
 * This script reads the migration SQL file and executes it against the Supabase database
 * using the service role key for full permissions.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration() {
  console.log('🚀 Starting Polymarket database migration...\n');

  // Read migration file
  const migrationPath = join(process.cwd(), 'supabase/migrations/20251022131000_create_polymarket_tables.sql');
  console.log(`📄 Reading migration: ${migrationPath}`);

  const sql = readFileSync(migrationPath, 'utf-8');

  console.log(`📝 SQL file size: ${(sql.length / 1024).toFixed(1)}KB`);
  console.log(`📊 Executing migration...\n`);

  try {
    // Execute the SQL migration
    // Note: Supabase client doesn't support raw SQL execution directly from client
    // We need to use the REST API or run this via psql
    // For now, let's try using the rpc function or create a helper

    // Split SQL into individual statements and execute them
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments and empty lines
      if (!statement || statement.startsWith('--')) continue;

      console.log(`[${i + 1}/${statements.length}] Executing...`);

      // Use rpc to execute raw SQL
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });

      if (error) {
        console.error(`\n❌ Error executing statement ${i + 1}:`, error.message);
        console.error('Statement:', statement.substring(0, 100) + '...');
        throw error;
      }

      console.log(`✅ Statement ${i + 1} executed successfully`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Verifying tables...');

    // Verify tables were created
    const { data: tables, error: verifyError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['markets', 'sync_logs']);

    if (verifyError) {
      console.error('❌ Error verifying tables:', verifyError);
    } else {
      console.log('✅ Tables verified:', tables);
    }

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
applyMigration();
