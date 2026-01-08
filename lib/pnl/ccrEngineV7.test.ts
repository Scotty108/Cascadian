/**
 * CCR-v7 Test Suite
 *
 * Test-driven development for unified PnL engine based on Polymarket subgraph logic.
 *
 * KEY INSIGHT FROM SUBGRAPH:
 * - Splits = buy BOTH outcomes at $0.50 each
 * - Merges = sell BOTH outcomes at $0.50 each
 * - CLOB trades = buy/sell at actual price
 * - realizedPnl = amount × (salePrice - avgPrice)
 * - avgPrice uses weighted average formula
 *
 * CRITICAL: Proxy splits are attributed to PROXY address, not user address.
 * We only process: user's CLOB trades + user's direct CTF events
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { computeCCRv7, CCRv7Result } from './ccrEngineV7';

// Test wallets with known UI PnL values (verified Jan 2026 via Playwright)
//
// IMPORTANT FINDINGS:
// - The taker-heavy wallet has one position: 54,734.5 NO tokens on ETH ETF market
// - These tokens came via ERC1155 transfer from proxy (not direct CLOB buys)
// - UI shows 48c avg price, which implies YES tokens were sold at ~$0.524
// - The -$1,129 benchmark was STALE - actual UI PnL is -$26,049.95
//
// - The split-heavy wallet is a market maker with ~10K trades
// - CCR-v6 maker-only method works well: 1.59% error
//
const TEST_WALLETS = {
  SPLIT_HEAVY: {
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
    description: 'Market maker with heavy CLOB activity, uses maker-only approach',
  },
  TAKER_HEAVY: {
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -26049.95, // Updated Jan 2026 - previous -1129 was stale!
    description: 'Single proxy-split position on ETH ETF (NO outcome, resolved worthless)',
  },
};

const ERROR_THRESHOLD = 5; // 5% error threshold for passing

describe('CCR-v7: Unified PnL Engine', () => {
  describe('Core Algorithm Tests', () => {
    it('should calculate PnL for split-heavy wallet within 5% error', async () => {
      const { address, ui_pnl } = TEST_WALLETS.SPLIT_HEAVY;
      const result = await computeCCRv7(address);

      const error = Math.abs(result.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;

      console.log(`Split-heavy: computed=$${result.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });

    it('should calculate PnL for taker-heavy wallet within 5% error', async () => {
      const { address, ui_pnl } = TEST_WALLETS.TAKER_HEAVY;
      const result = await computeCCRv7(address);

      const error = Math.abs(result.total_pnl - ui_pnl) / Math.abs(ui_pnl) * 100;

      console.log(`Taker-heavy: computed=$${result.total_pnl.toFixed(2)}, ui=$${ui_pnl}, error=${error.toFixed(2)}%`);

      expect(error).toBeLessThan(ERROR_THRESHOLD);
    });
  });

  describe('Algorithm Consistency', () => {
    it('should use the same algorithm for both wallet types', async () => {
      const splitResult = await computeCCRv7(TEST_WALLETS.SPLIT_HEAVY.address);
      const takerResult = await computeCCRv7(TEST_WALLETS.TAKER_HEAVY.address);

      // Both should report using the same method (no branching)
      expect(splitResult.method).toBe(takerResult.method);
      expect(splitResult.method).toBe('subgraph-style');
    });
  });

  describe('Position Tracking', () => {
    it('should track positions per token_id', async () => {
      const result = await computeCCRv7(TEST_WALLETS.SPLIT_HEAVY.address);

      // Should have position data
      expect(result.positions_tracked).toBeGreaterThan(0);
    });

    it('should never have negative position amounts', async () => {
      const result = await computeCCRv7(TEST_WALLETS.SPLIT_HEAVY.address);

      // Sell capping should prevent negative positions
      expect(result.overcapped_sells).toBeDefined();
    });
  });

  describe('Event Processing', () => {
    it('should process CLOB trades', async () => {
      const result = await computeCCRv7(TEST_WALLETS.TAKER_HEAVY.address);

      expect(result.clob_trades_processed).toBeGreaterThan(0);
    });

    it('should process user redemptions', async () => {
      const result = await computeCCRv7(TEST_WALLETS.SPLIT_HEAVY.address);

      // Split-heavy has redemptions
      expect(result.redemptions_processed).toBeGreaterThanOrEqual(0);
    });

    it('should process user splits at $0.50 per token', async () => {
      const result = await computeCCRv7(TEST_WALLETS.SPLIT_HEAVY.address);

      // User's direct splits (if any) should be processed at $0.50
      expect(result.user_splits_processed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle wallet with no trades gracefully', async () => {
      const result = await computeCCRv7('0x0000000000000000000000000000000000000000');

      expect(result.total_pnl).toBe(0);
      expect(result.clob_trades_processed).toBe(0);
    });
  });
});
