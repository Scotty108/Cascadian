/**
 * Smart Money Signals v2
 *
 * A validated signal detection system based on backtesting 65,218 resolved markets.
 *
 * Usage:
 *   import { detectSignal, calculateROI, SIGNAL_DEFINITIONS } from '@/lib/smart-money';
 *
 * See: docs/smart-money-signals/SMART_MONEY_SIGNALS_RESEARCH.md
 */

// Types
export * from "./types";

// Signal definitions
export {
  SIGNAL_DEFINITIONS,
  getSignalDefinition,
  getSignalsForCategory,
  getFollowSignals,
  getFadeSignals,
  getSignalsByROI,
} from "./signal-definitions";

// Signal detection
export {
  detectSignal,
  detectAllSignals,
  detectSignalsBatch,
  matchesConditions,
  calculateConfidence,
  calculateEntryPrice,
} from "./detect-signals";

// ROI calculations
export {
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
} from "./roi-calculator";
