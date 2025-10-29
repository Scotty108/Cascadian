-- ============================================================================
-- Wallet Metrics Query Examples
-- ============================================================================
-- This file contains example queries for the wallet_metrics_complete table
-- Generated from Phase 2 implementation (2025-10-28)

-- ============================================================================
-- 1. TOP TRADERS LEADERBOARD
-- ============================================================================

-- Top 20 wallets by Omega ratio (minimum 10 trades)
SELECT
  wallet_address,
  metric_2_omega_net as omega_ratio,
  metric_9_net_pnl_usd as net_pnl,
  metric_12_hit_rate as win_rate,
  metric_22_resolved_bets as total_trades,
  metric_13_avg_win_usd as avg_win,
  metric_14_avg_loss_usd as avg_loss,
  metric_60_tail_ratio as tail_ratio,
  metric_6_sharpe as sharpe_ratio,
  metric_23_track_record_days as days_active,
  metric_85_performance_trend_flag as trend
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_2_omega_net IS NOT NULL
  AND metric_22_resolved_bets >= 10
ORDER BY metric_2_omega_net DESC
LIMIT 20;

-- ============================================================================
-- 2. FILTERED LEADERBOARDS
-- ============================================================================

-- High-volume traders (500+ trades)
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades,
  metric_24_bets_per_week as activity
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_22_resolved_bets >= 500
  AND metric_2_omega_net > 1.0
ORDER BY metric_9_net_pnl_usd DESC
LIMIT 20;

-- Consistent performers (Omega > 2, Sharpe > 0.05)
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_6_sharpe as sharpe,
  metric_9_net_pnl_usd as pnl,
  metric_12_hit_rate as win_rate,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_2_omega_net > 2.0
  AND metric_6_sharpe > 0.05
  AND metric_22_resolved_bets >= 50
ORDER BY metric_2_omega_net DESC
LIMIT 20;

-- Recent hot performers (30d window, improving trend)
SELECT
  wallet_address,
  metric_2_omega_net as omega_30d,
  metric_9_net_pnl_usd as pnl_30d,
  metric_22_resolved_bets as trades_30d,
  metric_85_performance_trend_flag as trend
FROM wallet_metrics_complete
WHERE window = '30d'
  AND metric_2_omega_net > 1.5
  AND metric_22_resolved_bets >= 20
ORDER BY metric_2_omega_net DESC
LIMIT 20;

-- ============================================================================
-- 3. MULTI-WINDOW COMPARISON
-- ============================================================================

-- Compare wallet performance across time windows
SELECT
  wallet_address,
  window,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE wallet_address = '0x19da5bf0ae47a580fe2f0cd8992fe7ecad8df2df'
ORDER BY
  CASE window
    WHEN '30d' THEN 1
    WHEN '90d' THEN 2
    WHEN '180d' THEN 3
    WHEN 'lifetime' THEN 4
  END;

-- Wallets with improving performance (compare 30d vs lifetime)
WITH
  recent AS (
    SELECT wallet_address, metric_2_omega_net as omega_30d
    FROM wallet_metrics_complete
    WHERE window = '30d' AND metric_22_resolved_bets >= 10
  ),
  lifetime AS (
    SELECT wallet_address, metric_2_omega_net as omega_lifetime
    FROM wallet_metrics_complete
    WHERE window = 'lifetime' AND metric_22_resolved_bets >= 50
  )
SELECT
  l.wallet_address,
  r.omega_30d,
  l.omega_lifetime,
  (r.omega_30d - l.omega_lifetime) as omega_improvement
FROM lifetime l
INNER JOIN recent r ON l.wallet_address = r.wallet_address
WHERE r.omega_30d > l.omega_lifetime * 1.2
ORDER BY omega_improvement DESC
LIMIT 20;

-- ============================================================================
-- 4. STATISTICAL AGGREGATIONS
-- ============================================================================

-- Average metrics by time window
SELECT
  window,
  count() as wallet_count,
  avg(metric_2_omega_net) as avg_omega,
  median(metric_2_omega_net) as median_omega,
  avg(metric_9_net_pnl_usd) as avg_pnl,
  avg(metric_12_hit_rate) as avg_win_rate,
  avg(metric_22_resolved_bets) as avg_trades,
  avg(metric_6_sharpe) as avg_sharpe
FROM wallet_metrics_complete
WHERE metric_2_omega_net IS NOT NULL
GROUP BY window
ORDER BY
  CASE window
    WHEN '30d' THEN 1
    WHEN '90d' THEN 2
    WHEN '180d' THEN 3
    WHEN 'lifetime' THEN 4
  END;

-- Distribution of Omega ratios
SELECT
  CASE
    WHEN metric_2_omega_net < 0.5 THEN '<0.5 (losing)'
    WHEN metric_2_omega_net < 1.0 THEN '0.5-1.0 (break-even)'
    WHEN metric_2_omega_net < 2.0 THEN '1.0-2.0 (profitable)'
    WHEN metric_2_omega_net < 5.0 THEN '2.0-5.0 (good)'
    WHEN metric_2_omega_net < 10.0 THEN '5.0-10.0 (great)'
    ELSE '10.0+ (elite)'
  END as omega_bucket,
  count() as wallet_count,
  avg(metric_9_net_pnl_usd) as avg_pnl
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_22_resolved_bets >= 10
GROUP BY omega_bucket
ORDER BY
  CASE omega_bucket
    WHEN '<0.5 (losing)' THEN 1
    WHEN '0.5-1.0 (break-even)' THEN 2
    WHEN '1.0-2.0 (profitable)' THEN 3
    WHEN '2.0-5.0 (good)' THEN 4
    WHEN '5.0-10.0 (great)' THEN 5
    ELSE 6
  END;

