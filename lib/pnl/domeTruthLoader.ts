/**
 * ============================================================================
 * DOME TRUTH LOADER - Realized PnL Benchmarks from Dome API
 * ============================================================================
 *
 * PURPOSE: Load realized PnL ground truth from Dome API for V29 validation
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface DomeRealizedBenchmark {
  wallet: string;
  realizedPnl: number;
  confidence: 'high' | 'low';
  source: 'snapshot' | 'live';
  error?: string;
  fetched_at?: string;
}

export interface LoadDomeRealizedTruthOptions {
  snapshotPath?: string;
  wallets: string[];
  concurrency?: number;
  fetchLive?: boolean;
}

// ============================================================================
// Dome API Client
// ============================================================================

const DOME_API_KEY = '3850d9ac-1c76-4f94-b987-85c2b2d14c89';
const DOME_API_BASE = 'https://api.domeapi.io/v1';

async function fetchDomeWalletPnL(wallet: string): Promise<DomeRealizedBenchmark> {
  const fetched_at = new Date().toISOString();

  try {
    // Use the wallet PnL endpoint with granularity=all to get total realized PnL
    const url = `${DOME_API_BASE}/polymarket/wallet/pnl/${wallet}?granularity=all`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          wallet,
          realizedPnl: 0,
          confidence: 'low',
          source: 'live',
          error: 'Wallet not found',
          fetched_at,
        };
      }

      return {
        wallet,
        realizedPnl: 0,
        confidence: 'low',
        source: 'live',
        error: `HTTP ${response.status}: ${response.statusText}`,
        fetched_at,
      };
    }

    const data = await response.json();

    // Extract the latest PnL value from pnl_over_time array
    // The Dome API returns: { granularity, start_time, end_time, wallet_address, pnl_over_time: [{timestamp, pnl_to_date}] }
    if (!data.pnl_over_time || !Array.isArray(data.pnl_over_time) || data.pnl_over_time.length === 0) {
      return {
        wallet,
        realizedPnl: 0,
        confidence: 'low',
        source: 'live',
        error: 'No PnL data available',
        fetched_at,
      };
    }

    // Get the latest pnl_to_date value (last element in array)
    const latestPnl = data.pnl_over_time[data.pnl_over_time.length - 1].pnl_to_date;

    if (latestPnl === undefined || latestPnl === null) {
      return {
        wallet,
        realizedPnl: 0,
        confidence: 'low',
        source: 'live',
        error: 'No pnl_to_date field found',
        fetched_at,
      };
    }

    return {
      wallet,
      realizedPnl: Number(latestPnl),
      confidence: 'high',
      source: 'live',
      fetched_at,
    };
  } catch (err: any) {
    return {
      wallet,
      realizedPnl: 0,
      confidence: 'low',
      source: 'live',
      error: err.message,
      fetched_at,
    };
  }
}

// ============================================================================
// Snapshot Loader
// ============================================================================

function loadFromSnapshot(snapshotPath: string): Map<string, DomeRealizedBenchmark> {
  const benchmarks = new Map<string, DomeRealizedBenchmark>();

  if (!fs.existsSync(snapshotPath)) {
    console.log(`⚠️  Snapshot not found: ${snapshotPath}`);
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
    } else if (data.rows && Array.isArray(data.rows)) {
      items = data.rows;
    }

    for (const item of items) {
      const wallet = (item.wallet || item.wallet_address || '').toLowerCase();
      if (!wallet) continue;

      const realizedPnl = item.realizedPnl ?? item.realized_pnl ?? item.dome_realized ?? 0;
      const confidence = item.confidence || (realizedPnl !== 0 ? 'high' : 'low');

      benchmarks.set(wallet, {
        wallet,
        realizedPnl: Number(realizedPnl),
        confidence,
        source: 'snapshot',
        fetched_at: item.fetched_at,
      });
    }

    console.log(`✅ Loaded ${benchmarks.size} benchmarks from snapshot`);
  } catch (err) {
    console.log(`⚠️  Could not load snapshot: ${err}`);
  }

  return benchmarks;
}

// ============================================================================
// Concurrency Limiter
// ============================================================================

class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve as () => void));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// ============================================================================
// Main Loader
// ============================================================================

/**
 * Load Dome realized PnL benchmarks from snapshot or live API
 */
export async function loadDomeRealizedTruth(
  options: LoadDomeRealizedTruthOptions
): Promise<Map<string, DomeRealizedBenchmark>> {
  const {
    snapshotPath,
    wallets,
    concurrency = 5,
    fetchLive = false,
  } = options;

  const benchmarks = new Map<string, DomeRealizedBenchmark>();
  const normalizedWallets = wallets.map(w => w.toLowerCase());

  console.log('');
  console.log('🔍 Loading Dome realized PnL benchmarks...');
  console.log(`   Wallets: ${normalizedWallets.length}`);
  if (snapshotPath) {
    console.log(`   Snapshot: ${snapshotPath}`);
  }
  console.log(`   Fetch live: ${fetchLive}`);
  console.log('');

  // Load from snapshot if provided
  if (snapshotPath) {
    const snapshotBenchmarks = loadFromSnapshot(snapshotPath);
    for (const [wallet, benchmark] of snapshotBenchmarks) {
      if (normalizedWallets.includes(wallet)) {
        benchmarks.set(wallet, benchmark);
      }
    }
  }

  // Fetch missing wallets from live API if enabled
  if (fetchLive) {
    const missingWallets = normalizedWallets.filter(w => !benchmarks.has(w));

    if (missingWallets.length > 0) {
      console.log(`\n🔄 Fetching ${missingWallets.length} wallets from Dome API...`);
      const limiter = new ConcurrencyLimiter(concurrency);
      const stats = { high: 0, low: 0 };

      let completed = 0;
      for (const wallet of missingWallets) {
        await limiter.run(async () => {
          const benchmark = await fetchDomeWalletPnL(wallet);
          benchmarks.set(wallet, benchmark);

          if (benchmark.confidence === 'high') {
            stats.high++;
          } else {
            stats.low++;
          }

          completed++;
          if (completed % 10 === 0 || completed === missingWallets.length) {
            process.stdout.write(`\r  Progress: ${completed}/${missingWallets.length} (high: ${stats.high}, low: ${stats.low})`);
          }
        });
      }

      console.log('\n');
      console.log(`✅ Fetched ${missingWallets.length} wallets from API`);
      console.log(`   High confidence: ${stats.high}`);
      console.log(`   Low confidence: ${stats.low}`);
    }
  }

  // Summary
  const byConfidence = { high: 0, low: 0 };
  const bySource = { snapshot: 0, live: 0 };

  for (const benchmark of benchmarks.values()) {
    byConfidence[benchmark.confidence]++;
    bySource[benchmark.source]++;
  }

  console.log('');
  console.log(`✅ Loaded ${benchmarks.size} Dome benchmarks`);
  console.log(`   By confidence: high=${byConfidence.high}, low=${byConfidence.low}`);
  console.log(`   By source: snapshot=${bySource.snapshot}, live=${bySource.live}`);
  console.log('');

  return benchmarks;
}

/**
 * Quick helper to get just the realized PnL map
 */
export async function getDomeRealizedMap(
  options: LoadDomeRealizedTruthOptions
): Promise<Map<string, number>> {
  const benchmarks = await loadDomeRealizedTruth(options);
  const pnlMap = new Map<string, number>();

  for (const [wallet, benchmark] of benchmarks) {
    pnlMap.set(wallet, benchmark.realizedPnl);
  }

  return pnlMap;
}
