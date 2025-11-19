# DATABASE AUDIT - QUICK SUMMARY

**Status:** 🟡 PARTIAL DATA WAREHOUSE  
**Date:** 2025-11-10

---

## 3 CRITICAL ISSUES

1. **ERC1155 Gap:** Only 291K of ~10M transfers (2.9% complete) ❌
2. **Wallet Coverage:** Test wallet has 31 trades vs 2,816 expected (96.7% missing) ❌
3. **Table Clutter:** 7.5 GB of backups/duplicates to delete ⚠️

---

## QUICK WINS (Do Today)

### Delete These Tables (Recover 7.5 GB)
```sql
-- Empty tables
DROP TABLE default.api_trades_staging;
DROP TABLE default.clob_fills_staging;
DROP TABLE default.market_event_mapping;

-- Backups (7.2 GB)
DROP TABLE cascadian_clean.fact_trades_BROKEN_CIDS;  -- 4.36 GB
DROP TABLE cascadian_clean.fact_trades_backup;       -- 2.80 GB

-- Old versions
DROP TABLE default.outcome_positions_v2;             -- 305 MB
DROP TABLE default.resolved_trades_v2;
DROP TABLE default.trade_flows_v2;
DROP TABLE default.wallet_pnl_summary_v2;
DROP TABLE default.wallet_unrealized_pnl_v2;
DROP TABLE default.vw_wallet_pnl_calculated_backup;
```

---

## URGENT BACKFILL (Do This Week)

### Priority 1: ERC1155 Transfers
- **Script:** `backfill-missing-erc1155-parallel.ts` OR `backfill-all-goldsky-payouts.ts`
- **Time:** 4-8 hours (Goldsky) OR 48-72 hours (blockchain RPC)
- **Why:** Enables trade→market mapping, unlocks full analytics

### Priority 2: Validate Test Wallet
- **Script:** `backfill-wallet-trades-comprehensive.ts`
- **Time:** 5-10 minutes
- **Why:** Verify if backfill fixes coverage issue

---

## DATA INVENTORY

| Category | What | Rows | Status |
|----------|------|------|--------|
| **Source Data** | ERC20 (USDC) | 388M | ✅ Complete |
| | ERC1155 (Tokens) | 291K | ❌ 2.9% complete |
| **Trades** | fact_trades_clean | 63.5M | ⚠️ 100% have CID but can't validate |
| | vw_trades_canonical | 157M | ⚠️ Inflated, likely duplicates |
| **Mappings** | token→condition→market | 228K | ⚠️ Limited by ERC1155 gap |
| **Resolutions** | Union of all sources | 544K | ✅ Looks comprehensive |
| **Dimensions** | Wallets | 996K | ✅ Good coverage |
| | Markets (dim) | 5,781 | ⚠️ Filtered subset |
| | Markets (staging) | 161K | ✅ Full API data |
| **PNL** | Wallet summaries | 935K | ✅ 96% of wallets |

---

## CANONICAL TABLES (Use These)

| Purpose | Table | Notes |
|---------|-------|-------|
| **Trades** | `cascadian_clean.fact_trades_clean` | 63.5M rows, primary fact table |
| **Mappings** | `cascadian_clean.token_condition_market_map` | 228K rows, most comprehensive |
| **Resolutions** | `default.staging_resolutions_union` | 544K rows, union of all sources |
| **Markets** | `default.api_markets_staging` | 161K rows, full API data |
| **Wallets** | `default.wallet_metrics` | 996K rows |
| **PNL** | `default.wallet_pnl_summary_final` | 935K rows |

---

## NEXT AGENT: START HERE

1. **Read:** `/Users/scotty/Projects/Cascadian-app/database-audit-report.md` (full report)
2. **Delete:** Run SQL above (7.5 GB cleanup)
3. **Backfill:** Run `backfill-all-goldsky-payouts.ts` (8 hours, fixes 97% gap)
4. **Validate:** Check test wallet again after backfill
5. **Consolidate:** Pick one fact table (cascadian_clean), deprecate default version
6. **Audit Views:** 98 views need assessment (see full report)

---

## FILE LOCATIONS

- **Full Report:** `database-audit-report.md`
- **Audit Results:** `audit-results.txt`
- **Scripts:** `/backfill-*.ts` (root), `/scripts/backfill-*.ts`
- **Checkpoints:** `blockchain-backfill-checkpoint-*.json`

---

**For full details:** See `database-audit-report.md`
