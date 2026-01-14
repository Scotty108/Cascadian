/**
 * Smart Money Signals v2 - Type Definitions
 *
 * Based on backtesting 65,218 resolved markets.
 * See: docs/smart-money-signals/SMART_MONEY_SIGNALS_RESEARCH.md
 */

// ============================================================================
// Signal Types
// ============================================================================

/**
 * Validated signal types from backtesting.
 * Each has specific conditions and proven ROI.
 */
export type SignalType =
  // FOLLOW signals (bet WITH smart money)
  | "TECH_YES_AHEAD" // SM 70%+ YES, crowd 55-68%, +47% ROI
  | "TECH_NO_BEARISH" // SM ≤30%, crowd 32-45%, +11% ROI
  | "WORLD_YES_AHEAD" // SM 70%+ YES, crowd 55-68%, +24% ROI
  | "WORLD_NO_BEARISH" // SM ≤30%, crowd 32-45%, +20% ROI
  | "POLITICS_NO_BEARISH" // SM ≤30%, crowd 32-45%, +20% ROI
  | "ECONOMY_YES_AHEAD" // SM 70%+ YES, crowd 55-68%, +54% ROI (small n)
  | "CRYPTO_NO_BEARISH" // SM ≤30%, crowd 32-45%, +8% ROI
  | "CULTURE_NO_BEARISH" // SM ≤30%, crowd 32-45%, +8% ROI
  // FADE signals (bet AGAINST smart money)
  | "FADE_OTHER_YES" // SM 70%+ but wrong in Other category, +36% ROI
  | "FADE_FINANCE_NO" // SM ≤30% but wrong in Finance category, +38% ROI
  | "FADE_CRYPTO_CONTRARIAN"; // SM disagrees with crowd in Crypto, fade SM

/**
 * Action to take when signal is detected.
 */
export type SignalAction = "BET_YES" | "BET_NO";

/**
 * Confidence level based on backtest sample size and consistency.
 */
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

/**
 * Market categories from Polymarket.
 */
export type MarketCategory =
  | "Crypto"
  | "Politics"
  | "Sports"
  | "Tech"
  | "Finance"
  | "Other"
  | "Culture"
  | "World"
  | "Economy";

// ============================================================================
// Condition Types
// ============================================================================

/**
 * Numeric range condition (min/max bounds).
 */
export interface RangeCondition {
  min?: number;
  max?: number;
}

/**
 * Conditions that define when a signal is triggered.
 */
export interface SignalConditions {
  /** Categories this signal applies to */
  category: MarketCategory[];

  /** Smart money odds range (0-1) */
  smart_money_odds: RangeCondition;

  /** Crowd price range (0-1) */
  crowd_price: RangeCondition;

  /** Days before resolution range */
  days_before: RangeCondition;

  /** Optional: minimum wallet count for consensus */
  wallet_count?: RangeCondition;

  /** Optional: minimum total USD position */
  total_usd?: RangeCondition;

  /** Optional: require SM and crowd to disagree on direction */
  requires_disagreement?: boolean;
}

/**
 * Backtest statistics for a signal.
 */
export interface BacktestStats {
  /** Number of trades in backtest */
  trades: number;

  /** Win rate (0-1) */
  win_rate: number;

  /** Average ROI per trade (e.g., 0.47 = +47%) */
  roi: number;

  /** Average entry price when signal triggered */
  avg_entry_price?: number;

  /** Maximum drawdown (0-1) */
  max_drawdown?: number;

  /** Profit factor (gross wins / gross losses) */
  profit_factor?: number;

  /** Sharpe ratio (risk-adjusted returns) */
  sharpe_ratio?: number;

  /** Backtest period */
  period?: {
    start: string;
    end: string;
  };
}

// ============================================================================
// Signal Definition
// ============================================================================

/**
 * Complete definition of a signal including conditions and backtest results.
 */
export interface SignalDefinition {
  /** Unique signal type identifier */
  type: SignalType;

  /** Human-readable name */
  name: string;

  /** Description of the signal logic */
  description: string;

  /** Conditions that trigger this signal */
  conditions: SignalConditions;

  /** Action to take when signal fires */
  action: SignalAction;

  /** Whether this is a "fade" signal (bet against SM) */
  is_fade: boolean;

  /** Backtest statistics */
  backtest: BacktestStats;

  /** Minimum confidence level to act on this signal */
  min_confidence: ConfidenceLevel;
}

