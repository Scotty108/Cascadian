# Executive Summary: PnL Coverage Analysis

## Bottom Line

**TRUE Coverage: 83.2%** (not 94.17%)
**Status**: ⚠️ BELOW 95% threshold by 11.8 percentage points
**Missing**: 41,343 condition IDs (16.8% of traded markets)

---

## What We Discovered

### 1. The 94.17% Was a Measurement Error

The initial G_traded measurement of 94.17% was **artificially inflated** by three bugs:

1. **Format Duplicates**: Same market counted twice as "token_123..." and "0xABC..."
2. **UNION ALL Without Dedup**: 182,990 CIDs counted twice (once from each source table)
3. **Missing Normalization**: 333,660 token_ rows from trades_raw_enriched_final not normalized

**Impact**: Denominator was 411,673 instead of true 246,023 (40.2% inflation)

### 2. The Real Gap is 16.8%

After fixing all normalization issues:

| Metric | Count | Percentage |
|--------|-------|------------|
| Traded markets (normalized) | 246,023 | 100% |
| In fact_trades_clean | 204,680 | 83.2% |
| **Missing from FACT** | **41,343** | **16.8%** |

### 3. Root Cause Analysis

**Finding**: fact_trades_clean was built from vw_trades_canonical but only captured **89.84%** of it.

**Missing CIDs Breakdown**:
- **23,158 CIDs** from vw_trades_canonical (filtered out during fact_trades build)
- **18,185 CIDs** from trades_raw_enriched_final (not in vwc)

**Data Source Type**: **100% of missing CIDs are NOT in trades_raw**
- This is NOT a pipeline bug
- This is a DATA SOURCE incompleteness issue
- The enriched tables have markets that the raw table never ingested

---

## What the Missing Markets Are

**Top 20 Missing Markets by Volume**:
1. `0x000000000000000048d3f7319281153c...` → **6,945 transactions**
2. `0x000000000000000022a354d1b40c4d6b...` → **5,044 transactions**
3. `0x00000000000000006e4d001cdef4e745...` → **2,005 transactions**
4-20: High-volume markets with 1,847 to 392 transactions each

**Implication**: These are not low-volume edge cases. The missing markets include significant trading activity.

---

## Decision Framework

### Option A: Ship at 83.2% Coverage (NOT RECOMMENDED)
**Pros**:
- Can ship immediately
- 83.2% still covers majority of markets

**Cons**:
- ⚠️ Below 95% threshold
- ⚠️ Missing 16.8% of markets is material (not "acceptable loss")
- ⚠️ Top missing markets have 6,945+ transactions each
- ⚠️ Wallet PnL calculations will be **systematically incomplete**
- ⚠️ Cannot claim "complete wallet performance metrics"

**User Impact**:
- ~17% of wallets will have incomplete PnL
- High-volume traders more likely to be affected
- Metrics (win rate, ROI) will be wrong for affected wallets

### Option B: Rebuild fact_trades_clean from ALL Sources (RECOMMENDED)
**Pros**:
- ✅ Achieve 95%+ coverage target
- ✅ Include all 23,158 missing vw_trades_canonical CIDs
- ✅ Include 18,185 additional CIDs from trades_raw_enriched_final
- ✅ Ship with confidence in data completeness

**Cons**:
- Requires rebuild of fact_trades_clean (estimated 2-4 hours)
- Need to identify WHY 23,158 CIDs were filtered out originally

**Implementation**:
```sql
-- Rebuild fact_trades_clean from vw_trades_canonical + trades_raw_enriched_final
-- Apply proper token_ normalization to both sources
-- Use UNION instead of UNION ALL to deduplicate
-- Verify final coverage ≥95%
```

### Option C: Targeted Backfill (COMPROMISE)
**Pros**:
- Faster than full rebuild
- Focus on high-volume missing markets
- Can incrementally improve coverage

**Cons**:
- Complex to implement (need to identify high-value subset)
- May still miss long-tail markets
- Unclear if can reach 95% threshold

---

## Recommended Next Steps

### Immediate (Next 2 Hours)
1. **Investigate vw_trades_canonical → fact_trades_clean mapping**
   - Why were 23,158 CIDs (10.16%) filtered out?
   - Check build script for WHERE clauses, JOIN conditions
   - Identify if this was intentional or accidental

2. **Assess rebuild feasibility**
   - Estimate runtime for full fact_trades_clean rebuild
   - Check if rebuild can be done without production downtime
   - Verify data quality in trades_raw_enriched_final

### Short Term (Next 1-2 Days)
3. **Execute Rebuild** (if feasible)
   - Create fact_trades_clean_v2 from UNION of:
     - vw_trades_canonical (with token_ normalization)
     - trades_raw_enriched_final (with token_ normalization)
   - Apply DISTINCT deduplication
   - Verify coverage ≥95%

4. **Re-run Gates**
   - Measure new G_traded with corrected denominators
   - Verify improvement to ≥95%
   - Document final coverage

### Final Decision
5. **Ship or No-Ship**
   - ✅ SHIP if G_traded ≥95%
   - ⚠️ DELAY if G_traded <95%
   - 📋 Document known coverage limitations if shipping below 95%

---

## Technical Details

### Normalization Formula Applied
```sql
-- Token format → Hex format
CASE
  WHEN condition_id LIKE 'token_%' THEN
    -- Divide by 256 (CTF encoding: token_id = condition_id << 8 | outcome_index)
    concat('0x', leftPad(
      lower(hex(intDiv(toUInt256(replaceAll(condition_id,'token_','')), 256)))
    , 64, '0'))
  ELSE
    -- Already hex, just normalize
    lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0'))
END
```

### Tables Analyzed
- **market_resolutions_final**: 144,109 resolved markets
- **fact_trades_clean**: 204,680 CIDs (63.4M rows)
- **vw_trades_canonical**: 227,838 normalized CIDs (157M rows)
- **trades_raw_enriched_final**: 201,175 normalized CIDs (166M rows)
- **trades_raw**: 195,025 CIDs (missing 16.8% vs enriched tables)

### Scripts Used
1. `verify-token-decoding.ts` - Proved normalization reduces count by 0 (duplicates)
2. `diagnose-traded-any-sources.ts` - Found 333K token_ rows in tref not normalized
3. `FINAL_CORRECTED_GATES.ts` - Measured true 83.2% coverage
4. `analyze-real-missing-gap.ts` - Identified 100% of missing CIDs not in trades_raw
5. `diagnose-fact-trades-source.ts` - Proved fact built from vwc but only 89.84% captured

---

## Appendix: Measurement Evolution

| Measurement | G_traded | Denominator | Issue |
|-------------|----------|-------------|-------|
| Initial | 94.17% | 411,673 | UNION ALL double-counting |
| After vwc norm | 94.17% | 411,673 | Still missing tref normalization |
| **Final (corrected)** | **83.2%** | **246,023** | All normalization applied |

**Denominator Reduction**: 411,673 → 246,023 (40.2% decrease due to deduplication)

---

**Conclusion**: Cannot ship PnL feature at 83.2% coverage. Rebuild fact_trades_clean from full warehouse data to achieve 95%+ coverage target.
