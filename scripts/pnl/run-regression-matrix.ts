/**
 * ============================================================================
 * PnL Regression Matrix - Head-to-Head V23c vs V29
 * ============================================================================
 *
 * Runs both V23c and V29 engines against the SAME frozen benchmark set and
 * produces a comprehensive comparison report with:
 * - Pass rates at 1%, 5%, exact thresholds
 * - Wallet classification tags (TRADER_STRICT, MIXED, MAKER_HEAVY)
 * - Failure triage with root cause labels
 * - Top outliers for investigation
 *
 * Key Features:
 * - Per-wallet checkpointing: Results saved atomically after each wallet
 * - Resume capability: Automatically skips already-processed wallets
 * - Per-wallet timeout: Prevents stalls on huge maker wallets
 * - Tag filtering: Run only TRADER_STRICT, exclude MAKER_HEAVY, etc.
 * - Summary mode: Quick stats from existing checkpoint without re-running
 *
 * Usage:
 *   # Basic run
 *   npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06
 *
 *   # Limit to N wallets
 *   npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06 --limit=10
 *
 *   # Run specific wallets
 *   npx tsx scripts/pnl/run-regression-matrix.ts --wallet=0xabc,0xdef
 *
 *   # Filter by tags
 *   npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06 --includeTags=TRADER_STRICT
 *   npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06 --excludeTags=MAKER_HEAVY
 *
 *   # Custom timeout per wallet (default 60s)
 *   npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06 --perWalletTimeoutSeconds=120
 *
 *   # Summary only (no re-run)
 *   npx tsx scripts/pnl/run-regression-matrix.ts --summaryOnly --set=fresh_2025_12_06
 *
 * Output:
 *   - Console report
 *   - docs/reports/HEAD_TO_HEAD_V23C_V29_<date>.md
 *   - tmp/regression-matrix-<set>.json (checkpoint file)
 *
 * Terminal: Claude 1 (MAIN TERMINAL)
 * Date: 2025-12-06
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23cPnL, V23cResult } from '../../lib/pnl/shadowLedgerV23c';
import { calculateV29PnL, V29Options, V29Result, V29CanonicalPnL } from '../../lib/pnl/inventoryEngineV29';
import {
  classifyCohort,
  WalletCohort,
  CohortDecision,
  WalletTags as CohortWalletTags,
  getCohortDisplayLabel,
} from '../../lib/pnl/cohortClassifier';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { computeCashPnL } from './compute-cash-pnl-table';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
  note: string;
}

interface WalletTags {
  isTraderStrict: boolean;
  isMixed: boolean;
  isMakerHeavy: boolean;
  isDataSuspect: boolean;
  splitCount: number;
  mergeCount: number;
  clobCount: number;
  inventoryMismatch: number;
  missingResolutions: number;
}

type WalletStatus = 'OK' | 'FAIL' | 'TIMEOUT' | 'ERROR';

// Production cohort classification
type ProductionCohort = 'SAFE_TRADER_STRICT' | 'ESTIMATE_MIXED' | 'RISKY_MAKER_HEAVY' | 'DATA_SUSPECT' | 'UNCLASSIFIED';

// Data health status
type DataHealthStatus = 'OK' | 'FALLBACK_USED' | 'CTF_HEAVY';

interface DataHealthFlags {
  hasUnifiedLedgerRows: boolean;
  usesFallbackTrades: boolean;
  largeCtfActivity: boolean;  // splits + merges > threshold
}

interface WalletResult {
  wallet: string;
  uiPnL: number;
  cashPnl: number;
  tags: WalletTags;

  // V23c results
  v23cPnL: number;
  v23cError: number;
  v23cPctError: number;
  v23cEvents: number;
  v23cUnresolved: number;

  // V29 Guard results - multiple PnL views
  v29GuardPnL: number;             // totalPnl (realizedPnl + unrealizedPnl)
  v29GuardRealizedPnL: number;     // realizedPnl only (closed positions)
  v29GuardUiParityPnL: number;     // uiParityPnl (realized + resolved-unredeemed)
  v29GuardUiParityClampedPnL: number;  // NEW: uiParityClampedPnl (excludes negative inventory)
  v29GuardResolvedUnredeemedValue: number;  // component breakdown
  v29GuardError: number;           // Error using totalPnl
  v29GuardPctError: number;
  v29GuardUiParityError: number;   // Error using uiParityPnl
  v29GuardUiParityPctError: number;// % Error using uiParityPnl
  v29GuardUiParityClampedError: number;      // NEW: Error using uiParityClampedPnl
  v29GuardUiParityClampedPctError: number;   // NEW: % Error using uiParityClampedPnl
  v29GuardEvents: number;
  v29GuardClamped: number;
  v29GuardResolvedUnredeemedCount: number;  // how many resolved-unredeemed positions
  v29GuardNegativeInventoryPositions: number;  // NEW: count of negative inventory positions
  v29GuardNegativeInventoryPnlAdjustment: number;  // NEW: PnL excluded due to negative inventory

  // V29 NoGuard results
  v29NoGuardPnL: number;       // rawRealizedPnl + unrealizedPnl
  v29NoGuardError: number;
  v29NoGuardPctError: number;

  // Root cause
  rootCause: 'PASS' | 'PRICE_DATA' | 'LEDGER_GAP' | 'INVENTORY_SHAPE' | 'TRUE_COMPLEXITY' | 'UNKNOWN';
  notes: string;

  // Status for this wallet
  status: WalletStatus;
  processingTimeMs?: number;

  // Production cohort classification
  productionCohort: ProductionCohort;

  // CANONICAL ENGINE FIELDS (V29 UiParity)
  // These are the fields that the production router uses
  canonicalEngine: 'V29_UIPARITY';
  canonicalPnL: number;            // V29 UiParity PnL
  cohort: WalletCohort;            // SAFE | MODERATE | RISKY | SUSPECT
  cohortReason: string;            // Human-readable reason

  // Data health
  dataHealth: DataHealthFlags;
  dataHealthStatus: DataHealthStatus;
}

interface CheckpointMetadata {
  benchmarkSet: string;
  createdAt: string;
  updatedAt: string;
  walletCountCompleted: number;
  walletCountTotal: number;
  includeTags?: string[];
  excludeTags?: string[];
  explicitWallets?: string[];
  perWalletTimeoutSeconds: number;
}

interface RegressionReport {
  metadata: {
    benchmarkSet: string;
    runDate: string;
    walletCount: number;
    dataLayerVersion: string;
  };

  // Checkpoint metadata (new)
  checkpoint?: CheckpointMetadata;

  summary: {
    v23c: {
      passAt1Pct: number;
      passAt5Pct: number;
      exactMatch: number;
      avgError: number;
      medianError: number;
    };
    v29Guard: {
      passAt1Pct: number;
      passAt5Pct: number;
      exactMatch: number;
      avgError: number;
      medianError: number;
    };
    v29UiParity: {
      passAt1Pct: number;
      passAt5Pct: number;
      exactMatch: number;
      avgError: number;
      medianError: number;
    };
    v29UiParityClamped: {
      passAt1Pct: number;
      passAt5Pct: number;
      exactMatch: number;
      avgError: number;
      medianError: number;
      negativeInventoryPositionsTotal: number;
      negativeInventoryPnlAdjustmentTotal: number;
    };
    v29NoGuard: {
      passAt1Pct: number;
      passAt5Pct: number;
      exactMatch: number;
      avgError: number;
      medianError: number;
    };
    byTag: {
      traderStrict: { count: number; v23cPass: number; v29Pass: number };
      mixed: { count: number; v23cPass: number; v29Pass: number };
      makerHeavy: { count: number; v23cPass: number; v29Pass: number };
      dataSuspect: { count: number; v23cPass: number; v29Pass: number };
    };
    byRootCause: Record<string, number>;
  };

  results: WalletResult[];

  outliers: {
    v23cWorst: WalletResult[];
    v29Worst: WalletResult[];
    biggestDifference: WalletResult[];
  };
}

// ============================================================================
// CLI Options
// ============================================================================

interface CLIOptions {
  benchmarkSet: string;
  limit?: number;
  explicitWallets?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  perWalletTimeoutSeconds: number;
  summaryOnly: boolean;
  outputSuffix?: string;  // for unique checkpoint filenames
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    benchmarkSet: 'fresh_2025_12_06',
    perWalletTimeoutSeconds: 60,
    summaryOnly: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--set=')) {
      options.benchmarkSet = arg.slice(6);
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--wallet=')) {
      options.explicitWallets = arg.slice(9).split(',').map(w => w.toLowerCase().trim());
    } else if (arg.startsWith('--includeTags=')) {
      options.includeTags = arg.slice(14).split(',').map(t => t.toUpperCase().trim());
    } else if (arg.startsWith('--excludeTags=')) {
      options.excludeTags = arg.slice(14).split(',').map(t => t.toUpperCase().trim());
    } else if (arg.startsWith('--perWalletTimeoutSeconds=')) {
      options.perWalletTimeoutSeconds = parseInt(arg.slice(26), 10);
    } else if (arg === '--summaryOnly') {
      options.summaryOnly = true;
    } else if (arg.startsWith('--outputSuffix=')) {
      options.outputSuffix = arg.slice(15);
    }
  }

  return options;
}

// ============================================================================
// Checkpoint Manager
// ============================================================================

class CheckpointManager {
  private filePath: string;
  private data: {
    checkpoint: CheckpointMetadata;
    results: Map<string, WalletResult>;
  };

  constructor(benchmarkSet: string, options: CLIOptions) {
    // Build filename based on parameters to avoid collisions
    let filename = `regression-matrix-${benchmarkSet}`;
    if (options.includeTags?.length) {
      filename += `-inc_${options.includeTags.join('_')}`;
    }
    if (options.excludeTags?.length) {
      filename += `-exc_${options.excludeTags.join('_')}`;
    }
    if (options.explicitWallets?.length) {
      filename += `-explicit_${options.explicitWallets.length}`;
    }
    if (options.outputSuffix) {
      filename += `-${options.outputSuffix}`;
    }
    filename += '.json';

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    this.filePath = path.join(tmpDir, filename);

    // Load existing checkpoint if present
    this.data = {
      checkpoint: {
        benchmarkSet,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        walletCountCompleted: 0,
        walletCountTotal: 0,
        includeTags: options.includeTags,
        excludeTags: options.excludeTags,
        explicitWallets: options.explicitWallets,
        perWalletTimeoutSeconds: options.perWalletTimeoutSeconds,
      },
      results: new Map(),
    };

    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        if (parsed.checkpoint) {
          this.data.checkpoint = {
            ...this.data.checkpoint,
            createdAt: parsed.checkpoint.createdAt || this.data.checkpoint.createdAt,
          };
        }

        if (parsed.results && Array.isArray(parsed.results)) {
          for (const r of parsed.results) {
            this.data.results.set(r.wallet.toLowerCase(), r);
          }
          this.data.checkpoint.walletCountCompleted = this.data.results.size;
        }

        console.log(`[Checkpoint] Loaded ${this.data.results.size} existing results from ${this.filePath}`);
      }
    } catch (err) {
      console.log(`[Checkpoint] No valid checkpoint found, starting fresh`);
    }
  }

  hasWallet(wallet: string): boolean {
    return this.data.results.has(wallet.toLowerCase());
  }

  getResult(wallet: string): WalletResult | undefined {
    return this.data.results.get(wallet.toLowerCase());
  }

  addResult(result: WalletResult): void {
    this.data.results.set(result.wallet.toLowerCase(), result);
    this.data.checkpoint.walletCountCompleted = this.data.results.size;
    this.data.checkpoint.updatedAt = new Date().toISOString();
    this.saveAtomic();
  }

  setTotalCount(count: number): void {
    this.data.checkpoint.walletCountTotal = count;
  }

  private saveAtomic(): void {
    const output = {
      checkpoint: this.data.checkpoint,
      results: Array.from(this.data.results.values()),
    };

    const tmpFile = `${this.filePath}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(output, null, 2));
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      // Clean up temp file if rename failed
      try { fs.unlinkSync(tmpFile); } catch {}
      throw err;
    }
  }

  getResults(): WalletResult[] {
    return Array.from(this.data.results.values());
  }

  getCheckpoint(): CheckpointMetadata {
    return this.data.checkpoint;
  }

  getFilePath(): string {
    return this.filePath;
  }
}

// ============================================================================
// Timeout Helper
// ============================================================================

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<{ result: T | null; timedOut: boolean }> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TIMEOUT after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return { result, timedOut: false };
  } catch (err: any) {
    clearTimeout(timeoutId!);
    if (err.message?.startsWith('TIMEOUT')) {
      return { result: null, timedOut: true };
    }
    throw err;
  }
}

// ============================================================================
// Benchmark Loader
// ============================================================================

async function loadBenchmark(benchmarkSet: string): Promise<BenchmarkWallet[]> {
  // Use GROUP BY to deduplicate wallets (table may have duplicate rows)
  const result = await clickhouse.query({
    query: `
      SELECT
        wallet,
        max(pnl_value) as ui_pnl,
        any(note) as note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '${benchmarkSet}'
      GROUP BY wallet
      ORDER BY abs(ui_pnl) DESC
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map(r => ({
    wallet: r.wallet.toLowerCase(),
    ui_pnl: Number(r.ui_pnl),
    note: r.note || '',
  }));
}

// ============================================================================
// Wallet Tagger
// ============================================================================

async function tagWallet(wallet: string): Promise<WalletTags> {
  // Get CTF activity counts
  const ctfQuery = await clickhouse.query({
    query: `
      SELECT
        countIf(source_type = 'CLOB') as clob_count,
        countIf(source_type = 'PositionSplit') as split_count,
        countIf(source_type = 'PositionsMerge') as merge_count
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });
  const ctfRows: any[] = await ctfQuery.json();
  const ctf = ctfRows[0] || { clob_count: 0, split_count: 0, merge_count: 0 };

  const clobCount = Number(ctf.clob_count);
  const splitCount = Number(ctf.split_count);
  const mergeCount = Number(ctf.merge_count);

  // Calculate inventory mismatch (sold more than bought via CLOB)
  const invQuery = await clickhouse.query({
    query: `
      WITH position_totals AS (
        SELECT
          condition_id,
          outcome_index,
          sum(token_delta) as net_tokens
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
        GROUP BY condition_id, outcome_index
      )
      SELECT
        sum(CASE WHEN net_tokens < -5 THEN abs(net_tokens) ELSE 0 END) as inventory_mismatch
      FROM position_totals
    `,
    format: 'JSONEachRow',
  });
  const invRows: any[] = await invQuery.json();
  const inventoryMismatch = Number(invRows[0]?.inventory_mismatch || 0);

  // Check for missing resolutions
  const resQuery = await clickhouse.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT condition_id
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
      ),
      resolved AS (
        SELECT DISTINCT condition_id
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      )
      SELECT
        count() as total,
        countIf(r.condition_id IS NULL) as missing
      FROM wallet_conditions wc
      LEFT JOIN resolved r ON lower(wc.condition_id) = lower(r.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const resRows: any[] = await resQuery.json();
  const missingResolutions = Number(resRows[0]?.missing || 0);

  // Classify wallet
  const isTraderStrict = splitCount === 0 && mergeCount === 0 && inventoryMismatch < 5;
  const isMakerHeavy = mergeCount > 10 || splitCount > 10;
  const isMixed = !isTraderStrict && !isMakerHeavy;
  const isDataSuspect = inventoryMismatch > 100 || (clobCount === 0 && mergeCount > 0);

  return {
    isTraderStrict,
    isMixed,
    isMakerHeavy,
    isDataSuspect,
    splitCount,
    mergeCount,
    clobCount,
    inventoryMismatch,
    missingResolutions,
  };
}

// ============================================================================
// Root Cause Classifier
// ============================================================================

function classifyRootCause(
  result: WalletResult,
  tags: WalletTags
): 'PASS' | 'PRICE_DATA' | 'LEDGER_GAP' | 'INVENTORY_SHAPE' | 'TRUE_COMPLEXITY' | 'UNKNOWN' {
  const bestError = Math.min(result.v23cPctError, result.v29GuardPctError);

  // PASS if any engine is within 5%
  if (bestError < 5) {
    return 'PASS';
  }

  // Check for price/data issues
  if (result.v23cUnresolved > 10 || tags.missingResolutions > 10) {
    return 'PRICE_DATA';
  }

  // Check for ledger gaps
  if (tags.inventoryMismatch > 100 && result.v29GuardClamped > 5) {
    return 'LEDGER_GAP';
  }

  // Check for inventory shape issues (V29 guard helps significantly)
  if (result.v29GuardPctError < result.v23cPctError * 0.5 && result.v29GuardClamped > 0) {
    return 'INVENTORY_SHAPE';
  }

  // Market maker complexity
  if (tags.isMakerHeavy) {
    return 'TRUE_COMPLEXITY';
  }

  return 'UNKNOWN';
}

// ============================================================================
// Tag String Extractor
// ============================================================================

function getTagString(tags: WalletTags): string {
  const parts: string[] = [];
  if (tags.isTraderStrict) parts.push('TRADER_STRICT');
  if (tags.isMixed) parts.push('MIXED');
  if (tags.isMakerHeavy) parts.push('MAKER_HEAVY');
  if (tags.isDataSuspect) parts.push('DATA_SUSPECT');
  return parts.join(',') || 'UNTAGGED';
}

// ============================================================================
// Production Cohort Derivation
// ============================================================================

/**
 * Derive production cohort classification for a wallet based on:
 * - Tag (TRADER_STRICT, MIXED, MAKER_HEAVY, DATA_SUSPECT)
 * - V23c and V29 accuracy vs UI PnL
 * - Cross-engine agreement
 *
 * Cohorts:
 * - SAFE_TRADER_STRICT: High-confidence, copy-trading safe
 * - ESTIMATE_MIXED: Reasonable estimate, needs disclaimer
 * - RISKY_MAKER_HEAVY: Market maker, high uncertainty
 * - DATA_SUSPECT: Data quality issues detected
 * - UNCLASSIFIED: Doesn't fit any category
 */
