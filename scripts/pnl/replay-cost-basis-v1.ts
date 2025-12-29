/**
 * Cost Basis Engine Replay Script V1
 *
 * Replays events through the cost basis engine for validation against UI PnL.
 *
 * Usage:
 *   npx tsx scripts/pnl/replay-cost-basis-v1.ts
 *   npx tsx scripts/pnl/replay-cost-basis-v1.ts --wallet 0x1234...
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  CostBasisEngine,
  LedgerEvent,
  createCostBasisEngine,
} from '../../lib/pnl/costBasisEngine';

// ============================================================================
// Validation Set
// ============================================================================

// 18 Leaderboard wallets (high performers)
const LEADERBOARD_WALLETS = [
  '0x9e31628cd2e0a132ad50f34ff5e4f0fccde49c1b', // Wallet 1
  '0x2b8b4c3456789abcdef1234567890abcdef12345', // Placeholder - will be populated
  // Add remaining leaderboard wallets
];

// Test wallets with known UI PnL (from benchmarks)
const TEST_WALLETS_WITH_BENCHMARKS = [
  { wallet: '0x56bf1a64a14601aff2de20bb01045aed8da6c45a', name: 'JustDoIt', uiPnl: 1519.31 },
  { wallet: '0xf1302aafc43aa3a69bcd8058fc7a0259dac246ab', name: 'TraderRed (MM)', uiPnl: 148649.77 },
  { wallet: '0xeef3b6bd2297a469a9c2f05c2e62ea24f93dcfea', name: 'ImJustKen', uiPnl: 47426.30 },
];

// ============================================================================
// Data Loading
// ============================================================================

async function loadWalletEvents(wallet: string): Promise<LedgerEvent[]> {
  const query = `
    SELECT
      wallet_address,
      canonical_condition_id,
      outcome_index,
      source_type,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_norm
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${wallet}')
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
    ORDER BY event_time, event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows: any[] = await result.json();

  return rows.map((row) => ({
    wallet_address: row.wallet_address,
    canonical_condition_id: row.canonical_condition_id,
    outcome_index: Number(row.outcome_index),
    source_type: row.source_type as LedgerEvent['source_type'],
    event_time: new Date(row.event_time),
    event_id: row.event_id,
    usdc_delta: Number(row.usdc_delta),
    token_delta: Number(row.token_delta),
    payout_norm: row.payout_norm !== null ? Number(row.payout_norm) : null,
  }));
}

async function loadMultipleWalletEvents(wallets: string[]): Promise<LedgerEvent[]> {
  const walletList = wallets.map((w) => `'${w.toLowerCase()}'`).join(',');

  const query = `
    SELECT
      wallet_address,
      canonical_condition_id,
      outcome_index,
      source_type,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_norm
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) IN (${walletList})
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
    ORDER BY wallet_address, event_time, event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows: any[] = await result.json();

  return rows.map((row) => ({
    wallet_address: row.wallet_address,
    canonical_condition_id: row.canonical_condition_id,
    outcome_index: Number(row.outcome_index),
    source_type: row.source_type as LedgerEvent['source_type'],
    event_time: new Date(row.event_time),
    event_id: row.event_id,
    usdc_delta: Number(row.usdc_delta),
    token_delta: Number(row.token_delta),
    payout_norm: row.payout_norm !== null ? Number(row.payout_norm) : null,
  }));
}

// ============================================================================
// UI PnL Fetching (from benchmarks table)
// ============================================================================

async function getUiPnlFromBenchmarks(
  wallets: string[]
): Promise<Map<string, number>> {
  const walletList = wallets.map((w) => `'${w.toLowerCase()}'`).join(',');

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      ui_pnl_usdc
    FROM pm_ui_pnl_benchmarks_v1
    WHERE lower(wallet_address) IN (${walletList})
    ORDER BY captured_at DESC
    LIMIT 1 BY wallet
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows: any[] = await result.json();

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.wallet, Number(row.ui_pnl_usdc));
    }
    return map;
  } catch (err) {
    console.warn('Could not fetch UI benchmarks:', err);
    return new Map();
  }
}

// ============================================================================
// Event Statistics
// ============================================================================

interface EventStats {
  total: number;
  byClobType: { buys: number; sells: number };
  bySourceType: Record<string, number>;
}

function computeEventStats(events: LedgerEvent[]): EventStats {
  const stats: EventStats = {
    total: events.length,
    byClobType: { buys: 0, sells: 0 },
    bySourceType: {},
  };

  for (const e of events) {
    stats.bySourceType[e.source_type] =
      (stats.bySourceType[e.source_type] || 0) + 1;

    if (e.source_type === 'CLOB') {
      if (e.token_delta > 0) {
        stats.byClobType.buys++;
      } else {
        stats.byClobType.sells++;
      }
    }
  }

  return stats;
}

// ============================================================================
// Main Validation
// ============================================================================

async function validateWallet(
  wallet: string,
  name: string,
  knownUiPnl?: number
): Promise<{
  wallet: string;
  name: string;
  costBasisPnl: number;
  uiPnl: number | null;
  error: number | null;
  errorPct: string | null;
  eventsProcessed: number;
  openPositions: number;
  closedPositions: number;
  engineErrors: string[];
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${name} (${wallet.slice(0, 10)}...)`);
  console.log('='.repeat(60));

  // Load events
  const events = await loadWalletEvents(wallet);
  console.log(`Loaded ${events.length} events`);

  // Compute stats
  const stats = computeEventStats(events);
  console.log(`  Source types: ${JSON.stringify(stats.bySourceType)}`);
  console.log(`  CLOB: ${stats.byClobType.buys} buys, ${stats.byClobType.sells} sells`);

  // Run through cost basis engine
  const engine = createCostBasisEngine();
  engine.processEvents(events);

  // Get results
  const result = engine.getWalletResult(wallet);

  console.log(`\nCost Basis Engine Results:`);
  console.log(`  Realized PnL:   $${result.totalRealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Open positions: ${result.openPositions}`);
  console.log(`  Closed:         ${result.closedPositions}`);
  console.log(`  Errors:         ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log(`  First 5 errors:`);
    result.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
  }

  // Compare to UI
  let uiPnl = knownUiPnl ?? null;
  let error: number | null = null;
  let errorPct: string | null = null;

  if (uiPnl !== null) {
    error = result.totalRealizedPnl - uiPnl;
    errorPct =
      uiPnl !== 0
        ? ((error / uiPnl) * 100).toFixed(1) + '%'
        : error === 0
          ? '0%'
          : 'N/A';

    console.log(`\nUI Comparison:`);
    console.log(`  UI PnL:         $${uiPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Error:          $${error.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${errorPct})`);

    const passThreshold = Math.abs((error / uiPnl) * 100) <= 5;
    console.log(`  Status:         ${passThreshold ? 'PASS ✓' : 'FAIL ✗'}`);
  }

  // Debug: Show largest positions
  const positions = engine.getPositionDetails(wallet);
  const sortedByPnl = positions.sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl));

  console.log(`\nTop 5 positions by realized PnL:`);
  sortedByPnl.slice(0, 5).forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${p.conditionId.slice(0, 16)}... outcome=${p.outcomeIndex} ` +
        `qty=${p.qtyTokens.toFixed(2)} cost=$${p.costBasis.toFixed(2)} pnl=$${p.realizedPnl.toFixed(2)}`
    );
  });

  return {
    wallet,
    name,
    costBasisPnl: result.totalRealizedPnl,
    uiPnl,
    error,
    errorPct,
    eventsProcessed: events.length,
    openPositions: result.openPositions,
    closedPositions: result.closedPositions,
    engineErrors: result.errors,
  };
}

async function runFullValidation(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           COST BASIS ENGINE V1 - VALIDATION RUN              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  const results = [];

  // Process test wallets with known UI PnL
  for (const testWallet of TEST_WALLETS_WITH_BENCHMARKS) {
    const result = await validateWallet(
      testWallet.wallet,
      testWallet.name,
      testWallet.uiPnl
    );
    results.push(result);
  }

  // Summary
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  console.log('Wallet                 | Cost Basis PnL | UI PnL      | Error     | Status');
  console.log('-'.repeat(80));

  let passed = 0;
  let total = 0;

  for (const r of results) {
    if (r.uiPnl !== null) {
      total++;
      const passThreshold = r.error !== null && r.uiPnl !== 0
        ? Math.abs((r.error / r.uiPnl) * 100) <= 5
        : false;
      if (passThreshold) passed++;

      console.log(
        `${r.name.padEnd(22)} | $${r.costBasisPnl.toFixed(2).padStart(12)} | $${r.uiPnl.toFixed(2).padStart(10)} | ${(r.errorPct ?? 'N/A').padStart(9)} | ${passThreshold ? 'PASS ✓' : 'FAIL ✗'}`
      );
    }
  }

  console.log('-'.repeat(80));
  console.log(`\nPass Rate: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Target: 90% of wallets within 5% error`);
}

async function runSingleWallet(wallet: string): Promise<void> {
  console.log(`Running cost basis engine for single wallet: ${wallet}`);

  // Try to get UI PnL from benchmarks
  const benchmarks = await getUiPnlFromBenchmarks([wallet]);
  const uiPnl = benchmarks.get(wallet.toLowerCase()) ?? null;

  await validateWallet(wallet, 'Single Wallet', uiPnl ?? undefined);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const walletIdx = args.indexOf('--wallet');

  if (walletIdx !== -1 && args[walletIdx + 1]) {
    await runSingleWallet(args[walletIdx + 1]);
  } else {
    await runFullValidation();
  }
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
