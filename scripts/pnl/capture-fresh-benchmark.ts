/**
 * ============================================================================
 * Capture Fresh PnL Benchmark Set
 * ============================================================================
 *
 * Inserts top leaderboard wallet PnL values as a benchmark set for regression testing.
 * The leaderboard data was manually scraped from Polymarket UI on Dec 4, 2025.
 *
 * Usage:
 *   npx tsx scripts/pnl/capture-fresh-benchmark.ts
 *   npx tsx scripts/pnl/capture-fresh-benchmark.ts --set=my_custom_set_name
 *
 * The captured benchmarks are saved to pm_ui_pnl_benchmarks_v1 table.
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  name: string;
  pnl: number;
}

// Fresh leaderboard data scraped from Polymarket Dec 4, 2025
// Top 40 All-Time winners
const LEADERBOARD_WALLETS: LeaderboardEntry[] = [
  // Page 1 (1-20)
  { rank: 1, wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4', pnl: 22053934 },
  { rank: 2, wallet: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', name: 'Fredi9999', pnl: 16620028 },
  { rank: 3, wallet: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', name: 'Len9311238', pnl: 8709973 },
  { rank: 4, wallet: '0xd235973291b2b75ff4070e9c0b01728c520b0f29', name: 'zxgngl', pnl: 7807266 },
  { rank: 5, wallet: '0x863134d00841b2e200492805a01e1e2f5defaa53', name: 'RepTrump', pnl: 7532410 },
  { rank: 6, wallet: '0x8119010a6e589062aa03583bb3f39ca632d9f887', name: 'PrincessCaro', pnl: 6083643 },
  { rank: 7, wallet: '0xe9ad918c7678cd38b12603a762e638a5d1ee7091', name: 'walletmobile', pnl: 5942685 },
  { rank: 8, wallet: '0x885783760858e1bd5dd09a3c3f916cfa251ac270', name: 'BetTom42', pnl: 5642136 },
  { rank: 9, wallet: '0x23786fdad0073692157c6d7dc81f281843a35fcb', name: 'mikatrade77', pnl: 5147999 },
  { rank: 10, wallet: '0xd0c042c08f755ff940249f62745e82d356345565', name: 'alexmulti', pnl: 4804856 },
  { rank: 11, wallet: '0x94a428cfa4f84b264e01f70d93d02bc96cb36356', name: 'GCottrell93', pnl: 4289091 },
  { rank: 12, wallet: '0x16f91db2592924cfed6e03b7e5cb5bb1e32299e3', name: 'Jenzigo', pnl: 4049827 },
  { rank: 13, wallet: '0x17db3fcd93ba12d38382a0cade24b200185c5f6d', name: 'fengdubiying', pnl: 3202358 },
  { rank: 14, wallet: '0x033a07b3de5947eab4306676ad74eb546da30d50', name: 'RandomGenius', pnl: 3115550 },
  { rank: 15, wallet: '0xed2239a9150c3920000d0094d28fa51c7db03dd0', name: 'Michie', pnl: 3095008 },
  { rank: 16, wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee', name: 'kch123', pnl: 2989447 },
  { rank: 17, wallet: '0xe74a4446efd66a4de690962938f550d8921a40ee', name: 'walletX', pnl: 2863673 },
  { rank: 18, wallet: '0x343d4466dc323b850e5249394894c7381d91456e', name: 'tazcot', pnl: 2604548 },
  { rank: 19, wallet: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', name: 'ImJustKen', pnl: 2443014 },
  { rank: 20, wallet: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11', pnl: 2366251 },
  // Page 2 (21-40)
  { rank: 21, wallet: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', name: 'wallet0x7f', pnl: 2266615 },
  { rank: 22, wallet: '0xa9878e59934ab507f9039bcb917c1bae0451141d', name: 'ilovecircle', pnl: 2262917 },
  { rank: 23, wallet: '0x5bffcf561bcae83af680ad600cb99f1184d6ffbe', name: 'YatSen', pnl: 2240496 },
  { rank: 24, wallet: '0xb786b8b6335e77dfad19928313e97753039cb18d', name: 'wallet0xb7', pnl: 2166759 },
  { rank: 25, wallet: '0xee00ba338c59557141789b127927a55f5cc5cea1', name: 'S-Works', pnl: 2128489 },
  { rank: 26, wallet: '0x2bf64b86b64c315d879571b07a3b76629e467cd0', name: 'BabaTrump', pnl: 2093363 },
  { rank: 27, wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', name: 'swisstony', pnl: 2021442 },
  { rank: 28, wallet: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm', pnl: 1960675 },
  { rank: 29, wallet: '0x0562c423912e325f83fa79df55085979e1f5594f', name: 'trezorisbest', pnl: 1903941 },
  { rank: 30, wallet: '0x42592084120b0d5287059919d2a96b3b7acb936f', name: 'antman-batman', pnl: 1900476 },
  { rank: 31, wallet: '0xd7f85d0eb0fe0732ca38d9107ad0d4d01b1289e4', name: 'tdrhrhhd', pnl: 1898878 },
  { rank: 32, wallet: '0x7058c8a7cec79010b1927d05837dcf25f1a53505', name: 'deetown', pnl: 1849975 },
  { rank: 33, wallet: '0xd31a2ea0b5f9a10c2eb78dcc36df016497d5386e', name: 'DarthVooncer', pnl: 1766594 },
  { rank: 34, wallet: '0x14964aefa2cd7caff7878b3820a690a03c5aa429', name: 'gmpm', pnl: 1742493 },
  { rank: 35, wallet: '0x3d1ecf16942939b3603c2539a406514a40b504d0', name: 'edenmoon', pnl: 1712369 },
  { rank: 36, wallet: '0x212954857f5efc138748c33d032a93bf95974222', name: '3bpatgs', pnl: 1685688 },
  { rank: 37, wallet: '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', name: 'aenews2', pnl: 1563495 },
  { rank: 38, wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1', pnl: 1550541 },
  { rank: 39, wallet: '0x461f3e886dca22e561eee224d283e08b8fb47a07', name: 'HyperLiquid0xb', pnl: 1496847 },
  { rank: 40, wallet: '0x2f09642639aedd6ced432519c1a86e7d52034632', name: 'piastri', pnl: 1489608 },
];

async function insertBenchmarks(
  benchmarkSet: string,
  entries: LeaderboardEntry[]
): Promise<void> {
  console.log(`Inserting ${entries.length} benchmarks into pm_ui_pnl_benchmarks_v1...`);

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Build insert values
  const values = entries
    .map(
      (e) =>
        `('${e.wallet}', ${e.pnl}, '${benchmarkSet}', '${now}', 'leaderboard_rank_${e.rank}: ${e.name.replace(/'/g, "''")}')`
    )
    .join(',\n');

  const insertQuery = `
    INSERT INTO pm_ui_pnl_benchmarks_v1
    (wallet, pnl_value, benchmark_set, captured_at, note)
    VALUES ${values}
  `;

  await clickhouse.exec({ query: insertQuery });

  console.log(`Successfully inserted ${entries.length} benchmarks with set: ${benchmarkSet}`);
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let benchmarkSet = `fresh_2025_12_04_alltime`;

  for (const arg of args) {
    if (arg.startsWith('--set=')) {
      benchmarkSet = arg.slice(6);
    }
  }

  console.log('='.repeat(70));
  console.log('CAPTURE FRESH PNL BENCHMARK');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Benchmark set name: ${benchmarkSet}`);
  console.log(`Data source: Polymarket leaderboard scraped Dec 4, 2025`);
  console.log('');

  console.log('Top 10 wallets:');
  for (const e of LEADERBOARD_WALLETS.slice(0, 10)) {
    const pnlStr = e.pnl >= 0 ? `+$${e.pnl.toLocaleString()}` : `-$${Math.abs(e.pnl).toLocaleString()}`;
    console.log(`  ${e.rank}. ${e.wallet.slice(0, 10)}... ${pnlStr.padStart(15)} (${e.name})`);
  }
  console.log(`  ... and ${LEADERBOARD_WALLETS.length - 10} more`);
  console.log('');

  try {
    // Insert into ClickHouse
    await insertBenchmarks(benchmarkSet, LEADERBOARD_WALLETS);

    console.log('');
    console.log('='.repeat(70));
    console.log('DONE');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Run regression test with:`);
    console.log(`  npx tsx scripts/pnl/v20-regression-test.ts --set=${benchmarkSet}`);
    console.log('');
  } catch (e) {
    console.error('ERROR:', e);
    process.exit(1);
  }
}

main().catch(console.error);
