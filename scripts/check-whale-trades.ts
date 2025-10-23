import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkTrades() {
  // Get whale addresses
  const { data: whales } = await supabase
    .from('wallets')
    .select('wallet_address, whale_score')
    .gte('whale_score', 7);

  console.log(`Found ${whales?.length} whales`);

  if (!whales || whales.length === 0) return;

  // Check trades for first whale
  const firstWhale = whales[0].wallet_address;
  console.log(`\nChecking trades for whale: ${firstWhale}`);

  const { data: trades, error } = await supabase
    .from('wallet_trades')
    .select('*')
    .eq('wallet_address', firstWhale)
    .limit(5);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Found ${trades?.length} trades`);
    trades?.forEach((t, i) => {
      console.log(`  ${i+1}. ${t.side} ${t.size} @ ${t.price} (${t.timestamp})`);
    });
  }
}

checkTrades().catch(console.error);
