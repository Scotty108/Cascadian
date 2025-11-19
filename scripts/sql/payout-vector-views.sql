-- ============================================================================
-- PAYOUT VECTOR VIEWS FROM TEXT OUTCOMES
-- Created: 2025-11-09
-- Database: ClickHouse (cascadian_clean schema)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- VIEW 1: vw_resolutions_from_staging (Exact Matching Only)
-- ----------------------------------------------------------------------------
-- Coverage: 138,829 unique markets
-- Quality: 100% (0 validation errors)
-- Use case: High confidence exact matches only

CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_from_staging AS
WITH parsed_outcomes AS (
  SELECT
    lower(replaceAll(condition_id, '0x', '')) as cid_hex,
    JSONExtractArrayRaw(outcomes_json) as outcomes_raw,
    arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\', '')),
             JSONExtractArrayRaw(outcomes_json)) as outcomes
  FROM default.gamma_markets
  WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
)
SELECT
  r.cid as condition_id,
  lower(replaceAll(r.cid, '0x', '')) as cid_hex,
  1 AS resolved,
  indexOf(p.outcomes, r.winning_outcome) - 1 AS winning_index,
  arrayMap(i -> if(i = indexOf(p.outcomes, r.winning_outcome), 1, 0),
           arrayEnumerate(p.outcomes)) AS payout_numerators,
  1 AS payout_denominator,
  p.outcomes,
  r.winning_outcome,
  r.updated_at AS resolved_at,
  r.source,
  r.priority
FROM default.staging_resolutions_union r
INNER JOIN parsed_outcomes p
  ON lower(replaceAll(r.cid, '0x', '')) = p.cid_hex
WHERE r.winning_outcome IS NOT NULL
  AND r.winning_outcome != ''
  AND length(p.outcomes) > 0
  AND indexOf(p.outcomes, r.winning_outcome) > 0;


-- ----------------------------------------------------------------------------
-- VIEW 2: vw_resolutions_enhanced (RECOMMENDED - Fuzzy Matching + Aliases)
-- ----------------------------------------------------------------------------
-- Coverage: 139,207 unique markets (+378 vs exact only)
-- Quality: 100% (0 validation errors)
-- Features:
--   - Exact text matching
--   - Case-insensitive matching
--   - Alias mapping (YES→Up, NO→Down, YES→Over, NO→Under)
-- Use case: Production P&L calculations with quality filtering

CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_enhanced AS
WITH
  parsed_outcomes AS (
    SELECT
      lower(replaceAll(condition_id, '0x', '')) as cid_hex,
      arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\', '')),
               JSONExtractArrayRaw(outcomes_json)) as outcomes,
      arrayMap(x -> lower(trim(replaceAll(replaceAll(x, '"', ''), '\\', ''))),
               JSONExtractArrayRaw(outcomes_json)) as outcomes_lower
    FROM default.gamma_markets
    WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
  ),
  winner_mapping AS (
    SELECT
      r.cid,
      lower(replaceAll(r.cid, '0x', '')) as cid_hex,
      r.winning_outcome,
      r.updated_at,
      r.source,
      r.priority,
      p.outcomes,
      p.outcomes_lower,
      -- Try exact match first
      indexOf(p.outcomes, r.winning_outcome) as exact_match_idx,
      -- Try case-insensitive match
      indexOf(p.outcomes_lower, lower(trim(r.winning_outcome))) as case_match_idx,
      -- Try alias mapping for common patterns
      CASE
        -- YES/NO aliases for Up/Down
        WHEN upper(trim(r.winning_outcome)) = 'YES' AND indexOf(p.outcomes_lower, 'up') > 0
          THEN indexOf(p.outcomes_lower, 'up')
        WHEN upper(trim(r.winning_outcome)) = 'NO' AND indexOf(p.outcomes_lower, 'down') > 0
          THEN indexOf(p.outcomes_lower, 'down')
        -- YES/NO aliases for Over/Under
        WHEN upper(trim(r.winning_outcome)) = 'YES' AND indexOf(p.outcomes_lower, 'over') > 0
          THEN indexOf(p.outcomes_lower, 'over')
        WHEN upper(trim(r.winning_outcome)) = 'NO' AND indexOf(p.outcomes_lower, 'under') > 0
          THEN indexOf(p.outcomes_lower, 'under')
        -- Trim trailing spaces (common issue)
        WHEN indexOf(p.outcomes_lower, lower(trim(r.winning_outcome))) > 0
          THEN indexOf(p.outcomes_lower, lower(trim(r.winning_outcome)))
        ELSE 0
      END as alias_match_idx
    FROM default.staging_resolutions_union r
    INNER JOIN parsed_outcomes p
      ON lower(replaceAll(r.cid, '0x', '')) = p.cid_hex
    WHERE r.winning_outcome IS NOT NULL AND r.winning_outcome != ''
  )
