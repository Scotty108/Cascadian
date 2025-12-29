#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * FETCH LIVE PNL SNAPSHOT - Polymarket Gamma API
 * ============================================================================
 *
 * PURPOSE: Generate live PnL snapshot for truth loader using Gamma API
 *
 * USAGE:
 *   npx tsx scripts/pnl/fetch-live-pnl-snapshot.ts \
 *     --wallets-file=tmp/trader_strict_sample_v2_fast.json \
 *     --output=tmp/ui_pnl_live_snapshot_2025_12_07.json \
 *     --limit=50
 *
 * OUTPUT FORMAT:
 * [
 *   { "wallet": "0x...", "uiPnL": 123.45, "status": "OK" },
 *   { "wallet": "0x...", "uiPnL": null, "status": "NONEXISTENT" },
 *   { "wallet": "0x...", "uiPnL": null, "status": "ERROR", "error": "..." }
 * ]
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  walletsFile: string;
  output: string;
  limit: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let walletsFile = '';
  let output = '';
  let limit = 50;

  for (const arg of args) {
    if (arg.startsWith('--wallets-file=')) {
      walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 50;
    }
  }

  if (!walletsFile) {
    console.error('ERROR: --wallets-file required');
    process.exit(1);
  }

  if (!output) {
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_');
    output = `tmp/ui_pnl_live_snapshot_${timestamp}.json`;
  }

  return { walletsFile, output, limit };
}

// ============================================================================
// Types
// ============================================================================

interface LiveSnapshot {
  wallet: string;
  uiPnL: number | null;
  status: 'OK' | 'NONEXISTENT' | 'ERROR';
  error?: string;
  fetched_at: string;
}

interface APIResponse {
  pnl?: number;
  totalPnl?: number;
  error?: string;
}

// ============================================================================
// Gamma API Fetcher
// ============================================================================

async function fetchWalletPnL(wallet: string): Promise<LiveSnapshot> {
  const fetched_at = new Date().toISOString();

  try {
    const url = `https://gamma-api.polymarket.com/profile/${wallet}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          wallet,
          uiPnL: null,
          status: 'NONEXISTENT',
          error: 'Wallet not found on Polymarket',
          fetched_at,
        };
      }

      return {
        wallet,
        uiPnL: null,
        status: 'ERROR',
        error: `HTTP ${response.status}: ${response.statusText}`,
        fetched_at,
      };
    }

    const data = await response.json();

    // Try multiple PnL field names
    const pnl = data.pnl ?? data.totalPnl ?? data.total_pnl ?? data.allTimePnl;

    if (pnl === undefined || pnl === null) {
      return {
        wallet,
        uiPnL: null,
        status: 'ERROR',
        error: 'No PnL field found in API response',
        fetched_at,
      };
    }

    return {
      wallet,
      uiPnL: Number(pnl),
      status: 'OK',
      fetched_at,
    };
  } catch (err: any) {
    return {
      wallet,
      uiPnL: null,
      status: 'ERROR',
      error: err.message,
      fetched_at,
    };
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Load Wallets
// ============================================================================

function loadWallets(config: Config): string[] {
  if (!fs.existsSync(config.walletsFile)) {
    console.error(`ERROR: Wallet file not found: ${config.walletsFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(config.walletsFile, 'utf-8'));
  const wallets: string[] = [];

  // Support multiple formats
  if (data.wallets && Array.isArray(data.wallets)) {
    if (typeof data.wallets[0] === 'string') {
      wallets.push(...data.wallets.slice(0, config.limit));
    } else if (data.wallets[0]?.wallet_address) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet_address));
    } else if (data.wallets[0]?.wallet) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet));
    }
  } else if (Array.isArray(data)) {
    const slice = data.slice(0, config.limit);
    for (const item of slice) {
      if (item.wallet) {
        wallets.push(item.wallet);
      } else if (item.wallet_address) {
        wallets.push(item.wallet_address);
      }
    }
  }

  return wallets.map(w => w.toLowerCase());
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(100));
  console.log('FETCH LIVE PNL SNAPSHOT - Polymarket Gamma API');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Wallets file: ${config.walletsFile}`);
  console.log(`Output: ${config.output}`);
  console.log(`Limit: ${config.limit}`);
  console.log('');

  // Load wallets
  console.log('STEP 1: Loading wallets...');
  const wallets = loadWallets(config);
  console.log(`  Loaded ${wallets.length} wallets`);
  console.log('');

  // Fetch PnL for each wallet
  console.log('STEP 2: Fetching live PnL from Polymarket...');
  const snapshots: LiveSnapshot[] = [];
  const stats = { ok: 0, nonexistent: 0, error: 0 };

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`  [${i + 1}/${wallets.length}] ${wallet.substring(0, 12)}... `);

    const snapshot = await fetchWalletPnL(wallet);
    snapshots.push(snapshot);

    if (snapshot.status === 'OK') {
      stats.ok++;
      const pnl = snapshot.uiPnL!;
      const sign = pnl >= 0 ? '+' : '-';
      const abs = Math.abs(pnl);
      const formatted = abs >= 1e6 ? `${sign}$${(abs / 1e6).toFixed(2)}M` :
                        abs >= 1e3 ? `${sign}$${(abs / 1e3).toFixed(1)}K` :
                        `${sign}$${abs.toFixed(0)}`;
      console.log(`✅ ${formatted}`);
    } else if (snapshot.status === 'NONEXISTENT') {
      stats.nonexistent++;
      console.log('⚠️  NONEXISTENT');
    } else {
      stats.error++;
      console.log(`❌ ERROR: ${snapshot.error}`);
    }

    // Rate limit: 500ms between requests
    if (i < wallets.length - 1) {
      await sleep(500);
    }
  }

  console.log('');

  // Summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Total wallets: ${snapshots.length}`);
  console.log(`  OK: ${stats.ok} (${((stats.ok / snapshots.length) * 100).toFixed(1)}%)`);
  console.log(`  NONEXISTENT: ${stats.nonexistent} (${((stats.nonexistent / snapshots.length) * 100).toFixed(1)}%)`);
  console.log(`  ERROR: ${stats.error} (${((stats.error / snapshots.length) * 100).toFixed(1)}%)`);
  console.log('');

  // Write output
  fs.writeFileSync(config.output, JSON.stringify(snapshots, null, 2));
  console.log(`✅ Snapshot written to: ${config.output}`);
  console.log('');

  // Usage instructions
  console.log('NEXT STEPS:');
  console.log('-'.repeat(100));
  console.log('Use this snapshot with comparison scripts:');
  console.log('');
  console.log(`  npx tsx scripts/pnl/compare-v23c-v29-fast.ts \\`);
  console.log(`    --truth=live \\`);
  console.log(`    --live-snapshot=${config.output} \\`);
  console.log(`    --limit=50`);
  console.log('');
  console.log('═'.repeat(100));
}

main().catch(console.error);
