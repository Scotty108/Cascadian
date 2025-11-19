# DATABASE AUDIT - EXECUTIVE SUMMARY

**Audit Date:** 2025-11-10  
**Auditor:** Database Analysis Agent  
**Database:** Cascadian Polymarket Data Warehouse  
**Schemas:** `default` (48 tables, 54 views), `cascadian_clean` (13 tables, 44 views)

---

## 🎯 EXECUTIVE SUMMARY

**Status:** 🟡 PARTIAL DATA WAREHOUSE (40% complete)

**What Works:**
- ✅ Complete USDC transfer data (388M rows, 1.5 years)
- ✅ Substantial trade coverage (63M trades, 996K wallets)
- ✅ PNL calculations for 96% of wallets (935K wallets)
- ✅ Multiple resolution data sources (544K total)

**Critical Issues:**
1. ❌ **ERC1155 Gap:** Only 2.9% of expected blockchain data (291K of ~10M)
2. ❌ **Wallet Coverage:** Test wallet missing 96.7% of trades (31 vs 2,816)
3. ⚠️ **Table Clutter:** 7.5 GB backups/duplicates to delete
4. ⚠️ **View Sprawl:** 98 views with massive overlap (61% deletable)

---

## 📊 KEY METRICS

| Metric | Value | Status |
|--------|-------|--------|
| Total Tables | 61 | ⚠️ 11 deletable |
| Total Views | 98 | ⚠️ 60 deletable |
| Total Size | ~40 GB | ⚠️ 7.5 GB recoverable |
| Trade Coverage | 63M trades | ⚠️ Incomplete |
| Wallet Coverage | 996K wallets | ✅ Good |
| Resolution Data | 544K rows | ✅ Comprehensive |
| ERC1155 Coverage | 2.9% | ❌ Critical gap |

---

## 🚨 CRITICAL FINDINGS

### Finding #1: ERC1155 Transfer Gap (Severity: CRITICAL)

**Problem:**
- Expected: 10M+ ERC1155 transfers (Polymarket conditional tokens)
- Actual: 291,113 transfers (2.9% of expected)
- Impact: Cannot validate trade→market mapping, wallet analytics incomplete

**Root Cause:**
- Incomplete blockchain backfill from Polygon
- Only recent transfers indexed

**Solution:**
- Run `backfill-all-goldsky-payouts.ts` (4-8 hours, Goldsky API)
- OR run `backfill-missing-erc1155-parallel.ts` (48-72 hours, blockchain RPC)
- Recommended: Goldsky first, then fill gaps via RPC

**Business Impact:**
- 96.7% of wallet trades unmapped
- Market analytics unreliable
- PNL calculations potentially inaccurate

---

### Finding #2: Test Wallet Coverage Gap (Severity: HIGH)

**Test Case:**
- Wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad
- Expected (Polymarket UI): 2,816 trades
- Actual (DB): 31-93 trades depending on table
- Coverage: 1.1%-3.3%

**Analysis:**
- Directly linked to ERC1155 gap
- Suggests systemic issue affecting all wallets
- Trade tables claim 100% condition ID coverage but data incomplete

**Validation:**
After ERC1155 backfill completes, re-query test wallet to confirm fix.

---

### Finding #3: Table Clutter (Severity: MEDIUM)

**Backup Tables:**
- `cascadian_clean.fact_trades_BROKEN_CIDS` (4.36 GB)
- `cascadian_clean.fact_trades_backup` (2.80 GB)
- Total: 7.2 GB

**Empty Tables:**
- `default.api_trades_staging`
- `default.clob_fills_staging`
- `default.market_event_mapping`

**Old Versions:**
- `default.outcome_positions_v2` (305 MB)
- `*_v2` tables (NULL data, 5 tables)

**Total Recoverable:** 7.5 GB

**Recommendation:** Delete immediately after verifying primary tables are good.

---

### Finding #4: View Sprawl (Severity: LOW)

**Current State:**
- 98 total views (54 default, 44 cascadian_clean)
- 30 PNL views (need 3-4)
- 15 resolution views (need 2-3)
- 13 trade views (need 2-3)

**Recommended Action:**
- Delete 60 views (61% reduction)
- Keep 38 canonical views
- Document canonical view usage

**Effort:** 4-5 hours (backup, search usage, delete, document)

---

## 📋 RECOMMENDED ACTIONS

### Immediate (Do Today - 2 hours)

1. **Delete Backup Tables** (30 min)
   ```sql
   DROP TABLE cascadian_clean.fact_trades_BROKEN_CIDS;
   DROP TABLE cascadian_clean.fact_trades_backup;
   DROP TABLE default.outcome_positions_v2;
   -- + 8 more (see full report)
   ```
   **Recovers:** 7.5 GB

2. **Start ERC1155 Backfill** (90 min setup + 4-8 hours runtime)
   ```bash
   npx tsx backfill-all-goldsky-payouts.ts
   ```
   **Fixes:** 97% data gap

### Short-Term (This Week - 8 hours)

