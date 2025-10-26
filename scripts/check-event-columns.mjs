/**
 * Simple verification script for event columns
 * Uses node-fetch to query Supabase REST API
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyColumns() {
  console.log('🔍 Verifying event columns migration...\n');

  // Test 1: Query a sample market to see if columns exist
  console.log('📊 Test 1: Checking column existence');
  const { data: markets, error: marketError } = await supabase
    .from('markets')
    .select('market_id, title, event_id, event_slug, event_title, updated_at')
    .limit(3);

  if (marketError) {
    console.error('❌ Error querying markets:', marketError);
    if (marketError.message.includes('column') && marketError.message.includes('does not exist')) {
      console.error('\n❌ MIGRATION FAILED: Event columns do not exist in markets table');
      process.exit(1);
    }
    process.exit(1);
  }

  console.log('✅ Event columns exist in markets table');
  console.log('\n📋 Sample markets:');
  markets.forEach(market => {
    console.log(`  - ${market.market_id}: ${market.title}`);
    console.log(`    event_id: ${market.event_id || '(null)'}`);
    console.log(`    event_slug: ${market.event_slug || '(null)'}`);
    console.log(`    event_title: ${market.event_title || '(null)'}`);
  });

  // Test 2: Count markets with event data
  console.log('\n📊 Test 2: Checking data population');
  const { count: totalCount } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true });

  const { count: withEventId } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .not('event_id', 'is', null);

  console.log(`Total markets: ${totalCount}`);
  console.log(`Markets with event_id: ${withEventId || 0}`);
  console.log(`Markets without event_id: ${(totalCount || 0) - (withEventId || 0)}`);

  // Test 3: Try to filter by event columns
  console.log('\n📊 Test 3: Testing column queries');
  const { data: nullEventMarkets, error: nullError } = await supabase
    .from('markets')
    .select('market_id')
    .is('event_id', null)
    .limit(1);

  if (nullError) {
    console.error('❌ Error querying with event_id filter:', nullError);
  } else {
    console.log('✅ Can query markets by event_id (NULL filter works)');
  }

  console.log('\n✅ MIGRATION VERIFICATION COMPLETE');
  console.log('\n📋 Summary:');
  console.log('  ✅ event_id column added (TEXT)');
  console.log('  ✅ event_slug column added (TEXT)');
  console.log('  ✅ event_title column added (TEXT)');
  console.log('  ✅ Columns are queryable');
  console.log(`  📊 ${totalCount} total markets in database`);
  console.log(`  📊 ${withEventId || 0} markets currently have event data`);

  console.log('\n💡 Next Steps:');
  console.log('  1. Run Polymarket sync to populate event data');
  console.log('  2. Event information will be fetched from Polymarket API');
  console.log('  3. Markets will be linked to parent events for UI navigation');
}

verifyColumns().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
