/**
 * Verification script for event columns migration
 * Checks that event_id, event_slug, and event_title columns were added to markets table
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyEventColumns() {
  console.log('🔍 Verifying event columns in markets table...\n');

  try {
    // 1. Check column existence and types
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'markets')
      .like('column_name', '%event%')
      .order('column_name');

    if (columnsError) {
      console.error('❌ Error fetching column information:', columnsError);
      process.exit(1);
    }

    console.log('📋 Event-related columns in markets table:');
    console.table(columns);

    // Verify expected columns exist
    const expectedColumns = ['event_id', 'event_slug', 'event_title'];
    const foundColumns = columns?.map(c => c.column_name) || [];

    const missingColumns = expectedColumns.filter(col => !foundColumns.includes(col));
    if (missingColumns.length > 0) {
      console.error('\n❌ Missing columns:', missingColumns.join(', '));
      process.exit(1);
    }

    console.log('\n✅ All expected event columns found');

    // 2. Check indexes
    const { data: indexes, error: indexError } = await supabase.rpc('get_table_indexes', {
      table_name: 'markets'
    });

    if (!indexError && indexes) {
      console.log('\n📊 Indexes on markets table:');
      const eventIndexes = indexes.filter((idx: any) =>
        idx.indexname?.includes('event')
      );
      console.table(eventIndexes);
    }

    // 3. Check current data
    const { data: marketSample, error: marketError } = await supabase
      .from('markets')
      .select('id, event_id, event_slug, event_title')
      .limit(5);

    if (marketError) {
      console.error('\n❌ Error fetching market sample:', marketError);
      process.exit(1);
    }

    console.log('\n📊 Sample markets data:');
    console.table(marketSample);

    // 4. Count markets with event data
    const { count: totalMarkets } = await supabase
      .from('markets')
      .select('*', { count: 'exact', head: true });

    const { count: marketsWithEvents } = await supabase
      .from('markets')
      .select('*', { count: 'exact', head: true })
      .not('event_id', 'is', null);

    console.log('\n📈 Data population status:');
    console.log(`Total markets: ${totalMarkets}`);
    console.log(`Markets with event data: ${marketsWithEvents || 0}`);
    console.log(`Markets without event data: ${(totalMarkets || 0) - (marketsWithEvents || 0)}`);

    console.log('\n✅ Migration verification complete!');
    console.log('\n💡 Next steps:');
    console.log('   - Run data sync to populate event information');
    console.log('   - Event data will be populated from Polymarket API on next sync');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

verifyEventColumns();
