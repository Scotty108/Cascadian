#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * CLASSIFY DOME MISMATCHES
 * ============================================================================
 *
 * Analyze the wallets that don't match Dome and classify the reasons.
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
  splits: number;
  merges: number;
  redemptions: number;
}

interface Classification {
  wallet: string;
  dome: number;
  bestOurs: number;
  bestFormula: string;
  delta: number;
  pctError: number;
  category: string;
  details: string;
}

function main() {
  const file = 'tmp/clob_only_vs_dome_fast.json';
  if (!fs.existsSync(file)) {
    console.error('Run validate-clob-only-vs-dome-fast.ts first');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const clobOnly: Result[] = data.clobOnly || [];

  console.log('');
  console.log('='.repeat(80));
  console.log('CLASSIFYING DOME MISMATCHES');
  console.log('='.repeat(80));
  console.log(`Analyzing ${clobOnly.length} CLOB-only wallets\n`);

  const classifications: Classification[] = [];

  for (const r of clobOnly) {
    const fullDelta = r.v29Full - r.dome;
    const cashDelta = r.v29CashOnly - r.dome;

    // Pick the formula with smallest absolute error
    const useFullFormula = Math.abs(fullDelta) < Math.abs(cashDelta);
    const bestOurs = useFullFormula ? r.v29Full : r.v29CashOnly;
    const bestDelta = useFullFormula ? fullDelta : cashDelta;
    const bestFormula = useFullFormula ? 'V29Full' : 'CashOnly';

    const pctError = (Math.abs(bestDelta) / Math.max(Math.abs(r.dome), 100)) * 100;

    // Classify the mismatch
    let category: string;
    let details: string;

    const absDelta = Math.abs(bestDelta);
    const pass5pct = pctError < 5 || absDelta < 5;
    const pass10usd = absDelta < 10;

    if (pass5pct || pass10usd) {
      category = 'PASS';
      details = absDelta < 1 ? 'Exact match' : `Small delta ($${absDelta.toFixed(0)})`;
    } else if (Math.sign(bestOurs) !== Math.sign(r.dome) && Math.abs(r.dome) > 1000) {
      category = 'SIGN_FLIP';
      details = `Our ${bestOurs >= 0 ? 'positive' : 'negative'}, Dome ${r.dome >= 0 ? 'positive' : 'negative'} - likely data issue`;
    } else if (useFullFormula && Math.abs(r.resolvedUnredeemed) > 5000) {
      category = 'DOME_INCLUDES_RESOLVED';
      details = `Dome seems to include $${r.resolvedUnredeemed.toFixed(0)} resolved value`;
    } else if (!useFullFormula && Math.abs(r.resolvedUnredeemed) > 5000) {
      category = 'DOME_EXCLUDES_RESOLVED';
      details = `Dome excludes our $${r.resolvedUnredeemed.toFixed(0)} resolved value`;
    } else if (absDelta > Math.abs(r.dome) * 0.5) {
      category = 'LARGE_PERCENTAGE_GAP';
      details = `${pctError.toFixed(0)}% error - possible data gap or different event coverage`;
    } else if (r.redemptions > 50) {
      category = 'HIGH_REDEMPTION_COUNT';
      details = `${r.redemptions} redemptions may have different attribution`;
    } else if (Math.abs(r.resolvedUnredeemed) < 100 && absDelta > 100) {
      category = 'CASH_FLOW_DIFFERENCE';
      details = `Different CLOB trades or prices (resolved is minimal)`;
    } else {
      category = 'UNKNOWN';
      details = `Need investigation - ${pctError.toFixed(1)}% error`;
    }

    classifications.push({
      wallet: r.wallet,
      dome: r.dome,
      bestOurs,
      bestFormula,
      delta: bestDelta,
      pctError,
      category,
      details,
    });
  }

  // Count by category
  const categoryCounts: Record<string, number> = {};
  for (const c of classifications) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
  }

  console.log('SUMMARY BY CATEGORY:');
  console.log('-'.repeat(60));
  const sortedCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1]);

  for (const [cat, count] of sortedCategories) {
    const pct = (count / clobOnly.length * 100).toFixed(1);
    console.log(`  ${cat.padEnd(25)} ${count.toString().padStart(3)} (${pct}%)`);
  }

  const passCount = categoryCounts['PASS'] || 0;
  const failCount = clobOnly.length - passCount;
  console.log('');
  console.log(`TOTAL PASS: ${passCount}/${clobOnly.length} (${(passCount/clobOnly.length*100).toFixed(1)}%)`);
  console.log(`TOTAL FAIL: ${failCount}/${clobOnly.length} (${(failCount/clobOnly.length*100).toFixed(1)}%)`);

  // Show all failing wallets grouped by category
  console.log('\n');
  console.log('='.repeat(80));
  console.log('FAILING WALLETS BY CATEGORY');
  console.log('='.repeat(80));

  const failing = classifications.filter(c => c.category !== 'PASS');

  for (const cat of sortedCategories.filter(([c]) => c !== 'PASS')) {
    const catWallets = failing.filter(c => c.category === cat[0]);
    console.log(`\n--- ${cat[0]} (${cat[1]} wallets) ---`);
    console.log('Wallet           | Dome        | Ours        | Delta       | Details');
    console.log('-'.repeat(100));

    for (const c of catWallets) {
      console.log(
        `${c.wallet.slice(0, 15)}... | ${fmt(c.dome)} | ${fmt(c.bestOurs)} | ${fmt(c.delta)} | ${c.details}`
      );
    }
  }

  // Save classification
  fs.writeFileSync('tmp/dome_mismatch_classification.json', JSON.stringify({
    summary: categoryCounts,
    passRate: passCount / clobOnly.length,
    classifications,
  }, null, 2));

  console.log('\n\nClassifications saved to: tmp/dome_mismatch_classification.json');
}

function fmt(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(0).padStart(9)}`;
}

main();
