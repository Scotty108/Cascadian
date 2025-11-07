# Evidence Audit: The "$99,691 Offset Fix" Claims

**Date:** 2025-11-07
**Auditor:** Vector search investigation + actual execution testing
**Verdict:** ❌ **ZERO EVIDENCE OF ACTUAL EXECUTION**

---

## Executive Summary

**Finding:** The codebase contains 60+ references to "$99,691.54" as the result of an "offset fix" that produces "-2.3% variance" from the expected $102,001.46. However:

1. ✅ **File created dates:** All documents claiming this result were created TODAY (Nov 7, 2025)
2. ❌ **Actual execution:** When executed NOW, `test-with-corrected-offset.ts` produces $3.69M (not $99,691)
3. ❌ **Git history:** Zero commits showing actual execution logs or output with $99,691
4. ❌ **Phase 1A diagnostic:** Identifies 98.38% of trades as `trade_idx = win_idx + 1` (opposite pattern claimed)
5. ❌ **Test with actual pattern:** Produces -$1.9M (negative, still wrong)

**Conclusion:** The "$99,691" result appears to be **theoretical/calculated manually** rather than produced by actually running any code.

---

## Evidence Chain Analysis

### 1. File Creation Timestamps

```bash
2025-11-07 11:11  COMPREHENSIVE_PNL_FIX_REPORT.md      ← Claims "Result: $99,691"
2025-11-07 10:40  test-with-corrected-offset.ts        ← Test file claiming to prove it
2025-11-07 08:07  VERIFIED_CORRECT_PNL_APPROACH.md     ← Claims "-2.3% variance"
```

**Finding:** All key documents were created in the SAME SESSION (within 3 hours of each other). This suggests they were written together based on a hypothesis, not empirical testing over time.

---

### 2. Actual Execution Results (Nov 7, 2025 19:14 UTC)

#### Test 1: `test-with-corrected-offset.ts` (as written in docs)

**Query:** `tf.trade_idx = wi.win_idx - 1`

```
0xeb6f0a13ea...  (niggemon)
  P&L: $3,690,572.07
  Expected: $102,001
  Variance: 3518.17%
  ❌ FAIL

0xa4b366ad22...  (holymoses)
  P&L: $532,145.36
  Expected: $89,975
  Variance: 491.44%
  ❌ FAIL
```

**Verdict:** Not $99,691. Off by 37x.

---

#### Test 2: Phase 1A Diagnostic (Empirical Pattern Discovery)

**Actual data distribution:**
```
Total rows tested:                       78,714,021
Exact matches (trade_idx = win_idx):     1,273,009   (1.62%)
Off by +1 (trade_idx = win_idx + 1):     77,441,012  (98.38%)  ← ACTUAL PATTERN
Off by -1 (trade_idx + 1 = win_idx):     0           (0.00%)
```

**Finding:** The real data shows `trade_idx = win_idx + 1` in 98.38% of cases. This is the OPPOSITE of what the documents claim (win_idx - 1).

---

#### Test 3: Using Actual Pattern (trade_idx = win_idx + 1)

```
0xeb6f0a13ea...  (niggemon)
  P&L: -$1,899,180.94
  Expected: $102,001
  Variance: -1961.92%
  ❌ FAIL
```

**Verdict:** Negative value, still wrong magnitude. The offset pattern discovered by Phase 1A diagnostic does NOT produce correct results.

---

### 3. Document Claims vs. Reality

#### Claim 1: "test-with-corrected-offset.ts produced $99,691"

**Source:** COMPREHENSIVE_PNL_FIX_REPORT.md line 260
> "Result: niggemon validated to -2.3% with offset = -1"

**Reality:**
- File created: 2025-11-07 10:40
- Executed: 2025-11-07 19:14 (9 hours later)
- Actual result: $3,690,572.07 (not $99,691)

**Verdict:** ❌ FALSE - Never produced claimed result

---

#### Claim 2: "Phase 1B tested the offset and confirmed it works"

**Source:** COMPREHENSIVE_PNL_FIX_REPORT.md line 257-261
> "Phase 1B: Formula was tested with offset
> File: test-with-corrected-offset.ts
> Result: niggemon validated to -2.3% with offset = -1"

**Reality:**
- Phase 1A diagnostic exists and runs successfully
- No "Phase 1B" file exists in codebase
- Phase 1A shows OPPOSITE offset pattern (trade_idx = win_idx + 1, not -1)

**Verdict:** ❌ FALSE - Phase 1B never executed

---

