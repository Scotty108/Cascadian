/**
 * Filter breakdown analysis for V19s validated wallets
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// The 24 validated wallets with V19s PnL
const validatedWallets: Record<string, number> = {
  '0x8119010a6e589062aa03583bb3f39ca632d9f887': 6080132,
  '0x16f91db2592924cfed6e03b7e5cb5bb1e32299e3': 4042385,
  '0x17db3fcd93ba12d38382a0cade24b200185c5f6d': 3202522,
  '0xed2239a9150c3920000d0094d28fa51c7db03dd0': 3092635,
  '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee': 3390603,
  '0xdbade4c82fb72780a0db9a38f821d8671aba9c95': 2783023,
  '0x343d4466dc323b850e5249394894c7381d91456e': 2604489,
  '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029': 2538564,
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344': 2354038,
  '0x14964aefa2cd7caff7878b3820a690a03c5aa429': 2326308,
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d': 2234274,
  '0xa9878e59934ab507f9039bcb917c1bae0451141d': 2205354,
  '0x5bffcf561bcae83af680ad600cb99f1184d6ffbe': 2241447,
  '0x204f72f35326db932158cba6adff0b9a1da95e14': 2575904,
  '0xee00ba338c59557141789b127927a55f5cc5cea1': 1831549,
  '0x0562c423912e325f83fa79df55085979e1f5594f': 1898589,
  '0xd7f85d0eb0fe0732ca38d9107ad0d4d01b1289e4': 1935404,
  '0x3d1ecf16942939b3603c2539a406514a40b504d0': 1716000,
  '0x212954857f5efc138748c33d032a93bf95974222': 1687555,
  '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1': 1508367,
  '0x2005d16a84ceefa912d4e380cd32e7ff827875ea': 1819872,
  '0x461f3e886dca22e561eee224d283e08b8fb47a07': 1496248,
  '0x06dcaa14f57d8a0573f5dc5940565e6de667af59': 257796,
  '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed': 209638,
};

interface CombinedData {
  wallet: string;
  pnl: number;
  total_trades: number;
  trades_30d: number;
  omega: number | null;
}

async function main() {
  const walletList = Object.keys(validatedWallets).map(w => `'${w.toLowerCase()}'`).join(',');

  // Get activity data
  const activityQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as total_trades,
      countIf(trade_time >= now() - INTERVAL 30 DAY) as trades_30d
    FROM (
      SELECT trader_wallet, event_id, any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) IN (${walletList})
        AND is_deleted = 0
      GROUP BY trader_wallet, event_id
    )
    GROUP BY wallet
  `;

  const actResult = await client.query({ query: activityQuery, format: 'JSONEachRow' });
  const activityData = await actResult.json() as { wallet: string; total_trades: number; trades_30d: number }[];
  const activityMap: Record<string, { total_trades: number; trades_30d: number }> = {};
  for (const r of activityData) {
    activityMap[r.wallet] = { total_trades: r.total_trades, trades_30d: r.trades_30d };
  }

  // Get omega data from leaderboard
  const omegaQuery = `
    SELECT lower(wallet) as wallet, omega_proxy
    FROM vw_leaderboard_gold_mvp_v1
    WHERE lower(wallet) IN (${walletList})
  `;

  const omegaResult = await client.query({ query: omegaQuery, format: 'JSONEachRow' });
  const omegaData = await omegaResult.json() as { wallet: string; omega_proxy: number }[];
  const omegaMap: Record<string, number> = {};
  for (const r of omegaData) {
    omegaMap[r.wallet] = r.omega_proxy;
  }

  // Combine data
  const combined: CombinedData[] = [];
  for (const [wallet, pnl] of Object.entries(validatedWallets)) {
    const w = wallet.toLowerCase();
    combined.push({
      wallet: w,
      pnl,
      total_trades: activityMap[w]?.total_trades || 0,
      trades_30d: activityMap[w]?.trades_30d || 0,
      omega: omegaMap[w] ?? null,
    });
  }

  // Sort by PnL
  combined.sort((a, b) => b.pnl - a.pnl);

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          V19s VALIDATED WALLETS - COMPLETE FILTER BREAKDOWN                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('Wallet'.padEnd(44) + 'V19s PnL'.padStart(12) + 'Trades'.padStart(10) + '30d'.padStart(8) + 'Omega'.padStart(8));
  console.log('-'.repeat(82));

  for (const r of combined) {
    console.log(
      r.wallet.padEnd(44) +
      ('$' + r.pnl.toLocaleString()).padStart(12) +
      String(r.total_trades).padStart(10) +
      String(r.trades_30d).padStart(8) +
      (r.omega !== null ? r.omega.toFixed(2) : 'N/A').padStart(8)
    );
  }

  // Calculate filter stats
  const pnlOver500 = combined.filter(r => r.pnl > 500).length;
  const over20Trades = combined.filter(r => r.total_trades >= 20).length;
  const active30d = combined.filter(r => r.trades_30d > 0).length;
  const withOmega = combined.filter(r => r.omega !== null);
  const omegaOver1 = withOmega.filter(r => r.omega! > 1).length;

  // All filters combined
  const passAll = combined.filter(r =>
    r.pnl > 500 &&
    r.total_trades >= 20 &&
    r.trades_30d > 0 &&
    (r.omega === null || r.omega > 1)
  );

  const passAllStrict = combined.filter(r =>
    r.pnl > 500 &&
    r.total_trades >= 20 &&
    r.trades_30d > 0 &&
    r.omega !== null &&
    r.omega > 1
  );

  console.log('');
  console.log('='.repeat(82));
  console.log('FILTER BREAKDOWN SUMMARY');
  console.log('='.repeat(82));
  console.log('');
  console.log('Total validated wallets (UI parity confirmed): 24');
  console.log('');
  console.log('Individual Filters:');
  console.log('  • PnL > $500:           ' + pnlOver500 + ' / 24 (' + ((pnlOver500/24)*100).toFixed(0) + '%)');
  console.log('  • Over 20 trades:        ' + over20Trades + ' / 24 (' + ((over20Trades/24)*100).toFixed(0) + '%)');
  console.log('  • Active in last 30d:    ' + active30d + ' / 24 (' + ((active30d/24)*100).toFixed(0) + '%)');
  console.log('  • Omega > 1:             ' + omegaOver1 + ' / ' + withOmega.length + ' (wallets with omega data)');
  console.log('');
  console.log('Combined Filters:');
  console.log('  • Pass ALL filters (strict): ' + passAllStrict.length + ' / 24');
  console.log('  • Pass ALL (omega optional): ' + passAll.length + ' / 24');

  if (passAllStrict.length > 0) {
    console.log('');
    console.log('Wallets passing ALL strict filters:');
    for (const r of passAllStrict) {
      console.log('  ' + r.wallet + ' - $' + r.pnl.toLocaleString());
    }
  }

  await client.close();
}

main().catch(console.error);
