/**
 * Stage B: Find export-grade wallets from candidate list
 *
 * Runs the PnL engine on candidate wallets until finding enough
 * that pass export gates.
 *
 * Usage:
 *   npx tsx scripts/pnl/find-export-grade-wallets.ts --candidates tmp/candidate_wallets.json --want 50 --concurrency 5
 *
 * Output:
 *   - tmp/export_grade_pass_wallets.json
 *   - tmp/export_grade_pass_wallets.csv
 *   - tmp/export_grade_checkpoint.json (for resumption)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import { computePolymarketPnl, WalletPnlResult } from '../../lib/pnl/polymarketAccurateEngine';

interface CandidateWallet {
  wallet: string;
  trades: number;
  tokens: number;
}

interface ExportGradeResult {
  wallet: string;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positionCount: number;
  skippedSells: number;
  skippedSellsRatio: number;
  clampedTokensRatio: number;
  confidenceScore: number;
  confidenceLevel: string;
  exportEligible: boolean;
  exportReasons: string[];
}

interface Checkpoint {
  processedWallets: string[];
  passedWallets: ExportGradeResult[];
  failedCount: number;
  errorCount: number;
  lastProcessedIndex: number;
}

// Parse command line arguments
const { values } = parseArgs({
  options: {
    candidates: { type: 'string', default: 'tmp/candidate_wallets.json' },
    want: { type: 'string', default: '50' },
    concurrency: { type: 'string', default: '5' },
    resume: { type: 'boolean', default: false },
  },
});

const CANDIDATES_PATH = values.candidates!;
const WANT_COUNT = parseInt(values.want!, 10);
const CONCURRENCY = parseInt(values.concurrency!, 10);
const RESUME = values.resume!;

const CHECKPOINT_PATH = 'tmp/export_grade_checkpoint.json';
const OUTPUT_JSON_PATH = 'tmp/export_grade_pass_wallets.json';
const OUTPUT_CSV_PATH = 'tmp/export_grade_pass_wallets.csv';
const CHECKPOINT_INTERVAL = 100;
const WALLET_TIMEOUT_MS = 60000; // 60 second timeout per wallet

// Timeout helper
function timeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`TIMEOUT: ${message}`)), ms)
  );
}

async function processWallet(wallet: string, tradeHint?: number): Promise<ExportGradeResult | null> {
  const start = Date.now();
  const hint = tradeHint ? ` (${tradeHint} trades)` : '';
  process.stdout.write(`  [${new Date().toISOString().slice(11, 19)}] ${wallet.slice(0, 12)}...${hint} `);

  try {
    const result = await Promise.race([
      computePolymarketPnl(wallet),
      timeout<never>(WALLET_TIMEOUT_MS, `wallet ${wallet.slice(0, 12)}`),
    ]);

    const elapsed = Date.now() - start;
    const totalClobTokens = (result.metadata?.totalClobTokens as number) || 0;
    const skippedSellsRatio = result.tradeCount > 0
      ? result.skippedSells / result.tradeCount
      : 0;
    const clampedTokensRatio = totalClobTokens > 0
      ? result.clampedTokens / totalClobTokens
      : 0;

    const earlyExit = result.metadata?.earlyExit as boolean;

    return {
      wallet,
      totalPnl: result.totalPnl,
      realizedPnl: result.realizedPnl,
      unrealizedPnl: result.unrealizedPnl,
      tradeCount: result.tradeCount,
      positionCount: result.positionCount,
      skippedSells: result.skippedSells,
      skippedSellsRatio,
      clampedTokensRatio,
      confidenceScore: result.confidence?.score ?? 0,
      confidenceLevel: result.confidence?.level ?? 'N/A',
      exportEligible: result.exportGrade?.eligible ?? false,
      exportReasons: result.exportGrade?.reasons ?? [],
    };
  } catch (error) {
    const elapsed = Date.now() - start;
    const msg = error instanceof Error ? error.message : 'Unknown';
    if (msg.includes('TIMEOUT')) {
      console.log(`TIMEOUT (${(elapsed / 1000).toFixed(1)}s)`);
    } else {
      console.log(`ERROR: ${msg.slice(0, 40)}`);
    }
    return null;
  }
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(): Checkpoint | null {
  if (fs.existsSync(CHECKPOINT_PATH)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8'));
  }
  return null;
}

function saveResults(results: ExportGradeResult[]): void {
  // Save JSON
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(results, null, 2));

  // Save CSV
  const headers = [
    'wallet',
    'totalPnl',
    'realizedPnl',
    'unrealizedPnl',
    'tradeCount',
    'positionCount',
    'skippedSells',
    'skippedSellsRatio',
    'clampedTokensRatio',
    'confidenceScore',
    'confidenceLevel',
    'exportEligible',
  ];

  const rows = results.map(r => [
    r.wallet,
    r.totalPnl.toFixed(2),
    r.realizedPnl.toFixed(2),
    r.unrealizedPnl.toFixed(2),
    r.tradeCount,
    r.positionCount,
    r.skippedSells,
    (r.skippedSellsRatio * 100).toFixed(2) + '%',
    (r.clampedTokensRatio * 100).toFixed(2) + '%',
    r.confidenceScore,
    r.confidenceLevel,
    r.exportEligible,
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(OUTPUT_CSV_PATH, csv);
}

interface WalletWithHint {
  wallet: string;
  trades?: number;
}

async function runBatch(wallets: WalletWithHint[]): Promise<(ExportGradeResult | null)[]> {
  const results = await Promise.all(wallets.map(w => processWallet(w.wallet, w.trades)));
  return results;
}

async function main() {
  console.log('=== STAGE B: FIND EXPORT-GRADE WALLETS ===\n');
  console.log(`Candidates file: ${CANDIDATES_PATH}`);
  console.log(`Target: ${WANT_COUNT} export-grade wallets`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Resume mode: ${RESUME}`);
  console.log('');

  // Load candidates
  if (!fs.existsSync(CANDIDATES_PATH)) {
    console.error(`Candidates file not found: ${CANDIDATES_PATH}`);
    console.error('Run generate-candidate-wallets.ts first.');
    process.exit(1);
  }

  const candidates: CandidateWallet[] = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8'));
  console.log(`Loaded ${candidates.length} candidate wallets\n`);

  // Initialize or load checkpoint
  let checkpoint: Checkpoint;
  if (RESUME) {
    const existing = loadCheckpoint();
    if (existing) {
      checkpoint = existing;
      console.log(`Resuming from checkpoint: ${checkpoint.passedWallets.length} passed, ${checkpoint.lastProcessedIndex} processed\n`);
    } else {
      console.log('No checkpoint found, starting fresh.\n');
      checkpoint = {
        processedWallets: [],
        passedWallets: [],
        failedCount: 0,
        errorCount: 0,
        lastProcessedIndex: 0,
      };
    }
  } else {
    checkpoint = {
      processedWallets: [],
      passedWallets: [],
      failedCount: 0,
      errorCount: 0,
      lastProcessedIndex: 0,
    };
  }

  const processedSet = new Set(checkpoint.processedWallets);
  let startIndex = checkpoint.lastProcessedIndex;
  let passed = checkpoint.passedWallets.length;
  let failed = checkpoint.failedCount;
  let errors = checkpoint.errorCount;
  let processed = checkpoint.processedWallets.length;

  console.log('Processing wallets...\n');
  const startTime = Date.now();

  // Process in batches
  while (passed < WANT_COUNT && startIndex < candidates.length) {
    // Get next batch of unprocessed wallets with trade hints
    const batch: WalletWithHint[] = [];
    for (let i = startIndex; i < candidates.length && batch.length < CONCURRENCY; i++) {
      const c = candidates[i];
      const wallet = c.wallet;
      if (!processedSet.has(wallet)) {
        batch.push({ wallet, trades: c.trades });
      }
      startIndex = i + 1;
    }

    if (batch.length === 0) break;

    // Process batch
    const results = await runBatch(batch);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const wallet = batch[i].wallet;

      processedSet.add(wallet);
      checkpoint.processedWallets.push(wallet);
      processed++;

      if (result === null) {
        errors++;
        checkpoint.errorCount = errors;
        // Logged in processWallet already
      } else if (result.exportEligible) {
        passed++;
        checkpoint.passedWallets.push(result);
        console.log(`PASS #${passed} | PnL: $${result.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} | Conf: ${result.confidenceScore}`);
      } else {
        failed++;
        checkpoint.failedCount = failed;
        const reason = result.exportReasons[0] || 'unknown';
        console.log(`FAIL: ${reason.slice(0, 40)}`);
      }
    }

    checkpoint.lastProcessedIndex = startIndex;

    // Checkpoint every N wallets
    if (processed % CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint(checkpoint);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      console.log(`\n  [Checkpoint] ${processed} processed, ${passed} passed, ${failed} failed, ${errors} errors | ${rate} wallets/sec\n`);
    }

    // Early exit if we have enough
    if (passed >= WANT_COUNT) {
      console.log(`\nReached target of ${WANT_COUNT} export-grade wallets!`);
      break;
    }
  }

  // Final save
  saveCheckpoint(checkpoint);
  saveResults(checkpoint.passedWallets);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log('='.repeat(80));
  console.log(`Total processed: ${processed}`);
  console.log(`Export-grade (PASS): ${passed}`);
  console.log(`Failed gates: ${failed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`Time: ${elapsed}s`);
  console.log('');
  console.log(`Output files:`);
  console.log(`  JSON: ${OUTPUT_JSON_PATH}`);
  console.log(`  CSV: ${OUTPUT_CSV_PATH}`);
  console.log(`  Checkpoint: ${CHECKPOINT_PATH}`);

  if (passed > 0) {
    console.log('\nTop 10 export-grade wallets by PnL:');
    const sorted = [...checkpoint.passedWallets].sort((a, b) => b.totalPnl - a.totalPnl);
    console.log('Wallet'.padEnd(44) + 'PnL'.padEnd(15) + 'Trades'.padEnd(10) + 'Confidence');
    console.log('-'.repeat(80));
    for (const r of sorted.slice(0, 10)) {
      console.log(
        r.wallet.padEnd(44) +
        ('$' + r.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })).padEnd(15) +
        r.tradeCount.toLocaleString().padEnd(10) +
        `${r.confidenceScore} (${r.confidenceLevel})`
      );
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(console.error);
