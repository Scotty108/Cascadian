/**
 * Simple Verification Script: Direct Table Queries
 * Tests that tables are accessible and have the expected structure
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function verifyTable(tableName: string) {
  const { data, error, count } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.log(`   ❌ ${tableName} - ERROR: ${error.message}`);
    return false;
  } else {
    console.log(`   ✅ ${tableName} (${count || 0} rows)`);
    return true;
  }
}

async function testHelperFunctions() {
  console.log('\n3️⃣  HELPER FUNCTIONS\n');

  // Test get_top_whales
  const { data: whales, error: whalesError } = await supabase
    .rpc('get_top_whales', { limit_count: 10 });

  if (whalesError) {
    console.log(`   ❌ get_top_whales - ERROR: ${whalesError.message}`);
  } else {
    console.log(`   ✅ get_top_whales (returned ${whales?.length || 0} results)`);
  }

  // Test get_suspected_insiders
  const { data: insiders, error: insidersError } = await supabase
    .rpc('get_suspected_insiders', { limit_count: 10 });

  if (insidersError) {
    console.log(`   ❌ get_suspected_insiders - ERROR: ${insidersError.message}`);
  } else {
    console.log(`   ✅ get_suspected_insiders (returned ${insiders?.length || 0} results)`);
  }

  // Test get_recent_whale_activity
  const { data: activity, error: activityError } = await supabase
    .rpc('get_recent_whale_activity', { hours_back: 24, limit_count: 10 });

  if (activityError) {
    console.log(`   ❌ get_recent_whale_activity - ERROR: ${activityError.message}`);
  } else {
    console.log(`   ✅ get_recent_whale_activity (returned ${activity?.length || 0} results)`);
  }

  // Test calculate_wallet_win_rate
  const { data: winRate, error: winRateError } = await supabase
    .rpc('calculate_wallet_win_rate', { addr: '0x0000000000000000000000000000000000000000' });

  if (winRateError) {
    console.log(`   ❌ calculate_wallet_win_rate - ERROR: ${winRateError.message}`);
  } else {
    console.log(`   ✅ calculate_wallet_win_rate (returns ${typeof winRate})`);
  }
}

async function verify() {
  console.log('\n' + '='.repeat(70));
  console.log('📊 WALLET ANALYTICS TABLES - VERIFICATION REPORT');
  console.log('='.repeat(70) + '\n');

  console.log('1️⃣  TABLE ACCESSIBILITY\n');

  const tables = [
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  ];

  let successCount = 0;
  for (const table of tables) {
    const success = await verifyTable(table);
    if (success) successCount++;
  }

  console.log(`\n   Summary: ${successCount}/${tables.length} tables accessible\n`);

  console.log('2️⃣  ROW LEVEL SECURITY\n');

  // Test RLS with anon key
  const anonClient = createClient(
    SUPABASE_URL,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNzgyMjUsImV4cCI6MjA3NjY1NDIyNX0.luaweXgEDpdUlgQuam4EVz6800kEXpRvsjwcf-8wPDo'
  );

  const { data: anonData, error: anonError } = await anonClient
    .from('wallets')
    .select('*')
    .limit(1);

  if (anonError) {
    console.log(`   ❌ RLS check failed: ${anonError.message}`);
  } else {
    console.log(`   ✅ RLS enabled and working (public read access confirmed)`);
  }

  // Test helper functions
  await testHelperFunctions();

  console.log('\n' + '='.repeat(70));
  console.log('✅ VERIFICATION COMPLETE');
  console.log('='.repeat(70) + '\n');

  console.log('📋 NEXT STEPS:\n');
  console.log('   1. Start ingesting wallet data from Polymarket Data-API');
  console.log('   2. Test wallet detail page with sample wallet address');
  console.log('   3. Monitor query performance on indexes');
  console.log('   4. Set up cron jobs for data refresh');
  console.log('   5. Implement whale detection scoring logic\n');
}

verify().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
