/**
 * Tests for ROI Calculator
 */

import {
  calculateROI,
  isWin,
  calculateExpectedValue,
  calculateExpectedROI,
  calculateKellyFraction,
  calculateHalfKelly,
  calculateQuarterKelly,
  calculatePositionSize,
  calculateTradeStats,
  calculateMaxDrawdown,
  simulateEquityCurve,
} from "../../lib/smart-money/roi-calculator";
import { TradeResult } from "../../lib/smart-money/types";

describe("ROI Calculator", () => {
  describe("calculateROI", () => {
    it("should calculate positive ROI for winning YES bet", () => {
      const trade: TradeResult = {
        action: "BET_YES",
        entry_price: 0.6,
        outcome: 1, // YES won
      };

      const roi = calculateROI(trade);

      // ROI = (1 / 0.6) - 1 = 0.667 = +66.7%
      expect(roi).toBeCloseTo(0.667, 2);
    });

    it("should calculate positive ROI for winning NO bet", () => {
      const trade: TradeResult = {
        action: "BET_NO",
        entry_price: 0.4, // Paid 40c for NO
        outcome: 0, // NO won
      };

      const roi = calculateROI(trade);

      // ROI = (1 / 0.4) - 1 = 1.5 = +150%
      expect(roi).toBeCloseTo(1.5, 2);
    });

    it("should return -1 for losing YES bet", () => {
      const trade: TradeResult = {
        action: "BET_YES",
        entry_price: 0.6,
        outcome: 0, // NO won, YES lost
      };

      expect(calculateROI(trade)).toBe(-1);
    });

    it("should return -1 for losing NO bet", () => {
      const trade: TradeResult = {
        action: "BET_NO",
        entry_price: 0.4,
        outcome: 1, // YES won, NO lost
      };

      expect(calculateROI(trade)).toBe(-1);
    });

    it("should handle 50/50 entry price", () => {
      const trade: TradeResult = {
        action: "BET_YES",
        entry_price: 0.5,
        outcome: 1,
      };

      // ROI = (1 / 0.5) - 1 = 1.0 = +100%
      expect(calculateROI(trade)).toBeCloseTo(1.0, 2);
    });

    it("should handle low entry price (high odds)", () => {
      const trade: TradeResult = {
        action: "BET_YES",
        entry_price: 0.1, // Bought at 10c
        outcome: 1,
      };

      // ROI = (1 / 0.1) - 1 = 9.0 = +900%
      expect(calculateROI(trade)).toBeCloseTo(9.0, 2);
    });

    it("should handle high entry price (low odds)", () => {
      const trade: TradeResult = {
        action: "BET_YES",
        entry_price: 0.95, // Bought at 95c
        outcome: 1,
      };

      // ROI = (1 / 0.95) - 1 = 0.053 = +5.3%
      expect(calculateROI(trade)).toBeCloseTo(0.053, 2);
    });
  });

  describe("isWin", () => {
    it("should return true for winning YES bet", () => {
      expect(
        isWin({ action: "BET_YES", entry_price: 0.6, outcome: 1 })
      ).toBe(true);
    });

    it("should return true for winning NO bet", () => {
      expect(
        isWin({ action: "BET_NO", entry_price: 0.4, outcome: 0 })
      ).toBe(true);
    });

    it("should return false for losing YES bet", () => {
      expect(
        isWin({ action: "BET_YES", entry_price: 0.6, outcome: 0 })
      ).toBe(false);
    });

    it("should return false for losing NO bet", () => {
      expect(
        isWin({ action: "BET_NO", entry_price: 0.4, outcome: 1 })
      ).toBe(false);
    });
  });

  describe("calculateExpectedValue", () => {
    it("should return positive EV for profitable signal", () => {
      // 75% win rate at 62c entry
      const ev = calculateExpectedValue(0.75, 0.62);

      // EV = 0.75 * (1/0.62 - 1) + 0.25 * (-1)
      // EV = 0.75 * 0.613 - 0.25 = 0.460 - 0.25 = 0.21
      expect(ev).toBeGreaterThan(0);
      expect(ev).toBeCloseTo(0.21, 1);
    });

    it("should return negative EV for unprofitable signal", () => {
      // 50% win rate at 60c entry (fair odds but losing to vig)
      const ev = calculateExpectedValue(0.5, 0.6);

      // EV = 0.5 * (1/0.6 - 1) + 0.5 * (-1)
      // EV = 0.5 * 0.667 - 0.5 = 0.333 - 0.5 = -0.167
      expect(ev).toBeLessThan(0);
    });

    it("should return zero EV at fair odds", () => {
      // At fair odds, EV should be 0
      // 60% win rate at 60c = fair
      const ev = calculateExpectedValue(0.6, 0.6);

      // EV = 0.6 * (1/0.6 - 1) + 0.4 * (-1)
      // EV = 0.6 * 0.667 - 0.4 = 0.4 - 0.4 = 0
      expect(ev).toBeCloseTo(0, 2);
    });

    it("should handle extreme win rates", () => {
      // 100% win rate
      expect(calculateExpectedValue(1.0, 0.6)).toBeCloseTo(0.667, 2);

      // 0% win rate
      expect(calculateExpectedValue(0.0, 0.6)).toBe(-1);
    });
  });

  describe("calculateKellyFraction", () => {
    it("should return positive fraction for positive EV", () => {
      const kelly = calculateKellyFraction(0.75, 0.62);
      expect(kelly).toBeGreaterThan(0);
    });

    it("should return 0 for negative EV", () => {
      // 40% win rate at 60c = negative EV
      const kelly = calculateKellyFraction(0.4, 0.6);
      expect(kelly).toBe(0);
    });

    it("should cap at max_fraction", () => {
      // Very high EV should be capped
      const kelly = calculateKellyFraction(0.95, 0.5, 0.25);
      expect(kelly).toBeLessThanOrEqual(0.25);
    });

    it("should use default max of 0.25", () => {
      const kelly = calculateKellyFraction(0.99, 0.1); // Extreme edge
      expect(kelly).toBeLessThanOrEqual(0.25);
    });

    it("should calculate reasonable values for typical signals", () => {
      // Tech YES signal: 91% win at 62c
      const techKelly = calculateKellyFraction(0.911, 0.622);
      expect(techKelly).toBeGreaterThan(0.1);
      expect(techKelly).toBeLessThanOrEqual(0.25);
    });
  });

  describe("calculateHalfKelly", () => {
    it("should return half of full Kelly", () => {
      const full = calculateKellyFraction(0.75, 0.62);
      const half = calculateHalfKelly(0.75, 0.62);
      expect(half).toBeCloseTo(full / 2, 4);
    });
  });

  describe("calculateQuarterKelly", () => {
    it("should return quarter of full Kelly", () => {
      const full = calculateKellyFraction(0.75, 0.62);
      const quarter = calculateQuarterKelly(0.75, 0.62);
      expect(quarter).toBeCloseTo(full / 4, 4);
    });
  });

  describe("calculatePositionSize", () => {
    it("should calculate position size based on bankroll", () => {
      const bankroll = 10000;
      const position = calculatePositionSize(bankroll, 0.75, 0.62, 4);

      // Should be quarter Kelly * bankroll
      const quarterKelly = calculateQuarterKelly(0.75, 0.62);
      expect(position).toBeCloseTo(bankroll * quarterKelly, 0);
    });

    it("should return 0 for negative EV", () => {
      const position = calculatePositionSize(10000, 0.4, 0.6, 4);
      expect(position).toBe(0);
    });
  });

  describe("calculateTradeStats", () => {
    it("should calculate correct stats for winning trades", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.6, outcome: 1 },
        { action: "BET_YES", entry_price: 0.6, outcome: 1 },
        { action: "BET_YES", entry_price: 0.6, outcome: 1 },
        { action: "BET_YES", entry_price: 0.6, outcome: 0 },
      ];

      const stats = calculateTradeStats(trades);

      expect(stats.trades).toBe(4);
      expect(stats.wins).toBe(3);
      expect(stats.losses).toBe(1);
      expect(stats.win_rate).toBeCloseTo(0.75, 2);
    });

    it("should calculate correct ROI stats", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // +100%
        { action: "BET_YES", entry_price: 0.5, outcome: 0 }, // -100%
      ];

      const stats = calculateTradeStats(trades);

      expect(stats.total_roi).toBeCloseTo(0, 1); // +100% - 100% = 0
      expect(stats.avg_roi).toBeCloseTo(0, 1);
    });

    it("should handle empty trades array", () => {
      const stats = calculateTradeStats([]);

      expect(stats.trades).toBe(0);
      expect(stats.wins).toBe(0);
      expect(stats.win_rate).toBe(0);
      expect(stats.sharpe_ratio).toBe(0);
    });

    it("should calculate max win and loss", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.2, outcome: 1 }, // +400%
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // +100%
        { action: "BET_YES", entry_price: 0.6, outcome: 0 }, // -100%
      ];

      const stats = calculateTradeStats(trades);

      expect(stats.max_win).toBeCloseTo(4.0, 1); // +400%
      expect(stats.max_loss).toBeCloseTo(-1, 1); // -100%
    });
  });

  describe("calculateMaxDrawdown", () => {
    it("should return 0 for all winning trades", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 1 },
        { action: "BET_YES", entry_price: 0.5, outcome: 1 },
        { action: "BET_YES", entry_price: 0.5, outcome: 1 },
      ];

      const drawdown = calculateMaxDrawdown(trades);
      expect(drawdown).toBe(0);
    });

    it("should calculate drawdown after loss", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // $1 -> $2
        { action: "BET_YES", entry_price: 0.5, outcome: 0 }, // $2 -> $0 (100% drawdown)
      ];

      const drawdown = calculateMaxDrawdown(trades);
      expect(drawdown).toBe(1.0); // 100% drawdown
    });

    it("should handle empty array", () => {
      expect(calculateMaxDrawdown([])).toBe(0);
    });

    it("should track recovery from drawdown", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // $1 -> $2
        { action: "BET_YES", entry_price: 0.5, outcome: 0 }, // $2 -> $0
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // Would need capital injection
      ];

      // After total loss, can't recover without new capital
      const drawdown = calculateMaxDrawdown(trades);
      expect(drawdown).toBe(1.0);
    });
  });

  describe("simulateEquityCurve", () => {
    it("should start with initial bankroll", () => {
      const trades: TradeResult[] = [];
      const curve = simulateEquityCurve(trades, 1000);

      expect(curve[0]).toBe(1000);
    });

    it("should track equity after each trade", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // +100%
        { action: "BET_YES", entry_price: 0.5, outcome: 1 }, // +100%
      ];

      const curve = simulateEquityCurve(trades, 1000);

      expect(curve.length).toBe(3); // Initial + 2 trades
      expect(curve[0]).toBe(1000);
      expect(curve[1]).toBe(2000); // +100%
      expect(curve[2]).toBe(4000); // +100%
    });

    it("should go to 0 after loss", () => {
      const trades: TradeResult[] = [
        { action: "BET_YES", entry_price: 0.5, outcome: 0 }, // -100%
      ];

      const curve = simulateEquityCurve(trades, 1000);

      expect(curve[1]).toBe(0);
    });

    it("should use default bankroll of 1000", () => {
      const trades: TradeResult[] = [];
      const curve = simulateEquityCurve(trades);

      expect(curve[0]).toBe(1000);
    });
  });
});
