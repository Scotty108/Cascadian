/**
 * Count total markets in database
 */

import { supabaseAdmin } from '@/lib/supabase';

async function main() {
  console.log('🔍 Counting markets in database...\n');

  try {
    // Count all markets
    const { count: totalCount, error: totalError } = await supabaseAdmin
      .from('markets')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;
    console.log(`📊 Total markets in DB: ${totalCount}`);

    // Count active markets
    const { count: activeCount, error: activeError } = await supabaseAdmin
      .from('markets')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);

    if (activeError) throw activeError;
    console.log(`📊 Active markets: ${activeCount}`);

    // Count closed markets
    const { count: closedCount, error: closedError } = await supabaseAdmin
      .from('markets')
      .select('*', { count: 'exact', head: true })
      .eq('active', false);

    if (closedError) throw closedError;
    console.log(`📊 Closed markets: ${closedCount}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
