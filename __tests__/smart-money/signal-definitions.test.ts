/**
 * Tests for Signal Definitions Registry
 */

import {
  SIGNAL_DEFINITIONS,
  getSignalDefinition,
  getSignalsForCategory,
  getFollowSignals,
  getFadeSignals,
  getSignalsByROI,
} from "../../lib/smart-money/signal-definitions";
import { SignalType } from "../../lib/smart-money/types";

describe("Signal Definitions", () => {
  describe("SIGNAL_DEFINITIONS", () => {
    it("should have at least 10 signal definitions", () => {
      expect(SIGNAL_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    });

    it("should have no duplicate signal types", () => {
      const types = SIGNAL_DEFINITIONS.map((s) => s.type);
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });

    it("should have valid backtest stats for all signals", () => {
      for (const signal of SIGNAL_DEFINITIONS) {
        expect(signal.backtest.trades).toBeGreaterThan(0);
        expect(signal.backtest.win_rate).toBeGreaterThanOrEqual(0);
        expect(signal.backtest.win_rate).toBeLessThanOrEqual(1);
        expect(signal.backtest.roi).toBeGreaterThan(-1);
      }
    });

    it("should have non-empty category arrays", () => {
      for (const signal of SIGNAL_DEFINITIONS) {
        expect(signal.conditions.category.length).toBeGreaterThan(0);
      }
    });

    it("should have valid smart_money_odds ranges", () => {
      for (const signal of SIGNAL_DEFINITIONS) {
        const { smart_money_odds } = signal.conditions;
        if (smart_money_odds.min !== undefined) {
          expect(smart_money_odds.min).toBeGreaterThanOrEqual(0);
          expect(smart_money_odds.min).toBeLessThanOrEqual(1);
        }
        if (smart_money_odds.max !== undefined) {
          expect(smart_money_odds.max).toBeGreaterThanOrEqual(0);
          expect(smart_money_odds.max).toBeLessThanOrEqual(1);
        }
      }
    });

    it("should have valid crowd_price ranges", () => {
      for (const signal of SIGNAL_DEFINITIONS) {
        const { crowd_price } = signal.conditions;
        if (crowd_price.min !== undefined) {
          expect(crowd_price.min).toBeGreaterThanOrEqual(0);
          expect(crowd_price.min).toBeLessThanOrEqual(1);
        }
        if (crowd_price.max !== undefined) {
          expect(crowd_price.max).toBeGreaterThanOrEqual(0);
          expect(crowd_price.max).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("getSignalDefinition", () => {
    it("should return correct definition for TECH_YES_AHEAD", () => {
      const signal = getSignalDefinition("TECH_YES_AHEAD");
      expect(signal).toBeDefined();
      expect(signal?.type).toBe("TECH_YES_AHEAD");
      expect(signal?.conditions.category).toContain("Tech");
      expect(signal?.action).toBe("BET_YES");
      expect(signal?.is_fade).toBe(false);
    });

    it("should return correct definition for FADE_OTHER_YES", () => {
      const signal = getSignalDefinition("FADE_OTHER_YES");
      expect(signal).toBeDefined();
      expect(signal?.type).toBe("FADE_OTHER_YES");
      expect(signal?.is_fade).toBe(true);
      expect(signal?.action).toBe("BET_NO"); // Opposite of SM
    });

    it("should return undefined for invalid signal type", () => {
      const signal = getSignalDefinition("INVALID_SIGNAL" as SignalType);
      expect(signal).toBeUndefined();
    });
  });

  describe("getSignalsForCategory", () => {
    it("should return Tech signals for Tech category", () => {
      const signals = getSignalsForCategory("Tech");
      expect(signals.length).toBeGreaterThan(0);
      signals.forEach((s) => {
        expect(s.conditions.category).toContain("Tech");
      });
    });

    it("should return Crypto signals for Crypto category", () => {
      const signals = getSignalsForCategory("Crypto");
      expect(signals.length).toBeGreaterThan(0);
      signals.forEach((s) => {
        expect(s.conditions.category).toContain("Crypto");
      });
    });

    it("should return empty array for Sports (no validated signals)", () => {
      const signals = getSignalsForCategory("Sports");
      // Sports has no validated signals in our research
      expect(signals).toEqual([]);
    });
  });

  describe("getFollowSignals", () => {
    it("should return only non-fade signals", () => {
      const signals = getFollowSignals();
      expect(signals.length).toBeGreaterThan(0);
      signals.forEach((s) => {
        expect(s.is_fade).toBe(false);
      });
    });
  });

  describe("getFadeSignals", () => {
    it("should return only fade signals", () => {
      const signals = getFadeSignals();
      expect(signals.length).toBeGreaterThan(0);
      signals.forEach((s) => {
        expect(s.is_fade).toBe(true);
      });
    });

    it("should include FADE_OTHER_YES", () => {
      const signals = getFadeSignals();
      const types = signals.map((s) => s.type);
      expect(types).toContain("FADE_OTHER_YES");
    });
  });

  describe("getSignalsByROI", () => {
    it("should return signals sorted by ROI descending", () => {
      const signals = getSignalsByROI();
      for (let i = 1; i < signals.length; i++) {
        expect(signals[i - 1].backtest.roi).toBeGreaterThanOrEqual(
          signals[i].backtest.roi
        );
      }
    });

    it("should have ECONOMY_YES_AHEAD at or near the top", () => {
      const signals = getSignalsByROI();
      // Economy has highest ROI (+54%)
      const economyIndex = signals.findIndex(
        (s) => s.type === "ECONOMY_YES_AHEAD"
      );
      expect(economyIndex).toBeLessThan(3); // Should be in top 3
    });
  });
});
