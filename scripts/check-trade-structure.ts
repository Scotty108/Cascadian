import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkStructure() {
  const { data: trades } = await supabase
    .from('wallet_trades')
    .select('*')
    .limit(1);

  if (trades && trades.length > 0) {
    console.log('Trade fields:', Object.keys(trades[0]));
    console.log('\nFull trade object:');
    console.log(JSON.stringify(trades[0], null, 2));
  }
}

checkStructure().catch(console.error);
