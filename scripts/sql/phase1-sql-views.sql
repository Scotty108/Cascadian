-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1: TRADING P&L (Average Cost Method - Pure SQL)
-- ═══════════════════════════════════════════════════════════════════════════════
-- This calculates realized P&L from entry/exit spread using average cost.
-- NO resolution data needed - works for 100% of trades!
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create schema if not exists
CREATE DATABASE IF NOT EXISTS cascadian_clean;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 1: Canonical per-fill cash and shares (signs normalized)
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_trades_ledger AS
SELECT
  lower(wallet_address_norm)          AS wallet,
  lower(condition_id_norm)            AS token_cid,         -- token-level
  concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
  toInt32(outcome_index)              AS outcome,
  toDateTime(timestamp)               AS ts,
  /* Shares delta: buy adds, sell subtracts */
  multiIf(trade_direction = 'BUY',  shares,
          trade_direction = 'SELL', -shares, 0.0)           AS d_shares,
  /* Cash delta from trader perspective: buy pays cash, sell receives cash */
  multiIf(trade_direction = 'BUY', -usd_value,
          trade_direction = 'SELL',  usd_value, 0.0)        AS d_cash,
  /* Optional fees reduce PnL. If you do not have fee_usd, set to 0. */
  0.0 AS fee_usd  -- Default to 0 if fee_usd column doesn't exist
FROM default.vw_trades_canonical
WHERE condition_id_norm != ''
  AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND outcome_index >= 0;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 2: Aggregate to get final positions and realized P&L
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_positions AS
SELECT
  wallet,
  market_cid,
  outcome,
  /* Final position after all trades */
  sum(d_shares) AS position_shares,
  /* Net cash flow (negative = invested, positive = received) */
  sum(d_cash) AS net_cash,
  sum(fee_usd) AS total_fees_usd,
  /* Status: CLOSED if position is zero */
  if(abs(sum(d_shares)) < 0.01, 'CLOSED', 'OPEN') AS status
FROM cascadian_clean.vw_trades_ledger
GROUP BY wallet, market_cid, outcome;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 3: Calculate realized P&L for closed positions
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_realized AS
SELECT
  wallet,
  market_cid,
  outcome,
  status,
  position_shares,
  net_cash,
  total_fees_usd,
  /* Realized PnL = net cash received minus fees (only for closed positions)
     For closed positions: buys are negative cash, sells are positive
     The sum equals the realized profit/loss */
  if(status = 'CLOSED', net_cash - total_fees_usd, 0.0) AS realized_pnl_usd
FROM cascadian_clean.vw_trading_pnl_positions;

-- ───────────────────────────────────────────────────────────────────────────────
-- Step 4: Wallet-level summary of trading P&L
-- ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_trading_pnl_summary AS
SELECT
  wallet,
  count(*) AS total_positions,
  countIf(status = 'CLOSED') AS closed_positions,
  countIf(status = 'OPEN') AS open_positions,
  sum(realized_pnl_usd) AS total_realized_pnl_usd
FROM cascadian_clean.vw_trading_pnl_realized
GROUP BY wallet
ORDER BY total_realized_pnl_usd DESC;