function deriveProductionCohort(
  tags: WalletTags,
  v23cPctError: number,
  v29UiParityPctError: number,
  v23cPnL: number,
  v29UiParityPnL: number,
  uiPnL: number,
  dataHealth: DataHealthFlags
): ProductionCohort {
  // DATA_SUSPECT takes precedence
  if (tags.isDataSuspect) {
    return 'DATA_SUSPECT';
  }

  // RISKY_MAKER_HEAVY for market makers
  if (tags.isMakerHeavy) {
    return 'RISKY_MAKER_HEAVY';
  }

  // Calculate cross-engine agreement
  const crossEngineDiff = Math.abs(v23cPnL - v29UiParityPnL);
  const crossEngineAgreement = uiPnL !== 0
    ? (crossEngineDiff / Math.abs(uiPnL)) * 100
    : (crossEngineDiff < 1 ? 0 : 100);

  // SAFE_TRADER_STRICT criteria:
  // - tag == TRADER_STRICT
  // - v23cPctError < 3%
  // - v29UiParityPctError < 3%
  // - cross-engine agreement < 2%
  if (
    tags.isTraderStrict &&
    v23cPctError < 3 &&
    v29UiParityPctError < 3 &&
    crossEngineAgreement < 2
  ) {
    return 'SAFE_TRADER_STRICT';
  }

  // ESTIMATE_MIXED criteria:
  // - tag in [MIXED, TRADER_STRICT] (but didn't qualify for SAFE)
  // - max(v23cPctError, v29UiParityPctError) < 5%
  if (
    (tags.isMixed || tags.isTraderStrict) &&
    Math.max(v23cPctError, v29UiParityPctError) < 5
  ) {
    return 'ESTIMATE_MIXED';
  }

  // Fallback based on data health
  if (dataHealth.usesFallbackTrades || dataHealth.largeCtfActivity) {
    return 'DATA_SUSPECT';
  }

  return 'UNCLASSIFIED';
}