-- ============================================================================
-- 5. PERFORMANCE TREND ANALYSIS
-- ============================================================================

-- Distribution of performance trends
SELECT
  metric_85_performance_trend_flag as trend,
  count() as wallet_count,
  avg(metric_2_omega_net) as avg_omega,
  avg(metric_9_net_pnl_usd) as avg_pnl
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_85_performance_trend_flag IS NOT NULL
GROUP BY trend
ORDER BY wallet_count DESC;

-- Improving traders (worth following)
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades,
  metric_24_bets_per_week as activity,
  metric_85_performance_trend_flag as trend
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_85_performance_trend_flag = 'improving'
  AND metric_2_omega_net > 2.0
  AND metric_22_resolved_bets >= 50
ORDER BY metric_2_omega_net DESC
LIMIT 20;

-- ============================================================================
-- 6. TAIL RATIO ANALYSIS
-- ============================================================================

-- High tail ratio traders (big wins, small losses)
SELECT
  wallet_address,
  metric_60_tail_ratio as tail_ratio,
  metric_2_omega_net as omega,
  metric_12_hit_rate as win_rate,
  metric_13_avg_win_usd as avg_win,
  metric_14_avg_loss_usd as avg_loss,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_60_tail_ratio > 20
  AND metric_22_resolved_bets >= 50
ORDER BY metric_60_tail_ratio DESC
LIMIT 20;

-- ============================================================================
-- 7. CAPITAL EFFICIENCY
-- ============================================================================

-- Best EV per hour (capital efficient traders)
SELECT
  wallet_address,
  metric_69_ev_per_hour_capital as ev_per_hour,
  metric_9_net_pnl_usd as total_pnl,
  metric_22_resolved_bets as trades,
  metric_2_omega_net as omega
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_69_ev_per_hour_capital IS NOT NULL
  AND metric_69_ev_per_hour_capital > 0
  AND metric_22_resolved_bets >= 50
ORDER BY metric_69_ev_per_hour_capital DESC
LIMIT 20;

-- ============================================================================
-- 8. SIZING DISCIPLINE
-- ============================================================================

-- Most disciplined position sizing
SELECT
  wallet_address,
  metric_88_sizing_discipline_trend as sizing_stddev,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_88_sizing_discipline_trend IS NOT NULL
  AND metric_2_omega_net > 2.0
  AND metric_22_resolved_bets >= 50
ORDER BY metric_88_sizing_discipline_trend ASC
LIMIT 20;

-- ============================================================================
-- 9. PROFILE-BASED SEARCHES
-- ============================================================================

-- "Whale" profile: high P&L, low frequency
SELECT
  wallet_address,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades,
  metric_24_bets_per_week as bets_per_week,
  metric_13_avg_win_usd as avg_win,
  metric_2_omega_net as omega
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_9_net_pnl_usd > 100000
  AND metric_24_bets_per_week < 10
  AND metric_2_omega_net > 3.0
ORDER BY metric_9_net_pnl_usd DESC
LIMIT 20;

-- "Grinder" profile: consistent, high frequency
SELECT
  wallet_address,
  metric_24_bets_per_week as bets_per_week,
  metric_12_hit_rate as win_rate,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_24_bets_per_week > 20
  AND metric_12_hit_rate > 0.03
  AND metric_2_omega_net > 1.5
  AND metric_22_resolved_bets >= 100
ORDER BY metric_24_bets_per_week DESC
LIMIT 20;

-- "Sniper" profile: selective, high win rate
SELECT
  wallet_address,
  metric_12_hit_rate as win_rate,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_22_resolved_bets as trades,
  metric_24_bets_per_week as activity
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_12_hit_rate > 0.10
  AND metric_2_omega_net > 2.0
  AND metric_22_resolved_bets >= 20
ORDER BY metric_12_hit_rate DESC
LIMIT 20;

-- ============================================================================
-- 10. EXPORT FOR UI/API
-- ============================================================================

-- Full leaderboard data (ready for API response)
SELECT
  wallet_address,
  window,

  -- Core metrics
  metric_2_omega_net as omega,
  metric_6_sharpe as sharpe,
  metric_9_net_pnl_usd as pnl,
  metric_12_hit_rate as win_rate,
  metric_13_avg_win_usd as avg_win,
  metric_14_avg_loss_usd as avg_loss,

  -- Activity
  metric_22_resolved_bets as trades,
  metric_23_track_record_days as days_active,
  metric_24_bets_per_week as bets_per_week,

  -- Advanced
  metric_60_tail_ratio as tail_ratio,
  metric_69_ev_per_hour_capital as ev_per_hour,
  metric_85_performance_trend_flag as trend,
  metric_88_sizing_discipline_trend as sizing_discipline,

  -- Metadata
  calculated_at
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_2_omega_net > 1.0
  AND metric_22_resolved_bets >= 10
ORDER BY metric_2_omega_net DESC
LIMIT 100;

-- ============================================================================
-- NOTES
-- ============================================================================
--
-- Data freshness: Check calculated_at timestamp
-- Minimum trades: Adjust metric_22_resolved_bets >= N based on use case
-- Window selection: Use 'lifetime' for overall, '30d' for recent performance
-- NULL handling: Some metrics may be NULL (tail_ratio needs 10+ trades)
--
-- Metric guide:
-- - metric_2_omega_net: Higher is better (>1.0 profitable)
-- - metric_6_sharpe: Higher is better (>0.1 good)
-- - metric_12_hit_rate: 0.0-1.0 (0.5 = 50% win rate)
-- - metric_60_tail_ratio: Higher means bigger wins vs losses
-- - metric_85_performance_trend_flag: 'improving' > 'stable' > 'declining'
