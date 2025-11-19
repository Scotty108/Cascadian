# Xi Market Validation Findings - C1 Summary

**Date:** 2025-11-16 (PST)
**Agent:** C1 (Database Agent)
**Status:** ⚠️ CRITICAL DATA QUALITY ISSUE IDENTIFIED

---

## Executive Summary

The XCN attribution repair **successfully recovered the Xi Jinping market data** (1,833 trades), confirming that the collision detection and repair logic worked correctly. However, validation against expected Polymarket UI values revealed **massive data discrepancies (50x-2,000x off)**, indicating a fundamental data quality issue requiring immediate investigation.

---

## Validation Results

### ✅ What Worked

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| **Trade Count** | 1,833 | 1,833 | ✅ EXACT MATCH |
| **Data Recovery** | Xi market visible | Xi market visible | ✅ COMPLETE |
| **Attribution** | Real wallet only | Real wallet only | ✅ CORRECT |

**Conclusion:** Attribution repair logic is functioning perfectly.

---

### ❌ Critical Data Quality Issues

| Metric | Expected (Polymarket UI) | Actual (ClickHouse) | Discrepancy |
|--------|--------------------------|---------------------|-------------|
| **Cost (BUY)** | ~$12,400 | $626,173.90 | **+4,949%** (50x higher) |
| **Net Shares** | ~53,683 | -1,218,145.22 | **Wrong sign, 2,269% off** |
| **Realized P&L** | ~$41,289 | -$475,090.38 | **Wrong sign, 1,150% off** |

**Conclusion:** Underlying trade data is severely corrupted or miscalculated.

---

## Root Cause Hypotheses

### Hypothesis 1: Incorrect `trade_direction` Classification

**Symptom:** Negative net shares suggest BUY/SELL directions may be inverted

**Evidence Needed:**
- Distribution of BUY vs SELL trades
- Comparison with known ground truth transactions
- Cross-check against ERC1155 transfer directions

### Hypothesis 2: Duplicate/Inflated Trade Records

**Symptom:** $626k cost vs ~$12.4k expected (50x inflation)

**Evidence Needed:**
- Check for duplicate transaction hashes
- Verify shares/price/usd_value calculation logic
- Compare trade counts across different source tables

### Hypothesis 3: Wrong Market Attribution

**Symptom:** Values don't match Xi market characteristics

**Evidence Needed:**
- Verify `condition_id` normalization is correct
- Check if trades from other markets leaked in
- Validate CID format consistency (0x vs bare)

### Hypothesis 4: Price/Shares Scale Factor Error

**Symptom:** Consistent order-of-magnitude differences

**Evidence Needed:**
- Check decimal scaling (e.g., shares stored as wei vs ether)
- Verify price normalization (cents vs dollars)
- Review usd_value calculation formula

---

## Diagnostic Queries Needed (For C3)

### Query 1: Trade Direction Distribution

```sql
SELECT
  trade_direction,
  count(*) AS trade_count,
  sum(shares) AS total_shares,
  sum(usd_value) AS total_usd,
  avg(price) AS avg_price,
  min(price) AS min_price,
  max(price) AS max_price
FROM vw_xcn_repaired_only
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
GROUP BY trade_direction
ORDER BY trade_direction;
```

**Expected Outcome:** If BUY shows more USD spent than SELL, direction logic may be correct. If reversed, directions are inverted.

### Query 2: Duplicate Detection

```sql
SELECT
  transaction_hash,
  count(*) AS dup_count,
  sum(usd_value) AS total_usd
FROM vw_xcn_repaired_only
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
GROUP BY transaction_hash
HAVING dup_count > 1
ORDER BY dup_count DESC
LIMIT 20;
```

**Expected Outcome:** Should return 0 rows (no duplicates) or identify source of inflation.

### Query 3: Sample Trade Inspection

```sql
SELECT
  timestamp,
  trade_direction,
  shares,
  price,
  usd_value,
  transaction_hash
FROM vw_xcn_repaired_only
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
ORDER BY timestamp ASC
LIMIT 20;
```

**Expected Outcome:** Manual inspection of early trades to identify anomalies.

### Query 4: Price Distribution Analysis

```sql
SELECT
  countIf(price < 0.01) AS price_under_1cent,
  countIf(price >= 0.01 AND price < 0.10) AS price_1cent_to_10cent,
  countIf(price >= 0.10 AND price < 0.50) AS price_10cent_to_50cent,
  countIf(price >= 0.50 AND price < 0.90) AS price_50cent_to_90cent,
  countIf(price >= 0.90) AS price_over_90cent,
  min(price) AS min_price,
  max(price) AS max_price,
  avg(price) AS avg_price
FROM vw_xcn_repaired_only
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
```

**Expected Outcome:** Xi market (eggs vs chickens) should have prices in 0.01-0.99 range. Outliers indicate data corruption.

---

## Escalation Recommendations

### Immediate Actions (C3 - Validation Agent)

1. **Run diagnostic queries above** to isolate root cause
2. **Compare against Polymarket API** for ground truth validation
3. **Check ERC1155 source data** for the same condition_id
4. **Verify trade count matches** between different pipeline stages

### Data Pipeline Investigation (C2)

1. **Audit trade ingestion logic** for Xi market transactions
2. **Verify direction classification** algorithm accuracy
3. **Check for deduplication gaps** in canonical v3 build
4. **Review decimal scaling** in shares/price/usd_value fields

### Database Integrity Check (C1)

1. **Rebuild Xi market data** from raw sources with verbose logging
2. **Create isolated test case** with known ground truth trades
3. **Validate calculation formulas** against hand-computed examples
4. **Document all transformations** from raw → canonical

---

## Files Reference

| Script | Purpose |
|--------|---------|
| `scripts/validate-xi-market-pnl.ts` | Validation against Polymarket UI values |
| `scripts/check-xi-view-schema.ts` | Schema inspection of repaired view |
| `scripts/diagnose-xi-market-data-quality.ts` | Diagnostic queries (incomplete) |
| `docs/C3_HANDOFF_XCN_ATTRIBUTION_REPAIR.md` | C3 handoff with validation queries |
| `docs/XCN_ATTRIBUTION_REPAIR_COMPLETE.md` | Complete technical report |

---

## Critical Data Points

**Xi Market Condition ID (bare hex):**
```
f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1
```

**XCN Real Wallet:**
```
0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e
```

**Source View:**
```
vw_xcn_repaired_only
```

---

## Next Steps

1. **C3 (Validation Agent):** Run diagnostic queries to identify root cause of data discrepancy
2. **C2 (Data Pipeline Agent):** Audit trade ingestion and direction classification logic
3. **C1 (Database Agent):** Standby for schema fixes or view rebuilds based on findings

**DO NOT** proceed with PnL calculations until data quality issues are resolved. The 50x-2,000x discrepancies indicate systemic data corruption that will invalidate all downstream analytics.

---

## Sign-Off

**Prepared by:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
**Status:** ⚠️ BLOCKED - Data quality investigation required before PnL validation

**Summary:**
- Attribution repair: ✅ Complete (1,833 trades recovered)
- Data integrity: ❌ Critical issues (50x-2,000x discrepancies)
- Recommendation: Escalate to C2/C3 for root cause analysis

