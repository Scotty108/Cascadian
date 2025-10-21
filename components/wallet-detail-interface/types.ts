export interface WalletProfile {
  wallet_address: string;
  wallet_alias: string;
  wis: number;                    // 0-100 global skill score

  // Identity badges
  contrarian_pct: number;         // % of entries priced < 0.5
  lottery_ticket_count: number;   // positions entered < 0.2 now > 0.9
  is_senior: boolean;             // total positions > 1000
  bagholder_pct: number;          // % of current positions below entry
  reverse_cramer_count: number;   // positions entered > 0.8 now < 0.1
  whale_splash_count: number;     // positions with >$20k invested
  is_millionaire: boolean;        // total invested >= $1M

  // Performance metrics
  total_invested: number;         // Total capital deployed (USD)
  realized_pnl: number;           // Realized profit/loss (USD)
  realized_pnl_pct: number;       // Realized PnL percentage
  unrealized_pnl: number;         // Unrealized profit/loss (USD)
  unrealized_pnl_pct: number;     // Unrealized PnL percentage
  total_pnl: number;              // Realized + Unrealized PnL
  total_pnl_pct: number;          // Total PnL percentage

  // Trading statistics
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;               // 0-1
  avg_trade_size: number;         // USD
  largest_win: number;            // USD
  largest_loss: number;           // USD

  // Activity metrics
  markets_traded: number;
  active_positions: number;
  first_trade_date: string;       // ISO date
  last_trade_date: string;        // ISO date
  days_active: number;

  // Rankings
  rank_by_pnl: number;
  rank_by_wis: number;
  rank_by_volume: number;

  // Risk metrics
  risk_metrics?: RiskMetrics;
  pnl_ranks?: {
    d1: PnLRank;
    d7: PnLRank;
    d30: PnLRank;
    all: PnLRank;
  };
}

export interface WalletTrade {
  trade_id: string;
  timestamp: string;
  market_id: string;
  market_title: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  amount_usd: number;
  market_outcome: 'YES' | 'NO' | 'OPEN';  // Final outcome or still open
  pnl: number | null;             // Only if closed position
  pnl_pct: number | null;
}

export interface WalletPosition {
  position_id: string;
  market_id: string;
  market_title: string;
  category: string;
  side: 'YES' | 'NO';
  shares: number;
  avg_entry_price: number;
  current_price: number;
  invested: number;               // Total amount invested (USD)
  current_value: number;          // Current position value (USD)
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  market_active: boolean;
  market_end_date: string;
}

export interface PnLHistoryPoint {
  date: string;                   // ISO date
  realized_pnl: number;           // Cumulative realized PnL
  unrealized_pnl: number;         // Current unrealized PnL at that time
  total_pnl: number;              // Realized + Unrealized
  total_invested: number;         // Cumulative invested capital
}

export interface WinRateHistoryPoint {
  date: string;                   // ISO date
  win_rate: number;               // Rolling win rate (0-1)
  total_trades: number;           // Cumulative trades up to this point
  winning_trades: number;
}

export interface MarketDistributionItem {
  category: string;
  trades: number;
  volume: number;                 // USD
  pnl: number;
  win_rate: number;
}

export interface TradingPattern {
  pattern_name: string;
  description: string;
  frequency: number;              // How often this pattern occurs
  avg_return: number;             // Average return when pattern occurs
  confidence: number;             // 0-1
}

export interface WalletComparison {
  metric: string;
  wallet_value: number;
  platform_avg: number;
  top_10_pct_avg: number;
  percentile: number;             // 0-100 (higher is better)
}

export interface RiskMetrics {
  sharpe_ratio_30d: number;       // Annualized Sharpe Ratio (mean/stddev * sqrt(252))
  sharpe_level: 'Excellent' | 'Good' | 'Fair' | 'Poor';  // Threshold: ≥2.0=Excellent, ≥1.0=Good, ≥0.5=Fair, <0.5=Poor
  traded_volume_30d_daily: {
    date: string;
    volume_usd: number;
  }[];
  traded_volume_30d_total: number;
}

export interface PnLRank {
  period: '1D' | '7D' | '30D' | 'All';
  rank: number;
  pnl_usd: number;
}

export interface CategoryStats {
  category: string;
  trades: number;
  volume: number;
  pnl: number;
  win_rate: number;
  smart_score: number;
}

export interface EntryBucket {
  bucket: string;          // "0.0-0.1", "0.1-0.2", etc
  invested_usd: number;
  trade_count: number;
}

export interface PerMarketTrade {
  timestamp: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  price: number;
  shares: number;
  amount_usd: number;
}

export interface PerMarketData {
  market_id: string;
  market_title: string;
  trades: PerMarketTrade[];
  avg_buy_price_over_time: { date: string; avg_price: number; market_price: number }[];
}

export interface ActiveBet {
  position_id: string;
  market_id: string;
  market_title: string;
  category: string;
  side: 'YES' | 'NO';
  shares: number;
  avg_entry_price: number;
  current_price: number;
  invested: number;
  current_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  market_end_date: string;
}

export interface FinishedBet {
  position_id: string;
  market_id: string;
  market_title: string;
  category: string;
  side: 'YES' | 'NO';
  shares: number;
  avg_entry_price: number;
  exit_price: number;
  invested: number;
  final_value: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  roi: number;                    // Return on investment (%)
  closed_date: string;
  market_outcome: 'YES' | 'NO';   // Final market resolution
}
