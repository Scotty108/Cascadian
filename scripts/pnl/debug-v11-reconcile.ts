/**
 * Debug V11 Engine vs Economic Cashflow Reconciliation
 *
 * This script verifies the INVARIANT:
 *   econCashFlow == enginePnL + unrealizedCostBasis
 *
 * Or equivalently: econCashFlow - unrealizedCostBasis == enginePnL
 *
 * Where:
 * - econCashFlow = sum of all cash in/out (sells positive, buys negative)
 * - enginePnL = sum of realized profits/losses
 * - unrealizedCostBasis = sum of (avgPrice * amount) for open positions
 *
 * The invariant holds because:
 * - Cash out on buys becomes either realized PnL (when sold) or unrealized cost basis
 * - Cash in on sells comes from both cost recovery and profit
 *
 * Usage:
 *   WALLET=0x... npx tsx scripts/pnl/debug-v11-reconcile.ts
 *   MODE=none npx tsx scripts/pnl/debug-v11-reconcile.ts  # no synthetic redemptions
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
  PolymarketPnlEvent,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

// Default to W2 (our gold standard)
const DEFAULT_WALLET = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

interface ReconcileResult {
  wallet: string;
  totalEvents: number;
  enginePnlRaw: bigint;
  econCashFlowRaw: bigint;
  unrealizedCostBasisRaw: bigint;
  enginePnl: number;
  econCashFlow: number;
  unrealizedCostBasis: number;
  invariantDiff: number;  // econCashFlow - (enginePnl + unrealizedCostBasis) should be ~0
  mismatchedEvents: number;
}

/**
 * Compute economic cashflow for a single event
 */
function computeEconDelta(event: PolymarketPnlEvent): bigint {
  switch (event.eventType) {
    case 'ORDER_MATCHED_BUY':
      // Buying spends USDC (cash out)
      if (event.usdcAmountRaw === undefined) {
        // Fallback: compute from price * amount
        return -(event.price * event.amount) / COLLATERAL_SCALE;
      }
      return -event.usdcAmountRaw;

    case 'ORDER_MATCHED_SELL':
      // Selling receives USDC (cash in)
      if (event.usdcAmountRaw === undefined) {
        // Fallback: compute from price * amount
        return (event.price * event.amount) / COLLATERAL_SCALE;
      }
      return event.usdcAmountRaw;

    case 'REDEMPTION':
      // Redemption receives USDC = payoutPrice * amount / COLLATERAL_SCALE
      const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
      return (payoutPrice * event.amount) / COLLATERAL_SCALE;

    case 'SPLIT':
    case 'MERGE':
    case 'CONVERSION':
      // No cash changes hands
      return 0n;

    default:
      return 0n;
  }
}

/**
 * Run reconciliation for a single wallet
 */
async function reconcileWallet(
  wallet: string,
  synthMode: 'none' | 'loser_only' = 'none',
  verbose: boolean = false
): Promise<ReconcileResult> {
  // Load events
  const events = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: synthMode === 'loser_only',
  });

  // Sort events once
  const sortedEvents = sortEventsByTimestamp(events);

  // Initialize state
  const state = createEmptyEngineState(wallet);
  let econCashFlowRaw = 0n;
  let mismatchedEvents = 0;

  if (verbose) {
    console.log(`\nWallet: ${wallet}`);
    console.log(`Total events: ${sortedEvents.length}`);
    console.log(`Synth mode: ${synthMode}`);
    console.log('');
    console.log('Event Details (first 20 + any mismatches):');
    console.log('─'.repeat(120));
  }

  let eventIndex = 0;
  for (const event of sortedEvents) {
    // Compute economic delta
    const deltaEcon = computeEconDelta(event);
    econCashFlowRaw += deltaEcon;

    // Apply event to engine and get delta
    const beforePnl = state.realizedPnlRaw;
    applyEventToState(state, event);
    const deltaEngine = state.realizedPnlRaw - beforePnl;

    // Check for mismatch (allow small rounding errors of 1 micro-USDC)
    const diff = deltaEngine - deltaEcon;
    const isMismatch = diff > 1n || diff < -1n;
    if (isMismatch) {
      mismatchedEvents++;
    }

    // Log if verbose and (early events or mismatch)
    if (verbose && (eventIndex < 20 || isMismatch)) {
      const marker = isMismatch ? '⚠️ MISMATCH' : '  ';
      console.log(
        `${marker} ${event.timestamp.substring(0, 19)} ${event.eventType.padEnd(18)} ` +
          `token=${event.tokenId.toString().slice(0, 12).padEnd(12)}... ` +
          `eng_delta=${(Number(deltaEngine) / 1e6).toFixed(4).padStart(12)} ` +
          `econ_delta=${(Number(deltaEcon) / 1e6).toFixed(4).padStart(12)} ` +
          `diff=${(Number(diff) / 1e6).toFixed(4).padStart(10)}`
      );
    }

    eventIndex++;
  }

  // Compute unrealized cost basis = sum of (avgPrice * amount) for open positions
  let unrealizedCostBasisRaw = 0n;
  for (const pos of state.positions.values()) {
    if (pos.amount > 0n) {
      unrealizedCostBasisRaw += (pos.avgPrice * pos.amount) / COLLATERAL_SCALE;
    }
  }

  const enginePnl = Number(state.realizedPnlRaw) / 1e6;
  const econCashFlow = Number(econCashFlowRaw) / 1e6;
  const unrealizedCostBasis = Number(unrealizedCostBasisRaw) / 1e6;

  // The correct invariant: econCashFlow == enginePnl + unrealizedCostBasis
  // Rearranging: invariantDiff = econCashFlow - enginePnl - unrealizedCostBasis (should be ~0)
  const invariantDiff = econCashFlow - enginePnl - unrealizedCostBasis;

  if (verbose) {
    console.log('─'.repeat(120));
    console.log('');
    console.log('FINAL TOTALS:');
    console.log(`  Engine realized PnL:      $${enginePnl.toFixed(4)}`);
    console.log(`  Unrealized cost basis:    $${unrealizedCostBasis.toFixed(4)}`);
    console.log(`  Engine + Unrealized:      $${(enginePnl + unrealizedCostBasis).toFixed(4)}`);
    console.log(`  Economic cash flow:       $${econCashFlow.toFixed(4)}`);
    console.log(`  Invariant diff:           $${invariantDiff.toFixed(4)}`);
    console.log('');
  }

  return {
    wallet,
    totalEvents: sortedEvents.length,
    enginePnlRaw: state.realizedPnlRaw,
    econCashFlowRaw,
    unrealizedCostBasisRaw,
    enginePnl,
    econCashFlow,
    unrealizedCostBasis,
    invariantDiff,
    mismatchedEvents,
  };
}

