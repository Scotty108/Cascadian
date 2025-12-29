export interface OutcomeFlow {
  outcomeIndex: number;
  bought: number;
  sold: number;
  redeemedTokens: number;
  resolutionPrice: number | null | undefined;
}

export interface ConditionSplitNeedResult {
  splitCost: number;
  heldValue: number;
  requiredSplitByOutcome: Map<number, number>;
  heldByOutcome: Map<number, number>;
}

export function redeemedTokensFromPayout(payoutUsdc: number, resolutionPrice?: number | null): number {
  if (!resolutionPrice || resolutionPrice <= 0) return 0;
  return payoutUsdc / resolutionPrice;
}

export function computeConditionSplitNeed(outcomes: OutcomeFlow[]): ConditionSplitNeedResult {
  const requiredSplitByOutcome = new Map<number, number>();
  const heldByOutcome = new Map<number, number>();
  let splitCost = 0;

  // Minimal split cost needed so all outcomes can satisfy sold + redeemed
  for (const outcome of outcomes) {
    const required = Math.max(0, outcome.sold + outcome.redeemedTokens - outcome.bought);
    requiredSplitByOutcome.set(outcome.outcomeIndex, required);
    if (required > splitCost) splitCost = required;
  }

  let heldValue = 0;
  for (const outcome of outcomes) {
    const held = Math.max(0, outcome.bought + splitCost - outcome.sold - outcome.redeemedTokens);
    heldByOutcome.set(outcome.outcomeIndex, held);
    if (held > 0 && outcome.resolutionPrice !== null && outcome.resolutionPrice !== undefined) {
      heldValue += held * outcome.resolutionPrice;
    }
  }

  return {
    splitCost,
    heldValue,
    requiredSplitByOutcome,
    heldByOutcome,
  };
}
