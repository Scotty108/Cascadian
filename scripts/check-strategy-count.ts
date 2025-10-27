import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStrategyCount() {
  const { data, error, count } = await supabase
    .from('strategy_definitions')
    .select('id, strategy_name, created_at, is_archived', { count: 'exact' })
    .eq('strategy_name', 'Consensus Copy Trade');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${count} strategy(ies) named "Consensus Copy Trade"\n`);

  if (data && data.length > 0) {
    data.forEach((s, i) => {
      console.log(`Strategy ${i + 1}:`);
      console.log(`  ID: ${s.id}`);
      console.log(`  Name: ${s.strategy_name}`);
      console.log(`  Created: ${s.created_at}`);
      console.log(`  Is Archived: ${s.is_archived}`);
      console.log('');
    });
  }

  if (count === 1) {
    console.log('✅ Exactly one strategy found - migration successful!');
  } else if (count && count > 1) {
    console.log('⚠️  Multiple strategies found - the DELETE may not have worked correctly.');
  } else {
    console.log('❌ No strategies found - something went wrong!');
  }
}

checkStrategyCount().catch(console.error);
