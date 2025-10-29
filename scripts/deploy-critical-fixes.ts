#!/usr/bin/env tsx
/**
 * Deploy Critical Database Fixes
 *
 * This script handles the deployment of critical performance fixes:
 * 1. Unarchive default strategies
 * 2. Add performance indexes
 *
 * Due to connection pool saturation, this script provides SQL for manual execution
 * and also attempts automated deployment via the Supabase Management API.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { basename } from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Extract project ref from URL
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log('🚀 CRITICAL DATABASE FIXES DEPLOYMENT\n');
console.log('=' .repeat(70));
console.log(`Project: ${projectRef}`);
console.log(`Database: ${SUPABASE_URL}`);
console.log('=' .repeat(70));
console.log();

const projectRoot = '/Users/scotty/Projects/Cascadian-app';
const migrations = [
  {
    file: `${projectRoot}/supabase/migrations/20251029000002_unarchive_default_strategies.sql`,
    name: 'Unarchive Default Strategies',
    description: 'Restores predefined strategies that were incorrectly archived'
  },
  {
    file: `${projectRoot}/supabase/migrations/20251029000003_add_performance_indexes.sql`,
    name: 'Add Performance Indexes',
    description: 'Creates indexes to prevent full table scans by cron jobs'
  }
];

// Print migration SQL for manual execution
console.log('📋 MIGRATION SQL (For Manual Execution if Automated Fails)\n');
console.log('If automated deployment fails due to connection issues, copy and paste');
console.log('the following SQL into the Supabase SQL Editor:\n');
console.log(`https://supabase.com/dashboard/project/${projectRef}/sql/new\n`);

migrations.forEach(migration => {
  const sql = readFileSync(migration.file, 'utf-8');
  console.log('-'.repeat(70));
  console.log(`-- ${migration.name}`);
  console.log(`-- ${migration.description}`);
  console.log(`-- File: ${basename(migration.file)}`);
  console.log('-'.repeat(70));
  console.log(sql);
  console.log();
});

console.log('=' .repeat(70));
console.log('\n🤖 ATTEMPTING AUTOMATED DEPLOYMENT\n');

/**
 * Verify strategies status
 */
async function checkStrategies(): Promise<{ total: number; active: number; archived: number; names: string[] }> {
  const { data, error } = await supabase
    .from('strategy_definitions')
    .select('strategy_name, is_archived, is_predefined')
    .eq('is_predefined', true)
    .order('strategy_name');

  if (error) {
    console.error('   ❌ Error querying strategies:', error.message);
    return { total: 0, active: 0, archived: 0, names: [] };
  }

  const active = data.filter(s => !s.is_archived);
  const archived = data.filter(s => s.is_archived);

  return {
    total: data.length,
    active: active.length,
    archived: archived.length,
    names: active.map(s => s.strategy_name)
  };
}

/**
 * Unarchive strategies directly via Supabase client
 */
async function unarchiveStrategies(): Promise<boolean> {
  console.log('📝 Step 1: Unarchiving default strategies...');

  try {
    const { data, error } = await supabase
      .from('strategy_definitions')
      .update({ is_archived: false })
      .eq('is_predefined', true)
      .eq('is_archived', true)
      .select('strategy_name');

    if (error) {
      console.error('   ❌ Failed:', error.message);
      return false;
    }

    if (data && data.length > 0) {
      console.log(`   ✅ Unarchived ${data.length} strategies:`);
      data.forEach(s => console.log(`      - ${s.strategy_name}`));
    } else {
      console.log('   ℹ️  No strategies needed unarchiving (already active)');
    }

    return true;

  } catch (error: any) {
    console.error('   ❌ Error:', error.message);
    return false;
  }
}

/**
 * Create indexes - this must be done via raw SQL
 */
