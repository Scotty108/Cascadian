# ClickHouse Table Audit - January 7, 2026

## Summary
- **Total Tables:** 96
- **Total Size:** 266.43 GB
- **Recommendation:** Archive ~113 GB, Keep ~153 GB

---

## TIER 1: ESSENTIAL (KEEP) - 141 GB

These tables are actively used in production and must be kept.

| Table | Size | Rows | Purpose |
|-------|------|------|---------|
| `pm_trader_events_v3` | 57.21 GB | 645M | **CANONICAL** - Deduplicated CLOB events (V3) |
| `pm_unified_ledger_v9_clob_tbl` | 29.47 GB | 534M | CLOB-only unified ledger |
| `pm_unified_ledger_v8_tbl` | 20.17 GB | 406M | Full unified ledger (with CTF) |
| `pm_ctf_events` | 9.78 GB | 183M | CTF events (splits/merges/redemptions) |
| `pm_erc1155_transfers` | 2.02 GB | 48M | ERC1155 token transfers |
| `pm_ctf_split_merge_expanded` | 1.99 GB | 31M | Expanded CTF events |
| `pm_trade_clv_features_60d` | 1.72 GB | 75M | CLV features |
| `clob_tx_hash_index` | 1.0 GB | 38M | Transaction hash index |
| `pm_ctf_flows_inferred` | 529 MB | 10M | Inferred CTF flows |
| `pm_redemption_payouts_agg` | 472 MB | 12M | Redemption aggregates |
| `pm_wallet_condition_realized_v1` | 447 MB | 9M | Wallet condition PnL |
| `wallet_daily_stats_v2` | 276 MB | 7M | Daily stats |
| `markout_14d_fills` | 270 MB | 14M | Markout analysis |
| `pm_fpmm_trades` | 196 MB | 2M | FPMM trades |
| `pm_erc20_usdc_flows` | 180 MB | 6M | USDC flows |
| `pm_price_snapshots_15m` | 158 MB | 9M | Price snapshots |
| `pm_wallet_clob_eligibility_v1` | 128 MB | 1.7M | CLOB eligibility |
| `pm_market_metadata` | 93 MB | 300K | Market metadata |
| `pm_wallet_volume_classification_v1` | 65 MB | 1.7M | Volume classification |
| `pm_token_to_condition_map_v5` | 47 MB | 594K | **CANONICAL** Token mapping |
| `pm_condition_resolutions` | 32 MB | 300K | Resolution data |
| `pm_latest_mark_price_v1` | 7 MB | 351K | Mark prices |

**Subtotal: ~141 GB**

---

## TIER 2: ARCHIVE CANDIDATES - 113 GB

These tables are superseded or deprecated. Move to archive database before deletion.

| Table | Size | Rows | Reason |
|-------|------|------|--------|
| `pm_trader_events_v2` | **82.04 GB** | 995M | **Superseded by V3** - Keep for MV sync, truncate old data |
| `pm_unified_ledger_v9_clob_nodrop_tbl` | 30.82 GB | 467M | Experimental V9 variant |
| `pm_cascadian_pnl_v2` | 2.50 GB | 60M | Old PnL table |
| `pm_cascadian_pnl_v1_new` | 2.40 GB | 58M | Old PnL table |
| `wallet_identity_map` | 1.66 GB | 55M | Old wallet identity system |
| `pm_cascadian_pnl_v1_old` | 1.01 GB | 24M | Old PnL table |
| `pm_unified_ledger_v9_clob_clean_tbl` | 786 MB | 11M | Experimental V9 variant |

**Subtotal: ~113 GB**

---

## TIER 3: SAFE TO DELETE - ~12 GB

These tables are backups, archived, or no longer needed.

| Table | Size | Reason |
|-------|------|--------|
| `pm_user_positions_v2_archived_20260107` | 101 MB | Already archived |
| `pm_token_to_condition_map_v3_archived_20260107` | 25 MB | Already archived |
| `pm_hc_leaderboard_cohort_all_v1_backup_*` | 3 MB | Backup tables |
| `pm_wallet_trade_stats` | 97 MB | Superseded by v1 |
| `wallet_daily_stats_v1` | 47 MB | Superseded by v2 |
| Various small tables | <10 MB | Experimental/test |

**Subtotal: ~12 GB**

---

## Recommended Actions

### 1. Archive V2 Data (Safest Approach)

Since code now uses V3, V2 can be archived but we need to keep recent data for the MV sync.

