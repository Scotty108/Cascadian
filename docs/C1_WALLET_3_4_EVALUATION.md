# Wallet #3 and #4 Evaluation - Borderline Overlap Analysis

**Date:** November 16, 2025 (PST)
**Agent:** C1 (Database Agent)
**Task:** Re-evaluate wallets #3 and #4 with tighter overlap threshold

---

## Current Overlap Analysis

### Wallet #3: `0xed88d69d689f3e2f6d1f77b2e35d089c581df3c4`
- **Volume:** $192M (Rank #3 in collision wallets)
- **TX Overlap:** 60.39% with XCN executor
- **Shared Transactions:** 7,949 out of 13,161 total
- **Candidate Account:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (same as XCN)

### Wallet #4: `0x53757615de1c42b83f893b79d4241a009dc2aeea`
- **Volume:** $116M (Rank #4 in collision wallets)
- **TX Overlap:** 83.74% with XCN executor
- **Shared Transactions:** 125,790 out of 150,210 total
- **Candidate Account:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (same as XCN)

---

## Validation Threshold

**Established Standard:** ≥95% TX overlap = validated mapping
**Proven Results:**
- Wallet #1 (XCN): 99.8% → Validated ✅
- Wallet #2: 98.26% → Validated ✅
- Wallet #5: 97.62% → Validated ✅
- Wallet #6: 100% → Validated ✅

---

## Evaluation Against 95% Threshold

### Wallet #3: **DOES NOT MEET** ✗
- Current overlap: 60.39%
- Gap to threshold: **34.61 percentage points**
- Shared TX count: 7,949 (substantial but not conclusive)

**Possible Explanations for Lower Overlap:**
1. Wallet #3 may be used for different purposes (not pure proxy)
2. May be operated by different entity with occasional collaboration
3. May have independent trading activity alongside shared transactions
4. Data quality issues in transaction mapping

### Wallet #4: **DOES NOT MEET** ✗
- Current overlap: 83.74%
- Gap to threshold: **11.26 percentage points**
- Shared TX count: 125,790 (very high absolute count)

**Note:** Wallet #4 is close to threshold (83.74%) and has extremely high shared transaction count, but still falls short of the 95% validation standard.

---

## Recommendation

### Wallet #3: **NEEDS MORE EVIDENCE** ⚠️
- 60.39% overlap is too low for automated mapping
- Requires manual investigation:
  - Sample transaction review
  - Temporal pattern analysis (is overlap increasing/decreasing over time?)
  - Cross-reference with other data sources
  - Identify if wallet has dual purpose (trading + other activity)

**Action:** Mark as "pending manual review" - do not stage INSERT

### Wallet #4: **NEEDS MORE EVIDENCE** ⚠️
- 83.74% overlap is borderline but below threshold
- High shared transaction count (125,790) is suggestive but not conclusive
- Requires additional validation:
  - Temporal analysis - is overlap consistent across time periods?
  - Sample validation - verify co-occurrence in actual transaction data
  - Check for systematic offset (e.g., wallet #4 has 24,420 non-shared txs - what are these?)

**Action:** Mark as "pending additional analysis" - do not stage INSERT

---

## Alternative Validation Approaches

If manual validation is desired for wallet #4 (closer to threshold):

### Option A: Temporal Window Analysis
```sql
-- Check if overlap is higher in recent months
WITH executor_txs AS (
  SELECT DISTINCT transaction_hash, toYYYYMM(block_timestamp) AS month
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) = '0x53757615de1c42b83f893b79d4241a009dc2aeea'
)
SELECT
  month,
  count(DISTINCT e.transaction_hash) AS total_tx,
  countIf(w4.transaction_hash IS NOT NULL) AS shared_tx,
  round(shared_tx / total_tx * 100, 2) AS overlap_pct
FROM executor_txs e
LEFT JOIN (
  SELECT DISTINCT transaction_hash
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
) w4 ON e.transaction_hash = w4.transaction_hash
GROUP BY month
ORDER BY month DESC
LIMIT 12;
```

### Option B: Sample Transaction Verification
Manually inspect 20 random shared transactions to verify both wallets truly co-occur.

### Option C: Volume-Weighted Overlap
Check if the 83.74% shared transactions represent >95% of total volume (high-value txs may be shared, low-value independent).

---

## Decision

**Following strict 95% threshold:**
- ❌ Wallet #3: Do NOT stage INSERT (60.39% << 95%)
- ❌ Wallet #4: Do NOT stage INSERT (83.74% < 95%)

**Status:** Both wallets marked as **"NEEDS MORE EVIDENCE"**

---

## Next Steps

1. **Do NOT persist mappings** for wallets #3 or #4 at this time
2. **Document borderline cases** for future manual review
3. **Proceed with discovering wallets #7-20** using proven methodology
4. **Re-evaluate wallet #4** if additional evidence emerges (e.g., temporal analysis shows >95% recent overlap)

---

## Files Updated

- Added to pending review list: Wallets #3 and #4
- Created evaluation documentation: `docs/C1_WALLET_3_4_EVALUATION.md`

---

**Evaluation Complete**
**Result:** Both wallets fail ≥95% threshold - marked as "needs more evidence"
**Recommended Action:** Move to discovering additional collision wallets (#7-20)

---

**Signed:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
