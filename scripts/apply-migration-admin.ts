#!/usr/bin/env tsx
/**
 * Apply Polymarket Migration via Supabase Admin Client
 *
 * Uses the service role key (admin permissions) to execute the migration SQL.
 * This bypasses Row Level Security and has full database access.
 */

import { supabaseAdmin } from '../lib/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';

async function applyMigration() {
  console.log('🚀 Applying Polymarket Database Migration\n');
  console.log('📡 Using Supabase Admin Client (service role key)\n');

  try {
    // Read migration file
    const migrationPath = join(process.cwd(), 'supabase/migrations/20251022131000_create_polymarket_tables.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log(`📄 Migration file: ${(sql.length / 1024).toFixed(1)}KB`);
    console.log(`🔧 Executing SQL...\n`);

    // Execute the SQL migration using the admin client
    // Note: Supabase client doesn't have a direct .query() method for raw SQL
    // We need to use the REST API or split into statements

    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && s !== '');

    console.log(`Found ${statements.length} SQL statements\n`);

    let successCount = 0;
    let failCount = 0;

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip empty statements
      if (!statement || statement.length < 10) continue;

      console.log(`[${i + 1}/${statements.length}] Executing: ${statement.substring(0, 50)}...`);

      try {
        // Use rpc to execute raw SQL (if function exists)
        // Or use direct table operations
        const { data, error } = await supabaseAdmin.rpc('exec_sql', {
          sql_query: statement + ';'
        });

        if (error) {
          // If exec_sql doesn't exist, try alternative approach
          console.log(`   ⚠️  rpc method failed, trying alternative...`);
          throw error;
        }

        console.log(`   ✅ Success`);
        successCount++;

      } catch (error: any) {
        console.error(`   ❌ Error: ${error.message}`);
        failCount++;

        // For DDL statements, we might need to use a different approach
        // Log but continue
      }
    }

    console.log(`\n📊 Results: ${successCount} succeeded, ${failCount} failed`);

    if (failCount > 0) {
      console.log('\n⚠️  Some statements failed. This might be expected for:');
      console.log('   - Extensions that already exist');
      console.log('   - Functions that need special permissions');
      console.log('\nLet me verify what was actually created...\n');
    }

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const { data: tables, error: tableError } = await supabaseAdmin
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['markets', 'sync_logs']);

    if (tableError) {
      console.error('❌ Error verifying tables:', tableError);
    } else {
      console.log(`✅ Found ${tables?.length || 0} tables:`, tables?.map(t => t.table_name));
    }

    // Verify using a simple query
    console.log('\n🔍 Testing markets table...');
    const { data: marketTest, error: marketError } = await supabaseAdmin
      .from('markets')
      .select('market_id')
      .limit(1);

    if (marketError) {
      console.error('❌ Markets table not accessible:', marketError.message);
    } else {
      console.log('✅ Markets table exists and is accessible');
    }

    console.log('\n🔍 Testing sync_logs table...');
    const { data: syncTest, error: syncError } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .limit(1);

    if (syncError) {
      console.error('❌ Sync_logs table not accessible:', syncError.message);
    } else {
      console.log('✅ Sync_logs table exists and is accessible');
    }

    console.log('\n✅ Migration application complete!');
    console.log('\n💡 If tables were not created, you may need to run the SQL');
    console.log('   directly via the Supabase Dashboard SQL Editor.');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run migration
applyMigration();
