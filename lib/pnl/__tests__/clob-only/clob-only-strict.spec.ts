/**
 * CLOB_ONLY_STRICT API Unit Tests
 *
 * Tests the evaluateClobOnlyStrictFromResult() function which determines
 * if a wallet is eligible for copy-trade leaderboards.
 *
 * Run: npx jest lib/pnl/__tests__/clob-only/clob-only-strict.spec.ts
 */

import {
  V29Result,
  WalletEventCounts,
  CLOB_ONLY_STRICT_CONFIG,
  evaluateClobOnlyStrictFromResult,
} from '../../inventoryEngineV29';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockV29Result(overrides: {
  walletEventCounts: WalletEventCounts;
  openPositions?: number;
  uiParityPnl?: number;
  realizedPnl?: number;
  negativeInventoryPositions?: number;
  errors?: string[];
  eventsProcessed?: number;
}): V29Result {
  const eventTotal =
    overrides.walletEventCounts.clobEvents +
    overrides.walletEventCounts.splitEvents +
    overrides.walletEventCounts.mergeEvents +
    overrides.walletEventCounts.redemptionEvents;

  return {
    wallet: '0xtest',
    realizedPnl: overrides.realizedPnl ?? overrides.uiParityPnl ?? 1000,
    unrealizedPnl: 0,
    resolvedUnredeemedValue: 0,
    uiParityPnl: overrides.uiParityPnl ?? 1000,
    uiParityClampedPnl: overrides.uiParityPnl ?? 1000,
    totalPnl: overrides.uiParityPnl ?? 1000,
    positionsCount: overrides.openPositions ?? 10,
    openPositions: overrides.openPositions ?? 10,
    closedPositions: 5,
    eventsProcessed: overrides.eventsProcessed ?? eventTotal,
    clampedPositions: 0,
    negativeInventoryPositions: overrides.negativeInventoryPositions ?? 0,
    negativeInventoryPnlAdjustment: 0,
    resolvedUnredeemedPositions: 0,
    walletEventCounts: overrides.walletEventCounts,
    errors: overrides.errors ?? [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CLOB_ONLY_STRICT API', () => {
  describe('Eligible wallets', () => {
    it('should mark CLOB-only wallet meeting all thresholds as eligible', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 20,
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(true);
      expect(result.copyTradeReady).toBe(true);
      expect(result.walletType).toBe('CLOB_ONLY');
      expect(result.rejectionReasons).toHaveLength(0);
      expect(result.eligibilityChecks.isClobOnly).toBe(true);
      expect(result.eligibilityChecks.positionCountOk).toBe(true);
      expect(result.eligibilityChecks.activityOk).toBe(true);
      expect(result.eligibilityChecks.invariantsPass).toBe(true);
    });

    it('should be eligible at exact threshold boundaries', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: CLOB_ONLY_STRICT_CONFIG.minClobTrades, // Exactly 20
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 0,
        },
        openPositions: CLOB_ONLY_STRICT_CONFIG.maxOpenPositions, // Exactly 50
        uiParityPnl: CLOB_ONLY_STRICT_CONFIG.minAbsPnl, // Exactly $500
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(true);
      expect(result.copyTradeReady).toBe(true);
    });

    it('should be eligible with negative PnL meeting threshold', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 30,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 5,
        },
        openPositions: 10,
        uiParityPnl: -800, // Negative but |PnL| >= $500
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(true);
      expect(result.eligibilityChecks.activityOk).toBe(true);
    });
  });

  describe('Ineligible wallets - CTF Activity', () => {
    it('should reject wallet with split events', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 1, // Has CTF activity
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 20,
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.copyTradeReady).toBe(false);
      expect(result.walletType).toBe('MIXED');
      expect(result.rejectionReasons).toContain('HAS_CTF_ACTIVITY');
      expect(result.eligibilityChecks.isClobOnly).toBe(false);
    });

    it('should reject wallet with merge events', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 2, // Has CTF activity
          redemptionEvents: 10,
        },
        openPositions: 20,
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('HAS_CTF_ACTIVITY');
      expect(result.eligibilityChecks.isClobOnly).toBe(false);
    });

    it('should reject wallet with no CLOB trades', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 0, // No CLOB trades
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 5,
        uiParityPnl: 500,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('NO_CLOB_TRADES');
    });
  });

  describe('Ineligible wallets - Position Count', () => {
    it('should reject wallet with >50 open positions', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 51, // Too many
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('POSITION_COUNT_HIGH');
      expect(result.eligibilityChecks.positionCountOk).toBe(false);
    });
  });

  describe('Ineligible wallets - Activity Thresholds', () => {
    it('should reject wallet with <20 CLOB trades', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 19, // Too few
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('INSUFFICIENT_TRADES');
      expect(result.eligibilityChecks.activityOk).toBe(false);
    });

    it('should reject wallet with |PnL| < $500', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        uiParityPnl: 499, // Too small
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('PNL_TOO_SMALL');
      expect(result.eligibilityChecks.activityOk).toBe(false);
    });

    it('should reject wallet with small negative PnL', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        uiParityPnl: -100, // Too small (absolute value)
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('PNL_TOO_SMALL');
    });
  });

  describe('Ineligible wallets - Invariant Issues', () => {
    it('should reject wallet with >10% negative inventory positions', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        uiParityPnl: 1000,
        negativeInventoryPositions: 2, // 20% of 10 positions = bad
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('INVENTORY_ISSUES');
      expect(result.eligibilityChecks.invariantsPass).toBe(false);
    });

    it('should reject wallet with processing errors', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 10,
        uiParityPnl: 1000,
        errors: ['Some processing error'],
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('PROCESSING_ERRORS');
      expect(result.eligibilityChecks.invariantsPass).toBe(false);
    });

    it('should accept wallet with small negative inventory (<10%)', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 50,
        uiParityPnl: 1000,
        negativeInventoryPositions: 2, // 4% of 50 positions = acceptable
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.eligibilityChecks.invariantsPass).toBe(true);
      expect(result.isClobOnlyStrict).toBe(true);
    });
  });

  describe('Multiple rejection reasons', () => {
    it('should collect all rejection reasons', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 10, // INSUFFICIENT_TRADES
          splitEvents: 5, // HAS_CTF_ACTIVITY
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 60, // POSITION_COUNT_HIGH
        uiParityPnl: 100, // PNL_TOO_SMALL
        errors: ['error'], // PROCESSING_ERRORS
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('HAS_CTF_ACTIVITY');
      expect(result.rejectionReasons).toContain('POSITION_COUNT_HIGH');
      expect(result.rejectionReasons).toContain('INSUFFICIENT_TRADES');
      expect(result.rejectionReasons).toContain('PNL_TOO_SMALL');
      expect(result.rejectionReasons).toContain('PROCESSING_ERRORS');
      expect(result.rejectionReasons.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Metrics reporting', () => {
    it('should correctly report all metrics', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 42,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 8,
        },
        openPositions: 15,
        uiParityPnl: 750,
        realizedPnl: 800,
        eventsProcessed: 50,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      expect(result.metrics.openPositions).toBe(15);
      expect(result.metrics.clobTradeCount).toBe(42);
      expect(result.metrics.realizedPnl).toBe(800);
      expect(result.metrics.totalEventCount).toBe(50);
    });
  });

  describe('Config validation', () => {
    it('should have correct CLOB_ONLY_STRICT_CONFIG values', () => {
      expect(CLOB_ONLY_STRICT_CONFIG.maxOpenPositions).toBe(50);
      expect(CLOB_ONLY_STRICT_CONFIG.minClobTrades).toBe(20);
      expect(CLOB_ONLY_STRICT_CONFIG.minAbsPnl).toBe(500);
      expect(CLOB_ONLY_STRICT_CONFIG.requireClobOnly).toBe(true);
    });
  });

  describe('WHALE_COMPLEX classification', () => {
    it('should classify CLOB-only whale as WHALE_COMPLEX (not CLOB_ONLY)', () => {
      const mockResult = createMockV29Result({
        walletEventCounts: {
          clobEvents: 50,
          splitEvents: 0,
          mergeEvents: 0,
          redemptionEvents: 10,
        },
        openPositions: 150, // > 100 whale threshold
        uiParityPnl: 1000,
      });

      const result = evaluateClobOnlyStrictFromResult(mockResult);

      // Even though it's CLOB-only, whale classification takes precedence
      expect(result.walletType).toBe('WHALE_COMPLEX');
      // But still ineligible due to position count
      expect(result.isClobOnlyStrict).toBe(false);
      expect(result.rejectionReasons).toContain('POSITION_COUNT_HIGH');
    });
  });
});
