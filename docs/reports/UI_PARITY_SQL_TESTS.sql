-- ============================================================================
-- UI PARITY INVESTIGATION: SQL DIAGNOSTIC QUERIES
-- ============================================================================
--
-- Date: 2025-12-15
-- Purpose: Validate hypotheses for why V18 fails on 5 wallets
--
-- Run these queries in order to diagnose root causes:
--   1. Maker vs Taker volume (sign flip case)
--   2. Unmapped trades (phantom loss case)
--   3. Redemption impact (undercounting case)
--   4. Paired trades with mixed roles (overcounting case)
--
-- ============================================================================

-- ============================================================================
-- TEST 1: MAKER VS TAKER VOLUME (Wallet 0x227c - Sign Flip)
-- ============================================================================
--
-- Hypothesis: User is net TAKER, so V18's maker-only filter excludes
--             their primary activity, flipping PnL sign.
--
-- Expected: maker_pct < 0.2 (taker-heavy user)
-- ============================================================================

WITH deduped AS (
  SELECT
    event_id,
    any(usdc_amount) / 1000000.0 as usdc,
    any(role) as role
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x227c55d09ff49d420fc741c5e301904af62fa303')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT
  sumIf(usdc, role = 'maker') as maker_usdc,
  sumIf(usdc, role = 'taker') as taker_usdc,
  sum(usdc) as total_usdc,
  sumIf(usdc, role = 'maker') / sum(usdc) as maker_pct,
  sumIf(usdc, role = 'taker') / sum(usdc) as taker_pct
FROM deduped;

-- If maker_pct < 0.2:
--   ✅ Confirms hypothesis: V18's maker-only filter is excluding taker activity
--   → FIX: Use V20 (includes all roles)


-- ============================================================================
-- TEST 2: UNMAPPED TRADES (Wallet 0x3439 - Phantom Loss)
-- ============================================================================
--
-- Hypothesis: User has trades on tokens not in pm_token_to_condition_map_v3,
--             causing V18 to include them at 0.5 mark price (phantom losses).
--
-- Expected: unmapped_pct > 0.5 (majority of fills are unmapped)
-- ============================================================================

WITH deduped AS (
  SELECT
    event_id,
    any(token_id) as token_id,
    any(usdc_amount) / 1000000.0 as usdc
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x34393448709dd71742f4a8f8b973955cf59b4f64')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT
  count() as total_fills,
  sumIf(1, token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3)) as unmapped_fills,
  sum(usdc) as total_usdc,
  sumIf(usdc, token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3)) as unmapped_usdc,
  unmapped_fills / total_fills as unmapped_fill_pct,
  unmapped_usdc / total_usdc as unmapped_usdc_pct
FROM deduped;

-- If unmapped_pct > 0.5:
--   ✅ Confirms hypothesis: V18 includes unmapped trades (stuck at 0.5 mark price)
--   → FIX: Use V19/V20 (filters out unmapped trades with `condition_id IS NOT NULL`)

-- Additional check: List unmapped tokens
SELECT
  d.token_id,
  count() as fill_count,
  sum(d.usdc) as total_usdc,
  groupArray(d.side)[1] as first_side
FROM deduped d
WHERE d.token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3)
GROUP BY d.token_id
ORDER BY total_usdc DESC
LIMIT 10;


-- ============================================================================
-- TEST 3: REDEMPTION IMPACT (Wallet 0x0e5f - Undercounting Loss)
-- ============================================================================
--
-- Hypothesis: User closed positions via PayoutRedemption (not CLOB),
--             and V18's CLOB-only filter misses this -$400 loss.
--
-- Expected: redemption_usdc ≈ -$400 (explains missing loss)
-- ============================================================================

SELECT
  sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
  sumIf(usdc_delta, source_type = 'PositionsMerge') as merge_usdc,
  sumIf(usdc_delta, source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) as transfer_usdc,
  clob_usdc + redemption_usdc + merge_usdc as total_trading_pnl,
  count() as event_count,
  countIf(source_type = 'CLOB') as clob_events,
  countIf(source_type = 'PayoutRedemption') as redemption_events
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0x0e5f632cdfb0f5a22d22331fd81246f452dccf38');

