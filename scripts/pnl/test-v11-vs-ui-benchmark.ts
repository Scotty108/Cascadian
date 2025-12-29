#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * TEST V11 (POLYMARKET SUBGRAPH ENGINE) VS UI BENCHMARK
 * ============================================================================
 *
 * Runs V11 engine against UI truth for a cohort of wallets.
 * Tests both WITH and WITHOUT ERC1155 transfers to isolate transfer impact.
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents, EngineOptions } from '../../lib/pnl/polymarketSubgraphEngine';

interface UiBenchmark {
  wallet: string;
  profit_loss?: number;
  uiPnL?: number;
  positions_value?: number;
  volume?: number;
  markets_traded?: number;
  captured_at?: string;
  success?: boolean;
}

interface ValidationResult {
  wallet: string;
  ui_pnl: number;
  v11_with_transfers: number;
  v11_without_transfers: number;
  err_with_transfers: number;
  err_without_transfers: number;
  pct_err_with: number;
  pct_err_without: number;
  transfer_impact: number;
  has_transfers: boolean;
}

async function loadUiBenchmarks(filePath: string): Promise<UiBenchmark[]> {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Helper to get PnL value from wallet entry
  const getPnL = (w: UiBenchmark): number | null => {
    if (w.uiPnL !== undefined && w.uiPnL !== null) return w.uiPnL;
    if (w.profit_loss !== undefined && w.profit_loss !== null) return w.profit_loss;
    return null;
  };

  // Helper to filter valid entries
  const filterValid = (arr: UiBenchmark[]): UiBenchmark[] => {
    return arr.filter(w => {
      const pnl = getPnL(w);
      const hasValidPnL = pnl !== null;
      const isSuccessful = w.success !== false; // allow if undefined or true
      return hasValidPnL && isSuccessful;
    });
  };

  // Handle different formats
  if (Array.isArray(data)) {
    return filterValid(data);
  }
  if (data.wallets) {
    return filterValid(data.wallets);
  }
  if (data.results) {
    return filterValid(data.results);
  }

  throw new Error('Unknown benchmark file format');
}

