/**
 * Unified PnL UI Parity Validation Harness
 *
 * This is THE SINGLE ENTRYPOINT for all PnL validation.
 * See: docs/pnl/PNL_PARITY_NORTH_STAR.md
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-ui-parity.ts [command] [args]
 *
 * Commands:
 *   clob_closed       Test CLOB-only wallets with closed positions
 *   clob_active       Test CLOB-only wallets with active positions
 *   single <wallet>   Test a single wallet with optional UI PnL
 *   sample <n>        Test n random CLOB-only wallets
 *   benchmark         Load from pm_ui_pnl_benchmarks_v1 table
 *   cohort <name>     Test a named production cohort
 *                     Available: copy_trade_ready_v1
 *
 * Options:
 *   --limit=N         Limit number of wallets to test
 *   --output=<path>   Write JSON results to file
 *   --metric=<type>   Which metric to compare: realized | total (default: realized)
 */

import * as fs from 'fs';
import * as path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';
import {
  calcRealizedClobClosedPositions,
  calcTotalClobWithActivePositions,
  calcSimpleClobCashFlow,
  isClobOnlyWallet,
  allPositionsClosed,
} from '../../lib/pnl/realizedUiStyleV2';
import { getCopyTradeReadyV1Wallets } from '../../lib/pnl/cohorts/copyTradeReadyV1';
import { computeWalletPnL } from '../../lib/pnl/pnlComposerV1';

// Parse CLI options
const rawArgs = process.argv.slice(2);
const getOption = (name: string, defaultVal: string): string => {
  const arg = rawArgs.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
};
const hasOption = (name: string): boolean =>
  rawArgs.some((a) => a.startsWith(`--${name}`));

// Canonical pass/fail rule from North Star
function passesUiParity(
  ui_pnl: number,
  our_pnl: number
): { passed: boolean; threshold_used: 'pct' | 'abs'; error: number } {
  const abs_error = Math.abs(our_pnl - ui_pnl);
  const abs_ui = Math.abs(ui_pnl);

  // Large wallets: percentage threshold
  if (abs_ui >= 200) {
    const pct_error = (abs_error / abs_ui) * 100;
    const sign_match = (ui_pnl >= 0) === (our_pnl >= 0);
    return {
      passed: pct_error <= 5 && sign_match,
      threshold_used: 'pct',
      error: pct_error,
    };
  }

  // Small wallets: absolute threshold
  return {
    passed: abs_error <= 10,
    threshold_used: 'abs',
    error: abs_error,
  };
}

interface WalletResult {
  wallet: string;
  cohort: 'CLOB_CLOSED' | 'CLOB_ACTIVE' | 'MIXED' | 'NO_DATA';
  ui_pnl: number | null;
  our_pnl: number;
  passed: boolean;
  error: number;
  threshold_used: 'pct' | 'abs';
  active_positions: number;
  closed_positions: number;
}

async function classifyWallet(
  wallet: string
): Promise<'CLOB_CLOSED' | 'CLOB_ACTIVE' | 'MIXED' | 'NO_DATA'> {
  // Check if wallet has any CLOB data
  const dataQuery = `
    SELECT count() as cnt
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
      AND source_type = 'CLOB'
  `;
  const dataResult = await clickhouse.query({ query: dataQuery, format: 'JSONEachRow' });
  const dataRows = (await dataResult.json()) as any[];
  if (dataRows.length === 0 || Number(dataRows[0].cnt) === 0) {
    return 'NO_DATA';
  }

  // Check if CLOB-only
  const isClobOnly = await isClobOnlyWallet(wallet);
  if (!isClobOnly) {
    return 'MIXED';
  }

  // Check if all positions closed
  const allClosed = await allPositionsClosed(wallet);
  return allClosed ? 'CLOB_CLOSED' : 'CLOB_ACTIVE';
}

