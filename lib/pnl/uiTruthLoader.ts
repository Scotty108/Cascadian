/**
 * ============================================================================
 * UI TRUTH LOADER - Shared UI PnL Benchmark Loader
 * ============================================================================
 *
 * PURPOSE: Single source of truth for UI PnL benchmarks across all comparison scripts
 *
 * FEATURES:
 * - Loads from multiple sources (v2, v1, live snapshots)
 * - Validates data quality
 * - Warns about stale/suspicious benchmarks
 * - Supports filtering by benchmark_set
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import { clickhouse } from '../clickhouse/client';
import fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface UITruthBenchmark {
  wallet: string;
  ui_pnl: number;
  source: 'v2_table' | 'v1_table' | 'json_file' | 'live_api' | 'live_snapshot';
  benchmark_set?: string;
  captured_at?: Date;
  confidence: 'high' | 'medium' | 'low' | 'none';
  warnings: string[];
}

export interface UITruthLoaderOptions {
  preferSource?: 'v2' | 'v1' | 'file' | 'api' | 'live';
  benchmarkSet?: string;
  minConfidence?: 'high' | 'medium' | 'low';
  warnOnStale?: boolean;
  staleDays?: number;
  liveSnapshotPath?: string;
  allowV1Fallback?: boolean;
}

export interface UITruthLoaderResult {
  benchmarks: Map<string, UITruthBenchmark>;
  stats: {
    total: number;
    bySource: Record<string, number>;
    byConfidence: Record<string, number>;
    warnings: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: UITruthLoaderOptions = {
  preferSource: 'v2',
  minConfidence: 'medium',
  warnOnStale: true,
  staleDays: 7,
  allowV1Fallback: false,
};

const FALLBACK_JSON_FILES = [
  './tmp/safe_trader_strict_wallets_2025_12_06.json',
  './tmp/ui_pnl_benchmarks_latest.json',
];

// ============================================================================
// V2 Table Loader
// ============================================================================

async function loadFromV2Table(
  wallets: string[],
  benchmarkSet?: string
): Promise<Map<string, UITruthBenchmark>> {
  const benchmarks = new Map<string, UITruthBenchmark>();

  try {
    const normalizedWallets = wallets.map(w => w.toLowerCase());
    const walletList = normalizedWallets.map(w => `'${w}'`).join(', ');

    let query = `
      SELECT
        lower(wallet) as wallet,
        pnl_value as ui_pnl,
        benchmark_set,
        captured_at
      FROM pm_ui_pnl_benchmarks_v2
      WHERE lower(wallet) IN (${walletList})
    `;

    if (benchmarkSet) {
      query += ` AND benchmark_set = '${benchmarkSet}'`;
    }

    query += ` ORDER BY captured_at DESC`;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    // Take most recent benchmark per wallet
    const seen = new Set<string>();
    for (const row of rows) {
      const wallet = row.wallet.toLowerCase();
      if (!seen.has(wallet)) {
        const capturedAt = new Date(row.captured_at);
        const ageHours = (Date.now() - capturedAt.getTime()) / (1000 * 60 * 60);
        const ageDays = ageHours / 24;

        const warnings: string[] = [];
        let confidence: 'high' | 'medium' | 'low' = 'high';

        if (ageDays > 7) {
          warnings.push(`Benchmark is ${ageDays.toFixed(1)} days old`);
          confidence = 'medium';
        }

        if (ageDays > 30) {
          warnings.push('Benchmark is >30 days old - likely stale');
          confidence = 'low';
        }

        benchmarks.set(wallet, {
          wallet,
          ui_pnl: Number(row.ui_pnl),
          source: 'v2_table',
          benchmark_set: row.benchmark_set,
          captured_at: capturedAt,
          confidence,
          warnings,
        });

        seen.add(wallet);
      }
    }

    console.log(`✅ Loaded ${benchmarks.size} benchmarks from pm_ui_pnl_benchmarks_v2`);
  } catch (err) {
    console.log(`⚠️  Could not load from v2 table: ${err}`);
  }

  return benchmarks;
}

// ============================================================================
// V1 Table Loader (Fallback)
// ============================================================================

async function loadFromV1Table(
  wallets: string[],
  benchmarkSet?: string
): Promise<Map<string, UITruthBenchmark>> {
  const benchmarks = new Map<string, UITruthBenchmark>();

  try {
    const normalizedWallets = wallets.map(w => w.toLowerCase());
    const walletList = normalizedWallets.map(w => `'${w}'`).join(', ');

    let query = `
      SELECT
        lower(wallet) as wallet,
        pnl_value as ui_pnl,
        benchmark_set,
        captured_at
      FROM pm_ui_pnl_benchmarks_v1
      WHERE lower(wallet) IN (${walletList})
    `;

    if (benchmarkSet) {
      query += ` AND benchmark_set = '${benchmarkSet}'`;
    }

    query += ` ORDER BY captured_at DESC`;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    // Take most recent benchmark per wallet
    const seen = new Set<string>();
    for (const row of rows) {
      const wallet = row.wallet.toLowerCase();
      if (!seen.has(wallet)) {
        const capturedAt = new Date(row.captured_at);
        const ageHours = (Date.now() - capturedAt.getTime()) / (1000 * 60 * 60);
        const ageDays = ageHours / 24;

        const warnings: string[] = ['From V1 table (may have accuracy issues)'];
        let confidence: 'high' | 'medium' | 'low' = 'medium';

        if (ageDays > 7) {
          warnings.push(`Benchmark is ${ageDays.toFixed(1)} days old`);
          confidence = 'low';
        }

        benchmarks.set(wallet, {
          wallet,
          ui_pnl: Number(row.ui_pnl),
          source: 'v1_table',
          benchmark_set: row.benchmark_set,
          captured_at: capturedAt,
          confidence,
          warnings,
        });

        seen.add(wallet);
      }
    }

    console.log(`✅ Loaded ${benchmarks.size} benchmarks from pm_ui_pnl_benchmarks_v1 (fallback)`);
    console.log(`⚠️  WARNING: V1 table has known accuracy issues - use with caution`);
  } catch (err) {
    console.log(`⚠️  Could not load from v1 table: ${err}`);
  }

  return benchmarks;
}

// ============================================================================
// JSON File Loader (Fallback)
// ============================================================================

function loadFromJSONFile(wallets: string[]): Map<string, UITruthBenchmark> {
  const benchmarks = new Map<string, UITruthBenchmark>();
  const normalizedWallets = new Set(wallets.map(w => w.toLowerCase()));

  for (const filePath of FALLBACK_JSON_FILES) {
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Support multiple formats
        let items: any[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (data.wallets && Array.isArray(data.wallets)) {
          items = data.wallets;
        }

        for (const item of items) {
          const wallet = (item.wallet || item.wallet_address || '').toLowerCase();
          const ui_pnl = item.uiPnL ?? item.ui_pnl ?? item.pnl_value;

          if (wallet && ui_pnl !== undefined && normalizedWallets.has(wallet)) {
            if (!benchmarks.has(wallet)) {
              benchmarks.set(wallet, {
                wallet,
                ui_pnl: Number(ui_pnl),
                source: 'json_file',
                confidence: 'medium',
                warnings: [`Loaded from ${filePath} - verify accuracy`],
              });
            }
          }
        }
      } catch (err) {
        console.log(`⚠️  Could not load from ${filePath}: ${err}`);
      }
    }
  }

  if (benchmarks.size > 0) {
    console.log(`✅ Loaded ${benchmarks.size} benchmarks from JSON files (fallback)`);
  }

  return benchmarks;
}

// ============================================================================
// Live Snapshot Loader
// ============================================================================

/**
 * Load benchmarks from live Playwright snapshot JSON
 * Format expected:
 * [
 *   { wallet: "0x...", uiPnL: 123.45, status: "OK" },
 *   { wallet: "0x...", uiPnL: null, status: "NONEXISTENT" }
 * ]
 */
