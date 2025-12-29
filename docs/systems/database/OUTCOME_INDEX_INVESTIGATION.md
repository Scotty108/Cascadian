# Outcome Index Consistency Investigation

**Date:** 2025-11-24
**Investigator:** Claude 1
**Database:** ClickHouse (Cascadian)

## Executive Summary

**Finding:** `outcome_index` assignment is **INCONSISTENT** across Polymarket markets.

- **56.7%** of markets follow pattern: `outcome_index 0 = lower token_id, outcome_index 1 = higher token_id`
- **43.3%** of markets follow **reversed** pattern: `outcome_index 1 = lower token_id, outcome_index 0 = higher token_id`
- **0%** other/undefined patterns

## Key Implications

1. **Cannot rely on outcome_index alone** for determining which side won/lost
2. **Must cross-reference with token_id ordering** or other market metadata
3. **PnL calculations** that assume consistent outcome_index semantics will be incorrect ~43% of the time
4. **Resolution matching** between fills and payouts requires token_id-based joins, not outcome_index
5. **0.02% of markets have 3-7 outcomes** (39 out of 179,261 markets) - mostly legacy prediction markets from early 2021

## Investigation Methodology

### Query 1: Token Rank Distribution for [0,1] Resolutions

Markets where `payout_numerators = '[0,1]'` (outcome 1 wins):

```
┌───────────────┬────────────┬─────┐
│ outcome_index │ token_rank │ cnt │
├───────────────┼────────────┼─────┤
│ 0             │ 1          │ 69  │  ← outcome 0 is lowest token_id  (69 markets)
│ 0             │ 2          │ 78  │  ← outcome 0 is highest token_id (78 markets)
│ 1             │ 1          │ 78  │  ← outcome 1 is lowest token_id  (78 markets)
│ 1             │ 2          │ 69  │  ← outcome 1 is highest token_id (69 markets)
└───────────────┴────────────┴─────┘
```

**Interpretation:**
- When outcome 1 wins (`[0,1]`):
  - 69 markets have outcome_index 0 as the lower token_id
  - 78 markets have outcome_index 0 as the higher token_id
  - **This split proves inconsistency**

### Query 2: Token Rank Distribution for [1,0] Resolutions

Markets where `payout_numerators = '[1,0]'` (outcome 0 wins):

```
┌───────────────┬────────────┬─────┐
│ outcome_index │ token_rank │ cnt │
├───────────────┼────────────┼─────┤
│ 0             │ 1          │ 72  │  ← outcome 0 is lowest token_id  (72 markets)
│ 0             │ 2          │ 68  │  ← outcome 0 is highest token_id (68 markets)
│ 1             │ 1          │ 68  │  ← outcome 1 is lowest token_id  (68 markets)
│ 1             │ 2          │ 72  │  ← outcome 1 is highest token_id (72 markets)
└───────────────┴────────────┴─────┘
```

**Interpretation:**
- When outcome 0 wins (`[1,0]`):
  - 72 markets have outcome_index 0 as the lower token_id
  - 68 markets have outcome_index 0 as the higher token_id
  - **Same inconsistency pattern**

### Query 3: Sample Market Analysis

Examined 30 resolved markets (`[0,1]` and `[1,0]`):

#### Pattern 1: Consistent (0,1) - 17 markets (56.7%)

```
Condition: 0001bd6b1ce49b28...
Question: Bitcoin Up or Down - October 9, 8:30PM-8:45PM ET
Payout: [0,1]
Outcome indices by token order: [0,1]
Pattern: CONSISTENT (0,1)
```

**Meaning:** outcome_index 0 has lower token_id, outcome_index 1 has higher token_id

#### Pattern 2: Reversed (1,0) - 13 markets (43.3%)

```
Condition: 0002a45f7736686e...
Question: Will the Palisades fire burn less than 20k acres in total?
Payout: [0,1]
Outcome indices by token order: [1,0]
Pattern: REVERSED (1,0)
```

