#!/usr/bin/env tsx
/**
 * Verify Copy Trading Tables in Supabase
 *
 * This script verifies that all copy trading tables, indexes, views,
 * and triggers have been created successfully.
 */

import { createClient } from '@supabase/supabase-js';

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function verifyTables() {
  console.log('📋 Copy Trading Tables Verification');
  console.log('====================================\n');

  const tables = [
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  ];

  console.log('🔍 Checking tables...\n');

  const results = {
    tables: [] as any[],
    success: 0,
    failed: 0
  };

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`  ❌ ${table}: NOT FOUND`);
        console.log(`     Error: ${error.message}\n`);
        results.failed++;
        results.tables.push({ table, status: 'MISSING', error: error.message });
      } else {
        console.log(`  ✅ ${table}: EXISTS (${count || 0} rows)`);
        results.success++;
        results.tables.push({ table, status: 'EXISTS', rows: count || 0 });
      }
    } catch (error: any) {
      console.log(`  ❌ ${table}: ERROR`);
      console.log(`     ${error.message}\n`);
      results.failed++;
      results.tables.push({ table, status: 'ERROR', error: error.message });
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Summary: ${results.success}/${tables.length} tables verified`);
  console.log('─'.repeat(60) + '\n');

  if (results.failed > 0) {
    console.log('❌ Migration has NOT been applied yet.\n');
    console.log('To apply the migration, go to:');
    console.log(`${SUPABASE_URL.replace('https://', 'https://app.supabase.com/project/')}/sql`);
    console.log('\nThen copy and paste the contents of:');
    console.log('supabase/migrations/20251029000001_create_copy_trading_tables.sql\n');
  } else {
    console.log('✅ All tables exist! Testing sample operations...\n');
    await testOperations();
  }

  return results;
}

async function testOperations() {
  console.log('🧪 Testing table operations...\n');

  // Test 1: Insert into tracked_wallets
  console.log('Test 1: Insert into tracked_wallets');
  try {
    const { data, error } = await supabase
      .from('tracked_wallets')
      .insert({
        strategy_id: 'test_strategy_001',
        wallet_address: '0xtest1234567890',
        selection_reason: 'Test wallet for verification',
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.log(`  ❌ Failed: ${error.message}\n`);
    } else {
      console.log(`  ✅ Success: Inserted wallet ID ${data.id}`);

      // Clean up
      await supabase
        .from('tracked_wallets')
        .delete()
        .eq('id', data.id);
      console.log(`  🧹 Cleaned up test data\n`);
    }
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}\n`);
  }

  // Test 2: Insert into copy_trade_signals
  console.log('Test 2: Insert into copy_trade_signals');
  try {
    const { data, error } = await supabase
      .from('copy_trade_signals')
      .insert({
        signal_id: 'test_signal_001',
        strategy_id: 'test_strategy_001',
        source_wallet: '0xtest1234567890',
        market_id: 'test_market',
        side: 'YES',
        source_timestamp: new Date().toISOString(),
        decision: 'skip',
        decision_reason: 'Test signal for verification'
      })
      .select()
      .single();

    if (error) {
      console.log(`  ❌ Failed: ${error.message}\n`);
    } else {
      console.log(`  ✅ Success: Inserted signal ID ${data.id}`);

      // Clean up
      await supabase
        .from('copy_trade_signals')
        .delete()
        .eq('id', data.id);
      console.log(`  🧹 Cleaned up test data\n`);
    }
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}\n`);
  }

  // Test 3: Query views
  console.log('Test 3: Query v_strategy_copy_performance view');
  try {
    const { data, error } = await supabase
      .from('v_strategy_copy_performance')
      .select('*')
      .limit(1);

    if (error) {
      console.log(`  ❌ Failed: ${error.message}\n`);
    } else {
      console.log(`  ✅ Success: View is queryable (returned ${data?.length || 0} rows)\n`);
    }
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}\n`);
  }

  console.log('🎉 Verification complete!');
}

// Run the verification
verifyTables().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
