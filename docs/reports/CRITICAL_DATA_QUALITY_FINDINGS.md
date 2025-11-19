# Critical Data Quality Findings - Claude 1 Investigation

**Status:** Data Corruption Confirmed - Work Paused
**Date:** November 10, 2025
**Impact:** All P&L calculations currently unreliable

---

## Summary of Corrupted Data

### Issue 1: Identical Timestamps in trades_raw
**Impact:** HIGH
- Every row in `trades_raw` carries the same timestamp
- Destroys trade chronology and order sequencing
- Makes FIFO cost basis calculation impossible
- Invalidates "first trade" and "last trade" metrics

### Issue 2: Condition ID Format Mismatch
**Impact:** CRITICAL
- `trades_with_direction` stores IDs as 0x-prefixed (wrong format)
- trades_raw has mixed formats
- Prevents proper joins with market_resolutions_final (expects 64-char hex, no prefix)
- Causes silent join failures and missing market data

### Issue 3: Token Placeholder Residue
**Impact:** MEDIUM
- ~0.3% of trades still reference `token_*` placeholders instead of real condition_ids
- These trades cannot be matched to markets or resolutions
- Inflates row count without adding valid data

### Issue 4: API vs Database Mismatch
**Impact:** CRITICAL
- **Polymarket API:** Reports 34 active positions for test wallet (0xcce2b7...)
- **ClickHouse trades_raw:** Contains 141 historical markets
- **Overlap:** ZERO - no matching positions between systems
- **Implication:** ClickHouse is completely out of sync with live Polymarket data

---

## Work Currently Paused

### Tasks Affected
1. ✋ **Task 1 (P&L Rebuild)** - Results unreliable due to timestamp/ID corruption
   - File: `rebuild-pnl-with-operator-attribution.ts`
   - Status: Created but based on corrupted data
   - Action: DO NOT use for validation until repairs complete

2. ✋ **Task 2 (Single-Market Parity)** - Cannot validate against API due to API/DB mismatch
   - File: `task2-parity-test.ts`
   - Status: Database query works, but results unvalidatable
   - Action: Hold pending API/DB sync

3. ✋ **Task 3 (Metadata Hydration)** - Cannot proceed without clean condition_ids
   - File: `task3-metadata-rehydration.ts`
   - Status: Blocked on condition_id cleanup
   - Action: Hold pending ID normalization

---

## Required Repairs (Claude 1 Track)

### Phase 1: Data Cleanup
- [ ] Rebuild trades_raw with correct timestamps from blockchain/CLOB API
- [ ] Normalize all condition_ids to 64-char hex (strip 0x prefix everywhere)
- [ ] Remove or flag rows with token_* placeholders
- [ ] Validate 100% of condition_ids match expected format

### Phase 2: Schema Alignment
- [ ] Verify trades_with_direction schema matches trades_raw
- [ ] Ensure all joins use normalized condition_id_norm
- [ ] Check market_resolutions_final has matching normalized IDs
- [ ] Validate payout_numerators arrays are properly formatted

### Phase 3: API Reconciliation
- [ ] Fetch current active positions from Polymarket API for test wallet
- [ ] Cross-reference against trades_raw with correct IDs
- [ ] Identify missing positions (should be in DB, aren't)
- [ ] Determine if missing positions need blockchain backfill

---

## Validation Checklist for After Repairs

Once Claude 1 completes repairs, follow this sequence:

### ✅ Step 1: Data Quality Gate
```sql
-- Should return 100% valid format
SELECT
  COUNT() as total,
  countIf(condition_id LIKE '0x%') as 0x_prefix_count,
  countIf(LENGTH(replaceAll(condition_id, '0x', '')) != 64) as invalid_length
FROM default.trades_raw
```

**Expected:** 0x_prefix_count = 0, invalid_length = 0

### ✅ Step 2: Timestamp Validation
```sql
SELECT
  MIN(created_at) as earliest_trade,
  MAX(created_at) as latest_trade,
  COUNT(DISTINCT created_at) as unique_timestamps,
  COUNT() as total_trades,
  ROUND((COUNT(DISTINCT created_at) / COUNT()) * 100, 1) as pct_unique_timestamps
FROM default.trades_raw
```

**Expected:** pct_unique_timestamps > 80% (realistic trade diversity)

### ✅ Step 3: Token Placeholder Check
```sql
SELECT
  COUNT(DISTINCT condition_id) as with_placeholder,
  COUNT() as total
FROM default.trades_raw
WHERE condition_id LIKE '%token_%'
```

**Expected:** with_placeholder = 0 or < 0.3% of total

### ✅ Step 4: API Parity Check
```sql
-- After creating confirmed_api_positions table from Polymarket API
SELECT
  'API' as source,
  COUNT(*) as position_count
FROM default.confirmed_api_positions
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

UNION ALL

SELECT
  'ClickHouse' as source,
  COUNT(DISTINCT condition_id) as position_count
FROM default.trades_raw
WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
```

**Expected:** API count should match or be subset of ClickHouse (after ID normalization)

---

## Resumption Path for Claude 2

### After Repairs Confirmed (Steps above pass):

1. **Rerun Task 2 - Parity Test**
   ```bash
   npx tsx task2-parity-test.ts
   ```
   - Should now find matching market in Polymarket API
   - P&L values should align with API closed-positions data
   - Document delta (should be <1% for fee/rounding)

2. **Rerun Task 1 - P&L Rebuild**
   ```bash
   npx tsx rebuild-pnl-with-operator-attribution.ts
   ```
   - Results now valid for the 34 active positions from API
   - Can compare realized vs unrealized against Polymarket
   - Confirmed timestamps enable FIFO cost basis

3. **Resume Task 3 - Metadata Hydration**
   - Normalized condition_ids enable clean joins to dim_markets/gamma_markets
   - Human-readable titles can now be reliably mapped
   - Validation dashboard can reference market names

---

## Timeline Dependencies

```
Claude 1: Data Cleanup (Phase 1-3)
    ↓
    ✅ Quality Gates Pass (All 4 checks)
    ↓
Claude 2: Rerun Parity Test (Task 2)
    ↓
    ✅ API/DB Sync Confirmed
    ↓
Claude 2: Rerun P&L Rebuild (Task 1)
    ↓
    ✅ P&L Values Match API
    ↓
Claude 2: Resume Metadata Hydration (Task 3)
    ↓
    ✅ All Markets Have Titles
    ↓
FINAL: Complete P&L Report with Attribution
```

---

## Files on Hold

These files are created but UNUSABLE until repairs complete:
- `rebuild-pnl-with-operator-attribution.ts` - Based on corrupted data
- `task2-parity-test.ts` - Cannot validate against API
- `task3-metadata-rehydration.ts` - Blocked on ID cleanup
- `TASK_DELEGATION_COMPLETION_REPORT.md` - All results invalidated

---

## Next Steps

**Immediate:** Wait for Claude 1 to complete Phase 1-3 repairs

**After Claude 1 Confirms:** Run quality gates above and report results

**Then:** Execute resumption path in order (Task 2 → Task 1 → Task 3)
