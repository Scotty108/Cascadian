# Token Filter Patch Status

**Date**: November 10, 2025, 4:20 PM PST
**Audit Run**: Complete
**Patching**: In Progress (Strategic)

---

## Audit Summary

**Total files scanned**: 498
**Files with condition_id queries**: 498
**Files already have filter**: 2
**Files needing patch**: 496

### Distribution by Directory

| Directory | Count | Priority |
|-----------|-------|----------|
| scripts/ | 349 | Medium (many are old diagnostics) |
| docs/ | 143 | Low (markdown examples) |
| lib/ | 6 | **HIGH (production code)** |

---

## Patching Strategy

### Phase 1: Production Code ✅ COMPLETE (3 files)

**Priority**: CRITICAL - These are actively used in production

1. ✅ `lib/metrics/directional-conviction.ts:213`
   - **Fixed**: Added token filter to recent_trades CTE
   - **Impact**: Elite wallet consensus calculations

2. ✅ `lib/metrics/austin-methodology.ts:519`
   - **Fixed**: Added token filter to market_traders CTE
   - **Impact**: Market elite participation stats

3. ✅ `lib/analytics/wallet-category-breakdown.ts:87`
   - **Fixed**: Added token filter to wallet P&L query
   - **Impact**: Wallet category breakdown calculations

### Phase 1: Stub Code (No Action Needed)

4. ⏭️ `lib/data/dimension-readers.ts:98,120`
   - **Status**: Stub code (TODO comments only, no actual queries)
   - **Action**: Skip - will be addressed when stubs are implemented

5. ⏭️ `lib/metrics/CONVICTION_QUICKSTART.md:31,289,406`
   - **Status**: Documentation examples
   - **Action**: Defer to Phase 3 (docs)

6. ⏭️ `lib/metrics/DIRECTIONAL_CONVICTION_README.md:31,256`
   - **Status**: Documentation examples
   - **Action**: Defer to Phase 3 (docs)

---

## Phases 2-4: Remaining Work

### Phase 2: Active Production Scripts (Estimated 20-30 files)

**Files to identify and patch:**
- ETL pipelines (backfill scripts actively used)
- Data processing scripts in production
- Migration scripts

**Recommended approach**:
1. Identify active scripts via git history (most recently modified)
2. Check which scripts are referenced in package.json or docs
3. Patch systematically

### Phase 3: Documentation Updates (143 files)

**Files**: All markdown files in docs/ and scripts/

**Approach**:
- Update code examples to include token filter
- Add reference to `docs/reference/query-filters-token-exclusion.md`
- Can be done in batch with sed/awk

### Phase 4: Legacy Diagnostic Scripts (493 files) ⚠️ IMPORTANT NOTE

**Files**: Numbered diagnostic scripts (02-, 03-, 04-, etc.) and old investigation scripts

**Status**: **NOT PATCHED** - Deferred as low priority

**⚠️ CRITICAL REMINDER**:
- **493 legacy diagnostic scripts still lack the token filter**
- If any of these scripts are revived/reused, **apply the filter BEFORE running**
- Pattern to add: `WHERE length(replaceAll(condition_id, '0x', '')) = 64`
- Without this filter, scripts will accidentally include token_* placeholders (0.3% of trades)

**How to check before running old scripts**:
1. Search script for `FROM trades_raw` or `FROM trades_with_direction`
2. Check if filter pattern exists: `length(replaceAll(condition_id, '0x', '')) = 64`
3. If missing, add filter before executing query

**Reference**: See `docs/reference/query-filters-token-exclusion.md` for correct pattern

**List of unpatched files**: See `token-filter-audit-results.json` for complete list

---

## Filter Pattern Applied

```sql
WHERE length(replaceAll(condition_id, '0x', '')) = 64
```

**Placement**: Added as first condition after FROM/WHERE clause, before other filters

---

## Alternative Approach: Create Helper View

Instead of patching 496 files, consider creating a view:

```sql
CREATE VIEW default.trades_valid AS
SELECT *
FROM default.trades_raw
WHERE length(replaceAll(condition_id, '0x', '')) = 64;
```

Then gradually migrate queries to use `trades_valid` instead of `trades_raw`.

**Benefits**:
- Centralized filter logic
- Easier to maintain
- Gradual migration path

**Tradeoffs**:
- Need to update queries to reference new view
- Still need to document the pattern

---

## Recommended Next Steps

1. **Immediate**: ✅ DONE - Patch critical lib/ files (complete)

2. **Short-term** (2-4 hours):
   - Identify active production scripts (git log, package.json references)
   - Patch 20-30 active ETL scripts
   - Test patched queries

3. **Medium-term** (4-8 hours):
   - Update documentation examples (143 files)
   - Create automated test to catch future violations
   - Add linter rule if possible

4. **Long-term** (8+ hours):
   - Consider creating `trades_valid` view
   - Patch old diagnostic scripts opportunistically
   - Archive unused scripts to reduce noise

---

## Files Modified This Session

1. `lib/metrics/directional-conviction.ts` - Line 214 added
2. `lib/metrics/austin-methodology.ts` - Line 520 added
3. `lib/analytics/wallet-category-breakdown.ts` - Line 88 added

---

## Testing Recommendations

After patching, verify:
1. No syntax errors in patched queries
2. Row counts decrease slightly (0.3% reduction expected due to token_* filter)
3. Production queries still return expected results
4. No performance regression (filter is minimal overhead)

---

## Full Audit Results

See: `token-filter-audit-results.json` (complete file list with line numbers)
