/**
 * Benchmark Cost Basis Engine vs ALL 133 unique wallets across benchmark sets
 *
 * Tests maker-only cost basis (should match V6 behavior)
 *
 * Run with: npx tsx scripts/pnl/benchmark-cost-basis-all-133.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

interface BenchmarkWallet {
  addr: string;
  uiPnl: number;
  benchmarkSet: string;
}

interface TestResult {
  wallet: string;
  benchmarkSet: string;
  trades: number;
  positions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  uiPnl: number;
  errorPct: number;
  absErrorPct: number;
  externalSells: number;
}

async function loadAllBenchmarkWallets(client: any): Promise<BenchmarkWallet[]> {
  // Get most recent benchmark per wallet (in case duplicates across sets)
  const result = await client.query({
    query: `
      SELECT
        wallet,
        argMax(pnl_value, captured_at) as pnl_value,
        argMax(benchmark_set, captured_at) as benchmark_set
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY wallet
      ORDER BY pnl_value DESC
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    addr: r.wallet,
    uiPnl: Number(r.pnl_value),
    benchmarkSet: r.benchmark_set,
  }));
}

// Resolution loading now uses loadResolutionsStrict() from lib/pnl/loadResolutionsStrict.ts
// This properly filters out empty payout_numerators that were causing unresolved markets
// to be treated as total losses (payout=0)

async function loadMakerTrades(client: any, wallet: string): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      )
      SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

function processWallet(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): {
  totalRealized: number;
  totalUnrealized: number;
  totalExternal: number;
  positionCount: number;
} {
  const positions = new Map<string, Position>();
  let totalExternal = 0;

  for (const t of trades) {
    const tokenId = t.token_id;
    let position = positions.get(tokenId) || emptyPosition(wallet, tokenId);
    const price =
      Number(t.token_amount) > 0
        ? Number(t.usdc_amount) / Number(t.token_amount)
        : 0;

    if (t.side === 'buy') {
      position = updateWithBuy(position, Number(t.token_amount), price);
    } else {
      const { position: newPos, result } = updateWithSell(
        position,
        Number(t.token_amount),
        price
      );
      position = newPos;
      totalExternal += result.externalSell;
    }
    positions.set(tokenId, position);
  }

  let totalRealized = 0;
  let totalUnrealized = 0;

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      totalUnrealized += pos.amount * (payout - pos.avgPrice);
    }
  }

  return {
    totalRealized,
    totalUnrealized,
    totalExternal,
    positionCount: positions.size,
  };
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   COST BASIS BENCHMARK - ALL 133 UNIQUE WALLETS (MAKER-ONLY)               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  // Load data
  console.log('\nLoading benchmark wallets...');
  const wallets = await loadAllBenchmarkWallets(client);
  console.log(`Loaded ${wallets.length} unique wallets`);

  console.log('Loading resolutions (strict mode - filters empty payout_numerators)...');
  const { resolutions, stats } = await loadResolutionsStrict();
  console.log(`Resolution stats:`);
  console.log(`  Fully resolved: ${stats.fullyResolved.toLocaleString()}`);
  console.log(`  Unresolved (excluded): ${stats.unresolvedEmpty.toLocaleString()}`);
  console.log(`  Loaded to map: ${resolutions.size.toLocaleString()}`);

  // Process all wallets with retry logic
  console.log('\nProcessing wallets...\n');
  const results: TestResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];

    let trades: any[] = [];
    let retries = 3;
    while (retries > 0) {
      try {
        trades = await loadMakerTrades(client, w.addr);
        break;
      } catch (err: any) {
        retries--;
        if (retries === 0) {
          console.log(`\nFailed to load trades for ${w.addr.slice(0, 10)}: ${err.message}`);
          trades = [];
        } else {
          await new Promise((r) => setTimeout(r, 1000)); // Wait 1 second before retry
        }
      }
    }

    const processed = processWallet(w.addr, trades, resolutions);

    const totalPnl = processed.totalRealized + processed.totalUnrealized;
    const errorPct = w.uiPnl !== 0 ? ((totalPnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;

    results.push({
      wallet: w.addr,
      benchmarkSet: w.benchmarkSet,
      trades: trades.length,
      positions: processed.positionCount,
      realizedPnl: processed.totalRealized,
      unrealizedPnl: processed.totalUnrealized,
      totalPnl,
      uiPnl: w.uiPnl,
      errorPct,
      absErrorPct: Math.abs(errorPct),
      externalSells: processed.totalExternal,
    });

    // Progress indicator
    if ((i + 1) % 10 === 0 || i === wallets.length - 1) {
      process.stdout.write(`\rProcessed ${i + 1}/${wallets.length} wallets`);
    }

    // Small delay between wallets to avoid connection issues
    if (i % 10 === 0 && i > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  console.log('\n');

  // Sort by absolute error
  results.sort((a, b) => a.absErrorPct - b.absErrorPct);

  // Summary stats
  const within1 = results.filter((r) => r.absErrorPct <= 1).length;
  const within5 = results.filter((r) => r.absErrorPct <= 5).length;
  const within10 = results.filter((r) => r.absErrorPct <= 10).length;
  const errors = results.map((r) => r.absErrorPct).sort((a, b) => a - b);
  const median = errors[Math.floor(errors.length / 2)];
  const max = errors[errors.length - 1];

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY STATISTICS                                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total wallets: ${results.length}`);
  console.log(`Within 1% error:  ${within1}/${results.length} (${((within1 / results.length) * 100).toFixed(1)}%)`);
  console.log(`Within 5% error:  ${within5}/${results.length} (${((within5 / results.length) * 100).toFixed(1)}%)`);
  console.log(`Within 10% error: ${within10}/${results.length} (${((within10 / results.length) * 100).toFixed(1)}%)`);
  console.log(`Median absolute error: ${median.toFixed(2)}%`);
  console.log(`Max absolute error: ${max.toFixed(2)}%`);

  // Top 20 best results
  console.log('\n\n=== TOP 20 BEST (lowest error) ===\n');
  console.log('| Wallet | UI PnL | Engine PnL | Error |');
  console.log('|--------|--------|------------|-------|');
  for (const r of results.slice(0, 20)) {
    const uiStr = `$${(r.uiPnl / 1e6).toFixed(2)}M`;
    const engStr = `$${(r.totalPnl / 1e6).toFixed(2)}M`;
    const errStr = `${r.errorPct.toFixed(2)}%`;
    console.log(`| ${r.wallet.slice(0, 8)}.. | ${uiStr.padStart(6)} | ${engStr.padStart(10)} | ${errStr.padStart(5)} |`);
  }

  // Bottom 20 worst results
  console.log('\n\n=== TOP 20 WORST (highest error) ===\n');
  console.log('| Wallet | UI PnL | Engine PnL | Error | Set |');
  console.log('|--------|--------|------------|-------|-----|');
  for (const r of results.slice(-20).reverse()) {
    const uiStr = `$${(r.uiPnl / 1e6).toFixed(2)}M`;
    const engStr = `$${(r.totalPnl / 1e6).toFixed(2)}M`;
    const errStr = `${r.errorPct.toFixed(2)}%`;
    const setShort = r.benchmarkSet.slice(0, 15);
    console.log(`| ${r.wallet.slice(0, 8)}.. | ${uiStr.padStart(6)} | ${engStr.padStart(10)} | ${errStr.padStart(7)} | ${setShort} |`);
  }

  // Distribution by benchmark set
  console.log('\n\n=== RESULTS BY BENCHMARK SET ===\n');
  const bySet = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = bySet.get(r.benchmarkSet) || [];
    arr.push(r);
    bySet.set(r.benchmarkSet, arr);
  }

  for (const [set, setResults] of bySet) {
    const sw1 = setResults.filter((r) => r.absErrorPct <= 1).length;
    const sw5 = setResults.filter((r) => r.absErrorPct <= 5).length;
    const sw10 = setResults.filter((r) => r.absErrorPct <= 10).length;
    const setMedian = setResults.map((r) => r.absErrorPct).sort((a, b) => a - b)[Math.floor(setResults.length / 2)];
    console.log(`${set}:`);
    console.log(`  Wallets: ${setResults.length}, ≤1%: ${sw1}, ≤5%: ${sw5}, ≤10%: ${sw10}, Median: ${setMedian.toFixed(2)}%`);
  }
}

main().catch(console.error);
