-- Cleanup Duplicates in Unified Table
-- Run this once to remove duplicates from testing

-- Option 1: Force immediate deduplication (may timeout on large table)
-- OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL;

-- Option 2: Recreate table without duplicates (atomic, safe)
-- Note: This requires downtime (5-10 minutes)

-- Step 1: Create clean table
CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_clean (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  resolved_at Nullable(DateTime),
  cost_usd Float64,
  tokens Float64,
  tokens_sold_early Float64,
  tokens_held Float64,
  exit_value Float64,
  pnl_usd Float64,
  roi Float64,
  pct_sold_early Float64,
  is_maker UInt8,
  is_short UInt8,
  is_closed UInt8
) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
SETTINGS index_granularity = 8192;

-- Step 2: Insert deduplicated data
INSERT INTO pm_trade_fifo_roi_v3_mat_unified_clean
SELECT
  tx_hash,
  any(wallet) as wallet,
  any(condition_id) as condition_id,
  any(outcome_index) as outcome_index,
  any(entry_time) as entry_time,
  any(resolved_at) as resolved_at,
  any(cost_usd) as cost_usd,
  any(tokens) as tokens,
  any(tokens_sold_early) as tokens_sold_early,
  any(tokens_held) as tokens_held,
  any(exit_value) as exit_value,
  any(pnl_usd) as pnl_usd,
  any(roi) as roi,
  any(pct_sold_early) as pct_sold_early,
  any(is_maker) as is_maker,
  any(is_short) as is_short,
  any(is_closed) as is_closed
FROM pm_trade_fifo_roi_v3_mat_unified
GROUP BY tx_hash, wallet, condition_id, outcome_index;

-- Step 3: Swap tables
-- RENAME TABLE pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_old;
-- RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_clean TO pm_trade_fifo_roi_v3_mat_unified;

-- Step 4: Drop old table
-- DROP TABLE pm_trade_fifo_roi_v3_mat_unified_old;
