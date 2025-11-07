-- ========================================
-- SETTLEMENT RULES FOR P&L CALCULATION
-- Ground Truth: Snapshot 2025-10-31 23:59:59
-- All calculations in Float64
-- ========================================

-- ========================================
-- RULE 1: SIGNED CASHFLOW (per fill)
-- ========================================
-- Purpose: Calculate the cash impact of each trade fill
-- Inputs: side (1=BUY, 2=SELL), shares, entry_price, fee_usd, slippage_usd
-- Output: signed_cashflow (Float64)

CREATE OR REPLACE FUNCTION calculate_signed_cashflow(
    side UInt8,
    shares Float64,
    entry_price Float64,
    fee_usd Float64,
    slippage_usd Float64
) AS (
    -- Step 1: Calculate base cashflow by side
    -- BUY (side=1): negative outflow = -entry_price * shares
    -- SELL (side=2): positive inflow = +entry_price * shares
    multiIf(
        side = 1, -(entry_price * shares),
        side = 2, +(entry_price * shares),
        0.0
    ) - (fee_usd + slippage_usd)  -- Always subtract fees
);

-- SQL Pattern for materialized view or query:
/*
SELECT
    transaction_hash,
    wallet_address,
    timestamp,
    market_id,
    outcome_index,
    side,
    shares,
    entry_price,
    fee_usd,
    slippage_usd,
    calculate_signed_cashflow(side, shares, entry_price, fee_usd, slippage_usd) AS signed_cashflow
FROM fills_table
WHERE timestamp <= '2025-10-31 23:59:59'
*/


-- ========================================
-- RULE 2: SETTLEMENT ON RESOLUTION (per market)
-- ========================================
-- Purpose: Calculate payout when market resolves
-- Inputs: outcome_index, side, shares, winning_index
-- Output: settlement_usd (Float64)

CREATE OR REPLACE FUNCTION calculate_settlement_usd(
    outcome_index UInt8,
    side UInt8,
    shares Float64,
    winning_index UInt8
) AS (
    multiIf(
        -- Winning Long: side=1 AND outcome matches winning_index
        side = 1 AND outcome_index = winning_index, 1.0 * shares,

        -- Winning Short: side=2 AND outcome does NOT match winning_index
        -- (shorts win $1 per share on losing outcomes)
        side = 2 AND outcome_index != winning_index, 1.0 * abs(shares),

        -- All other cases: no payout
        0.0
    )
);

-- SQL Pattern for aggregation per market:
/*
SELECT
    market_id,
    winning_index,

    -- Winning longs (bought winning outcome)
    sum(multiIf(
        side = 1 AND outcome_index = winning_index,
        1.0 * max(shares, 0.0),
        0.0
    )) AS winning_long,

    -- Winning shorts (sold losing outcomes)
    sum(multiIf(
        side = 2 AND outcome_index != winning_index,
        1.0 * max(abs(shares), 0.0),
        0.0
    )) AS winning_short,

    -- Total settlement
    winning_long + winning_short AS settlement_usd

FROM fills_with_cashflow
JOIN markets_resolved USING (market_id)
WHERE markets_resolved.resolution_timestamp <= '2025-10-31 23:59:59'
GROUP BY market_id, winning_index
*/


-- ========================================
-- RULE 3: REALIZED PNL PER MARKET
-- ========================================
-- Purpose: Calculate profit/loss for each market after settlement
-- Inputs: settlement_usd, sum(signed_cashflow), side
-- Output: realized_pnl_market (Float64)
--
-- IMPORTANT: The P&L formula is SIDE-DEPENDENT and WIN/LOSS-DEPENDENT:
--
-- LONG (side=1):
--   - Win (settlement > 0): settlement - cashflow
--   - Loss (settlement = 0): cashflow (keeps negative sign)
--
-- SHORT (side=2):
--   - Win (settlement > 0): settlement + cashflow
--   - Loss (settlement = 0): -cashflow (reverses sign)

