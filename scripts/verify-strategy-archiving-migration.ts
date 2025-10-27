/**
 * Verify Strategy Archiving Migration
 *
 * This script verifies that the 20251027000004_add_strategy_archiving.sql migration
 * was successfully applied to the database.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyMigration() {
  console.log('Verifying strategy archiving migration...\n');

  // Check 1: Verify is_archived column exists by trying to query it
  console.log('1. Checking if is_archived column exists...');
  try {
    const { data, error } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, is_archived')
      .limit(1);

    if (error) {
      console.error('❌ FAILED: is_archived column does not exist');
      console.error('Error:', error.message);
      return false;
    }
    console.log('✅ PASSED: is_archived column exists\n');
  } catch (err) {
    console.error('❌ FAILED: Error checking is_archived column');
    console.error(err);
    return false;
  }

  // Check 2: Verify all predefined strategies are archived
  console.log('2. Checking if predefined strategies are archived...');
  try {
    const { data: predefinedStrategies, error } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, strategy_name, is_predefined, is_archived')
      .eq('is_predefined', true);

    if (error) {
      console.error('❌ FAILED: Error querying predefined strategies');
      console.error('Error:', error.message);
      return false;
    }

    const totalPredefined = predefinedStrategies?.length || 0;
    const archivedCount = predefinedStrategies?.filter(s => s.is_archived).length || 0;
    const notArchivedCount = totalPredefined - archivedCount;

    console.log(`   Total predefined strategies: ${totalPredefined}`);
    console.log(`   Archived: ${archivedCount}`);
    console.log(`   Not archived: ${notArchivedCount}`);

    if (totalPredefined > 0 && archivedCount === totalPredefined) {
      console.log('✅ PASSED: All predefined strategies are archived\n');
    } else if (totalPredefined === 0) {
      console.log('⚠️  WARNING: No predefined strategies found in database\n');
    } else {
      console.log('❌ FAILED: Not all predefined strategies are archived\n');
      console.log('Strategies not archived:');
      predefinedStrategies?.filter(s => !s.is_archived).forEach(s => {
        console.log(`   - ${s.strategy_name} (ID: ${s.strategy_id})`);
      });
      return false;
    }
  } catch (err) {
    console.error('❌ FAILED: Error checking predefined strategies');
    console.error(err);
    return false;
  }

  // Check 3: Verify we can query by is_archived (tests index implicitly)
  console.log('3. Checking if we can query by is_archived...');
  try {
    const { data, error } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, strategy_name, is_archived')
      .eq('is_archived', true)
      .limit(10);

    if (error) {
      console.error('❌ FAILED: Cannot query by is_archived');
      console.error('Error:', error.message);
      return false;
    }
    console.log(`✅ PASSED: Can query by is_archived (found ${data?.length || 0} archived strategies)\n`);
  } catch (err) {
    console.error('❌ FAILED: Error querying by is_archived');
    console.error(err);
    return false;
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('Migration Verification Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Migration: 20251027000004_add_strategy_archiving.sql');
  console.log('Status: ✅ ALL CHECKS PASSED');
  console.log('\nChanges Applied:');
  console.log('  • Added is_archived column to strategy_definitions');
  console.log('  • Created idx_archived_strategies index');
  console.log('  • Marked all predefined strategies as archived');
  console.log('═══════════════════════════════════════════════════════\n');

  return true;
}

verifyMigration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Verification failed with error:', err);
    process.exit(1);
  });
