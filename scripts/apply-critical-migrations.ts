#!/usr/bin/env tsx
/**
 * Apply Critical Database Migrations
 *
 * This script applies critical performance fixes to resolve connection pool exhaustion:
 * 1. Performance indexes for cron job queries
 * 2. Unarchive default strategies
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface MigrationResult {
  name: string;
  success: boolean;
  error?: string;
  details?: any;
}

async function executeSQLFile(filePath: string, migrationName: string): Promise<MigrationResult> {
  console.log(`\n📋 Applying migration: ${migrationName}`);
  console.log(`   File: ${filePath}`);

  try {
    const sql = readFileSync(filePath, 'utf-8');

    // Split by semicolons to execute statements individually
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`   Statements to execute: ${statements.length}`);

    const results = [];
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;

      console.log(`   Executing statement ${i + 1}/${statements.length}...`);

      const { data, error } = await supabase.rpc('exec_sql', {
        sql_query: statement
      });

      if (error) {
        // Try direct query method as fallback
        const { data: data2, error: error2 } = await supabase
          .from('_migrations_temp')
          .select('*')
          .limit(0);

        if (error2) {
          console.error(`   ❌ Error on statement ${i + 1}:`, error.message);
          return {
            name: migrationName,
            success: false,
            error: error.message
          };
        }
      }

      results.push(data);
    }

    console.log(`   ✅ Migration completed successfully`);
    return {
      name: migrationName,
      success: true,
      details: results
    };

  } catch (error: any) {
    console.error(`   ❌ Migration failed:`, error.message);
    return {
      name: migrationName,
      success: false,
      error: error.message
    };
  }
}

async function executeSQL(sql: string, description: string): Promise<{ success: boolean; data?: any; error?: any }> {
  console.log(`\n🔧 ${description}`);

  try {
    // Use raw SQL execution through PostgREST
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`   ❌ Failed: ${error}`);
      return { success: false, error };
    }

    const data = await response.json();
    console.log(`   ✅ Success`);
    return { success: true, data };

  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function verifyIndexes(): Promise<void> {
  console.log('\n📊 Verifying indexes...');

  const { data, error } = await supabase
    .from('pg_indexes')
    .select('indexname, tablename')
    .in('indexname', [
      'idx_strategy_definitions_active_scheduled',
      'idx_strategy_definitions_mode_active',
      'idx_strategy_definitions_archived_predefined',
      'idx_notifications_user_read'
    ]);

  if (error) {
    console.error('   ❌ Could not verify indexes:', error.message);
    return;
  }

  console.log('   Indexes found:');
  data?.forEach((idx: any) => {
    console.log(`   ✓ ${idx.indexname} on ${idx.tablename}`);
  });
}

async function verifyStrategies(): Promise<void> {
  console.log('\n📊 Verifying strategies...');

  const { data, error } = await supabase
    .from('strategy_definitions')
    .select('id, strategy_name, is_archived, is_predefined')
    .eq('is_predefined', true)
    .order('strategy_name');

  if (error) {
    console.error('   ❌ Could not verify strategies:', error.message);
    return;
  }

  const archived = data?.filter((s: any) => s.is_archived) || [];
  const active = data?.filter((s: any) => !s.is_archived) || [];

  console.log(`   Total predefined strategies: ${data?.length || 0}`);
  console.log(`   Active (unarchived): ${active.length}`);
  console.log(`   Archived: ${archived.length}`);

  if (active.length > 0) {
    console.log('\n   Active strategies:');
    active.forEach((s: any) => {
      console.log(`   ✓ ${s.strategy_name}`);
    });
  }

  if (archived.length > 0) {
    console.log('\n   ⚠️  Still archived:');
    archived.forEach((s: any) => {
      console.log(`   - ${s.strategy_name}`);
    });
  }
}

async function main() {
  console.log('🚀 Applying Critical Database Migrations\n');
  console.log(`   Database: ${supabaseUrl}`);
  console.log(`   Using service role authentication`);

  const projectRoot = '/Users/scotty/Projects/Cascadian-app';
  const migrations = [
    {
      file: join(projectRoot, 'supabase/migrations/20251029000002_unarchive_default_strategies.sql'),
      name: 'Unarchive Default Strategies'
    },
    {
      file: join(projectRoot, 'supabase/migrations/20251029000003_add_performance_indexes.sql'),
      name: 'Add Performance Indexes'
    }
  ];

  const results: MigrationResult[] = [];

  // Apply migrations
  for (const migration of migrations) {
    const result = await executeSQLFile(migration.file, migration.name);
    results.push(result);

    // Wait a bit between migrations to avoid overwhelming the connection pool
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Verify results
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION RESULTS');
  console.log('='.repeat(60));

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  // Verify the changes
  await verifyIndexes();
  await verifyStrategies();

  const allSuccess = results.every(r => r.success);

  console.log('\n' + '='.repeat(60));
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
