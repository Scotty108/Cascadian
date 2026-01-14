/**
 * Smart Money Signal Detection
 *
 * Detects trading signals by matching market snapshots against validated patterns.
 */

import { SIGNAL_DEFINITIONS } from "./signal-definitions";
import {
  SignalDefinition,
  SignalConditions,
  RangeCondition,
  MarketSnapshot,
  DetectedSignal,
  ConfidenceLevel,
  SignalAction,
} from "./types";

/**
 * Check if a value is within a range condition.
 */
function matchesRange(value: number, range: RangeCondition): boolean {
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/**
 * Check if SM and crowd disagree on direction.
 */
function checkDisagreement(sm_odds: number, crowd_price: number): boolean {
  const sm_says_yes = sm_odds > 0.5;
  const crowd_says_yes = crowd_price > 0.5;
  return sm_says_yes !== crowd_says_yes;
}

/**
 * Check if a market snapshot matches the conditions for a signal.
 */
export function matchesConditions(
  market: MarketSnapshot,
  conditions: SignalConditions
): boolean {
  // Category check
  if (!conditions.category.includes(market.category)) {
    return false;
  }

  // Smart money odds check
  if (!matchesRange(market.smart_money_odds, conditions.smart_money_odds)) {
    return false;
  }

  // Crowd price check
  if (!matchesRange(market.crowd_price, conditions.crowd_price)) {
    return false;
  }

  // Days before resolution check
  if (!matchesRange(market.days_before, conditions.days_before)) {
    return false;
  }

  // Optional: wallet count check
  if (
    conditions.wallet_count &&
    !matchesRange(market.wallet_count, conditions.wallet_count)
  ) {
    return false;
  }

  // Optional: total USD check
  if (
    conditions.total_usd &&
    !matchesRange(market.total_usd, conditions.total_usd)
  ) {
    return false;
  }

  // Optional: requires disagreement between SM and crowd
  if (conditions.requires_disagreement) {
    if (!checkDisagreement(market.smart_money_odds, market.crowd_price)) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate confidence level based on backtest stats and current market conditions.
 */
export function calculateConfidence(
  definition: SignalDefinition,
  market: MarketSnapshot
): ConfidenceLevel {
  const { backtest } = definition;

  // Small sample size = lower confidence
  if (backtest.trades < 100) {
    return "LOW";
  }

  // High win rate + large sample = high confidence
  if (backtest.trades >= 500 && backtest.win_rate >= 0.7) {
    return "HIGH";
  }

  // Medium sample with decent win rate
  if (backtest.trades >= 200 && backtest.win_rate >= 0.6) {
    return "HIGH";
  }

  // Default to medium
  return "MEDIUM";
}

/**
 * Calculate entry price based on action and market price.
 * - BET_YES: Entry is crowd_price (buying YES token)
 * - BET_NO: Entry is 1 - crowd_price (buying NO token)
 */
export function calculateEntryPrice(
  action: SignalAction,
  crowd_price: number
): number {
  return action === "BET_YES" ? crowd_price : 1 - crowd_price;
}

/**
 * Generate human-readable recommendation text.
 */
function generateRecommendation(
  definition: SignalDefinition,
  market: MarketSnapshot
): string {
  const direction = definition.action === "BET_YES" ? "YES" : "NO";
  const confidence = calculateConfidence(definition, market);
  const roi = (definition.backtest.roi * 100).toFixed(0);

  if (definition.is_fade) {
    return `FADE: Bet ${direction} against smart money (${roi}% expected ROI, ${confidence} confidence)`;
  }

  return `${direction}: Follow smart money signal (${roi}% expected ROI, ${confidence} confidence)`;
}

/**
 * Detect if a market snapshot matches any validated signal.
 * Returns the first matching signal, or null if no match.
 */
export function detectSignal(market: MarketSnapshot): DetectedSignal | null {
  for (const definition of SIGNAL_DEFINITIONS) {
    if (matchesConditions(market, definition.conditions)) {
      // Special handling for FADE_CRYPTO_CONTRARIAN
      // The action depends on crowd direction, not fixed
      let action = definition.action;
      if (definition.type === "FADE_CRYPTO_CONTRARIAN") {
        // Follow crowd, not SM
        action = market.crowd_price > 0.5 ? "BET_YES" : "BET_NO";
      }

      const entry_price = calculateEntryPrice(action, market.crowd_price);
      const confidence = calculateConfidence(definition, market);

      return {
        signal_type: definition.type,
        market_id: market.market_id,
        category: market.category,
        action,
        is_fade: definition.is_fade,
        entry_price,
        smart_money_odds: market.smart_money_odds,
        crowd_price: market.crowd_price,
        divergence: market.smart_money_odds - market.crowd_price,
        days_before: market.days_before,
        wallet_count: market.wallet_count,
        total_usd: market.total_usd,
        expected_roi: definition.backtest.roi,
        expected_win_rate: definition.backtest.win_rate,
        confidence,
        detected_at: new Date(),
        recommendation: generateRecommendation(definition, market),
      };
    }
  }

  return null;
}

/**
 * Detect ALL matching signals for a market snapshot.
 * A market could potentially match multiple signal definitions.
 */
export function detectAllSignals(market: MarketSnapshot): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  for (const definition of SIGNAL_DEFINITIONS) {
    if (matchesConditions(market, definition.conditions)) {
      let action = definition.action;
      if (definition.type === "FADE_CRYPTO_CONTRARIAN") {
        action = market.crowd_price > 0.5 ? "BET_YES" : "BET_NO";
      }

      const entry_price = calculateEntryPrice(action, market.crowd_price);
      const confidence = calculateConfidence(definition, market);

      signals.push({
        signal_type: definition.type,
        market_id: market.market_id,
        category: market.category,
        action,
        is_fade: definition.is_fade,
        entry_price,
        smart_money_odds: market.smart_money_odds,
        crowd_price: market.crowd_price,
        divergence: market.smart_money_odds - market.crowd_price,
        days_before: market.days_before,
        wallet_count: market.wallet_count,
        total_usd: market.total_usd,
        expected_roi: definition.backtest.roi,
        expected_win_rate: definition.backtest.win_rate,
        confidence,
        detected_at: new Date(),
        recommendation: generateRecommendation(definition, market),
      });
    }
  }

  // Sort by expected ROI (highest first)
  return signals.sort((a, b) => b.expected_roi - a.expected_roi);
}

/**
 * Batch detect signals for multiple market snapshots.
 */
export function detectSignalsBatch(
  markets: MarketSnapshot[]
): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  for (const market of markets) {
    const signal = detectSignal(market);
    if (signal) {
      signals.push(signal);
    }
  }

  // Sort by expected ROI (highest first)
  return signals.sort((a, b) => b.expected_roi - a.expected_roi);
}
