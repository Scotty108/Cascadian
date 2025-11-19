-- ============================================================================
-- QUICK WIN: Recover 759K Trades with Valid market_id
-- ============================================================================
-- Time Estimate: < 1 hour
-- Recovery: ~759,500 trades (0.98% of missing, but validates approach)
--
-- This query demonstrates the JOIN approach works for trades that DO have
-- valid market_ids. It's a quick validation before attempting larger recovery.
-- ============================================================================

-- Step 1: Verify the join path works
SELECT
  COUNT(*) as total_recoverable,
  COUNT(DISTINCT t.market_id) as distinct_markets,
  COUNT(DISTINCT c.condition_id) as distinct_conditions
FROM trades_raw t
INNER JOIN condition_market_map c ON t.market_id = c.market_id
WHERE (t.condition_id IS NULL OR t.condition_id = '')
  AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000';

-- Expected: ~759,500 trades

-- Step 2: Sample the results
SELECT
  t.transaction_hash,
  t.market_id,
  t.condition_id as old_condition_id,
  c.condition_id as recovered_condition_id,
  c.canonical_category,
  t.timestamp
FROM trades_raw t
INNER JOIN condition_market_map c ON t.market_id = c.market_id
WHERE (t.condition_id IS NULL OR t.condition_id = '')
  AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
LIMIT 10;

-- Step 3: Create recovery table (ATOMIC REBUILD pattern)
CREATE TABLE trades_raw_quick_win ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp, trade_id)
AS
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.timestamp,
  t.side,
  t.entry_price,
  t.exit_price,
  t.shares,
  t.usd_value,
  t.pnl,
  t.is_closed,
  t.transaction_hash,
  t.created_at,
  t.close_price,
  t.fee_usd,
  t.slippage_usd,
  t.hours_held,
  t.bankroll_at_entry,
  t.outcome,
  t.fair_price_at_entry,
  t.pnl_gross,
  t.pnl_net,
  t.return_pct,

  -- RECOVERY LOGIC: Use recovered condition_id if original is missing
  COALESCE(
    NULLIF(t.condition_id, ''),
    c.condition_id
  ) as condition_id,

  t.was_win,
  t.tx_timestamp,
  t.canonical_category,
  t.raw_tags,
  t.realized_pnl_usd,
  t.is_resolved,
  t.resolved_outcome,
  t.outcome_index,

  -- Mark recovery status
  CASE
    WHEN t.condition_id IS NOT NULL AND t.condition_id != '' THEN 'original'
    WHEN c.condition_id IS NOT NULL THEN 'recovered_via_market_id'
    ELSE 'still_missing'
  END as recovery_status

FROM trades_raw t
LEFT JOIN condition_market_map c ON t.market_id = c.market_id
WHERE t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000';

-- Step 4: Verify recovery statistics
SELECT
  recovery_status,
  COUNT(*) as count,
  round(COUNT(*) / (SELECT COUNT(*) FROM trades_raw_quick_win) * 100, 2) as pct
FROM trades_raw_quick_win
GROUP BY recovery_status
ORDER BY count DESC;

-- Expected output:
-- original: ~82M (already had condition_id)
-- recovered_via_market_id: ~759K (newly recovered)
-- still_missing: 0 (none in this subset)

-- Step 5: Sample verification
SELECT
  transaction_hash,
  market_id,
  condition_id,
  recovery_status,
  timestamp
FROM trades_raw_quick_win
WHERE recovery_status = 'recovered_via_market_id'
LIMIT 10;

-- ============================================================================
-- NEXT STEPS AFTER VALIDATION
-- ============================================================================
--
-- If this Quick Win succeeds, you can then decide on larger recovery:
--
-- OPTION A: API-based recovery for trades with market slugs
--   - Parse market slugs from available metadata
--   - Query Polymarket API for condition_ids
--   - Estimated: 10-20% additional recovery, 2-4 hours
--
-- OPTION B: Resume ERC1155 blockchain backfill
--   - Complete the erc1155_transfers table
--   - Join via transaction_hash
--   - Estimated: 95-98% total recovery, 18-27 days
--
-- OPTION C: Hybrid approach
--   - Combine API recovery + targeted blockchain scanning
--   - Focus on recent/high-volume periods
--   - Estimated: 60-70% total recovery, 4-9 hours
--
-- ============================================================================

-- CLEANUP (optional - only after verifying success)
-- DROP TABLE trades_raw_quick_win;
