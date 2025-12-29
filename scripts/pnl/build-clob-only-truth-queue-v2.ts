#!/usr/bin/env npx tsx
/**
 * Build CLOB-Only Truth Queue V2 - Mixed A/B/C Interleaved
 *
 * Creates a balanced queue using 3 buckets to avoid biased sampling:
 * - Bucket A: highest |cashFlowEstimate| (likely high PnL)
 * - Bucket B: highest clobEvents (high activity)
 * - Bucket C: random sample (diversity)
 *
 * Interleave pattern: A1, B1, C1, A2, B2, C2...
 *
 * Output:
 * - tmp/clob_only_truth_queue_100_v2.json
 */

import * as fs from 'fs';
import * as path from 'path';

const PREFILTER_PATH = path.join(process.cwd(), 'tmp/clob_only_candidates_prefilter_3k.json');
const TRUTH_PATH = path.join(process.cwd(), 'data/regression/clob_only_truth_v1.json');
const OUTPUT_PATH = path.join(process.cwd(), 'tmp/clob_only_truth_queue_100_v2.json');

interface Candidate {
  wallet: string;
  clob_events: number;
  condition_count?: number;
  cash_flow: number;
  open_positions_approx?: number;
  priority_score?: number;
}

interface NormalizedCandidate {
  wallet: string;
  clobEvents: number;
  cashFlowEstimate: number;
  openPositionsApprox: number;
  bucketTag: 'A' | 'B' | 'C';
}

interface TruthDataset {
  wallets: { wallet: string }[];
}

function loadCandidates(): Candidate[] {
  if (!fs.existsSync(PREFILTER_PATH)) {
    console.error(`Prefilter file not found: ${PREFILTER_PATH}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(PREFILTER_PATH, 'utf-8'));
  return data.candidates || [];
}

function loadTruthWallets(): Set<string> {
  if (!fs.existsSync(TRUTH_PATH)) {
    return new Set();
  }

  const data: TruthDataset = JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf-8'));
  return new Set(data.wallets.map(w => w.wallet.toLowerCase()));
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BUILD CLOB-ONLY TRUTH QUEUE V2 (A/B/C Interleaved)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load candidates
  const allCandidates = loadCandidates();
  console.log(`  Loaded ${allCandidates.length} candidates from prefilter`);

  // Load already-scraped wallets
  const truthWallets = loadTruthWallets();
  console.log(`  Already scraped: ${truthWallets.size} wallets`);
  console.log(`  Need: ${100 - truthWallets.size} more wallets\n`);

  // Filter out already-scraped
  const available = allCandidates.filter(c => !truthWallets.has(c.wallet.toLowerCase()));
  console.log(`  Available candidates: ${available.length}`);

  // Create 3 sorted lists
  const byCashFlow = [...available].sort((a, b) => Math.abs(b.cash_flow) - Math.abs(a.cash_flow));
  const byClobEvents = [...available].sort((a, b) => b.clob_events - a.clob_events);

  // Shuffle for random bucket (Fisher-Yates)
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Track which wallets have been assigned
  const assigned = new Set<string>();
  const queue: NormalizedCandidate[] = [];

  // Target: ~35 from each bucket for 100 total (with buffer for skips)
  const bucketSize = 50; // Extra buffer since some may be skipped at scrape time

  // Build Bucket A (highest |cashFlow|)
  const bucketA: NormalizedCandidate[] = [];
  for (const c of byCashFlow) {
    if (bucketA.length >= bucketSize) break;
    if (assigned.has(c.wallet.toLowerCase())) continue;

    bucketA.push({
      wallet: c.wallet.toLowerCase(),
      clobEvents: c.clob_events,
      cashFlowEstimate: c.cash_flow,
      openPositionsApprox: c.open_positions_approx || 0,
      bucketTag: 'A',
    });
    assigned.add(c.wallet.toLowerCase());
  }

  // Build Bucket B (highest clobEvents)
  const bucketB: NormalizedCandidate[] = [];
  for (const c of byClobEvents) {
    if (bucketB.length >= bucketSize) break;
    if (assigned.has(c.wallet.toLowerCase())) continue;

    bucketB.push({
      wallet: c.wallet.toLowerCase(),
      clobEvents: c.clob_events,
      cashFlowEstimate: c.cash_flow,
      openPositionsApprox: c.open_positions_approx || 0,
      bucketTag: 'B',
    });
    assigned.add(c.wallet.toLowerCase());
  }

  // Build Bucket C (random)
  const bucketC: NormalizedCandidate[] = [];
  for (const c of shuffled) {
    if (bucketC.length >= bucketSize) break;
    if (assigned.has(c.wallet.toLowerCase())) continue;

    bucketC.push({
      wallet: c.wallet.toLowerCase(),
      clobEvents: c.clob_events,
      cashFlowEstimate: c.cash_flow,
      openPositionsApprox: c.open_positions_approx || 0,
      bucketTag: 'C',
    });
    assigned.add(c.wallet.toLowerCase());
  }

  console.log(`\n  Bucket A (high |cashFlow|): ${bucketA.length} wallets`);
  console.log(`  Bucket B (high clobEvents): ${bucketB.length} wallets`);
  console.log(`  Bucket C (random sample):   ${bucketC.length} wallets`);

  // Interleave: A1, B1, C1, A2, B2, C2...
  const maxLen = Math.max(bucketA.length, bucketB.length, bucketC.length);
  for (let i = 0; i < maxLen; i++) {
    if (bucketA[i]) queue.push(bucketA[i]);
    if (bucketB[i]) queue.push(bucketB[i]);
    if (bucketC[i]) queue.push(bucketC[i]);
  }

  console.log(`\n  Interleaved queue: ${queue.length} wallets total`);

  // Preview first 15
  console.log('\n  First 15 in queue:');
  queue.slice(0, 15).forEach((c, i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. [${c.bucketTag}] ${c.wallet.slice(0, 12)}... clob:${c.clobEvents.toString().padStart(4)} cash:$${c.cashFlowEstimate.toFixed(0).padStart(10)}`);
  });

  // Stats by bucket
  const bucketStats = {
    A: { count: bucketA.length, avgCash: bucketA.reduce((s, c) => s + Math.abs(c.cashFlowEstimate), 0) / bucketA.length },
    B: { count: bucketB.length, avgClob: bucketB.reduce((s, c) => s + c.clobEvents, 0) / bucketB.length },
    C: { count: bucketC.length },
  };

  console.log('\n  Bucket stats:');
  console.log(`    A: avg |cashFlow| = $${bucketStats.A.avgCash.toFixed(0)}`);
  console.log(`    B: avg clobEvents = ${bucketStats.B.avgClob.toFixed(0)}`);
  console.log(`    C: random diversity sample`);

  // Save
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      strategy: 'A/B/C interleaved buckets',
      bucket_descriptions: {
        A: 'highest |cashFlowEstimate| - likely high PnL',
        B: 'highest clobEvents - high activity',
        C: 'random sample - diversity',
      },
      total_candidates: queue.length,
      wallets_already_in_truth: truthWallets.size,
      wallets_needed: 100 - truthWallets.size,
      bucket_sizes: {
        A: bucketA.length,
        B: bucketB.length,
        C: bucketC.length,
      },
    },
    queue,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✓ Saved ${queue.length} candidates to ${OUTPUT_PATH}`);
}

main();
