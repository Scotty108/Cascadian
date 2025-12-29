/**
 * Analyze V18 Benchmark Outliers
 *
 * Categorizes wallets by accuracy and identifies patterns in errors
 */

import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: {
    username: string;
    pnl: number;
    volume: number;
    gain: number;
    loss: number;
  };
  v18: {
    realized_pnl: number;
    unrealized_pnl: number;
    total_pnl: number;
    volume_traded: number;
    positions_count: number;
  };
  pnl_error_pct: number;
  total_pnl_error_pct: number;
  volume_error_pct: number;
}

interface Report {
  results: BenchmarkResult[];
}

function analyzeOutliers() {
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found. Run benchmark first.');
    return;
  }

  const report: Report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const results = report.results.filter((r) => r.ui.username !== 'Anon');

  console.log('='.repeat(100));
  console.log('V18 BENCHMARK OUTLIER ANALYSIS');
  console.log('='.repeat(100));
  console.log(`Total wallets: ${results.length}\n`);

  // Calculate metrics for each wallet
  const analyzed = results.map((r) => {
    const error_total = r.v18.total_pnl - r.ui.pnl;
    const error_pct_total = r.ui.pnl !== 0 ? Math.abs(error_total) / Math.abs(r.ui.pnl) * 100 : 0;
    const volume_diff = r.v18.volume_traded - r.ui.volume;
    const volume_diff_pct = r.ui.volume !== 0 ? Math.abs(volume_diff) / r.ui.volume * 100 : 0;
    const sign_match = (r.ui.pnl >= 0) === (r.v18.total_pnl >= 0);

    // Categorize the error type
    let error_type = 'unknown';
    if (error_pct_total <= 1) {
      error_type = 'excellent';
    } else if (volume_diff_pct > 20) {
      error_type = 'volume_mismatch';
    } else if (!sign_match) {
      error_type = 'sign_mismatch';
    } else if (Math.abs(r.v18.unrealized_pnl) > 0 && Math.abs(error_total) < Math.abs(r.v18.unrealized_pnl)) {
      error_type = 'unrealized_valuation';
    } else {
      error_type = 'formula_or_resolution';
    }

    return {
      wallet: r.wallet,
      username: r.ui.username,
      ui_pnl: r.ui.pnl,
      v18_realized: r.v18.realized_pnl,
      v18_unrealized: r.v18.unrealized_pnl,
      v18_total: r.v18.total_pnl,
      error_total,
      error_pct_total,
      ui_volume: r.ui.volume,
      v18_volume: r.v18.volume_traded,
      volume_diff,
      volume_diff_pct,
      sign_match,
      positions_count: r.v18.positions_count,
      error_type,
    };
  });

  // Sort by error percentage
  analyzed.sort((a, b) => a.error_pct_total - b.error_pct_total);

  // Categorize
  const good = analyzed.filter((a) => a.error_pct_total <= 5);
  const ok = analyzed.filter((a) => a.error_pct_total > 5 && a.error_pct_total <= 10);
  const bad = analyzed.filter((a) => a.error_pct_total > 10);

  // Print GOOD wallets
  console.log('-'.repeat(100));
  console.log(`GOOD (≤5% error): ${good.length}/${results.length} wallets`);
  console.log('-'.repeat(100));
  console.log('Wallet           | Username     | UI PnL       | V18 Total    | Error $    | Error %  | Type');
  console.log('-'.repeat(100));
  for (const w of good) {
    console.log(
      `${w.wallet.substring(0, 14)}... | ` +
      `${w.username.substring(0, 12).padEnd(12)} | ` +
      `$${w.ui_pnl.toFixed(2).padStart(10)} | ` +
      `$${w.v18_total.toFixed(2).padStart(10)} | ` +
      `$${w.error_total.toFixed(2).padStart(8)} | ` +
      `${w.error_pct_total.toFixed(2).padStart(6)}% | ` +
      `${w.error_type}`
    );
  }

  // Print OK wallets
  console.log('\n' + '-'.repeat(100));
  console.log(`OK (5-10% error): ${ok.length}/${results.length} wallets`);
  console.log('-'.repeat(100));
  if (ok.length > 0) {
    console.log('Wallet           | Username     | UI PnL       | V18 Total    | Error $    | Error %  | Vol Diff % | Type');
    console.log('-'.repeat(100));
    for (const w of ok) {
      console.log(
        `${w.wallet.substring(0, 14)}... | ` +
        `${w.username.substring(0, 12).padEnd(12)} | ` +
        `$${w.ui_pnl.toFixed(2).padStart(10)} | ` +
        `$${w.v18_total.toFixed(2).padStart(10)} | ` +
        `$${w.error_total.toFixed(2).padStart(8)} | ` +
        `${w.error_pct_total.toFixed(2).padStart(6)}% | ` +
        `${w.volume_diff_pct.toFixed(1).padStart(8)}% | ` +
        `${w.error_type}`
      );
    }
  }

  // Print BAD wallets with detailed analysis
  console.log('\n' + '-'.repeat(100));
  console.log(`BAD (>10% error): ${bad.length}/${results.length} wallets - NEEDS INVESTIGATION`);
  console.log('-'.repeat(100));
  if (bad.length > 0) {
    console.log('Wallet           | Username     | UI PnL       | V18 Total    | Error $    | Error %  | Vol Diff % | Type');
    console.log('-'.repeat(100));
    for (const w of bad) {
      const signFlag = w.sign_match ? '' : ' ⚠️ SIGN';
      console.log(
        `${w.wallet.substring(0, 14)}... | ` +
        `${w.username.substring(0, 12).padEnd(12)} | ` +
        `$${w.ui_pnl.toFixed(2).padStart(10)} | ` +
        `$${w.v18_total.toFixed(2).padStart(10)} | ` +
        `$${w.error_total.toFixed(2).padStart(8)} | ` +
        `${w.error_pct_total.toFixed(2).padStart(6)}% | ` +
        `${w.volume_diff_pct.toFixed(1).padStart(8)}% | ` +
        `${w.error_type}${signFlag}`
      );
    }

    // Detailed breakdown for bad wallets
    console.log('\n' + '='.repeat(100));
    console.log('DETAILED ANALYSIS OF BAD WALLETS');
    console.log('='.repeat(100));

    for (const w of bad) {
      console.log(`\n### ${w.username} (${w.wallet})`);
      console.log(`Error Type: ${w.error_type}`);
      console.log(`Sign Match: ${w.sign_match ? 'Yes' : 'NO - MISMATCH'}`);
      console.log(`Positions: ${w.positions_count}`);
      console.log('');
      console.log(`  UI PnL:          $${w.ui_pnl.toFixed(2)}`);
      console.log(`  V18 Realized:    $${w.v18_realized.toFixed(2)}`);
      console.log(`  V18 Unrealized:  $${w.v18_unrealized.toFixed(2)}`);
      console.log(`  V18 Total:       $${w.v18_total.toFixed(2)}`);
      console.log(`  Error:           $${w.error_total.toFixed(2)} (${w.error_pct_total.toFixed(2)}%)`);
      console.log('');
      console.log(`  UI Volume:       $${w.ui_volume.toFixed(2)}`);
      console.log(`  V18 Volume:      $${w.v18_volume.toFixed(2)}`);
      console.log(`  Volume Diff:     $${w.volume_diff.toFixed(2)} (${w.volume_diff_pct.toFixed(1)}%)`);

      // Diagnose
      console.log('');
      console.log('  DIAGNOSIS:');
      if (w.volume_diff_pct > 30) {
        console.log('  → VOLUME GAP: We are missing significant trade volume.');
        console.log('    Likely cause: Trades not marked as maker, or AMM interactions.');
      }
      if (!w.sign_match) {
        console.log('  → SIGN MISMATCH: Our total has different sign than UI.');
        console.log('    Likely cause: Different unrealized valuation or missing positions.');
      }
      if (w.error_type === 'unrealized_valuation') {
        console.log('  → UNREALIZED ISSUE: Error is within unrealized PnL range.');
        console.log('    Likely cause: Different current price for open positions.');
      }
      if (w.error_type === 'formula_or_resolution') {
        console.log('  → FORMULA/RESOLUTION: Volume matches but PnL differs.');
        console.log('    Likely cause: Resolution price mapping, rounding, or edge case.');
      }
    }
  }

  // Summary statistics
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(100));
  console.log(`Good (≤5%):      ${good.length}/${results.length} (${(good.length / results.length * 100).toFixed(1)}%)`);
  console.log(`OK (5-10%):      ${ok.length}/${results.length} (${(ok.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Bad (>10%):      ${bad.length}/${results.length} (${(bad.length / results.length * 100).toFixed(1)}%)`);

  // Error type distribution
  const errorTypes = analyzed.reduce((acc, w) => {
    acc[w.error_type] = (acc[w.error_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\nError Type Distribution:');
  for (const [type, count] of Object.entries(errorTypes)) {
    console.log(`  ${type}: ${count}`);
  }

  // Print wallet addresses for easy copy/paste
  if (bad.length > 0) {
    console.log('\n' + '-'.repeat(100));
    console.log('BAD WALLET ADDRESSES (for investigation):');
    console.log('-'.repeat(100));
    for (const w of bad) {
      console.log(`${w.wallet}  # ${w.username} - ${w.error_pct_total.toFixed(1)}% error`);
    }
  }
}

analyzeOutliers();