-- If redemption_usdc ≈ -$400:
--   ✅ Confirms hypothesis: V18's CLOB-only filter misses redemptions
--   → FIX: Use V22 (includes PayoutRedemption events)

-- Additional check: Breakdown by market
SELECT
  condition_id,
  sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
  clob_usdc + redemption_usdc as position_pnl
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0x0e5f632cdfb0f5a22d22331fd81246f452dccf38')
GROUP BY condition_id
ORDER BY abs(redemption_usdc) DESC
LIMIT 10;


-- ============================================================================
-- TEST 4: PAIRED TRADES WITH MIXED ROLES (Wallet 0x35f0 - Overcounting)
-- ============================================================================
--
-- Hypothesis: User has paired trades (buy O0, sell O1 in same tx) where:
--   - Buy is maker role → V18 includes
--   - Sell is taker role → V18 excludes
--   Result: V18 counts buy but misses offsetting sell → overcounts by $522
--
-- Expected: Multiple paired trades with split maker/taker roles
-- ============================================================================

WITH fills AS (
  SELECT
    any(f.transaction_hash) as tx_hash,
    any(f.token_id) as token_id,
    any(m.condition_id) as condition_id,
    any(m.outcome_index) as outcome_index,
    any(f.side) as side,
    any(f.role) as role,
    any(f.token_amount) / 1000000.0 as tokens,
    any(f.usdc_amount) / 1000000.0 as usdc
  FROM pm_trader_events_v2 f
  INNER JOIN pm_token_to_condition_map_v3 m ON f.token_id = m.token_id_dec
  WHERE lower(f.trader_wallet) = lower('0x35f0a66e8a0ddcb49cb93213b21642bdd854b776')
    AND f.is_deleted = 0
  GROUP BY f.event_id
),
paired_txs AS (
  SELECT
    tx_hash,
    condition_id,
    groupArray((outcome_index, side, role, tokens, usdc)) as fills,
    length(fills) as fill_count
  FROM fills
  GROUP BY tx_hash, condition_id
  HAVING fill_count > 1  -- Paired trades (multiple fills in same tx+condition)
)
SELECT
  p.tx_hash,
  p.condition_id,
  p.fill_count,
  p.fills,
  -- Check if fills have opposite directions
  arrayExists(x -> x.2 = 'buy', p.fills) AND arrayExists(x -> x.2 = 'sell', p.fills) as is_opposite_direction,
  -- Check if fills have mixed maker/taker
  arrayExists(x -> x.3 = 'maker', p.fills) AND arrayExists(x -> x.3 = 'taker', p.fills) as is_mixed_roles,
  -- Sum USDC for maker-only vs all roles
  arraySum(arrayMap(x -> if(x.3 = 'maker', if(x.2 = 'sell', x.5, -x.5), 0), p.fills)) as maker_only_cash_flow,
  arraySum(arrayMap(x -> if(x.2 = 'sell', x.5, -x.5), p.fills)) as all_roles_cash_flow,
  maker_only_cash_flow - all_roles_cash_flow as v18_overcounting
FROM paired_txs p
WHERE is_opposite_direction AND is_mixed_roles
ORDER BY abs(v18_overcounting) DESC
LIMIT 20;

-- If v18_overcounting > 0 (and sums to ~$522):
--   ✅ Confirms hypothesis: V18's maker-only filter creates asymmetry in paired trades
--   → FIX: Use V17 (paired normalization) OR V20 (includes all roles)


-- ============================================================================
-- TEST 5: MISSING PROFIT BREAKDOWN (Wallet 0x222a - Zero PnL in V18)
-- ============================================================================
--
-- Hypothesis: User's +$520 profit exists in:
--   A) Taker fills only (V18 excludes), OR
--   B) Redemption events (V18 CLOB-only excludes)
--
-- Expected: taker_cash_flow ≈ +$520 OR redemption_usdc ≈ +$520
-- ============================================================================