async function getTransferIntensity(client: ReturnType<typeof getClickHouseClient>, wallet: string): Promise<number> {
  const tables = ['pm_erc1155_transfers', 'pm_erc1155_transfers_v5'];

  for (const table of tables) {
    try {
      const query = `
        SELECT count() as transfer_count
        FROM ${table}
        WHERE lower(from_address) = lower('${wallet}')
           OR lower(to_address) = lower('${wallet}')
      `;
      const result = await client.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<Array<{ transfer_count: string }>>();
      return parseInt(rows[0]?.transfer_count || '0');
    } catch {
      // Table doesn't exist, try next
    }
  }

  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const benchmarkFile = args.find(a => a.startsWith('--file='))?.split('=')[1]
    || 'tmp/ui_pnl_live_snapshot_2025_12_07_100.json';
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '100');

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   V11 (POLYMARKET SUBGRAPH ENGINE) VS UI BENCHMARK');
  console.log('════════════════════════════════════════════════════════════\n');

  const client = getClickHouseClient();

  // Load UI benchmarks
  console.log(`📂 Loading benchmarks from ${benchmarkFile}...`);
  const benchmarks = await loadUiBenchmarks(benchmarkFile);
  const walletsToTest = benchmarks.slice(0, limit);
  console.log(`✅ Loaded ${benchmarks.length} wallets, testing ${walletsToTest.length}\n`);

  const results: ValidationResult[] = [];

  // Helper to get PnL from wallet entry
  const getPnL = (w: UiBenchmark): number => {
    if (w.uiPnL !== undefined && w.uiPnL !== null) return w.uiPnL;
    if (w.profit_loss !== undefined && w.profit_loss !== null) return w.profit_loss;
    return 0;
  };

  for (let i = 0; i < walletsToTest.length; i++) {
    const w = walletsToTest[i];
    const wallet = w.wallet.toLowerCase();
    const uiPnl = getPnL(w);

    process.stdout.write(`\r[${i + 1}/${walletsToTest.length}] Testing ${wallet.slice(0, 10)}...`);

    try {
      // Load events for this wallet
      const eventsWithTransfers = await loadPolymarketPnlEventsForWallet(wallet, {
        includeSyntheticRedemptions: true,
        includeTransfers: true
      });

      const eventsWithoutTransfers = await loadPolymarketPnlEventsForWallet(wallet, {
        includeSyntheticRedemptions: true,
        includeTransfers: false
      });

      // Run V11 WITH transfers
      const v11With = computeWalletPnlFromEvents(wallet, eventsWithTransfers, { mode: 'ui_like' });

      // Run V11 WITHOUT transfers
      const v11Without = computeWalletPnlFromEvents(wallet, eventsWithoutTransfers, { mode: 'ui_like' });

      // Get transfer count for this wallet
      const transferCount = await getTransferIntensity(client, wallet);

      const errWith = Math.abs(v11With.realizedPnl - uiPnl);
      const errWithout = Math.abs(v11Without.realizedPnl - uiPnl);
      const denom = Math.max(Math.abs(uiPnl), 1);

      results.push({
        wallet,
        ui_pnl: uiPnl,
        v11_with_transfers: v11With.realizedPnl,
        v11_without_transfers: v11Without.realizedPnl,
        err_with_transfers: errWith,
        err_without_transfers: errWithout,
        pct_err_with: (errWith / denom) * 100,
        pct_err_without: (errWithout / denom) * 100,
        transfer_impact: v11With.realizedPnl - v11Without.realizedPnl,
        has_transfers: transferCount > 0
      });
    } catch (err) {
      console.error(`\n❌ Error for ${wallet}: ${err}`);
    }
  }

  console.log('\n\n════════════════════════════════════════════════════════════');
  console.log('   RESULTS SUMMARY');
  console.log('════════════════════════════════════════════════════════════\n');

  // Calculate pass rates
  const passThreshold = 6; // <6% error = pass

  const passWithTransfers = results.filter(r => r.pct_err_with < passThreshold).length;
  const passWithoutTransfers = results.filter(r => r.pct_err_without < passThreshold).length;

  const exactWithTransfers = results.filter(r => r.err_with_transfers < 1).length;
  const exactWithoutTransfers = results.filter(r => r.err_without_transfers < 1).length;

  console.log('WITH TRANSFERS:');
  console.log(`  Pass rate (<${passThreshold}%): ${passWithTransfers}/${results.length} (${(passWithTransfers/results.length*100).toFixed(1)}%)`);
  console.log(`  Exact match (<$1): ${exactWithTransfers}/${results.length} (${(exactWithTransfers/results.length*100).toFixed(1)}%)`);
  console.log(`  Median error: $${median(results.map(r => r.err_with_transfers)).toFixed(2)}`);
  console.log(`  Median pct error: ${median(results.map(r => r.pct_err_with)).toFixed(2)}%`);

  console.log('\nWITHOUT TRANSFERS:');
  console.log(`  Pass rate (<${passThreshold}%): ${passWithoutTransfers}/${results.length} (${(passWithoutTransfers/results.length*100).toFixed(1)}%)`);
  console.log(`  Exact match (<$1): ${exactWithoutTransfers}/${results.length} (${(exactWithoutTransfers/results.length*100).toFixed(1)}%)`);
  console.log(`  Median error: $${median(results.map(r => r.err_without_transfers)).toFixed(2)}`);
  console.log(`  Median pct error: ${median(results.map(r => r.pct_err_without)).toFixed(2)}%`);

  // Transfer impact analysis
  const hasTransferImpact = results.filter(r => Math.abs(r.transfer_impact) > 1);
  console.log('\nTRANSFER IMPACT:');
  console.log(`  Wallets with transfer impact (>$1): ${hasTransferImpact.length}/${results.length}`);
  console.log(`  Median transfer impact: $${median(results.map(r => Math.abs(r.transfer_impact))).toFixed(2)}`);

  // Breakdown: transfer-heavy vs transfer-light
  const hasTransfers = results.filter(r => r.has_transfers);
  const noTransfers = results.filter(r => !r.has_transfers);

  console.log('\nBY TRANSFER PRESENCE:');
  if (hasTransfers.length > 0) {
    const passHas = hasTransfers.filter(r => r.pct_err_with < passThreshold).length;
    console.log(`  Has transfers (${hasTransfers.length}): Pass rate ${(passHas/hasTransfers.length*100).toFixed(1)}%, Median err $${median(hasTransfers.map(r => r.err_with_transfers)).toFixed(0)}`);
  }
  if (noTransfers.length > 0) {
    const passNo = noTransfers.filter(r => r.pct_err_with < passThreshold).length;
    console.log(`  No transfers (${noTransfers.length}): Pass rate ${(passNo/noTransfers.length*100).toFixed(1)}%, Median err $${median(noTransfers.map(r => r.err_with_transfers)).toFixed(0)}`);
  }

  // Top 10 best matches
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   TOP 10 BEST MATCHES (WITH TRANSFERS)');
  console.log('════════════════════════════════════════════════════════════\n');

  const sorted = [...results].sort((a, b) => a.err_with_transfers - b.err_with_transfers);
  console.log('Wallet                                     | UI PnL       | V11 PnL      | Error    | Xfer Impact');
  console.log('-------------------------------------------|--------------|--------------|----------|------------');
  for (let i = 0; i < 10 && i < sorted.length; i++) {
    const r = sorted[i];
    console.log(
      `${r.wallet} | $${r.ui_pnl.toFixed(2).padStart(10)} | $${r.v11_with_transfers.toFixed(2).padStart(10)} | $${r.err_with_transfers.toFixed(2).padStart(6)} | $${r.transfer_impact.toFixed(2)}`
    );
  }

  // Worst 10
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   WORST 10 MATCHES (WITH TRANSFERS)');
  console.log('════════════════════════════════════════════════════════════\n');

  const worst = [...results].sort((a, b) => b.err_with_transfers - a.err_with_transfers);
  console.log('Wallet                                     | UI PnL       | V11 PnL      | Error      | Xfer Impact');
  console.log('-------------------------------------------|--------------|--------------|------------|------------');
  for (let i = 0; i < 10 && i < worst.length; i++) {
    const r = worst[i];
    console.log(
      `${r.wallet} | $${r.ui_pnl.toFixed(2).padStart(10)} | $${r.v11_with_transfers.toFixed(2).padStart(10)} | $${r.err_with_transfers.toFixed(0).padStart(8)} | $${r.transfer_impact.toFixed(0)}`
    );
  }

  // Save results
  const outputFile = 'tmp/v11_vs_ui_benchmark_results.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    benchmark_file: benchmarkFile,
    total_wallets: results.length,
    summary: {
      with_transfers: {
        pass_rate: passWithTransfers / results.length,
        exact_match_rate: exactWithTransfers / results.length,
        median_error_usd: median(results.map(r => r.err_with_transfers)),
        median_pct_error: median(results.map(r => r.pct_err_with))
      },
      without_transfers: {
        pass_rate: passWithoutTransfers / results.length,
        exact_match_rate: exactWithoutTransfers / results.length,
        median_error_usd: median(results.map(r => r.err_without_transfers)),
        median_pct_error: median(results.map(r => r.pct_err_without))
      }
    },
    results
  }, null, 2));

  console.log(`\n✅ Results saved to ${outputFile}\n`);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
