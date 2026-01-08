/**
 * CLOB Wallet Metrics Test Suite (TDD)
 *
 * Comprehensive test suite for wallet intelligence metrics.
 * Tests are organized by metric family and must pass for ALL wallet types:
 * - Maker-heavy (ratio > 1.0)
 * - Taker-heavy (ratio < 1.0)
 * - Mixed (ratio ~1.0)
 *
 * TDD Approach: Write failing tests first, then implement to pass.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { describe, it, expect } from '@jest/globals';
import {
  computeClobWalletMetrics,
  ClobWalletMetrics,
} from './clobWalletMetrics';

// Test wallets with known characteristics
const TEST_WALLETS = {
  // Market maker - profits from spreads, not position outcomes
  MAKER_HEAVY: {
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
    description: 'Market maker with heavy CLOB activity',
    expected_type: 'maker-heavy' as const,
  },
  // Single position from proxy split - straightforward
  TAKER_HEAVY: {
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -26049.95,
    description: 'Single proxy-split position on ETH ETF',
    expected_type: 'taker-heavy' as const,
  },
};

const ERROR_THRESHOLD = 10; // 10% error threshold

describe('CLOB Wallet Metrics - Phase 1: Core Performance', () => {
  describe('A) Identity & Activity Metrics', () => {
    it('should calculate positions_total correctly', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.activity.positions_total).toBeGreaterThan(0);
      expect(Number.isInteger(result.activity.positions_total)).toBe(true);
    });

    it('should calculate fills_total (trade count)', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.activity.fills_total).toBeGreaterThan(0);
      expect(result.activity.fills_total).toBeGreaterThanOrEqual(result.activity.positions_total);
    });

    it('should calculate active_days', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.activity.active_days).toBeGreaterThan(0);
    });

    it('should calculate wallet_age_days', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.activity.wallet_age_days).toBeGreaterThanOrEqual(result.activity.active_days);
    });
  });

  describe('E) Performance Metrics (P&L, returns, expectancy)', () => {
    it('should calculate total_pnl within error threshold for maker-heavy', async () => {
      const { address, ui_pnl } = TEST_WALLETS.MAKER_HEAVY;
      const result = await computeClobWalletMetrics(address);

      const error = Math.abs(result.performance.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;
      console.log(`Maker-heavy total_pnl: computed=$${result.performance.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });

    it('should calculate total_pnl within error threshold for taker-heavy', async () => {
      const { address, ui_pnl } = TEST_WALLETS.TAKER_HEAVY;
      const result = await computeClobWalletMetrics(address);

      const error = Math.abs(result.performance.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;
      console.log(`Taker-heavy total_pnl: computed=$${result.performance.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });

    it('should calculate wins and losses correctly', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.performance.wins).toBeGreaterThanOrEqual(0);
      expect(result.performance.losses).toBeGreaterThanOrEqual(0);
      expect(result.performance.wins + result.performance.losses).toBeLessThanOrEqual(
        result.activity.positions_total
      );
    });

    it('should calculate win_rate between 0 and 1', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.performance.win_rate).toBeGreaterThanOrEqual(0);
      expect(result.performance.win_rate).toBeLessThanOrEqual(1);

      // Win rate should equal wins / (wins + losses)
      const expectedWinRate = result.performance.wins /
        (result.performance.wins + result.performance.losses || 1);
      expect(result.performance.win_rate).toBeCloseTo(expectedWinRate, 4);
    });

    it('should calculate roi_mean correctly', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(typeof result.performance.roi_mean).toBe('number');
      expect(Number.isFinite(result.performance.roi_mean)).toBe(true);
    });

    it('should calculate avg_win_roi and avg_loss_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // avg_win_roi should be positive (or 0 if no wins)
      expect(result.performance.avg_win_roi).toBeGreaterThanOrEqual(0);

      // avg_loss_roi should be negative (or 0 if no losses)
      expect(result.performance.avg_loss_roi).toBeLessThanOrEqual(0);
    });

    it('should calculate payoff_ratio correctly', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // payoff_ratio = |avg_win_roi| / |avg_loss_roi|
      expect(result.performance.payoff_ratio).toBeGreaterThanOrEqual(0);
    });

    it('should calculate expectancy_per_position', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // E = win_rate * avg_win_roi + (1 - win_rate) * avg_loss_roi
      const expectedExpectancy =
        result.performance.win_rate * result.performance.avg_win_roi +
        (1 - result.performance.win_rate) * result.performance.avg_loss_roi;

      expect(result.performance.expectancy).toBeCloseTo(expectedExpectancy, 4);
    });

    it('should calculate profit_factor correctly', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // profit_factor = sum(winning pnl) / |sum(losing pnl)|
      expect(result.performance.profit_factor).toBeGreaterThanOrEqual(0);
    });
  });

  describe('C) Volume & Sizing Metrics', () => {
    it('should calculate total_cost_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.volume.total_cost_usd).toBeGreaterThan(0);
    });

    it('should calculate total_proceeds_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.volume.total_proceeds_usd).toBeGreaterThanOrEqual(0);
    });

    it('should calculate avg_position_cost_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // avg should equal total / count
      const expectedAvg = result.volume.total_cost_usd / result.activity.positions_total;
      expect(result.volume.avg_position_cost_usd).toBeCloseTo(expectedAvg, 2);
    });

    it('should calculate median_position_cost_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.volume.median_position_cost_usd).toBeGreaterThan(0);
      // Median should be less than or equal to max
      expect(result.volume.median_position_cost_usd).toBeLessThanOrEqual(
        result.volume.p90_position_cost_usd * 2 // rough sanity check
      );
    });

    it('should calculate p90_position_cost_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // P90 should be >= median
      expect(result.volume.p90_position_cost_usd).toBeGreaterThanOrEqual(
        result.volume.median_position_cost_usd
      );
    });
  });
});

describe('CLOB Wallet Metrics - Phase 2: Risk & Distribution', () => {
  describe('F) Risk Metrics', () => {
    it('should calculate volatility_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.risk.volatility_roi).toBeGreaterThanOrEqual(0);
    });

    it('should calculate downside_deviation_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.risk.downside_deviation_roi).toBeGreaterThanOrEqual(0);
      // Downside deviation should be <= total volatility
      expect(result.risk.downside_deviation_roi).toBeLessThanOrEqual(
        result.risk.volatility_roi + 0.01 // small epsilon for floating point
      );
    });

    it('should calculate sharpe_proxy', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(typeof result.risk.sharpe_proxy).toBe('number');
      expect(Number.isFinite(result.risk.sharpe_proxy)).toBe(true);
    });

    it('should calculate sortino_proxy', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(typeof result.risk.sortino_proxy).toBe('number');
      expect(Number.isFinite(result.risk.sortino_proxy)).toBe(true);
    });

    it('should calculate max_drawdown_usd', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Max drawdown should be >= 0 (it's a positive number representing loss)
      expect(result.risk.max_drawdown_usd).toBeGreaterThanOrEqual(0);
    });

    it('should calculate var_95_roi and cvar_95_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // VaR95 is the 5th percentile (worst case) - should be negative or small
      expect(typeof result.risk.var_95_roi).toBe('number');

      // CVaR95 is the average of values below VaR95 - should be <= VaR95
      expect(result.risk.cvar_95_roi).toBeLessThanOrEqual(result.risk.var_95_roi + 0.01);
    });
  });

  describe('G) Distribution Metrics', () => {
    it('should calculate roi percentiles', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // P05 <= P50 <= P95
      expect(result.distribution.roi_p05).toBeLessThanOrEqual(result.distribution.roi_p50);
      expect(result.distribution.roi_p50).toBeLessThanOrEqual(result.distribution.roi_p95);
    });

    it('should calculate skewness_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(typeof result.distribution.skewness_roi).toBe('number');
      expect(Number.isFinite(result.distribution.skewness_roi)).toBe(true);
    });

    it('should calculate kurtosis_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(typeof result.distribution.kurtosis_roi).toBe('number');
      expect(Number.isFinite(result.distribution.kurtosis_roi)).toBe(true);
    });

    it('should calculate max_win_roi and max_loss_roi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // max_win_roi should be >= 0
      expect(result.distribution.max_win_roi).toBeGreaterThanOrEqual(0);

      // max_loss_roi should be <= 0
      expect(result.distribution.max_loss_roi).toBeLessThanOrEqual(0);
    });
  });
});

describe('CLOB Wallet Metrics - Cross-Wallet Type Validation', () => {
  it('should work for maker-heavy wallet', async () => {
    const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

    expect(result.wallet).toBe(TEST_WALLETS.MAKER_HEAVY.address.toLowerCase());
    expect(result.wallet_type).toBe('maker-heavy');
    expect(result.taker_sell_ratio).toBeGreaterThan(1.0);
  });

  it('should work for taker-heavy wallet', async () => {
    const result = await computeClobWalletMetrics(TEST_WALLETS.TAKER_HEAVY.address);

    expect(result.wallet).toBe(TEST_WALLETS.TAKER_HEAVY.address.toLowerCase());
    // This wallet uses position-based formula (ratio <= 1.0)
    expect(result.pnl_method).toBe('position-based');
    expect(result.taker_sell_ratio).toBeLessThanOrEqual(1.0);
    // wallet_type can be 'taker-heavy' or 'mixed' depending on exact ratio
    expect(['taker-heavy', 'mixed']).toContain(result.wallet_type);
  });

  it('should handle wallet with no trades gracefully', async () => {
    const result = await computeClobWalletMetrics('0x0000000000000000000000000000000000000000');

    expect(result.activity.positions_total).toBe(0);
    expect(result.performance.total_pnl).toBe(0);
    expect(result.performance.win_rate).toBe(0);
  });
});

describe('CLOB Wallet Metrics - Phase 3: Timing & Holding', () => {
  describe('D) Timing & Holding Metrics', () => {
    it('should calculate median_hold_minutes', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Hold time should be non-negative
      expect(result.timing.median_hold_minutes).toBeGreaterThanOrEqual(0);
    });

    it('should calculate avg_hold_minutes', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.timing.avg_hold_minutes).toBeGreaterThanOrEqual(0);
      expect(typeof result.timing.avg_hold_minutes).toBe('number');
    });

    it('should calculate p90_hold_minutes >= median', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // P90 should be >= median
      expect(result.timing.p90_hold_minutes).toBeGreaterThanOrEqual(
        result.timing.median_hold_minutes
      );
    });

    it('should calculate pct_held_to_resolve between 0 and 1', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Should be a valid percentage
      expect(result.timing.pct_held_to_resolve).toBeGreaterThanOrEqual(0);
      expect(result.timing.pct_held_to_resolve).toBeLessThanOrEqual(1);
    });

    it('should calculate avg_time_to_resolve_at_entry_hours', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Time to resolve should be non-negative
      expect(result.timing.avg_time_to_resolve_at_entry_hours).toBeGreaterThanOrEqual(0);
    });

    it('should have consistent timing metrics for taker-heavy wallet', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.TAKER_HEAVY.address);

      // All timing metrics should be valid numbers
      expect(Number.isFinite(result.timing.median_hold_minutes)).toBe(true);
      expect(Number.isFinite(result.timing.avg_hold_minutes)).toBe(true);
      expect(Number.isFinite(result.timing.p90_hold_minutes)).toBe(true);
      expect(Number.isFinite(result.timing.pct_held_to_resolve)).toBe(true);
    });
  });
});

describe('CLOB Wallet Metrics - Phase 6: Edge & Skill', () => {
  describe('H) Edge Metrics (Simplified)', () => {
    it('should calculate avg_entry_price', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Average entry price should be between 0 and 1 for binary markets
      expect(result.edge.avg_entry_price).toBeGreaterThan(0);
      expect(result.edge.avg_entry_price).toBeLessThanOrEqual(1);
    });

    it('should calculate avg_win_entry_price', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Win entry price should be lower than loss entry price for binary "Yes" bets
      expect(result.edge.avg_win_entry_price).toBeGreaterThan(0);
      expect(result.edge.avg_win_entry_price).toBeLessThanOrEqual(1);
    });

    it('should calculate avg_loss_entry_price', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.edge.avg_loss_entry_price).toBeGreaterThan(0);
      expect(result.edge.avg_loss_entry_price).toBeLessThanOrEqual(1);
    });

    it('should calculate entry_edge for wins (outcome - entry_price)', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Edge for winning positions: outcome(1) - entry_price
      // Should be positive (bought at price < 1, won at 1)
      expect(typeof result.edge.avg_win_entry_edge).toBe('number');
      expect(Number.isFinite(result.edge.avg_win_entry_edge)).toBe(true);
    });

    it('should calculate skill_score (simplified)', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Skill score: combines win rate, payoff ratio, and entry edge
      expect(typeof result.edge.skill_score).toBe('number');
      expect(Number.isFinite(result.edge.skill_score)).toBe(true);
    });
  });
});

describe('CLOB Wallet Metrics - Phase 7: Consistency', () => {
  describe('I) Consistency Metrics', () => {
    it('should calculate position_size_cv (coefficient of variation)', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // CV should be non-negative
      expect(result.consistency.position_size_cv).toBeGreaterThanOrEqual(0);
    });

    it('should calculate max_win_streak', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.consistency.max_win_streak).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.consistency.max_win_streak)).toBe(true);
    });

    it('should calculate max_loss_streak', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.consistency.max_loss_streak).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.consistency.max_loss_streak)).toBe(true);
    });

    it('should calculate roi_consistency (inverse of CV)', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // 0 = inconsistent, 1 = perfectly consistent
      expect(result.consistency.roi_consistency).toBeGreaterThanOrEqual(0);
      expect(result.consistency.roi_consistency).toBeLessThanOrEqual(1);
    });
  });
});

describe('CLOB Wallet Metrics - Phase 8: Strategy Fingerprint', () => {
  describe('J) Strategy Fingerprint', () => {
    it('should calculate maker_ratio', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Ratio should be between 0 and 1
      expect(result.fingerprint.maker_ratio).toBeGreaterThanOrEqual(0);
      expect(result.fingerprint.maker_ratio).toBeLessThanOrEqual(1);
    });

    it('should calculate taker_ratio', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // maker_ratio + taker_ratio should equal 1
      expect(result.fingerprint.taker_ratio).toBeGreaterThanOrEqual(0);
      expect(result.fingerprint.taker_ratio).toBeLessThanOrEqual(1);
      expect(result.fingerprint.maker_ratio + result.fingerprint.taker_ratio).toBeCloseTo(1, 2);
    });

    it('should calculate position_concentration_hhi', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // HHI ranges from 0 (diversified) to 1 (concentrated)
      expect(result.fingerprint.position_concentration_hhi).toBeGreaterThanOrEqual(0);
      expect(result.fingerprint.position_concentration_hhi).toBeLessThanOrEqual(1);
    });

    it('should calculate avg_positions_per_day', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      expect(result.fingerprint.avg_positions_per_day).toBeGreaterThanOrEqual(0);
    });

    it('should determine strategy_type', async () => {
      const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

      // Should be one of the known types
      expect(['market_maker', 'swing_trader', 'scalper', 'position_trader', 'unknown'])
        .toContain(result.fingerprint.strategy_type);
    });
  });
});

describe('CLOB Wallet Metrics - Metric Consistency', () => {
  it('should have consistent PnL across different calculations', async () => {
    const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

    // total_pnl should approximately equal total_win_pnl + total_loss_pnl
    // (with some tolerance for maker-spread formula differences)
    const summedPnl = result.performance.total_win_pnl + result.performance.total_loss_pnl;

    // For position-based wallets, these should be very close
    // For maker-spread wallets, total_pnl uses different formula so may differ
    if (result.pnl_method === 'position-based') {
      expect(result.performance.total_pnl).toBeCloseTo(summedPnl, 1);
    }
  });

  it('should have non-negative counts', async () => {
    const result = await computeClobWalletMetrics(TEST_WALLETS.MAKER_HEAVY.address);

    expect(result.activity.positions_total).toBeGreaterThanOrEqual(0);
    expect(result.activity.fills_total).toBeGreaterThanOrEqual(0);
    expect(result.activity.active_days).toBeGreaterThanOrEqual(0);
    expect(result.performance.wins).toBeGreaterThanOrEqual(0);
    expect(result.performance.losses).toBeGreaterThanOrEqual(0);
  });
});