// ============================================================================
// Market Snapshot
// ============================================================================

/**
 * A point-in-time snapshot of smart money metrics for a market.
 */
export interface MarketSnapshot {
  /** Market/condition ID */
  market_id: string;

  /** Snapshot timestamp */
  timestamp: Date;

  /** Market category */
  category: MarketCategory;

  /** Smart money weighted probability (0-1) */
  smart_money_odds: number;

  /** Crowd/market price (0-1) */
  crowd_price: number;

  /** Number of smart money wallets */
  wallet_count: number;

  /** Total USD in smart money positions */
  total_usd: number;

  /** Days until resolution */
  days_before: number;

  /** Optional: market end date */
  end_date?: Date;

  /** Optional: 24h flow */
  flow_24h?: number;

  /** Optional: tier breakdown */
  superforecaster_usd?: number;
  smart_usd?: number;
  profitable_usd?: number;
}

// ============================================================================
// Detected Signal
// ============================================================================

/**
 * A signal that has been detected for a specific market.
 */
export interface DetectedSignal {
  /** The signal type that was matched */
  signal_type: SignalType;

  /** Market this signal applies to */
  market_id: string;

  /** Category of the market */
  category: MarketCategory;

  /** Action to take */
  action: SignalAction;

  /** Whether this is a fade signal (bet against SM) */
  is_fade: boolean;

  /** Price to enter at (crowd_price for YES, 1-crowd_price for NO) */
  entry_price: number;

  /** Current smart money odds */
  smart_money_odds: number;

  /** Current crowd/market price */
  crowd_price: number;

  /** Divergence between SM and crowd (SM - crowd) */
  divergence: number;

  /** Days until resolution */
  days_before: number;

  /** Number of smart wallets */
  wallet_count: number;

  /** Total USD in position */
  total_usd: number;

  /** Expected ROI based on backtest */
  expected_roi: number;

  /** Expected win rate based on backtest */
  expected_win_rate: number;

  /** Confidence level */
  confidence: ConfidenceLevel;

  /** Timestamp when signal was detected */
  detected_at: Date;

  /** Human-readable recommendation */
  recommendation: string;
}

// ============================================================================
// Trade Results
// ============================================================================

/**
 * Result of a single trade for ROI calculation.
 */
export interface TradeResult {
  /** Action taken */
  action: SignalAction;

  /** Entry price paid */
  entry_price: number;

  /** Market outcome (0 = NO won, 1 = YES won) */
  outcome: 0 | 1;
}

/**
 * Backtest results for a signal or hypothesis.
 */
export interface BacktestResults {
  /** Total number of trades */
  trades: number;

  /** Number of winning trades */
  wins: number;

  /** Number of losing trades */
  losses: number;

  /** Win rate (0-1) */
  win_rate: number;

  /** Total ROI across all trades */
  total_roi: number;

  /** Average ROI per trade */
  avg_roi: number;

  /** Sharpe ratio (risk-adjusted returns) */
  sharpe_ratio: number;

  /** Maximum drawdown */
  max_drawdown: number;

  /** Results broken down by category */
  by_category: Record<
    string,
    {
      trades: number;
      win_rate: number;
      roi: number;
    }
  >;

  /** Sample of individual trades */
  trades_sample: Array<{
    market_id: string;
    entry_price: number;
    outcome: 0 | 1;
    roi: number;
  }>;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response from /api/smart-money/signals/v2
 */
export interface SignalsResponse {
  signals: DetectedSignal[];
  summary: {
    total_signals: number;
    by_category: Record<string, number>;
    by_action: Record<string, number>;
    avg_expected_roi: number;
  };
  metadata: {
    last_updated: string;
    backtest_period: string;
  };
}

/**
 * Single opportunity with sizing recommendation.
 */
export interface Opportunity extends DetectedSignal {
  /** Rank by expected value */
  rank: number;

  /** Market question (from metadata) */
  question?: string;

  /** Kelly fraction for optimal sizing */
  kelly_fraction: number;

  /** Maximum recommended position size */
  max_position_usd: number;

  /** Expected value per dollar bet */
  expected_value: number;
}

/**
 * Response from /api/smart-money/opportunities/v2
 */
export interface OpportunitiesResponse {
  opportunities: Opportunity[];
  summary: {
    total_opportunities: number;
    total_expected_value: number;
    best_category: string;
  };
}
