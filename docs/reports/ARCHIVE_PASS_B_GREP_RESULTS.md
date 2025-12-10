# Archive Pass B Grep Results

> **Generated:** 2025-12-09 | **Status:** PARTIAL BLOCK

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Tables safe to archive | 3 | SAFE |
| Tables blocked by code refs | 7 | BLOCKED |
| Views safe to archive | 2 | SAFE |
| Views blocked by code refs | 13 | BLOCKED |

## Tables Grep Results

### SAFE to Archive (No code references)

| Table | Refs | Status |
|-------|------|--------|
| `pm_market_data_quality` | 0 in lib/pnl | SAFE (script refs only) |
| `pm_wallet_profiles_v1` | 0 | SAFE |
| `tmp_unified_ledger_test_rebuild` | 0 | SAFE |

### BLOCKED (Has code references)

| Table | Refs | Blocking Files |
|-------|------|----------------|
| `pm_token_to_condition_patch` | 4 | scripts/pnl/recompute-unmapped-tokens-v4.ts, etc |
| `pm_ui_pnl_by_market_v1` | 2 | scripts/pnl/sync-ui-pnl-by-market.ts |
| `pm_ui_pnl_by_market_v2` | 2 | scripts/pnl/sync-ui-pnl-comprehensive.ts |
| `pm_wallet_classification` | 6 | scripts/pnl/build-wallet-classification-v1.ts, etc |
| `pm_wallet_classification_v1` | 6 | (same files) |
| `pm_wallet_condition_ledger_v9` | 1 | scripts/pnl/create-v9-unified-ledger.ts |
| `pm_wallet_pnl_ui_activity_v1` | 4 | scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts, etc |

### V8/V9 Migration Artifacts

| Table | Refs | Status |
|-------|------|--------|
| `pm_unified_ledger_v8_new` | 0 | SAFE (in DEPRECATED_TABLES list in canonicalTables.ts) |
| `pm_unified_ledger_v8_recent` | 0 | SAFE |
| `pm_unified_ledger_v9_clob_clean_tbl` | 0 | SAFE (in DEPRECATED_TABLES list) |
| `pm_unified_ledger_v9_clob_from_v2_tbl` | 0 | SAFE (in DEPRECATED_TABLES list) |

## Views Grep Results

### SAFE to Archive

| View | Refs | Status |
|------|------|--------|
| `vw_wallet_pnl_archive` | 0 | SAFE |
| `pm_unified_ledger_v9_clob_maker_vw` | 0 | SAFE |

### BLOCKED (Has code references in 35+ files)

Many views are referenced by deprecated engines (V25-V29) and old scripts:

| View | Blocking Engines/Scripts |
|------|-------------------------|
| `vw_ctf_ledger` | lib/pnl/inventoryEngineV27.ts, V28, V29 |
| `vw_ctf_ledger_proxy` | lib/pnl/inventoryEngineV27.ts, etc |
| `vw_pm_resolution_prices` | 12 scripts in scripts/ |
| `vw_pm_retail_wallets_v1` | lib/pnl/goldenEngineV26.ts |
| `vw_pm_ctf_ledger` | scripts/create-ctf-split-merge-integration.ts |
| `vw_pm_pnl_with_ctf` | archive/scripts/pnl-legacy/*.ts |
| `vw_pm_trader_events_wallet_dedup_v1` | scripts/pnl/create-normalized-trader-events-view.ts |
| `vw_pm_trader_events_wallet_dedup_v2` | scripts/pnl/create-normalized-trader-events-view-v2.ts |
| `vw_pm_wallet_summary_with_ctf` | scripts/create-ctf-split-merge-integration.ts |
| `vw_tierA_pnl_by_category` | scripts/pnl/create-metrics-layer-views.ts |
| `vw_tierA_realized_pnl_summary` | scripts/pnl/create-metrics-layer-views.ts |
| `vw_wallet_pnl_ui_activity_v1` | scripts/pnl/sanity-check-ui-activity-v1.ts |

---

## Recommendation

### Phase 1: Archive Code First (lib/pnl/archive/)

Before archiving DB objects, archive the deprecated engine code:

```
lib/pnl/inventoryEngineV27.ts
lib/pnl/inventoryEngineV27b.ts
lib/pnl/inventoryEngineV28.ts
lib/pnl/inventoryEngineV29.ts
lib/pnl/v29BatchLoaders.ts
lib/pnl/goldenEngineV26.ts
lib/pnl/hybridEngineV25.ts
```

This will unblock most view archival.

### Phase 2: Archive Scripts

Move old scripts to `archive/scripts/`:
- All scripts referencing deprecated views
- All V25-V29 benchmark scripts

### Phase 3: Archive DB Objects

After code cleanup, these DB objects will be safe to archive:
- All empty migration artifacts (v8_new, v8_recent, v9_from_v2)
- Old ledger views (v4-v7)
- Old classification tables

---

## Next Steps

1. Archive deprecated engine code to `lib/pnl/archive/engines_pre_v12/`
2. Re-run grep sweep to confirm unblocking
3. Execute DB Pass B for confirmed-safe objects