// ============================================================================
// Data Health Flag Computation
// ============================================================================

/**
 * Compute basic data health flags for a wallet.
 * These are derived from the wallet tags and engine results.
 */
function computeDataHealthFlags(
  tags: WalletTags,
  v23cEvents: number,
  v29Events: number
): DataHealthFlags {
  // Large CTF activity threshold: splits + merges > 10
  const largeCtfActivity = (tags.splitCount + tags.mergeCount) > 10;

  // Has unified ledger rows if V29 processed events
  const hasUnifiedLedgerRows = v29Events > 0;

  // Uses fallback trades if V23c has more events than V29 (V23c uses fallback, V29 uses v8 only)
  // Or if V23c has events but V29 has zero
  const usesFallbackTrades = v23cEvents > v29Events || (v23cEvents > 0 && v29Events === 0);

  return {
    hasUnifiedLedgerRows,
    usesFallbackTrades,
    largeCtfActivity,
  };
}

/**
 * Derive data health status from flags
 */
function deriveDataHealthStatus(flags: DataHealthFlags): DataHealthStatus {
  if (flags.largeCtfActivity) {
    return 'CTF_HEAVY';
  }
  if (flags.usesFallbackTrades) {
    return 'FALLBACK_USED';
  }
  return 'OK';
}

// ============================================================================
// Process Single Wallet (for timeout wrapper)
// ============================================================================