#### Claim 3: "The -2.3% variance is well-documented and proven"

**Source:** 60+ references across markdown files

**Sample claims:**
- PNL_PIPELINE_FIRST_PRINCIPLES_ANALYSIS.md: "niggemon: Expected $102,001.46 → Got $99,691.54 (-2.3% variance) ✅"
- VERIFIED_CORRECT_PNL_APPROACH.md: "Calculated (formula): $99,691.54, Variance: -2.3% ✅ EXCELLENT"
- COMPREHENSIVE_PNL_FIX_REPORT.md: "Expected Result: niggemon: $99,691 → $101,949 match (±2.3% variance - CORRECT)"

**Reality:**
- All files created on same date (2025-11-07)
- Zero execution logs in git history
- No .log files containing "99691"
- Actual execution produces 3518% variance (not -2.3%)

**Verdict:** ❌ FALSE - No empirical evidence

---

### 4. The "18.7 rows per condition" Claim

**Source:** COMPREHENSIVE_PNL_FIX_REPORT.md line 13
> "Pre-aggregation Duplication (SECONDARY) - trade_cashflows_v3 has 18.7 rows per condition"

**Search results:** 1 match in entire codebase (only in this document)

**Verdict:** ❌ UNVERIFIED - No other reference or calculation shown

---

### 5. Git History Audit

**Commands run:**
```bash
git log --all --oneline --grep="99691" -n 20
# Output: (empty)

git log --all --patch --grep="offset" --since="2025-11-01"
# Output: (no relevant commits)

git log --all -- test-with-corrected-offset.ts
# Output: (empty - file never committed)
```

**Verdict:** ❌ NO HISTORY - Files are untracked/uncommitted

---

## Origin of the "$99,691" Number

### Hypothesis: Manual Calculation from Expected Components

Looking at CORRECT_PNL_CALCULATION_ANALYSIS.md line 508:

```
│      -195687.76  │      297637.31 │   99691.54 │         8234 │            137 │
```

This shows:
- Realized losses: -$195,687.76
- Realized gains: +$297,637.31
- **Total: $99,691.54** ← Exact match to claimed result

**Finding:** This table shows EXPECTED values (not query results). The line says "Expected Output" (line 504), meaning this was the TARGET calculation, not an actual database query result.

**Conclusion:** Someone calculated $297,637.31 - $195,687.76 = $99,691.54 manually and documented it as the "expected" result if the formula were correct. Then this number propagated through 60+ documents as if it were an actual test result.

---

## Why the Confusion Happened

### Pattern: Documentation Drift

1. **Day 1 (Morning):** Someone theorized the offset fix should produce ~$99,691
2. **Day 1 (Midday):** Created test file `test-with-corrected-offset.ts` to test hypothesis
3. **Day 1 (Afternoon):** Wrote documentation BEFORE running tests, assuming hypothesis was correct
4. **Day 1 (Evening):** Actual execution shows $3.69M (37x off), but docs already written

### Evidence of Documentation-First Approach

All these files created within 3-hour window:
- 08:07 - VERIFIED_CORRECT_PNL_APPROACH.md (claims -2.3% variance)
- 10:40 - test-with-corrected-offset.ts (test file)
- 11:11 - COMPREHENSIVE_PNL_FIX_REPORT.md (claims "proven with test file")

**Pattern:** Documentation → Test File → Never Actually Run

---

## What Actually Works?

### Known Facts

1. ✅ **Phase 1A diagnostic runs successfully** and shows real data distribution
2. ✅ **98.38% of trades have pattern:** `trade_idx = win_idx + 1`
3. ❌ **Applying this pattern produces:** -$1.9M (wrong sign, wrong magnitude)
4. ❌ **The claimed pattern (win_idx - 1) produces:** $3.69M (wrong magnitude)

### Implication

**Both offset patterns are wrong.** The issue is likely NOT a simple offset, but rather:
- Wrong table being queried (trade_flows_v2 may have pre-aggregation issues)
- Wrong join pattern (canonical_condition join may cause fanout)
- Missing filters (should filter to specific market states)
- Fundamental formula error (settlement calculation may be conceptually wrong)

---

## Recommendations

### For User

1. ✅ **Ignore all "-2.3% variance" claims** - Not empirically proven
2. ✅ **Ignore "$99,691" as a target** - This is a manually calculated expectation, not a test result
3. ❌ **Do NOT implement the "offset fix"** - Both offset directions produce wrong results
4. ⚠️  **Trust only executed queries** - Demand actual console output, not documentation claims

