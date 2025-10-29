export interface OmegaLeaderboardRow {
  wallet_id: string;
  wallet_alias: string;
  omega_ratio: number;           // Ratio of gains to losses
  omega_momentum: number;         // Rate of change in omega ratio
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  momentum_direction: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  total_pnl: number;             // Total realized PnL
  total_gains: number;           // Sum of winning trades
  total_losses: number;          // Sum of losing trades
  win_rate: number;              // Percentage (0-100)
  avg_gain: number;              // Average winning trade size
  avg_loss: number;              // Average losing trade size
  total_positions: number;       // Total positions opened
  closed_positions: number;      // Positions closed (used for omega calc)
  calculated_at: string;         // ISO date

  // Calculated fields
  roi_per_bet?: number;          // Average P&L per trade (total_pnl / closed_positions)
  overall_roi?: number;          // ROI % (total_pnl / total_capital_deployed)

  // Category-specific fields (when filtering by category)
  category?: string | null;      // Category name (e.g., "Politics / Geopolitics")
  trades_in_category?: number;   // Number of trades in this category
  pct_of_total_trades?: number;  // Percentage of total trades in this category (0-100)
}
