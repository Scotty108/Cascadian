#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration via Supabase Client
 *
 * Uses the Supabase JavaScript client with service role key
 * to execute DDL statements.
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

async function applyMigration() {
  console.log('🚀 Starting migration application via Supabase Client...\n');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓' : '✗');
    process.exit(1);
  }

  console.log('📊 Connection details:');
  console.log('   Supabase URL:', supabaseUrl);
  console.log('   Service Role Key:', serviceRoleKey.substring(0, 20) + '...');
  console.log('');

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

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

  try {
    console.log('⚡ Executing migration SQL via Supabase RPC...');
    console.log('   This may take a few moments...\n');

    // Execute using rpc to run raw SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });

    if (error) {
      // Try direct SQL execution if exec_sql doesn't exist
      console.log('   RPC method not available, trying direct SQL execution...\n');

      // Split SQL into individual statements and execute them
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      console.log(`   Found ${statements.length} SQL statements to execute\n`);

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.length === 0) continue;

        console.log(`   [${i + 1}/${statements.length}] Executing statement...`);

        // Use the from() method with a dummy table then use .raw() if available
        // Or try using the REST API directly
        const { error: stmtError } = await supabase.from('_migrations').select('*').limit(0).then(() => {
          // This is a workaround - we'll need to use a different approach
          return { error: new Error('Cannot execute DDL via Supabase client') };
        });

        if (stmtError) {
          throw new Error('Supabase client cannot execute DDL statements directly');
        }
      }
    }

    console.log('✅ MIGRATION APPLIED SUCCESSFULLY!\n');

  } catch (error: any) {
    console.error('\n❌ MIGRATION FAILED!\n');
    console.error('Error details:', error.message);
    console.error('\nNote: Supabase client cannot execute DDL statements directly.');
    console.error('We need to use a different method.\n');
    process.exit(1);
  }
}

// Run the migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