async function validateWallet(wallet: string, ui_pnl?: number): Promise<WalletResult> {
  wallet = wallet.toLowerCase();

  // Classify wallet
  const cohort = await classifyWallet(wallet);

  if (cohort === 'NO_DATA') {
    return {
      wallet,
      cohort,
      ui_pnl: ui_pnl ?? null,
      our_pnl: 0,
      passed: false,
      error: 100,
      threshold_used: 'pct',
      active_positions: 0,
      closed_positions: 0,
    };
  }

  // Calculate PnL based on cohort
  let our_pnl: number;
  let active_positions: number;
  let closed_positions: number;

  if (cohort === 'CLOB_CLOSED') {
    // Use simple cash-flow formula for closed positions
    const result = await calcRealizedClobClosedPositions(wallet);
    our_pnl = result.realized_pnl;
    active_positions = result.active_positions;
    closed_positions = result.closed_positions;
  } else if (cohort === 'CLOB_ACTIVE') {
    // Use total formula with position value
    const result = await calcTotalClobWithActivePositions(wallet);
    our_pnl = result.total_pnl;
    active_positions = result.active_positions;
    closed_positions = result.closed_positions;
  } else {
    // MIXED: use simple cash flow as best effort
    our_pnl = await calcSimpleClobCashFlow(wallet);
    active_positions = 0;
    closed_positions = 0;
  }

  // Apply pass/fail rule
  const { passed, threshold_used, error } = ui_pnl !== undefined
    ? passesUiParity(ui_pnl, our_pnl)
    : { passed: false, threshold_used: 'pct' as const, error: 0 };

  return {
    wallet,
    cohort,
    ui_pnl: ui_pnl ?? null,
    our_pnl,
    passed,
    error,
    threshold_used,
    active_positions,
    closed_positions,
  };
}

async function getClobOnlyWallets(
  closed: boolean,
  limit: number
): Promise<string[]> {
  const query = closed
    ? `
        WITH clob_only AS (
          SELECT wallet_address
          FROM pm_unified_ledger_v8_tbl
          WHERE wallet_address != '' AND condition_id != ''
          GROUP BY wallet_address
          HAVING countIf(source_type != 'CLOB') = 0
        ),
        with_positions AS (
          SELECT
            l.wallet_address,
            sum(l.token_delta) as net_tokens,
            countDistinct(l.condition_id) as conditions
          FROM pm_unified_ledger_v8_tbl l
          WHERE l.wallet_address IN (SELECT wallet_address FROM clob_only)
            AND l.source_type = 'CLOB'
          GROUP BY l.wallet_address
          HAVING abs(net_tokens) < 0.01 AND conditions >= 3
        )
        SELECT wallet_address FROM with_positions
        ORDER BY rand() LIMIT ${limit}
      `
    : `
        WITH clob_only AS (
          SELECT wallet_address
          FROM pm_unified_ledger_v8_tbl
          WHERE wallet_address != '' AND condition_id != ''
          GROUP BY wallet_address
          HAVING countIf(source_type != 'CLOB') = 0
        ),
        with_positions AS (
          SELECT
            l.wallet_address,
            sum(l.token_delta) as net_tokens,
            countDistinct(l.condition_id) as conditions
          FROM pm_unified_ledger_v8_tbl l
          WHERE l.wallet_address IN (SELECT wallet_address FROM clob_only)
            AND l.source_type = 'CLOB'
          GROUP BY l.wallet_address
          HAVING abs(net_tokens) > 0.01 AND conditions >= 3
        )
        SELECT wallet_address FROM with_positions
        ORDER BY rand() LIMIT ${limit}
      `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet_address);
}

async function loadBenchmarkWallets(): Promise<
  Array<{ wallet: string; ui_pnl: number }>
