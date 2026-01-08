/**
 * TDD Tests for CCR-v3: Unified Cash-Flow PnL Engine
 *
 * =============================================================================
 * FIRST PRINCIPLES: PnL is just Cash Flow + Remaining Value
 * =============================================================================
 *
 * The fundamental equation is:
 *   PnL = (USDC received) - (USDC spent) + (Remaining token value)
 *
 * This works universally because:
 * 1. It doesn't require tracking where inventory came from
 * 2. It captures the economic reality directly
 * 3. Resolution handles remaining token value
 *
 * For resolved positions:
 *   PnL = (USDC received from sells) - (USDC spent on buys) + (Redemption value)
 *
 * For unresolved positions:
 *   PnL = (USDC received from sells) - (USDC spent on buys) + (Mark-to-market value)
 *
 * =============================================================================
 * Why Cost-Basis Tracking Fails for Taker-Heavy Wallets
 * =============================================================================
 *
 * The problem: pm_trader_events_v3 only shows the SELL side of split+sell.
 * We see: User sells 1000 YES tokens at $0.70
 * We don't see: User split $1000 to create those tokens
 *
 * Cost-basis approach tries to track "where did these tokens come from?"
 * But we can't answer that question for taker trades!
 *
 * Cash-flow approach doesn't care where tokens came from.
 * It just tracks: How much USDC went in? How much came out?
 *
 * =============================================================================
 * The Missing Piece: Collateral Splits
 * =============================================================================
 *
 * When a user does split+sell:
 * 1. Deposit $1000 USDC (USDC out)
 * 2. Split into 1000 YES + 1000 NO
 * 3. Sell 1000 YES at $0.70 = $700 (USDC in)
 * 4. Keep 1000 NO
 *
 * Without seeing step 1, we think:
 *   PnL = $700 (sell) - $0 (buys) = +$700  ← WRONG
 *
 * With step 1:
 *   PnL = $700 (sell) - $1000 (collateral) + remaining_NO_value
 *   If NO resolves to $1: PnL = $700 - $1000 + $1000 = +$700 ← CORRECT
 *   If NO resolves to $0: PnL = $700 - $1000 + $0 = -$300 ← CORRECT
 *
 * The key insight: We need to track COLLATERAL spent on splits,
 * not just USDC spent on CLOB buys.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Unit Tests: Cash Flow PnL Math
// =============================================================================

describe('Cash Flow PnL - First Principles', () => {
  describe('Pure CLOB Trading (no splits)', () => {
    it('buy 100 YES at $0.60, sell 100 YES at $0.80 = +$20 profit', () => {
      const usdcSpent = 100 * 0.60; // $60
      const usdcReceived = 100 * 0.80; // $80
      const remainingValue = 0; // sold everything
      const pnl = usdcReceived - usdcSpent + remainingValue;
      expect(pnl).toBeCloseTo(20, 2);
    });

    it('buy 100 YES at $0.60, YES resolves to $1 = +$40 profit', () => {
      const usdcSpent = 100 * 0.60; // $60
      const usdcReceived = 0; // no sells
      const redemptionValue = 100 * 1.0; // $100
      const pnl = usdcReceived - usdcSpent + redemptionValue;
      expect(pnl).toBeCloseTo(40, 2);
    });

    it('buy 100 YES at $0.60, YES resolves to $0 = -$60 loss', () => {
      const usdcSpent = 100 * 0.60; // $60
      const usdcReceived = 0; // no sells
      const redemptionValue = 100 * 0.0; // $0
      const pnl = usdcReceived - usdcSpent + redemptionValue;
      expect(pnl).toBeCloseTo(-60, 2);
    });
  });

  describe('Split+Sell Strategy (with collateral tracking)', () => {
    it('split $100 → sell 100 NO at $0.40 → 100 YES resolves to $1 = +$40 profit', () => {
      const collateralSpent = 100; // $100 USDC to split
      const sellProceeds = 100 * 0.40; // $40 from selling NO
      const redemptionValue = 100 * 1.0; // $100 YES redemption
      const pnl = sellProceeds - collateralSpent + redemptionValue;
      expect(pnl).toBeCloseTo(40, 2);
    });

    it('split $100 → sell 100 NO at $0.40 → 100 YES resolves to $0 = -$60 loss', () => {
      const collateralSpent = 100; // $100 USDC to split
      const sellProceeds = 100 * 0.40; // $40 from selling NO
      const redemptionValue = 100 * 0.0; // $0 YES redemption
      const pnl = sellProceeds - collateralSpent + redemptionValue;
      expect(pnl).toBeCloseTo(-60, 2);
    });

    it('split $100 → sell 100 YES at $0.70 → 100 NO resolves to $1 = +$70 profit', () => {
      const collateralSpent = 100;
      const sellProceeds = 100 * 0.70;
      const redemptionValue = 100 * 1.0;
      const pnl = sellProceeds - collateralSpent + redemptionValue;
      expect(pnl).toBeCloseTo(70, 2);
    });

    it('split $100 → sell 100 YES at $0.70 → 100 NO resolves to $0 = -$30 loss', () => {
      const collateralSpent = 100;
      const sellProceeds = 100 * 0.70;
      const redemptionValue = 100 * 0.0;
      const pnl = sellProceeds - collateralSpent + redemptionValue;
      expect(pnl).toBeCloseTo(-30, 2);
    });
  });

  describe('Mixed Trading (CLOB buys + split+sell)', () => {
    it('buy 50 YES at $0.60 + split+sell 50 NO at $0.40 → 100 YES resolve to $1', () => {
      // CLOB trade: buy 50 YES at $0.60
      const clobBuyCost = 50 * 0.60; // $30

      // Split+sell: deposit $50, split, sell 50 NO at $0.40, keep 50 YES
      const splitCollateral = 50;
      const noSellProceeds = 50 * 0.40; // $20

      // Total USDC out: $30 (CLOB buy) + $50 (split collateral) = $80
      const totalUsdcOut = clobBuyCost + splitCollateral;

      // Total USDC in: $20 (NO sell)
      const totalUsdcIn = noSellProceeds;

      // Remaining: 50 YES (from CLOB) + 50 YES (from split) = 100 YES
      const redemptionValue = 100 * 1.0; // $100

      const pnl = totalUsdcIn - totalUsdcOut + redemptionValue;
      expect(pnl).toBeCloseTo(40, 2); // $20 - $80 + $100 = $40
    });
  });

  describe('Taker-Heavy Wallet Scenario', () => {
    // This is the key scenario that breaks cost-basis tracking.
    // The wallet's CLOB data shows: buys $27,595, sells $26,466
    // Net USDC flow from CLOB: -$1,129
    // If we assume remaining tokens → $0, PnL should be -$1,129

    it('taker sells without visible inventory source - cash flow approach', () => {
      // Observed in pm_trader_events_v3:
      const clobBuys = 27595; // USDC spent buying tokens
      const clobSells = 26466; // USDC received selling tokens

      // Key insight: The "missing" inventory came from splits.
      // But we don't see the split collateral in CLOB data!
      // For taker-heavy wallets, we need to infer split collateral.

      // If all remaining positions resolve to $0:
      // PnL = sells - buys - (inferred_split_collateral) + 0
      // = $26,466 - $27,595 - X
      //
      // We expect PnL ≈ -$1,129 (matching UI)
      // So: $26,466 - $27,595 - X = -$1,129
      // X = 0 ← The splits are already netted in the CLOB flow!

      // Actually, for taker-heavy wallets:
      // The taker sells ARE the split+sell strategy.
      // The collateral spent on splits created tokens that were immediately sold.
      // So the "buy" side of split+sell shows up in CLOB as a taker buy.

      // Net USDC flow from CLOB trades:
      const netClobFlow = clobSells - clobBuys; // -$1,129

      // If remaining tokens resolve to $0:
      const redemptionValue = 0;

      // PnL = net flow + redemption
      const pnl = netClobFlow + redemptionValue;
      expect(pnl).toBeCloseTo(-1129, 0);
    });

    it('taker sells with remaining tokens that resolve', () => {
      // Same wallet, but imagine some tokens remain and resolve
      const clobBuys = 27595;
      const clobSells = 26466;
      const netClobFlow = clobSells - clobBuys; // -$1,129

      // If we have 500 remaining tokens that resolve to $1 each:
      const remainingTokens = 500;
      const redemptionValue = remainingTokens * 1.0;

      const pnl = netClobFlow + redemptionValue;
      expect(pnl).toBeCloseTo(-629, 0); // -$1,129 + $500 = -$629
    });
  });
});

// =============================================================================
// Legacy Tests: Net Cost Basis (still valid math, different approach)
// =============================================================================

describe('Correct Split+Sell Economics (Legacy)', () => {
  describe('Net Cost Basis Approach', () => {
    it('split $1 → sell NO at $0.40 → YES resolves to $1 = +$0.40 profit', () => {
      const collateralSpent = 1.0;
      const noSellProceeds = 0.40;
      const netYesCost = collateralSpent - noSellProceeds;
      const yesResolution = 1.0;
      const totalPnl = yesResolution - netYesCost;
      expect(totalPnl).toBeCloseTo(0.40, 2);
    });

    it('split $1 → sell YES at $0.70 → NO resolves to $1 = +$0.70 profit', () => {
      const collateralSpent = 1.0;
      const yesSellProceeds = 0.70;
      const netNoCost = collateralSpent - yesSellProceeds;
      const noResolution = 1.0;
      const totalPnl = noResolution - netNoCost;
      expect(totalPnl).toBeCloseTo(0.70, 2);
    });

    it('split $1 → sell YES at $0.70 → NO resolves to $0 = -$0.30 loss', () => {
      const collateralSpent = 1.0;
      const yesSellProceeds = 0.70;
      const netNoCost = collateralSpent - yesSellProceeds;
      const noResolution = 0.0;
      const totalPnl = noResolution - netNoCost;
      expect(totalPnl).toBeCloseTo(-0.30, 2);
    });

    it('split $1 → sell NO at $0.60 → YES resolves to $1 = +$0.60 profit', () => {
      const collateralSpent = 1.0;
      const noSellProceeds = 0.60;
      const netYesCost = collateralSpent - noSellProceeds;
      const yesResolution = 1.0;
      const totalPnl = yesResolution - netYesCost;
      expect(totalPnl).toBeCloseTo(0.60, 2);
    });

    it('split $1 → sell NO at $0.60 → YES resolves to $0 = -$0.40 loss', () => {
      const collateralSpent = 1.0;
      const noSellProceeds = 0.60;
      const netYesCost = collateralSpent - noSellProceeds;
      const yesResolution = 0.0;
      const totalPnl = yesResolution - netYesCost;
      expect(totalPnl).toBeCloseTo(-0.40, 2);
    });
  });
});

// =============================================================================
// Integration Tests: Real Wallet Data
// =============================================================================

describe('CCR-v3 Engine - Real Wallet Tests', () => {
  const hasCredentials = process.env.CLICKHOUSE_HOST && process.env.CLICKHOUSE_PASSWORD;

  describe.skipIf(!hasCredentials)('Split+Sell Heavy Wallet', () => {
    const TEST_WALLET = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
    const UI_PNL = -115409.28;
    const TOLERANCE_PCT = 5.0;

    it('should match UI PnL within tolerance', async () => {
      const { computeCCRv3 } = await import('./ccrEngineV3');
      const result = await computeCCRv3(TEST_WALLET);

      const diff = Math.abs(result.total_pnl - UI_PNL);
      const pctDiff = (diff / Math.abs(UI_PNL)) * 100;

      console.log('CCR-v3: $' + result.total_pnl.toFixed(2) + ' vs UI: $' + UI_PNL + ' (' + pctDiff.toFixed(2) + '% error)');

      expect(pctDiff).toBeLessThan(TOLERANCE_PCT);
    }, 60000);
  });

  describe.skipIf(!hasCredentials)('Taker-Heavy Wallet', () => {
    const TEST_WALLET = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';

    it('should calculate meaningful PnL for taker-heavy wallet', async () => {
      const { computeCCRv3 } = await import('./ccrEngineV3');
      const result = await computeCCRv3(TEST_WALLET);

      console.log('Taker wallet PnL: $' + result.total_pnl.toFixed(2));

      expect(Math.abs(result.total_pnl)).toBeGreaterThan(100);
    }, 60000);
  });
});
