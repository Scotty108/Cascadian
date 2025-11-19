# xcnstrategy Wallet Coverage Analysis Report
**Generated:** 2025-11-16 (PST)
**Wallet:** 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b (EOA)

---

## Executive Summary

The xcnstrategy wallet currently has **77.69% coverage** for condition_id mapping in the V3 canonical trades table. This represents 606 out of 780 trades successfully mapped, with 174 orphan trades requiring attention.

**Key Findings:**
- ✅ **Volume Coverage:** 79.73% ($626,172.08 / $785,412.45)
- ⚠️ **Gap:** 174 orphan trades worth $159,240.37
- ⚠️ **V4 Regression:** V4 preview shows only 41.36% coverage (significant regression)
- 📈 **Trend:** Coverage varies significantly by month (0% to 100%)

---

## Coverage Breakdown

### V3 Canonical Trades (Current Production)
| Metric | Value |
|--------|-------|
| Total Trades | 780 |
| Trades with Valid CID | 606 (77.69%) |
| Orphan Trades | 174 (22.31%) |
| Total Volume | $785,412.45 |
| Covered Volume | $626,172.08 (79.73%) |
| Orphan Volume | $159,240.37 (20.27%) |

**Status:** 🟡 Partial Coverage - Action Required

### V4 Preview (Development)
| Metric | Value |
|--------|-------|
| Total Trades | 781 |
| Trades with Valid CID | 323 (41.36%) |
| Coverage Change vs V3 | -36.33% ⚠️ **REGRESSION** |

**Status:** 🔴 Critical Issue - V4 is worse than V3

---

## Monthly Coverage Trend

| Month | Trades | Covered | Coverage % |
|-------|--------|---------|------------|
| 2025-10 | 15 | 3 | 20.00% 🔴 |
| 2025-09 | 24 | 24 | 100.00% ✅ |
| 2025-08 | 69 | 47 | 68.12% 🟡 |
| 2025-07 | 73 | 53 | 72.60% 🟡 |
| 2025-06 | 63 | 48 | 76.19% 🟡 |
| 2025-05 | 56 | 43 | 76.79% 🟡 |
| 2025-04 | 122 | 102 | 83.61% 🟢 |
| 2025-03 | 60 | 48 | 80.00% 🟢 |
| 2025-02 | 38 | 32 | 84.21% 🟢 |
| 2025-01 | 91 | 64 | 70.33% 🟡 |
| 2024-12 | 4 | 0 | 0.00% 🔴 |
| 2024-11 | 25 | 23 | 92.00% ✅ |

**Observations:**
- Perfect coverage (100%) in September 2025
- Severe degradation in October 2025 (20%)
- Zero coverage in December 2024
- Generally stable 70-85% range in Q1-Q2 2025

---

## Critical Issues

### 1. V4 Regression (-36.33%)
The V4 preview table shows **significantly worse** coverage than V3:
- **V3:** 77.69% coverage (606/780 trades)
- **V4:** 41.36% coverage (323/781 trades)
- **Loss:** 283 trades lost mapping

**Impact:** DO NOT deploy V4 without investigating this regression.

### 2. Recent Coverage Degradation (October 2025)
October 2025 shows only 20% coverage (3/15 trades), suggesting:
- Recent data ingestion issues
- New market types not mapped
- Pipeline configuration changes

### 3. Historical Gap (December 2024)
Complete absence of coverage (0/4 trades) in December 2024 suggests:
- Data quality issues in that period
- Market types not yet supported
- Potential backfill gap

---

## Recommended Actions

### Immediate (This Week)
1. **Investigate V4 Regression**
   - Identify why V4 has worse coverage than V3
   - Root cause: Changed join logic, missing bridge tables, or data format issues?
   - **Do not deploy V4 to production until resolved**

2. **Fix October 2025 Coverage**
   - Analyze the 12 orphan trades from October
   - Identify missing market/condition mappings
   - Backfill condition_id values

3. **Audit December 2024**
   - Review the 4 trades with zero coverage
   - Determine if markets are resolvable or ghost markets

### Short Term (Next 2 Weeks)
4. **Systematic Orphan Resolution**
   - Process all 174 orphan trades
   - Categorize by:
     - Missing from bridge tables
     - Invalid token IDs
     - Truly unmappable (ghost markets)
   - Backfill valid mappings

5. **Coverage Validation**
   - Run comprehensive reconciliation against Polymarket API
   - Verify xcnstrategy positions match external sources
   - Document coverage expectations by market type

### Long Term (Next Month)
6. **V4 Stabilization**
   - Fix V4 regression before any migration
   - Establish V4 >= V3 coverage as deployment gate
   - Add automated coverage regression tests

7. **Monitoring & Alerts**
   - Set up alerts for coverage drops below 75%
   - Track coverage metrics by wallet cohort
   - Monthly coverage health reports

---

## Data Quality Notes

### Strengths
- Core trading months (Q1-Q2 2025) maintain 70-85% coverage
- High-value trades appear well-covered (79.73% volume coverage)
- September 2025 achieved perfect 100% coverage

### Weaknesses
- Inconsistent coverage across time periods
- Recent degradation in October 2025
- V4 regression indicates breaking changes
- No established baseline for acceptable coverage

### Missing Coverage Analysis
The 174 orphan trades ($159,240.37) likely fall into these categories:
1. **External/AMM trades:** Trades from non-CLOB sources lacking bridge mappings
2. **Ghost markets:** Unlisted markets without condition_id metadata
3. **Format mismatches:** Token IDs that don't decode to valid condition_ids
4. **Temporal gaps:** Historical markets missing from ingestion windows

---

## Next Steps for P&L Calculation

Before proceeding with P&L calculation for xcnstrategy:

1. ✅ **Accept 77.69% coverage** as baseline
   - Document known gaps
   - Proceed with available 606 trades
   - Flag P&L as "preliminary" until gaps filled

2. ⚠️ **OR investigate orphans first**
   - Analyze 174 orphan trades
   - Attempt to resolve mappings
   - Target 90%+ coverage before P&L calculation

**Recommendation:** Start P&L with current 77.69% coverage, but clearly document:
- Which trades are excluded (the 174 orphans)
- Estimated impact on P&L accuracy
- Plan to backfill missing mappings

---

## Technical Details

**Query Source Table:** `pm_trades_canonical_v3`
**Condition ID Field:** `condition_id_norm_v3`
**Validation:** 64-character lowercase hex strings
**Database:** ClickHouse (default database)

**Query Timestamp:** 2025-11-16 PST

---

## Conclusion

The xcnstrategy wallet has **good but imperfect coverage** (77.69%) in the V3 canonical trades table. The data quality is sufficient to begin P&L calculation with documented limitations. However, the **V4 regression is critical** and must be resolved before any V4 deployment.

**Overall Assessment:** 🟡 PROCEED WITH CAUTION
- P&L calculation: OK to start with V3 data
- V4 deployment: BLOCKED until regression fixed
- Coverage improvement: Recommended but not blocking
