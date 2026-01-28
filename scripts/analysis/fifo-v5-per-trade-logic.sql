-- FIFO V5 Per-Trade Logic
-- This is the core logic that creates one row per buy transaction
-- Unique key: (tx_hash, wallet, condition_id, outcome_index)

-- =============================================================================
-- LONG POSITIONS (Normal Buys)
-- =============================================================================

SELECT
  tx_hash,
  wallet,
  condition_id,
  outcome_index,
  entry_time,
  resolved_at,
  tokens,
  cost_usd,
  tokens_sold_early,
  tokens_held,
  exit_value,
  exit_value - cost_usd as pnl_usd,
  CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
  CASE WHEN (total_tokens_sold + tokens_held) > 0
    THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100
    ELSE 0
  END as pct_sold_early,
  is_maker_flag as is_maker,
  0 as is_short,
  CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
FROM (
  SELECT
    buy.*,
    coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
    coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,

    -- FIFO V5 Token Allocation: How many tokens from THIS buy were sold early?
    least(
      buy.tokens,  -- Can't sell more than we bought
      greatest(0,  -- Can't be negative
        coalesce(sells.total_tokens_sold, 0) -
        coalesce(
          sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        )
      )
    ) as tokens_sold_early,

    -- Tokens still held from THIS buy
    buy.tokens - least(
      buy.tokens,
      greatest(0,
        coalesce(sells.total_tokens_sold, 0) -
        coalesce(
          sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        )
      )
    ) as tokens_held,

    -- Exit value: Proportional share of total sell proceeds for tokens sold early
    (CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
      (
        least(
          buy.tokens,
          greatest(0,
            coalesce(sells.total_tokens_sold, 0) -
            coalesce(
              sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            )
          )
        ) / coalesce(sells.total_tokens_sold, 0)
      ) * coalesce(sells.total_sell_proceeds, 0)
    ELSE 0 END) as exit_value

  FROM (
    -- Aggregate buys by transaction (tx_hash)
    -- One row per buy transaction
    SELECT
      _tx_hash as tx_hash,
      _wallet as wallet,
      _condition_id as condition_id,
      _outcome_index as outcome_index,
      min(_event_time) as entry_time,
      sum(_tokens_delta) as tokens,
      sum(abs(_usdc_delta)) as cost_usd,
      max(_is_maker) as is_maker_flag,
      any(_resolved_at) as resolved_at  -- NULL for unresolved, timestamp for resolved
    FROM (
      -- Deduplicate fills first
      SELECT
        f.fill_id,
        any(f.tx_hash) as _tx_hash,
        any(f.event_time) as _event_time,
        any(f.wallet) as _wallet,
        any(f.condition_id) as _condition_id,
        any(f.outcome_index) as _outcome_index,
        any(f.tokens_delta) as _tokens_delta,
        any(f.usdc_delta) as _usdc_delta,
        any(f.is_maker) as _is_maker,
        any(f.is_self_fill) as _is_self_fill,
        any(f.source) as _source,
        any(r.resolved_at) as _resolved_at
      FROM pm_canonical_fills_v4 f
      LEFT JOIN pm_condition_resolutions r
        ON f.condition_id = r.condition_id
        AND r.is_deleted = 0
        AND r.payout_numerators != ''
      WHERE f.wallet = :wallet  -- Filter to specific wallet
      GROUP BY f.fill_id
    )
    WHERE _source = 'clob'
      AND _tokens_delta > 0  -- Buys only
      AND _wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (_is_self_fill = 1 AND _is_maker = 1)  -- Exclude self-fills where maker
    GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
    HAVING cost_usd >= 0.01  -- Filter dust
  ) AS buy

  LEFT JOIN (
    -- Aggregate ALL sells for this position (across all transactions)
    SELECT
      _wallet as wallet,
      _condition_id as condition_id,
      _outcome_index as outcome_index,
      sum(abs(_tokens_delta)) as total_tokens_sold,
      sum(abs(_usdc_delta)) as total_sell_proceeds
    FROM (
      SELECT
        f.fill_id,
        any(f.wallet) as _wallet,
        any(f.condition_id) as _condition_id,
        any(f.outcome_index) as _outcome_index,
        any(f.tokens_delta) as _tokens_delta,
        any(f.usdc_delta) as _usdc_delta,
        any(f.source) as _source
      FROM pm_canonical_fills_v4 f
      WHERE f.wallet = :wallet
      GROUP BY f.fill_id
    )
    WHERE _source = 'clob'
      AND _tokens_delta < 0  -- Sells only
      AND _wallet != '0x0000000000000000000000000000000000000000'
    GROUP BY _wallet, _condition_id, _outcome_index
  ) AS sells
    ON buy.wallet = sells.wallet
    AND buy.condition_id = sells.condition_id
    AND buy.outcome_index = sells.outcome_index
)