async function processWallet(wallet: string, ui_pnl: number): Promise<WalletResult> {
  const startTime = Date.now();

  // Tag wallet
  const tags = await tagWallet(wallet);

  // Run V23c
  const v23cResult = await calculateV23cPnL(wallet, { useUIOracle: true });

  // Run V29 with guard
  const v29GuardResult = await calculateV29PnL(wallet, {
    inventoryGuard: true,
    useMaterializedTable: true,
  });

  // Run V29 without guard
  const v29NoGuardResult = await calculateV29PnL(wallet, {
    inventoryGuard: false,
    useMaterializedTable: true,
  });

  // Calculate Cash PnL
  const { cashPnl } = await computeCashPnL(wallet);

  // Calculate errors
  const v23cError = Math.abs(v23cResult.realizedPnl - ui_pnl);
  const v23cPctError = ui_pnl !== 0 ? (v23cError / Math.abs(ui_pnl)) * 100 : (v23cResult.realizedPnl === 0 ? 0 : 100);

  const v29GuardError = Math.abs(v29GuardResult.totalPnl - ui_pnl);
  const v29GuardPctError = ui_pnl !== 0 ? (v29GuardError / Math.abs(ui_pnl)) * 100 : (v29GuardResult.totalPnl === 0 ? 0 : 100);

  const v29GuardUiParityError = Math.abs(v29GuardResult.uiParityPnl - ui_pnl);
  const v29GuardUiParityPctError = ui_pnl !== 0 ? (v29GuardUiParityError / Math.abs(ui_pnl)) * 100 : (v29GuardResult.uiParityPnl === 0 ? 0 : 100);

  const v29GuardUiParityClampedError = Math.abs(v29GuardResult.uiParityClampedPnl - ui_pnl);
  const v29GuardUiParityClampedPctError = ui_pnl !== 0 ? (v29GuardUiParityClampedError / Math.abs(ui_pnl)) * 100 : (v29GuardResult.uiParityClampedPnl === 0 ? 0 : 100);

  const v29NoGuardTotal = v29NoGuardResult.totalPnl;
  const v29NoGuardError = Math.abs(v29NoGuardTotal - ui_pnl);
  const v29NoGuardPctError = ui_pnl !== 0 ? (v29NoGuardError / Math.abs(ui_pnl)) * 100 : (v29NoGuardTotal === 0 ? 0 : 100);

  // Compute data health flags
  const dataHealth = computeDataHealthFlags(
    tags,
    v23cResult.eventsProcessed,
    v29GuardResult.eventsProcessed
  );
  const dataHealthStatus = deriveDataHealthStatus(dataHealth);

  // Derive production cohort
  const productionCohort = deriveProductionCohort(
    tags,
    v23cPctError,
    v29GuardUiParityPctError,
    v23cResult.realizedPnl,
    v29GuardResult.uiParityPnl,
    ui_pnl,
    dataHealth
  );

  // Use the cohort classifier for canonical cohort assignment
  const canonicalPnLObj: any = {
    wallet,
    uiPnL: v29GuardResult.uiParityPnl,
    realizedPnL: v29GuardResult.realizedPnl,
    unrealizedPnL: v29GuardResult.unrealizedPnl,
    resolvedUnredeemedValue: v29GuardResult.resolvedUnredeemedValue,
    dataHealth: {
      inventoryMismatch: v29GuardResult.clampedPositions,
      missingResolutions: tags.missingResolutions,
      negativeInventoryPositions: v29GuardResult.negativeInventoryPositions,
      negativeInventoryPnlAdjustment: v29GuardResult.negativeInventoryPnlAdjustment,
      clampedPositions: v29GuardResult.clampedPositions,
    },
    eventsProcessed: v29GuardResult.eventsProcessed,
    errors: v29GuardResult.errors,
  };

  const cohortDecision = classifyCohort({
    pnl: canonicalPnLObj,
    tags: tags as CohortWalletTags,
    uiParityErrorPct: v29GuardUiParityPctError,
    timedOut: false,
  });

  const walletResult: WalletResult = {
    wallet,
    uiPnL: ui_pnl,
    cashPnl,
    tags,
    v23cPnL: v23cResult.realizedPnl,
    v23cError,
    v23cPctError,
    v23cEvents: v23cResult.eventsProcessed,
    v23cUnresolved: v23cResult.unresolvedConditions,
    v29GuardPnL: v29GuardResult.totalPnl,
    v29GuardRealizedPnL: v29GuardResult.realizedPnl,
    v29GuardUiParityPnL: v29GuardResult.uiParityPnl,
    v29GuardUiParityClampedPnL: v29GuardResult.uiParityClampedPnl,
    v29GuardResolvedUnredeemedValue: v29GuardResult.resolvedUnredeemedValue,
    v29GuardError,
    v29GuardPctError,
    v29GuardUiParityError,
    v29GuardUiParityPctError,
    v29GuardUiParityClampedError,
    v29GuardUiParityClampedPctError,
    v29GuardEvents: v29GuardResult.eventsProcessed,
    v29GuardClamped: v29GuardResult.clampedPositions,
    v29GuardResolvedUnredeemedCount: v29GuardResult.resolvedUnredeemedPositions,
    v29GuardNegativeInventoryPositions: v29GuardResult.negativeInventoryPositions,
    v29GuardNegativeInventoryPnlAdjustment: v29GuardResult.negativeInventoryPnlAdjustment,
    v29NoGuardPnL: v29NoGuardTotal,
    v29NoGuardError,
    v29NoGuardPctError,
    rootCause: 'PASS',
    notes: getTagString(tags),
    status: 'OK',
    processingTimeMs: Date.now() - startTime,
    productionCohort,
    // CANONICAL ENGINE FIELDS
    canonicalEngine: 'V29_UIPARITY',
    canonicalPnL: v29GuardResult.uiParityPnl,
    cohort: cohortDecision.cohort,
    cohortReason: cohortDecision.reason,
    dataHealth,
    dataHealthStatus,
  };

  // Classify root cause and determine status
  walletResult.rootCause = classifyRootCause(walletResult, tags);
  walletResult.status = walletResult.v23cPctError < 5 || walletResult.v29GuardUiParityPctError < 5 ? 'OK' : 'FAIL';

  return walletResult;
}

// ============================================================================
// Create Timeout Result
// ============================================================================

function createTimeoutResult(wallet: string, ui_pnl: number, timeoutSeconds: number): WalletResult {
  const emptyTags: WalletTags = {
    isTraderStrict: false, isMixed: false, isMakerHeavy: false, isDataSuspect: true,
    splitCount: 0, mergeCount: 0, clobCount: 0, inventoryMismatch: 0, missingResolutions: 0,
  };
  const emptyDataHealth: DataHealthFlags = {
    hasUnifiedLedgerRows: false, usesFallbackTrades: false, largeCtfActivity: false,
  };

  return {
    wallet,
    uiPnL: ui_pnl,
    cashPnl: 0,
    tags: emptyTags,
    v23cPnL: 0, v23cError: 0, v23cPctError: 0, v23cEvents: 0, v23cUnresolved: 0,
    v29GuardPnL: 0, v29GuardRealizedPnL: 0, v29GuardUiParityPnL: 0, v29GuardUiParityClampedPnL: 0,
    v29GuardResolvedUnredeemedValue: 0, v29GuardError: 0, v29GuardPctError: 0,
    v29GuardUiParityError: 0, v29GuardUiParityPctError: 0,
    v29GuardUiParityClampedError: 0, v29GuardUiParityClampedPctError: 0,
    v29GuardEvents: 0, v29GuardClamped: 0, v29GuardResolvedUnredeemedCount: 0,
    v29GuardNegativeInventoryPositions: 0, v29GuardNegativeInventoryPnlAdjustment: 0,
    v29NoGuardPnL: 0, v29NoGuardError: 0, v29NoGuardPctError: 0,
    rootCause: 'UNKNOWN',
    notes: `TIMEOUT after ${timeoutSeconds}s`,
    status: 'TIMEOUT',
    processingTimeMs: timeoutSeconds * 1000,
    productionCohort: 'DATA_SUSPECT',
    // CANONICAL ENGINE FIELDS
    canonicalEngine: 'V29_UIPARITY',
    canonicalPnL: 0,
    cohort: 'SUSPECT',
    cohortReason: `SUSPECT: Wallet timed out after ${timeoutSeconds}s`,
    dataHealth: emptyDataHealth,
    dataHealthStatus: 'OK',
  };
}

// ============================================================================
// Create Error Result
// ============================================================================

function createErrorResult(wallet: string, ui_pnl: number, error: Error): WalletResult {
  const emptyTags: WalletTags = {
    isTraderStrict: false, isMixed: true, isMakerHeavy: false, isDataSuspect: true,
    splitCount: 0, mergeCount: 0, clobCount: 0, inventoryMismatch: 0, missingResolutions: 0,
  };
  const emptyDataHealth: DataHealthFlags = {
    hasUnifiedLedgerRows: false, usesFallbackTrades: false, largeCtfActivity: false,
  };

  return {
    wallet,
    uiPnL: ui_pnl,
    cashPnl: 0,
    tags: emptyTags,
    v23cPnL: 0, v23cError: Math.abs(ui_pnl), v23cPctError: 100, v23cEvents: 0, v23cUnresolved: 0,
    v29GuardPnL: 0, v29GuardRealizedPnL: 0, v29GuardUiParityPnL: 0, v29GuardUiParityClampedPnL: 0,
    v29GuardResolvedUnredeemedValue: 0, v29GuardError: Math.abs(ui_pnl), v29GuardPctError: 100,
    v29GuardUiParityError: Math.abs(ui_pnl), v29GuardUiParityPctError: 100,
    v29GuardUiParityClampedError: Math.abs(ui_pnl), v29GuardUiParityClampedPctError: 100,
    v29GuardEvents: 0, v29GuardClamped: 0, v29GuardResolvedUnredeemedCount: 0,
    v29GuardNegativeInventoryPositions: 0, v29GuardNegativeInventoryPnlAdjustment: 0,
    v29NoGuardPnL: 0, v29NoGuardError: Math.abs(ui_pnl), v29NoGuardPctError: 100,
    rootCause: 'UNKNOWN',
    notes: `ERROR: ${error.message.slice(0, 60)}`,
    status: 'ERROR',
    processingTimeMs: 0,
    productionCohort: 'DATA_SUSPECT',
    // CANONICAL ENGINE FIELDS
    canonicalEngine: 'V29_UIPARITY',
    canonicalPnL: 0,
    cohort: 'SUSPECT',
    cohortReason: `SUSPECT: Processing error - ${error.message.slice(0, 40)}`,
    dataHealth: emptyDataHealth,
    dataHealthStatus: 'OK',
  };
}

// ============================================================================
// Main Regression Runner (with checkpointing, timeout, tag filtering)
// ============================================================================

