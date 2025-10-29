#!/usr/bin/env tsx
/**
 * Apply Critical Database Migrations via Supabase REST API
 *
 * This script applies SQL migrations using Supabase's REST API with the service role key.
 * This approach avoids connection pool issues by using HTTP requests instead of database connections.
 */

import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!SUPABASE_URL);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!SERVICE_ROLE_KEY);
  process.exit(1);
}

interface MigrationResult {
  name: string;
  success: boolean;
  error?: string;
  rowsAffected?: number;
}

/**
 * Execute SQL via Supabase's REST API using a custom SQL function
 */
async function executeSQL(sql: string, maxRetries = 3): Promise<any> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use fetch to execute raw SQL via PostgREST
      // This requires the sql function to be created, or we use direct queries
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ query: sql })
      });

      if (response.status === 522) {
        console.log(`   ⏳ Attempt ${attempt}/${maxRetries}: Got 522 timeout, retrying in 30s...`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();

    } catch (error: any) {
      lastError = error;
      if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
        console.log(`   ⏳ Attempt ${attempt}/${maxRetries}: Connection issue, retrying in 30s...`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * Execute SQL statements directly using table queries as a workaround
 */
async function executeStatements(statements: string[]): Promise<boolean> {
  // Since we can't execute arbitrary SQL via REST API directly,
  // we need to use the Supabase client or create a helper function.
  // Let's try a different approach - manual execution of each statement type.

  for (const stmt of statements) {
    const trimmed = stmt.trim().toUpperCase();

    // Skip comments and empty statements
    if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('COMMENT')) {
      continue;
    }

    console.log(`   Executing: ${trimmed.substring(0, 80)}...`);

    // For now, we'll return false and require manual execution
    // This is a limitation of using REST API for DDL
    return false;
  }

  return true;
}

/**
 * Apply a migration file
 */
async function applyMigration(filePath: string, name: string): Promise<MigrationResult> {
  console.log(`\n📋 ${name}`);
  console.log(`   File: ${filePath}`);

  try {
    const sql = readFileSync(filePath, 'utf-8');

    // Split into statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`   Statements: ${statements.length}`);

    // Try to execute via API
    try {
      await executeSQL(sql);
      console.log(`   ✅ SUCCESS`);
      return { name, success: true };
    } catch (error: any) {
      // If exec_sql doesn't exist, we need to use Supabase CLI or manual execution
      if (error.message.includes('exec_sql') || error.message.includes('not found')) {
        console.log(`   ⚠️  REST API execution not available`);
        console.log(`   📝 SQL to execute manually:\n`);
        console.log(sql);
        console.log();
        return {
          name,
          success: false,
          error: 'REST API execution not available - manual execution required'
        };
      }
      throw error;
    }

  } catch (error: any) {
    console.log(`   ❌ FAILED: ${error.message}`);
    return { name, success: false, error: error.message };
  }
}

/**
 * Verify indexes exist
 */
async function verifyIndexes(): Promise<void> {
  console.log('\n📊 Verifying indexes via REST API...');

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/pg_indexes?select=indexname,tablename&indexname=in.(idx_strategy_definitions_active_scheduled,idx_strategy_definitions_mode_active,idx_strategy_definitions_archived_predefined,idx_notifications_user_read)`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
        }
      }
    );

    if (response.ok) {
      const indexes = await response.json();
      if (indexes.length > 0) {
        indexes.forEach((idx: any) => {
          console.log(`   ✓ ${idx.indexname} on ${idx.tablename}`);
        });
      } else {
        console.log('   ⚠️  No indexes found (may not have pg_indexes access via REST)');
      }
    } else {
      console.log('   ⚠️  Could not query indexes via REST API');
    }
  } catch (error: any) {
    console.log(`   ⚠️  ${error.message}`);
  }
}

/**
 * Verify strategies were unarchived
 */
async function verifyStrategies(): Promise<void> {
  console.log('\n📊 Verifying strategies...');

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/strategy_definitions?select=id,strategy_name,is_archived,is_predefined&is_predefined=eq.true&order=strategy_name`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
        }
      }
    );

    if (response.ok) {
      const strategies = await response.json();
      const active = strategies.filter((s: any) => !s.is_archived);
      const archived = strategies.filter((s: any) => s.is_archived);

      console.log(`   Total predefined strategies: ${strategies.length}`);
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
    } else {
      console.log('   ❌ Could not query strategies');
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Applying Critical Database Migrations\n');
  console.log(`Database: ${SUPABASE_URL}`);
  console.log('Method: Supabase REST API with Service Role Key\n');

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

  console.log('⚠️  NOTE: REST API has limitations for executing DDL statements.');
  console.log('If automatic execution fails, SQL will be provided for manual execution.\n');

  const results: MigrationResult[] = [];

  // Apply migrations
  for (const migration of migrations) {
    const result = await applyMigration(migration.file, migration.name);
    results.push(result);

    // Wait between attempts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Verify results
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION RESULTS');
  console.log('='.repeat(70));

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  console.log();

  // Verify changes
  await verifyIndexes();
  await verifyStrategies();

  console.log('\n' + '='.repeat(70));

  const allSuccess = results.every(r => r.success);
  if (allSuccess) {
    console.log('✅ ALL MIGRATIONS APPLIED SUCCESSFULLY');
  } else {
    console.log('⚠️  MANUAL EXECUTION REQUIRED');
    console.log('\nPlease run the SQL statements shown above directly in the');
    console.log('Supabase SQL Editor or using the Supabase CLI when the database');
    console.log('connection pool has recovered.');
  }

  console.log('='.repeat(70) + '\n');

  if (!allSuccess) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
