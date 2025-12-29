#!/usr/bin/env npx tsx
/**
 * DOME REALIZED PNL FETCHER FOR WALLET FILE
 * ============================================================================
 *
 * PURPOSE: Fetch Dome realized PnL for wallets in a given file
 * Creates a snapshot for benchmark comparison.
 *
 * NOTE: Dome's "realized" = strict cash-realized (sell/redeem only)
 * This differs from Cascadian's synthetic realized (resolve counts)
 *
 * USAGE:
 *   npx tsx scripts/pnl/fetch-dome-realized-for-wallet-file.ts \
 *     --wallets-file=tmp/trader_strict_sample_500.json \
 *     --output=tmp/dome_realized_trader_strict_500.json \
 *     [--limit=100] \
 *     [--concurrency=3]
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  walletsFile: string;
  output: string;
  limit: number;
  concurrency: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let walletsFile = '';
  let output = '';
  let limit = 1000;
  let concurrency = 3;

  for (const arg of args) {
    if (arg.startsWith('--wallets-file=')) {
      walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 1000;
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10) || 3;
    }
  }

  if (!walletsFile) {
    console.error('ERROR: --wallets-file required');
    console.error('USAGE: npx tsx scripts/pnl/fetch-dome-realized-for-wallet-file.ts --wallets-file=<path>');
    process.exit(1);
  }

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  if (!output) {
    const baseName = walletsFile.split('/').pop()?.replace('.json', '') || 'wallets';
    output = `tmp/dome_realized_${baseName}_${dateStr}.json`;
  }

  return { walletsFile, output, limit, concurrency };
}

// ============================================================================
// Wallet Loading
// ============================================================================

function loadWallets(config: Config): string[] {
  if (!fs.existsSync(config.walletsFile)) {
    console.error(`ERROR: Wallet file not found: ${config.walletsFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(config.walletsFile, 'utf-8'));
  const wallets: string[] = [];

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
      if (typeof item === 'string') {
        wallets.push(item);
      } else if (item.wallet) {
        wallets.push(item.wallet);
      } else if (item.wallet_address) {
        wallets.push(item.wallet_address);
      }
    }
  }

  return wallets.map(w => w.toLowerCase());
}

// ============================================================================
// Dome API Client
// ============================================================================

interface DomePnlResponse {
  realizedPnl?: number;
  error?: string;
}

async function fetchDomeRealized(wallet: string): Promise<DomePnlResponse> {
  const url = `https://api.domeapi.io/v1/polymarket/wallet/pnl/${wallet}?granularity=all`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Cascadian-PnL-Validator/1.0',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'wallet_not_found' };
      }
      return { error: `http_${response.status}` };
    }

    const data = await response.json();

    // Dome returns realized PnL in the response
    // Format may vary, check common fields
    const realized = data.realizedPnl ?? data.realized_pnl ?? data.pnl?.realized ?? data.data?.realizedPnl;

    if (realized !== undefined && realized !== null) {
      return { realizedPnl: Number(realized) };
    }

    return { error: 'no_realized_field' };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ============================================================================
// Rate-limited batch processing
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBatch(
  wallets: string[],
  batchSize: number,
  delayMs: number
): Promise<{ wallet: string; realizedPnl?: number; error?: string }[]> {
  const results: { wallet: string; realizedPnl?: number; error?: string }[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (wallet) => {
        const result = await fetchDomeRealized(wallet);
        return {
          wallet,
          realizedPnl: result.realizedPnl,
          error: result.error,
        };
      })
    );

    results.push(...batchResults);

    // Progress update
    console.log(`Processed ${Math.min(i + batchSize, wallets.length)}/${wallets.length} wallets...`);

    // Rate limit delay between batches
    if (i + batchSize < wallets.length) {
      await sleep(delayMs);
    }
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(80));
  console.log('DOME REALIZED PNL FETCHER');
  console.log('═'.repeat(80));
  console.log('');
  console.log('NOTE: Dome "realized" = strict cash-realized (sell/redeem only)');
  console.log('      Differs from Cascadian synthetic realized (resolve counts)');
  console.log('');
  console.log('CONFIG:');
  console.log(`  wallets-file: ${config.walletsFile}`);
  console.log(`  output: ${config.output}`);
  console.log(`  limit: ${config.limit}`);
  console.log(`  concurrency: ${config.concurrency}`);
  console.log('');

  // Load wallets
  const wallets = loadWallets(config);
  console.log(`Loaded ${wallets.length} wallets`);
  console.log('');

  // Fetch from Dome
  console.log('Fetching from Dome API...');
  console.log('-'.repeat(80));

  const results = await processBatch(wallets, config.concurrency, 1000);

  console.log('-'.repeat(80));
  console.log('');

  // Statistics
  const successful = results.filter(r => r.realizedPnl !== undefined);
  const failed = results.filter(r => r.error);

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total wallets: ${results.length}`);
  console.log(`Successful: ${successful.length} (${(successful.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length}`);
  console.log('');

  if (failed.length > 0) {
    const errorCounts: Record<string, number> = {};
    for (const r of failed) {
      const err = r.error || 'unknown';
      errorCounts[err] = (errorCounts[err] || 0) + 1;
    }
    console.log('Error breakdown:');
    for (const [err, count] of Object.entries(errorCounts)) {
      console.log(`  ${err}: ${count}`);
    }
    console.log('');
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'Dome API (api.domeapi.io/v1/polymarket/wallet/pnl)',
      wallets_file: config.walletsFile,
      total_requested: wallets.length,
      successful: successful.length,
      failed: failed.length,
      definition: 'Dome realized = strict cash-realized from confirmed sells and redeems only',
    },
    wallets: results.map(r => ({
      wallet: r.wallet,
      dome_realized: r.realizedPnl,
      error: r.error,
    })),
  };

  fs.writeFileSync(config.output, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${config.output}`);
}

main().catch(console.error);