### For Investigation

**Next steps to find root cause:**

1. **Verify expected values first:**
   - Query Polymarket API directly for niggemon's actual P&L
   - Confirm the $102,001.46 target is current (not stale)
   - Understand what's included (realized only? realized + unrealized?)

2. **Test formula components separately:**
   - Test ONLY cashflows (without settlement)
   - Test ONLY settlement (without cashflows)
   - Verify each produces reasonable magnitude

3. **Check for fanout:**
   - Count rows before/after canonical_condition join
   - Measure join cardinality (1:1, 1:many, many:many?)

4. **Simplify to single market:**
   - Pick ONE resolved market niggemon traded
   - Calculate P&L manually for that market
   - Compare to query result
   - Identify where divergence occurs

---

## Key Takeaways

### What We Know for Certain

1. ✅ `test-with-corrected-offset.ts` produces $3.69M when executed (not $99,691)
2. ✅ Phase 1A diagnostic shows 98.38% of trades have `trade_idx = win_idx + 1` pattern
3. ✅ Applying Phase 1A pattern produces -$1.9M (still wrong)
4. ✅ All documents claiming $99,691 were created on same date (2025-11-07)
5. ✅ Zero git commits show actual execution logs with $99,691 result

### What We Know is False

1. ❌ "test-with-corrected-offset.ts validated to -2.3%" - Never happened
2. ❌ "Phase 1B tested and confirmed the offset" - Phase 1B doesn't exist
3. ❌ "60+ documents prove the formula works" - All cite each other, no primary evidence
4. ❌ "The offset fix produces $99,691" - Produces $3.69M when executed

### The Real Problem

**The offset hypothesis is a red herring.** The real issues are:
- Pre-aggregation in source tables (trade_flows_v2 may be corrupted)
- Join fanout (canonical_condition join may duplicate rows)
- Formula design (settlement calculation may be conceptually wrong)

**Start from first principles:** Ignore all existing documentation. Query `trades_raw` directly. Calculate one market. Build from there.

---

## Appendix: Execution Logs

### Log 1: test-with-corrected-offset.ts (Nov 7, 2025 19:14:25 UTC)

```
════════════════════════════════════════════════════════════════
TESTING: With corrected offset (trade_idx = win_idx - 1)
════════════════════════════════════════════════════════════════

0xa4b366ad22...
  P&L: $532145.36
  Expected: $89,975 | Variance: 491.44%
  ❌ FAIL

0xeb6f0a13ea...
  P&L: $3690572.07
  Expected: $102,001 | Variance: 3518.17%
  ❌ FAIL
```

### Log 2: phase-1a-index-offset-diagnostic.ts (Nov 7, 2025 19:14:00 UTC)

```
════════════════════════════════════════════════════════════════
PHASE 1A: INDEX OFFSET DIAGNOSTIC
════════════════════════════════════════════════════════════════

RESULTS:
──────────────────────────────────────────────────────────────────────
Total rows tested:                       78,714,021
Unresolved (win_idx IS NULL):            0 (0.00%)
Exact matches (trade_idx = win_idx):     1,273,009 (1.62%)
Off by +1 (trade_idx = win_idx + 1):     77,441,012 (98.38%)
Off by -1 (trade_idx + 1 = win_idx):     0 (0.00%)

⚠️  CASE 2: Off by +1 (trade_idx = win_idx + 1)
   98.38% of trades are off by +1
   trade_idx is 1 position ahead of win_idx
   Fix: Use `tf.trade_idx = wi.win_idx + 1` in settlement join
```

### Log 3: test-ACTUAL-offset-pattern.ts (Nov 7, 2025 19:14:35 UTC)

```
════════════════════════════════════════════════════════════════
TESTING: With ACTUAL offset pattern (trade_idx = win_idx + 1)
Based on Phase 1A diagnostic: 98.38% of trades match this pattern
════════════════════════════════════════════════════════════════

RESULTS:

0xa4b366ad22...
  P&L: $-581516.86
  Expected: $89,975 | Variance: -746.31%
  ❌ FAIL

0xeb6f0a13ea...
  P&L: $-1899180.94
  Expected: $102,001 | Variance: -1961.92%
  ❌ FAIL
```

---

**End of Evidence Audit**

**Summary:** Zero empirical evidence supports the "$99,691 offset fix" claims. All documentation appears to be written based on theoretical calculations, not actual test execution. The actual pattern discovered (trade_idx = win_idx + 1) produces negative values, suggesting the problem is deeper than a simple offset.