> {
  const query = `
    SELECT wallet_address, ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE is_deleted = 0
    ORDER BY captured_at DESC
    LIMIT 100
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    return rows.map((r) => ({
      wallet: r.wallet_address,
      ui_pnl: Number(r.ui_pnl),
    }));
  } catch {
    console.log('Warning: pm_ui_pnl_benchmarks_v1 table not found or empty');
    return [];
  }
}

function printResults(results: WalletResult[]): void {
  console.log('\n=== PnL UI Parity Validation Results ===\n');
  console.log('Wallet                                    | Cohort      | UI PnL    | Our PnL   | Error  | Status');
  console.log('------------------------------------------|-------------|-----------|-----------|--------|-------');

  for (const r of results) {
    const uiStr = r.ui_pnl !== null ? `$${r.ui_pnl.toFixed(2)}`.padEnd(9) : 'N/A'.padEnd(9);
    const ourStr = `$${r.our_pnl.toFixed(2)}`.padEnd(9);
    const errStr = r.threshold_used === 'pct' ? `${r.error.toFixed(1)}%` : `$${r.error.toFixed(2)}`;
    const status = r.passed ? 'PASS' : r.ui_pnl === null ? 'NO_UI' : 'FAIL';

    console.log(
      `${r.wallet} | ${r.cohort.padEnd(11)} | ${uiStr} | ${ourStr} | ${errStr.padEnd(6)} | ${status}`
    );
  }

  // Summary
  const withUi = results.filter((r) => r.ui_pnl !== null);
  const passed = withUi.filter((r) => r.passed).length;
  const byCohort: Record<string, { total: number; passed: number }> = {};

  for (const r of withUi) {
    if (!byCohort[r.cohort]) {
      byCohort[r.cohort] = { total: 0, passed: 0 };
    }
    byCohort[r.cohort].total++;
    if (r.passed) byCohort[r.cohort].passed++;
  }

  console.log('\n=== Summary ===');
  console.log(`Total validated: ${withUi.length}`);
  console.log(`Pass: ${passed}`);
  console.log(`Fail: ${withUi.length - passed}`);
  if (withUi.length > 0) {
    console.log(`Overall Pass Rate: ${((passed / withUi.length) * 100).toFixed(1)}%`);
  }

  console.log('\n=== By Cohort ===');
  for (const [cohort, stats] of Object.entries(byCohort)) {
    const rate = ((stats.passed / stats.total) * 100).toFixed(1);
    console.log(`${cohort}: ${stats.passed}/${stats.total} (${rate}%)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'sample';

  console.log('=== PnL UI Parity Validation Harness ===');
  console.log(`Command: ${command}`);
  console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`);

  let results: WalletResult[] = [];

  switch (command) {
    case 'clob_closed': {
      console.log('Testing CLOB-only wallets with closed positions...');
      const wallets = await getClobOnlyWallets(true, 50);
      console.log(`Found ${wallets.length} wallets\n`);
      for (const wallet of wallets) {
        const result = await validateWallet(wallet);
        results.push(result);
      }
      break;
    }

    case 'clob_active': {
      console.log('Testing CLOB-only wallets with active positions...');
      const wallets = await getClobOnlyWallets(false, 50);
      console.log(`Found ${wallets.length} wallets\n`);
      for (const wallet of wallets) {
        const result = await validateWallet(wallet);
        results.push(result);
      }
      break;
    }

    case 'single': {
      const wallet = args[1];
      if (!wallet) {
        console.error('Usage: validate-ui-parity.ts single <wallet>');
        process.exit(1);
      }
      const ui_pnl = args[2] ? parseFloat(args[2]) : undefined;
      console.log(`Testing wallet: ${wallet}`);
      if (ui_pnl !== undefined) console.log(`UI PnL provided: $${ui_pnl}`);
      const result = await validateWallet(wallet, ui_pnl);
      results.push(result);
      break;
    }

    case 'sample': {
      const count = parseInt(args[1]) || 20;
      console.log(`Testing ${count} random CLOB-only wallets...`);
      const closed = await getClobOnlyWallets(true, Math.floor(count / 2));
      const active = await getClobOnlyWallets(false, Math.ceil(count / 2));
      const wallets = [...closed, ...active];
      console.log(`Found ${wallets.length} wallets\n`);
      for (const wallet of wallets) {
        const result = await validateWallet(wallet);
        results.push(result);
      }
      break;
    }

    case 'benchmark': {
      console.log('Loading benchmark wallets from pm_ui_pnl_benchmarks_v1...');
      const benchmarks = await loadBenchmarkWallets();
      if (benchmarks.length === 0) {
        console.log('No benchmarks found. Run capture script first.');
        process.exit(1);
      }
      console.log(`Found ${benchmarks.length} benchmarks\n`);
      for (const { wallet, ui_pnl } of benchmarks) {
        const result = await validateWallet(wallet, ui_pnl);
        results.push(result);
      }
      break;
    }

    case 'cohort': {
      const cohortName = args[1];
      const limit = parseInt(getOption('limit', '50'), 10);
      const metric = getOption('metric', 'realized') as 'realized' | 'total';

      if (!cohortName) {
        console.error('Usage: validate-ui-parity.ts cohort <name> [--limit=N]');
        console.log('Available cohorts: copy_trade_ready_v1');
        process.exit(1);
      }

      console.log(`Testing cohort: ${cohortName}`);
      console.log(`Limit: ${limit}`);
      console.log(`Metric: ${metric}`);

      if (cohortName === 'copy_trade_ready_v1') {
        console.log('\nFetching Copy-Trade Ready V1 cohort wallets...');
        const cohortWallets = await getCopyTradeReadyV1Wallets(limit);
        console.log(`Found ${cohortWallets.length} wallets\n`);

        let i = 0;
        for (const wallet of cohortWallets) {
          i++;
          try {
            // Progress logging every wallet
            console.log(
              `[${i}/${cohortWallets.length}] ${wallet.wallet_address.slice(0, 10)}...`
            );

            // Use PnL Composer for cohort validation
            const pnlResult = await computeWalletPnL(wallet.wallet_address, {});

            const ourPnl = metric === 'total' ? pnlResult.total_pnl : pnlResult.realized_pnl;

            console.log(`  -> realized=$${ourPnl.toFixed(2)}`);

            // For cohort validation, we don't have UI PnL values yet
            // Mark as needing UI scraping
            results.push({
              wallet: wallet.wallet_address,
              cohort: 'CLOB_CLOSED', // Cohort filter ensures this
              ui_pnl: null,
              our_pnl: ourPnl,
              passed: false,
              error: 0,
              threshold_used: 'pct',
              active_positions: 0, // Cohort filter ensures closed
              closed_positions: wallet.market_count,
            });
          } catch (err) {
            console.warn(`Warning: Failed to compute PnL for ${wallet.wallet_address}: ${err}`);
          }
        }
      } else {
        console.error(`Unknown cohort: ${cohortName}`);
        console.log('Available cohorts: copy_trade_ready_v1');
        process.exit(1);
      }
      break;
    }

    case 'cohort_benchmark': {
      const cohortName = args[1];
      const limit = parseInt(getOption('limit', '50'), 10);
      const metric = getOption('metric', 'realized') as 'realized' | 'total';
      const uiJsonPath = getOption('ui-json', '');

      if (!cohortName) {
        console.error('Usage: validate-ui-parity.ts cohort_benchmark <name> [--limit=N] [--ui-json=path]');
        console.log('Available cohorts: copy_trade_ready_v1');
        process.exit(1);
      }

      console.log(`Testing cohort with benchmarks: ${cohortName}`);
      console.log(`Limit: ${limit}`);
      console.log(`Metric: ${metric}`);

      // Load UI benchmarks from JSON file if provided
      let uiBenchmarks: Map<string, number> = new Map();
      if (uiJsonPath && fs.existsSync(uiJsonPath)) {
        console.log(`Loading UI benchmarks from: ${uiJsonPath}`);
        const uiData = JSON.parse(fs.readFileSync(uiJsonPath, 'utf-8'));
        if (Array.isArray(uiData)) {
          for (const entry of uiData) {
            if (entry.wallet && typeof entry.ui_pnl === 'number') {
              uiBenchmarks.set(entry.wallet.toLowerCase(), entry.ui_pnl);
            }
          }
        } else if (uiData.results && Array.isArray(uiData.results)) {
          for (const entry of uiData.results) {
            if (entry.wallet && typeof entry.ui_pnl === 'number') {
              uiBenchmarks.set(entry.wallet.toLowerCase(), entry.ui_pnl);
            }
          }
        }
        console.log(`Loaded ${uiBenchmarks.size} UI benchmarks`);
      }

      // Also load from ClickHouse benchmark table
      const benchmarkQuery = `
        SELECT wallet_address, ui_pnl
        FROM pm_ui_pnl_benchmarks_v1
        WHERE benchmark_set LIKE '%copy_trade%' OR benchmark_set LIKE '%${cohortName}%'
        ORDER BY captured_at DESC
      `;
      try {
        const benchResult = await clickhouse.query({ query: benchmarkQuery });
        const benchRows = (await benchResult.json()) as any[];
        for (const row of benchRows) {
          if (!uiBenchmarks.has(row.wallet_address.toLowerCase())) {
            uiBenchmarks.set(row.wallet_address.toLowerCase(), Number(row.ui_pnl));
          }
        }
        if (benchRows.length > 0) {
          console.log(`Loaded ${benchRows.length} benchmarks from ClickHouse`);
        }
      } catch {
        console.log('No benchmarks found in ClickHouse table');
      }

      if (cohortName === 'copy_trade_ready_v1') {
        console.log('\nFetching Copy-Trade Ready V1 cohort wallets...');
        const cohortWallets = await getCopyTradeReadyV1Wallets(limit);
        console.log(`Found ${cohortWallets.length} wallets\n`);

        let i = 0;
        for (const wallet of cohortWallets) {
          i++;
          try {
            console.log(
              `[${i}/${cohortWallets.length}] ${wallet.wallet_address.slice(0, 10)}...`
            );

            const pnlResult = await computeWalletPnL(wallet.wallet_address, {});
            const ourPnl = metric === 'total' ? pnlResult.total_pnl : pnlResult.realized_pnl;

            // Check if we have a UI benchmark for this wallet
            const uiPnl = uiBenchmarks.get(wallet.wallet_address.toLowerCase()) ?? null;
            let passed = false;
            let error = 0;

            if (uiPnl !== null) {
              const parityResult = passesUiParity(uiPnl, ourPnl);
              passed = parityResult.passed;
              error = parityResult.error;
              console.log(
                `  -> our=$${ourPnl.toFixed(2)} ui=$${uiPnl.toFixed(2)} err=${(error * 100).toFixed(1)}% ${passed ? '✓' : '✗'}`
              );
            } else {
              console.log(`  -> our=$${ourPnl.toFixed(2)} (no UI benchmark)`);
            }

            results.push({
              wallet: wallet.wallet_address,
              cohort: 'CLOB_CLOSED',
              ui_pnl: uiPnl,
              our_pnl: ourPnl,
              passed,
              error,
              threshold_used: uiPnl !== null ? 'pct' : 'none',
              active_positions: 0,
              closed_positions: wallet.market_count,
            });
          } catch (err) {
            console.warn(`Warning: Failed to compute PnL for ${wallet.wallet_address}: ${err}`);
          }
        }
      } else {
        console.error(`Unknown cohort: ${cohortName}`);
        console.log('Available cohorts: copy_trade_ready_v1');
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Available commands: clob_closed, clob_active, single, sample, benchmark, cohort, cohort_benchmark');
      process.exit(1);
  }

  printResults(results);

  // Output URLs for Playwright scraping if no UI values
  const needsUi = results.filter((r) => r.ui_pnl === null);
  if (needsUi.length > 0) {
    console.log('\n=== Polymarket URLs for UI Scraping ===');
    for (const r of needsUi) {
      console.log(`https://polymarket.com/${r.wallet}`);
    }
  }

  // Write JSON output if requested
  const outputPath = getOption('output', '');
  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const output = {
      metadata: {
        command,
        date: new Date().toISOString(),
        metric: getOption('metric', 'realized'),
        total_wallets: results.length,
        with_ui_pnl: results.filter((r) => r.ui_pnl !== null).length,
        passed: results.filter((r) => r.passed).length,
      },
      results,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults written to: ${outputPath}`);
  }

  process.exit(0);
}

main().catch(console.error);
