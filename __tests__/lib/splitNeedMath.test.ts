import { describe, expect, it } from '@jest/globals';

import {
  computeConditionSplitNeed,
  redeemedTokensFromPayout,
} from '@/lib/pnl/splitNeedMath';

describe('splitNeedMath helpers', () => {
  it('converts redemption payouts to tokens using resolution price', () => {
    expect(redeemedTokensFromPayout(100, 1)).toBe(100);
    expect(redeemedTokensFromPayout(100, 0.5)).toBe(200);
    expect(redeemedTokensFromPayout(100, 0)).toBe(0);
    expect(redeemedTokensFromPayout(100, null)).toBe(0);
    expect(redeemedTokensFromPayout(100, undefined)).toBe(0);
  });

  it('computes no split need for pure buyers', () => {
    const result = computeConditionSplitNeed([
      {
        outcomeIndex: 0,
        bought: 100,
        sold: 0,
        redeemedTokens: 0,
        resolutionPrice: 1,
      },
      {
        outcomeIndex: 1,
        bought: 0,
        sold: 0,
        redeemedTokens: 0,
        resolutionPrice: 0,
      },
    ]);

    expect(result.splitCost).toBe(0);
    expect(result.heldByOutcome.get(0)).toBe(100);
    expect(result.heldByOutcome.get(1)).toBe(0);
    expect(result.heldValue).toBe(100);
  });

  it('computes split need when sells/redeems exceed buys', () => {
    const result = computeConditionSplitNeed([
      {
        outcomeIndex: 0,
        bought: 0,
        sold: 0,
        redeemedTokens: 100,
        resolutionPrice: 1,
      },
      {
        outcomeIndex: 1,
        bought: 0,
        sold: 100,
        redeemedTokens: 0,
        resolutionPrice: 0,
      },
    ]);

    expect(result.splitCost).toBe(100);
    expect(result.heldByOutcome.get(0)).toBe(0);
    expect(result.heldByOutcome.get(1)).toBe(0);
    expect(result.heldValue).toBe(0);
  });

  it('handles fractional resolution prices', () => {
    const result = computeConditionSplitNeed([
      {
        outcomeIndex: 0,
        bought: 0,
        sold: 0,
        redeemedTokens: 200,
        resolutionPrice: 0.5,
      },
      {
        outcomeIndex: 1,
        bought: 0,
        sold: 200,
        redeemedTokens: 0,
        resolutionPrice: 0.5,
      },
    ]);

    expect(result.splitCost).toBe(200);
    expect(result.heldValue).toBe(0);
  });
});
