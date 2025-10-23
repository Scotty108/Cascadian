/**
 * Script to check for existing wallet tables and apply the wallet analytics migration
 * This is a database architect's approach to safe migration
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkExistingTables() {
  console.log('🔍 Checking for existing wallet tables...\n');

  const tablesToCheck = [
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  ];

  const { data, error } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .in('table_name', tablesToCheck);

  if (error) {
    console.error('Error checking tables:', error);
    return [];
  }

  return data?.map(t => t.table_name) || [];
}

async function applyMigration() {
  console.log('📊 Wallet Analytics Migration Tool\n');
  console.log('=' .repeat(60) + '\n');

  // Step 1: Check for existing tables
  const existingTables = await checkExistingTables();

  if (existingTables.length > 0) {
    console.log('⚠️  WARNING: Found existing tables:');
    existingTables.forEach(table => console.log(`   - ${table}`));
    console.log('\nThe migration uses CREATE TABLE IF NOT EXISTS, so it will skip existing tables.\n');
  } else {
    console.log('✅ No conflicting tables found. Safe to proceed.\n');
  }

  // Step 2: Read migration file
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20251023120000_create_wallet_analytics_tables.sql');
  console.log(`📄 Reading migration file: ${migrationPath}\n`);

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(migrationPath, 'utf-8');
  } catch (err) {
    console.error('❌ Error reading migration file:', err);
    process.exit(1);
  }

  console.log(`📦 Migration size: ${migrationSQL.length} characters\n`);

  // Step 3: Apply migration
  console.log('🚀 Applying migration to Supabase...\n');

  const { data, error } = await supabase.rpc('exec_sql', {
    sql: migrationSQL
  });

  if (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nYou will need to apply this migration manually via Supabase Dashboard SQL Editor.');
    console.error('Migration file location:', migrationPath);
    process.exit(1);
  }

  console.log('✅ Migration applied successfully!\n');

  // Step 4: Verify tables were created
  console.log('🔍 Verifying table creation...\n');

  const verifiedTables = await checkExistingTables();

  console.log('📋 Created/Verified Tables:');
  [
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  ].forEach(table => {
    const exists = verifiedTables.includes(table);
    console.log(`   ${exists ? '✅' : '❌'} ${table}`);
  });

  console.log('\n' + '=' .repeat(60));
  console.log('✨ Migration Complete!\n');
  console.log('Next Steps:');
  console.log('  1. Test wallet data ingestion endpoints');
  console.log('  2. Verify RLS policies are working');
  console.log('  3. Test helper functions (get_top_whales, get_suspected_insiders, etc.)');
  console.log('  4. Check indexes are created correctly');
}

applyMigration().catch(console.error);
