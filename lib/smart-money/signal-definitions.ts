/**
 * Smart Money Signal Definitions Registry
 *
 * All validated signals from backtesting 65,218 resolved markets.
 * Each signal has proven ROI and specific trigger conditions.
 *
 * See: docs/smart-money-signals/SMART_MONEY_SIGNALS_RESEARCH.md
 */

import { SignalDefinition } from "./types";

/**
 * Registry of all validated signal definitions.
 * Ordered by ROI (highest first).
 */
export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  // ============================================================================
  // TIER 1: High-Confidence FOLLOW Signals
  // ============================================================================

  {
    type: "ECONOMY_YES_AHEAD",
    name: "Economy YES - SM Ahead of Crowd",
    description:
      "Smart money is 70%+ confident on YES, but crowd is only 55-68%. SM has information the crowd hasn't priced in yet.",
    conditions: {
      category: ["Economy"],
      smart_money_odds: { min: 0.7 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    },
    action: "BET_YES",
    is_fade: false,
    backtest: {
      trades: 67,
      win_rate: 1.0,
      roi: 0.54,
      avg_entry_price: 0.652,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "MEDIUM", // Small sample size
  },

  {
    type: "TECH_YES_AHEAD",
    name: "Tech YES - SM Ahead of Crowd",
    description:
      "Smart money is 70%+ confident on YES in Tech markets, but crowd is only 55-68%. Historically 91% accurate.",
    conditions: {
      category: ["Tech"],
      smart_money_odds: { min: 0.7 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    },
    action: "BET_YES",
    is_fade: false,
    backtest: {
      trades: 892,
      win_rate: 0.911,
      roi: 0.47,
      avg_entry_price: 0.622,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "WORLD_YES_AHEAD",
    name: "World YES - SM Ahead of Crowd",
    description:
      "Smart money is 70%+ confident on YES in World/global markets, but crowd is only 55-68%.",
    conditions: {
      category: ["World"],
      smart_money_odds: { min: 0.7 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    },
    action: "BET_YES",
    is_fade: false,
    backtest: {
      trades: 419,
      win_rate: 0.761,
      roi: 0.24,
      avg_entry_price: 0.618,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "WORLD_NO_BEARISH",
    name: "World NO - SM Bearish",
    description:
      "Smart money is ≤30% (bearish) in World markets, but crowd is still 32-45%. Bet NO.",
    conditions: {
      category: ["World"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_NO",
    is_fade: false,
    backtest: {
      trades: 1018,
      win_rate: 0.743,
      roi: 0.2,
      avg_entry_price: 0.622,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "POLITICS_NO_BEARISH",
    name: "Politics NO - SM Bearish",
    description:
      "Smart money is ≤30% (bearish) in Politics markets, but crowd is still 32-45%. Bet NO.",
    conditions: {
      category: ["Politics"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_NO",
    is_fade: false,
    backtest: {
      trades: 1442,
      win_rate: 0.746,
      roi: 0.2,
      avg_entry_price: 0.622,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "TECH_NO_BEARISH",
    name: "Tech NO - SM Bearish",
    description:
      "Smart money is ≤30% (bearish) in Tech markets, but crowd is still 32-45%. Bet NO.",
    conditions: {
      category: ["Tech"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_NO",
    is_fade: false,
    backtest: {
      trades: 673,
      win_rate: 0.688,
      roi: 0.11,
      avg_entry_price: 0.622,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "CRYPTO_NO_BEARISH",
    name: "Crypto NO - SM Bearish",
    description:
      "Smart money is ≤30% (bearish) in Crypto markets, but crowd is still 32-45%. Bet NO.",
    conditions: {
      category: ["Crypto"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_NO",
    is_fade: false,
    backtest: {
      trades: 1602,
      win_rate: 0.676,
      roi: 0.08,
      avg_entry_price: 0.623,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "CULTURE_NO_BEARISH",
    name: "Culture NO - SM Bearish",
    description:
      "Smart money is ≤30% (bearish) in Culture markets, but crowd is still 32-45%. Bet NO.",
    conditions: {
      category: ["Culture"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_NO",
    is_fade: false,
    backtest: {
      trades: 364,
      win_rate: 0.676,
      roi: 0.08,
      avg_entry_price: 0.63,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "MEDIUM",
  },

  // ============================================================================
  // TIER 2: FADE Signals (bet AGAINST smart money)
  // ============================================================================

  {
    type: "FADE_FINANCE_NO",
    name: "Fade Finance NO",
    description:
      "Smart money is ≤30% (bearish) in Finance, but they're historically WRONG. Bet YES (fade SM).",
    conditions: {
      category: ["Finance"],
      smart_money_odds: { max: 0.3 },
      crowd_price: { min: 0.32, max: 0.45 },
      days_before: { min: 5 },
    },
    action: "BET_YES", // Opposite of what SM suggests
    is_fade: true,
    backtest: {
      trades: 2110,
      win_rate: 0.609,
      roi: 0.38,
      avg_entry_price: 0.628,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "FADE_OTHER_YES",
    name: "Fade Other YES",
    description:
      "Smart money is 70%+ on YES in 'Other' category, but they're historically WRONG. Bet NO (fade SM).",
    conditions: {
      category: ["Other"],
      smart_money_odds: { min: 0.7 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    },
    action: "BET_NO", // Opposite of what SM suggests
    is_fade: true,
    backtest: {
      trades: 4186,
      win_rate: 0.605,
      roi: 0.36,
      avg_entry_price: 0.618,
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },

  {
    type: "FADE_CRYPTO_CONTRARIAN",
    name: "Fade Crypto Contrarian",
    description:
      "Smart money disagrees with crowd direction in Crypto. Follow the CROWD, not SM. 73.5% win rate.",
    conditions: {
      category: ["Crypto"],
      smart_money_odds: { min: 0, max: 1 }, // Will check disagreement separately
      crowd_price: { min: 0, max: 1 },
      days_before: { min: 3 },
      requires_disagreement: true,
    },
    action: "BET_YES", // Action is dynamic based on crowd direction
    is_fade: true,
    backtest: {
      trades: 7023,
      win_rate: 0.735,
      roi: 0.25, // Estimated based on 73.5% win at ~60c avg entry
      period: { start: "2025-11-14", end: "2026-01-14" },
    },
    min_confidence: "HIGH",
  },
];

/**
 * Get a signal definition by type.
 */
export function getSignalDefinition(
  type: SignalType
): SignalDefinition | undefined {
  return SIGNAL_DEFINITIONS.find((s) => s.type === type);
}

/**
 * Get all signal definitions for a category.
 */
export function getSignalsForCategory(category: string): SignalDefinition[] {
  return SIGNAL_DEFINITIONS.filter((s) =>
    s.conditions.category.includes(category as any)
  );
}

/**
 * Get all FOLLOW signals (non-fade).
 */
export function getFollowSignals(): SignalDefinition[] {
  return SIGNAL_DEFINITIONS.filter((s) => !s.is_fade);
}

/**
 * Get all FADE signals.
 */
export function getFadeSignals(): SignalDefinition[] {
  return SIGNAL_DEFINITIONS.filter((s) => s.is_fade);
}

/**
 * Get signals sorted by expected ROI.
 */
export function getSignalsByROI(): SignalDefinition[] {
  return [...SIGNAL_DEFINITIONS].sort(
    (a, b) => b.backtest.roi - a.backtest.roi
  );
}

// Type export for SignalType
import type { SignalType } from "./types";
