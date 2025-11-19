-- Step 1: Create unified view with priority-based deduplication
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_unified AS
WITH warehouse AS (
  SELECT
    lower(concat('0x', condition_id_norm)) AS cid_hex,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    winning_outcome,
    'warehouse' AS source,
    1 AS priority
  FROM default.market_resolutions_final
  WHERE payout_denominator > 0
    AND winning_index >= 0
),
staging AS (
  SELECT
    cid_hex,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    winning_outcome,
    'staging' AS source,
    2 AS priority
  FROM cascadian_clean.vw_resolutions_from_staging
),
api AS (
  SELECT
    lower(cid_hex) AS cid_hex,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    winning_outcome,
    'api' AS source,
    3 AS priority
  FROM cascadian_clean.resolutions_src_api
  WHERE resolved = 1
    AND winning_index >= 0
    AND payout_denominator > 0
)
-- Union with priority (warehouse first, then staging, then api)
SELECT * FROM warehouse

UNION ALL

SELECT s.*
FROM staging s
LEFT JOIN warehouse w ON w.cid_hex = s.cid_hex
WHERE w.cid_hex IS NULL

UNION ALL

SELECT a.*
FROM api a
LEFT JOIN warehouse w ON w.cid_hex = a.cid_hex
LEFT JOIN staging s ON s.cid_hex = a.cid_hex
WHERE w.cid_hex IS NULL AND s.cid_hex IS NULL;
