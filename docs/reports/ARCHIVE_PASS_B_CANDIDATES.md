# Archive Pass B Candidates

> **Status:** PENDING GREP SAFETY CHECK | **Created:** 2025-12-09

This document lists database objects from PERSISTED_OBJECTS_MANIFEST.md marked as ARCHIVE_CANDIDATE. **Do NOT archive any object until the grep safety check passes.**

---

## Safety Check Required

Before archiving ANY object, run:

```bash
OBJECT_NAME="object_name_here"

echo "=== Checking references for: $OBJECT_NAME ==="
grep -r "$OBJECT_NAME" lib/pnl/ scripts/pnl/ 2>/dev/null
grep "$OBJECT_NAME" lib/pnl/dataSourceConstants.ts 2>/dev/null
```

**If ANY references are found, DO NOT archive.**

---

## Tables - ARCHIVE_CANDIDATE

| Name | Rows | Notes | Grep Status |
|------|------|-------|-------------|
| `pm_market_data_quality` | 2 | Minimal data, unclear use | PENDING |
| `pm_token_to_condition_patch` | 500 | Patch data, likely obsolete | PENDING |
| `pm_ui_pnl_by_market_v1` | 49 | Old market-level data | PENDING |
| `pm_ui_pnl_by_market_v2` | 78 | Old market-level data | PENDING |
| `pm_wallet_classification` | 196 | Superseded by v1 | PENDING |
| `pm_wallet_classification_v1` | n/a | Empty/unused | PENDING |
| `pm_wallet_condition_ledger_v9` | 939,017 | Unclear purpose | PENDING |
| `pm_wallet_pnl_ui_activity_v1` | 7 | Minimal data | PENDING |
| `pm_wallet_profiles_v1` | n/a | Empty/unused | PENDING |
| `tmp_unified_ledger_test_rebuild` | 2,353 | Test data | PENDING |

## Tables - V8/V9 Migration Artifacts (ARCHIVE_CANDIDATE)

| Name | Rows | Notes | Grep Status |
|------|------|-------|-------------|
| `pm_unified_ledger_v8_new` | n/a | Empty migration artifact | PENDING |
| `pm_unified_ledger_v8_recent` | n/a | Empty recent subset | PENDING |
| `pm_unified_ledger_v9_clob_clean_tbl` | 11,549,304 | Superseded by v9_clob_tbl | PENDING |
| `pm_unified_ledger_v9_clob_from_v2_tbl` | n/a | Empty migration artifact | PENDING |

## Views - ARCHIVE_CANDIDATE

| Name | Notes | Grep Status |
|------|-------|-------------|
| `pm_unified_ledger_v9_clob_maker_vw` | V9 maker view | PENDING |
| `vw_ctf_ledger` | CTF-specific | PENDING |
| `vw_ctf_ledger_proxy` | CTF proxy | PENDING |
| `vw_ctf_ledger_user` | CTF user | PENDING |
| `vw_pm_ctf_ledger` | PM CTF | PENDING |
| `vw_pm_pnl_with_ctf` | Old CTF integration | PENDING |
| `vw_pm_resolution_prices` | Old resolution view | PENDING |
| `vw_pm_retail_wallets_v1` | Old wallet classification | PENDING |
| `vw_pm_trader_events_wallet_dedup_v1` | Old dedup | PENDING |
| `vw_pm_trader_events_wallet_dedup_v2` | Old dedup | PENDING |
| `vw_pm_wallet_summary_with_ctf` | Old summary | PENDING |
| `vw_tierA_pnl_by_category` | Superseded | PENDING |
| `vw_tierA_realized_pnl_summary` | Superseded | PENDING |
| `vw_wallet_pnl_archive` | Archive view | PENDING |
| `vw_wallet_pnl_ui_activity_v1` | Activity view | PENDING |

---

## Objects NOT to Archive (Protected)

These are exported in `lib/pnl/dataSourceConstants.ts`:

- `pm_unified_ledger_v8_tbl` - CANONICAL (Full ledger)
- `pm_unified_ledger_v9_clob_tbl` - CANONICAL (V1 Leaderboard)
- `pm_trader_events_v2` - CANONICAL
- `pm_token_to_condition_map_v5` - CANONICAL
- `pm_condition_resolutions` - CANONICAL

---

## Next Steps

1. Run ripgrep safety sweep (Task 4)
2. Update "Grep Status" column for each object
3. Objects with no references can be archived to `pm_archive_2025_12` database
4. Create archive migration script after all checks pass