-- SQL Pattern for final P&L calculation:
/*
WITH fills_with_cashflow AS (
    SELECT
        market_id,
        wallet_address,
        outcome_index,
        side,
        shares,
        entry_price,
        fee_usd,
        slippage_usd,
        calculate_signed_cashflow(side, shares, entry_price, fee_usd, slippage_usd) AS signed_cashflow
    FROM fills_deduped
    WHERE timestamp <= '2025-10-31 23:59:59'
),

market_settlements AS (
    SELECT
        market_id,
        wallet_address,
        side,  -- IMPORTANT: Include side for P&L calculation
        sum(calculate_settlement_usd(
            outcome_index,
            side,
            shares,
            markets_resolved.winning_index
        )) AS settlement_usd,
        sum(signed_cashflow) AS total_cashflow
    FROM fills_with_cashflow
    JOIN markets_resolved USING (market_id)
    GROUP BY market_id, wallet_address, side
)

SELECT
    market_id,
    wallet_address,
    side,
    settlement_usd,
    total_cashflow,
    -- RULE 3: Realized P&L (side-dependent formula)
    multiIf(
        -- Long Win
        side = 1 AND settlement_usd > 0, settlement_usd - total_cashflow,
        -- Long Loss
        side = 1 AND settlement_usd = 0, total_cashflow,
        -- Short Win
        side = 2 AND settlement_usd > 0, settlement_usd + total_cashflow,
        -- Short Loss
        side = 2 AND settlement_usd = 0, -total_cashflow,
        -- Default (shouldn't reach here)
        settlement_usd - total_cashflow
    ) AS realized_pnl_market
FROM market_settlements
ORDER BY realized_pnl_market DESC
*/


-- ========================================
-- DEDUPLICATION KEY
-- ========================================
-- Ensure no duplicate fills in calculation
-- Key: (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)

/*
CREATE MATERIALIZED VIEW fills_deduped AS
SELECT DISTINCT
    transaction_hash,
    wallet_address,
    timestamp,
    side,
    shares,
    entry_price,
    usd_value,
    market_id,
    outcome_index,
    fee_usd,
    slippage_usd
FROM fills_raw
WHERE timestamp <= '2025-10-31 23:59:59'
GROUP BY
    transaction_hash,
    wallet_address,
    timestamp,
    side,
    shares,
    entry_price,
    usd_value,
    market_id,
    outcome_index,
    fee_usd,
    slippage_usd
ORDER BY timestamp
*/


-- ========================================
-- PSEUDOCODE SUMMARY
-- ========================================

/*
RULE 1: Signed Cashflow
------------------------
INPUT: side, shares, entry_price, fee_usd, slippage_usd
LOGIC:
  total_fees = fee_usd + slippage_usd

  IF side = 1 (BUY):
    -- Longs pay the entry price
    signed_cashflow = -(entry_price * shares) - total_fees
  ELSE IF side = 2 (SELL):
    -- Shorts receive premium (collateral implicit in settlement)
    signed_cashflow = +(entry_price * shares) - total_fees
  ENDIF
OUTPUT: signed_cashflow (Float64)
  - Negative = cost/outflow
  - Positive = proceeds/inflow


RULE 2: Settlement on Resolution
---------------------------------
INPUT: outcome_index, side, shares, winning_index
LOGIC:
  IF side = 1 AND outcome_index = winning_index:
    -- Winning long: get $1 per share
    settlement = 1.0 * max(shares, 0)
  ELSE IF side = 2 AND outcome_index != winning_index:
    -- Winning short: get $1 per share when outcome LOSES
    settlement = 1.0 * max(abs(shares), 0)
  ELSE:
    -- Losing position: get nothing
    settlement = 0.0
  ENDIF
OUTPUT: settlement_usd (Float64)


RULE 3: Realized PnL per Market
--------------------------------
INPUT: settlement_usd, total_cashflow, side
LOGIC:
  -- Formula depends on BOTH side AND win/loss status

  IF side = 1 (LONG):
    IF settlement_usd > 0:
      -- Won: payout minus cost
      realized_pnl = settlement_usd - total_cashflow
    ELSE:
      -- Lost: just the cost (negative)
      realized_pnl = total_cashflow
    ENDIF

  ELSE IF side = 2 (SHORT):
    IF settlement_usd > 0:
      -- Won: payout plus premium received
      realized_pnl = settlement_usd + total_cashflow
    ELSE:
      -- Lost: reverse the premium (you received but lost position)
      realized_pnl = -total_cashflow
    ENDIF
  ENDIF

OUTPUT: realized_pnl_market (Float64)

INTERPRETATION:
  - Positive = Profit
  - Negative = Loss

WHY SIDE-DEPENDENT:
  - Longs: cashflow is always negative (cost), so subtract from settlement
  - Shorts: cashflow is positive (premium received), behavior changes on win/loss
    - Win: keep premium AND get payout (add both)
    - Loss: lost the position despite premium (negate the premium)
*/
