/**
 * ============================================================================
 * V29 PNL ENGINE BENCHMARK TEST (v2 - WITH PROPER WARM-UP)
 * ============================================================================
 *
 * Tests the V29 engine against sampled wallets with multiple mode permutations.
 *
 * Features:
 * - Samples wallets from pm_trader_events_v2 (not ledger)
 * - Tests guard ON/OFF, rounding ON/OFF, table/view modes
 * - Supports --limit and --daysBack options
 * - Prints token mapping diagnostics per wallet (v2 trades, ledger rows, unmapped)
 * - Outputs summary table with all mode comparisons
 * - PROPER WARM-UP: Warms ALL sampled wallets before timing modes
 * - Two summaries: Full results + excluding first mode (cache warm-up)
 * - Per-wallet timing for the first mode to show cache behavior
 *
 * Run: npx tsx scripts/pnl/test-v29-benchmark.ts
 *      npx tsx scripts/pnl/test-v29-benchmark.ts --limit=10
 *      npx tsx scripts/pnl/test-v29-benchmark.ts --limit=10 --daysBack=7
 *      npx tsx scripts/pnl/test-v29-benchmark.ts --tableOnly (samples from table, no fallback)
 *
 * Terminal: Claude 1
 * Date: 2025-12-05 (updated 2025-12-06 with proper warm-up)
 */

import {
  calculateV29PnL,
  checkMaterializedTableStatus,
  sampleActiveWallets,
  sampleAllActiveWallets,
  V29Options,
  V29Result,
} from '../../lib/pnl/inventoryEngineV29';
import { clickhouse } from '../../lib/clickhouse/client';

// ============================================================================
// Configuration
// ============================================================================

interface BenchmarkConfig {
  limit: number;
  daysBack: number;
  minTrades: number;
  tableOnly: boolean; // Sample wallets from table instead of pm_trader_events_v2
}

function parseArgs(): BenchmarkConfig {
  const args = process.argv.slice(2);
  let limit = 25;
  let daysBack = 30;
  let tableOnly = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 25;
    } else if (arg.startsWith('--daysBack=')) {
      daysBack = parseInt(arg.split('=')[1], 10) || 30;
    } else if (arg === '--tableOnly') {
      tableOnly = true;
    }
  }

  return {
    limit,
    daysBack,
    minTrades: 5,
    tableOnly,
  };
}

// ============================================================================
// Token Mapping Diagnostics
// ============================================================================

interface WalletDiagnostics {
  wallet: string;
  trades_v2: number;
  ledger_rows: number;
  unmapped_trades: number;
  coverage_pct: number;
}

