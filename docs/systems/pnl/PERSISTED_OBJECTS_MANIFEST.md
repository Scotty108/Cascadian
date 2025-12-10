# Persisted Objects Manifest

> **Status:** CANONICAL | **Last Updated:** 2025-12-09

This document is the single source of truth for all PnL-related database objects.

**Status Labels:**
- `CANONICAL`: Use this. It's the source of truth.
- `SUPPORTING`: Used by canonical objects or for specific queries.
- `EXPERIMENTAL`: Testing only. Do not use in production.
- `DEPRECATED`: Do not use. Scheduled for archive.
- `ARCHIVE_CANDIDATE`: Likely not needed. Confirm before archiving.

---

## Surface Map (Authoritative)

**Explicitly mapping product surfaces to canonical tables:**

| Product Surface | Canonical Table | Import Constant |
|-----------------|-----------------|-----------------|
| **Leaderboard V1 CLOB surface** | `pm_unified_ledger_v9_clob_tbl` | `CLOB_ONLY_LEDGER_TABLE` |
| **Full PnL surfaces** | `pm_unified_ledger_v8_tbl` | `UNIFIED_LEDGER_TABLE` |

**Rules:**
- If building V1 Leaderboard: use V9 CLOB
- If building full cash accounting (CashFull): use V8 full

---

## Version Rationale: V8 vs V9

**Two different canonical tables for two different purposes:**

| Product Surface | Canonical Table | Why |
|-----------------|-----------------|-----|
| **V1 Leaderboard (CLOB-only)** | `pm_unified_ledger_v9_clob_tbl` | Fixed missing CLOB trades issue |
| **Full PnL (all event types)** | `pm_unified_ledger_v8_tbl` | Has CTF events (merge/split/redemption) |

### Why V9 CLOB for Leaderboard V1

1. **V8 was missing CLOB trades** - discovered during validation
2. **V9 CLOB-only was built to fix this** - remapped from deduplicated staging
3. **V1 leaderboard targets CLOB-only wallets** - the majority of the wallet universe
4. **Higher accuracy achieved** - V9 CLOB fixed the trade coverage gap

### When to use V8 Full Ledger

- Future products requiring CTF events (splits, merges, redemptions)
- Full cash accounting (CashFull definition)
- Wallets with significant non-CLOB activity

### Code Constants

`lib/pnl/dataSourceConstants.ts` exports both:
```typescript
export const UNIFIED_LEDGER_TABLE = 'pm_unified_ledger_v8_tbl';      // Full ledger
export const CLOB_ONLY_LEDGER_TABLE = 'pm_unified_ledger_v9_clob_tbl'; // V1 Leaderboard
```

**Rule:** For V1 Leaderboard work, use `CLOB_ONLY_LEDGER_TABLE`.

---

## V12 Canonical Table Chain

These are the ONLY tables that should be used for V12 PnL calculations:

```
pm_trader_events_v2 (raw CLOB events)
        ↓
pm_unified_ledger_v8_tbl (pre-joined ledger with payout_norm)
        ↓
[V12 engine queries]
        ↓
Tier A Comparable wallets
```

### Required Objects for V12

| Object | Type | Status | Rows | Purpose |
|--------|------|--------|------|---------|
| `pm_trader_events_v2` | TABLE | **CANONICAL** | 823M | Raw CLOB trade events (has duplicates, use GROUP BY event_id) |
| `pm_unified_ledger_v8_tbl` | TABLE | **CANONICAL** | 406M | Pre-joined ledger with usdc_delta, token_delta, payout_norm |
| `pm_token_to_condition_map_v5` | TABLE | **CANONICAL** | 400K | Token ID → condition_id + outcome_index mapping |
| `pm_condition_resolutions` | TABLE | **CANONICAL** | 213K | Condition resolution data (payout_numerators) |

### Supporting Objects

| Object | Type | Status | Purpose |
|--------|------|--------|---------|
| `pm_condition_resolutions_norm` | VIEW | SUPPORTING | Normalized resolution view |
| `pm_market_metadata` | TABLE | SUPPORTING | Market details (question, slug, etc.) |
| `pm_ui_pnl_benchmarks_v2` | TABLE | SUPPORTING | UI PnL benchmark snapshots for validation |
| `pm_wallet_volume_classification_v1` | TABLE | SUPPORTING | Wallet volume classification |
| `trader_strict_classifier_v1` | VIEW | SUPPORTING | Trader type classification |

---

## Full Inventory

### Tables - CANONICAL

| Name | Rows | Status | Notes |
|------|------|--------|-------|
| `pm_trader_events_v2` | 823,699,516 | **CANONICAL** | Raw CLOB. ALWAYS dedupe with GROUP BY event_id |
| `pm_unified_ledger_v8_tbl` | 406,565,404 | **CANONICAL** | Primary ledger for V12 queries |
| `pm_token_to_condition_map_v5` | 400,155 | **CANONICAL** | Token mapping. Replaces v3, v4 |
| `pm_condition_resolutions` | 213,249 | **CANONICAL** | Resolution data |