```sql
-- Option A: Keep last 30 days in V2, archive the rest
CREATE TABLE pm_trader_events_v2_archive AS pm_trader_events_v2;
INSERT INTO pm_trader_events_v2_archive SELECT * FROM pm_trader_events_v2 WHERE trade_time < now() - INTERVAL 30 DAY;
ALTER TABLE pm_trader_events_v2 DELETE WHERE trade_time < now() - INTERVAL 30 DAY;

-- Option B: Just truncate old data (no archive)
ALTER TABLE pm_trader_events_v2 DELETE WHERE trade_time < now() - INTERVAL 30 DAY;
```

### 2. Delete Superseded Ledger Tables

```sql
DROP TABLE pm_unified_ledger_v9_clob_nodrop_tbl;
DROP TABLE pm_unified_ledger_v9_clob_clean_tbl;
```

### 3. Archive Old PnL Tables

```sql
-- Rename to archive
RENAME TABLE pm_cascadian_pnl_v1_old TO pm_cascadian_pnl_v1_old_archived;
RENAME TABLE pm_cascadian_pnl_v1_new TO pm_cascadian_pnl_v1_new_archived;
RENAME TABLE pm_cascadian_pnl_v2 TO pm_cascadian_pnl_v2_archived;
```

### 4. Delete Already-Archived Tables

```sql
DROP TABLE pm_user_positions_v2_archived_20260107;
DROP TABLE pm_token_to_condition_map_v3_archived_20260107;
DROP TABLE pm_hc_leaderboard_cohort_all_v1_backup_20251213_1453;
DROP TABLE pm_hc_leaderboard_cohort_all_v1_backup_20251213_1531;
```

---

## Expected Savings

| Action | Savings |
|--------|---------|
| Archive old V2 data | ~70-75 GB |
| Delete nodrop/clean ledger tables | ~31 GB |
| Delete old PnL tables | ~6 GB |
| Delete backups/archived | ~0.3 GB |
| **Total Potential Savings** | **~107-112 GB** |

---

## V2→V3 Migration Status

✅ Updated `lib/pnl/dataSourceConstants.ts` → V3
✅ Updated `lib/pnl/canonicalTables.ts` → V3
✅ Updated 49 lib/pnl engine files → V3
✅ Removed `is_deleted = 0` filters (V3 doesn't have this column)
✅ MV `pm_trader_events_v3_mv` syncs new V2 inserts to V3

---

## Actions Taken (January 7, 2026)

### ✅ Code Migration (V2 → V3)
- Updated `lib/pnl/dataSourceConstants.ts` - TRADER_EVENTS_TABLE now points to V3
- Updated `lib/pnl/canonicalTables.ts` - TRADER_EVENTS now points to V3
- Updated 49 lib/pnl engine files to use `pm_trader_events_v3`
- Removed `is_deleted = 0` filters (V3 doesn't have this column)

### ✅ Deleted Tables (130 MB saved)
- `pm_user_positions_v2_archived_20260107` (101 MB)
- `pm_token_to_condition_map_v3_archived_20260107` (25 MB)
- `pm_hc_leaderboard_cohort_all_v1_backup_20251213_1453` (1.5 MB)
- `pm_hc_leaderboard_cohort_all_v1_backup_20251213_1531` (1.5 MB)

### ✅ Archived Tables (39 GB marked for future deletion)
- `pm_unified_ledger_v9_clob_nodrop_tbl` → `..._archived` (30.8 GB)
- `pm_unified_ledger_v9_clob_clean_tbl` → `..._archived` (786 MB)
- `pm_cascadian_pnl_v1_old` → `..._archived` (1.0 GB)
- `pm_cascadian_pnl_v1_new` → `..._archived` (2.4 GB)
- `pm_cascadian_pnl_v2` → `..._archived` (2.5 GB)
- `wallet_identity_map` → `..._archived` (1.7 GB)

### ⏸️ V2 Truncation (Deferred)
Keeping V2 intact for safety. The MV (`pm_trader_events_v3_mv`) syncs new data.
To truncate later:
```sql
-- After confirming V3 is working in production for 1+ week:
ALTER TABLE pm_trader_events_v2 DELETE WHERE trade_time < now() - INTERVAL 30 DAY;
-- Expected savings: ~75 GB
```

### Final Storage
- Before: 266.43 GB
- After: 248.01 GB
- Saved: ~18 GB (more available by deleting archived tables)

---

Generated: 2026-01-07
