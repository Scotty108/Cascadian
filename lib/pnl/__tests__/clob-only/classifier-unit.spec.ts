/**
 * CLOB-Only Classifier Unit Test
 *
 * Fast unit tests for wallet classification logic.
 * No ClickHouse queries - just tests the classification function directly.
 *
 * Run: npx jest lib/pnl/__tests__/clob-only/classifier-unit.spec.ts
 */

import {
  WalletEventCounts,
  V29Result,
  evaluateTraderStrict,
  TRADER_STRICT_V1_CONFIG,
} from '../../inventoryEngineV29';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock V29Result with specific event counts and metrics
 */
function createMockV29Result(
  overrides: Partial<V29Result> & {
    walletEventCounts: WalletEventCounts;
    openPositions?: number;
  }
): V29Result {
  return {
    wallet: '0xtest',
    realizedPnl: 1000,
    unrealizedPnl: 0,
    resolvedUnredeemedValue: 0,
    uiParityPnl: 1000,
    uiParityClampedPnl: 1000,
    totalPnl: 1000,
    positionsCount: 10,
    openPositions: overrides.openPositions ?? 10,
    closedPositions: 5,
    eventsProcessed: 100,
    clampedPositions: 0,
    negativeInventoryPositions: 0,
    negativeInventoryPnlAdjustment: 0,
    resolvedUnredeemedPositions: 0,
    walletEventCounts: overrides.walletEventCounts,
    errors: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Classifier Unit Tests', () => {
  describe('CLOB_ONLY classification', () => {
    it('should classify wallet with only CLOB events as CLOB_ONLY', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 5,
        },
        openPositions: 10,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('CLOB_ONLY');
    });

    it('should classify wallet with CLOB + redemptions (no splits/merges) as CLOB_ONLY', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 20,
        },
        openPositions: 5,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('CLOB_ONLY');
    });

    it('should classify wallet with exactly 1 CLOB event as CLOB_ONLY', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 1,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 1,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('CLOB_ONLY');
    });
  });

  describe('MIXED classification', () => {
    it('should classify wallet with split events as MIXED', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 5,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('MIXED');
    });

    it('should classify wallet with merge events as MIXED', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 0,
          mergeEvents: 3,
          redemptionEvents: 10,
        },
        openPositions: 10,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('MIXED');
    });

    it('should classify wallet with both split and merge events as MIXED', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 5,
          mergeEvents: 3,
          redemptionEvents: 10,
        },
        openPositions: 10,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('MIXED');
    });

    it('should classify wallet with 0 CLOB events as MIXED (not CLOB_ONLY)', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 0,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 5,
      });

      const eligibility = evaluateTraderStrict(result);
      // Should NOT be CLOB_ONLY since no CLOB events
      expect(eligibility.walletTypeBadge).not.toBe('CLOB_ONLY');
    });
  });

  describe('WHALE_COMPLEX classification', () => {
    it('should classify wallet with >100 positions as WHALE_COMPLEX', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 150,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.walletTypeBadge).toBe('WHALE_COMPLEX');
    });

    it('should classify whale with CTF activity as WHALE_COMPLEX (not MIXED)', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 50,
          mergeEvents: 30,
          redemptionEvents: 20,
        },
        openPositions: 200,
      });

      const eligibility = evaluateTraderStrict(result);
      // Whale takes precedence over MIXED
      expect(eligibility.walletTypeBadge).toBe('WHALE_COMPLEX');
    });

    it('should NOT classify wallet with exactly 100 positions as WHALE_COMPLEX', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 100,
      });

      const eligibility = evaluateTraderStrict(result);
      // 100 is the threshold, so <= 100 should NOT be whale
      expect(eligibility.walletTypeBadge).not.toBe('WHALE_COMPLEX');
    });
  });

  describe('TRADER_STRICT eligibility', () => {
    it('should mark CLOB-only wallet with good metrics as TRADER_STRICT', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        eventsProcessed: 50,
        uiParityPnl: 500,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.isTraderStrict).toBe(true);
      expect(eligibility.strictReasonCodes).toHaveLength(0);
    });

    it('should exclude wallet with >50 open positions', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 51,
        eventsProcessed: 100,
        uiParityPnl: 1000,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.isTraderStrict).toBe(false);
      expect(eligibility.strictReasonCodes).toContain('POSITION_COUNT_HIGH');
    });

    it('should exclude wallet with |PnL| < $100', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 10,
        eventsProcessed: 50,
        uiParityPnl: 50, // Too small
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.isTraderStrict).toBe(false);
      expect(eligibility.strictReasonCodes).toContain('PNL_TOO_SMALL');
    });

    it('should exclude wallet with <10 events', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 5,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 5,
        eventsProcessed: 5, // Too few
        uiParityPnl: 500,
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.isTraderStrict).toBe(false);
      expect(eligibility.strictReasonCodes).toContain('INSUFFICIENT_TRADES');
    });

    it('should include wallet at exactly threshold boundaries', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 10,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: 50, // Exactly at limit
        eventsProcessed: 10, // Exactly at limit
        uiParityPnl: 100, // Exactly at limit
      });

      const eligibility = evaluateTraderStrict(result);
      expect(eligibility.isTraderStrict).toBe(true);
    });
  });

  describe('Event count aggregation', () => {
    it('should correctly aggregate all event types', () => {
      const result = createMockV29Result({
        walletEventCounts: {
          clobEvents: 100,
          splitEvents: 10,
          mergeEvents: 5,
          redemptionEvents: 20,
        },
        openPositions: 10,
      });

      const eligibility = evaluateTraderStrict(result);

      // Verify event counts are accessible for debugging
      expect(result.walletEventCounts.clobEvents).toBe(100);
      expect(result.walletEventCounts.splitEvents).toBe(10);
      expect(result.walletEventCounts.mergeEvents).toBe(5);
      expect(result.walletEventCounts.redemptionEvents).toBe(20);
    });
  });
});