### Tables - SUPPORTING

| Name | Rows | Status | Notes |
|------|------|--------|-------|
| `pm_market_metadata` | 200,099 | SUPPORTING | Market info |
| `pm_ui_pnl_benchmarks_v2` | 155 | SUPPORTING | Benchmark snapshots |
| `pm_wallet_volume_classification_v1` | 1,682,457 | SUPPORTING | Volume classification |
| `pm_trader_events_dedup_v2_tbl` | 450,892,852 | SUPPORTING | Deduplicated events |

### Tables - DEPRECATED

| Name | Rows | Status | Replacement |
|------|------|--------|-------------|
| `pm_cascadian_pnl_v1_old` | 24,695,013 | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_cascadian_pnl_v1_new` | 58,771,998 | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_cascadian_pnl_v2` | 60,667,221 | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_token_to_condition_map_v3` | 358,617 | DEPRECATED | pm_token_to_condition_map_v5 |
| `pm_ui_pnl_benchmarks_v1` | 152 | DEPRECATED | pm_ui_pnl_benchmarks_v2 |

### Tables - ARCHIVE_CANDIDATE

| Name | Rows | Status | Notes |
|------|------|--------|-------|
| `pm_market_data_quality` | 2 | ARCHIVE_CANDIDATE | Minimal data, unclear use |
| `pm_token_to_condition_patch` | 500 | ARCHIVE_CANDIDATE | Patch data, likely obsolete |
| `pm_ui_pnl_by_market_v1` | 49 | ARCHIVE_CANDIDATE | Old market-level data |
| `pm_ui_pnl_by_market_v2` | 78 | ARCHIVE_CANDIDATE | Old market-level data |
| `pm_wallet_classification` | 196 | ARCHIVE_CANDIDATE | Superseded by v1 |
| `pm_wallet_classification_v1` | n/a | ARCHIVE_CANDIDATE | Empty/unused |
| `pm_wallet_condition_ledger_v9` | 939,017 | ARCHIVE_CANDIDATE | Unclear purpose |
| `pm_wallet_pnl_ui_activity_v1` | 7 | ARCHIVE_CANDIDATE | Minimal data |
| `pm_wallet_profiles_v1` | n/a | ARCHIVE_CANDIDATE | Empty/unused |
| `tmp_unified_ledger_test_rebuild` | 2,353 | ARCHIVE_CANDIDATE | Test data |

### Tables - SUPPORTING (V9 CLOB-only variants)

V9 tables are CLOB-only subsets for "pure trader" calculations. See [Version Rationale](#version-rationale-why-v8-is-canonical).

| Name | Rows | Status | Notes |
|------|------|--------|-------|
| `pm_unified_ledger_v9_clob_tbl` | 534,574,393 | SUPPORTING | CLOB-only ledger (exported in `dataSourceConstants.ts`) |
| `pm_unified_ledger_v9_clob_nodrop_tbl` | 467,298,422 | SUPPORTING | CLOB no-drop variant |

### Tables - ARCHIVE_CANDIDATE (V8/V9 Migration Artifacts)

| Name | Rows | Status | Notes |
|------|------|--------|-------|
| `pm_unified_ledger_v8_new` | n/a | ARCHIVE_CANDIDATE | Empty migration artifact |
| `pm_unified_ledger_v8_recent` | n/a | ARCHIVE_CANDIDATE | Empty recent subset |
| `pm_unified_ledger_v9_clob_clean_tbl` | 11,549,304 | ARCHIVE_CANDIDATE | Superseded by v9_clob_tbl |
| `pm_unified_ledger_v9_clob_from_v2_tbl` | n/a | ARCHIVE_CANDIDATE | Empty migration artifact |

---

## Views Inventory

### Views - CANONICAL

| Name | Status | Notes |
|------|--------|-------|
| `pm_condition_resolutions_norm` | SUPPORTING | Normalized resolutions |
| `trader_strict_classifier_v1` | SUPPORTING | Trader classification |

### Views - DEPRECATED (Old Ledger Versions)

| Name | Status | Replacement |
|------|--------|-------------|
| `pm_unified_ledger_v4` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_unified_ledger_v5` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_unified_ledger_v6` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_unified_ledger_v7` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `pm_unified_ledger_v8` | DEPRECATED | pm_unified_ledger_v8_tbl (use table, not view) |
| `pm_unified_ledger_v9` | DEPRECATED | pm_unified_ledger_v8_tbl |

### Views - DEPRECATED (Old Realized PnL)

