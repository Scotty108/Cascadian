/**
 * Unit Tests for V14 Ledger State Machine
 *
 * Tests the signed-position logic (shorts support) in isolation.
 */

// Inline the core logic for testing without database dependencies
interface LedgerState {
  position: number;
  totalCost: number;
  realized_pnl: number;
}

function applyTrade(
  state: LedgerState,
  side: 'buy' | 'sell',
  qty: number,
  price: number
): { pnl: number; closedQty: number; openedQty: number } {
  let pnl = 0;
  let closedQty = 0;
  let openedQty = 0;
  let remainingQty = qty;

  if (side === 'buy') {
    if (state.position < 0 && remainingQty > 0) {
      const shortQty = -state.position;
      const closeQty = Math.min(remainingQty, shortQty);
      const avgShortPrice = state.totalCost / state.position;
      const closePnl = (avgShortPrice - price) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;
      state.position += closeQty;
      state.totalCost += avgShortPrice * closeQty;
      closedQty = closeQty;
      remainingQty -= closeQty;
    }
    if (remainingQty > 0) {
      state.position += remainingQty;
      state.totalCost += remainingQty * price;
      openedQty = remainingQty;
    }
  } else {
    if (state.position > 0 && remainingQty > 0) {
      const longQty = state.position;
      const closeQty = Math.min(remainingQty, longQty);
      const avgLongPrice = state.totalCost / state.position;
      const closePnl = (price - avgLongPrice) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;
      state.position -= closeQty;
      state.totalCost -= avgLongPrice * closeQty;
      closedQty = closeQty;
      remainingQty -= closeQty;
    }
    if (remainingQty > 0) {
      state.position -= remainingQty;
      state.totalCost -= remainingQty * price;
      openedQty = remainingQty;
    }
  }

  return { pnl, closedQty, openedQty };
}

function settleAtResolution(state: LedgerState, payout: number): number {
  if (Math.abs(state.position) < 0.001) return 0;

  let pnl = 0;

  if (state.position > 0) {
    const avgPrice = state.totalCost / state.position;
    pnl = (payout - avgPrice) * state.position;
  } else {
    const shortQty = -state.position;
    const avgPrice = -state.totalCost / shortQty;
    pnl = (avgPrice - payout) * shortQty;
  }

  state.realized_pnl += pnl;
  state.position = 0;
  state.totalCost = 0;

  return pnl;
}

// Test helpers
function newState(): LedgerState {
  return { position: 0, totalCost: 0, realized_pnl: 0 };
}