function loadFromLiveSnapshot(
  wallets: string[],
  snapshotPath: string
): Map<string, UITruthBenchmark> {
  const benchmarks = new Map<string, UITruthBenchmark>();
  const normalizedWallets = new Set(wallets.map(w => w.toLowerCase()));

  if (!fs.existsSync(snapshotPath)) {
    console.log(`⚠️  Live snapshot not found: ${snapshotPath}`);
    return benchmarks;
  }

  try {
    const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

    // Support both array and object with wallets array
    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.wallets && Array.isArray(data.wallets)) {
      items = data.wallets;
    }

    for (const item of items) {
      const wallet = (item.wallet || item.wallet_address || '').toLowerCase();
      const status = item.status || 'UNKNOWN';
      const ui_pnl = item.uiPnL ?? item.ui_pnl ?? item.pnl_value;

      if (!wallet || !normalizedWallets.has(wallet)) {
        continue;
      }

      let confidence: 'high' | 'medium' | 'low' | 'none' = 'medium';
      const warnings: string[] = [];

      if (status === 'NONEXISTENT') {
        confidence = 'none';
        warnings.push('Wallet does not exist on Polymarket');
      } else if (status === 'OK' && ui_pnl !== null && ui_pnl !== undefined) {
        confidence = 'high';
        warnings.push('Live Playwright snapshot');
      } else if (status === 'ERROR' || ui_pnl === null || ui_pnl === undefined) {
        confidence = 'low';
        warnings.push(`Snapshot status: ${status}, no PnL value`);
      }

      benchmarks.set(wallet, {
        wallet,
        ui_pnl: ui_pnl !== null && ui_pnl !== undefined ? Number(ui_pnl) : 0,
        source: 'live_snapshot',
        captured_at: new Date(),
        confidence,
        warnings,
      });
    }

    console.log(`✅ Loaded ${benchmarks.size} benchmarks from live snapshot`);
    const byConfidence = { high: 0, medium: 0, low: 0, none: 0 };
    for (const b of benchmarks.values()) {
      byConfidence[b.confidence]++;
    }
    console.log(`   Confidence breakdown: ${JSON.stringify(byConfidence)}`);
  } catch (err) {
    console.log(`⚠️  Could not load from live snapshot: ${err}`);
  }

  return benchmarks;
}