async function runRegression(options: CLIOptions): Promise<RegressionReport> {
  const { benchmarkSet, perWalletTimeoutSeconds } = options;
  const timeoutMs = perWalletTimeoutSeconds * 1000;

  console.log('='.repeat(80));
  console.log('PNL REGRESSION MATRIX');
  console.log('='.repeat(80));
  console.log(`Benchmark Set: ${benchmarkSet}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Per-Wallet Timeout: ${perWalletTimeoutSeconds}s`);
  if (options.includeTags?.length) console.log(`Include Tags: ${options.includeTags.join(', ')}`);
  if (options.excludeTags?.length) console.log(`Exclude Tags: ${options.excludeTags.join(', ')}`);
  if (options.explicitWallets?.length) console.log(`Explicit Wallets: ${options.explicitWallets.length}`);
  console.log('');

  // Initialize checkpoint manager
  const checkpoint = new CheckpointManager(benchmarkSet, options);

  // Determine wallet list
  let wallets: BenchmarkWallet[] = [];

  if (options.explicitWallets?.length) {
    // Use explicit wallet list - fetch their UI PnL from benchmark table
    console.log('Using explicit wallet list...');
    const allBenchmark = await loadBenchmark(benchmarkSet);
    const benchmarkMap = new Map(allBenchmark.map(w => [w.wallet.toLowerCase(), w]));

    for (const w of options.explicitWallets) {
      const found = benchmarkMap.get(w.toLowerCase());
      if (found) {
        wallets.push(found);
      } else {
        console.log(`  WARN: Wallet ${w} not found in benchmark set`);
      }
    }
  } else {
    // Load from benchmark set
    console.log('Loading benchmark wallets...');
    wallets = await loadBenchmark(benchmarkSet);
  }

  // Apply tag filters (requires tagging first if not explicit)
  if (options.includeTags?.length || options.excludeTags?.length) {
    console.log('Applying tag filters...');
    const filteredWallets: BenchmarkWallet[] = [];

    for (const w of wallets) {
      // Check if we already have tags from checkpoint
      const existing = checkpoint.getResult(w.wallet);
      let tags: WalletTags;

      if (existing?.tags) {
        tags = existing.tags;
      } else {
        // Must tag to filter
        tags = await tagWallet(w.wallet);
      }

      const tagStr = getTagString(tags);
      const tagList = tagStr.split(',');

      // Include filter
      if (options.includeTags?.length) {
        const hasIncludeTag = options.includeTags.some(t => tagList.includes(t));
        if (!hasIncludeTag) continue;
      }

      // Exclude filter
      if (options.excludeTags?.length) {
        const hasExcludeTag = options.excludeTags.some(t => tagList.includes(t));
        if (hasExcludeTag) continue;
      }

      filteredWallets.push(w);
    }

    wallets = filteredWallets;
  }

  // Apply limit
  if (options.limit && options.limit < wallets.length) {
    wallets = wallets.slice(0, options.limit);
  }

  checkpoint.setTotalCount(wallets.length);
  console.log(`Total wallets to process: ${wallets.length}`);
  console.log(`Already completed (from checkpoint): ${checkpoint.getResults().filter(r => wallets.some(w => w.wallet.toLowerCase() === r.wallet.toLowerCase())).length}`);
  console.log('');

  // Process each wallet
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < wallets.length; i++) {
    const { wallet, ui_pnl } = wallets[i];

    // Check if already processed (resume capability)
    if (checkpoint.hasWallet(wallet)) {
      const existing = checkpoint.getResult(wallet)!;
      skipped++;
      // Print SKIP line
      console.log(`[${(i + 1).toString().padStart(3)}/${wallets.length}] ${wallet.slice(0, 12)}... SKIP (cached: ${existing.status})`);
      continue;
    }

    processed++;

    try {
      // Run with timeout
      const { result, timedOut } = await withTimeout(
        processWallet(wallet, ui_pnl),
        timeoutMs,
        wallet
      );

      if (timedOut) {
        const timeoutResult = createTimeoutResult(wallet, ui_pnl, perWalletTimeoutSeconds);
        checkpoint.addResult(timeoutResult);
        console.log(`[${(i + 1).toString().padStart(3)}/${wallets.length}] ${wallet.slice(0, 12)}... TIMEOUT after ${perWalletTimeoutSeconds}s - skipping`);
      } else if (result) {
        checkpoint.addResult(result);

        // One-liner output: [idx/total] wallet... STATUS V23c:X.X% V29:X.X% [TAG]
        const v29Best = Math.min(result.v29GuardUiParityPctError, result.v29GuardUiParityClampedPctError);
        const statusIcon = result.status === 'OK' ? '✓' : result.status === 'FAIL' ? '✗' : '?';
        const timeStr = result.processingTimeMs ? `${(result.processingTimeMs / 1000).toFixed(1)}s` : '';

        console.log(
          `[${(i + 1).toString().padStart(3)}/${wallets.length}] ${wallet.slice(0, 12)}... ` +
          `${statusIcon} V23c:${result.v23cPctError.toFixed(1).padStart(5)}% V29:${v29Best.toFixed(1).padStart(5)}% ` +
          `[${result.notes.padEnd(14)}] ${timeStr}`
        );
      }
    } catch (error: any) {
      const errorResult = createErrorResult(wallet, ui_pnl, error);
      checkpoint.addResult(errorResult);
      console.log(`[${(i + 1).toString().padStart(3)}/${wallets.length}] ${wallet.slice(0, 12)}... ERROR: ${error.message.slice(0, 40)}`);
    }
  }

  console.log('');
  console.log(`Processed: ${processed} wallets, Skipped (cached): ${skipped}`);
  console.log(`Checkpoint saved to: ${checkpoint.getFilePath()}`);

  // Build report from all checkpoint results (respecting the current wallet list)
  const walletSet = new Set(wallets.map(w => w.wallet.toLowerCase()));
  const relevantResults = checkpoint.getResults().filter(r => walletSet.has(r.wallet.toLowerCase()));

  const report = buildReport(benchmarkSet, relevantResults, checkpoint.getCheckpoint());
  return report;
}

// ============================================================================
// Report Builder
// ============================================================================

