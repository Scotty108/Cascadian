/**
 * Copy Trading System - TypeScript Types
 *
 * Type definitions for the copy trading infrastructure
 */

// ============================================================
// Core Types
// ============================================================

export type TradeSide = 'YES' | 'NO';
export type TradeStatus = 'open' | 'closed' | 'partially_closed' | 'error';
export type ExitReason = 'resolution' | 'stop_loss' | 'take_profit' | 'manual' | 'source_exited';
export type Decision = 'copy' | 'skip' | 'copy_reduced' | 'error';
export type WalletTrackingStatus = 'active' | 'paused' | 'stopped' | 'underperforming';
export type OwrrConfidence = 'high' | 'medium' | 'low' | 'insufficient';

// ============================================================
// Database Table Types
// ============================================================

export interface TrackedWallet {
  id: number;
  strategy_id: string;
  wallet_address: string;

  // Selection context
  selection_reason: string | null;
  selection_filters: Record<string, any> | null;

  // Performance expectations
  expected_omega: number | null;
  expected_omega_lag_30s: number | null;
  expected_omega_lag_2min: number | null;
  expected_ev_per_hour: number | null;

  // Specialization
  primary_category: string | null;
  category_omega: number | null;

  // Status
  status: WalletTrackingStatus;
  started_tracking_at: Date;
  stopped_tracking_at: Date | null;

  // Performance
  trades_copied: number;
  trades_skipped: number;
  cumulative_pnl: number;
  current_omega: number | null;

  // Alerts
  alert_on_underperformance: boolean;
  alert_threshold_omega: number | null;

  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface CopyTradeSignal {
  id: number;
  signal_id: string;

  // Source
  strategy_id: string;
  source_wallet: string;
  source_trade_id: string | null;

  // Market
  market_id: string;
  condition_id: string | null;
  side: TradeSide;

  // Source trade
  source_entry_price: number | null;
  source_shares: number | null;
  source_usd_amount: number | null;
  source_timestamp: Date;

  // Timing
  signal_received_at: Date;
  latency_seconds: number | null;

  // OWRR analysis
  owrr_score: number | null;
  owrr_slider: number | null;
  owrr_yes_score: number | null;
  owrr_no_score: number | null;
  owrr_yes_qualified: number | null;
  owrr_no_qualified: number | null;
  owrr_confidence: OwrrConfidence | null;

  // Decision
  decision: Decision;
  decision_reason: string;
  decision_factors: Record<string, any> | null;

  // Outcome
  copied_trade_id: number | null;
  position_size_multiplier: number | null;

  // Metadata
  created_at: Date;
}

export interface CopyTrade {
  id: number;

  // Strategy & source
  strategy_id: string;
  source_wallet: string;
  source_trade_id: string | null;
  signal_id: string | null;

  // Market
  market_id: string;
  condition_id: string | null;
  side: TradeSide;

  // Source trade
  source_entry_price: number | null;
  source_shares: number | null;
  source_usd_amount: number | null;
  source_timestamp: Date | null;

  // Our trade
  our_order_id: string | null;
  our_entry_price: number | null;
  our_shares: number | null;
  our_usd_amount: number | null;
  our_timestamp: Date | null;

  // Execution quality
  latency_seconds: number | null;
  slippage_bps: number | null;
  slippage_usd: number | null;
  execution_fee_usd: number | null;

  // Status
  status: TradeStatus;

  // Close
  exit_price: number | null;
  exit_timestamp: Date | null;
  exit_reason: ExitReason | null;

  // Performance
  realized_pnl_usd: number | null;
  realized_pnl_pct: number | null;
  unrealized_pnl_usd: number | null;

  // Comparison
  source_realized_pnl_usd: number | null;
  pnl_capture_ratio: number | null;

  // Risk
  max_drawdown_pct: number | null;
  holding_period_hours: number | null;

