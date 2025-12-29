#!/usr/bin/env npx tsx
/**
 * Build CLOB-Only Truth Queue
 *
 * Merges candidate sources and removes wallets already in truth dataset.
 * Outputs a prioritized queue for scraping.
 *
 * Inputs:
 * - tmp/clob_only_candidates_prefilter_3k.json (primary)
 * - tmp/clob_only_candidates_fast.json (existing, if any)
 *
 * Output:
 * - tmp/clob_only_truth_queue_100.json (deduped, sorted by priority)
 */

import * as fs from 'fs';
import * as path from 'path';

const PREFILTER_PATH = path.join(process.cwd(), 'tmp/clob_only_candidates_prefilter_3k.json');
const FAST_PATH = path.join(process.cwd(), 'tmp/clob_only_candidates_fast.json');
const TRUTH_PATH = path.join(process.cwd(), 'data/regression/clob_only_truth_v1.json');
const OUTPUT_PATH = path.join(process.cwd(), 'tmp/clob_only_truth_queue_100.json');

interface Candidate {
  wallet: string;
  clob_events: number;
  condition_count?: number;
  cash_flow: number;
  open_positions_approx?: number;
  priority_score?: number;
  clobEvents?: number;  // Alternative field name from fast.json
  cashFlow?: number;    // Alternative field name
  openPositionsApprox?: number;
}

interface TruthWallet {
  wallet: string;
  uiPnl: number;
}

interface TruthDataset {
  wallets: TruthWallet[];
}

function loadCandidates(filePath: string): Candidate[] {
  if (!fs.existsSync(filePath)) {
    console.log(`  [SKIP] ${path.basename(filePath)} not found`);
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Handle different formats
  if (data.candidates) {
    console.log(`  [LOAD] ${path.basename(filePath)}: ${data.candidates.length} candidates`);
    return data.candidates;
  } else if (Array.isArray(data)) {
    console.log(`  [LOAD] ${path.basename(filePath)}: ${data.length} candidates`);
    return data;
  }

  return [];
}

function loadTruthWallets(): Set<string> {
  if (!fs.existsSync(TRUTH_PATH)) {
    console.log('  [WARN] Truth file not found, starting fresh');
    return new Set();
  }

  const data: TruthDataset = JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf-8'));
  const wallets = new Set(data.wallets.map(w => w.wallet.toLowerCase()));
  console.log(`  [LOAD] Truth dataset: ${wallets.size} wallets already scraped`);
  return wallets;
}

function normalizeCandidate(c: Candidate): {
  wallet: string;
  clob_events: number;
  cash_flow: number;
  open_positions_approx: number;
  priority_score: number;
} {
  const clobEvents = c.clob_events || c.clobEvents || 0;
  const cashFlow = c.cash_flow || c.cashFlow || 0;
  const openPos = c.open_positions_approx || c.openPositionsApprox || 0;

  // Recalculate priority if missing
  let priorityScore = c.priority_score || 0;
  if (!priorityScore) {
    let positionBonus = 0;
    if (openPos >= 5 && openPos <= 30) {
      positionBonus = 500;
    } else if (openPos >= 1 && openPos <= 50) {
      positionBonus = 200;
    }
    priorityScore = clobEvents * 10 + positionBonus + Math.min(Math.abs(cashFlow) / 100, 1000);
  }

  return {
    wallet: c.wallet.toLowerCase(),
    clob_events: clobEvents,
    cash_flow: cashFlow,
    open_positions_approx: openPos,
    priority_score: priorityScore,
  };
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BUILD CLOB-ONLY TRUTH QUEUE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Loading candidate sources...');

  // Load candidates from multiple sources
  const prefilterCandidates = loadCandidates(PREFILTER_PATH);
  const fastCandidates = loadCandidates(FAST_PATH);

  // Load already-scraped wallets
  const truthWallets = loadTruthWallets();
  const walletsNeeded = 100 - truthWallets.size;

  console.log(`\n  Target: 100 wallets`);
  console.log(`  Already scraped: ${truthWallets.size}`);
  console.log(`  Need to scrape: ${walletsNeeded}\n`);

  // Merge and dedupe
  const walletMap = new Map<string, ReturnType<typeof normalizeCandidate>>();

  // Add prefilter candidates first (they have priority scores)
  for (const c of prefilterCandidates) {
    const normalized = normalizeCandidate(c);
    if (!truthWallets.has(normalized.wallet)) {
      walletMap.set(normalized.wallet, normalized);
    }
  }

  // Add fast candidates (don't overwrite if already have better data)
  for (const c of fastCandidates) {
    const normalized = normalizeCandidate(c);
    if (!truthWallets.has(normalized.wallet) && !walletMap.has(normalized.wallet)) {
      walletMap.set(normalized.wallet, normalized);
    }
  }

  console.log(`  Merged unique candidates: ${walletMap.size}`);
  console.log(`  Removed (already in truth): ${prefilterCandidates.length + fastCandidates.length - walletMap.size}`);

  // Sort by priority score
  const queue = Array.from(walletMap.values())
    .sort((a, b) => b.priority_score - a.priority_score);

  // Preview
  console.log('\n  Top 20 in queue:');
  queue.slice(0, 20).forEach((c, i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. ${c.wallet.slice(0, 12)}... score:${c.priority_score.toFixed(0).padStart(5)} clob:${c.clob_events.toString().padStart(4)} cash:$${c.cash_flow.toFixed(0).padStart(8)}`);
  });

  // Save
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      total_candidates: queue.length,
      wallets_already_in_truth: truthWallets.size,
      wallets_needed: walletsNeeded,
      sources: [
        { file: 'clob_only_candidates_prefilter_3k.json', count: prefilterCandidates.length },
        { file: 'clob_only_candidates_fast.json', count: fastCandidates.length },
      ],
    },
    queue,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✓ Saved ${queue.length} candidates to ${OUTPUT_PATH}`);
  console.log(`  Ready to scrape ${Math.min(walletsNeeded, queue.length)} wallets to reach 100 total`);
}

main();
