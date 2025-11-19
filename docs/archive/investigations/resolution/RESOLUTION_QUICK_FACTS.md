# Market Resolution - Quick Facts

**Last Updated:** 2025-11-08

---

## The Headline

✅ **Resolution data: 100% coverage**
❌ **Payout vectors: Only 8% have them**
🎯 **Result: Can calculate P&L for 8% of trades (15% of volume)**

---

## Coverage Numbers

| Category | Trades | Volume | % |
|----------|--------|--------|---|
| **Can calculate P&L NOW** | 6.6M | $1.6B | 8% / 15% |
| **Has resolution, missing payouts** | 75.6M | $8.7B | 92% / 85% |
| **Empty condition_id** | 78.7M | $18.5B | 49% |

---

## What's Working

✅ 100% of markets have resolution records
✅ 100% have `winning_outcome` and `winning_index`
✅ JOIN logic works perfectly (Apply IDN skill)
✅ P&L formula validated on 6.6M trades

---

## What's Broken

❌ 92% of resolutions missing `payout_numerators` array
❌ 92% of resolutions have `payout_denominator = 0`
❌ Can't calculate P&L without payout vectors
❌ Can't distinguish "unresolved" from "missing data"

---

## The Fix (Priority Order)

### 1. Deploy Now (15 min)
Use existing 8% coverage - it's production-ready

### 2. Quick Win (2-4 hours)
Reconstruct payout vectors for binary markets
→ Coverage jumps to 60-80%

### 3. Blockchain Backfill (4-8 hours)
Query Polygon CTF contract for payout vectors
→ Coverage jumps to 95%+

### 4. Condition_ID Recovery (2-5 hours)
Run ERC1155 backfill (scripts exist)
→ Full trade coverage

---

## Key Queries

### Production P&L (Works Now)

```sql
SELECT wallet_address,
  SUM((shares * arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - usd_value) as pnl
FROM trades_raw t
JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE length(r.payout_numerators) > 0 AND r.payout_denominator > 0
GROUP BY wallet_address
```

### Coverage Check

```sql
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN length(r.payout_numerators) > 0 THEN 1 ELSE 0 END) as pnl_ready,
  pnl_ready * 100.0 / total as coverage_pct
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE t.condition_id != ''
```

---

## Common Mistakes to Avoid

❌ Don't use INNER JOIN (filters out trades)
✅ Use LEFT JOIN to see full picture

❌ Don't forget to check `length(payout_numerators) > 0`
✅ Always validate payout data exists

❌ Don't use 0-based array indexing
✅ Apply CAR skill: `winning_index + 1`

❌ Don't normalize condition_id wrong
✅ Apply IDN skill: `lower(replaceAll(condition_id, '0x', ''))`

---

## Skills Applied

- **IDN** (ID Normalization): `lower(replaceAll(condition_id, '0x', ''))`
- **CAR** (ClickHouse Array Rule): `arrayElement(arr, index + 1)`
- **PNL** (P&L from Vector): `shares * payout[idx] / denom - cost`
- **JD** (Join Discipline): Normalized joins only
- **AR** (Atomic Rebuild): `CREATE TABLE AS SELECT` then `RENAME`

---

## Files

- **Full Report:** `RESOLUTION_ANALYSIS_FINAL_REPORT.md`
- **Executive Summary:** `RESOLUTION_ANALYSIS_EXECUTIVE_SUMMARY.md`
- **Analysis Scripts:** `resolution-*.ts`

---

## Bottom Line

**Can we calculate P&L?** Yes, for 8% of trades (15% of volume)
**Why only 8%?** 92% of resolutions missing payout vectors
**Is it fixable?** Yes - 60-80% in 2-4 hours, 95%+ in 8-12 hours
**Should we deploy the 8% now?** YES - it's production-ready

---

**Status:** Analysis Complete | **Next:** Deploy existing 8%, then backfill payouts
