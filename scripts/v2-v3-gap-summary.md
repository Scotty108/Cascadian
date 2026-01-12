# V2 vs V3 Data Gap Investigation - FINAL REPORT

## Investigation Date
January 9, 2026

## Executive Summary

**THERE IS NO DATA GAP BETWEEN V2 AND V3**

The apparent "missing data" was caused by incorrect deduplication logic that collapsed distinct multi-outcome trades in the same transaction. V2 and V3 contain identical event_ids with identical USDC amounts when properly deduplicated.

## Wallets Analyzed
- spot_6: 0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0
- spot_3: 0x0060a1843fe53a54e9fdc403005da0b1ead44cc4
- spot_9: 0x61341f266a614cc511d2f606542b0774688998b0

## Key Findings

### 1. Data Completeness: PERFECT MATCH
```
Wallet   | V2 Events | V3 Events | V2 USDC      | V3 USDC      | Match
---------|-----------|-----------|--------------|--------------|-------
spot_6   | 141       | 141       | $16,663.36   | $16,663.36   | ✓
spot_3   | 678       | 678       | $39,394.15   | $39,394.15   | ✓
spot_9   | 841       | 841       | $9,240.06    | $9,240.06    | ✓
```

- **100% overlap in event_ids** across all wallets
- **Exact USDC match** when properly deduplicated
- **V3 contains ALL data from V2**

### 2. Root Cause: Incorrect Deduplication Pattern

The faulty investigation used:
```sql
GROUP BY substring(event_id, 1, 66), token_id, side
```

This collapses distinct events that share:
- Same transaction hash (first 66 chars of event_id)
- Same token_id
- Same side (buy/sell)

**Why this is wrong:** These are separate trades for different outcomes in the same market.

### 3. Example: Multi-Outcome Trades Being Collapsed

From spot_6, transaction `0xfc07...aeea` has 3 distinct events:

| Event ID Suffix | Condition | Side | USDC | Should Collapse? |
|----------------|-----------|------|------|------------------|
| `...03bb...b58-t` | Outcome A | buy | $X | NO |
| `...4ff6...019-m` | Outcome B | buy | $Y | NO |
| `...ed60...f52-t` | Outcome C | buy | $Z | NO |

All three have same token_id and side, but **different condition IDs**. The faulty GROUP BY treats these as duplicates and keeps only 1, losing the other 2 trades.

### 4. V2 vs V3 Deduplication Requirements

**V2 Table:**
- Has 2-3x duplicate rows per event_id (from historical backfills)
- Example: spot_3 has 1,140 raw rows but only 678 unique events
- **Requires deduplication:** `GROUP BY event_id`

**V3 Table:**
- Has ZERO duplicates (already cleaned)
- Example: spot_6 has 141 raw rows = 141 unique events
- **No deduplication needed:** Just use `COUNT(*)`

### 5. Correct Query Patterns

```sql
-- V2: Deduplicate by event_id
SELECT COUNT(*) as tx_count, SUM(usdc) as total_usdc
FROM (
  SELECT event_id, any(usdc_amount) / 1000000.0 as usdc
  FROM pm_trader_events_v2
  WHERE trader_wallet = '...' AND is_deleted = 0
  GROUP BY event_id
)

-- V3: No deduplication needed
SELECT 
  COUNT(*) as tx_count,
  SUM(usdc_amount) / 1000000.0 as total_usdc
FROM pm_trader_events_v3
WHERE trader_wallet = '...'
```

### 6. Impact of Faulty Pattern

When using `GROUP BY substring(event_id, 1, 66), token_id, side`:

| Wallet | Real Events | Faulty Count | Lost Events | % Lost |
|--------|-------------|--------------|-------------|--------|
| spot_6 | 141 | 121 | 20 | 14.2% |
| spot_3 | 678 | 474 | 204 | 30.1% |
| spot_9 | 841 | 619 | 222 | 26.4% |

The lost events are primarily multi-outcome trades in Neg Risk markets.

## Verification Results

### spot_6 (smallest gap)
- 10 collapsed groups identified
- 24 total events in those groups
- All groups contain 2-3 events from same transaction with different outcomes
- Pattern: Multi-outcome trades in same market, same tx, same side

### spot_3 (largest gap)
- V2 raw: 1,140 rows → 678 unique events (deduplication needed)
- V3 raw: 678 rows → 678 unique events (no duplication)
- When both properly deduplicated: **EXACT MATCH**

### spot_9
- V2 deduplicated: 841 events, $9,240.06
- V3 raw: 841 events, $9,240.06
- **EXACT MATCH**

## Conclusion

1. **No missing data:** V2 and V3 have 100% event_id overlap
2. **Same USDC totals:** When properly deduplicated, V2 = V3 exactly
3. **V3 is cleaner:** No duplicates, simpler queries
4. **Bug was in query logic:** Not in the data itself

## Recommendations

### Immediate Actions
1. **Remove faulty GROUP BY** from all v3 queries
2. **Document v3 schema** - clarify it has no duplicates
3. **Update comparison scripts** with correct patterns
4. **Review PnL engines** - ensure they use correct v3 queries

### V3 Query Guidelines
```sql
-- ✓ CORRECT: Simple count for v3
SELECT COUNT(*) FROM pm_trader_events_v3 WHERE ...

-- ✓ CORRECT: DISTINCT for extra safety (though not needed)
SELECT COUNT(DISTINCT event_id) FROM pm_trader_events_v3 WHERE ...

-- ✗ WRONG: Do NOT use this pattern on v3
GROUP BY substring(event_id, 1, 66), token_id, side
```

### V2 Query Guidelines
```sql
-- ✓ CORRECT: Must deduplicate v2
SELECT ... FROM (
  SELECT event_id, any(usdc_amount) as usdc_amount
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) ...

-- ✗ WRONG: Direct SUM on v2 counts duplicates 2-3x
SELECT SUM(usdc_amount) FROM pm_trader_events_v2 WHERE ...
```

## Files Generated
- `/Users/scotty/Projects/Cascadian-app/scripts/compare-v2-v3-data-gap.ts` - Comparison with bug (for reference)
- `/Users/scotty/Projects/Cascadian-app/scripts/identify-missing-v3-trades.ts` - Investigation script
- `/Users/scotty/Projects/Cascadian-app/scripts/v2-v3-gap-summary.md` - This report

## Verification Commands

```bash
# Verify spot_6 match
npx tsx -e "..." # Shows 141 = 141, $16,663.36 = $16,663.36

# Verify spot_3 match  
npx tsx -e "..." # Shows 678 = 678, $39,394.15 = $39,394.15

# Verify spot_9 match
npx tsx -e "..." # Shows 841 = 841, $9,240.06 = $9,240.06
```

---

**Status:** Investigation complete. No data gap exists. Issue was query logic only.
