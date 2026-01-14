/**
 * Tests for Signal Detection
 */

import {
  detectSignal,
  detectAllSignals,
  detectSignalsBatch,
  matchesConditions,
  calculateConfidence,
  calculateEntryPrice,
} from "../../lib/smart-money/detect-signals";
import { MarketSnapshot, SignalConditions } from "../../lib/smart-money/types";

// Helper to create market snapshots
function createSnapshot(
  overrides: Partial<MarketSnapshot> = {}
): MarketSnapshot {
  return {
    market_id: "test-market-123",
    timestamp: new Date(),
    category: "Tech",
    smart_money_odds: 0.75,
    crowd_price: 0.62,
    wallet_count: 50,
    total_usd: 25000,
    days_before: 7,
    ...overrides,
  };
}

describe("Signal Detection", () => {
  describe("matchesConditions", () => {
    const techYesConditions: SignalConditions = {
      category: ["Tech"],
      smart_money_odds: { min: 0.7 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    };

    it("should match when all conditions are met", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(true);
    });

    it("should NOT match when category differs", () => {
      const market = createSnapshot({
        category: "Crypto",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(false);
    });

    it("should NOT match when smart_money_odds below min", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.65, // Below 0.7 threshold
        crowd_price: 0.62,
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(false);
    });

    it("should NOT match when crowd_price above max", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.72, // Above 0.68 threshold
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(false);
    });

    it("should NOT match when crowd_price below min", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.52, // Below 0.55 threshold
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(false);
    });

    it("should NOT match when days_before below min", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 3, // Below 5 days threshold
      });
      expect(matchesConditions(market, techYesConditions)).toBe(false);
    });

    it("should match exact boundary values (min)", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.7, // Exactly at min
        crowd_price: 0.55, // Exactly at min
        days_before: 5, // Exactly at min
      });
      expect(matchesConditions(market, techYesConditions)).toBe(true);
    });

    it("should match exact boundary values (max)", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.68, // Exactly at max
        days_before: 7,
      });
      expect(matchesConditions(market, techYesConditions)).toBe(true);
    });

    it("should handle requires_disagreement condition", () => {
      const conditions: SignalConditions = {
        category: ["Crypto"],
        smart_money_odds: { min: 0, max: 1 },
        crowd_price: { min: 0, max: 1 },
        days_before: { min: 3 },
        requires_disagreement: true,
      };

      // SM says YES (0.65 > 0.5), crowd says NO (0.42 < 0.5) - disagree
      const disagreeMarket = createSnapshot({
        category: "Crypto",
        smart_money_odds: 0.65,
        crowd_price: 0.42,
        days_before: 5,
      });
      expect(matchesConditions(disagreeMarket, conditions)).toBe(true);

      // SM says YES (0.65), crowd says YES (0.62) - agree
      const agreeMarket = createSnapshot({
        category: "Crypto",
        smart_money_odds: 0.65,
        crowd_price: 0.62,
        days_before: 5,
      });
      expect(matchesConditions(agreeMarket, conditions)).toBe(false);
    });
  });

  describe("calculateEntryPrice", () => {
    it("should return crowd_price for BET_YES", () => {
      expect(calculateEntryPrice("BET_YES", 0.62)).toBe(0.62);
    });

    it("should return 1 - crowd_price for BET_NO", () => {
      expect(calculateEntryPrice("BET_NO", 0.62)).toBeCloseTo(0.38);
    });

    it("should handle edge cases", () => {
      expect(calculateEntryPrice("BET_YES", 0.5)).toBe(0.5);
      expect(calculateEntryPrice("BET_NO", 0.5)).toBe(0.5);
      expect(calculateEntryPrice("BET_YES", 0.01)).toBe(0.01);
      expect(calculateEntryPrice("BET_NO", 0.99)).toBeCloseTo(0.01);
    });
  });

  describe("detectSignal", () => {
    it("should detect TECH_YES_AHEAD signal", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });

      const signal = detectSignal(market);

      expect(signal).not.toBeNull();
      expect(signal?.signal_type).toBe("TECH_YES_AHEAD");
      expect(signal?.action).toBe("BET_YES");
      expect(signal?.entry_price).toBe(0.62);
      expect(signal?.expected_roi).toBeCloseTo(0.47, 1);
    });

    it("should detect POLITICS_NO_BEARISH signal", () => {
      const market = createSnapshot({
        category: "Politics",
        smart_money_odds: 0.25, // Bearish
        crowd_price: 0.38,
        days_before: 7,
      });

      const signal = detectSignal(market);

      expect(signal).not.toBeNull();
      expect(signal?.signal_type).toBe("POLITICS_NO_BEARISH");
      expect(signal?.action).toBe("BET_NO");
      expect(signal?.entry_price).toBeCloseTo(0.62, 2); // 1 - 0.38
    });

    it("should detect FADE_OTHER_YES signal", () => {
      const market = createSnapshot({
        category: "Other",
        smart_money_odds: 0.75, // SM bullish
        crowd_price: 0.62,
        days_before: 7,
      });

      const signal = detectSignal(market);

      expect(signal).not.toBeNull();
      expect(signal?.signal_type).toBe("FADE_OTHER_YES");
      expect(signal?.action).toBe("BET_NO"); // Fade = opposite of SM
    });

    it("should return null for non-matching market", () => {
      const market = createSnapshot({
        category: "Sports", // No validated signals for Sports
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });

      const signal = detectSignal(market);
      expect(signal).toBeNull();
    });

    it("should return null when days_before too low", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 2, // Too close to resolution
      });

      const signal = detectSignal(market);
      expect(signal).toBeNull();
    });

    it("should handle FADE_CRYPTO_CONTRARIAN with dynamic action", () => {
      // SM says YES (0.65), crowd says NO (0.42)
      const market = createSnapshot({
        category: "Crypto",
        smart_money_odds: 0.65,
        crowd_price: 0.42,
        days_before: 5,
      });

      const signal = detectSignal(market);

      expect(signal).not.toBeNull();
      expect(signal?.signal_type).toBe("FADE_CRYPTO_CONTRARIAN");
      expect(signal?.action).toBe("BET_NO"); // Follow crowd (NO)
    });

    it("should calculate divergence correctly", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });

      const signal = detectSignal(market);

      expect(signal?.divergence).toBeCloseTo(0.13, 2); // 0.75 - 0.62
    });

    it("should set detected_at timestamp", () => {
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });

      const before = new Date();
      const signal = detectSignal(market);
      const after = new Date();

      expect(signal?.detected_at).toBeDefined();
      expect(signal?.detected_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(signal?.detected_at.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });
  });

  describe("detectAllSignals", () => {
    it("should return empty array for non-matching market", () => {
      const market = createSnapshot({
        category: "Sports",
        smart_money_odds: 0.5,
        crowd_price: 0.5,
        days_before: 7,
      });

      const signals = detectAllSignals(market);
      expect(signals).toEqual([]);
    });

    it("should return signals sorted by ROI", () => {
      // This market could potentially match multiple signals
      const market = createSnapshot({
        category: "Tech",
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7,
      });

      const signals = detectAllSignals(market);

      // Should be sorted by expected_roi descending
      for (let i = 1; i < signals.length; i++) {
        expect(signals[i - 1].expected_roi).toBeGreaterThanOrEqual(
          signals[i].expected_roi
        );
      }
    });
  });

  describe("detectSignalsBatch", () => {
    it("should detect signals for multiple markets", () => {
      const markets = [
        createSnapshot({
          market_id: "market-1",
          category: "Tech",
          smart_money_odds: 0.75,
          crowd_price: 0.62,
          days_before: 7,
        }),
        createSnapshot({
          market_id: "market-2",
          category: "Politics",
          smart_money_odds: 0.25,
          crowd_price: 0.38,
          days_before: 7,
        }),
        createSnapshot({
          market_id: "market-3",
          category: "Sports", // No signal
          smart_money_odds: 0.5,
          crowd_price: 0.5,
          days_before: 7,
        }),
      ];

      const signals = detectSignalsBatch(markets);

      expect(signals.length).toBe(2);
      expect(signals.map((s) => s.market_id)).toContain("market-1");
      expect(signals.map((s) => s.market_id)).toContain("market-2");
      expect(signals.map((s) => s.market_id)).not.toContain("market-3");
    });

    it("should return signals sorted by ROI", () => {
      const markets = [
        createSnapshot({
          market_id: "low-roi",
          category: "Crypto",
          smart_money_odds: 0.25,
          crowd_price: 0.38,
          days_before: 7,
        }),
        createSnapshot({
          market_id: "high-roi",
          category: "Tech",
          smart_money_odds: 0.75,
          crowd_price: 0.62,
          days_before: 7,
        }),
      ];

      const signals = detectSignalsBatch(markets);

      // Tech (+47% ROI) should come before Crypto (+8% ROI)
      expect(signals[0].market_id).toBe("high-roi");
    });

    it("should handle empty array", () => {
      const signals = detectSignalsBatch([]);
      expect(signals).toEqual([]);
    });
  });

  describe("calculateConfidence", () => {
    it("should return LOW for small sample size", () => {
      const market = createSnapshot();
      const definition = {
        backtest: { trades: 50, win_rate: 0.9, roi: 0.5 },
      } as any;

      expect(calculateConfidence(definition, market)).toBe("LOW");
    });

    it("should return HIGH for large sample with high win rate", () => {
      const market = createSnapshot();
      const definition = {
        backtest: { trades: 1000, win_rate: 0.75, roi: 0.3 },
      } as any;

      expect(calculateConfidence(definition, market)).toBe("HIGH");
    });

    it("should return MEDIUM for medium sample size", () => {
      const market = createSnapshot();
      const definition = {
        backtest: { trades: 150, win_rate: 0.55, roi: 0.2 },
      } as any;

      expect(calculateConfidence(definition, market)).toBe("MEDIUM");
    });
  });
});