async function main(): Promise<void> {
  const walletArg = process.env.WALLET;
  const modeArg = (process.env.MODE || 'none') as 'none' | 'loser_only';
  const verboseArg = process.env.VERBOSE !== 'false';

  console.log('═'.repeat(80));
  console.log('V11_POLY ENGINE vs ECONOMIC CASHFLOW RECONCILIATION');
  console.log('═'.repeat(80));
  console.log('');
  console.log('INVARIANT: econCashFlow == enginePnl + unrealizedCostBasis');
  console.log('');

  if (walletArg) {
    // Single wallet mode
    const result = await reconcileWallet(walletArg, modeArg, verboseArg);

    // Find UI benchmark for comparison
    const benchmark = UI_BENCHMARK_WALLETS.find(
      (w) => w.wallet.toLowerCase() === walletArg.toLowerCase()
    );
    if (benchmark) {
      console.log('UI COMPARISON:');
      console.log(`  UI profitLoss_all:    $${benchmark.profitLoss_all.toFixed(2)}`);
      console.log(
        `  Engine vs UI error:   ${((result.enginePnl - benchmark.profitLoss_all) / Math.abs(benchmark.profitLoss_all) * 100).toFixed(1)}%`
      );
    }
  } else {
    // All benchmark wallets
    console.log(`Mode: ${modeArg}`);
    console.log('');
    console.log('Label | Wallet               | Events | Engine PnL   | + Unrealized | = Expected   | Econ CF      | Inv.Diff | UI Target    | vs UI');
    console.log('─'.repeat(140));

    for (const bm of UI_BENCHMARK_WALLETS) {
      const result = await reconcileWallet(bm.wallet, modeArg, false);
      const vsUiError =
        bm.profitLoss_all !== 0
          ? ((result.enginePnl - bm.profitLoss_all) / Math.abs(bm.profitLoss_all)) * 100
          : result.enginePnl * 100;

      const formatUsd = (n: number) => {
        const prefix = n >= 0 ? '' : '-';
        return prefix + '$' + Math.abs(n).toFixed(2);
      };

      // Invariant: econCashFlow == enginePnl + unrealizedCostBasis
      // So invariantDiff should be ~0
      const invariantOk = Math.abs(result.invariantDiff) < 1.0 ? '✓' : '✗';
      const expected = result.enginePnl + result.unrealizedCostBasis;

      console.log(
        `${bm.label.padEnd(5)} | ${bm.wallet.substring(0, 20)}... | ${result.totalEvents.toString().padStart(6)} | ` +
          `${formatUsd(result.enginePnl).padStart(12)} | ${formatUsd(result.unrealizedCostBasis).padStart(12)} | ` +
          `${formatUsd(expected).padStart(12)} | ${formatUsd(result.econCashFlow).padStart(12)} | ` +
          `${formatUsd(result.invariantDiff).padStart(8)} ${invariantOk} | ` +
          `${formatUsd(bm.profitLoss_all).padStart(12)} | ${vsUiError.toFixed(1).padStart(6)}%`
      );
    }

    console.log('');
    console.log('LEGEND:');
    console.log('  Invariant: Econ CF == Engine PnL + Unrealized Cost Basis');
    console.log('  ✓ = Invariant holds (diff < $1) - engine math is correct');
    console.log('  ✗ = Invariant violated - indicates engine bug or data issue');
    console.log('  vs UI = Difference between engine PnL and Polymarket UI profitLoss_all');
    console.log('');
    console.log('If invariant holds but UI differs, the issue is MISSING DATA, not engine logic.');
  }

  console.log('═'.repeat(80));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
