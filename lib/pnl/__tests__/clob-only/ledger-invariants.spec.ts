/**
 * Ledger Invariants Test Suite
 *
 * Validates accounting invariants that must hold for all wallet calculations.
 * These invariants ensure the engine produces consistent, auditable results.
 *
 * Invariants tested:
 * 1. PnL Composition: realizedPnL + unrealizedPnl + resolvedUnredeemed = totalPnL
 * 2. UI Parity Composition: realizedPnL + resolvedUnredeemed = uiParityPnl (economic mode)
 * 3. UI Parity with Unrealized: realizedPnl + unrealizedPnl + resolvedUnredeemed = uiParityPnl (ui mode)
 * 4. Non-negative counters: All event counts >= 0
 * 5. Position consistency: openPositions + closedPositions = positionsCount
 *
 * Run: npx jest lib/pnl/__tests__/clob-only/ledger-invariants.spec.ts
 */

import {
  InventoryEngineV29,
  V29Event,
  V29Result,
  calculateV29PnL,
  WalletEventCounts,
} from '../../inventoryEngineV29';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Check all ledger invariants for a V29Result
 */
interface InvariantCheckResult {
  pass: boolean;
  violations: string[];
}

function checkInvariants(result: V29Result, mode: 'economic' | 'ui'): InvariantCheckResult {
  const violations: string[] = [];
  const tolerance = 0.01; // $0.01 tolerance for floating point

  // Invariant 1: PnL Composition
  // totalPnL = realizedPnL + unrealizedPnl + resolvedUnredeemed
  // Note: In V29, realizedPnl already includes resolvedUnredeemedValue
  const expectedTotalPnl = result.realizedPnl + result.unrealizedPnl;
  if (Math.abs(result.totalPnl - expectedTotalPnl) > tolerance) {
    violations.push(
      `PNL_COMPOSITION: totalPnl (${result.totalPnl}) != realizedPnl (${result.realizedPnl}) + unrealizedPnl (${result.unrealizedPnl})`
    );
  }

  // Invariant 2: UI Parity depends on mode
  if (mode === 'economic') {
    // Economic mode: uiParityPnl = realizedPnL (which includes resolvedUnredeemed)
    // Actually uiParityPnl = realizedPnl + resolvedUnredeemedValue but realizedPnl already has it
    const expectedUiParity = result.realizedPnl;
    if (Math.abs(result.uiParityPnl - expectedUiParity) > tolerance) {
      violations.push(
        `UI_PARITY_ECONOMIC: uiParityPnl (${result.uiParityPnl}) != realizedPnl (${expectedUiParity})`
      );
    }
  } else {
    // UI mode: uiParityPnl = realizedPnl + unrealizedPnl
    const expectedUiParity = result.realizedPnl + result.unrealizedPnl;
    if (Math.abs(result.uiParityPnl - expectedUiParity) > tolerance) {
      violations.push(
        `UI_PARITY_UI: uiParityPnl (${result.uiParityPnl}) != realizedPnl (${result.realizedPnl}) + unrealizedPnl (${result.unrealizedPnl})`
      );
    }
  }

  // Invariant 3: Non-negative counters
  if (result.walletEventCounts.clobEvents < 0) {
    violations.push(`NEGATIVE_COUNTER: clobEvents (${result.walletEventCounts.clobEvents}) < 0`);
  }
  if (result.walletEventCounts.splitEvents < 0) {
    violations.push(`NEGATIVE_COUNTER: splitEvents (${result.walletEventCounts.splitEvents}) < 0`);
  }
  if (result.walletEventCounts.mergeEvents < 0) {
    violations.push(`NEGATIVE_COUNTER: mergeEvents (${result.walletEventCounts.mergeEvents}) < 0`);
  }
  if (result.walletEventCounts.redemptionEvents < 0) {
    violations.push(`NEGATIVE_COUNTER: redemptionEvents (${result.walletEventCounts.redemptionEvents}) < 0`);
  }

  // Invariant 4: Position counts must be non-negative
  if (result.openPositions < 0) {
    violations.push(`NEGATIVE_POSITIONS: openPositions (${result.openPositions}) < 0`);
  }
  if (result.closedPositions < 0) {
    violations.push(`NEGATIVE_POSITIONS: closedPositions (${result.closedPositions}) < 0`);
  }

  // Invariant 5: Position consistency
  // openPositions + closedPositions = positionsCount
  if (result.openPositions + result.closedPositions !== result.positionsCount) {
    violations.push(
      `POSITION_CONSISTENCY: openPositions (${result.openPositions}) + closedPositions (${result.closedPositions}) != positionsCount (${result.positionsCount})`
    );
  }

  // Invariant 6: Events processed consistency
  // eventsProcessed should equal sum of all event counts
  const totalEvents =
    result.walletEventCounts.clobEvents +
    result.walletEventCounts.splitEvents +
    result.walletEventCounts.mergeEvents +
    result.walletEventCounts.redemptionEvents;

  if (result.eventsProcessed !== totalEvents) {
    violations.push(
      `EVENT_CONSISTENCY: eventsProcessed (${result.eventsProcessed}) != sum of event counts (${totalEvents})`
    );
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}

/**
 * Create a mock event for testing
 */
function createMockEvent(
  overrides: Partial<V29Event> = {}
): V29Event {
  return {
    source_type: 'CLOB',
    wallet_address: '0xtest',
    condition_id: 'condition1',
    outcome_index: 0,
    event_time: new Date(),
    event_id: `event_${Math.random().toString(36).slice(2)}`,
    usdc_delta: 0,
    token_delta: 0,
    payout_norm: null,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Ledger Invariants', () => {
  describe('Engine with synthetic events', () => {
    let engine: InventoryEngineV29;

    beforeEach(() => {
      engine = new InventoryEngineV29();
    });

    it('should maintain invariants after simple buy', () => {
      // Buy 100 tokens for $50 (price = $0.50)
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 100,
          usdc_delta: -50,
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      if (!check.pass) {
        console.log('Violations:', check.violations);
      }
    });

    it('should maintain invariants after buy + sell', () => {
      // Buy 100 tokens for $50
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 100,
          usdc_delta: -50,
          event_id: 'buy1',
        })
      );

      // Sell 50 tokens for $30 (profit!)
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: -50,
          usdc_delta: 30,
          event_id: 'sell1',
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      if (!check.pass) {
        console.log('Violations:', check.violations);
      }
    });

    it('should maintain invariants after multiple conditions', () => {
      // Trade on condition 1
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          condition_id: 'condition1',
          token_delta: 100,
          usdc_delta: -50,
          event_id: 'buy_c1',
        })
      );

      // Trade on condition 2
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          condition_id: 'condition2',
          token_delta: 200,
          usdc_delta: -80,
          event_id: 'buy_c2',
        })
      );

      // Sell from condition 1
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          condition_id: 'condition1',
          token_delta: -50,
          usdc_delta: 40,
          event_id: 'sell_c1',
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      if (!check.pass) {
        console.log('Violations:', check.violations);
      }

      // Should have 2 open positions
      expect(result.openPositions).toBe(2);
    });

    it('should maintain invariants with redemption events', () => {
      // Buy tokens
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 100,
          usdc_delta: -50,
          event_id: 'buy1',
        })
      );

      // Redeem after market resolves (payout = $1 per token)
      engine.applyEvent(
        createMockEvent({
          source_type: 'PayoutRedemption',
          token_delta: -100,
          usdc_delta: 100,
          payout_norm: 1,
          event_id: 'redeem1',
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      if (!check.pass) {
        console.log('Violations:', check.violations);
      }

      // Position should be closed
      expect(result.closedPositions).toBe(1);
      expect(result.openPositions).toBe(0);
    });

    it('should maintain invariants with split events (MIXED wallet)', () => {
      // Buy via CLOB
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 100,
          usdc_delta: -50,
          event_id: 'buy1',
        })
      );

      // Split position (receive tokens on both outcomes)
      engine.applyEvent(
        createMockEvent({
          source_type: 'PositionSplit',
          condition_id: 'condition1',
          outcome_index: 0,
          token_delta: 50,
          usdc_delta: 0,
          event_id: 'split1',
        })
      );

      engine.applyEvent(
        createMockEvent({
          source_type: 'PositionSplit',
          condition_id: 'condition1',
          outcome_index: 1,
          token_delta: 50,
          usdc_delta: 0,
          event_id: 'split2',
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      if (!check.pass) {
        console.log('Violations:', check.violations);
      }

      // Should have split events tracked
      expect(result.walletEventCounts.splitEvents).toBe(2);
    });

    it('should track event counts correctly', () => {
      // Mix of all event types
      engine.applyEvent(createMockEvent({ source_type: 'CLOB', event_id: 'clob1' }));
      engine.applyEvent(createMockEvent({ source_type: 'CLOB', event_id: 'clob2' }));
      engine.applyEvent(createMockEvent({ source_type: 'CLOB', event_id: 'clob3' }));
      engine.applyEvent(createMockEvent({ source_type: 'PositionSplit', event_id: 'split1' }));
      engine.applyEvent(createMockEvent({ source_type: 'PositionsMerge', event_id: 'merge1' }));
      engine.applyEvent(createMockEvent({ source_type: 'PayoutRedemption', event_id: 'redeem1', payout_norm: 1 }));
      engine.applyEvent(createMockEvent({ source_type: 'PayoutRedemption', event_id: 'redeem2', payout_norm: 0 }));

      const result = engine.getResult('0xtest', { inventoryGuard: true });

      // Verify counts
      expect(result.walletEventCounts.clobEvents).toBe(3);
      expect(result.walletEventCounts.splitEvents).toBe(1);
      expect(result.walletEventCounts.mergeEvents).toBe(1);
      expect(result.walletEventCounts.redemptionEvents).toBe(2);

      // Verify total
      expect(result.eventsProcessed).toBe(7);

      // Check invariants
      const check = checkInvariants(result, 'economic');
      expect(check.pass).toBe(true);
    });
  });

  describe('Edge cases', () => {
    let engine: InventoryEngineV29;

    beforeEach(() => {
      engine = new InventoryEngineV29();
    });

    it('should handle zero-amount events', () => {
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 0,
          usdc_delta: 0,
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
    });

    it('should handle empty wallet state', () => {
      const result = engine.getResult('0xnonexistent', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      expect(result.eventsProcessed).toBe(0);
      expect(result.positionsCount).toBe(0);
    });

    it('should handle very small amounts', () => {
      engine.applyEvent(
        createMockEvent({
          source_type: 'CLOB',
          token_delta: 0.0001,
          usdc_delta: -0.00005,
        })
      );

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
    });

    it('should handle many events without accumulating errors', () => {
      // Simulate 100 buy/sell cycles
      for (let i = 0; i < 100; i++) {
        engine.applyEvent(
          createMockEvent({
            source_type: 'CLOB',
            token_delta: 100,
            usdc_delta: -50,
            event_id: `buy_${i}`,
          })
        );
        engine.applyEvent(
          createMockEvent({
            source_type: 'CLOB',
            token_delta: -100,
            usdc_delta: 55,
            event_id: `sell_${i}`,
          })
        );
      }

      const result = engine.getResult('0xtest', { inventoryGuard: true });
      const check = checkInvariants(result, 'economic');

      expect(check.pass).toBe(true);
      expect(result.eventsProcessed).toBe(200);
      expect(result.walletEventCounts.clobEvents).toBe(200);
    });
  });
});
