/**
 * Wallet Intelligence Types
 * Core type definitions for the wallet intelligence database
 */

// Side in "YES/NO space" - the actual market side
export type MarketSide = 'YES' | 'NO';

// Action type
export type TradeAction = 'BUY' | 'SELL';

// Raw fill from CLOB
export interface Fill {
  fill_id: string;
  ts_fill: Date;
  wallet: string;
  condition_id: string;
  outcome_index: number; // 0 = YES, 1 = NO typically
  side: MarketSide;
  action: TradeAction;
  price_yes: number; // 0..1
  qty_shares: number;
  notional_usd: number;
  fee_usd: number;
  tx_hash: string;
  block_number: number;
  // Enrichment
  category?: string;
  event_id?: string;
}

// Market resolution
export interface MarketResolution {
  condition_id: string;
  resolved_at: Date;
  outcome_yes: 0 | 1; // 1 if YES won, 0 if NO won
  payout_numerators: number[];
}

// Derived position
export interface Position {
  position_id: string;
  wallet: string;
  condition_id: string;
  category: string;
  event_id: string;
  side: MarketSide;
  ts_open: Date;
  ts_close: Date | null; // null if held to resolution
  ts_resolve: Date;
  qty_shares: number;
  entry_cost_usd: number;
  exit_proceeds_usd: number;
  fees_usd: number;
  avg_entry_price_side: number; // price in "side space"
  avg_exit_price_side: number | null;
  outcome_side: 0 | 1; // 1 if this side won
  pnl_usd: number;
  roi: number;
  hold_minutes: number;
  // Anchor prices for CLV (in side space)
  p_close_1h: number | null;
  p_close_4h: number | null;
  p_close_24h: number | null;
  p_close_72h: number | null;
}

// Wallet features (the full fingerprint)
export interface WalletFeatures {
  wallet: string;
  window_days: number | null; // null = lifetime
  computed_at: Date;

  // === Identity & Activity ===
  wallet_age_days: number;
  positions_total: number;
  fills_total: number;
  active_days: number;
  positions_per_active_day: number;

  // === Time Horizon ===
  hold_minutes_median: number;
  hold_minutes_p10: number;
  hold_minutes_p50: number;
  hold_minutes_p90: number;
  pct_held_to_resolve: number;
  avg_time_to_resolve_at_entry_hours: number;

  // === Edge Type (CLV) ===
  avg_clv_1h: number;
  avg_clv_4h: number;
  avg_clv_24h: number;
  avg_clv_72h: number;
  clv_win_rate_24h: number;
  short_vs_long_edge: number; // avg_clv_4h - avg_clv_24h

  // === Payoff Shape ===
  win_rate: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  payoff_ratio: number;
  roi_p05: number;
  roi_p50: number;
  roi_p95: number;
  tail_ratio: number; // p95 / abs(p05)

  // === Risk Discipline ===
  total_pnl_usd: number;
  max_drawdown_usd: number;
  max_drawdown_pct: number;
  max_loss_roi: number;
  var_95_roi: number;
  cvar_95_roi: number;
  sortino_proxy: number;

  // === Focus Profile ===
  unique_categories: number;
  unique_events: number;
  unique_markets: number;
  category_hhi: number;
  event_hhi: number;
  market_hhi: number;
  top_category_share: number;
  top_event_share: number;
  top_market_share: number;
  size_hhi: number;
  conviction_top_decile_share: number;

  // === Forecasting Quality ===
  brier_score: number;
  log_loss: number;
  sharpness: number; // avg abs(p_entry - 0.5)

  // === Volume & Sizing ===
  total_cost_usd: number;
  total_proceeds_usd: number;
  avg_position_cost_usd: number;
  median_position_cost_usd: number;
  p90_position_cost_usd: number;
}

// Fingerprint labels
export interface TraderFingerprint {
  wallet: string;
  horizon_label: 'scalper' | 'swing' | 'forecaster';
  payoff_label: 'grinder' | 'balanced' | 'tail_hunter';
  edge_label: 'execution' | 'informational' | 'none';
  focus_label: 'specialist' | 'generalist';
  risk_label: 'disciplined' | 'volatile' | 'blowup_prone';
}