-- =============================================================================
-- SHORT POSITIONS (Net Negative Tokens)
-- =============================================================================

-- For positions where sum(tokens_delta) < 0 and sum(usdc_delta) > 0
-- These are shorts via NegRisk adapter or other mechanisms

SELECT
  concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
  wallet,
  condition_id,
  outcome_index,
  entry_time,
  resolved_at,
  abs(net_tokens) as tokens,
  -cash_flow as cost_usd,  -- Negative because we received USDC
  0 as tokens_sold_early,
  abs(net_tokens) as tokens_held,
  0 as exit_value,
  -cash_flow as pnl_usd,  -- Profit from shorting
  CASE WHEN cash_flow > 0 THEN -cash_flow / cash_flow ELSE 0 END as roi,
  0 as pct_sold_early,
  0 as is_maker,
  1 as is_short,
  0 as is_closed
FROM (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    min(event_time) as entry_time,
    any(resolved_at) as resolved_at,
    sum(tokens_delta) as net_tokens,
    sum(usdc_delta) as cash_flow
  FROM (
    SELECT
      f.fill_id,
      any(f.event_time) as event_time,
      any(f.wallet) as wallet,
      any(f.condition_id) as condition_id,
      any(f.outcome_index) as outcome_index,
      any(f.tokens_delta) as tokens_delta,
      any(f.usdc_delta) as usdc_delta,
      any(f.source) as source,
      any(f.is_self_fill) as is_self_fill,
      any(f.is_maker) as is_maker,
      any(r.resolved_at) as resolved_at
    FROM pm_canonical_fills_v4 f
    LEFT JOIN pm_condition_resolutions r
      ON f.condition_id = r.condition_id
      AND r.is_deleted = 0
      AND r.payout_numerators != ''
    WHERE f.wallet = :wallet
    GROUP BY f.fill_id
  )
  WHERE source = 'clob'
    AND wallet != '0x0000000000000000000000000000000000000000'
    AND NOT (is_self_fill = 1 AND is_maker = 1)
  GROUP BY wallet, condition_id, outcome_index
  HAVING net_tokens < -0.01 AND cash_flow > 0.01  -- Short positions only
)


-- =============================================================================
-- KEY CONCEPTS
-- =============================================================================

-- 1. UNIQUE KEY: (tx_hash, wallet, condition_id, outcome_index)
--    - One row per buy transaction
--    - A position can have MULTIPLE buy transactions (multiple rows)
--    - Example: Buy 100 tokens in tx1, buy 200 tokens in tx2 = 2 rows

-- 2. FIFO TOKEN ALLOCATION:
--    - Window function allocates sells to earliest buys first
--    - tokens_sold_early: How many tokens from THIS buy were sold
--    - tokens_held: How many tokens from THIS buy are still held
--    - exit_value: Proportional share of sell proceeds

-- 3. MARKET STATUS:
--    - resolved_at = NULL: Unresolved market (still open)
--    - resolved_at = timestamp: Resolved market
--    - Both are tracked in same table

-- 4. CLOSED vs OPEN POSITIONS:
--    - is_closed = 1: tokens_held <= 0.01 (all sold or resolved)
--    - is_closed = 0: Still holding tokens (either unresolved or waiting for resolution)

-- 5. EARLY SELLING:
--    - pct_sold_early: Percentage of original buy that was sold before resolution
--    - 0% = held to resolution, 100% = sold everything before resolution

-- 6. SHORT POSITIONS:
--    - Detected when sum(tokens_delta) < 0 AND sum(usdc_delta) > 0
--    - Synthetic tx_hash created (not a real transaction)
--    - cost_usd is negative (received USDC for shorting)
