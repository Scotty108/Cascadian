/**
 * Comprehensive V20 PnL Accuracy Test
 *
 * Tests V20 engine against:
 * 1. Fresh leaderboard data (40 wallets, scraped Dec 4 2025)
 * 2. 50-wallet legacy benchmark set
 * 3. Statistical analysis and categorization
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface TestResult {
  wallet: string;
  name: string;
  source: 'leaderboard' | 'benchmark';
  ui_pnl: number;
  v20_pnl: number;
  error_pct: number;
  error_absolute: number;
  sign_match: boolean;
  category: '<1%' | '<5%' | '<10%' | '<25%' | '<50%' | '>50%' | 'zero_both';
}

// Fresh leaderboard data scraped from Polymarket Dec 4, 2025
// Top 40 All-Time winners
const LEADERBOARD_WALLETS = [
  // Page 1 (1-20)
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4', ui_pnl: 22053934 },
  { wallet: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', name: 'Fredi9999', ui_pnl: 16620028 },
  { wallet: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', name: 'Len9311238', ui_pnl: 8709973 },
  { wallet: '0xd235973291b2b75ff4070e9c0b01728c520b0f29', name: 'zxgngl', ui_pnl: 7807266 },
  { wallet: '0x863134d00841b2e200492805a01e1e2f5defaa53', name: 'RepTrump', ui_pnl: 7532410 },
  { wallet: '0x8119010a6e589062aa03583bb3f39ca632d9f887', name: 'PrincessCaro', ui_pnl: 6083643 },
  { wallet: '0xe9ad918c7678cd38b12603a762e638a5d1ee7091', name: 'walletmobile', ui_pnl: 5942685 },
  { wallet: '0x885783760858e1bd5dd09a3c3f916cfa251ac270', name: 'BetTom42', ui_pnl: 5642136 },
  { wallet: '0x23786fdad0073692157c6d7dc81f281843a35fcb', name: 'mikatrade77', ui_pnl: 5147999 },
  { wallet: '0xd0c042c08f755ff940249f62745e82d356345565', name: 'alexmulti', ui_pnl: 4804856 },
  { wallet: '0x94a428cfa4f84b264e01f70d93d02bc96cb36356', name: 'GCottrell93', ui_pnl: 4289091 },
  { wallet: '0x16f91db2592924cfed6e03b7e5cb5bb1e32299e3', name: 'Jenzigo', ui_pnl: 4049827 },
  { wallet: '0x17db3fcd93ba12d38382a0cade24b200185c5f6d', name: 'fengdubiying', ui_pnl: 3202358 },
  { wallet: '0x033a07b3de5947eab4306676ad74eb546da30d50', name: 'RandomGenius', ui_pnl: 3115550 },
  { wallet: '0xed2239a9150c3920000d0094d28fa51c7db03dd0', name: 'Michie', ui_pnl: 3095008 },
  { wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee', name: 'kch123', ui_pnl: 2989447 },
  { wallet: '0xe74a4446efd66a4de690962938f550d8921a40ee', name: 'walletX', ui_pnl: 2863673 },
  { wallet: '0x343d4466dc323b850e5249394894c7381d91456e', name: 'tazcot', ui_pnl: 2604548 },
  { wallet: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', name: 'ImJustKen', ui_pnl: 2443014 },
  { wallet: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11', ui_pnl: 2366251 },
  // Page 2 (21-40)
  { wallet: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', name: 'wallet0x7f', ui_pnl: 2266615 },
  { wallet: '0xa9878e59934ab507f9039bcb917c1bae0451141d', name: 'ilovecircle', ui_pnl: 2262917 },
  { wallet: '0x5bffcf561bcae83af680ad600cb99f1184d6ffbe', name: 'YatSen', ui_pnl: 2240496 },
  { wallet: '0xb786b8b6335e77dfad19928313e97753039cb18d', name: 'wallet0xb7', ui_pnl: 2166759 },
  { wallet: '0xee00ba338c59557141789b127927a55f5cc5cea1', name: 'S-Works', ui_pnl: 2128489 },
  { wallet: '0x2bf64b86b64c315d879571b07a3b76629e467cd0', name: 'BabaTrump', ui_pnl: 2093363 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', name: 'swisstony', ui_pnl: 2021442 },
  { wallet: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm', ui_pnl: 1960675 },
  { wallet: '0x0562c423912e325f83fa79df55085979e1f5594f', name: 'trezorisbest', ui_pnl: 1903941 },
  { wallet: '0x42592084120b0d5287059919d2a96b3b7acb936f', name: 'antman-batman', ui_pnl: 1900476 },
  { wallet: '0xd7f85d0eb0fe0732ca38d9107ad0d4d01b1289e4', name: 'tdrhrhhd', ui_pnl: 1898878 },
  { wallet: '0x7058c8a7cec79010b1927d05837dcf25f1a53505', name: 'deetown', ui_pnl: 1849975 },
  { wallet: '0xd31a2ea0b5f9a10c2eb78dcc36df016497d5386e', name: 'DarthVooncer', ui_pnl: 1766594 },
  { wallet: '0x14964aefa2cd7caff7878b3820a690a03c5aa429', name: 'gmpm', ui_pnl: 1742493 },
  { wallet: '0x3d1ecf16942939b3603c2539a406514a40b504d0', name: 'edenmoon', ui_pnl: 1712369 },
  { wallet: '0x212954857f5efc138748c33d032a93bf95974222', name: '3bpatgs', ui_pnl: 1685688 },
  { wallet: '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', name: 'aenews2', ui_pnl: 1563495 },
  { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1', ui_pnl: 1550541 },
  { wallet: '0x461f3e886dca22e561eee224d283e08b8fb47a07', name: 'HyperLiquid0xb', ui_pnl: 1496847 },
  { wallet: '0x2f09642639aedd6ced432519c1a86e7d52034632', name: 'piastri', ui_pnl: 1489608 },
];

function categorizeError(errorPct: number, uiPnl: number, v20Pnl: number): TestResult['category'] {
  if (Math.abs(uiPnl) < 0.01 && Math.abs(v20Pnl) < 0.01) return 'zero_both';
  if (errorPct < 1) return '<1%';
  if (errorPct < 5) return '<5%';
  if (errorPct < 10) return '<10%';
  if (errorPct < 25) return '<25%';
  if (errorPct < 50) return '<50%';
  return '>50%';
}

async function runComprehensiveTest() {
  console.log('='.repeat(120));
  console.log('COMPREHENSIVE V20 PNL ACCURACY TEST');
  console.log('='.repeat(120));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const results: TestResult[] = [];

  // ==================== PART 1: Leaderboard Wallets ====================
  console.log('-'.repeat(120));
  console.log('PART 1: TESTING TOP 40 LEADERBOARD WALLETS (Fresh data Dec 4, 2025)');
  console.log('-'.repeat(120));

  for (let i = 0; i < LEADERBOARD_WALLETS.length; i++) {
    const { wallet, name, ui_pnl } = LEADERBOARD_WALLETS[i];
    process.stdout.write(`  [${(i + 1).toString().padStart(2)}/${LEADERBOARD_WALLETS.length}] ${name.padEnd(20)}... `);

    try {
      const v20Result = await calculateV20PnL(wallet);
      const v20Pnl = v20Result.total_pnl;

      const errorPct = Math.abs(ui_pnl) < 0.01 ? 0 : Math.abs((v20Pnl - ui_pnl) / ui_pnl) * 100;
      const errorAbsolute = Math.abs(v20Pnl - ui_pnl);
      const signMatch = (ui_pnl >= 0) === (v20Pnl >= 0);
      const category = categorizeError(errorPct, ui_pnl, v20Pnl);

      results.push({
        wallet,
        name,
        source: 'leaderboard',
        ui_pnl,
        v20_pnl: v20Pnl,
        error_pct: errorPct,
        error_absolute: errorAbsolute,
        sign_match: signMatch,
        category
      });

      const statusEmoji = errorPct < 5 ? '✅' : errorPct < 25 ? '⚠️' : '❌';
      console.log(`${statusEmoji} Error: ${errorPct.toFixed(2)}%`);
    } catch (err) {
      console.log(`❌ Error: ${err}`);
    }
  }

  // ==================== PART 2: Benchmark Set ====================
  console.log('');
  console.log('-'.repeat(120));
  console.log('PART 2: TESTING 50-WALLET LEGACY BENCHMARK SET');
  console.log('-'.repeat(120));

  const benchmarkQuery = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value as ui_pnl, note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '50_wallet_v1_legacy'
    `,
    format: 'JSONEachRow'
  });
  const benchmarkRows = await benchmarkQuery.json() as any[];

  // Filter out wallets already tested in leaderboard
  const leaderboardWallets = new Set(LEADERBOARD_WALLETS.map(w => w.wallet.toLowerCase()));
  const uniqueBenchmarks = benchmarkRows.filter(
    (b: any) => !leaderboardWallets.has(b.wallet.toLowerCase())
  );

  console.log(`  Found ${benchmarkRows.length} benchmark wallets, ${uniqueBenchmarks.length} not already tested`);
  console.log('');

  for (let i = 0; i < uniqueBenchmarks.length; i++) {
    const { wallet, ui_pnl, note } = uniqueBenchmarks[i];
    const uiPnl = Number(ui_pnl);
    const name = note || wallet.slice(0, 10);

    process.stdout.write(`  [${(i + 1).toString().padStart(2)}/${uniqueBenchmarks.length}] ${name.slice(0, 20).padEnd(20)}... `);

    try {
      const v20Result = await calculateV20PnL(wallet);
      const v20Pnl = v20Result.total_pnl;

      const errorPct = Math.abs(uiPnl) < 0.01 ? (Math.abs(v20Pnl) < 0.01 ? 0 : 100) : Math.abs((v20Pnl - uiPnl) / uiPnl) * 100;
      const errorAbsolute = Math.abs(v20Pnl - uiPnl);
      const signMatch = (uiPnl >= 0) === (v20Pnl >= 0);
      const category = categorizeError(errorPct, uiPnl, v20Pnl);

      results.push({
        wallet,
        name,
        source: 'benchmark',
        ui_pnl: uiPnl,
        v20_pnl: v20Pnl,
        error_pct: errorPct,
        error_absolute: errorAbsolute,
        sign_match: signMatch,
        category
      });

      const statusEmoji = errorPct < 5 ? '✅' : errorPct < 25 ? '⚠️' : '❌';
      console.log(`${statusEmoji} Error: ${errorPct.toFixed(2)}%`);
    } catch (err) {
      console.log(`❌ Error: ${err}`);
    }
  }

  // ==================== REPORT ====================
  console.log('');
  console.log('='.repeat(120));
  console.log('COMPREHENSIVE ACCURACY REPORT');
  console.log('='.repeat(120));

  // Sort by error percentage
  results.sort((a, b) => a.error_pct - b.error_pct);

  // Best performers
  console.log('');
  console.log('TOP 10 MOST ACCURATE (lowest error):');
  console.log('-'.repeat(100));
  console.log('| # | Wallet           | Source      | UI PnL           | V20 PnL          | Error %  |');
  console.log('|---|------------------|-------------|------------------|------------------|----------|');

  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    const uiFmt = r.ui_pnl >= 0 ? `+$${Math.abs(r.ui_pnl).toLocaleString()}` : `-$${Math.abs(r.ui_pnl).toLocaleString()}`;
    const v20Fmt = r.v20_pnl >= 0 ? `+$${Math.abs(r.v20_pnl).toLocaleString()}` : `-$${Math.abs(r.v20_pnl).toLocaleString()}`;
    console.log(`| ${(i+1).toString().padStart(1)} | ${r.name.slice(0,16).padEnd(16)} | ${r.source.padEnd(11)} | ${uiFmt.padStart(16)} | ${v20Fmt.padStart(16)} | ${r.error_pct.toFixed(2).padStart(7)}% |`);
  }

  // Worst performers
  console.log('');
  console.log('TOP 10 WORST PERFORMERS (highest error):');
  console.log('-'.repeat(100));
  console.log('| # | Wallet           | Source      | UI PnL           | V20 PnL          | Error %  |');
  console.log('|---|------------------|-------------|------------------|------------------|----------|');

  const worst = [...results].sort((a, b) => b.error_pct - a.error_pct);
  for (let i = 0; i < Math.min(10, worst.length); i++) {
    const r = worst[i];
    const uiFmt = r.ui_pnl >= 0 ? `+$${Math.abs(r.ui_pnl).toLocaleString()}` : `-$${Math.abs(r.ui_pnl).toLocaleString()}`;
    const v20Fmt = r.v20_pnl >= 0 ? `+$${Math.abs(r.v20_pnl).toLocaleString()}` : `-$${Math.abs(r.v20_pnl).toLocaleString()}`;
    console.log(`| ${(i+1).toString().padStart(1)} | ${r.name.slice(0,16).padEnd(16)} | ${r.source.padEnd(11)} | ${uiFmt.padStart(16)} | ${v20Fmt.padStart(16)} | ${r.error_pct.toFixed(2).padStart(7)}% |`);
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(120));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(120));

  const total = results.length;
  const leaderboardResults = results.filter(r => r.source === 'leaderboard');
  const benchmarkResults = results.filter(r => r.source === 'benchmark');

  const calcStats = (arr: TestResult[]) => {
    if (arr.length === 0) return null;
    const under1 = arr.filter(r => r.category === '<1%' || r.category === 'zero_both').length;
    const under5 = arr.filter(r => ['<1%', '<5%', 'zero_both'].includes(r.category)).length;
    const under10 = arr.filter(r => ['<1%', '<5%', '<10%', 'zero_both'].includes(r.category)).length;
    const under25 = arr.filter(r => ['<1%', '<5%', '<10%', '<25%', 'zero_both'].includes(r.category)).length;
    const under50 = arr.filter(r => r.category !== '>50%').length;
    const signMatches = arr.filter(r => r.sign_match).length;

    const errors = arr.map(r => r.error_pct).filter(e => e < 1000); // Filter extreme outliers
    const avgError = errors.reduce((s, e) => s + e, 0) / errors.length;
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

    return { under1, under5, under10, under25, under50, signMatches, avgError, medianError, total: arr.length };
  };

  const allStats = calcStats(results)!;
  const leaderboardStats = calcStats(leaderboardResults);
  const benchmarkStats = calcStats(benchmarkResults);

  console.log('');
  console.log('OVERALL RESULTS:');
  console.log(`  Total Wallets Tested:     ${total}`);
  console.log(`  Sign Matches:             ${allStats.signMatches}/${total} (${(allStats.signMatches/total*100).toFixed(1)}%)`);
  console.log('');
  console.log('  Error Distribution:');
  console.log(`    < 1% error:             ${allStats.under1}/${total} (${(allStats.under1/total*100).toFixed(1)}%)`);
  console.log(`    < 5% error:             ${allStats.under5}/${total} (${(allStats.under5/total*100).toFixed(1)}%)`);
  console.log(`    < 10% error:            ${allStats.under10}/${total} (${(allStats.under10/total*100).toFixed(1)}%)`);
  console.log(`    < 25% error:            ${allStats.under25}/${total} (${(allStats.under25/total*100).toFixed(1)}%)`);
  console.log(`    < 50% error:            ${allStats.under50}/${total} (${(allStats.under50/total*100).toFixed(1)}%)`);
  console.log(`    > 50% error:            ${total - allStats.under50}/${total} (${((total - allStats.under50)/total*100).toFixed(1)}%)`);
  console.log('');
  console.log(`  Average Error:            ${allStats.avgError.toFixed(2)}%`);
  console.log(`  Median Error:             ${allStats.medianError.toFixed(2)}%`);

  if (leaderboardStats) {
    console.log('');
    console.log('LEADERBOARD WALLETS (Top 40 All-Time Winners):');
    console.log(`  Total:                    ${leaderboardStats.total}`);
    console.log(`  Sign Matches:             ${leaderboardStats.signMatches}/${leaderboardStats.total} (${(leaderboardStats.signMatches/leaderboardStats.total*100).toFixed(1)}%)`);
    console.log(`  < 5% error:               ${leaderboardStats.under5}/${leaderboardStats.total} (${(leaderboardStats.under5/leaderboardStats.total*100).toFixed(1)}%)`);
    console.log(`  Average Error:            ${leaderboardStats.avgError.toFixed(2)}%`);
    console.log(`  Median Error:             ${leaderboardStats.medianError.toFixed(2)}%`);
  }

  if (benchmarkStats && benchmarkStats.total > 0) {
    console.log('');
    console.log('BENCHMARK WALLETS (50-wallet legacy set):');
    console.log(`  Total:                    ${benchmarkStats.total}`);
    console.log(`  Sign Matches:             ${benchmarkStats.signMatches}/${benchmarkStats.total} (${(benchmarkStats.signMatches/benchmarkStats.total*100).toFixed(1)}%)`);
    console.log(`  < 5% error:               ${benchmarkStats.under5}/${benchmarkStats.total} (${(benchmarkStats.under5/benchmarkStats.total*100).toFixed(1)}%)`);
    console.log(`  Average Error:            ${benchmarkStats.avgError.toFixed(2)}%`);
    console.log(`  Median Error:             ${benchmarkStats.medianError.toFixed(2)}%`);
  }

  // Final verdict
  console.log('');
  console.log('='.repeat(120));
  console.log('FINAL VERDICT');
  console.log('='.repeat(120));

  const passThreshold = 0.8; // 80% of wallets should be < 5% error
  const passRate = allStats.under5 / total;

  if (passRate >= passThreshold && allStats.signMatches >= total * 0.95) {
    console.log('');
    console.log('  ============================================');
    console.log('  |  PASS - V20 ENGINE IS PRODUCTION READY  |');
    console.log('  ============================================');
    console.log('');
    console.log(`  ${(passRate * 100).toFixed(1)}% of wallets within 5% error threshold`);
    console.log(`  ${(allStats.signMatches/total*100).toFixed(1)}% sign accuracy`);
    console.log(`  Median error: ${allStats.medianError.toFixed(2)}%`);
  } else if (passRate >= 0.6) {
    console.log('');
    console.log('  =============================================');
    console.log('  |  ACCEPTABLE - MINOR IMPROVEMENTS NEEDED  |');
    console.log('  =============================================');
    console.log('');
    console.log(`  ${(passRate * 100).toFixed(1)}% of wallets within 5% error threshold`);
    console.log(`  Target: 80%`);
  } else {
    console.log('');
    console.log('  =============================================');
    console.log('  |  NEEDS WORK - SIGNIFICANT ISSUES FOUND   |');
    console.log('  =============================================');
    console.log('');
    console.log(`  Only ${(passRate * 100).toFixed(1)}% of wallets within 5% error threshold`);
    console.log(`  Target: 80%`);
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('');

  // Export results to JSON for further analysis
  const outputPath = '/tmp/v20-comprehensive-test-results.json';
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total_wallets: total,
      pass_rate: passRate,
      sign_match_rate: allStats.signMatches / total,
      median_error: allStats.medianError,
      average_error: allStats.avgError
    },
    distribution: {
      under_1_pct: allStats.under1,
      under_5_pct: allStats.under5,
      under_10_pct: allStats.under10,
      under_25_pct: allStats.under25,
      under_50_pct: allStats.under50,
      over_50_pct: total - allStats.under50
    },
    results: results
  }, null, 2));

  console.log(`Results exported to: ${outputPath}`);
}

runComprehensiveTest().catch(console.error);