async function getWalletDiagnostics(wallet: string, daysBack: number): Promise<WalletDiagnostics> {
  // Count recent trades in pm_trader_events_v2
  const tradesResult = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
        AND trade_time >= now() - INTERVAL ${daysBack} DAY
    `,
    format: 'JSONEachRow',
  });
  const trades: any[] = await tradesResult.json();
  const trades_v2 = Number(trades[0]?.cnt || 0);

  // Count rows in ledger table
  const ledgerResult = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND event_time >= now() - INTERVAL ${daysBack} DAY
    `,
    format: 'JSONEachRow',
  });
  const ledger: any[] = await ledgerResult.json();
  const ledger_rows = Number(ledger[0]?.cnt || 0);

  // Count unmapped trades (trades that don't have a V5 token mapping)
  const unmappedResult = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND t.is_deleted = 0
        AND t.role = 'maker'
        AND t.trade_time >= now() - INTERVAL ${daysBack} DAY
        AND (m.condition_id IS NULL OR m.condition_id = '')
    `,
    format: 'JSONEachRow',
  });
  const unmapped: any[] = await unmappedResult.json();
  const unmapped_trades = Number(unmapped[0]?.cnt || 0);

  const coverage_pct = trades_v2 > 0 ? ((trades_v2 - unmapped_trades) / trades_v2) * 100 : 100;

  return {
    wallet,
    trades_v2,
    ledger_rows,
    unmapped_trades,
    coverage_pct,
  };
}

// ============================================================================
// Benchmark Runner
// ============================================================================

interface ModeResult {
  modeName: string;
  options: V29Options;
  results: V29Result[];
  avgRealizedPnl: number;
  avgEventsProcessed: number;
  totalClampedPositions: number;
  walletsWith0Events: number;
  walletsWithErrors: number;
  queryTimeMs: number;
}

async function runMode(
  wallets: string[],
  modeName: string,
  options: V29Options
): Promise<ModeResult> {
  const results: V29Result[] = [];
  const t0 = Date.now();

  // Print resolved options for verification
  const resolvedOpts = {
    inventoryGuard: options.inventoryGuard ?? true,
    uiRounding: options.uiRounding ?? false,
    useV8Ledger: options.useV8Ledger ?? true,
    useMaterializedTable: options.useMaterializedTable ?? true,
  };

  // DEBUG: Show which data source will be used
  let dataSource: string;
  if (resolvedOpts.useMaterializedTable) {
    dataSource = 'pm_unified_ledger_v8_tbl (TABLE)';
  } else if (resolvedOpts.useV8Ledger) {
    dataSource = 'pm_unified_ledger_v8 (VIEW - SLOW!)';
  } else {
    dataSource = 'pm_unified_ledger_v7 (VIEW - STALE!)';
  }
  console.log(`    Options: guard=${resolvedOpts.inventoryGuard}, round=${resolvedOpts.uiRounding}`);
  console.log(`    Data source: ${dataSource}`);

  for (const wallet of wallets) {
    try {
      const result = await calculateV29PnL(wallet, options);
      results.push(result);
    } catch (err: any) {
      results.push({
        wallet,
        realizedPnl: 0,
        rawRealizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        positionsCount: 0,
        openPositions: 0,
        closedPositions: 0,
        clampedPositions: 0,
        totalClampedTokens: 0,
        eventsProcessed: 0,
        errors: [err.message],
        options,
      });
    }
  }

  const queryTimeMs = Date.now() - t0;

  // Compute aggregates
  const avgRealizedPnl =
    results.reduce((sum, r) => sum + r.realizedPnl, 0) / results.length;
  const avgEventsProcessed =
    results.reduce((sum, r) => sum + r.eventsProcessed, 0) / results.length;
  const totalClampedPositions = results.reduce(
    (sum, r) => sum + r.clampedPositions,
    0
  );
  const walletsWith0Events = results.filter(
    (r) => r.eventsProcessed === 0
  ).length;
  const walletsWithErrors = results.filter((r) => r.errors.length > 0).length;

  return {
    modeName,
    options,
    results,
    avgRealizedPnl,
    avgEventsProcessed,
    totalClampedPositions,
    walletsWith0Events,
    walletsWithErrors,
    queryTimeMs,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(80));
  console.log('V29 PNL ENGINE BENCHMARK TEST');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Config: limit=${config.limit}, daysBack=${config.daysBack}, tableOnly=${config.tableOnly}`);
  console.log('');

  // Check table status
  console.log('Checking materialized table status...');
  const tableStatus = await checkMaterializedTableStatus();
  console.log(`  Table exists: ${tableStatus.exists}`);
  console.log(`  Row count: ${tableStatus.rowCount.toLocaleString()}`);
  console.log(`  Unique wallets: ${tableStatus.uniqueWallets.toLocaleString()}`);
  console.log('');

  // Sample wallets
  let wallets: string[];

  if (config.tableOnly) {
    // Sample wallets directly from the materialized table (no VIEW fallback risk)
    console.log(`Sampling ${config.limit} wallets DIRECTLY from pm_unified_ledger_v8_tbl...`);
    const walletQuery = await clickhouse.query({
      query: `
        SELECT wallet_address
        FROM pm_unified_ledger_v8_tbl
        WHERE source_type = 'CLOB'
        GROUP BY wallet_address
        HAVING count(*) >= ${config.minTrades}
        ORDER BY rand()
        LIMIT ${config.limit}
      `,
      format: 'JSONEachRow',
    });
    const walletRows: any[] = await walletQuery.json();
    wallets = walletRows.map((r) => r.wallet_address);
    console.log(`  Found ${wallets.length} wallets from table`);
  } else {
    // Sample from pm_trader_events_v2 (original behavior)
    console.log(
      `Sampling ${config.limit} active wallets (last ${config.daysBack} days, min ${config.minTrades} trades)...`
    );
    wallets = await sampleAllActiveWallets({
      limit: config.limit,
      daysBack: config.daysBack,
      minTrades: config.minTrades,
    });
    console.log(`  Found ${wallets.length} wallets from pm_trader_events_v2`);
  }
  console.log('');

  if (wallets.length === 0) {
    console.log('No wallets found! Check pm_trader_events_v2 for recent data.');
    return;
  }

  // Token mapping diagnostics (only for non-tableOnly mode)
  if (!config.tableOnly) {
    console.log('Token Mapping Diagnostics (per wallet):');
    console.log('Wallet           | v2_trades | ledger_rows | unmapped | unmapped% | coverage');
    console.log('-'.repeat(85));

    let totalTrades = 0;
    let totalUnmapped = 0;

    for (const wallet of wallets.slice(0, 5)) {
      const diag = await getWalletDiagnostics(wallet, config.daysBack);
      totalTrades += diag.trades_v2;
      totalUnmapped += diag.unmapped_trades;
      const unmappedPct = diag.trades_v2 > 0 ? (diag.unmapped_trades / diag.trades_v2 * 100) : 0;
      console.log(
        `${wallet.slice(0, 15)}... | ${diag.trades_v2.toString().padStart(9)} | ${diag.ledger_rows.toString().padStart(11)} | ${diag.unmapped_trades.toString().padStart(8)} | ${unmappedPct.toFixed(1).padStart(8)}% | ${diag.coverage_pct.toFixed(1).padStart(6)}%`
      );
    }
    if (wallets.length > 5) {
      console.log(`  ... (showing first 5 of ${wallets.length})`);
    }

    // Aggregate stats
    const avgUnmappedPct = totalTrades > 0 ? (totalUnmapped / totalTrades * 100) : 0;
    console.log('');
    console.log(`  Aggregate: ${totalUnmapped}/${totalTrades} unmapped (${avgUnmappedPct.toFixed(1)}%)`);
    console.log('');
  }

  // ============================================================================
  // WARM-UP: Run actual PnL calculation to warm all ClickHouse cache paths
  // A simple COUNT doesn't warm the JOINs/resolution queries properly
  // ============================================================================
  console.log('Warming up ClickHouse cache (running actual PnL calc on first wallet)...');
  const warmupStart = Date.now();

  // Run actual PnL calculation on first wallet to warm all code paths
  // This is more effective than a simple COUNT query because it warms:
  // 1. The ledger table query with all columns
  // 2. The resolution price JOIN query
  // 3. The pm_condition_resolutions table
  const warmupWallet = wallets[0];
  try {
    const warmupResult = await calculateV29PnL(warmupWallet, {
      inventoryGuard: true,
      useMaterializedTable: true,
    });
    console.log(`  Warmed via ${warmupWallet.slice(0, 16)}... (${warmupResult.eventsProcessed} events) in ${Date.now() - warmupStart}ms`);
  } catch (e) {
    console.log(`  Warm-up failed for ${warmupWallet.slice(0, 16)}...: ${e}`);
  }
  console.log('');

  // Define modes to test - Guard+Table is now primary since cold-start is handled
  const modes: { name: string; options: V29Options }[] = [
    // Primary mode: Guard ON, Table ON
    { name: 'Guard+Table', options: { inventoryGuard: true, useMaterializedTable: true } },

    // Guard OFF comparison
    { name: 'NoGuard+Table', options: { inventoryGuard: false, useMaterializedTable: true } },

    // Rounding mode
    { name: 'Guard+Round+Table', options: { inventoryGuard: true, uiRounding: true, useMaterializedTable: true } },

    // Fallback to V8 view (if table is empty)
    { name: 'Guard+V8View', options: { inventoryGuard: true, useMaterializedTable: false, useV8Ledger: true } },
  ];

  // Run all modes
  console.log('Running benchmark modes...');
  console.log('');

  const modeResults: ModeResult[] = [];

  for (const mode of modes) {
    process.stdout.write(`  ${mode.name.padEnd(20)}...`);
    const result = await runMode(wallets, mode.name, mode.options);
    modeResults.push(result);
    console.log(
      ` ${result.queryTimeMs}ms (${result.walletsWith0Events} empty, ${result.walletsWithErrors} errors)`
    );
  }

  console.log('');
  console.log('='.repeat(90));
  console.log('RESULTS SUMMARY (ALL MODES)');
  console.log('='.repeat(90));
  console.log('');
  console.log('NOTE: First mode may show cache warm-up overhead (see "excluding first mode" summary below)');
  console.log('');

  // Summary table (all modes)
  console.log(
    'Mode                 | Avg PnL       | Avg Events | Clamped | Empty | Errors | Time'
  );
  console.log('-'.repeat(90));

  for (const mr of modeResults) {
    const avgPnl = `$${mr.avgRealizedPnl.toFixed(2)}`.padStart(12);
    const avgEvents = mr.avgEventsProcessed.toFixed(1).padStart(10);
    const clamped = mr.totalClampedPositions.toString().padStart(7);
    const empty = mr.walletsWith0Events.toString().padStart(5);
    const errors = mr.walletsWithErrors.toString().padStart(6);
    const time = `${mr.queryTimeMs}ms`.padStart(7);
    const marker = mr === modeResults[0] ? ' (first)' : '';

    console.log(
      `${mr.modeName.padEnd(20)} | ${avgPnl} | ${avgEvents} | ${clamped} | ${empty} | ${errors} | ${time}${marker}`
    );
  }

  console.log('');

  // Summary table (excluding first mode - shows true performance)
  if (modeResults.length > 1) {
    console.log('='.repeat(90));
    console.log('RESULTS SUMMARY (EXCLUDING FIRST MODE - True Performance)');
    console.log('='.repeat(90));
    console.log('');

    console.log(
      'Mode                 | Avg PnL       | Avg Events | Clamped | Empty | Errors | Time'
    );
    console.log('-'.repeat(90));

    for (let i = 1; i < modeResults.length; i++) {
      const mr = modeResults[i];
      const avgPnl = `$${mr.avgRealizedPnl.toFixed(2)}`.padStart(12);
      const avgEvents = mr.avgEventsProcessed.toFixed(1).padStart(10);
      const clamped = mr.totalClampedPositions.toString().padStart(7);
      const empty = mr.walletsWith0Events.toString().padStart(5);
      const errors = mr.walletsWithErrors.toString().padStart(6);
      const time = `${mr.queryTimeMs}ms`.padStart(7);

      console.log(
        `${mr.modeName.padEnd(20)} | ${avgPnl} | ${avgEvents} | ${clamped} | ${empty} | ${errors} | ${time}`
      );
    }

    // Calculate average time excluding first mode
    const avgTimeExclFirst = modeResults.slice(1).reduce((sum, mr) => sum + mr.queryTimeMs, 0) / (modeResults.length - 1);
    const firstModeTime = modeResults[0].queryTimeMs;
    console.log('');
    console.log(`First mode overhead: ${firstModeTime}ms vs ${avgTimeExclFirst.toFixed(0)}ms avg (${(firstModeTime / avgTimeExclFirst).toFixed(1)}x)`);
  }

  console.log('');

  // Guard impact analysis
  const withGuard = modeResults.find((m) => m.modeName === 'Guard+Table');
  const withoutGuard = modeResults.find((m) => m.modeName === 'NoGuard+Table');

  if (withGuard && withoutGuard) {
    console.log('Inventory Guard Impact:');
    const guardDiff = withGuard.avgRealizedPnl - withoutGuard.avgRealizedPnl;
    console.log(`  Avg PnL difference: $${guardDiff.toFixed(2)}`);
    console.log(`  Total clamped positions: ${withGuard.totalClampedPositions}`);
    console.log('');
  }

  // Show wallets with 0 events (possible data issues)
  if (withGuard && withGuard.walletsWith0Events > 0) {
    console.log('Wallets with 0 events (data gap):');
    const emptyWallets = withGuard.results
      .filter((r) => r.eventsProcessed === 0)
      .slice(0, 5);
    for (const r of emptyWallets) {
      console.log(`  ${r.wallet}`);
    }
    if (withGuard.walletsWith0Events > 5) {
      console.log(`  ... and ${withGuard.walletsWith0Events - 5} more`);
    }
    console.log('');
  }

  // Show wallets with largest guard impact
  if (withGuard) {
    const walletsByClamp = withGuard.results
      .filter((r) => r.clampedPositions > 0)
      .sort((a, b) => b.totalClampedTokens - a.totalClampedTokens)
      .slice(0, 5);

    if (walletsByClamp.length > 0) {
      console.log('Wallets with most clamped tokens (guard impact):');
      for (const r of walletsByClamp) {
        console.log(
          `  ${r.wallet.slice(0, 10)}...: ${r.clampedPositions} positions, ${r.totalClampedTokens.toFixed(0)} tokens`
        );
      }
      console.log('');
    }
  }

  // Per-wallet detail for first 5
  console.log('Per-wallet details (first 5):');
  console.log('Wallet          | Guard PnL    | Raw PnL      | Events | Clamped');
  console.log('-'.repeat(75));

  for (let i = 0; i < Math.min(5, wallets.length); i++) {
    const wallet = wallets[i];
    const gr = withGuard?.results.find((r) => r.wallet === wallet);
    const nr = withoutGuard?.results.find((r) => r.wallet === wallet);

    const guardPnl = gr ? `$${gr.realizedPnl.toFixed(2)}`.padStart(12) : 'N/A'.padStart(12);
    const rawPnl = nr ? `$${nr.realizedPnl.toFixed(2)}`.padStart(12) : 'N/A'.padStart(12);
    const events = gr ? gr.eventsProcessed.toString().padStart(6) : '-'.padStart(6);
    const clamped = gr ? gr.clampedPositions.toString().padStart(7) : '-'.padStart(7);

    console.log(
      `${wallet.slice(0, 15)}... | ${guardPnl} | ${rawPnl} | ${events} | ${clamped}`
    );
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main().catch(console.error);