  // OWRR context
  entry_owrr_score: number | null;
  entry_owrr_slider: number | null;

  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface PerformanceSnapshot {
  id: number;
  strategy_id: string;
  source_wallet: string | null;
  snapshot_date: Date;

  // Our performance
  our_trades_count: number | null;
  our_trades_opened: number | null;
  our_trades_closed: number | null;
  our_total_pnl: number | null;
  our_avg_pnl: number | null;
  our_win_rate: number | null;
  our_omega: number | null;

  // Source performance
  source_trades_count: number | null;
  source_total_pnl: number | null;
  source_avg_pnl: number | null;
  source_win_rate: number | null;
  source_omega: number | null;

  // Capture ratios
  trade_capture_ratio: number | null;
  pnl_capture_ratio: number | null;
  omega_capture_ratio: number | null;

  // Execution quality
  avg_latency_seconds: number | null;
  avg_slippage_bps: number | null;
  median_latency_seconds: number | null;
  median_slippage_bps: number | null;

  // Decision quality
  signals_received: number | null;
  signals_copied: number | null;
  signals_skipped: number | null;
  copy_rate: number | null;

  // OWRR effectiveness
  avg_owrr_when_copied: number | null;
  avg_owrr_when_skipped: number | null;
  copied_trades_avg_pnl: number | null;
  skipped_trades_would_have_pnl: number | null;

  // Metadata
  created_at: Date;
}

// ============================================================
// API Request/Response Types
// ============================================================

export interface TrackWalletRequest {
  strategy_id: string;
  wallet_address: string;
  selection_reason?: string;
  selection_filters?: Record<string, any>;
  expected_metrics?: {
    omega?: number;
    omega_lag_30s?: number;
    omega_lag_2min?: number;
    ev_per_hour?: number;
  };
  primary_category?: string;
}

export interface CopyTradeSignalPayload {
  signal_id: string;
  strategy_id: string;
  source_wallet: string;
  source_trade_id?: string;
  market_id: string;
  condition_id?: string;
  side: TradeSide;
  source_entry_price: number;
  source_shares: number;
  source_usd_amount: number;
  source_timestamp: Date;
  latency_seconds?: number;
}

export interface OwrrAnalysis {
  owrr_score: number;
  owrr_slider: number;
  yes_score: number;
  no_score: number;
  yes_qualified: number;
  no_qualified: number;
  yes_avg_omega: number;
  no_avg_omega: number;
  yes_avg_risk: number;
  no_avg_risk: number;
  confidence: OwrrConfidence;
  category: string;
}

export interface CopyDecision {
  decision: Decision;
  reason: string;
  factors: {
    owrr?: number;
    latency?: number;
    slippage_risk?: string;
    portfolio_heat?: number;
    category_match?: boolean;
    [key: string]: any;
  };
  position_size_multiplier?: number;
}

export interface ExecuteCopyTradeRequest {
  signal_id: string;
  strategy_id: string;
  market_id: string;
  condition_id: string;
  side: TradeSide;
  amount_usd: number;
  max_slippage_bps?: number;
  owrr_context?: OwrrAnalysis;
}

export interface ExecuteCopyTradeResponse {
  success: boolean;
  copy_trade_id: number;
  order_id: string;
  executed_price: number;
  executed_shares: number;
  execution_fee: number;
  latency_seconds: number;
  slippage_bps: number;
}

// ============================================================
// Performance Tracking Types
// ============================================================

export interface StrategyPerformanceSummary {
  strategy_id: string;
  total_trades: number;
  open_trades: number;
  closed_trades: number;
  total_realized_pnl: number;
  avg_pnl_per_trade: number;
  avg_latency_sec: number;
  avg_slippage_bps: number;
  avg_capture_ratio: number;
  win_rate: number;
  total_capital_deployed: number;
}

export interface WalletComparisonMetrics {
  source_wallet: string;
  our_trades: number;
  source_trades: number;
  trade_capture_ratio: number;
  our_total_pnl: number;
  source_total_pnl: number;
  pnl_capture_ratio: number;
  our_omega: number;
  source_omega: number;
  omega_capture_ratio: number;
  avg_latency_seconds: number;
  avg_slippage_bps: number;
}

export interface OwrrDecisionQuality {
  strategy_id: string;
  decision: Decision;
  signal_count: number;
  avg_owrr: number;
  avg_slider: number;
  avg_latency: number;
  avg_pnl: number | null;
  winning_copies: number;
  losing_copies: number;
  win_rate: number | null;
}

// ============================================================
// Event Types (for WalletMonitor)
// ============================================================

export interface NewTradeEvent {
  trade_id: string;
  wallet_address: string;
  market_id: string;
  condition_id: string;
  side: TradeSide;
  entry_price: number;
  shares: number;
  usd_amount: number;
  timestamp: Date;
  detected_at: Date;
}

export interface WalletMonitorConfig {
  poll_interval_ms: number;
  max_latency_seconds: number;
  enable_owrr: boolean;
  owrr_threshold?: number;
}

// ============================================================
// Position Sizing Types
// ============================================================

export interface PositionSizingConfig {
  portfolio_size_usd: number;
  max_position_pct: number; // e.g., 0.05 = 5%
  max_portfolio_heat: number; // e.g., 0.5 = 50% max in open positions
  kelly_fraction: number; // e.g., 0.375 = fractional Kelly
  min_bet_usd: number;
  max_bet_usd: number;
  risk_reward_threshold: number; // e.g., 2.0 = need 2:1 R:R
  drawdown_protection?: {
    enabled: boolean;
    drawdown_threshold: number; // e.g., 0.10 = 10% drawdown
    size_reduction: number; // e.g., 0.50 = cut size in half
  };
}

export interface PositionSizingResult {
  recommended_usd: number;
  recommended_shares: number;
  reasoning: string;
  constraints_applied: string[];
  kelly_optimal: number;
  fractional_kelly: number;
  portfolio_heat_check: {
    current_heat: number;
    remaining_capacity: number;
  };
}

// ============================================================
// Utility Types
// ============================================================

export interface TimeWindow {
  start: Date;
  end: Date;
  label: '30d' | '90d' | '180d' | 'lifetime';
}

export interface PriceSnapshot {
  timestamp: Date;
  yes_price: number;
  no_price: number;
  total_volume: number;
}

export interface MarketContext {
  market_id: string;
  question: string;
  category: string;
  end_date: Date;
  current_yes_price: number;
  current_no_price: number;
  liquidity: number;
  volume_24h: number;
}

// ============================================================
// Filter Types for Queries
// ============================================================

export interface CopyTradeFilters {
  strategy_id?: string;
  source_wallet?: string;
  market_id?: string;
  status?: TradeStatus[];
  min_pnl?: number;
  max_pnl?: number;
  min_latency?: number;
  max_latency?: number;
  date_from?: Date;
  date_to?: Date;
}

export interface SignalFilters {
  strategy_id?: string;
  decision?: Decision[];
  min_owrr?: number;
  max_owrr?: number;
  date_from?: Date;
  date_to?: Date;
}
