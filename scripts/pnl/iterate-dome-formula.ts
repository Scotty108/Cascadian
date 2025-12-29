#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * ITERATE DOME FORMULA - QUICK TESTING
 * ============================================================================
 *
 * Test different formula combinations against Dome to find optimal match.
 * Uses cached results from validate-clob-only-vs-dome-fast.ts.
 *
 * Terminal: Claude 2
 * Date: 2025-12-07
 */

import fs from 'fs';

interface Result {
  wallet: string;
  dome: number;
  v29Full: number;
  v29CashOnly: number;
  resolvedUnredeemed: number;
  isClobOnly: boolean;
  redemptions: number;
}

function main() {
  const file = 'tmp/clob_only_vs_dome_fast.json';
  if (!fs.existsSync(file)) {
    console.error('Run validate-clob-only-vs-dome-fast.ts first');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const results: Result[] = data.clobOnly;

  console.log('');
  console.log('='.repeat(80));
  console.log('DOME FORMULA ITERATION - CLOB-ONLY WALLETS');
  console.log('='.repeat(80));
  console.log(`Testing ${results.length} wallets\n`);

  // Test: Pick the formula that gets closest for each wallet
  const analysis = results.map(r => {
    const fullDelta = Math.abs(r.v29Full - r.dome);
    const cashDelta = Math.abs(r.v29CashOnly - r.dome);

    const bestFormula = fullDelta < cashDelta ? 'V29Full' : 'CashOnly';
    const bestDelta = Math.min(fullDelta, cashDelta);
    const bestValue = fullDelta < cashDelta ? r.v29Full : r.v29CashOnly;

    // Key insight: When resolvedUnredeemed is positive, V29Full is better
    // When resolvedUnredeemed is negative, CashOnly is better
    const resolvedSign = r.resolvedUnredeemed >= 0 ? 'positive' : 'negative';

    return {
      wallet: r.wallet,
      dome: r.dome,
      v29Full: r.v29Full,
      cashOnly: r.v29CashOnly,
      resolved: r.resolvedUnredeemed,
      resolvedSign,
      fullDelta,
      cashDelta,
      bestFormula,
      bestDelta,
      bestValue,
      redemptions: r.redemptions,
    };
  });

  // Group by which formula is better
  const fullBetter = analysis.filter(a => a.bestFormula === 'V29Full');
  const cashBetter = analysis.filter(a => a.bestFormula === 'CashOnly');

  console.log(`V29 Full is better: ${fullBetter.length} wallets`);
  console.log(`Cash-Only is better: ${cashBetter.length} wallets`);

  // Check hypothesis: Is sign of resolvedUnredeemed predictive?
  console.log('\n--- Pattern Analysis ---');

  const positiveResolved = analysis.filter(a => a.resolvedSign === 'positive');
  const negativeResolved = analysis.filter(a => a.resolvedSign === 'negative');

  console.log(`\nResolved Unredeemed is POSITIVE (${positiveResolved.length} wallets):`);
  const posBetterFull = positiveResolved.filter(a => a.bestFormula === 'V29Full').length;
  console.log(`  V29Full better: ${posBetterFull}/${positiveResolved.length}`);
  console.log(`  CashOnly better: ${positiveResolved.length - posBetterFull}/${positiveResolved.length}`);

  console.log(`\nResolved Unredeemed is NEGATIVE (${negativeResolved.length} wallets):`);
  const negBetterFull = negativeResolved.filter(a => a.bestFormula === 'V29Full').length;
  console.log(`  V29Full better: ${negBetterFull}/${negativeResolved.length}`);
  console.log(`  CashOnly better: ${negativeResolved.length - negBetterFull}/${negativeResolved.length}`);

  // Show the wallets where V29Full is better
  console.log('\n--- Wallets where V29 Full is BETTER than Cash-Only ---');
  console.log('Wallet           | Dome        | V29Full     | CashOnly    | Resolved    | Best');
  console.log('-'.repeat(100));
  for (const a of fullBetter) {
    console.log(
      `${a.wallet.slice(0, 15)}... | ${fmt(a.dome)} | ${fmt(a.v29Full)} | ${fmt(a.cashOnly)} | ${fmt(a.resolved)} | V29Full (Δ=${Math.round(a.fullDelta)})`
    );
  }

  // Optimal hybrid formula: use V29Full when resolved >= 0, CashOnly otherwise
  console.log('\n--- Hybrid Formula Test ---');
  console.log('Formula: Use V29Full when resolvedUnredeemed >= 0, otherwise CashOnly\n');

  let hybridPass5 = 0;
  let hybridPass10 = 0;
  const hybridErrors: number[] = [];

  for (const a of analysis) {
    const hybrid = a.resolved >= 0 ? a.v29Full : a.cashOnly;
    const delta = Math.abs(hybrid - a.dome);
    const pct = (delta / Math.max(Math.abs(a.dome), 100)) * 100;

    hybridErrors.push(delta);
    if (pct < 5 || delta < 5) hybridPass5++;
    if (delta < 10) hybridPass10++;
  }

  const sortedErrors = [...hybridErrors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

  console.log(`Hybrid Formula Results:`);
  console.log(`  Pass <5%:   ${hybridPass5}/${analysis.length} (${(hybridPass5/analysis.length*100).toFixed(1)}%)`);
  console.log(`  Pass <$10:  ${hybridPass10}/${analysis.length} (${(hybridPass10/analysis.length*100).toFixed(1)}%)`);
  console.log(`  Median Error: $${medianError.toFixed(2)}`);

  // Best-pick formula
  console.log('\n--- Best-Pick Formula (Oracle) ---');
  console.log('Always picking the closer value for each wallet:\n');

  let bestPass5 = 0;
  let bestPass10 = 0;
  const bestErrors: number[] = [];

  for (const a of analysis) {
    const delta = a.bestDelta;
    const pct = (delta / Math.max(Math.abs(a.dome), 100)) * 100;

    bestErrors.push(delta);
    if (pct < 5 || delta < 5) bestPass5++;
    if (delta < 10) bestPass10++;
  }

  const sortedBest = [...bestErrors].sort((a, b) => a - b);
  const medianBest = sortedBest[Math.floor(sortedBest.length / 2)];

  console.log(`Best-Pick (Oracle) Results:`);
  console.log(`  Pass <5%:   ${bestPass5}/${analysis.length} (${(bestPass5/analysis.length*100).toFixed(1)}%)`);
  console.log(`  Pass <$10:  ${bestPass10}/${analysis.length} (${(bestPass10/analysis.length*100).toFixed(1)}%)`);
  console.log(`  Median Error: $${medianBest.toFixed(2)}`);

  // Summary
  console.log('\n='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`
| Formula      | Pass <5% | Pass <$10 | Median $ |
|--------------|----------|-----------|----------|
| V29 Full     | 40.0%    | 25.0%     | $4,195   |
| Cash-Only    | 50.0%    | 50.0%     | $153     |
| Hybrid       | ${(hybridPass5/analysis.length*100).toFixed(1)}%    | ${(hybridPass10/analysis.length*100).toFixed(1)}%     | $${medianError.toFixed(0).padStart(5)}   |
| Best-Pick    | ${(bestPass5/analysis.length*100).toFixed(1)}%    | ${(bestPass10/analysis.length*100).toFixed(1)}%     | $${medianBest.toFixed(0).padStart(5)}   |
  `);

  // Deeper analysis: Look for patterns in V29Full-better wallets
  console.log('\n--- Deeper Pattern Analysis ---');
  console.log('\nWallets where V29Full is better:');

  for (const a of fullBetter) {
    // Calculate what factor makes V29Full match
    // V29Full = CashOnly + resolvedUnredeemed
    // If V29Full matches Dome, it means Dome = CashOnly + resolvedUnredeemed
    // So Dome includes the resolvedUnredeemed value
    const domeDiff = a.dome - a.cashOnly;
    const matchesResolved = Math.abs(domeDiff - a.resolved) < Math.abs(a.dome) * 0.1;

    console.log(`  ${a.wallet.slice(0,15)}...`);
    console.log(`    Dome: ${a.dome.toFixed(0)}, CashOnly: ${a.cashOnly.toFixed(0)}, Resolved: ${a.resolved.toFixed(0)}`);
    console.log(`    Dome - CashOnly = ${domeDiff.toFixed(0)} (should ≈ Resolved if V29Full matches)`);
    console.log(`    Redemptions: ${a.redemptions}`);
    console.log('');
  }

  // Check if V29Full-better wallets have specific characteristics
  const fullBetterRedemptions = fullBetter.map(a => a.redemptions);
  const cashBetterRedemptions = cashBetter.map(a => a.redemptions);

  console.log('Redemption counts:');
  console.log(`  V29Full-better wallets: avg ${(fullBetterRedemptions.reduce((a,b)=>a+b,0)/fullBetterRedemptions.length).toFixed(0)} redemptions`);
  console.log(`  CashOnly-better wallets: avg ${(cashBetterRedemptions.reduce((a,b)=>a+b,0)/cashBetterRedemptions.length).toFixed(0)} redemptions`);

  // Check resolved magnitude
  const fullBetterResolved = fullBetter.map(a => Math.abs(a.resolved));
  const cashBetterResolved = cashBetter.map(a => Math.abs(a.resolved));

  console.log('\nAbsolute resolved unredeemed value:');
  console.log(`  V29Full-better wallets: avg $${(fullBetterResolved.reduce((a,b)=>a+b,0)/fullBetterResolved.length).toFixed(0)}`);
  console.log(`  CashOnly-better wallets: avg $${(cashBetterResolved.reduce((a,b)=>a+b,0)/cashBetterResolved.length).toFixed(0)}`);

  // Key insight: Check if Dome actually includes resolved unredeemed for some wallets
  console.log('\n--- KEY INSIGHT CHECK ---');
  console.log('Does Dome include resolvedUnredeemed for some wallets?');
  console.log('If V29Full matches, then Dome = CashOnly + resolvedUnredeemed');
  console.log('');

  let domeIncludesResolved = 0;
  let domeExcludesResolved = 0;

  for (const a of analysis) {
    const fullDiff = Math.abs(a.v29Full - a.dome);
    const cashDiff = Math.abs(a.cashOnly - a.dome);

    if (fullDiff < cashDiff && fullDiff < 100) {
      domeIncludesResolved++;
    } else if (cashDiff < fullDiff && cashDiff < 100) {
      domeExcludesResolved++;
    }
  }

  console.log(`Dome appears to INCLUDE resolved unredeemed: ${domeIncludesResolved} wallets`);
  console.log(`Dome appears to EXCLUDE resolved unredeemed: ${domeExcludesResolved} wallets`);
  console.log('');
  console.log('This suggests Dome has VARIABLE behavior!');

  // Additional hypothesis: Maybe Dome counts resolved unredeemed only for certain outcome types
  // Or maybe V29 is counting something differently
  console.log('\n--- CHECK: Is resolvedUnredeemed ≈ 0 for CashOnly-better wallets? ---');

  for (const a of cashBetter.slice(0, 5)) {
    console.log(`  ${a.wallet.slice(0,15)}...`);
    console.log(`    Dome: ${a.dome.toFixed(0)}, CashOnly: ${a.cashOnly.toFixed(0)}, V29Full: ${a.v29Full.toFixed(0)}`);
    console.log(`    Resolved: ${a.resolved.toFixed(0)}`);
    console.log(`    Delta to Dome: CashOnly=${Math.abs(a.cashOnly - a.dome).toFixed(0)}, V29Full=${Math.abs(a.v29Full - a.dome).toFixed(0)}`);
    console.log('');
  }

  // Look for a threshold
  console.log('--- THRESHOLD ANALYSIS ---');
  console.log('Checking if resolved unredeemed threshold affects behavior...\n');

  const thresholds = [100, 500, 1000, 5000, 10000];
  for (const thresh of thresholds) {
    const smallResolved = analysis.filter(a => Math.abs(a.resolved) < thresh);
    const largeResolved = analysis.filter(a => Math.abs(a.resolved) >= thresh);

    const smallCashBetter = smallResolved.filter(a => a.bestFormula === 'CashOnly').length;
    const largeCashBetter = largeResolved.filter(a => a.bestFormula === 'CashOnly').length;

    console.log(`Threshold $${thresh}:`);
    console.log(`  |Resolved| < $${thresh}: ${smallCashBetter}/${smallResolved.length} CashOnly-better (${(smallCashBetter/smallResolved.length*100).toFixed(0)}%)`);
    console.log(`  |Resolved| >= $${thresh}: ${largeCashBetter}/${largeResolved.length} CashOnly-better (${largeResolved.length > 0 ? (largeCashBetter/largeResolved.length*100).toFixed(0) : 'N/A'}%)`);
    console.log('');
  }
}

function fmt(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(0).padStart(9)}`;
}

main();