| Name | Status | Replacement |
|------|--------|-------------|
| `vw_pm_realized_pnl_v1` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v2` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v2_with_quality` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v3` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v3_detail` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v3_detail_with_quality` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v3_market` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v3_with_quality` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v4` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v4_with_quality` | DEPRECATED | V12 engine queries |
| `vw_pm_realized_pnl_v5` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_v7` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_v7_ctf` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_v7_txhash` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_v8_proxy` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_v9_proxy` | DEPRECATED | V12 engine queries |
| `vw_realized_pnl_clob_only` | DEPRECATED | V12 engine queries |

### Views - DEPRECATED (Old General Views)

| Name | Status | Replacement |
|------|--------|-------------|
| `pm_token_to_condition_map_v4` | DEPRECATED | pm_token_to_condition_map_v5 |
| `vw_pm_ledger` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `vw_pm_ledger_v2` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `vw_pm_ledger_v3` | DEPRECATED | pm_unified_ledger_v8_tbl |
| `vw_pm_wallet_pnl_v1` | DEPRECATED | V12 engine queries |
| `vw_pm_market_pnl_v1` | DEPRECATED | V12 engine queries |

### Views - ARCHIVE_CANDIDATE

| Name | Status | Notes |
|------|--------|-------|
| `pm_unified_ledger_v9_clob_maker_vw` | ARCHIVE_CANDIDATE | V9 maker view |
| `vw_ctf_ledger` | ARCHIVE_CANDIDATE | CTF-specific |
| `vw_ctf_ledger_proxy` | ARCHIVE_CANDIDATE | CTF proxy |
| `vw_ctf_ledger_user` | ARCHIVE_CANDIDATE | CTF user |
| `vw_pm_ctf_ledger` | ARCHIVE_CANDIDATE | PM CTF |
| `vw_pm_pnl_with_ctf` | ARCHIVE_CANDIDATE | Old CTF integration |
| `vw_pm_resolution_prices` | ARCHIVE_CANDIDATE | Old resolution view |
| `vw_pm_retail_wallets_v1` | ARCHIVE_CANDIDATE | Old wallet classification |
| `vw_pm_trader_events_wallet_dedup_v1` | ARCHIVE_CANDIDATE | Old dedup |
| `vw_pm_trader_events_wallet_dedup_v2` | ARCHIVE_CANDIDATE | Old dedup |
| `vw_pm_wallet_summary_with_ctf` | ARCHIVE_CANDIDATE | Old summary |
| `vw_tierA_pnl_by_category` | ARCHIVE_CANDIDATE | Superseded |
| `vw_tierA_realized_pnl_summary` | ARCHIVE_CANDIDATE | Superseded |
| `vw_wallet_pnl_archive` | ARCHIVE_CANDIDATE | Archive view |
| `vw_wallet_pnl_ui_activity_v1` | ARCHIVE_CANDIDATE | Activity view |

---

## Archive Plan

### Phase 1: Move to Archive Namespace (Safe)

Create database `pm_archive_2025_12` and move these objects:

**Tables:**
- `pm_cascadian_pnl_v1_old`
- `pm_cascadian_pnl_v1_new`
- `pm_cascadian_pnl_v2`
- `pm_token_to_condition_map_v3`
- `pm_ui_pnl_benchmarks_v1`
- All `tmp_*` tables

**Views:**
- All `pm_unified_ledger_v4` through `v7` views
- All `vw_pm_realized_pnl_v1` through `v5` views

### Phase 2: Archive After V12 Stabilization

**Tables:**
- `pm_wallet_classification`
- `pm_ui_pnl_by_market_v1`
- `pm_ui_pnl_by_market_v2`

**Views:**
- All remaining `vw_*` views except `trader_strict_classifier_v1`

### Phase 3: Evaluate V9 Experimental Tables

After V12 validation complete:
- Evaluate if V9 tables provide value
- If not, archive entire V9 series

---

## Canonical Tables TypeScript Export

For scripts to import:

```typescript
// lib/pnl/canonicalTables.ts
export const CANONICAL_TABLES = {
  // Event sources
  TRADER_EVENTS: 'pm_trader_events_v2',

  // Ledger (primary)
  UNIFIED_LEDGER: 'pm_unified_ledger_v8_tbl',

  // Mapping and resolution
  TOKEN_MAP: 'pm_token_to_condition_map_v5',
  RESOLUTIONS: 'pm_condition_resolutions',

  // Supporting
  MARKET_METADATA: 'pm_market_metadata',
  UI_BENCHMARKS: 'pm_ui_pnl_benchmarks_v2',
  VOLUME_CLASSIFICATION: 'pm_wallet_volume_classification_v1',
} as const;

export type CanonicalTable = typeof CANONICAL_TABLES[keyof typeof CANONICAL_TABLES];
```

---

## Related Documents

- [PNL_VOCABULARY_V1.md](./PNL_VOCABULARY_V1.md) - Definitions
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - Wallet classification
- [../database/STABLE_PACK_REFERENCE.md](../database/STABLE_PACK_REFERENCE.md) - Full database reference
