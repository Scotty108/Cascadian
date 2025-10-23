import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyData() {
  console.log('\n🔍 Verifying ingested data...\n');

  // Check wallets
  const { data: wallets, error: walletsError } = await supabase
    .from('wallets')
    .select('wallet_address, whale_score, insider_score, total_volume_usd, total_trades, win_rate, is_whale')
    .limit(10);

  if (walletsError) {
    console.error('Error fetching wallets:', walletsError);
  } else {
    console.log(`✅ Wallets in database: ${wallets?.length || 0}`);
    wallets?.forEach(w => {
      console.log(`  - ${w.wallet_address.slice(0, 10)}... | Whale Score: ${w.whale_score} | Volume: $${w.total_volume_usd} | Trades: ${w.total_trades}`);
    });
  }

  // Check trades
  const { count: tradesCount } = await supabase
    .from('wallet_trades')
    .select('*', { count: 'exact', head: true });

  console.log(`\n✅ Trades in database: ${tradesCount || 0}`);

  // Check positions
  const { count: positionsCount } = await supabase
    .from('wallet_positions')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Positions in database: ${positionsCount || 0}`);

  console.log('\n✅ Verification complete!\n');
}

verifyData().catch(console.error);