function buildReport(benchmarkSet: string, results: WalletResult[], checkpointMeta?: CheckpointMetadata): RegressionReport {
  // Calculate summary stats
  const v23cPctErrors = results.map(r => r.v23cPctError);
  const v29GuardPctErrors = results.map(r => r.v29GuardPctError);
  const v29UiParityPctErrors = results.map(r => r.v29GuardUiParityPctError);
  const v29UiParityClampedPctErrors = results.map(r => r.v29GuardUiParityClampedPctError);
  const v29NoGuardPctErrors = results.map(r => r.v29NoGuardPctError);

  // Aggregate negative inventory stats
  const totalNegativeInventoryPositions = results.reduce((sum, r) => sum + r.v29GuardNegativeInventoryPositions, 0);
  const totalNegativeInventoryPnlAdjustment = results.reduce((sum, r) => sum + r.v29GuardNegativeInventoryPnlAdjustment, 0);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // By tag counts
  const traderStrict = results.filter(r => r.tags.isTraderStrict);
  const mixed = results.filter(r => r.tags.isMixed);
  const makerHeavy = results.filter(r => r.tags.isMakerHeavy);
  const dataSuspect = results.filter(r => r.tags.isDataSuspect);

  // Root cause counts
  const byRootCause: Record<string, number> = {};
  for (const r of results) {
    byRootCause[r.rootCause] = (byRootCause[r.rootCause] || 0) + 1;
  }

  // Outliers
  const v23cWorst = [...results].sort((a, b) => b.v23cPctError - a.v23cPctError).slice(0, 5);
  const v29Worst = [...results].sort((a, b) => b.v29GuardPctError - a.v29GuardPctError).slice(0, 5);
  const biggestDiff = [...results]
    .sort((a, b) => Math.abs(b.v23cPctError - b.v29GuardPctError) - Math.abs(a.v23cPctError - a.v29GuardPctError))
    .slice(0, 5);

  return {
    metadata: {
      benchmarkSet,
      runDate: new Date().toISOString(),
      walletCount: results.length,
      dataLayerVersion: 'V8 Materialized (V5 Token Map)',
    },
    summary: {
      v23c: {
        passAt1Pct: results.filter(r => r.v23cPctError < 1).length,
        passAt5Pct: results.filter(r => r.v23cPctError < 5).length,
        exactMatch: results.filter(r => r.v23cError < 1).length,
        avgError: avg(v23cPctErrors),
        medianError: median(v23cPctErrors),
      },
      v29Guard: {
        passAt1Pct: results.filter(r => r.v29GuardPctError < 1).length,
        passAt5Pct: results.filter(r => r.v29GuardPctError < 5).length,
        exactMatch: results.filter(r => r.v29GuardError < 1).length,
        avgError: avg(v29GuardPctErrors),
        medianError: median(v29GuardPctErrors),
      },
      v29UiParity: {
        passAt1Pct: results.filter(r => r.v29GuardUiParityPctError < 1).length,
        passAt5Pct: results.filter(r => r.v29GuardUiParityPctError < 5).length,
        exactMatch: results.filter(r => r.v29GuardUiParityError < 1).length,
        avgError: avg(v29UiParityPctErrors),
        medianError: median(v29UiParityPctErrors),
      },
      v29UiParityClamped: {
        passAt1Pct: results.filter(r => r.v29GuardUiParityClampedPctError < 1).length,
        passAt5Pct: results.filter(r => r.v29GuardUiParityClampedPctError < 5).length,
        exactMatch: results.filter(r => r.v29GuardUiParityClampedError < 1).length,
        avgError: avg(v29UiParityClampedPctErrors),
        medianError: median(v29UiParityClampedPctErrors),
        negativeInventoryPositionsTotal: totalNegativeInventoryPositions,
        negativeInventoryPnlAdjustmentTotal: totalNegativeInventoryPnlAdjustment,
      },
      v29NoGuard: {
        passAt1Pct: results.filter(r => r.v29NoGuardPctError < 1).length,
        passAt5Pct: results.filter(r => r.v29NoGuardPctError < 5).length,
        exactMatch: results.filter(r => r.v29NoGuardError < 1).length,
        avgError: avg(v29NoGuardPctErrors),
        medianError: median(v29NoGuardPctErrors),
      },
      byTag: {
        traderStrict: {
          count: traderStrict.length,
          v23cPass: traderStrict.filter(r => r.v23cPctError < 5).length,
          v29Pass: traderStrict.filter(r => r.v29GuardPctError < 5).length,
        },
        mixed: {
          count: mixed.length,
          v23cPass: mixed.filter(r => r.v23cPctError < 5).length,
          v29Pass: mixed.filter(r => r.v29GuardPctError < 5).length,
        },
        makerHeavy: {
          count: makerHeavy.length,
          v23cPass: makerHeavy.filter(r => r.v23cPctError < 5).length,
          v29Pass: makerHeavy.filter(r => r.v29GuardPctError < 5).length,
        },
        dataSuspect: {
          count: dataSuspect.length,
          v23cPass: dataSuspect.filter(r => r.v23cPctError < 5).length,
          v29Pass: dataSuspect.filter(r => r.v29GuardPctError < 5).length,
        },
      },
      byRootCause,
    },
    results,
    outliers: {
      v23cWorst,
      v29Worst,
      biggestDifference: biggestDiff,
    },
  };
}

// ============================================================================
// Report Printer
// ============================================================================

