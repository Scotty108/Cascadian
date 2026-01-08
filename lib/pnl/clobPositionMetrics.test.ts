/**
 * CLOB Position Metrics Test Suite (TDD)
 *
 * Tests for calculating per-position trading metrics that work
 * for ALL CLOB wallet types: maker-heavy, taker-heavy, and mixed.
 *
 * SCOPE: This module is for wallets that trade primarily via CLOB (Central
 * Limit Order Book), not via proxy splits through the Exchange API. Most
 * Polymarket users use proxy splits, so this is a specialized module.
 *
 * KEY INSIGHT: Different CLOB wallet types need different PnL formulas:
 * - Taker-heavy: Position-based (proceeds + remaining×payout - cost)
 * - Maker-heavy: Spread-based (sell_usdc - buy_usdc + payout)
 *
 * Detection signal: taker_sell_ratio (taker sells / total buys)
 * - ratio > 1.0: Uses maker-spread formula
 * - ratio ≤ 1.0: Uses position-based formula
 *
 * Test Results (Jan 2026):
 * - Taker-heavy: 5.93% error ✓ (position-based)
 * - Maker-heavy: 1.59% error ✓ (maker-spread)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { describe, it, expect, beforeAll } from '@jest/globals';
import { computeClobPositionMetrics, ClobMetricsResult } from './clobPositionMetrics';

// Test wallets with known characteristics
const TEST_WALLETS = {
  // Market maker - profits from spreads, not position outcomes
  // CCR-v6 gets 1.6% error using maker-only (sell - buy + payout)
  MAKER_HEAVY: {
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
    description: 'Market maker with heavy CLOB activity',
  },
  // Single position from proxy split - straightforward
  // Position-based already worked: 5.9% error
  TAKER_HEAVY: {
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -26049.95,
    description: 'Single proxy-split position on ETH ETF',
  },
};

const ERROR_THRESHOLD = 10; // 10% error threshold (relaxed for position-based)

describe('CLOB Position Metrics', () => {
  describe('Core Functionality', () => {
    it('should return metrics for a wallet with trades', async () => {
      const result = await computeClobPositionMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Should have basic structure
      expect(result.wallet).toBe(TEST_WALLETS.MAKER_HEAVY.address.toLowerCase());
      expect(result.method).toBe('clob-position');
      expect(result.metrics).toBeDefined();
      expect(result.positions).toBeInstanceOf(Array);
    });

    it('should calculate metrics for taker-heavy wallet within 10% error', async () => {
      const { address, ui_pnl } = TEST_WALLETS.TAKER_HEAVY;
      const result = await computeClobPositionMetrics(address);

      const error = Math.abs(result.metrics.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;

      console.log(`Taker-heavy: computed=$${result.metrics.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });

    it('should calculate metrics for maker-heavy wallet within 10% error', async () => {
      const { address, ui_pnl } = TEST_WALLETS.MAKER_HEAVY;
      const result = await computeClobPositionMetrics(address);

      const error = Math.abs(result.metrics.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;

      console.log(`Maker-heavy: computed=$${result.metrics.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      // This test will FAIL with current implementation (182% error)
      // Need to fix the algorithm to account for spreads
      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });
  });

  describe('Metric Structure', () => {
    it('should return all required metrics', async () => {
      const result = await computeClobPositionMetrics(TEST_WALLETS.MAKER_HEAVY.address);
      const m = result.metrics;

      // Position counts
      expect(m.total_positions).toBeGreaterThanOrEqual(0);
      expect(m.resolved_positions).toBeGreaterThanOrEqual(0);
      expect(m.open_positions).toBeGreaterThanOrEqual(0);

      // Win/Loss
      expect(m.wins).toBeGreaterThanOrEqual(0);
      expect(m.losses).toBeGreaterThanOrEqual(0);
      expect(m.win_rate).toBeGreaterThanOrEqual(0);
      expect(m.win_rate).toBeLessThanOrEqual(1);

      // PnL metrics
      expect(typeof m.total_pnl).toBe('number');
      expect(typeof m.realized_pnl).toBe('number');
      expect(typeof m.avg_win).toBe('number');
      expect(typeof m.avg_loss).toBe('number');

      // Risk metrics
      expect(typeof m.payoff_ratio).toBe('number');
      expect(typeof m.expectancy).toBe('number');

      // Capital metrics
      expect(m.total_cost).toBeGreaterThanOrEqual(0);
      expect(typeof m.roi_percent).toBe('number');
    });

    it('should track position details', async () => {
      const result = await computeClobPositionMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      if (result.positions.length > 0) {
        const p = result.positions[0];

        expect(p.token_id).toBeDefined();
        expect(typeof p.cost_usd).toBe('number');
        expect(typeof p.proceeds_usd).toBe('number');
        expect(typeof p.pnl).toBe('number');
        expect(['win', 'loss', 'breakeven', 'open']).toContain(p.result);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle wallet with no trades', async () => {
      const result = await computeClobPositionMetrics('0x0000000000000000000000000000000000000000');

      expect(result.metrics.total_positions).toBe(0);
      expect(result.metrics.total_pnl).toBe(0);
      expect(result.metrics.win_rate).toBe(0);
    });

    it('should not have negative position counts', async () => {
      const result = await computeClobPositionMetrics(TEST_WALLETS.MAKER_HEAVY.address);
      const m = result.metrics;

      expect(m.total_positions).toBeGreaterThanOrEqual(0);
      expect(m.resolved_positions).toBeGreaterThanOrEqual(0);
      expect(m.open_positions).toBeGreaterThanOrEqual(0);
      expect(m.wins).toBeGreaterThanOrEqual(0);
      expect(m.losses).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Position PnL Calculation', () => {
    it('should use spread-aware PnL formula: proceeds - cost + resolution_value', async () => {
      const result = await computeClobPositionMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // The key insight: maker-heavy wallets profit from spreads
      // Position PnL = proceeds_usd - cost_usd + resolution_value
      // This matches CCR-v6's maker-only approach

      // For resolved positions, check that PnL includes both spread and resolution
      for (const p of result.positions.slice(0, 5)) {
        if (p.is_resolved) {
          // PnL should equal: proceeds - cost + (remaining_tokens * payout_share)
          const expectedPnl = p.proceeds_usd - p.cost_usd + (p.tokens_remaining * p.payout_share);
          expect(p.pnl).toBeCloseTo(expectedPnl, 2);
        }
      }
    });
  });
});
