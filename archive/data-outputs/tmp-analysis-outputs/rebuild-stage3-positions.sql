-- STAGE 3: Rebuild outcome_positions_v2 from clean cashflows

-- Drop old table if exists
DROP TABLE IF EXISTS outcome_positions_v2;

-- Create new positions table from clean cashflows
CREATE TABLE outcome_positions_v2 (
  wallet String,
  condition_id_norm String,
  outcome_idx Int16,
  net_shares Float64
) ENGINE = SharedMergeTree()
ORDER BY (wallet, condition_id_norm, outcome_idx)
AS
SELECT
  wallet,
  condition_id_norm,
  outcome_idx,
  sum(cashflow_usdc) AS net_shares
FROM trade_cashflows_v3
GROUP BY wallet, condition_id_norm, outcome_idx;