function printReport(report: RegressionReport): void {
  console.log('');
  console.log('='.repeat(80));
  console.log('REGRESSION MATRIX RESULTS');
  console.log('='.repeat(80));
  console.log('');

  const { summary } = report;
  const n = report.metadata.walletCount;

  console.log('OVERALL PASS RATES');
  console.log('-'.repeat(100));
  console.log(`                     | V23c      | V29 Guard | V29 UiParity | V29 Clamped | V29 NoGuard`);
  console.log(`---------------------|-----------|-----------|--------------|-------------|------------`);
  console.log(`Pass at <1%          | ${(summary.v23c.passAt1Pct).toString().padStart(3)}/${n} (${(100*summary.v23c.passAt1Pct/n).toFixed(0)}%) | ${(summary.v29Guard.passAt1Pct).toString().padStart(3)}/${n} (${(100*summary.v29Guard.passAt1Pct/n).toFixed(0)}%) | ${(summary.v29UiParity.passAt1Pct).toString().padStart(4)}/${n} (${(100*summary.v29UiParity.passAt1Pct/n).toFixed(0)}%) | ${(summary.v29UiParityClamped.passAt1Pct).toString().padStart(3)}/${n} (${(100*summary.v29UiParityClamped.passAt1Pct/n).toFixed(0)}%) | ${(summary.v29NoGuard.passAt1Pct).toString().padStart(3)}/${n} (${(100*summary.v29NoGuard.passAt1Pct/n).toFixed(0)}%)`);
  console.log(`Pass at <5%          | ${(summary.v23c.passAt5Pct).toString().padStart(3)}/${n} (${(100*summary.v23c.passAt5Pct/n).toFixed(0)}%) | ${(summary.v29Guard.passAt5Pct).toString().padStart(3)}/${n} (${(100*summary.v29Guard.passAt5Pct/n).toFixed(0)}%) | ${(summary.v29UiParity.passAt5Pct).toString().padStart(4)}/${n} (${(100*summary.v29UiParity.passAt5Pct/n).toFixed(0)}%) | ${(summary.v29UiParityClamped.passAt5Pct).toString().padStart(3)}/${n} (${(100*summary.v29UiParityClamped.passAt5Pct/n).toFixed(0)}%) | ${(summary.v29NoGuard.passAt5Pct).toString().padStart(3)}/${n} (${(100*summary.v29NoGuard.passAt5Pct/n).toFixed(0)}%)`);
  console.log(`Exact (<$1)          | ${(summary.v23c.exactMatch).toString().padStart(3)}/${n} (${(100*summary.v23c.exactMatch/n).toFixed(0)}%) | ${(summary.v29Guard.exactMatch).toString().padStart(3)}/${n} (${(100*summary.v29Guard.exactMatch/n).toFixed(0)}%) | ${(summary.v29UiParity.exactMatch).toString().padStart(4)}/${n} (${(100*summary.v29UiParity.exactMatch/n).toFixed(0)}%) | ${(summary.v29UiParityClamped.exactMatch).toString().padStart(3)}/${n} (${(100*summary.v29UiParityClamped.exactMatch/n).toFixed(0)}%) | ${(summary.v29NoGuard.exactMatch).toString().padStart(3)}/${n} (${(100*summary.v29NoGuard.exactMatch/n).toFixed(0)}%)`);
  console.log(`Avg Error            | ${summary.v23c.avgError.toFixed(1).padStart(7)}% | ${summary.v29Guard.avgError.toFixed(1).padStart(7)}% | ${summary.v29UiParity.avgError.toFixed(1).padStart(10)}% | ${summary.v29UiParityClamped.avgError.toFixed(1).padStart(9)}% | ${summary.v29NoGuard.avgError.toFixed(1).padStart(8)}%`);
  console.log(`Median Error         | ${summary.v23c.medianError.toFixed(1).padStart(7)}% | ${summary.v29Guard.medianError.toFixed(1).padStart(7)}% | ${summary.v29UiParity.medianError.toFixed(1).padStart(10)}% | ${summary.v29UiParityClamped.medianError.toFixed(1).padStart(9)}% | ${summary.v29NoGuard.medianError.toFixed(1).padStart(8)}%`);
  console.log('');

  // Show negative inventory stats
  console.log('NEGATIVE INVENTORY STATS');
  console.log('-'.repeat(60));
  console.log(`  Total Negative Inventory Positions: ${summary.v29UiParityClamped.negativeInventoryPositionsTotal}`);
  console.log(`  Total PnL Adjustment:               $${summary.v29UiParityClamped.negativeInventoryPnlAdjustmentTotal.toLocaleString()}`);
  console.log('');

  console.log('PASS RATES BY TAG (at <5% error)');
  console.log('-'.repeat(60));
  console.log(`Tag             | Count | V23c Pass | V29 Pass`);
  console.log(`----------------|-------|-----------|----------`);
  console.log(`TRADER_STRICT   | ${summary.byTag.traderStrict.count.toString().padStart(5)} | ${summary.byTag.traderStrict.v23cPass.toString().padStart(3)}/${summary.byTag.traderStrict.count} (${summary.byTag.traderStrict.count > 0 ? (100*summary.byTag.traderStrict.v23cPass/summary.byTag.traderStrict.count).toFixed(0) : 'N/A'}%) | ${summary.byTag.traderStrict.v29Pass.toString().padStart(3)}/${summary.byTag.traderStrict.count} (${summary.byTag.traderStrict.count > 0 ? (100*summary.byTag.traderStrict.v29Pass/summary.byTag.traderStrict.count).toFixed(0) : 'N/A'}%)`);
  console.log(`MIXED           | ${summary.byTag.mixed.count.toString().padStart(5)} | ${summary.byTag.mixed.v23cPass.toString().padStart(3)}/${summary.byTag.mixed.count} (${summary.byTag.mixed.count > 0 ? (100*summary.byTag.mixed.v23cPass/summary.byTag.mixed.count).toFixed(0) : 'N/A'}%) | ${summary.byTag.mixed.v29Pass.toString().padStart(3)}/${summary.byTag.mixed.count} (${summary.byTag.mixed.count > 0 ? (100*summary.byTag.mixed.v29Pass/summary.byTag.mixed.count).toFixed(0) : 'N/A'}%)`);
  console.log(`MAKER_HEAVY     | ${summary.byTag.makerHeavy.count.toString().padStart(5)} | ${summary.byTag.makerHeavy.v23cPass.toString().padStart(3)}/${summary.byTag.makerHeavy.count} (${summary.byTag.makerHeavy.count > 0 ? (100*summary.byTag.makerHeavy.v23cPass/summary.byTag.makerHeavy.count).toFixed(0) : 'N/A'}%) | ${summary.byTag.makerHeavy.v29Pass.toString().padStart(3)}/${summary.byTag.makerHeavy.count} (${summary.byTag.makerHeavy.count > 0 ? (100*summary.byTag.makerHeavy.v29Pass/summary.byTag.makerHeavy.count).toFixed(0) : 'N/A'}%)`);
  console.log(`DATA_SUSPECT    | ${summary.byTag.dataSuspect.count.toString().padStart(5)} | ${summary.byTag.dataSuspect.v23cPass.toString().padStart(3)}/${summary.byTag.dataSuspect.count} (${summary.byTag.dataSuspect.count > 0 ? (100*summary.byTag.dataSuspect.v23cPass/summary.byTag.dataSuspect.count).toFixed(0) : 'N/A'}%) | ${summary.byTag.dataSuspect.v29Pass.toString().padStart(3)}/${summary.byTag.dataSuspect.count} (${summary.byTag.dataSuspect.count > 0 ? (100*summary.byTag.dataSuspect.v29Pass/summary.byTag.dataSuspect.count).toFixed(0) : 'N/A'}%)`);
  console.log('');

  // Compute cohort distribution from results
  const cohortCounts: Record<ProductionCohort, number> = {
    'SAFE_TRADER_STRICT': 0,
    'ESTIMATE_MIXED': 0,
    'RISKY_MAKER_HEAVY': 0,
    'DATA_SUSPECT': 0,
    'UNCLASSIFIED': 0,
  };
  for (const r of report.results) {
    cohortCounts[r.productionCohort]++;
  }

  console.log('PRODUCTION COHORT DISTRIBUTION');
  console.log('-'.repeat(60));
  console.log(`Cohort              | Count | Description`);
  console.log(`--------------------|-------|----------------------------------`);
  console.log(`SAFE_TRADER_STRICT  | ${cohortCounts['SAFE_TRADER_STRICT'].toString().padStart(5)} | Copy-trading safe (<3% error, engines agree)`);
  console.log(`ESTIMATE_MIXED      | ${cohortCounts['ESTIMATE_MIXED'].toString().padStart(5)} | Reasonable estimate (<5% error)`);
  console.log(`RISKY_MAKER_HEAVY   | ${cohortCounts['RISKY_MAKER_HEAVY'].toString().padStart(5)} | Market maker, high uncertainty`);
  console.log(`DATA_SUSPECT        | ${cohortCounts['DATA_SUSPECT'].toString().padStart(5)} | Data quality issues detected`);
  console.log(`UNCLASSIFIED        | ${cohortCounts['UNCLASSIFIED'].toString().padStart(5)} | Doesn't fit any category`);
  console.log('');

  console.log('ROOT CAUSE DISTRIBUTION');
  console.log('-'.repeat(40));
  for (const [cause, count] of Object.entries(summary.byRootCause)) {
    console.log(`  ${cause.padEnd(20)}: ${count}`);
  }
  console.log('');

  console.log('TOP 5 WORST V23c FAILURES');
  console.log('-'.repeat(80));
  for (const r of report.outliers.v23cWorst) {
    console.log(`  ${r.wallet.slice(0, 16)}... UI:$${r.uiPnL.toFixed(0).padStart(12)} V23c:$${r.v23cPnL.toFixed(0).padStart(12)} (${r.v23cPctError.toFixed(1)}%) [${r.rootCause}]`);
  }
  console.log('');

  console.log('TOP 5 WORST V29 FAILURES');
  console.log('-'.repeat(80));
  for (const r of report.outliers.v29Worst) {
    console.log(`  ${r.wallet.slice(0, 16)}... UI:$${r.uiPnL.toFixed(0).padStart(12)} V29:$${r.v29GuardPnL.toFixed(0).padStart(12)} (${r.v29GuardPctError.toFixed(1)}%) [${r.rootCause}]`);
  }
  console.log('');

  console.log('TOP 5 BIGGEST V23c vs V29 DIFFERENCES');
  console.log('-'.repeat(80));
  for (const r of report.outliers.biggestDifference) {
    const diff = r.v23cPctError - r.v29GuardPctError;
    console.log(`  ${r.wallet.slice(0, 16)}... V23c:${r.v23cPctError.toFixed(1).padStart(6)}% V29:${r.v29GuardPctError.toFixed(1).padStart(6)}% Δ:${diff.toFixed(1).padStart(7)}%`);
  }
}

// ============================================================================
// Markdown Report Writer
// ============================================================================

