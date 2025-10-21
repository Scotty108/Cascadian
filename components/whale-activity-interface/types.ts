// Whale Activity & Insiders Feature Types
// Based on spec: .agent-os/specs/whale-activity-insiders-feature.md

export interface WhalePosition {
  position_id: string;
  wallet_address: string;
  wallet_alias?: string;
  market_id: string;
  market_title: string;
  category: string;
  side: 'YES' | 'NO';
  shares: number;
  avg_entry_price: number;
  current_price: number;
  invested_usd: number;
  current_value_usd: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  first_trade_date: string;
  last_trade_date: string;
  total_trades: number;
  sws_score?: number; // Smart Whale Score (0-10)
}

export interface WhaleTrade {
  trade_id: string;
  wallet_address: string;
  wallet_alias?: string;
  market_id: string;
  market_title: string;
  category: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  amount_usd: number;
  timestamp: string;
  sws_score?: number;
  is_unusual?: boolean;
  unusual_reasons?: string[];
}

export interface WhaleWallet {
  address: string;
  alias?: string;
  total_volume: number;
  total_trades: number;
  active_positions: number;
  win_rate: number;
  realized_pnl: number;
  realized_roi: number;
  sws_score: number;
  sws_reliability: number;
  rank?: number;
  last_active: string;
}

export interface WhaleActivityFilters {
  timeframe: '24h' | '7d' | '30d' | '90d' | 'all';
  markets?: string[];
  categories?: string[];
  min_amount?: number;
  max_amount?: number;
  wallets?: string[];
  action?: 'BUY' | 'SELL' | 'all';
  side?: 'YES' | 'NO' | 'all';
  min_sws?: number;
  only_unusual?: boolean;
}

export interface ConcentrationData {
  market_id: string;
  market_title: string;
  total_whale_volume: number;
  whale_share_pct: number; // % of total market volume
  unique_whales: number;
  herfindahl_index: number; // Concentration metric (0-1)
  top_wallet: {
    address: string;
    alias?: string;
    volume: number;
    share_pct: number;
  };
  sentiment: 'BULLISH' | 'BEARISH' | 'MIXED';
}

export interface PositionFlip {
  flip_id: string;
  wallet_address: string;
  wallet_alias?: string;
  market_id: string;
  market_title: string;
  from_side: 'YES' | 'NO';
  to_side: 'YES' | 'NO';
  flip_date: string;
  prev_investment: number;
  new_investment: number;
  price_at_flip: number;
  sws_score?: number;
}

export interface FlowData {
  timestamp: string;
  buy_volume: number;
  sell_volume: number;
  net_flow: number;
  unique_buyers: number;
  unique_sellers: number;
}

export interface UnusualTrade extends WhaleTrade {
  unusual_score: number; // 0-10
  unusual_reasons: string[];
  std_devs_from_mean: number;
}

// Insiders Types

export interface InsiderWallet {
  address: string;
  alias?: string;
  insider_score: number; // 0-10
  timing_score: number;
  volume_score: number;
  outcome_score: number;
  cluster_score: number;
  total_trades: number;
  total_volume: number;
  win_rate: number;
  avg_time_to_outcome_minutes: number;
  investigation_status: 'flagged' | 'monitoring' | 'cleared' | 'confirmed';
  flagged_date: string;
  last_activity: string;
}

export interface InsiderMarket {
  market_id: string;
  market_title: string;
  insider_activity_score: number;
  suspicious_wallets: number;
  unusual_timing_count: number;
  unusual_volume_count: number;
  cluster_involvement: number;
  investigation_priority: 'high' | 'medium' | 'low';
}

export interface WalletCluster {
  cluster_id: string;
  member_addresses: string[];
  avg_insider_score: number;
  risk_level: 'high' | 'medium' | 'low';
  total_volume: number;
  total_trades: number;
  common_markets: string[];
  connection_strength: number; // 0-1
  first_detected: string;
  last_activity: string;
  status: 'detected' | 'monitoring' | 'confirmed' | 'dismissed';
}

export interface SuspiciousPattern {
  pattern_type: 'timing' | 'volume' | 'coordination' | 'information_asymmetry';
  severity: 'high' | 'medium' | 'low';
  description: string;
  involved_wallets: string[];
  involved_markets: string[];
  detected_date: string;
  confidence: number; // 0-1
}

// Legacy types (keeping for backward compatibility)
export interface WhaleTransaction {
  txn_id: string;
  wallet_id: string;
  wallet_alias?: string;
  wis: number;
  market_id: string;
  market_title: string;
  outcome: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  shares: number;
  amount_usd: number;
  price: number;
  timestamp: string;
}

export interface WhaleActivitySummary {
  total_volume_24h: number;
  total_transactions_24h: number;
  avg_transaction_size: number;
  top_market: string;
}

export interface MarketWhaleActivity {
  market_id: string;
  market_title: string;
  whale_volume_24h: number;
  whale_transactions: number;
  net_whale_sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}