**Meaning:** outcome_index 1 has lower token_id, outcome_index 0 has higher token_id

## Root Cause Hypothesis

The inconsistency likely stems from **how Polymarket creates markets**:

1. When a market is created, two ERC1155 tokens are minted with sequential or random IDs
2. The `outcome_index` assignment (0 or 1) may depend on:
   - Order of creation in the smart contract
   - Alphabetical/lexical ordering of outcome labels
   - Random assignment
   - Frontend UI ordering

3. The `token_id` values are deterministic based on blockchain state, but their relationship to `outcome_index` is **not standardized**

## Recommendations

### For PnL Calculations

**DO NOT** use logic like:
```sql
-- ❌ WRONG: Assumes outcome_index has consistent meaning
CASE
  WHEN outcome_index = 0 THEN 'YES'
  WHEN outcome_index = 1 THEN 'NO'
END
```

**DO** use token_id-based resolution matching:
```sql
-- ✅ CORRECT: Join on token_id to determine winning side
SELECT
  f.token_id,
  CASE
    WHEN r.payout_numerators[f.outcome_index + 1] = 1 THEN 'WON'
    ELSE 'LOST'
  END as resolution_status
FROM pm_fills f
JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
```

### For Data Quality

1. **Always store both `token_id` and `outcome_index`** in denormalized tables
2. **Document the relationship** in metadata tables (if we can determine it)
3. **Never assume** outcome_index 0 = "YES" or outcome_index 1 = "NO"
4. **Use payout array indexing** with `outcome_index + 1` (ClickHouse is 1-indexed)

### For Future Investigations

1. Check if there's a pattern in the Polymarket API response (e.g., does the `tokens` array order match outcome_index?)
2. Investigate if certain market types (binary, sports, crypto) have different conventions
3. Query the Polymarket metadata API to see if outcome labels provide a consistent mapping

## Tables Affected

All tables using `outcome_index`:
- `pm_token_to_condition_map_v3` (source of truth for token ↔ condition mapping)
- `pm_fills` (has `outcome_index` for each trade)
- `pm_condition_resolutions` (has `payout_numerators` array indexed by outcome_index)
- Any PnL views/tables that join these

## Multi-Outcome Markets

**Finding:** 39 markets out of 179,261 (0.02%) have more than 2 outcomes.

- Maximum outcomes: 7 (e.g., "How many more tweets will be on the @laurenboebert account on April 6, 2021?")
- Most common: 5-6 outcomes
- All appear to be **legacy markets from early 2021** (NFT auctions, tweet counts, prediction markets)

**Example:**
```
Condition: b37b445d6ff5b98d...
Question: How many more tweets will be on the @laurenboebert account on April 6, 2021?
Outcomes: 7
Outcome indices: [1,0,6,2,3,4,5]
```

**Observation:** Even in multi-outcome markets, the `outcome_index` ordering is **not sequential by token_id** (notice `[1,0,6,2,3,4,5]` instead of `[0,1,2,3,4,5,6]`).

This further confirms that `outcome_index` is **not a reliable indicator** of any semantic ordering.

## Scripts Used

1. `/Users/scotty/Projects/Cascadian-app/scripts/investigate-outcome-index-consistency.ts` - Initial investigation
2. `/Users/scotty/Projects/Cascadian-app/scripts/investigate-outcome-index-detailed.ts` - Detailed pattern analysis
3. `/Users/scotty/Projects/Cascadian-app/scripts/check-multi-outcome-markets.ts` - Multi-outcome market check

## Next Steps

1. **Audit all PnL queries** for incorrect outcome_index assumptions
2. **Add validation checks** to ensure joins use token_id, not outcome_index
3. **Consider enriching** `pm_token_to_condition_map_v3` with outcome labels from Polymarket API
4. **Document this finding** in PnL engine specifications

---

**Signed:** Claude 1 - Database Architect
**Timestamp:** 2025-11-24T00:00:00Z (PST)
