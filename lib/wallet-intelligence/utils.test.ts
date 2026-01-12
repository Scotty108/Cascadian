/**
 * Unit tests for wallet intelligence utilities
 * Run: npx vitest run lib/wallet-intelligence/utils.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  toSideSpace,
  outcomeToSideSpace,
  positionPnl,
  positionRoi,
  clv,
  clvWinRate,
  mean,
  median,
  percentile,
  hhiFromCounts,
  topShare,
  maxDrawdown,
  varAtPercentile,
  cvarAtPercentile,
  brierScore,
  logLoss,
  payoffRatio,
  expectancy,
} from './utils';

describe('Side Space Conversion', () => {
  it('YES side: price stays the same', () => {
    expect(toSideSpace('YES', 0.7)).toBeCloseTo(0.7);
    expect(toSideSpace('YES', 0.3)).toBeCloseTo(0.3);
  });

  it('NO side: price is inverted', () => {
    expect(toSideSpace('NO', 0.7)).toBeCloseTo(0.3);
    expect(toSideSpace('NO', 0.3)).toBeCloseTo(0.7);
  });

  it('clamps values to 0-1', () => {
    expect(toSideSpace('YES', 1.5)).toBe(1);
    expect(toSideSpace('YES', -0.5)).toBe(0);
  });

  it('outcome conversion works correctly', () => {
    // YES won (outcomeYes = 1)
    expect(outcomeToSideSpace('YES', 1)).toBe(1); // YES holder wins
    expect(outcomeToSideSpace('NO', 1)).toBe(0);  // NO holder loses

    // NO won (outcomeYes = 0)
    expect(outcomeToSideSpace('YES', 0)).toBe(0); // YES holder loses
    expect(outcomeToSideSpace('NO', 0)).toBe(1);  // NO holder wins
  });
});

describe('PnL and ROI', () => {
  it('calculates profit correctly', () => {
    // Bought for $100, sold for $150
    expect(positionPnl(100, 150)).toBe(50);
  });

  it('calculates loss correctly', () => {
    // Bought for $100, sold for $80
    expect(positionPnl(100, 80)).toBe(-20);
  });

  it('calculates ROI correctly', () => {
    expect(positionRoi(100, 50)).toBeCloseTo(0.5); // 50% gain
    expect(positionRoi(100, -20)).toBeCloseTo(-0.2); // 20% loss
  });

  it('handles zero cost', () => {
    expect(positionRoi(0, 50)).toBe(0);
  });
});

describe('CLV (Closing Line Value)', () => {
  it('positive CLV when entry price < close price', () => {
    // Bought YES at 0.60, closed at 0.70 → got value
    expect(clv(0.60, 0.70)).toBeCloseTo(0.10);
  });

  it('negative CLV when entry price > close price', () => {
    // Bought YES at 0.70, closed at 0.60 → overpaid
    expect(clv(0.70, 0.60)).toBeCloseTo(-0.10);
  });

  it('CLV win rate calculation', () => {
    const clvs = [0.05, 0.10, -0.03, 0.02, -0.01]; // 3 positive, 2 negative
    expect(clvWinRate(clvs)).toBeCloseTo(0.6);
  });
});

describe('Statistics', () => {
  it('calculates mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('calculates median for odd length', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });

  it('calculates median for even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('calculates percentiles', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(data, 50)).toBe(5);
    expect(percentile(data, 90)).toBe(9);
  });
});

describe('HHI and Concentration', () => {
  it('perfect concentration = 1', () => {
    expect(hhiFromCounts([100, 0, 0])).toBe(1);
  });

  it('perfect diversification approaches 1/n', () => {
    // 3 equal buckets → HHI = 3 * (1/3)^2 = 1/3
    expect(hhiFromCounts([100, 100, 100])).toBeCloseTo(1 / 3);
  });

  it('top share calculation', () => {
    expect(topShare([50, 30, 20])).toBeCloseTo(0.5);
    expect(topShare([100, 0, 0])).toBe(1);
  });
});

describe('Drawdown', () => {
  it('calculates max drawdown correctly', () => {
    const pnls = [
      { t: 1, pnlUsd: 100 },  // equity: 100, peak: 100
      { t: 2, pnlUsd: 50 },   // equity: 150, peak: 150
      { t: 3, pnlUsd: -80 },  // equity: 70, dd: 80
      { t: 4, pnlUsd: 30 },   // equity: 100, dd: 50
      { t: 5, pnlUsd: -20 },  // equity: 80, dd: 70
    ];
    const { maxDdUsd, maxDdPct } = maxDrawdown(pnls);
    expect(maxDdUsd).toBe(80);
    expect(maxDdPct).toBeCloseTo(80 / 150);
  });

  it('no drawdown if always going up', () => {
    const pnls = [
      { t: 1, pnlUsd: 100 },
      { t: 2, pnlUsd: 50 },
      { t: 3, pnlUsd: 25 },
    ];
    const { maxDdUsd } = maxDrawdown(pnls);
    expect(maxDdUsd).toBe(0);
  });
});

describe('Risk Metrics', () => {
  it('VaR at 5th percentile', () => {
    // ROIs ranging from -50% to +50%
    const rois = [-0.5, -0.3, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
    expect(varAtPercentile(rois, 5)).toBeCloseTo(-0.5);
  });

  it('CVaR averages losses below VaR', () => {
    // CVaR is the average of returns at or below the VaR threshold
    const rois = [-0.5, -0.4, -0.3, 0, 0.3];
    // At 20th percentile (index 0), VaR = -0.5
    // CVaR = average of values <= -0.5 = just -0.5
    const cvar = cvarAtPercentile(rois, 20);
    expect(cvar).toBeCloseTo(-0.5);
  });
});

describe('Forecasting Quality', () => {
  it('Brier score: perfect prediction = 0', () => {
    expect(brierScore(1, 1)).toBe(0);
    expect(brierScore(0, 0)).toBe(0);
  });

  it('Brier score: worst prediction = 1', () => {
    expect(brierScore(0, 1)).toBe(1);
    expect(brierScore(1, 0)).toBe(1);
  });

  it('Brier score: 50/50 prediction', () => {
    expect(brierScore(0.5, 1)).toBeCloseTo(0.25);
    expect(brierScore(0.5, 0)).toBeCloseTo(0.25);
  });

  it('Log loss: confident correct prediction = low', () => {
    expect(logLoss(0.99, 1)).toBeLessThan(0.1);
  });

  it('Log loss: confident wrong prediction = high', () => {
    expect(logLoss(0.01, 1)).toBeGreaterThan(4);
  });
});

describe('Payoff Metrics', () => {
  it('payoff ratio calculation', () => {
    expect(payoffRatio(0.5, -0.25)).toBe(2); // 2:1 risk/reward
  });

  it('expectancy calculation', () => {
    // 60% win rate, avg win 0.4, avg loss -0.3
    const exp = expectancy(0.6, 0.4, -0.3);
    expect(exp).toBeCloseTo(0.6 * 0.4 + 0.4 * -0.3); // 0.24 - 0.12 = 0.12
  });
});
