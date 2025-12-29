import {
  computeConditionSplitNeed,
  redeemedTokensFromPayout,
  type OutcomeFlow,
} from '@/lib/pnl/splitNeedMath';

describe('splitNeedMath', () => {
  test('redeemedTokensFromPayout converts USDC payout to tokens', () => {
    expect(redeemedTokensFromPayout(25, 0.5)).toBeCloseTo(50);
    expect(redeemedTokensFromPayout(10, 1)).toBeCloseTo(10);
    expect(redeemedTokensFromPayout(10, 0)).toBe(0);
    expect(redeemedTokensFromPayout(10, null)).toBe(0);
  });

  test('pure buyer requires no split and computes held value', () => {
    const outcomes: OutcomeFlow[] = [
      { outcomeIndex: 0, bought: 100, sold: 20, redeemedTokens: 0, resolutionPrice: 1 },
      { outcomeIndex: 1, bought: 0, sold: 0, redeemedTokens: 0, resolutionPrice: 0 },
    ];
    const result = computeConditionSplitNeed(outcomes);
    expect(result.splitCost).toBe(0);
    expect(result.heldByOutcome.get(0)).toBeCloseTo(80);
    expect(result.heldValue).toBeCloseTo(80);
  });

  test('split to sell loser yields split cost and held winner', () => {
    const outcomes: OutcomeFlow[] = [
      { outcomeIndex: 0, bought: 0, sold: 0, redeemedTokens: 0, resolutionPrice: 1 },
      { outcomeIndex: 1, bought: 0, sold: 50, redeemedTokens: 0, resolutionPrice: 0 },
    ];
    const result = computeConditionSplitNeed(outcomes);
    expect(result.splitCost).toBeCloseTo(50);
    expect(result.heldByOutcome.get(0)).toBeCloseTo(50);
    expect(result.heldByOutcome.get(1)).toBeCloseTo(0);
    expect(result.heldValue).toBeCloseTo(50);
  });

  test('redemptions reduce held and contribute to required split', () => {
    const outcomes: OutcomeFlow[] = [
      { outcomeIndex: 0, bought: 100, sold: 20, redeemedTokens: 30, resolutionPrice: 1 },
      { outcomeIndex: 1, bought: 0, sold: 0, redeemedTokens: 0, resolutionPrice: 0 },
    ];
    const result = computeConditionSplitNeed(outcomes);
    expect(result.splitCost).toBe(0);
    expect(result.heldByOutcome.get(0)).toBeCloseTo(50);
    expect(result.heldValue).toBeCloseTo(50);
  });

  test('split cost uses max required across outcomes', () => {
    const outcomes: OutcomeFlow[] = [
      { outcomeIndex: 0, bought: 0, sold: 100, redeemedTokens: 0, resolutionPrice: 1 },
      { outcomeIndex: 1, bought: 0, sold: 60, redeemedTokens: 0, resolutionPrice: 0 },
    ];
    const result = computeConditionSplitNeed(outcomes);
    expect(result.splitCost).toBeCloseTo(100);
  });
});
