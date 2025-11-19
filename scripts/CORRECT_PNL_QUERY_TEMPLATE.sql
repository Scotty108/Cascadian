-- ============================================================================
-- CORRECT P&L CALCULATION QUERY
-- ============================================================================
-- Purpose: Calculate realized P&L from ERC-1155 token redemptions
-- Uses: CORRECT token_id decoding formula (bitwise operations)
-- Date: 2025-01-12
-- ============================================================================

WITH
-- Step 1: Get all burns (redemptions) for wallet
burns AS (
  SELECT
    token_id,
    sum(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as redeemed_shares
  FROM erc1155_transfers
  WHERE from_address = '{WALLET_ADDRESS}'
    AND to_address = '0x0000000000000000000000000000000000000000'
  GROUP BY token_id
),

-- Step 2: Decode token_id using CORRECT ERC-1155 formula
-- Formula: condition_id = token_id >> 8, outcome_index = token_id & 255
decoded AS (
  SELECT
    b.token_id,
    b.redeemed_shares,
    -- Decode condition_id (bitwise right shift by 8)
    lower(hex(bitShiftRight(
      reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))),
      8
    ))) as condition_id,
    -- Decode outcome_index (bitwise AND with 255)
    toUInt8(bitAnd(
      reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))),
      255
    )) as outcome_index
  FROM burns b
),

-- Step 3: Join with resolutions (with gamma_markets fallback)
with_resolutions AS (
  SELECT
    d.token_id,
    d.condition_id,
    d.outcome_index,
    d.redeemed_shares,
    COALESCE(r.winning_index, g.winning_index) as winning_index,
    -- If outcome matches winning_index, redemption = 1 USDC per share
    if(d.outcome_index = winning_index, d.redeemed_shares, 0) as payout_usdc
  FROM decoded d
  LEFT JOIN (
    -- Primary source: market_resolutions_final
    SELECT
      lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
      winning_index
    FROM market_resolutions_final
  ) r ON d.condition_id = r.condition_id_norm
  LEFT JOIN (
    -- Fallback: derive from gamma_markets outcome_prices
    -- Winner has outcome_price = 1.0
    SELECT
      lower(replaceOne(condition_id, '0x', '')) as condition_id,
      arrayFirstIndex(x -> x = 1.0, outcome_prices) - 1 as winning_index
    FROM gamma_markets
    WHERE closed = true
      AND arrayExists(x -> x = 1.0, outcome_prices)
  ) g ON d.condition_id = g.condition_id
)

-- Final output
SELECT
  token_id,
  condition_id,
  outcome_index,
  redeemed_shares,
  winning_index,
  payout_usdc,
  -- Status flags
  if(winning_index IS NOT NULL, 'RESOLVED', 'UNRESOLVED') as status
FROM with_resolutions
ORDER BY payout_usdc DESC;

-- ============================================================================
-- USAGE NOTES
-- ============================================================================
-- 1. Replace {WALLET_ADDRESS} with actual wallet address
-- 2. If gamma_markets doesn't have 'outcome_prices' array, adjust the fallback
-- 3. Assumes 1 USDC per winning share (standard for Polymarket)
-- 4. Token_id, value fields in erc1155_transfers are hex strings with '0x' prefix
-- 5. Condition_id in market_resolutions_final may or may not have '0x' prefix
-- ============================================================================

-- ============================================================================
-- SUMMARY QUERY (aggregate by wallet)
-- ============================================================================
WITH
burns AS (
  SELECT
    token_id,
    sum(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as redeemed_shares
  FROM erc1155_transfers
  WHERE from_address = '{WALLET_ADDRESS}'
    AND to_address = '0x0000000000000000000000000000000000000000'
  GROUP BY token_id
),
decoded AS (
  SELECT
    b.token_id,
    b.redeemed_shares,
    lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 8))) as condition_id,
    toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 255)) as outcome_index
  FROM burns b
),
with_resolutions AS (
  SELECT
    d.*,
    COALESCE(r.winning_index, g.winning_index) as winning_index,
    if(d.outcome_index = winning_index, d.redeemed_shares, 0) as payout_usdc
  FROM decoded d
  LEFT JOIN (
    SELECT
      lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
      winning_index
    FROM market_resolutions_final
  ) r ON d.condition_id = r.condition_id_norm
  LEFT JOIN (
    SELECT
      lower(replaceOne(condition_id, '0x', '')) as condition_id,
      arrayFirstIndex(x -> x = 1.0, outcome_prices) - 1 as winning_index
    FROM gamma_markets
    WHERE closed = true
      AND arrayExists(x -> x = 1.0, outcome_prices)
  ) g ON d.condition_id = g.condition_id
)
SELECT
  count() as total_redemptions,
  countIf(winning_index IS NOT NULL) as resolved_redemptions,
  sum(redeemed_shares) as total_shares_redeemed,
  sum(payout_usdc) as total_realized_pnl_usdc,
  round(100.0 * resolved_redemptions / total_redemptions, 2) as resolution_coverage_pct
FROM with_resolutions;