SELECT
  cid as condition_id,
  cid_hex,
  1 AS resolved,
  -- Use first successful match (exact > case > alias)
  CASE
    WHEN exact_match_idx > 0 THEN exact_match_idx - 1
    WHEN case_match_idx > 0 THEN case_match_idx - 1
    WHEN alias_match_idx > 0 THEN alias_match_idx - 1
    ELSE -1
  END as winning_index,
  -- Create payout vector
  arrayMap(i ->
    if(i = CASE
              WHEN exact_match_idx > 0 THEN exact_match_idx
              WHEN case_match_idx > 0 THEN case_match_idx
              WHEN alias_match_idx > 0 THEN alias_match_idx
              ELSE 0
            END, 1, 0),
    arrayEnumerate(outcomes)) AS payout_numerators,
  1 AS payout_denominator,
  outcomes,
  winning_outcome,
  updated_at AS resolved_at,
  source,
  priority,
  -- Match quality indicator
  CASE
    WHEN exact_match_idx > 0 THEN 'exact'
    WHEN case_match_idx > 0 THEN 'case_insensitive'
    WHEN alias_match_idx > 0 THEN 'alias_mapped'
    ELSE 'no_match'
  END as match_quality
FROM winner_mapping
WHERE exact_match_idx > 0 OR case_match_idx > 0 OR alias_match_idx > 0;


-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

-- Example 1: Get de-duplicated resolutions (one per market, highest quality)
-- --------------------------------------------------------------------------
SELECT
  cid_hex,
  winning_outcome,
  payout_numerators,
  outcomes,
  match_quality,
  source
FROM cascadian_clean.vw_resolutions_enhanced
WHERE match_quality IN ('exact', 'case_insensitive')  -- Filter by quality
ORDER BY
  cid_hex,
  priority DESC,  -- Gamma (25) > Bridge (22) > Rollup (21)
  CASE match_quality
    WHEN 'exact' THEN 1
    WHEN 'case_insensitive' THEN 2
    WHEN 'alias_mapped' THEN 3
  END ASC
LIMIT 1 BY cid_hex;


-- Example 2: Join with trades for P&L calculation
-- --------------------------------------------------------------------------
SELECT
  t.wallet_address,
  t.condition_id_norm,
  r.winning_outcome,
  r.payout_numerators,
  t.shares,
  t.cost_basis,
  -- Calculate payout (ClickHouse arrays are 1-indexed)
  t.shares * arrayElement(r.payout_numerators, t.outcome_index + 1) AS payout_amount,
  -- Calculate P&L
  (t.shares * arrayElement(r.payout_numerators, t.outcome_index + 1)) - t.cost_basis AS pnl
FROM default.vw_trades_canonical t
INNER JOIN cascadian_clean.vw_resolutions_enhanced r
  ON t.condition_id_norm = r.cid_hex
WHERE r.match_quality IN ('exact', 'case_insensitive')
  AND r.source = 'gamma'  -- Use highest priority source
ORDER BY r.priority DESC
LIMIT 1 BY t.condition_id_norm, t.wallet_address;


-- Example 3: Validate multiple sources agree
-- --------------------------------------------------------------------------
SELECT
  cid_hex,
  groupArray(source) as sources,
  groupArray(winning_outcome) as all_outcomes,
  groupArray(match_quality) as match_qualities,
  count(DISTINCT winning_outcome) as unique_outcomes
FROM cascadian_clean.vw_resolutions_enhanced
GROUP BY cid_hex
HAVING unique_outcomes > 1  -- Find conflicts
ORDER BY unique_outcomes DESC;


-- Example 4: Quality distribution check
-- --------------------------------------------------------------------------
SELECT
  match_quality,
  count() as row_count,
  count(DISTINCT cid_hex) as unique_markets,
  round(count() * 100.0 / (SELECT count() FROM cascadian_clean.vw_resolutions_enhanced), 2) as pct_of_total
FROM cascadian_clean.vw_resolutions_enhanced
GROUP BY match_quality
ORDER BY
  CASE match_quality
    WHEN 'exact' THEN 1
    WHEN 'case_insensitive' THEN 2
    WHEN 'alias_mapped' THEN 3
    ELSE 4
  END;


-- ============================================================================
-- VALIDATION QUERIES
-- ============================================================================

-- Check for quality issues (should all be 0)
-- --------------------------------------------------------------------------
SELECT
  'empty_arrays' as check_name,
  countIf(length(payout_numerators) = 0) as issue_count
FROM cascadian_clean.vw_resolutions_enhanced

UNION ALL

SELECT
  'length_mismatch' as check_name,
  countIf(length(payout_numerators) != length(outcomes)) as issue_count
FROM cascadian_clean.vw_resolutions_enhanced

UNION ALL

SELECT
  'negative_index' as check_name,
  countIf(winning_index < 0) as issue_count
FROM cascadian_clean.vw_resolutions_enhanced

UNION ALL

SELECT
  'index_out_of_bounds' as check_name,
  countIf(winning_index >= length(outcomes)) as issue_count
FROM cascadian_clean.vw_resolutions_enhanced

UNION ALL

SELECT
  'sum_not_one' as check_name,
  countIf(arraySum(payout_numerators) != 1) as issue_count
FROM cascadian_clean.vw_resolutions_enhanced;


-- Sample alias-mapped markets for manual review
-- --------------------------------------------------------------------------
SELECT
  cid_hex,
  winning_outcome,
  outcomes,
  winning_index,
  payout_numerators,
  match_quality,
  source
FROM cascadian_clean.vw_resolutions_enhanced
WHERE match_quality = 'alias_mapped'
ORDER BY cid_hex
LIMIT 50;