function assertClose(actual: number, expected: number, tolerance: number = 0.01, msg: string = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: Expected ${expected}, got ${actual} (diff: ${diff})`);
  }
}

// =============================================================================
// TEST CASES
// =============================================================================

function testSimpleLong() {
  console.log('TEST: Simple Long - Buy 10 @ $0.40, Sell 10 @ $0.60');
  const state = newState();

  applyTrade(state, 'buy', 10, 0.40);
  assertClose(state.position, 10, 0.01, 'Position after buy');
  assertClose(state.totalCost, 4, 0.01, 'Cost after buy');
  assertClose(state.realized_pnl, 0, 0.01, 'PnL after buy');

  applyTrade(state, 'sell', 10, 0.60);
  assertClose(state.position, 0, 0.01, 'Position after sell');
  assertClose(state.realized_pnl, 2, 0.01, 'PnL after sell'); // (0.60 - 0.40) * 10 = 2

  console.log('  ✓ PASS: PnL = $2.00 (profit from long)\n');
}

function testSimpleShort() {
  console.log('TEST: Simple Short - Sell 10 @ $0.60, Resolve @ $1.00');
  const state = newState();

  applyTrade(state, 'sell', 10, 0.60);
  assertClose(state.position, -10, 0.01, 'Position after sell');
  assertClose(state.totalCost, -6, 0.01, 'Cost after sell (negative = proceeds)');
  assertClose(state.realized_pnl, 0, 0.01, 'PnL after sell');

  settleAtResolution(state, 1.0);
  assertClose(state.position, 0, 0.01, 'Position after resolution');
  // Short sold at $0.60, resolved at $1.00 → loss of $0.40/share × 10 = -$4
  assertClose(state.realized_pnl, -4, 0.01, 'PnL after resolution');

  console.log('  ✓ PASS: PnL = -$4.00 (loss from short on winning outcome)\n');
}

function testShortResolveZero() {
  console.log('TEST: Short Resolves to $0 - Sell 10 @ $0.60, Resolve @ $0.00');
  const state = newState();

  applyTrade(state, 'sell', 10, 0.60);
  settleAtResolution(state, 0.0);
  // Short sold at $0.60, resolved at $0.00 → profit of $0.60/share × 10 = +$6
  assertClose(state.realized_pnl, 6, 0.01, 'PnL after resolution');

  console.log('  ✓ PASS: PnL = +$6.00 (profit from short on losing outcome)\n');
}

function testLongResolveZero() {
  console.log('TEST: Long Resolves to $0 - Buy 10 @ $0.40, Resolve @ $0.00');
  const state = newState();

  applyTrade(state, 'buy', 10, 0.40);
  settleAtResolution(state, 0.0);
  // Long bought at $0.40, resolved at $0.00 → loss of $0.40/share × 10 = -$4
  assertClose(state.realized_pnl, -4, 0.01, 'PnL after resolution');

  console.log('  ✓ PASS: PnL = -$4.00 (loss from long on losing outcome)\n');
}

function testLongResolveOne() {
  console.log('TEST: Long Resolves to $1 - Buy 10 @ $0.40, Resolve @ $1.00');
  const state = newState();

  applyTrade(state, 'buy', 10, 0.40);
  settleAtResolution(state, 1.0);
  // Long bought at $0.40, resolved at $1.00 → profit of $0.60/share × 10 = +$6
  assertClose(state.realized_pnl, 6, 0.01, 'PnL after resolution');

  console.log('  ✓ PASS: PnL = +$6.00 (profit from long on winning outcome)\n');
}

function testMarketMaker() {
  console.log('TEST: Market Maker - Sell 50 @ $0.60, Sell 50 @ $0.70, Buy 80 @ $0.50, Resolve @ $1.00');
  const state = newState();

  // Sell 50 @ 0.60 → short 50, proceeds = 30
  applyTrade(state, 'sell', 50, 0.60);
  assertClose(state.position, -50, 0.01, 'Position after first sell');
  assertClose(state.totalCost, -30, 0.01, 'Cost after first sell');

  // Sell 50 @ 0.70 → short 100, total proceeds = 65
  applyTrade(state, 'sell', 50, 0.70);
  assertClose(state.position, -100, 0.01, 'Position after second sell');
  assertClose(state.totalCost, -65, 0.01, 'Cost after second sell');

  // Buy 80 @ 0.50 → closes 80 of the 100 short, leaves 20 short
  // Avg short price = 65/100 = 0.65
  // Close 80: PnL = (0.65 - 0.50) * 80 = 12
  const result = applyTrade(state, 'buy', 80, 0.50);
  assertClose(state.position, -20, 0.01, 'Position after buy');
  assertClose(result.pnl, 12, 0.01, 'PnL from closing short');
  assertClose(state.realized_pnl, 12, 0.01, 'Cumulative PnL');

  // Resolve @ $1.00 with 20 shares still short
  // Remaining short: sold at avg 0.65, owes $1.00
  // PnL = (0.65 - 1.00) * 20 = -7
  settleAtResolution(state, 1.0);
  assertClose(state.realized_pnl, 12 - 7, 0.01, 'Final PnL'); // 12 - 7 = 5

  console.log('  ✓ PASS: PnL = +$5.00 (closed some short for profit, lost on remaining)\n');
}

function testFlipFromLongToShort() {
  console.log('TEST: Flip - Buy 10 @ $0.40, Sell 30 @ $0.60');
  const state = newState();

  // Buy 10 @ 0.40
  applyTrade(state, 'buy', 10, 0.40);
  assertClose(state.position, 10, 0.01, 'Position after buy');

  // Sell 30 @ 0.60: closes 10 long, opens 20 short
  // Close long: (0.60 - 0.40) * 10 = 2
  const result = applyTrade(state, 'sell', 30, 0.60);
  assertClose(state.position, -20, 0.01, 'Position after sell (now short)');
  assertClose(result.closedQty, 10, 0.01, 'Closed qty');
  assertClose(result.openedQty, 20, 0.01, 'Opened qty (short)');
  assertClose(result.pnl, 2, 0.01, 'PnL from closing long');
  assertClose(state.realized_pnl, 2, 0.01, 'Cumulative PnL');

  // Resolve @ $0.50
  // Short: sold at $0.60, resolved at $0.50 → profit of $0.10 × 20 = $2
  settleAtResolution(state, 0.50);
  assertClose(state.realized_pnl, 4, 0.01, 'Final PnL'); // 2 + 2 = 4

  console.log('  ✓ PASS: PnL = +$4.00 (profit from both long close and short resolution)\n');
}

function testTrumpElectionScenario() {
  console.log('TEST: Trump Election (Smart Money 1 pattern)');
  console.log('  Outcome 0: Sell 45.8M @ $0.60, Buy 163K @ $0.53, Resolve @ $1.00');
  const state = newState();

  // Sell 45.8M shares at avg $0.60
  applyTrade(state, 'sell', 45800000, 0.60);
  assertClose(state.position, -45800000, 1, 'Position after sell');

  // Buy back 163K at $0.53
  applyTrade(state, 'buy', 163000, 0.53);
  // Closes 163K of short: (0.60 - 0.53) * 163K = ~11,410
  assertClose(state.position, -45637000, 1, 'Position after buy');

  // Resolve @ $1.00 with ~45.6M still short
  // PnL = (0.60 - 1.00) * 45.6M = -$18.26M
  settleAtResolution(state, 1.0);

  console.log(`  Final PnL: $${state.realized_pnl.toLocaleString()}`);
  console.log('  Expected: Large negative (millions lost on short)');

  if (state.realized_pnl > -10000000) {
    throw new Error('Expected massive loss from short, got: ' + state.realized_pnl);
  }

  console.log('  ✓ PASS: Massive loss from short position on winning outcome\n');
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  console.log('='.repeat(70));
  console.log('V14 LEDGER UNIT TESTS - Signed Position (Shorts Support)');
  console.log('='.repeat(70) + '\n');

  let passed = 0;
  let failed = 0;

  const tests = [
    testSimpleLong,
    testSimpleShort,
    testShortResolveZero,
    testLongResolveZero,
    testLongResolveOne,
    testMarketMaker,
    testFlipFromLongToShort,
    testTrumpElectionScenario,
  ];

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (err: any) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      failed++;
    }
  }

  console.log('='.repeat(70));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

main();
