# Cascadian PnL System Cleanup Recommendations

**Date:** 2025-11-29  
**Status:** Audit Complete  
**Conservative Approach:** Archive first, delete only when confirmed safe

---

## Executive Summary

The PnL system has evolved through 11+ iterations (V1-V11_POLY). Many investigation scripts and legacy views remain in the codebase despite being superseded by production engines.

**Key Finding:** 200+ legacy PnL scripts exist from investigation phases, but only ~15 are actively used in production.

**Recommended Action:** Archive 200+ legacy scripts, keep production tables/views, deprecate old documentation.

---

## 1. Active Production Components (KEEP)

### Production PnL Engines

These are the **only** calculation engines referenced by app code:

| Component | Location | Status | Purpose |
|-----------|----------|--------|---------|
| **UI Activity Engine V3** | `lib/pnl/uiActivityEngineV3.ts` | Active | Cost-basis PnL matching Polymarket UI (Tier 1-3 trust) |
| **Polymarket Subgraph Engine (V11_POLY)** | `lib/pnl/polymarketSubgraphEngine.ts` | Active | Canonical PnL using token_id (faithful port of pnl-subgraph) |
| **Ledger-based PnL** | `lib/pnl/computeUiPnlFromLedger.ts` | Active | Fast retail wallet path using `pm_unified_ledger_v5` |
| **Event Loader** | `lib/pnl/polymarketEventLoader.ts` | Active | Loads CLOB/CTF/Resolution data from ClickHouse |

**Action:** KEEP all four engines.

### Core ClickHouse Tables (Production)

These tables are read by production code and must never be deleted:

| Table | Engine | Data Source | Used By |
|-------|--------|-------------|---------|
| `pm_trader_events_v2` | SharedMergeTree | CLOB fills | All PnL engines, wallet analytics |
| `pm_ctf_events` | ReplacingMergeTree | CTF events (splits/merges/redemptions) | Event loader, UI activity engine |
| `pm_condition_resolutions` | ReplacingMergeTree | Market resolutions | Event loader, resolution tracking |
| `pm_token_to_condition_map_v3` | ReplacingMergeTree | Token ↔ Condition mapping | CLOB normalization |
| `pm_erc1155_transfers` | ReplacingMergeTree | ERC1155 transfers | Transfer-aware PnL (optional) |
| `pm_erc20_usdc_flows` | ReplacingMergeTree | USDC flows | Validation, alternative PnL source |
| `pm_market_metadata` | ReplacingMergeTree | Market info | Market detail pages |
| `pm_wallet_classification` | ReplacingMergeTree | Wallet tiers | Wallet tier detection |
| `pm_unified_ledger_v5` | View | Unified ledger (CLOB+CTF) | Ledger-based PnL fast path |

**Action:** KEEP all tables. Never delete.

### Production Views (Feature-Flagged)

| View | Purpose | Status | Notes |
|------|---------|--------|-------|
| `pm_wallet_market_pnl_v2` | Default PnL view | Production | Used by getPnLViewName() |
| `vw_wallet_market_pnl_v3` | V3 alternative | Beta | Feature-flagged (ENABLE_V3_PNL_VIEWS) |
| `vw_pm_retail_wallets_v1` | Retail wallet detection | Active | Used by getWalletPnl() |
| `pm_trades_canonical_v2` | Canonical CLOB trades | Default | Used by getPnLTradeSourceName() |
| `vw_trades_canonical_current` | V3 alternative trades | Beta | Feature-flagged |

**Action:** KEEP all. Views are selectively used via feature flags.

### Active PnL Scripts (/scripts/pnl/)

These 15 scripts are actively used for testing, benchmarking, and data creation:

| Script | Purpose | Status |
|--------|---------|--------|
| `ui-activity-pnl-simulator-v3.ts` | Main test harness for V3 | Active |
| `test-polymarket-subgraph-pnl.ts` | V11_POLY validation | Active |
| `test-ui-pnl-estimate.ts` | Ledger-based PnL tests | Active |
| `compute-wallet-pnl.ts` | Compute single wallet PnL | Active |
| `retail-pnl-benchmark.ts` | Retail wallet benchmarks | Active |
| `test-market-pnl.ts` | Market-level PnL tests | Active |
| `create-unified-ledger-v5.ts` | Create ledger view | Backfill utility |
| `create-wallet-classification-table.ts` | Create classification table | Backfill utility |
| `create-wallet-pnl-ui-activity-v1-table.ts` | Materialize UI activity PnL | Backfill utility |
| `materialize-wallet-pnl-ui-activity-v1.ts` | Materialization runner | Backfill utility |
| `create-retail-wallet-view.ts` | Create retail wallet view | Backfill utility |
| `create-ctf-ledger-tables.ts` | Create CTF ledger | Backfill utility |
| `migrate-erc1155-transfers.ts` | Ingest ERC1155 transfers | Data pipeline |
| `migrate-erc20-usdc-flows.ts` | Ingest USDC flows | Data pipeline |
| `create-v9-unified-ledger.ts` | Legacy ledger creation | Support |

