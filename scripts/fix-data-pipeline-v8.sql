-- ============================================================================
-- DATA PIPELINE FIX: pm_token_to_condition_map_v5 + pm_unified_ledger_v8
-- ============================================================================
-- Problem: pm_token_to_condition_map_v4 is STALE (359K tokens vs 400K in metadata)
--          This causes 97% wallet failures in PnL engine due to invisible trades
--
-- Solution: Build V5 map from FRESH pm_market_metadata, then rebuild ledger V8
-- ============================================================================

-- ============================================================================
-- STEP 1: Create pm_token_to_condition_map_v5 from pm_market_metadata
-- ============================================================================
-- This unrolls the token_ids array to create: token_id -> condition_id + outcome_index

CREATE TABLE IF NOT EXISTS pm_token_to_condition_map_v5
(
    token_id_dec String,           -- Decimal token ID (matches pm_trader_events_v2.token_id)
    condition_id String,           -- 64-char hex condition ID
    outcome_index Int64,           -- 0-indexed outcome position
    question String,               -- Market question for debugging
    category String                -- Category from metadata
)
ENGINE = ReplacingMergeTree()
ORDER BY (token_id_dec)
SETTINGS index_granularity = 8192;

-- Populate V5 map by unrolling token_ids array from fresh metadata
INSERT INTO pm_token_to_condition_map_v5
SELECT
    arrayJoin(arrayEnumerate(token_ids)) AS idx,
    token_ids[idx] AS token_id_dec,
    condition_id,
    idx - 1 AS outcome_index,  -- ClickHouse arrays are 1-indexed, outcomes are 0-indexed
    question,
    category
FROM pm_market_metadata
WHERE length(token_ids) > 0
SETTINGS max_threads = 8;

-- WAIT: Run this SELECT to verify before proceeding
-- SELECT
--   (SELECT count(DISTINCT token_id_dec) FROM pm_token_to_condition_map_v4) as v4_count,
--   (SELECT count(DISTINCT token_id_dec) FROM pm_token_to_condition_map_v5) as v5_count;
-- Expected: v5_count >= v4_count + 40000

-- ============================================================================
-- STEP 2: Create pm_unified_ledger_v8 VIEW using the fresh V5 map
-- ============================================================================

DROP VIEW IF EXISTS pm_unified_ledger_v8;

CREATE VIEW pm_unified_ledger_v8 AS
-- CLOB Trades (using fresh V5 map)
SELECT
    'CLOB' AS source_type,
    t.wallet AS wallet_address,
    m.condition_id AS condition_id,
    m.outcome_index AS outcome_index,
    t.trade_time AS event_time,
    t.event_id AS event_id,
    if(t.side = 'buy', -t.usdc_amount, t.usdc_amount) AS usdc_delta,
    if(t.side = 'buy', t.token_amount, -t.token_amount) AS token_delta,
    r.payout_numerators AS payout_numerators,
    if(
        r.payout_numerators IS NOT NULL,
        if(
            JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000,
            1,
            JSONExtractInt(r.payout_numerators, m.outcome_index + 1)
        ),
        NULL
    ) AS payout_norm
FROM (
    -- Dedupe pm_trader_events_v2 (table has duplicates from backfills)
    SELECT
        event_id,
        trader_wallet AS wallet,
        any(side) AS side,
        any(usdc_amount) / 1000000.0 AS usdc_amount,
        any(token_amount) / 1000000.0 AS token_amount,
        any(trade_time) AS trade_time,
        any(token_id) AS token_id
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 AND role = 'maker'
    GROUP BY event_id, trader_wallet
) AS t
LEFT JOIN pm_token_to_condition_map_v5 AS m ON t.token_id = m.token_id_dec
LEFT JOIN pm_condition_resolutions AS r ON m.condition_id = r.condition_id

UNION ALL

-- Position Splits (CTF events - already have condition_id)
SELECT
    'PositionSplit' AS source_type,
    c.user_address AS wallet_address,
    c.condition_id AS condition_id,
    0 AS outcome_index,
    c.event_timestamp AS event_time,
    c.id AS event_id,
    -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
    toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
    r.payout_numerators AS payout_numerators,
    NULL AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PositionSplit'

UNION ALL

-- Position Merges (CTF events)
SELECT
    'PositionsMerge' AS source_type,
    c.user_address AS wallet_address,
    c.condition_id AS condition_id,
    0 AS outcome_index,
    c.event_timestamp AS event_time,
    c.id AS event_id,
    toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
    -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
    r.payout_numerators AS payout_numerators,
    NULL AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PositionsMerge'

UNION ALL

-- Payout Redemptions (CTF events)
SELECT
    'PayoutRedemption' AS source_type,
    c.user_address AS wallet_address,
    c.condition_id AS condition_id,
    0 AS outcome_index,
    c.event_timestamp AS event_time,
    c.id AS event_id,
    toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
    -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
    r.payout_numerators AS payout_numerators,
    1 AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PayoutRedemption';


-- ============================================================================
-- STEP 3: VERIFICATION QUERIES
-- ============================================================================

-- 3a. Check token map coverage improvement
-- SELECT
--   (SELECT count(DISTINCT token_id_dec) FROM pm_token_to_condition_map_v4) as v4_tokens,
--   (SELECT count(DISTINCT token_id_dec) FROM pm_token_to_condition_map_v5) as v5_tokens,
--   (SELECT count(DISTINCT condition_id) FROM pm_token_to_condition_map_v4) as v4_conditions,
--   (SELECT count(DISTINCT condition_id) FROM pm_token_to_condition_map_v5) as v5_conditions;

-- 3b. Coverage test: Last 24 hours of trades
-- WITH recent_trades AS (
--     SELECT DISTINCT token_id
--     FROM pm_trader_events_v2
--     WHERE trade_time >= now() - INTERVAL 24 HOUR
--       AND is_deleted = 0
--       AND role = 'maker'
-- )
-- SELECT
--     count(*) as total_recent_tokens,
--     countIf(m.condition_id IS NOT NULL) as matched_in_v5,
--     round(100.0 * countIf(m.condition_id IS NOT NULL) / count(*), 2) as coverage_pct
-- FROM recent_trades t
-- LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec;

-- 3c. Compare V7 vs V8 ledger coverage for last 24h
-- SELECT
--   'V7' as version,
--   count(*) as total_rows,
--   countIf(condition_id != '') as with_condition_id,
--   round(100.0 * countIf(condition_id != '') / count(*), 2) as coverage_pct
-- FROM pm_unified_ledger_v7
-- WHERE event_time >= now() - INTERVAL 24 HOUR
-- UNION ALL
-- SELECT
--   'V8' as version,
--   count(*) as total_rows,
--   countIf(condition_id != '') as with_condition_id,
--   round(100.0 * countIf(condition_id != '') / count(*), 2) as coverage_pct
-- FROM pm_unified_ledger_v8
-- WHERE event_time >= now() - INTERVAL 24 HOUR;
