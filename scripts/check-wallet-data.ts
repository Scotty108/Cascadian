import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkData() {
  console.log('\n📊 DATABASE CHECK\n' + '='.repeat(60));

  // Count wallets
  const { count: walletCount } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true });
  console.log(`\n✅ Total wallets in database: ${walletCount}`);

  // Get whale score distribution
  const { data: wallets } = await supabase
    .from('wallets')
    .select('wallet_address, whale_score, total_trades, total_positions')
    .order('whale_score', { ascending: false })
    .limit(20);

  console.log('\n🐋 Top 20 wallets by whale score:');
  if (wallets && wallets.length > 0) {
    wallets.forEach((w, i) => {
      const addr = w.wallet_address.slice(0, 10);
      console.log(`  ${i+1}. ${addr}... → Score: ${w.whale_score}/10, Trades: ${w.total_trades}, Positions: ${w.total_positions}`);
    });
  } else {
    console.log('  No wallets found');
  }

  // Count whales (score >= 7)
  const { count: whaleCount } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })
    .gte('whale_score', 7);
  console.log(`\n🐋 Wallets with whale_score >= 7: ${whaleCount}`);

  // Count positions
  const { count: positionsCount } = await supabase
    .from('wallet_positions')
    .select('*', { count: 'exact', head: true });
  console.log(`\n📈 Total positions in database: ${positionsCount}`);

  // Count trades
  const { count: tradesCount } = await supabase
    .from('wallet_trades')
    .select('*', { count: 'exact', head: true });
  console.log(`\n💰 Total trades in database: ${tradesCount}`);

  console.log('\n' + '='.repeat(60) + '\n');
}

checkData().catch(console.error);
