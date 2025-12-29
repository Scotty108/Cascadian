-- ============================================================================
-- CORRECTED POLYMARKET REALIZED P&L VIEWS
-- ============================================================================
-- This SQL creates all necessary views for calculating realized P&L from
-- resolved Polymarket markets using ClickHouse.
--
-- Key Design:
-- 1. Canonical bridge maps market_id → condition_id_norm (100% coverage)
-- 2. Trade flows compute cashflow per fill (BUY=-cost, SELL=+revenue)
-- 3. Winning index maps condition_id_norm → win_idx
-- 4. Settlement = sum(cashflow) + sum(shares where outcome=winner)
-- ============================================================================

-- A) Canonical Condition Bridge
-- Maps market_id to normalized condition_id from two sources
CREATE OR REPLACE VIEW canonical_condition AS
WITH t1 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id_norm,'0x','')) AS condition_id_norm
  FROM ctf_token_map
  WHERE market_id != '12'
),
t2 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id,'0x','')) AS condition_id_norm
  FROM condition_market_map
  WHERE market_id != '12'
),
u AS (
  SELECT * FROM t1
  UNION ALL
  SELECT * FROM t2
)
SELECT
  market_id,
  anyHeavy(condition_id_norm) AS condition_id_norm
FROM u
GROUP BY market_id;

-- B) Market Outcomes Expanded
-- Expands outcome arrays to individual rows with index and label
CREATE OR REPLACE VIEW market_outcomes_expanded AS
SELECT
  mo.condition_id_norm,
  idx - 1 AS outcome_idx,
  upperUTF8(toString(mo.outcomes[idx])) AS outcome_label
FROM market_outcomes mo
ARRAY JOIN arrayEnumerate(mo.outcomes) AS idx;

-- C) Resolutions Normalized
-- Normalizes resolution data with uppercase labels
CREATE OR REPLACE VIEW resolutions_norm AS
SELECT
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  upperUTF8(toString(winning_outcome)) AS win_label,
  resolved_at
FROM market_resolutions
WHERE winning_outcome IS NOT NULL;

-- D) Winning Index
-- Maps condition_id_norm to winning outcome index
CREATE OR REPLACE VIEW winning_index AS
SELECT
  r.condition_id_norm,
  anyIf(moe.outcome_idx, moe.outcome_label = r.win_label) AS win_idx,
  any(r.resolved_at) AS resolved_at
FROM resolutions_norm r
LEFT JOIN market_outcomes_expanded moe USING (condition_id_norm)
GROUP BY r.condition_id_norm;

-- E) Trade Flows v2
-- Computes cashflow and share delta per trade fill
-- BUY: negative cashflow (cost), positive shares
-- SELL: positive cashflow (revenue), negative shares
CREATE OR REPLACE VIEW trade_flows_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  cast(outcome_index as Int16) AS trade_idx,
  toString(outcome) AS outcome_raw,
  round(
    cast(entry_price as Float64) * cast(shares as Float64) *
    if(lowerUTF8(toString(side)) = 'buy', -1, 1),
    8
  ) AS cashflow_usdc,
  if(
    lowerUTF8(toString(side)) = 'buy',
    cast(shares as Float64),
    -cast(shares as Float64)
  ) AS delta_shares
FROM trades_raw
WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000');

-- F) Realized PnL by Market v2
-- CORRECTED VERSION: Proper aggregation without subquery ambiguity
-- Settlement per market = sum(all cashflows) + sum(shares in winning outcome)
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tf.wallet,
  tf.market_id,
  cc.condition_id_norm,
  any(wi.resolved_at) AS resolved_at,
  round(
    sum(tf.cashflow_usdc) +
    sumIf(
      tf.delta_shares,
      coalesce(
        tf.trade_idx,
        multiIf(
          upperUTF8(tf.outcome_raw) = 'YES', 1,
          upperUTF8(tf.outcome_raw) = 'NO', 0,
          NULL
        )
      ) = wi.win_idx
    ),
    8
  ) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
  AND coalesce(
    tf.trade_idx,
    multiIf(
      upperUTF8(tf.outcome_raw) = 'YES', 1,
      upperUTF8(tf.outcome_raw) = 'NO', 0,
      NULL
    )
  ) IS NOT NULL
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm;

-- G) Wallet Realized PnL v2
-- Aggregate realized P&L per wallet across all markets
CREATE OR REPLACE VIEW wallet_realized_pnl_v2 AS
SELECT
  wallet,
  round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v2
GROUP BY wallet;

-- H) Wallet Unrealized PnL v2
-- Aggregate unrealized P&L per wallet from open positions
CREATE OR REPLACE VIEW wallet_unrealized_pnl_v2 AS
SELECT
  wallet,
  round(sum(unrealized_pnl_usd), 2) AS unrealized_pnl_usd
FROM portfolio_mtm_detailed
GROUP BY wallet;

-- I) Wallet PnL Summary v2
-- Combined view: realized + unrealized = total P&L
CREATE OR REPLACE VIEW wallet_pnl_summary_v2 AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(
    coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0),
    2
  ) AS total_pnl_usd
FROM wallet_realized_pnl_v2 r
FULL JOIN wallet_unrealized_pnl_v2 u USING (wallet);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Query 1: Check bridge coverage for target wallets
-- Expected: 100% bridged and most resolvable
WITH target_markets AS (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) IN (
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  )
)
SELECT
  count() AS markets_touched,
  countIf(cc.condition_id_norm IS NOT NULL) AS bridged,
  countIf(wi.win_idx IS NOT NULL) AS resolvable,
  round(countIf(wi.win_idx IS NOT NULL) * 100.0 / count(), 2) AS pct_resolvable
FROM target_markets tm
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm;

-- Query 2: Final P&L for target wallets
-- Expected: HolyMoses7 ~$89,975-$91,633, niggemon ~$102,001
SELECT
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY wallet;

-- Query 3: Sample market-level breakdown for debugging
-- Shows first 10 resolved markets with P&L
SELECT
  wallet,
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY resolved_at DESC
LIMIT 10;