// ============================================================================
// Main Loader
// ============================================================================

/**
 * Load UI PnL benchmarks from multiple sources with fallback logic
 *
 * Priority:
 * 1. V2 table (most reliable)
 * 2. V1 table (warning: known accuracy issues)
 * 3. JSON files (last resort)
 *
 * Returns a map of wallet -> UITruthBenchmark with confidence levels and warnings
 */
export async function loadUITruth(
  wallets: string[],
  options: UITruthLoaderOptions = {}
): Promise<UITruthLoaderResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const benchmarks = new Map<string, UITruthBenchmark>();
  const globalWarnings: string[] = [];

  console.log('');
  console.log('🔍 Loading UI PnL benchmarks...');
  console.log(`   Source preference: ${opts.preferSource}`);
  console.log(`   Min confidence: ${opts.minConfidence}`);
  if (opts.liveSnapshotPath) {
    console.log(`   Live snapshot: ${opts.liveSnapshotPath}`);
  }
  console.log(`   Allow V1 fallback: ${opts.allowV1Fallback}`);
  console.log('');

  // Try sources in order based on preference
  if (opts.preferSource === 'live') {
    // STRICT: Live snapshot path REQUIRED when preferSource='live'
    if (!opts.liveSnapshotPath) {
      console.error('');
      console.error('🚨 ERROR: --truth=live requires --live-snapshot to be specified');
      console.error('');
      throw new Error('Live truth mode requires liveSnapshotPath');
    }

    // Live snapshot is highest priority
    const liveSnapshots = loadFromLiveSnapshot(wallets, opts.liveSnapshotPath);
    for (const [wallet, benchmark] of liveSnapshots) {
      benchmarks.set(wallet, benchmark);
    }

    // Fallback to V2 for missing wallets (excluding NONEXISTENT)
    const missingWallets = wallets.filter(w => {
      const existing = benchmarks.get(w.toLowerCase());
      return !existing || existing.confidence === 'none';
    });

    if (missingWallets.length > 0) {
      console.log(`\n⚠️  ${missingWallets.length} wallets not in live snapshot, falling back to V2...`);
      const v2Benchmarks = await loadFromV2Table(missingWallets, opts.benchmarkSet);
      for (const [wallet, benchmark] of v2Benchmarks) {
        if (!benchmarks.has(wallet) || benchmarks.get(wallet)!.confidence === 'none') {
          benchmarks.set(wallet, benchmark);
        }
      }
    }

    // Optionally fallback to V1 if explicitly allowed
    if (opts.allowV1Fallback) {
      const stillMissing = wallets.filter(w => {
        const existing = benchmarks.get(w.toLowerCase());
        return !existing || existing.confidence === 'none';
      });

      if (stillMissing.length > 0) {
        console.log(`\n⚠️  ${stillMissing.length} wallets not found, falling back to V1 (allowV1Fallback=true)...`);
        const v1Benchmarks = await loadFromV1Table(stillMissing, opts.benchmarkSet);
        for (const [wallet, benchmark] of v1Benchmarks) {
          if (!benchmarks.has(wallet) || benchmarks.get(wallet)!.confidence === 'none') {
            benchmarks.set(wallet, benchmark);
          }
        }
      }
    }
  } else if (opts.preferSource === 'v2' || opts.preferSource === 'v1') {
    // Try V2 first
    const v2Benchmarks = await loadFromV2Table(wallets, opts.benchmarkSet);
    for (const [wallet, benchmark] of v2Benchmarks) {
      benchmarks.set(wallet, benchmark);
    }

    // Fallback to V1 for missing wallets
    const missingWallets = wallets.filter(w => !benchmarks.has(w.toLowerCase()));
    if (missingWallets.length > 0 && opts.allowV1Fallback !== false) {
      console.log(`\n⚠️  ${missingWallets.length} wallets not found in V2, falling back to V1...`);
      const v1Benchmarks = await loadFromV1Table(missingWallets, opts.benchmarkSet);
      for (const [wallet, benchmark] of v1Benchmarks) {
        benchmarks.set(wallet, benchmark);
      }
    }

    // Fallback to JSON files for still-missing wallets
    const stillMissing = wallets.filter(w => !benchmarks.has(w.toLowerCase()));
    if (stillMissing.length > 0) {
      console.log(`\n⚠️  ${stillMissing.length} wallets not found in DB, falling back to JSON files...`);
      const jsonBenchmarks = loadFromJSONFile(stillMissing);
      for (const [wallet, benchmark] of jsonBenchmarks) {
        benchmarks.set(wallet, benchmark);
      }
    }
  } else if (opts.preferSource === 'file') {
    // Load from JSON files first
    const jsonBenchmarks = loadFromJSONFile(wallets);
    for (const [wallet, benchmark] of jsonBenchmarks) {
      benchmarks.set(wallet, benchmark);
    }
  }

  // Filter by minimum confidence (always exclude 'none')
  const filtered = new Map<string, UITruthBenchmark>();
  const confidenceLevels = { high: 3, medium: 2, low: 1, none: 0 };
  const minLevel = confidenceLevels[opts.minConfidence!];

  for (const [wallet, benchmark] of benchmarks) {
    const level = confidenceLevels[benchmark.confidence];

    // Always exclude 'none' confidence (NONEXISTENT wallets)
    if (benchmark.confidence === 'none') {
      globalWarnings.push(
        `Excluded ${wallet.substring(0, 12)}... (NONEXISTENT wallet)`
      );
      continue;
    }

    if (level >= minLevel) {
      filtered.set(wallet, benchmark);
    } else {
      globalWarnings.push(
        `Excluded ${wallet.substring(0, 12)}... (confidence: ${benchmark.confidence} < ${opts.minConfidence})`
      );
    }
  }

  // Collect stats
  const bySource: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};

  for (const benchmark of filtered.values()) {
    bySource[benchmark.source] = (bySource[benchmark.source] || 0) + 1;
    byConfidence[benchmark.confidence] = (byConfidence[benchmark.confidence] || 0) + 1;
  }

  // Report warnings
  for (const benchmark of filtered.values()) {
    if (benchmark.warnings.length > 0) {
      globalWarnings.push(
        `${benchmark.wallet.substring(0, 12)}...: ${benchmark.warnings.join(', ')}`
      );
    }
  }

  console.log('');
  console.log(`✅ Loaded ${filtered.size} benchmarks with confidence >= ${opts.minConfidence}`);
  console.log(`   By source: ${JSON.stringify(bySource)}`);
  console.log(`   By confidence: ${JSON.stringify(byConfidence)}`);

  if (globalWarnings.length > 0) {
    console.log('');
    console.log(`⚠️  ${globalWarnings.length} warnings:`);
    globalWarnings.slice(0, 5).forEach(w => console.log(`   - ${w}`));
    if (globalWarnings.length > 5) {
      console.log(`   ... and ${globalWarnings.length - 5} more`);
    }
  }

  console.log('');

  return {
    benchmarks: filtered,
    stats: {
      total: filtered.size,
      bySource,
      byConfidence,
      warnings: globalWarnings,
    },
  };
}

/**
 * Quick helper to get just the PnL map for a list of wallets
 */
export async function getUITruthMap(
  wallets: string[],
  options: UITruthLoaderOptions = {}
): Promise<Map<string, number>> {
  const result = await loadUITruth(wallets, options);
  const pnlMap = new Map<string, number>();

  for (const [wallet, benchmark] of result.benchmarks) {
    pnlMap.set(wallet, benchmark.ui_pnl);
  }

  return pnlMap;
}
