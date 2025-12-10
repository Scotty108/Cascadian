# Terminal 1 Handoff: V1 Leaderboard Documentation Bundle

> **Status:** READY FOR TERMINAL 2 | **Date:** 2025-12-09

## Source of Truth Documents

Terminal 2 should consume these files as the authoritative reference:

| Document | Path | Purpose |
|----------|------|---------|
| **PNL_VOCABULARY_V1.md** | `docs/systems/pnl/PNL_VOCABULARY_V1.md` | Four PnL definitions, validation rules |
| **PERSISTED_OBJECTS_MANIFEST.md** | `docs/systems/pnl/PERSISTED_OBJECTS_MANIFEST.md` | Full table inventory with status labels |
| **PRODUCT_SURFACE_CANONICALS.md** | `docs/systems/pnl/PRODUCT_SURFACE_CANONICALS.md` | Which table for which product |
| **TIER_A_COMPARABLE_SPEC.md** | `docs/systems/pnl/TIER_A_COMPARABLE_SPEC.md` | V1 wallet selection criteria |
| **ARCHIVE_PLAN.md** | `docs/reports/ARCHIVE_PLAN.md` | Safe archival guidance |

---

## Key Decisions Locked

### V8 vs V9 Canonical Usage

| Product Surface | Canonical Table | Why |
|-----------------|-----------------|-----|
| **V1 Leaderboard (CLOB-only)** | `pm_unified_ledger_v9_clob_tbl` | Fixed missing CLOB trades |
| **Full PnL (all event types)** | `pm_unified_ledger_v8_tbl` | Has CTF events |

**Code constant already exists:**
```typescript
// lib/pnl/dataSourceConstants.ts
export const CLOB_ONLY_LEDGER_TABLE = 'pm_unified_ledger_v9_clob_tbl'; // V1 Leaderboard
export const UNIFIED_LEDGER_TABLE = 'pm_unified_ledger_v8_tbl';        // Full ledger
```

### Tier A Comparable Criteria

- `unresolved_pct` <= 5%
- `abs(realized_pnl)` >= $1,000
- `total_events` >= 10
- **90% pass rate** achieved on comparable wallets

---

## Terminal 2 Implementation Tasks

1. **Create `lib/pnl/canonicalTables.ts`** (optional)
   - Export canonical table names for all engines
   - Follow pattern from `dataSourceConstants.ts`

2. **Audit scripts using non-canonical tables**
   - Grep `scripts/pnl/` for hardcoded table names
   - Update to use exported constants

3. **Create `VALIDATION_MATRIX_V1.md`** (optional)
   - Map each metric type to its benchmark source
   - Define pass criteria for each

4. **Implement Leaderboard API filter**
   - Apply Tier A Comparable criteria
   - Use V9 CLOB table for queries

---

## Archive Status

**DO NOT execute archive moves yet.**

The ARCHIVE_PLAN.md has:
- Guard clause with protected objects
- Safety check script
- "Do Not Archive Yet" list

Archive moves require separate review and approval.

---

## Exit Checks Passed

- [x] TIER A spec no longer references V8 for V1 leaderboard SQL (now uses V9)
- [x] PRODUCT_SURFACE_CANONICALS.md glue doc exists
- [x] All four authoritative docs cross-reference each other
- [x] ARCHIVE_PLAN.md has safety checks

---

## Questions for Terminal 2

None. All contracts are locked. Proceed with implementation.