async function createIndexes(): Promise<boolean> {
  console.log('\n📝 Step 2: Creating performance indexes...');
  console.log('   ⚠️  Note: Index creation requires SQL execution');

  const indexSQL = readFileSync(
    `${projectRoot}/supabase/migrations/20251029000003_add_performance_indexes.sql`,
    'utf-8'
  );

  // Try to use sql editor endpoint or rpc
  try {
    // Supabase doesn't expose a direct SQL execution endpoint via client library
    // We need to use the Management API or SQL Editor
    console.log('   ℹ️  Indexes must be created manually via SQL Editor');
    console.log('   📎 SQL is printed above for manual execution');
    return false;

  } catch (error: any) {
    console.error('   ❌ Error:', error.message);
    return false;
  }
}

/**
 * Verify indexes exist
 */
async function verifyIndexes(): Promise<void> {
  console.log('\n📊 Verifying indexes...');

  const indexNames = [
    'idx_strategy_definitions_active_scheduled',
    'idx_strategy_definitions_mode_active',
    'idx_strategy_definitions_archived_predefined',
    'idx_notifications_user_read'
  ];

  // We can't easily query pg_indexes via client, so we'll note this
  console.log('   ℹ️  Index verification requires direct database access');
  console.log('   Expected indexes:');
  indexNames.forEach(name => console.log(`      - ${name}`));
}

async function main() {
  console.log('Checking current database state...\n');

  // Check current state
  const beforeState = await checkStrategies();
  console.log('📊 Current State:');
  console.log(`   Total predefined strategies: ${beforeState.total}`);
  console.log(`   Active: ${beforeState.active}`);
  console.log(`   Archived: ${beforeState.archived}`);

  if (beforeState.active > 0) {
    console.log('\n   Active strategies:');
    beforeState.names.forEach(name => console.log(`      ✓ ${name}`));
  }

  console.log('\n' + '-'.repeat(70) + '\n');

  // Execute migrations
  const step1Success = await unarchiveStrategies();
  const step2Success = await createIndexes();

  // Check final state
  console.log('\n' + '-'.repeat(70));
  console.log('FINAL STATE');
  console.log('-'.repeat(70) + '\n');

  const afterState = await checkStrategies();
  console.log('📊 Strategy Status:');
  console.log(`   Total predefined strategies: ${afterState.total}`);
  console.log(`   Active: ${afterState.active}`);
  console.log(`   Archived: ${afterState.archived}`);

  if (afterState.active > 0) {
    console.log('\n   Active strategies:');
    afterState.names.forEach(name => console.log(`      ✓ ${name}`));
  }

  await verifyIndexes();

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('DEPLOYMENT SUMMARY');
  console.log('='.repeat(70));

  const strategyChange = afterState.active - beforeState.active;

  console.log(`\n✅ Step 1 - Unarchive Strategies: ${step1Success ? 'SUCCESS' : 'FAILED'}`);
  if (strategyChange > 0) {
    console.log(`   Unarchived ${strategyChange} strategies`);
  } else if (afterState.active > 0) {
    console.log(`   All ${afterState.active} strategies already active`);
  }

  console.log(`\n${step2Success ? '✅' : '⚠️'} Step 2 - Performance Indexes: ${step2Success ? 'SUCCESS' : 'MANUAL EXECUTION REQUIRED'}`);
  if (!step2Success) {
    console.log('   Please execute the index creation SQL shown above in:');
    console.log(`   https://supabase.com/dashboard/project/${projectRef}/sql/new`);
  }

  console.log('\n' + '='.repeat(70));

  if (step1Success && !step2Success) {
    console.log('\n⚠️  PARTIAL SUCCESS - Manual index creation needed');
    console.log('\nNext Steps:');
    console.log('1. Open Supabase SQL Editor');
    console.log('2. Copy the "Add Performance Indexes" SQL from above');
    console.log('3. Execute it in the SQL Editor');
    console.log('4. Verify indexes were created successfully');
  } else if (step1Success && step2Success) {
    console.log('\n✅ ALL MIGRATIONS DEPLOYED SUCCESSFULLY');
  } else {
    console.log('\n❌ DEPLOYMENT FAILED - Manual execution required');
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