3. **Validate Test Wallet After Backfill** (15 min)
   - Re-query wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad
   - Expect: 2,816 trades
   - Verify: Market mappings work

4. **Consolidate Trade Tables** (2 hours)
   - Choose `cascadian_clean.fact_trades_clean` as canonical
   - Validate against `default.fact_trades_clean`
   - Drop default version if redundant

5. **View Cleanup** (4-5 hours)
   - Backup view definitions
   - Search codebase for usage
   - Delete 60 obsolete views
   - Document 38 canonical views

### Medium-Term (Next 2 Weeks - 12 hours)

6. **Consolidate Resolution Tables** (3 hours)
   - Validate `default.staging_resolutions_union` (544K rows)
   - Create single canonical view
   - Deprecate overlapping sources

7. **Backfill Market Metadata** (2 hours)
   ```bash
   npx tsx backfill-all-markets-global.ts
   ```
   - Enrich `markets_dim` (5.7K → 161K markets)

8. **Schema Consolidation Planning** (4 hours)
   - Decide: Keep both schemas or merge?
   - Document schema separation rationale
   - Plan migration if consolidating

9. **Data Quality Monitoring** (3 hours)
   - Fix ERC1155 timestamp anomaly (1970-01-01)
   - Add row count monitoring
   - Set up daily validation checks

---

## 📁 CANONICAL TABLE REFERENCE

Use these tables (others are duplicates or backups):

| Purpose | Table | Rows | Notes |
|---------|-------|------|-------|
| **Trades** | `cascadian_clean.fact_trades_clean` | 63.5M | Primary fact table |
| **Mappings** | `cascadian_clean.token_condition_market_map` | 228K | Token→Condition→Market |
| **Resolutions** | `default.staging_resolutions_union` | 544K | Union of all sources |
| **Markets** | `default.api_markets_staging` | 161K | Full API data |
| **Wallets** | `default.wallet_metrics` | 996K | Wallet analytics |
| **PNL** | `default.wallet_pnl_summary_final` | 935K | Wallet PNL summaries |
| **USDC** | `default.erc20_transfers_staging` | 388M | Complete USDC transfers |
| **ERC1155** | `default.erc1155_transfers` | 291K | ❌ Incomplete, needs backfill |

---

## 📈 ESTIMATED TIMELINE

| Phase | Tasks | Time | Priority |
|-------|-------|------|----------|
| **Cleanup** | Delete 7.5 GB of garbage | 1 hour | P0 |
| **Backfill** | ERC1155 transfers (Goldsky) | 4-8 hours | P0 |
| **Validation** | Test wallet verification | 15 min | P0 |
| **Consolidation** | Trade tables | 2 hours | P1 |
| **View Cleanup** | Delete 60 views | 4-5 hours | P1 |
| **Resolution Consolidation** | Canonical resolution view | 3 hours | P2 |
| **Market Metadata** | Backfill from API | 2 hours | P2 |
| **Schema Planning** | Architecture decisions | 4 hours | P2 |
| **Monitoring** | Data quality checks | 3 hours | P3 |
| **Total** | | **19-24 hours** | |

**Estimated Completion:** 1-2 weeks with proper checkpointing

---

## 🎯 SUCCESS CRITERIA

**Phase 1 Complete When:**
- ✅ 7.5 GB of backup tables deleted
- ✅ ERC1155 backfill running with checkpoints
- ✅ Test wallet shows 2,816 trades (up from 31)
- ✅ 60 obsolete views deleted
- ✅ Single canonical fact table chosen

**Phase 2 Complete When:**
- ✅ Single canonical resolution view documented
- ✅ Market metadata complete (161K markets)
- ✅ Schema consolidation plan documented
- ✅ Data quality monitoring active

**Production Ready When:**
- ✅ ERC1155 coverage >95%
- ✅ Wallet trade coverage >95%
- ✅ All canonical tables/views documented
- ✅ Daily incremental refresh running

---

## 📚 DOCUMENTATION GENERATED

1. **`database-audit-report.md`** (29 KB) - Full detailed audit
2. **`DATABASE_AUDIT_QUICK_SUMMARY.md`** (5 KB) - Quick reference
3. **`VIEW_AUDIT_RECOMMENDATIONS.md`** (15 KB) - View cleanup plan
4. **`audit-results.txt`** (4 KB) - Raw query results
5. **`view-inventory.txt`** (5 KB) - Complete view list

**Total Documentation:** 58 KB

---

## 🚀 NEXT AGENT: QUICK START

1. **Read this file first** - You're reading it now
2. **Read:** `DATABASE_AUDIT_QUICK_SUMMARY.md` for action items
3. **Execute:** SQL cleanup script (7.5 GB)
4. **Start:** ERC1155 backfill (4-8 hours)
5. **Validate:** Test wallet after backfill
6. **Full Report:** See `database-audit-report.md` for details

---

**Audit Complete:** 2025-11-10  
**Files Located:** `/Users/scotty/Projects/Cascadian-app/`  
**Status:** Ready for cleanup and backfill
