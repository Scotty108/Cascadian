# Database Table Usage Guide - POST-AUDIT

**Last Updated:** 2025-11-09 (after comprehensive audit)

## TL;DR - Which Tables to Use

### For Trades
✅ **USE:** `fact_trades_clean` (63.3M rows, Dec 2022 - Oct 2025)
- Column: `cid` (66 chars with 0x prefix)
- Clean, deduplicated trade data

### For Resolutions
✅ **USE:** `resolution_candidates` (424K rows, **89.34% coverage**)
- Column: `condition_id_norm` (64 chars without 0x)
- BEST coverage of traded markets
- Has confidence scores

❌ **DON'T USE:** `market_resolutions_final` (218K rows, only 37.55% coverage)
❌ **DON'T USE:** `resolutions_external_ingest` (133K rows, only 27.31% coverage)

### For Market Metadata
✅ **USE:** `api_markets_staging` (161K rows)
- Column: `condition_id` (64 chars without 0x)
- Has market status (closed/open)
- ⚠️ Only covers 29.38% of traded markets (need backfill)

---

## Join Patterns (ALWAYS USE THESE)

### Trade + Resolution (for P&L)
```sql
SELECT 
  t.wallet_address,
  t.cid,
  t.shares,
  t.usdc_amount,
  r.outcome as winning_outcome,
  r.confidence
FROM fact_trades_clean t
LEFT JOIN resolution_candidates r
  ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
WHERE r.confidence >= 0.8  -- Filter low-confidence resolutions
```

### Trade + Market Metadata
```sql
SELECT 
  t.*,
  m.closed,
  m.question
FROM fact_trades_clean t
LEFT JOIN api_markets_staging m
  ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(m.condition_id, '0x', ''))
```

### Complete P&L Query (Trade + Resolution + Market)
```sql
SELECT 
  t.wallet_address,
  t.cid,
  t.shares,
  t.usdc_amount,
  t.direction,
  r.outcome as winning_outcome,
  r.confidence,
  m.question,
  m.closed,
  CASE
    WHEN r.outcome IS NULL THEN 'unresolved'
    WHEN m.closed = false THEN 'market_open'
    WHEN r.confidence < 0.8 THEN 'low_confidence'
    ELSE 'resolved'
  END as resolution_status
FROM fact_trades_clean t
LEFT JOIN resolution_candidates r
  ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
LEFT JOIN api_markets_staging m
  ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(m.condition_id, '0x', ''))
```

---

## ID Normalization Rules (ALWAYS APPLY)

### Rule 1: Strip 0x and lowercase
```sql
-- Correct:
lower(replaceAll(condition_id, '0x', ''))

-- Wrong:
condition_id  -- Fails due to case/prefix mismatch
```

### Rule 2: Expected Lengths
- **fact_trades_clean.cid:** 66 chars (with 0x)
- **resolution_candidates.condition_id_norm:** 64 chars (without 0x)
- **api_markets_staging.condition_id:** 64 chars (without 0x)

### Rule 3: Store Normalized
When creating new tables, store as 64-char lowercase without 0x:
```sql
CREATE TABLE new_table (
  condition_id_norm String,  -- 64 chars, no 0x, lowercase
  ...
) ENGINE = ReplacingMergeTree()
ORDER BY condition_id_norm;
```

---

## Coverage Statistics (As of 2025-11-09)

| Table | Rows | Coverage | Notes |
|-------|------|----------|-------|
| fact_trades_clean | 63,380,204 | 100% | All trades |
| resolution_candidates | 424,095 | 89.34% | BEST for resolutions |
| api_markets_staging | 161,180 | 29.38% | Need backfill |
| market_resolutions_final | 218,325 | 37.55% | Structured but incomplete |

**Current P&L resolution rate:** 11.88%  
**After fixing joins:** 27.44%  
**After backfilling markets:** 89.34%

---

## Tables to IGNORE

These have data but are NOT the source of truth:

- `staging_resolutions_union` - No condition column
- `market_resolutions` - Superseded by resolution_candidates
- `market_resolutions_by_market` - Superseded by resolution_candidates
- `trades_with_direction` - Use fact_trades_clean instead
- `trade_direction_assignments` - Use fact_trades_clean instead
- `vw_trades_canonical` - View over fact_trades_clean

---

## Next Steps

1. **Update all P&L queries** to use `resolution_candidates` instead of `market_resolutions_final`
2. **Apply ID normalization** to all joins (IDN skill)
3. **Backfill missing markets** (144,537 condition_ids)
4. **Add indexes** on normalized condition_id columns

See `DATABASE_AUDIT_FINAL_ANSWER.md` for complete details.
