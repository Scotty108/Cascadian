#!/usr/bin/env npx tsx
/**
 * Analyze V29 vs Dome validation results by magnitude bucket
 */
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('tmp/v29_vs_dome_500_full_validation.json', 'utf8'));
const rows = data.rows.filter((r: { confidence: string }) => r.confidence === 'high');

interface Row {
  wallet: string;
  v29_realized: number;
  dome_realized: number;
  abs_error_usd: number;
  pct_error_safe: number;
  confidence: string;
}

interface Bucket {
  rows: Row[];
  passCount: number;
}

// Define magnitude buckets based on Dome realized (absolute value)
const buckets: Record<string, Bucket> = {
  'small (<$1K)': { rows: [], passCount: 0 },
  'medium ($1K-$10K)': { rows: [], passCount: 0 },
  'large ($10K-$100K)': { rows: [], passCount: 0 },
  'whale ($100K+)': { rows: [], passCount: 0 },
};

for (const r of rows as Row[]) {
  const absDome = Math.abs(r.dome_realized);
  let bucket: string;
  if (absDome < 1000) bucket = 'small (<$1K)';
  else if (absDome < 10000) bucket = 'medium ($1K-$10K)';
  else if (absDome < 100000) bucket = 'large ($10K-$100K)';
  else bucket = 'whale ($100K+)';

  buckets[bucket].rows.push(r);
  // Pass = <6% error
  if (r.pct_error_safe < 6) {
    buckets[bucket].passCount++;
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('   V29 vs DOME REALIZED - ANALYSIS BY MAGNITUDE BUCKET');
console.log('════════════════════════════════════════════════════════════\n');

for (const [name, b] of Object.entries(buckets)) {
  const count = b.rows.length;
  const passRate = count > 0 ? (b.passCount / count * 100).toFixed(1) : 'N/A';
  const medianError = count > 0
    ? b.rows.map((r) => r.abs_error_usd).sort((a, b) => a - b)[Math.floor(count / 2)]
    : 0;
  const medianPct = count > 0
    ? b.rows.map((r) => r.pct_error_safe).sort((a, b) => a - b)[Math.floor(count / 2)]
    : 0;

  console.log(`${name.padEnd(22)} Count: ${String(count).padStart(3)} | Pass<6%: ${String(b.passCount).padStart(3)} (${passRate}%) | Median Err: $${medianError.toFixed(0).padStart(7)} | Median Pct: ${medianPct.toFixed(1)}%`);
}

// Also show exact match analysis
const exactMatches = (rows as Row[]).filter((r) => r.abs_error_usd < 1);
const nearMatches = (rows as Row[]).filter((r) => r.abs_error_usd < 10);
const closeMatches = (rows as Row[]).filter((r) => r.abs_error_usd < 100);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('   ABSOLUTE ERROR TIERS');
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`Exact match (<$1):     ${exactMatches.length}/${rows.length} (${(exactMatches.length/rows.length*100).toFixed(1)}%)`);
console.log(`Near match (<$10):     ${nearMatches.length}/${rows.length} (${(nearMatches.length/rows.length*100).toFixed(1)}%)`);
console.log(`Close match (<$100):   ${closeMatches.length}/${rows.length} (${(closeMatches.length/rows.length*100).toFixed(1)}%)`);

// Show sign disagreement analysis
const signDisagree = (rows as Row[]).filter((r) =>
  (r.v29_realized > 0 && r.dome_realized < 0) ||
  (r.v29_realized < 0 && r.dome_realized > 0)
);

console.log(`\nSign disagreement:     ${signDisagree.length}/${rows.length} (${(signDisagree.length/rows.length*100).toFixed(1)}%) - V29 & Dome opposite signs`);

// Top 5 exact matches
console.log('\n═══════════════════════════════════════════════════════════');
console.log('   TOP 5 EXACT MATCHES (proof V29 can work)');
console.log('═══════════════════════════════════════════════════════════\n');
const sorted = [...(rows as Row[])].sort((a, b) => a.abs_error_usd - b.abs_error_usd);
for (let i = 0; i < 5 && i < sorted.length; i++) {
  const r = sorted[i];
  console.log(`${r.wallet} | V29: $${r.v29_realized.toFixed(2).padStart(10)} | Dome: $${r.dome_realized.toFixed(2).padStart(10)} | Err: $${r.abs_error_usd.toFixed(2)}`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('   WORST 5 SIGN DISAGREEMENTS');
console.log('═══════════════════════════════════════════════════════════\n');
const worstSign = signDisagree.sort((a, b) => b.abs_error_usd - a.abs_error_usd);
for (let i = 0; i < 5 && i < worstSign.length; i++) {
  const r = worstSign[i];
  console.log(`${r.wallet} | V29: $${r.v29_realized.toFixed(2).padStart(12)} | Dome: $${r.dome_realized.toFixed(2).padStart(12)} | Err: $${r.abs_error_usd.toFixed(0)}`);
}

console.log('\n');