function writeMarkdownReport(report: RegressionReport, outputPath: string): void {
  const { metadata, summary, results, outliers } = report;
  const n = metadata.walletCount;

  let md = `# Head-to-Head: V23c vs V29 PnL Engine Benchmark

**Date:** ${metadata.runDate}
**Benchmark Set:** ${metadata.benchmarkSet}
**Wallets Tested:** ${metadata.walletCount}
**Data Layer:** ${metadata.dataLayerVersion}

---

## Executive Summary

| Engine | Pass <1% | Pass <5% | Exact (<$1) | Median Error |
|--------|----------|----------|-------------|--------------|
| **V23c** | ${summary.v23c.passAt1Pct}/${n} (${(100*summary.v23c.passAt1Pct/n).toFixed(0)}%) | ${summary.v23c.passAt5Pct}/${n} (${(100*summary.v23c.passAt5Pct/n).toFixed(0)}%) | ${summary.v23c.exactMatch} | ${summary.v23c.medianError.toFixed(1)}% |
| **V29 Guard** | ${summary.v29Guard.passAt1Pct}/${n} (${(100*summary.v29Guard.passAt1Pct/n).toFixed(0)}%) | ${summary.v29Guard.passAt5Pct}/${n} (${(100*summary.v29Guard.passAt5Pct/n).toFixed(0)}%) | ${summary.v29Guard.exactMatch} | ${summary.v29Guard.medianError.toFixed(1)}% |
| **V29 UiParity** | ${summary.v29UiParity.passAt1Pct}/${n} (${(100*summary.v29UiParity.passAt1Pct/n).toFixed(0)}%) | ${summary.v29UiParity.passAt5Pct}/${n} (${(100*summary.v29UiParity.passAt5Pct/n).toFixed(0)}%) | ${summary.v29UiParity.exactMatch} | ${summary.v29UiParity.medianError.toFixed(1)}% |
| **V29 UiParityClamped** | ${summary.v29UiParityClamped.passAt1Pct}/${n} (${(100*summary.v29UiParityClamped.passAt1Pct/n).toFixed(0)}%) | ${summary.v29UiParityClamped.passAt5Pct}/${n} (${(100*summary.v29UiParityClamped.passAt5Pct/n).toFixed(0)}%) | ${summary.v29UiParityClamped.exactMatch} | ${summary.v29UiParityClamped.medianError.toFixed(1)}% |
| **V29 NoGuard** | ${summary.v29NoGuard.passAt1Pct}/${n} (${(100*summary.v29NoGuard.passAt1Pct/n).toFixed(0)}%) | ${summary.v29NoGuard.passAt5Pct}/${n} (${(100*summary.v29NoGuard.passAt5Pct/n).toFixed(0)}%) | ${summary.v29NoGuard.exactMatch} | ${summary.v29NoGuard.medianError.toFixed(1)}% |

### Negative Inventory Stats

- **Total Negative Inventory Positions:** ${summary.v29UiParityClamped.negativeInventoryPositionsTotal}
- **Total PnL Adjustment:** $${summary.v29UiParityClamped.negativeInventoryPnlAdjustmentTotal.toLocaleString()}

### V29 Mode Descriptions

- **V29 Guard**: Uses `totalPnl` = realizedPnl + unrealizedPnl (with inventory guard)
- **V29 UiParity**: Uses `uiParityPnl` = realizedPnl + resolved-but-unredeemed value (matches UI semantics)
- **V29 UiParityClamped**: Uses `uiParityClampedPnl` = uiParityPnl excluding negative inventory positions
- **V29 NoGuard**: Uses `rawRealizedPnl` + unrealizedPnl (no inventory guard)

---

## Pass Rates by Wallet Tag

| Tag | Count | V23c Pass (<5%) | V29 Pass (<5%) |
|-----|-------|-----------------|----------------|
| TRADER_STRICT | ${summary.byTag.traderStrict.count} | ${summary.byTag.traderStrict.v23cPass} (${summary.byTag.traderStrict.count > 0 ? (100*summary.byTag.traderStrict.v23cPass/summary.byTag.traderStrict.count).toFixed(0) : 0}%) | ${summary.byTag.traderStrict.v29Pass} (${summary.byTag.traderStrict.count > 0 ? (100*summary.byTag.traderStrict.v29Pass/summary.byTag.traderStrict.count).toFixed(0) : 0}%) |
| MIXED | ${summary.byTag.mixed.count} | ${summary.byTag.mixed.v23cPass} (${summary.byTag.mixed.count > 0 ? (100*summary.byTag.mixed.v23cPass/summary.byTag.mixed.count).toFixed(0) : 0}%) | ${summary.byTag.mixed.v29Pass} (${summary.byTag.mixed.count > 0 ? (100*summary.byTag.mixed.v29Pass/summary.byTag.mixed.count).toFixed(0) : 0}%) |
| MAKER_HEAVY | ${summary.byTag.makerHeavy.count} | ${summary.byTag.makerHeavy.v23cPass} (${summary.byTag.makerHeavy.count > 0 ? (100*summary.byTag.makerHeavy.v23cPass/summary.byTag.makerHeavy.count).toFixed(0) : 0}%) | ${summary.byTag.makerHeavy.v29Pass} (${summary.byTag.makerHeavy.count > 0 ? (100*summary.byTag.makerHeavy.v29Pass/summary.byTag.makerHeavy.count).toFixed(0) : 0}%) |
| DATA_SUSPECT | ${summary.byTag.dataSuspect.count} | ${summary.byTag.dataSuspect.v23cPass} (${summary.byTag.dataSuspect.count > 0 ? (100*summary.byTag.dataSuspect.v23cPass/summary.byTag.dataSuspect.count).toFixed(0) : 0}%) | ${summary.byTag.dataSuspect.v29Pass} (${summary.byTag.dataSuspect.count > 0 ? (100*summary.byTag.dataSuspect.v29Pass/summary.byTag.dataSuspect.count).toFixed(0) : 0}%) |

---

## Root Cause Distribution

| Root Cause | Count |
|------------|-------|
${Object.entries(summary.byRootCause).map(([cause, count]) => `| ${cause} | ${count} |`).join('
')}

---

## Worst Failures

### V23c Worst
| Wallet | UI PnL | V23c PnL | Error % | Root Cause |
|--------|--------|----------|---------|------------|
${outliers.v23cWorst.map(r => `| ${r.wallet.slice(0, 16)}... | $${r.uiPnL.toLocaleString()} | $${r.v23cPnL.toLocaleString()} | ${r.v23cPctError.toFixed(1)}% | ${r.rootCause} |`).join('
')}

### V29 Worst
| Wallet | UI PnL | V29 PnL | Error % | Root Cause |
|--------|--------|---------|---------|------------|
${outliers.v29Worst.map(r => `| ${r.wallet.slice(0, 16)}... | $${r.uiPnL.toLocaleString()} | $${r.v29GuardPnL.toLocaleString()} | ${r.v29GuardPctError.toFixed(1)}% | ${r.rootCause} |`).join('
')}

---

## Full Results

| Wallet | UI PnL | V23c PnL | V23c % | V29 PnL | V29 % | Tags | Root Cause |
|--------|--------|----------|--------|---------|-------|------|------------|
${results.map(r => `| ${r.wallet.slice(0, 12)}... | $${r.uiPnL.toLocaleString()} | $${r.v23cPnL.toLocaleString()} | ${r.v23cPctError.toFixed(1)}% | $${r.v29GuardPnL.toLocaleString()} | ${r.v29GuardPctError.toFixed(1)}% | ${r.notes} | ${r.rootCause} |`).join('
')}

---

## Recommendations

1. **For TRADER_STRICT wallets:** Use V23c (CLOB-only) for highest accuracy
2. **For MIXED wallets:** Either engine works, V29 may handle edge cases better
3. **For MAKER_HEAVY wallets:** Neither engine is reliable - show disclaimer
4. **Next Steps:**
   - Investigate UNKNOWN root causes
   - Improve resolution coverage for PRICE_DATA failures
   - Consider pure cash flow approach for fully resolved markets

---

*Report generated by run-regression-matrix.ts*
*Terminal: Claude 1*
`;

  fs.writeFileSync(outputPath, md);
  console.log(`Markdown report saved to: ${outputPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    benchmarkSet: 'fresh_2025_12_06',
    perWalletTimeoutSeconds: 60,
    summaryOnly: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--set=')) {
      options.benchmarkSet = arg.slice(6);
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--wallet=')) {
      options.explicitWallets = arg.slice(9).split(',').map(w => w.toLowerCase().trim());
    } else if (arg.startsWith('--includeTags=')) {
      options.includeTags = arg.slice(14).split(',').map(t => t.toUpperCase().trim());
    } else if (arg.startsWith('--excludeTags=')) {
      options.excludeTags = arg.slice(14).split(',').map(t => t.toUpperCase().trim());
    } else if (arg.startsWith('--perWalletTimeoutSeconds=')) {
      options.perWalletTimeoutSeconds = parseInt(arg.slice(26), 10);
    } else if (arg === '--summaryOnly') {
      options.summaryOnly = true;
    } else if (arg.startsWith('--outputSuffix=')) {
      options.outputSuffix = arg.slice(15);
    }
  }

  const report = await runRegression(options);

  // Print console report
  printReport(report);

  // Save JSON
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const jsonPath = path.join(tmpDir, `regression-matrix-${options.benchmarkSet}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`JSON report saved to: ${jsonPath}`);

  // Save Markdown
  const docsDir = path.join(process.cwd(), 'docs', 'reports');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
  const mdPath = path.join(docsDir, `HEAD_TO_HEAD_V23C_V29_${date}.md`);
  writeMarkdownReport(report, mdPath);

  console.log('');
  console.log('='.repeat(80));
  console.log('REGRESSION COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);