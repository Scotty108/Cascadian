-- Useful views and functions for Market SII system

-- View: Top Omega Wallets
CREATE OR REPLACE VIEW top_omega_wallets AS
SELECT
  wallet_address,
  omega_ratio,
  grade,
  total_pnl,
  omega_momentum,
  momentum_direction,
  closed_positions,
  win_rate,
  calculated_at
FROM wallet_scores
WHERE meets_minimum_trades = TRUE
ORDER BY omega_ratio DESC
LIMIT 100;

-- View: Hot Wallets (Improving Momentum)
CREATE OR REPLACE VIEW hot_wallets AS
SELECT
  wallet_address,
  omega_ratio,
  grade,
  omega_momentum,
  total_pnl,
  closed_positions,
  calculated_at
FROM wallet_scores
WHERE meets_minimum_trades = TRUE
  AND momentum_direction = 'improving'
  AND omega_momentum > 0.1
ORDER BY omega_momentum DESC
LIMIT 100;

-- View: Strongest SII Signals
CREATE OR REPLACE VIEW strongest_sii_signals AS
SELECT
  market_id,
  market_question,
  smart_money_side,
  omega_differential,
  signal_strength,
  confidence_score,
  yes_avg_omega,
  no_avg_omega,
  yes_wallet_count,
  no_wallet_count,
  calculated_at
FROM market_sii
WHERE signal_strength >= 0.5
  AND confidence_score >= 0.5
ORDER BY signal_strength DESC, confidence_score DESC
LIMIT 100;

-- Comments
COMMENT ON VIEW top_omega_wallets IS 'Top 100 wallets by Omega ratio (minimum 5 closed trades)';
COMMENT ON VIEW hot_wallets IS 'Wallets with improving momentum (>10% improvement)';
COMMENT ON VIEW strongest_sii_signals IS 'Markets with strongest smart money signals';
