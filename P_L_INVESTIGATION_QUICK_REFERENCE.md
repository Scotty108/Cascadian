# P&L Reconciliation - Quick Reference Summary

## The 5 Root Causes (Priority Order)

| Rank | Problem | Coverage Gap | Solution | ETA |
|------|---------|--------------|----------|-----|
| 1 | Missing condition_id at ingest | 51% sparse | API lookup on market_id | 4-6h |
| 2 | Missing market_id at ingest | 89% sparse | Apply condition_market_map JOIN | 2-3h |
| 3 | Incomplete market resolutions | 59/151K conditions | Monitor API, no code change | Ongoing |
| 4 | Enrichment scripts not applied | 100% (read-only only) | Add UPDATE statement + scheduler | 2-5h |
| 5 | ERC-1155 token decoder missing | 10-15% unrecoverable | Build decoder library | 6-8h |

---

## The Canonical Tables (Use These)

### For Market-Condition Mapping: `condition_market_map`
- 151,843 rows, perfect 1:1 mapping
- 0% NULLs, indexed, production-ready
- Use for: All condition_id → market_id lookups

### For Trade-Resolution Joins: `winning_index` (VIEW)
- Derived from market_resolutions_final
- 137K conditions with known winners
- Use for: Settlement calculations

### For Wallet Holdings: `trades_raw`
- 159M rows, but 51% condition_id is sparse
- Always use with WHERE condition_id IS NOT NULL
- Join to condition_market_map for enrichment

---

## The Files You Need

**To understand the current state:**
1. `/Users/scotty/Projects/Cascadian-app/CLICKHOUSE_INVENTORY_REPORT.md` - Overall data summary
2. `/Users/scotty/Projects/Cascadian-app/PNL_RECONCILIATION_DIAGNOSIS.md` - Why P&L doesn't match
3. `/Users/scotty/Projects/Cascadian-app/MAPPING_TABLES_FINAL_SUMMARY.md` - Table inventory

**To fix it (in order):**
1. `migrations/clickhouse/014_create_ingestion_spine_tables.sql` - condition_market_map table
2. `scripts/backfill-market-ids.ts` - Generates recovery mapping (READ-ONLY now)
3. `scripts/realized-pnl-final-fixed.ts` - P&L calculation views

**To diagnose issues:**
1. `scripts/diagnostic-final-gap-analysis.ts` - Why P&L doesn't match (run this first)
2. `scripts/debug-realized-pnl.ts` - Detailed P&L debugging

---

## Key Numbers

| Metric | Value | Status |
|--------|-------|--------|
| Total trades in ClickHouse | 159,574,259 | ✅ |
| Total markets | 151,846 | ✅ |
| condition_id populated | 77,400,000 (48.5%) | ❌ TOO LOW |
| market_id populated | 158,316,330 (99.2%) | ✅ |
| Conditions with resolution data | 59 (for targets) / 137K (total) | ⚠️ INCOMPLETE |
| HolyMoses7 trades | 8,484 | ✅ |
| niggemon trades | 16,472 | ✅ |
| HolyMoses7 expected P&L | $89,975.16 | Target |
| HolyMoses7 calculated P&L | $58,098.92 | -35.4% gap |
| niggemon expected P&L | $102,001.46 | Target |
| niggemon calculated P&L | $36,191.57 | -64.5% gap |

---

## Immediate Actions (Do These First)

### 1. Verify condition_market_map is correct
```sql
SELECT COUNT(DISTINCT condition_id) as total_conditions
FROM condition_market_map;
-- Should be 151,843
```

### 2. Count how many trades_raw have condition_id
```sql
SELECT 
  countIf(condition_id != '') as with_cid,
  countIf(market_id != '') as with_mid,
  count() as total
FROM trades_raw;
-- Should show: condition_id sparse (~77M), market_id full (~159M)
```

### 3. Test the join that will fix it
```sql
SELECT COUNT(DISTINCT t.market_id)
FROM trades_raw t
LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id
WHERE t.condition_id != '' AND c.market_id != '';
-- Should be close to 151,843
```

### 4. Apply the fix (BACKUP FIRST!)
```sql
-- STEP 1: Backup
CREATE TABLE trades_raw_backup_pre_market_id_fix AS SELECT * FROM trades_raw;

-- STEP 2: Update market_id using condition_market_map
ALTER TABLE trades_raw UPDATE
  market_id = (SELECT market_id FROM condition_market_map WHERE condition_id = trades_raw.condition_id)
WHERE condition_id != '' AND market_id IN ('', 'unknown', '0');

-- STEP 3: Verify
SELECT countIf(market_id = '') FROM trades_raw;
-- Should drop from ~140M to <1M
```

---

## Expected Impact After P0 Fix

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| market_id coverage | 11% | ~70% | +59% |
| trades joinable to winning_index | ~1% | ~40% | +39% |
| P&L coverage for niggemon | 36% | ~80% | +44% |
| P&L gap for niggemon | -$65,809 | ~-$20k | -69% |

---

## For Reference: Where Data Gets Populated

**condition_id comes from:**
1. CLOB API ingestion (`scripts/ingest-clob-fills-correct.ts`) - 40-50% coverage
2. Goldsky blockchain decoding (`scripts/goldsky-parallel-ingestion.ts`) - adds 10-15%
3. Enrichment pass (generates recommendation, doesn't apply) - remaining ~35%

**market_id comes from:**
1. CLOB API (some fills have market_id) - 10% coverage
2. condition_market_map lookup (the fix we're applying) - should be 90%+

**Resolutions come from:**
1. Polymarket API (market resolution endpoint)
2. Stored in market_resolutions_final
3. Only 59-137K of 151K markets have resolved

---

## Success Metrics (After All Fixes)

- condition_id coverage: 51% → 90%+
- market_id coverage: 11% → 95%+
- Trades joinable to resolutions: 3% → 40%+
- P&L coverage: 35% → 95%+
- HolyMoses7 P&L gap: -35% → Depends on market resolutions
- niggemon P&L gap: -65% → -10% to -20% (significant improvement)

---

## Critical: Don't Confuse These

- `condition_id` - Unique identifier for market outcome state (from CTF Exchange)
- `market_id` - Unique identifier for the market (from Polymarket)
- `outcome_index` - Position in outcomes array (0=YES/first, 1=NO/second, etc.)
- `token_id` - ERC-1155 token identifier (encodes condition_id + outcome_index)

**In a YES/NO market:** condition_id and market_id are often the SAME value (32-byte hex)
**Token encoding:** token_id = condition_id + outcome_index (at binary level)

---

Generated: November 6, 2025
Status: Ready to implement P0 (market_id backfill)