-- Part A: Check taker vs maker cash flow
WITH deduped AS (
  SELECT
    event_id,
    any(side) as side,
    any(role) as role,
    any(usdc_amount) / 1000000.0 as usdc
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x222adc4302f58fe679f5212cf11344d29c0d103c')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT
  -- Maker-only cash flow (what V18 sees)
  sumIf(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END, role = 'maker') as maker_cash_flow,
  -- Taker-only cash flow (what V18 misses)
  sumIf(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END, role = 'taker') as taker_cash_flow,
  -- All roles cash flow (what V20 sees)
  sum(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END) as all_roles_cash_flow,
  -- Breakdown
  countIf(role = 'maker') as maker_fills,
  countIf(role = 'taker') as taker_fills
FROM deduped;

-- Part B: Check redemptions (via unified ledger)
SELECT
  sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
  clob_usdc + redemption_usdc as total_pnl
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0x222adc4302f58fe679f5212cf11344d29c0d103c');

-- If taker_cash_flow ≈ +$520:
--   ✅ Confirms hypothesis A: Profit is in taker fills (V18 maker-only misses)
--   → FIX: Use V20 (includes all roles)
--
-- If redemption_usdc ≈ +$520:
--   ✅ Confirms hypothesis B: Profit is in redemptions (V18 CLOB-only misses)
--   → FIX: Use V22 (includes redemptions)


-- ============================================================================
-- BONUS: V20 vs V18 PnL COMPARISON (All 5 Wallets)
-- ============================================================================
--
-- Run V20 formula on all 5 failing wallets to compare with V18 results.
-- ============================================================================

WITH
  wallets AS (
    SELECT arrayJoin([
      '0x35f0a66e8a0ddcb49cb93213b21642bdd854b776',
      '0x34393448709dd71742f4a8f8b973955cf59b4f64',
      '0x227c55d09ff49d420fc741c5e301904af62fa303',
      '0x222adc4302f58fe679f5212cf11344d29c0d103c',
      '0x0e5f632cdfb0f5a22d22331fd81246f452dccf38'
    ]) as wallet_address
  ),
  v20_pnl AS (
    SELECT
      lower(w.wallet_address) as wallet,
      sumIf(
        if(l.payout_norm IS NOT NULL,
           round(l.cash_flow + l.final_tokens * l.payout_norm, 2),
           0),
        1 = 1
      ) as realized_pnl,
      sumIf(
        if(l.payout_norm IS NULL,
           round(l.cash_flow + l.final_tokens * 0.5, 2),
           0),
        1 = 1
      ) as unrealized_pnl
    FROM wallets w
    LEFT JOIN (
      SELECT
        lower(wallet_address) as wallet,
        condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_tokens,
        any(payout_norm) as payout_norm
      FROM pm_unified_ledger_v7
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY wallet, condition_id, outcome_index
    ) l ON w.wallet_address = l.wallet
    GROUP BY w.wallet_address
  )
SELECT
  substring(wallet, 1, 10) || '...' as wallet_short,
  realized_pnl,
  unrealized_pnl,
  realized_pnl + unrealized_pnl as total_pnl
FROM v20_pnl
ORDER BY wallet;

-- Compare with V18 results:
--   Wallet 0x35f0: V18 = +$3,814, V20 = ?
--   Wallet 0x3439: V18 = -$8,260, V20 = ?
--   Wallet 0x227c: V18 = +$184,   V20 = ?
--   Wallet 0x222a: V18 = $0,      V20 = ?
--   Wallet 0x0e5f: V18 = -$1,     V20 = ?


-- ============================================================================
-- SUMMARY: EXPECTED OUTCOMES
-- ============================================================================
--
-- If V20 matches UI better than V18 on 3+ wallets:
--   ✅ Maker-only filter is incorrect
--   → ACTION: Switch default export from V18 to V20
--
-- If V20 still fails on wallets 0x3439 and 0x0e5f:
--   ⚠️ Missing CTF events (redemptions)
--   → ACTION: Test V22 (includes PayoutRedemption, PositionsMerge)
--
-- If V20 still fails on wallet 0x35f0:
--   ⚠️ Complete-set arbitrage not normalized
--   → ACTION: Test V17 (has paired-outcome normalization)
--
-- ============================================================================
