/**
 * Extended Benchmark Test - 6 Wallets
 *
 * Tests the canonical PnL engine against your provided benchmark wallets.
 */

import { calculateCanonicalPnL, formatUsd } from './canonical-pnl-engine';

interface BenchmarkWallet {
  addr: string;
  label: string;
  uiPnl: number;
}

const WALLETS: BenchmarkWallet[] = [
  { addr: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1', uiPnl: -6138.9 },
  { addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2', uiPnl: 4404.92 },
  { addr: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3', uiPnl: 5.44 },
  { addr: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', label: 'W4', uiPnl: -294.61 },
  { addr: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5', uiPnl: 146.9 },
  { addr: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6', uiPnl: 470.4 },
];

interface Result {
  label: string;
  uiPnl: number;
  estimate: number;
  diff: number;
  pct: number;
  shortRatio: number;
  tier: string;
  details: {
    clob_buys: number;
    clob_sells: number;
    redemptions: number;
    gross_long_winners: number;
    gross_short_winners: number;
    unredeemed_long_winners: number;
    unredeemed_short_liability: number;
    realized_cash_pnl: number;
  };
}

async function main() {
  console.log('═'.repeat(100));
  console.log('CANONICAL PnL ENGINE - EXTENDED BENCHMARK (6 WALLETS)');
  console.log('═'.repeat(100));
  console.log('');

  const results: Result[] = [];

  for (const w of WALLETS) {
    console.log(`Processing ${w.label} (${w.addr.substring(0, 10)}...)...`);
    try {
      const result = await calculateCanonicalPnL(w.addr);
      const diff = result.ui_pnl_est - w.uiPnl;
      const pct = (diff / Math.abs(w.uiPnl)) * 100;

      // Calculate short ratio for tier
      const totalWinners = result.gross_long_winners + result.gross_short_winners;
      const shortRatio = totalWinners > 0 ? result.gross_short_winners / totalWinners : 0;
      let tier = 'Retail';
      if (shortRatio > 0.3) tier = 'Operator';
      else if (shortRatio > 0.1) tier = 'Mixed';

      results.push({
        label: w.label,
        uiPnl: w.uiPnl,
        estimate: result.ui_pnl_est,
        diff,
        pct,
        shortRatio,
        tier,
        details: {
          clob_buys: result.clob_buys,
          clob_sells: result.clob_sells,
          redemptions: result.redemptions,
          gross_long_winners: result.gross_long_winners,
          gross_short_winners: result.gross_short_winners,
          unredeemed_long_winners: result.unredeemed_long_winners,
          unredeemed_short_liability: result.unredeemed_short_liability,
          realized_cash_pnl: result.realized_cash_pnl,
        },
      });
    } catch (err: unknown) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(100));
  console.log('');
  console.log(
    'Wallet'.padEnd(8) +
      ' | ' +
      'UI PnL'.padStart(12) +
      ' | ' +
      'Estimate'.padStart(12) +
      ' | ' +
      'Difference'.padStart(12) +
      ' | ' +
      'Error %'.padStart(10) +
      ' | ' +
      'Short%'.padStart(8) +
      ' | ' +
      'Tier'
  );
  console.log('─'.repeat(90));

  for (const r of results) {
    const sign = r.diff >= 0 ? '+' : '';
    console.log(
      r.label.padEnd(8) +
        ' | ' +
        formatUsd(r.uiPnl).padStart(12) +
        ' | ' +
        formatUsd(r.estimate).padStart(12) +
        ' | ' +
        (sign + formatUsd(r.diff)).padStart(12) +
        ' | ' +
        (sign + r.pct.toFixed(1) + '%').padStart(10) +
        ' | ' +
        (r.shortRatio * 100).toFixed(1).padStart(7) +
        '%' +
        ' | ' +
        r.tier
    );
  }

  // Accuracy summary by tier
  console.log('');
  console.log('═'.repeat(100));
  console.log('ACCURACY BY TIER');
  console.log('═'.repeat(100));

  const retailResults = results.filter((r) => r.tier === 'Retail');
  const mixedResults = results.filter((r) => r.tier === 'Mixed');
  const operatorResults = results.filter((r) => r.tier === 'Operator');

  if (retailResults.length > 0) {
    const avgError = retailResults.reduce((sum, r) => sum + Math.abs(r.pct), 0) / retailResults.length;
    const within5 = retailResults.filter((r) => Math.abs(r.pct) <= 5).length;
    console.log(
      `Retail (${retailResults.length}): Avg error ${avgError.toFixed(1)}%, ${within5}/${retailResults.length} within ±5%`
    );
  }

  if (mixedResults.length > 0) {
    const avgError = mixedResults.reduce((sum, r) => sum + Math.abs(r.pct), 0) / mixedResults.length;
    console.log(`Mixed (${mixedResults.length}): Avg error ${avgError.toFixed(1)}%`);
  }

  if (operatorResults.length > 0) {
    const avgError = operatorResults.reduce((sum, r) => sum + Math.abs(r.pct), 0) / operatorResults.length;
    console.log(`Operator (${operatorResults.length}): Avg error ${avgError.toFixed(1)}%`);
  }

  // Detailed breakdown
  console.log('');
  console.log('═'.repeat(100));
  console.log('DETAILED BREAKDOWN');
  console.log('═'.repeat(100));

  for (const r of results) {
    const d = r.details;
    console.log('');
    console.log(`${r.label} (${r.tier}, short ratio: ${(r.shortRatio * 100).toFixed(1)}%):`);
    console.log(
      `  Cash: Buys ${formatUsd(-d.clob_buys)}, Sells ${formatUsd(d.clob_sells)}, Redemptions ${formatUsd(d.redemptions)}`
    );
    console.log(
      `  Positions: LongWin ${formatUsd(d.gross_long_winners)}, ShortWin ${formatUsd(-d.gross_short_winners)} (liability)`
    );
    console.log(
      `  Unredeemed: Winners ${formatUsd(d.unredeemed_long_winners)}, Liability ${formatUsd(-d.unredeemed_short_liability)}`
    );
    console.log(
      `  Result: Realized ${formatUsd(d.realized_cash_pnl)} + Unredeemed ${formatUsd(d.unredeemed_long_winners - d.unredeemed_short_liability)} = ${formatUsd(r.estimate)}`
    );
    console.log(`  UI PnL: ${formatUsd(r.uiPnl)} | Diff: ${formatUsd(r.diff)} (${r.pct.toFixed(1)}%)`);
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(100));
}

main().catch(console.error);
