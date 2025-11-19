-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2: UNREALIZED P&L (Mark-to-Market for Open Positions)
-- ═══════════════════════════════════════════════════════════════════════════════
-- This calculates unrealized P&L by marking open positions to current market prices.
-- Requires midprices to be refreshed periodically via the TypeScript fetcher.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 1: Create midprice storage table
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cascadian_clean.midprices_latest
(
  market_cid String,
  outcome Int32,
  midprice Float64,
  best_bid Float64,
  best_ask Float64,
  updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (market_cid, outcome);

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 2: View of current open positions
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_positions_open AS
WITH pos AS (
  SELECT
    lower(wallet_address_norm) AS wallet,
    concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
    toInt32(outcome_index) AS outcome,
    /* Net shares: BUY adds, SELL subtracts */
    sumIf(if(trade_direction='BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
    /* Net cash flow: BUY pays (negative), SELL receives (positive) */
    sumIf(if(trade_direction='BUY', -toFloat64(usd_value), toFloat64(usd_value)), 1) AS cash_net
  FROM default.vw_trades_canonical
  WHERE condition_id_norm != ''
    AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND outcome_index >= 0
  GROUP BY wallet, market_cid, outcome
),
market_conditions AS (
  SELECT
    market_id_cid AS market_cid,
    any(lower(condition_id_32b)) AS condition_id_32b
  FROM cascadian_clean.token_condition_market_map
  GROUP BY market_id_cid
)
SELECT
  p.wallet,
  p.market_cid,
  p.outcome,
  p.shares_net AS qty,
  /* Average cost per share for the open position
     Note: cash_net is negative for cost, so we negate it */
  if(p.shares_net != 0, -p.cash_net / nullIf(p.shares_net, 0), 0.0) AS avg_cost,
  m.midprice,
  m.best_bid,
  m.best_ask,
  m.updated_at AS price_updated_at,
  /* Unrealized P&L = shares * (current_price - avg_cost) */
  p.shares_net * (coalesce(m.midprice, 0) - if(p.shares_net != 0, -p.cash_net / nullIf(p.shares_net, 0), 0.0)) AS unrealized_pnl_usd
FROM pos p
LEFT JOIN market_conditions mc
  ON mc.market_cid = p.market_cid
LEFT JOIN cascadian_clean.vw_resolutions_truth r
  ON r.condition_id_32b = mc.condition_id_32b
LEFT JOIN cascadian_clean.midprices_latest m
  ON m.market_cid = p.market_cid AND m.outcome = p.outcome
WHERE abs(p.shares_net) >= 0.01
  AND (mc.condition_id_32b IS NULL OR r.condition_id_32b IS NULL);  -- Keep only unresolved or unmapped markets

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 3: Wallet-level summary of unrealized P&L
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_unrealized_pnl_summary AS
SELECT
  wallet,
  count(*) AS open_positions,
  sum(qty) AS total_shares,
  sum(unrealized_pnl_usd) AS total_unrealized_pnl_usd,
  countIf(midprice IS NOT NULL) AS positions_with_prices,
  countIf(midprice IS NULL) AS positions_without_prices
FROM cascadian_clean.vw_positions_open
GROUP BY wallet
ORDER BY total_unrealized_pnl_usd DESC;
