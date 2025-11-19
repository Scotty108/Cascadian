-- STAGE 4: Rebuild realized_pnl_by_market_final with clean data

-- Drop old table if exists
DROP TABLE IF EXISTS realized_pnl_by_market_final;

-- Rebuild P&L from clean positions and cashflows
CREATE TABLE realized_pnl_by_market_final (
  wallet String,
  condition_id_norm String,
  realized_pnl_usd Float64
) ENGINE = SharedMergeTree()
ORDER BY (wallet, condition_id_norm)
AS
WITH winning_outcomes AS (
  SELECT
    condition_id_norm,
    toInt16(win_idx) AS win_idx
  FROM winning_index
)
SELECT
  p.wallet,
  p.condition_id_norm,
  round(
    sum(toFloat64(c.cashflow_usdc)) + sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
    2
  ) AS realized_pnl_usd
FROM outcome_positions_v2 AS p
ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
ANY LEFT JOIN trade_cashflows_v3 AS c ON
  (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.condition_id_norm;
