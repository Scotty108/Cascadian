-- STAGE 1: Rebuild trade_cashflows_v3 from source of truth
-- This SQL file is executed via clickhouse-client to avoid Node.js HTTP limitations

-- Step 1: Create table structure
CREATE TABLE IF NOT EXISTS trade_cashflows_v3_fixed (
  wallet String,
  condition_id_norm String,
  outcome_idx Int16,
  cashflow_usdc Float64
) ENGINE = SharedMergeTree()
ORDER BY (wallet, condition_id_norm, outcome_idx);

-- Step 2: Populate from source of truth (vw_clob_fills_enriched)
-- This will take 5-15 minutes for 37M fills
INSERT INTO trade_cashflows_v3_fixed
SELECT
  lower(user_eoa) AS wallet,
  lower(replaceAll(`cf.condition_id`, '0x', '')) AS condition_id_norm,
  0 AS outcome_idx,
  round(
    price * size * if(side = 'BUY', -1, 1),
    8
  ) AS cashflow_usdc
FROM vw_clob_fills_enriched
WHERE length(replaceAll(`cf.condition_id`, '0x', '')) = 64;