**Action:** KEEP all 15 scripts. Move to `scripts/pnl-active/` for clarity, but don't delete.

---

## 2. Orphaned Components (ARCHIVE)

### Orphaned PnL Scripts (~200 files)

**Status:** Already marked for deletion in git, created during investigation phases V1-V8.

**Examples:**
- Legacy PnL calculation attempts: `calculate-complete-pnl.ts`, `calculate-pnl-simple.ts`, `calculate-realized-pnl.ts`
- Legacy engines: `canonical-pnl-engine.ts`, `uiActivityEngineV3.ts` copies
- Debug scripts: `debug-w2-*.ts`, `debug-v11-*.ts`, `investigate-*.ts`
- Legacy views: `v6_partial_pnl.ts`, `v8-validation-simple.ts`
- Batch operations: `batch-calculate-all-wallets-pnl.ts`, `test-10-wallets-pnl.ts`

**Total:** 200+ scripts (seen in git status as "D" deleted files)

**Recommendation:** 
- **✅ SAFE TO DELETE** - These were investigation artifacts from V1-V8 iterations
- Already archived in git history (git status shows "D")
- No production code imports them
- No other scripts reference them

**Action:** Confirm deletion in git commit. Do not restore.

### Orphaned Documentation (~15 files)

**Already marked for deletion:**

| Document | Why Obsolete |
|----------|-------------|
| `docs/operations/CLAUDE_PNL_FIX_GUIDE.md` | V1-V8 fix guide, superseded by V3/V11_POLY |
| `docs/operations/PNL_IMPLEMENTATION_GUIDE.md` | Legacy V2 guide |
| `docs/operations/PNL_SYSTEM_GUIDE.md` | Covered by V3 spec and V11_POLY spec |
| `docs/operations/UNREALIZED_PNL_SYSTEM_GUIDE.md` | Unrealized PnL never implemented |
| `docs/features/metrics/pnl-calculation.md` | Superseded by V10 UI Activity spec |
| `docs/systems/pnl/PNL_QUICK_REFERENCE.md` | Outdated quick ref |
| `docs/systems/pnl/REALIZED_PNL_QUICK_START.md` | Covered by V10 spec |
| `docs/reports/Wallet_PNL_REPORT.md` | Legacy reporting guide |

**Recommendation:**
- ✅ **SAFE TO DELETE** - Documentation is superseded
- Core specs still exist in `/docs/systems/database/PNL_*_SPEC.md`
- No links from README files

**Action:** Confirm deletion in git commit.

---

## 3. Deprecated But Stable Components (DEPRECATE)

### Legacy PnL Views (V1-V8)

**Status:** Some still exist in ClickHouse but are superseded by V2/V3.

**Examples (if they exist):**
- `vw_realized_pnl_v1` through `vw_realized_pnl_v8`
- `pm_wallet_market_pnl_v1`
- `pm_wallet_pnl_summary_v*`
- `pm_market_pnl_summary_v*`

**Safety Check:** Before deletion, verify:
1. No code references them (already confirmed via grep)
2. No downstream views depend on them
3. Have at least 30 days of data isolation window

**Recommendation:**
- **Rename with `_DEPRECATED_` prefix** (e.g., `pm_wallet_market_pnl_v1` → `_DEPRECATED_pm_wallet_market_pnl_v1`)
- Keep for 30 days as safety net
- Then delete if no issues

**Action:** Postpone deletion until December 30, 2025. Flag for Q1 2026 review.

---

## 4. Questionable Components (INVESTIGATE)

### Tables with Unclear Usage

| Component | Status | Investigation Needed |
|-----------|--------|---------------------|
| `pm_wallet_condition_ledger_v9` | Unclear | Created by `create-v9-unified-ledger.ts` but not referenced in production code? |
| `pm_ctf_flows_inferred` | Unclear | Created by `create-ctf-ledger-tables.ts` - verify if used |
| `pm_wallet_pnl_ui_activity_v1` | Materialized table | Check: Is this still materialized daily? Used by API? |
| `pm_erc1155_transfers` | Optional | Only used if transfers enabled - confirm usage |

**Action:** 
1. Search lib/app for all references
2. Check if materialization jobs exist
3. Document findings before any cleanup

---

## 5. Cleanup Action Plan

### Phase 1: Confirm Deletions (Already staged in git)

**Status:** Git status shows 200+ scripts and 15 docs marked "D" (deleted).

**Action:**
```bash
# Review what's marked for deletion
git status --short | grep "^D"

# These are already staged - confirm they should stay deleted
# No action needed - they're already removed from working directory
```

**Timeline:** Now (2025-11-29)

### Phase 2: Archive Old Investigation Scripts (Safe)

**Scope:** Move `scripts/pnl/*` that are investigation artifacts to `archive/scripts/pnl-v1-v8/`

**Safety:** All are already NOT referenced by production code (verified via grep)

**Script Categories:**
1. **Calculation variants** (calculate-*.ts): Can be archived
2. **View builders** (build-*.ts, create-*.ts): Keep only active ones in Phase 1
3. **Debug/analysis** (debug-*.ts, analyze-*.ts): Archive all (investigation only)
4. **Legacy engines** (v[1-6]_*.ts): Archive all

