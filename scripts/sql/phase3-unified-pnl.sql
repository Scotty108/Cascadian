-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3: UNIFIED P&L VIEW
-- ═══════════════════════════════════════════════════════════════════════════════
-- Combines all three P&L types:
--   1. Trading P&L (realized from entry/exit spread)
--   2. Unrealized P&L (mark-to-market on open positions)
--   3. Redemption P&L (oracle settlement for resolved markets)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 1: Redemption P&L from resolved markets
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_redemption_pnl AS
WITH positions_at_resolution AS (
  SELECT
    lower(t.wallet_address_norm) AS wallet,
    concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') AS market_cid,
    toInt32(t.outcome_index) AS outcome,
    /* Net shares held when market resolved */
    sumIf(if(t.trade_direction='BUY', t.shares, -t.shares), 1) AS net_shares,
    /* Net cost basis */
    sumIf(if(t.trade_direction='BUY', -t.usd_value, t.usd_value), 1) AS net_cash,
    /* Get payout vector */
    anyLast(r.payout_numerators) AS pay_num,
    anyLast(r.payout_denominator) AS pay_den,
    anyLast(r.winning_outcome_index) AS winning_index
  FROM default.vw_trades_canonical t
  INNER JOIN default.market_resolutions_final r
    ON concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') = concat('0x', r.condition_id_norm)
  WHERE t.condition_id_norm != ''
    AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND r.payout_denominator > 0
  GROUP BY wallet, market_cid, outcome
)
SELECT
  wallet,
  market_cid,
  outcome,
  net_shares,
  net_cash,
  winning_index,
  /* Payout value: use outcome_index (0-based) to get payout from array (1-based in ClickHouse) */
  if(
    outcome < length(pay_num),
    toFloat64(pay_num[outcome + 1]) / nullIf(pay_den, 0),
    0.0
  ) AS payout_value,
  /* Redemption P&L = shares * payout - cost_basis
     For winning outcome, payout = 1, for losing = 0 */
  (net_shares * if(
    outcome < length(pay_num),
    toFloat64(pay_num[outcome + 1]) / nullIf(pay_den, 0),
    0.0
  )) + net_cash AS redemption_pnl_usd
FROM positions_at_resolution
WHERE abs(net_shares) >= 0.01;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 2: Market-level unified P&L (per wallet, market, outcome)
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_market_pnl_unified AS
SELECT
  coalesce(t.wallet, u.wallet, r.wallet) AS wallet,
  coalesce(t.market_cid, u.market_cid, r.market_cid) AS market_cid,
  coalesce(t.outcome, u.outcome, r.outcome) AS outcome,
  /* Trading realized P&L (from FIFO or average cost) */
  coalesce(t.realized_pnl_usd, 0.0) AS trading_realized_pnl,
  /* Unrealized P&L (mark-to-market) */
  coalesce(u.unrealized_pnl_usd, 0.0) AS unrealized_pnl,
  /* Redemption P&L (oracle settlement) */
  coalesce(r.redemption_pnl_usd, 0.0) AS redemption_pnl,
  /* Total P&L */
  coalesce(t.realized_pnl_usd, 0.0) +
  coalesce(u.unrealized_pnl_usd, 0.0) +
  coalesce(r.redemption_pnl_usd, 0.0) AS total_pnl
FROM cascadian_clean.vw_trading_pnl_realized t
FULL OUTER JOIN cascadian_clean.vw_positions_open u
  ON u.wallet = t.wallet AND u.market_cid = t.market_cid AND u.outcome = t.outcome
FULL OUTER JOIN cascadian_clean.vw_redemption_pnl r
  ON r.wallet = coalesce(t.wallet, u.wallet) AND r.market_cid = coalesce(t.market_cid, u.market_cid) AND r.outcome = coalesce(t.outcome, u.outcome);

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 3: Wallet-level unified P&L summary
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_unified AS
SELECT
  wallet,
  /* Realized P&L = Trading + Redemption */
  sum(trading_realized_pnl) AS trading_realized_pnl,
  sum(redemption_pnl) AS redemption_pnl,
  sum(trading_realized_pnl) + sum(redemption_pnl) AS total_realized_pnl,
  /* Unrealized P&L */
  sum(unrealized_pnl) AS unrealized_pnl,
  /* Total P&L (matches Polymarket "All" tab) */
  sum(trading_realized_pnl) + sum(redemption_pnl) + sum(unrealized_pnl) AS total_pnl,
  /* Position counts */
  countIf(abs(trading_realized_pnl) > 0.01) AS closed_positions,
  countIf(abs(unrealized_pnl) > 0.01) AS open_positions,
  countIf(abs(redemption_pnl) > 0.01) AS redeemed_positions
FROM cascadian_clean.vw_market_pnl_unified
GROUP BY wallet
ORDER BY total_pnl DESC;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 4: UI-Ready Views (Closed vs All)
-- ───────────────────────────────────────────────────────────────────────────────

-- Closed P&L only (matches Polymarket "Closed" tab)
CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_closed AS
SELECT
  wallet,
  total_realized_pnl AS closed_pnl,
  closed_positions + redeemed_positions AS total_closed_positions
FROM cascadian_clean.vw_wallet_pnl_unified
ORDER BY closed_pnl DESC;

-- All P&L including unrealized (matches Polymarket "All" tab)
CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_all AS
SELECT
  wallet,
  total_realized_pnl AS realized_pnl,
  unrealized_pnl,
  total_pnl AS all_pnl,
  closed_positions + redeemed_positions AS closed_positions,
  open_positions
FROM cascadian_clean.vw_wallet_pnl_unified
ORDER BY all_pnl DESC;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 5: Coverage and quality metrics
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_pnl_coverage_metrics AS
SELECT
  /* Resolution coverage */
  (SELECT count(DISTINCT condition_id_norm) FROM default.market_resolutions_final WHERE payout_denominator > 0) AS resolved_markets,
  (SELECT uniqExact(concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00'))
   FROM default.vw_trades_canonical
   WHERE condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) AS traded_markets,
  /* Price coverage */
  (SELECT count(*) FROM cascadian_clean.midprices_latest) AS prices_available,
  (SELECT count(DISTINCT concat(market_cid, '-', toString(outcome)))
   FROM cascadian_clean.vw_positions_open) AS open_positions_needing_prices,
  /* P&L components */
  (SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_realized_pnl,
  (SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_unrealized_pnl,
  (SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_all_pnl,
  /* Percentages */
  round((SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
        nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS realized_pct,
  round((SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
        nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS unrealized_pct;
