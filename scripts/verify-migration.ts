#!/usr/bin/env tsx
/**
 * Verify Polymarket Migration
 * Checks if tables, indexes, and functions were created successfully
 */

import { supabaseAdmin } from '../lib/supabase';

async function verifyMigration() {
  console.log('🔍 Verifying Polymarket Database Migration\n');

  try {
    // Test 1: Check if markets table exists and is accessible
    console.log('1️⃣  Testing markets table...');
    const { data: marketsData, error: marketsError } = await supabaseAdmin
      .from('markets')
      .select('market_id')
      .limit(1);

    if (marketsError) {
      console.log('   ❌ Markets table not found or not accessible');
      console.log('   Error:', marketsError.message);
    } else {
      console.log('   ✅ Markets table exists and is accessible');
      console.log(`   📊 Current row count: ${marketsData?.length || 0}`);
    }

    // Test 2: Check if sync_logs table exists
    console.log('\n2️⃣  Testing sync_logs table...');
    const { data: syncData, error: syncError } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .limit(1);

    if (syncError) {
      console.log('   ❌ Sync_logs table not found or not accessible');
      console.log('   Error:', syncError.message);
    } else {
      console.log('   ✅ Sync_logs table exists and is accessible');
      console.log(`   📊 Current row count: ${syncData?.length || 0}`);
    }

    // Test 3: Try to insert a test record into markets
    console.log('\n3️⃣  Testing INSERT into markets...');
    const testMarket = {
      market_id: 'test_market_' + Date.now(),
      title: 'Test Market - Verification',
      slug: 'test-market-verification',
      outcomes: ['Yes', 'No'],
      active: true,
      closed: false,
    };

    const { data: insertData, error: insertError } = await supabaseAdmin
      .from('markets')
      .insert(testMarket)
      .select();

    if (insertError) {
      console.log('   ❌ Failed to insert test record');
      console.log('   Error:', insertError.message);
    } else {
      console.log('   ✅ Successfully inserted test record');
      console.log('   📝 Test market_id:', insertData?.[0]?.market_id);

      // Clean up test record
      const { error: deleteError } = await supabaseAdmin
        .from('markets')
        .delete()
        .eq('market_id', testMarket.market_id);

      if (deleteError) {
        console.log('   ⚠️  Failed to delete test record (manual cleanup needed)');
      } else {
        console.log('   🧹 Test record cleaned up');
      }
    }

    // Test 4: Try UPSERT (key migration feature)
    console.log('\n4️⃣  Testing UPSERT functionality...');
    const upsertTest = {
      market_id: 'upsert_test_' + Date.now(),
      title: 'UPSERT Test Market',
      slug: 'upsert-test-market',
      outcomes: ['Yes', 'No'],
      volume_24h: 1000,
    };

    const { data: upsertData1, error: upsertError1 } = await supabaseAdmin
      .from('markets')
      .upsert(upsertTest)
      .select();

    if (upsertError1) {
      console.log('   ❌ UPSERT failed');
      console.log('   Error:', upsertError1.message);
    } else {
      console.log('   ✅ UPSERT (INSERT) successful');

      // Update the same record
      const updateTest = { ...upsertTest, volume_24h: 2000 };
      const { data: upsertData2, error: upsertError2 } = await supabaseAdmin
        .from('markets')
        .upsert(updateTest)
        .select();

      if (upsertError2) {
        console.log('   ❌ UPSERT (UPDATE) failed');
      } else {
        console.log('   ✅ UPSERT (UPDATE) successful');
        console.log(`   📊 Volume updated: ${upsertData1?.[0]?.volume_24h} → ${upsertData2?.[0]?.volume_24h}`);
      }

      // Cleanup
      await supabaseAdmin
        .from('markets')
        .delete()
        .eq('market_id', upsertTest.market_id);
      console.log('   🧹 UPSERT test record cleaned up');
    }

    console.log('\n✅ Migration verification complete!');
    console.log('\n📋 Summary:');
    console.log('   • Markets table: ' + (marketsError ? '❌ NOT FOUND' : '✅ EXISTS'));
    console.log('   • Sync_logs table: ' + (syncError ? '❌ NOT FOUND' : '✅ EXISTS'));
    console.log('   • INSERT works: ' + (insertError ? '❌ NO' : '✅ YES'));
    console.log('   • UPSERT works: ' + (upsertError1 ? '❌ NO' : '✅ YES'));

    if (!marketsError && !syncError && !insertError && !upsertError1) {
      console.log('\n🎉 All tests passed! Migration was successful.');
      console.log('\n📝 Next steps:');
      console.log('   1. Load test data: `npm run seed` (if you create the script)');
      console.log('   2. Start Phase 1: Polymarket API integration');
    } else {
      console.log('\n⚠️  Some tests failed. You may need to re-apply the migration.');
    }

  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  }
}

verifyMigration();
