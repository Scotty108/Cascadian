import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function listWhales() {
  console.log('\n🐋 WHALES (score >= 7)\n' + '='.repeat(60));

  const result = await supabase
    .from('wallets')
    .select('*')
    .gte('whale_score', 7)
    .order('whale_score', { ascending: false });

  if (result.error) {
    console.error('Error:', result.error);
    return;
  }

  if (!result.data || result.data.length === 0) {
    console.log('No whales found');
    return;
  }

  result.data.forEach((w, i) => {
    console.log(`\n${i+1}. ${w.wallet_address}`);
    console.log(`   Whale Score: ${w.whale_score}/10`);
    console.log(`   Insider Score: ${w.insider_score}/10`);
    console.log(`   Total Trades: ${w.total_trades}`);
    console.log(`   Total Positions: ${w.total_positions}`);
    console.log(`   Total Value: $${w.total_value || 0}`);
    console.log(`   Total PnL: $${w.total_pnl || 0}`);
  });

  console.log('\n' + '='.repeat(60) + '\n');
}

listWhales().catch(console.error);
