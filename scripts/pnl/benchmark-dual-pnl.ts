/**
 * Benchmark Dual PnL System on 18 Leaderboard Wallets
 *
 * Compares:
 * 1. Trading PnL (CLOB position-based)
 * 2. Cashflow PnL (CLOB + PayoutRedemption usdc_delta)
 *
 * Against UI PnL from the benchmark
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Top 18 from All-Time Leaderboard with UI PnL (manually captured)
const BENCHMARK_WALLETS = [
  { username: 'Theo4', address: '0xd91cfb1f6a7677ae15a9a7bfb4c46e545166702e', ui_pnl: 22053934 },
  { username: 'Fredi9999', address: '0x86bb99a01f5bb13815ebcd0d53cac0c4a8ab tried', ui_pnl: 16620028 },
  { username: 'Len9311238', address: '0x76a3f6f3c2e4f3c3d9e4f3c2e4f3c3d9e4f3c2e4', ui_pnl: 8709973 },
  { username: 'zxgngl', address: '0x1234567890123456789012345678901234567890', ui_pnl: 7807266 },
  // Let me get the actual wallets from the existing benchmark script
];

// Instead, let me query the benchmark table
async function main() {
  console.log('='.repeat(120));
  console.log('DUAL PNL BENCHMARK: Trading vs Cashflow');
  console.log('='.repeat(120));
  console.log('');

  // Get benchmark wallets that have UI PnL
  const benchmarkQuery = `
    SELECT DISTINCT wallet_address, ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE ui_pnl IS NOT NULL
    ORDER BY ui_pnl DESC
    LIMIT 20
  `;

  let benchmarks: any[] = [];
  try {
    const r = await clickhouse.query({ query: benchmarkQuery, format: 'JSONEachRow' });
    benchmarks = await r.json() as any[];
    console.log('Found ' + benchmarks.length + ' wallets in pm_ui_pnl_benchmarks_v1');
  } catch (e) {
    console.log('No benchmark table found, using hardcoded wallets...');
    benchmarks = [
      { wallet_address: '0xd91cfb1f6a7677ae15a9a7bfb4c46e545166702e', ui_pnl: 22053934 }, // Theo4
      { wallet_address: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', ui_pnl: 2437081 },  // ImJustKen
    ];
  }

  if (benchmarks.length === 0) {
    // Fallback to known wallets
    benchmarks = [
      { wallet_address: '0xd91cfb1f6a7677ae15a9a7bfb4c46e545166702e', ui_pnl: 22053934 }, // Theo4
      { wallet_address: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', ui_pnl: 2437081 },  // ImJustKen
    ];
  }

  console.log('');
  console.log('Computing dual PnL for each wallet...');
  console.log('');

  const results: any[] = [];

  for (const wallet of benchmarks) {
    const w = wallet.wallet_address.toLowerCase();
    const uiPnl = Number(wallet.ui_pnl);

    // 1. Trading PnL (CLOB position-based)
    const tradingQuery = `
      SELECT sum(position_pnl) as pnl
      FROM (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as position_pnl
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${w}'
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
      )
    `;

    // 2. Cashflow PnL (CLOB + PayoutRedemption)
    const cashflowQuery = `
      SELECT sum(usdc_delta) as pnl
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = '${w}'
        AND source_type IN ('CLOB', 'PayoutRedemption')
    `;

    // 3. Profile metrics (MM ratio)
    const profileQuery = `
      SELECT
        sumIf(abs(usdc_delta), source_type = 'CLOB') as clob_abs,
        sumIf(abs(usdc_delta), source_type IN ('PositionsMerge', 'PositionSplit')) as mm_abs
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = '${w}'
    `;

    try {
      const [tradingR, cashflowR, profileR] = await Promise.all([
        clickhouse.query({ query: tradingQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: cashflowQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: profileQuery, format: 'JSONEachRow' })
      ]);

      const tradingRows = await tradingR.json() as any[];
      const cashflowRows = await cashflowR.json() as any[];
      const profileRows = await profileR.json() as any[];

      const tradingPnl = Number(tradingRows[0]?.pnl || 0);
      const cashflowPnl = Number(cashflowRows[0]?.pnl || 0);
      const clobAbs = Number(profileRows[0]?.clob_abs || 0);
      const mmAbs = Number(profileRows[0]?.mm_abs || 0);
      const mmRatio = (clobAbs + mmAbs) > 0 ? mmAbs / (clobAbs + mmAbs) : 0;

      const tradingError = uiPnl !== 0 ? Math.abs((tradingPnl - uiPnl) / uiPnl * 100) : 0;
      const cashflowError = uiPnl !== 0 ? Math.abs((cashflowPnl - uiPnl) / uiPnl * 100) : 0;

      const profileType = mmRatio > 0.5 ? 'market_maker' : mmRatio < 0.2 ? 'trader' : 'mixed';
      const recommendedPnl = profileType === 'market_maker' ? cashflowPnl : tradingPnl;
      const recommendedError = uiPnl !== 0 ? Math.abs((recommendedPnl - uiPnl) / uiPnl * 100) : 0;

      results.push({
        wallet: w,
        ui_pnl: uiPnl,
        trading_pnl: tradingPnl,
        cashflow_pnl: cashflowPnl,
        trading_error: tradingError,
        cashflow_error: cashflowError,
        mm_ratio: mmRatio,
        profile_type: profileType,
        recommended_pnl: recommendedPnl,
        recommended_error: recommendedError,
        better_method: tradingError < cashflowError ? 'trading' : 'cashflow'
      });

    } catch (e: any) {
      console.log('Error for wallet ' + w.substring(0, 10) + '...: ' + e.message);
    }
  }

  // Output results
  console.log('');
  console.log('='.repeat(140));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(140));
  console.log('');
  console.log('Wallet (first 12)   | UI PnL          | Trading PnL     | T.Err%  | Cashflow PnL    | C.Err%  | MM%    | Profile      | Better');
  console.log('-'.repeat(140));

  let tradingPassCount = 0;
  let cashflowPassCount = 0;
  let recommendedPassCount = 0;

  for (const r of results) {
    const wallet = r.wallet.substring(0, 12).padEnd(12);
    const uiPnl = ('$' + Number(r.ui_pnl).toLocaleString()).padStart(15);
    const tradingPnl = ('$' + Number(r.trading_pnl).toLocaleString()).padStart(15);
    const tradingErr = r.trading_error.toFixed(1).padStart(6) + '%';
    const cashflowPnl = ('$' + Number(r.cashflow_pnl).toLocaleString()).padStart(15);
    const cashflowErr = r.cashflow_error.toFixed(1).padStart(6) + '%';
    const mmRatio = (r.mm_ratio * 100).toFixed(1).padStart(5) + '%';
    const profile = r.profile_type.padEnd(12);
    const better = r.better_method.padEnd(8);

    console.log(`${wallet} | ${uiPnl} | ${tradingPnl} | ${tradingErr} | ${cashflowPnl} | ${cashflowErr} | ${mmRatio} | ${profile} | ${better}`);

    if (r.trading_error <= 5) tradingPassCount++;
    if (r.cashflow_error <= 5) cashflowPassCount++;
    if (r.recommended_error <= 5) recommendedPassCount++;
  }

  console.log('-'.repeat(140));
  console.log('');
  console.log('SUMMARY:');
  console.log('  Total wallets: ' + results.length);
  console.log('  Trading PnL (CLOB position-based):');
  console.log('    Pass rate (≤5% error): ' + tradingPassCount + '/' + results.length + ' (' + (tradingPassCount / results.length * 100).toFixed(0) + '%)');
  console.log('    Median error: ' + results.sort((a, b) => a.trading_error - b.trading_error)[Math.floor(results.length / 2)]?.trading_error.toFixed(2) + '%');
  console.log('  Cashflow PnL (CLOB + PayoutRedemption):');
  console.log('    Pass rate (≤5% error): ' + cashflowPassCount + '/' + results.length + ' (' + (cashflowPassCount / results.length * 100).toFixed(0) + '%)');
  console.log('    Median error: ' + results.sort((a, b) => a.cashflow_error - b.cashflow_error)[Math.floor(results.length / 2)]?.cashflow_error.toFixed(2) + '%');
  console.log('  Recommended (profile-based):');
  console.log('    Pass rate (≤5% error): ' + recommendedPassCount + '/' + results.length + ' (' + (recommendedPassCount / results.length * 100).toFixed(0) + '%)');

  // Profile distribution
  const traderCount = results.filter(r => r.profile_type === 'trader').length;
  const mmCount = results.filter(r => r.profile_type === 'market_maker').length;
  const mixedCount = results.filter(r => r.profile_type === 'mixed').length;
  console.log('');
  console.log('  Profile distribution:');
  console.log('    Traders: ' + traderCount);
  console.log('    Market-makers: ' + mmCount);
  console.log('    Mixed: ' + mixedCount);

  // Which method wins for each profile?
  console.log('');
  console.log('  Better method by profile:');
  const traderBetter = results.filter(r => r.profile_type === 'trader').reduce((acc, r) => {
    acc[r.better_method] = (acc[r.better_method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const mmBetter = results.filter(r => r.profile_type === 'market_maker').reduce((acc, r) => {
    acc[r.better_method] = (acc[r.better_method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('    Traders: trading=' + (traderBetter.trading || 0) + ', cashflow=' + (traderBetter.cashflow || 0));
  console.log('    Market-makers: trading=' + (mmBetter.trading || 0) + ', cashflow=' + (mmBetter.cashflow || 0));
}

main().catch(console.error);
