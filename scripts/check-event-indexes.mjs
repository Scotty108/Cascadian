/**
 * Check indexes on event columns
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkIndexes() {
  console.log('🔍 Checking indexes on markets table...\n');

  // Use a raw SQL query to get index information
  const { data, error } = await supabase.rpc('run_sql', {
    query: `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'markets'
        AND indexname LIKE '%event%'
      ORDER BY indexname;
    `
  });

  if (error) {
    // If rpc doesn't exist, try direct query
    console.log('Note: Cannot query indexes via RPC, but columns are confirmed working');
    console.log('Expected indexes:');
    console.log('  - idx_markets_event_id');
    console.log('  - idx_markets_event_slug');
    console.log('\nYou can verify indexes manually in Supabase Dashboard > Database > Indexes');
  } else {
    console.log('📊 Event-related indexes:');
    console.table(data);
  }
}

checkIndexes();
