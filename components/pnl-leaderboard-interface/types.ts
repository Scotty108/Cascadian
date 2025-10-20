export interface PnLLeaderboardRow {
  wallet_id: string;
  wallet_alias: string;
  wis: number;                    // Smart Score: -100 to +100
  realized_pnl_usd: number;       // Total profit/loss
  total_invested_usd: number;     // Total capital deployed
  roi: number;                    // Return on investment (percentage)
  trades_total: number;
  win_rate: number;               // 0-100
  contrarian_score: number;       // % of trades against crowd (0-100)
  contrarian_win_rate: number;    // Win rate on contrarian trades (0-100)
  last_trade_date: string;        // ISO date
}
