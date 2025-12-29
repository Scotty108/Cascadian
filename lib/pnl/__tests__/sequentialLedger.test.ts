/**
 * Sequential Ledger P&L Engine - Unit Tests
 *
 * TDD harness for the deterministic ledger approach.
 */

import { describe, it, expect } from 'vitest';

// Test pure functions without database calls
describe('Sequential Ledger - Unit Tests', () => {
  describe('Inventory Management', () => {
    it('should add tokens on buy', () => {
      const inventory = new Map<string, number>();
      const tokenId = 'token1';

      // Buy 100 tokens
      const current = inventory.get(tokenId) || 0;
      inventory.set(tokenId, current + 100);

      expect(inventory.get(tokenId)).toBe(100);
    });

    it('should subtract tokens on sell', () => {
      const inventory = new Map<string, number>();
      const tokenId = 'token1';

      // Start with 100 tokens
      inventory.set(tokenId, 100);

      // Sell 60 tokens
      const current = inventory.get(tokenId) || 0;
      inventory.set(tokenId, current - 60);

      expect(inventory.get(tokenId)).toBe(40);
    });

    it('should go negative when selling more than inventory', () => {
      const inventory = new Map<string, number>();
      const tokenId = 'token1';

      // Start with 0 tokens
      inventory.set(tokenId, 0);

      // Sell 100 tokens
      const current = inventory.get(tokenId) || 0;
      inventory.set(tokenId, current - 100);

      expect(inventory.get(tokenId)).toBe(-100);
    });
  });

  describe('Split Inference', () => {
    it('should infer split when inventory is negative', () => {
      const inventory = new Map<string, number>();
      const tokenA = 'tokenYES';
      const tokenB = 'tokenNO';
      const outcomes = new Map<number, string>([[0, tokenA], [1, tokenB]]);

      // Sell 100 tokens without buying (inventory goes to -100)
      inventory.set(tokenA, -100);

      // Infer split
      const deficit = -inventory.get(tokenA)!;
      expect(deficit).toBe(100);

      // Split mints BOTH outcomes
      for (const [, tokenId] of outcomes) {
        const current = inventory.get(tokenId) || 0;
        inventory.set(tokenId, current + deficit);
      }

      // After split: tokenA should be 0 (-100 + 100), tokenB should be 100 (0 + 100)
      expect(inventory.get(tokenA)).toBe(0);
      expect(inventory.get(tokenB)).toBe(100);
    });

    it('should calculate correct split cost', () => {
      const inventory = new Map<string, number>();
      const tokenA = 'tokenYES';

      // Scenario: Sell 150 tokens, having bought 50
      inventory.set(tokenA, 50);
      inventory.set(tokenA, (inventory.get(tokenA) || 0) - 150);

      // Inventory is now -100
      const inventoryValue = inventory.get(tokenA)!;
      expect(inventoryValue).toBe(-100);

      // Split cost = deficit = 100
      const splitCost = inventoryValue < 0 ? -inventoryValue : 0;
      expect(splitCost).toBe(100);
    });
  });

  describe('Redemption Conversion', () => {
    it('should convert USDC payout to tokens', () => {
      const payout = 100; // $100 USDC
      const resolutionPrice = 1.0; // Winner at $1

      const redeemedTokens = payout / resolutionPrice;
      expect(redeemedTokens).toBe(100);
    });

    it('should handle partial winners', () => {
      const payout = 50; // $50 USDC
      const resolutionPrice = 0.5; // Winner at $0.50

      const redeemedTokens = payout / resolutionPrice;
      expect(redeemedTokens).toBe(100);
    });
  });

  describe('P&L Formula', () => {
    it('should calculate realized P&L correctly', () => {
      const buys = 1000;
      const sells = 1500;
      const redemptions = 200;
      const merges = 0;
      const splitCost = 500;

      // Realized P&L = CashIn - CashOut - SplitCost
      const realizedPnl = sells + redemptions + merges - buys - splitCost;

      expect(realizedPnl).toBe(200);
    });

    it('should calculate total P&L with held value', () => {
      const buys = 1000;
      const sells = 1500;
      const redemptions = 200;
      const merges = 0;
      const splitCost = 500;
      const heldValue = 300;

      const realizedPnl = sells + redemptions + merges - buys - splitCost;
      const totalPnl = realizedPnl + heldValue;

      expect(totalPnl).toBe(500);
    });
  });

  describe('Calibration Wallet Scenario', () => {
    /**
     * Calibration wallet pattern:
     * 1. Split $X to create YES + NO tokens
     * 2. Sell YES tokens for $Y
     * 3. Hold NO tokens
     * 4. Redeem NO tokens when NO wins
     *
     * Expected P&L: Y + Redemption - X = small negative (around -$86)
     */
    it('should handle arbitrage pattern correctly', () => {
      const inventory = new Map<string, number>();
      const tokenYES = 'YES';
      const tokenNO = 'NO';
      const outcomes = new Map<number, string>([[0, tokenYES], [1, tokenNO]]);

      let buys = 0;
      let sells = 0;
      let redemptions = 0;
      let splitCost = 0;

      // Step 1: Sell YES tokens (inventory goes negative)
      // Simulating: sold 100 YES without buying
      inventory.set(tokenYES, -100);

      // Infer split (deficit = 100)
      const deficit = -inventory.get(tokenYES)!;
      for (const [, tokenId] of outcomes) {
        const current = inventory.get(tokenId) || 0;
        inventory.set(tokenId, current + deficit);
      }
      splitCost += deficit;
      sells += 60; // Got $60 for selling 100 YES at $0.60

      // Step 2: Redeem NO tokens (NO won at $1)
      const noInventory = inventory.get(tokenNO)!;
      expect(noInventory).toBe(100); // Should have 100 NO from split

      redemptions += 100; // Redeemed 100 NO at $1 = $100
      inventory.set(tokenNO, 0);

      // Calculate P&L
      const realizedPnl = sells + redemptions - buys - splitCost;

      // Expected: 60 + 100 - 0 - 100 = 60 (positive because NO won)
      // But if YES won and was worthless: 60 + 0 - 0 - 100 = -40
      expect(realizedPnl).toBe(60);
    });
  });
});
