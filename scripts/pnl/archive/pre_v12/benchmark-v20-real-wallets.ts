/**
 * V20 PnL Engine Benchmark with REAL Wallets from Polymarket Leaderboard
 *
 * All-Time Top 20 wallets scraped from polymarket.com/leaderboard on 2025-12-03
 * These are REAL wallets with verified UI PnL values
 */

import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { clickhouse } from '../../lib/clickhouse/client';

// Real wallets from Polymarket All-Time Leaderboard (2025-12-03)
const REAL_WALLETS = [
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
  { wallet: '0x94a428cfa4f84b264e01f70d93d02bc96cb36356', name: 'GCottrell93', ui_pnl: 4289673 },
  { wallet: '0x16f91db2592924cfed6e03b7e5cb5bb1e32299e3', name: 'Jenzigo', ui_pnl: 4049827 },
  { wallet: '0x17db3fcd93ba12d38382a0cade24b200185c5f6d', name: 'fengdubiying', ui_pnl: 3202115 },
  { wallet: '0x033a07b3de5947eab4306676ad74eb546da30d50', name: 'RandomGenius', ui_pnl: 3115550 },
  { wallet: '0xed2239a9150c3920000d0094d28fa51c7db03dd0', name: 'Michie', ui_pnl: 3095008 },
  { wallet: '0x343d4466dc323b850e5249394894c7381d91456e', name: 'tazcot', ui_pnl: 2604548 },
  { wallet: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', name: 'ImJustKen', ui_pnl: 2437081 },
  { wallet: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11', ui_pnl: 2287942 },
];

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function checkWalletDataExists(wallet: string): Promise<{ clob: number; ctf: number }> {
  const clobQuery = `
    SELECT count() as cnt
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;
  const ctfQuery = `
    SELECT count() as cnt
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND is_deleted = 0
  `;

  const [clobResult, ctfResult] = await Promise.all([
    clickhouse.query({ query: clobQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' }),
  ]);

  const clobRows = (await clobResult.json()) as any[];
  const ctfRows = (await ctfResult.json()) as any[];

  return {
    clob: Number(clobRows[0]?.cnt || 0),
    ctf: Number(ctfRows[0]?.cnt || 0),
  };
}

async function main() {
  const walletCount = parseInt(process.argv[2] || '10');
  const testWallets = REAL_WALLETS.slice(0, walletCount);

  console.log('='.repeat(130));
  console.log('V20 PNL ENGINE BENCHMARK - REAL WALLETS FROM POLYMARKET LEADERBOARD');
  console.log('='.repeat(130));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Testing ${testWallets.length} wallets from All-Time Leaderboard`);
  console.log('');

  // First, check data availability
  console.log('STEP 1: Checking data availability in ClickHouse...');
  console.log('-'.repeat(130));
  console.log('Username       | Wallet (first 20)       | CLOB Rows    | CTF Rows     | Has Data?');
  console.log('-'.repeat(130));

  const dataCheck: { wallet: string; name: string; ui_pnl: number; clob: number; ctf: number }[] = [];

  for (const w of testWallets) {
    const data = await checkWalletDataExists(w.wallet);
    const hasData = data.clob > 0 || data.ctf > 0 ? 'YES' : 'NO DATA';
    console.log(
      `${w.name.padEnd(14)} | ${w.wallet.substring(0, 22)}... | ${data.clob.toLocaleString().padStart(12)} | ${data.ctf.toLocaleString().padStart(12)} | ${hasData}`
    );
    dataCheck.push({ ...w, clob: data.clob, ctf: data.ctf });
  }

  const walletsWithData = dataCheck.filter((w) => w.clob > 0 || w.ctf > 0);
  const walletsWithoutData = dataCheck.filter((w) => w.clob === 0 && w.ctf === 0);

  console.log('');
  console.log(`Wallets WITH data: ${walletsWithData.length}/${testWallets.length}`);
  console.log(`Wallets WITHOUT data: ${walletsWithoutData.length}/${testWallets.length}`);
  console.log('');

  if (walletsWithData.length === 0) {
    console.log('ERROR: No wallets have data in ClickHouse!');
    console.log('This indicates a data coverage gap - the leaderboard wallets are not in our database.');
    return;
  }

  // Step 2: Run V20 benchmark on wallets with data
  console.log('STEP 2: Running V20 PnL Engine on wallets with data...');
  console.log('-'.repeat(130));
  console.log('Username       | UI PnL          | V20 PnL         | Error %   | Positions | Resolved');
  console.log('-'.repeat(130));

  const errors: number[] = [];
  const results: any[] = [];

  for (const w of walletsWithData) {
    try {
      const v20 = await calculateV20PnL(w.wallet);
      const err = errorPct(v20.total_pnl, w.ui_pnl);
      errors.push(err);

      console.log(
        `${w.name.padEnd(14)} | ${formatUSD(w.ui_pnl).padStart(15)} | ${formatUSD(v20.total_pnl).padStart(15)} | ${err.toFixed(1).padStart(8)}% | ${v20.positions.toLocaleString().padStart(9)} | ${v20.resolved.toLocaleString().padStart(8)}`
      );

      results.push({
        name: w.name,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v20_pnl: v20.total_pnl,
        error_pct: err,
        positions: v20.positions,
        resolved: v20.resolved,
        clob_rows: w.clob,
        ctf_rows: w.ctf,
      });
    } catch (e) {
      console.log(`${w.name.padEnd(14)} | ERROR: ${e}`);
    }
  }

  // Summary stats
  if (errors.length > 0) {
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const pass1 = errors.filter((e) => e <= 1).length;
    const pass5 = errors.filter((e) => e <= 5).length;
    const pass10 = errors.filter((e) => e <= 10).length;
    const pass25 = errors.filter((e) => e <= 25).length;

    console.log('');
    console.log('-'.repeat(130));
    console.log('SUMMARY');
    console.log('-'.repeat(130));
    console.log(`Wallets Tested:     ${errors.length}`);
    console.log(`Median Error:       ${median(errors).toFixed(2)}%`);
    console.log(`Mean Error:         ${mean.toFixed(2)}%`);
    console.log(`Pass ≤1%:           ${pass1}/${errors.length} (${((pass1 / errors.length) * 100).toFixed(0)}%)`);
    console.log(`Pass ≤5%:           ${pass5}/${errors.length} (${((pass5 / errors.length) * 100).toFixed(0)}%)`);
    console.log(`Pass ≤10%:          ${pass10}/${errors.length} (${((pass10 / errors.length) * 100).toFixed(0)}%)`);
    console.log(`Pass ≤25%:          ${pass25}/${errors.length} (${((pass25 / errors.length) * 100).toFixed(0)}%)`);
    console.log('');

    // Show best and worst
    const sorted = [...results].sort((a, b) => a.error_pct - b.error_pct);
    console.log('Best 3 (lowest error):');
    for (const r of sorted.slice(0, 3)) {
      console.log(`  ${r.name}: ${r.error_pct.toFixed(2)}% error (UI: ${formatUSD(r.ui_pnl)}, V20: ${formatUSD(r.v20_pnl)})`);
    }
    console.log('');
    console.log('Worst 3 (highest error):');
    for (const r of sorted.slice(-3).reverse()) {
      console.log(`  ${r.name}: ${r.error_pct.toFixed(2)}% error (UI: ${formatUSD(r.ui_pnl)}, V20: ${formatUSD(r.v20_pnl)})`);
    }
  }

  console.log('');
  console.log('='.repeat(130));

  // If many wallets have no data, this is the critical finding
  if (walletsWithoutData.length > 0) {
    console.log('');
    console.log('CRITICAL FINDING: The following leaderboard wallets have NO DATA in ClickHouse:');
    for (const w of walletsWithoutData) {
      console.log(`  - ${w.name} (${w.wallet}): UI PnL = ${formatUSD(w.ui_pnl)}`);
    }
    console.log('');
    console.log('This indicates a DATA COVERAGE issue, not a PnL calculation bug.');
    console.log('These wallets may need to be backfilled from Goldsky or another source.');
  }
}

main().catch(console.error);