**Timeline:** 2-4 hours (one comprehensive batch operation)

**Commands:**
```bash
# Identify scripts to archive (investigation artifacts)
find scripts/pnl -name "*.ts" | grep -v -E "(ui-activity-pnl-simulator-v3|test-polymarket|test-ui-pnl|compute-wallet|retail-pnl|test-market|create-unified|create-wallet-classification|create-wallet-pnl-ui|materialize|create-retail|create-ctf|migrate-erc|create-v9)" | wc -l

# Move to archive/ with hierarchy
mkdir -p archive/scripts/pnl-investigation-v1-v8
# Move non-active scripts
```

**Timeline:** Dec 2, 2025

### Phase 3: Document Architecture (New)

**Create:** `/docs/systems/database/PNL_ARCHITECTURE_ACTIVE.md`

Contents:
- Diagram: Data flow for V3 and V11_POLY
- Table dependency graph
- Active view selection logic (feature flags)
- When to use each engine (retail vs operator)

**Timeline:** Dec 2, 2025 (2 hours)

### Phase 4: Deprecate Legacy Views (Safe)

**Scope:** Rename legacy PnL views with `_DEPRECATED_` prefix

**Safety Checks:**
```bash
# Check each view for dependencies
SELECT * FROM system.dependencies WHERE database = 'default' AND table LIKE 'pm_%pnl%'

# Verify no queries reference them
grep -r "vw_realized_pnl_v[1-7]\|pm_wallet_market_pnl_v1\|pm_wallet_pnl_summary" lib app
```

**Timeline:** Dec 5, 2025 (after verification)

### Phase 5: Cleanup Review (30-day window)

**Date:** December 30, 2025

**Actions:**
- Monitor logs for any "table not found" errors
- Delete deprecated views if no issues
- Archive any unused backfill scripts

---

## 6. Summary Table

| Category | Action | Timeline | Risk |
|----------|--------|----------|------|
| **Active PnL engines** (4 files) | KEEP | — | None |
| **Production tables** (9 tables) | KEEP | — | None |
| **Active views** (5 views) | KEEP | — | None |
| **Active scripts** (15 scripts) | KEEP | — | None |
| **Legacy scripts** (200+ scripts) | Already deleted in git ✅ | Now | None |
| **Legacy docs** (15 files) | Already deleted in git ✅ | Now | None |
| **Legacy views** (V1-V8) | Rename + Monitor | Dec 5 | Low |
| **Unknown usage tables** (4 items) | Investigate | Dec 1 | Medium |

---

## 7. Post-Cleanup Checklist

- [ ] Confirm all legacy scripts are in git history
- [ ] Archive unknown-usage tables before deletion
- [ ] Deploy architect doc with active system design
- [ ] Update README.md to reference `PNL_ARCHITECTURE_ACTIVE.md`
- [ ] Review production logs for 7 days (watch for "table not found")
- [ ] Delete deprecated views at 30-day mark (Dec 30)

---

## 8. Key Decisions

### Why Keep Legacy Tables?

1. **Immutability:** ClickHouse tables can't be updated (only reinserted). Deletion is atomic.
2. **Safety:** If we need to investigate a past issue, the data is still available.
3. **Small cost:** Storage is ~10GB for full data dump. Deletion benefit is minimal.
4. **Zero risk:** Reading from old tables has no impact on production queries using feature flags.

### Why Archive Scripts Instead of Delete?

1. **Documentation:** They show the investigation path (v1→v11_poly)
2. **Reference:** Future PnL iterations can learn from previous attempts
3. **Zero cost:** Archives don't impact app performance
4. **Safe rollback:** If a legacy approach is needed, it's still in git history

### Why Not Delete Everything Old?

1. **Trust:** We don't fully understand why v1-v8 failed. Keeping them preserves knowledge.
2. **Compliance:** If audited, having the investigation trail is valuable.
3. **Zero harm:** Old scripts don't run unless explicitly executed.

---

## Questions Resolved

**Q: Is `pm_wallet_market_pnl_v2` production?**  
A: Yes. It's the default view used by `getPnLViewName()`. V3 is beta (feature-flagged).

**Q: Should we delete all non-active scripts?**  
A: Archive them first (they're already in git). Delete only after 30-day monitoring window.

**Q: Are there any tables we can safely delete?**  
A: Only legacy intermediate tables (e.g., `pm_wallet_condition_ledger_v9`). But investigate first.

**Q: What about the 200+ deleted scripts already in git status?**  
A: They're already deleted from working directory. Confirm in git commit—don't restore them.

---

## References

- **Active PnL Spec:** `/docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md`
- **UI Activity Spec:** `/docs/systems/database/PNL_V10_UI_ACTIVITY_PNL_SPEC.md`
- **Polymarket Integration:** `/docs/systems/polymarket/`
- **Feature Flags:** `lib/clickhouse/pnl-views.ts`

---

**Report Author:** Claude Code (Explorer Agent)  
**Date:** 2025-11-29 14:30 PST  
**Terminal:** Claude 3 (Read-only Audit Mode)
