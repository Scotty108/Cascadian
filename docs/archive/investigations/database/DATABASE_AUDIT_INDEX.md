# DATABASE AUDIT - MASTER INDEX

**Audit Completed:** 2025-11-10  
**Database:** Cascadian Polymarket Data Warehouse  
**Status:** 🟡 PARTIAL (40% complete, critical ERC1155 gap)

---

## 📚 QUICK NAVIGATION

| Document | Purpose | Size | When to Read |
|----------|---------|------|--------------|
| **[DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)** | High-level findings, action plan, timeline | 12 KB | **START HERE** |
| **[DATABASE_AUDIT_QUICK_SUMMARY.md](./DATABASE_AUDIT_QUICK_SUMMARY.md)** | One-page cheat sheet, canonical tables | 5 KB | Quick reference |
| **[database-audit-report.md](./database-audit-report.md)** | Full technical audit (29 KB) | 29 KB | Deep dive needed |
| **[VIEW_AUDIT_RECOMMENDATIONS.md](./VIEW_AUDIT_RECOMMENDATIONS.md)** | View cleanup plan (98→38 views) | 15 KB | Before view cleanup |
| **[audit-results.txt](./audit-results.txt)** | Raw query output | 4 KB | Reference data |
| **[view-inventory.txt](./view-inventory.txt)** | Complete view listing | 5 KB | View analysis |

**Total Documentation:** 70 KB

---

## 🎯 QUICK START (5 MINUTES)

### 1. Read This First
- **[DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)** (5 min read)
- Understand: 4 critical issues, 3 phases of work, 19-24 hour timeline

### 2. Delete Garbage (30 min)
```sql
-- Recover 7.5 GB immediately
DROP TABLE cascadian_clean.fact_trades_BROKEN_CIDS;  -- 4.36 GB
DROP TABLE cascadian_clean.fact_trades_backup;       -- 2.80 GB
DROP TABLE default.outcome_positions_v2;             -- 305 MB
-- + 8 more empty/old tables (see QUICK_SUMMARY.md)
```

### 3. Start ERC1155 Backfill (4-8 hours)
```bash
cd /Users/scotty/Projects/Cascadian-app
npx tsx backfill-all-goldsky-payouts.ts
```
This fixes the critical 97% data gap.

---

## 🚨 CRITICAL FINDINGS AT A GLANCE

| Issue | Severity | Impact | Time to Fix |
|-------|----------|--------|-------------|
| **ERC1155 Gap** | 🔴 CRITICAL | 97% of blockchain data missing | 4-8 hours |
| **Wallet Coverage** | 🔴 HIGH | 96.7% of trades unmapped | Fixed by above |
| **Table Clutter** | 🟡 MEDIUM | 7.5 GB wasted space | 30 minutes |
| **View Sprawl** | 🟢 LOW | 98 views (need 38) | 4-5 hours |

---

## 📊 DATA INVENTORY SNAPSHOT

### Source Data
- ✅ **ERC20 (USDC):** 388M transfers - COMPLETE
- ❌ **ERC1155 (Tokens):** 291K transfers - 2.9% COMPLETE (critical gap)

### Trades
- ⚠️ **fact_trades_clean:** 63.5M trades (100% claim CID coverage but can't validate)
- ⚠️ **vw_trades_canonical:** 157M trades (inflated, duplicates)

### Mappings
- ⚠️ **token_condition_market_map:** 228K rows (limited by ERC1155 gap)

### Resolutions
- ✅ **staging_resolutions_union:** 544K rows (comprehensive)

### Dimensions
- ✅ **Wallets:** 996K wallets
- ⚠️ **Markets:** 5.7K (filtered) vs 161K (full API data available)

### PNL
- ✅ **wallet_pnl_summary_final:** 935K wallets (96% coverage)

---

## 📁 FILE STRUCTURE

```
/Users/scotty/Projects/Cascadian-app/
├── DATABASE_AUDIT_INDEX.md                 ← YOU ARE HERE
├── DATABASE_AUDIT_EXECUTIVE_SUMMARY.md     ← START HERE
├── DATABASE_AUDIT_QUICK_SUMMARY.md         ← Quick reference
├── database-audit-report.md                ← Full 29 KB report
├── VIEW_AUDIT_RECOMMENDATIONS.md           ← View cleanup plan
├── audit-results.txt                       ← Raw query output
├── view-inventory.txt                      ← View listing
├── comprehensive-db-audit.ts               ← Audit script (can re-run)
├── final-comprehensive-audit.ts            ← Audit script (can re-run)
├── list-all-views.ts                       ← View inventory script
└── backfill-all-goldsky-payouts.ts         ← ERC1155 backfill script
```

---

## 🎯 RECOMMENDED READING ORDER

### For Next Agent (30 min reading + 1 hour work)
1. **[DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)** (5 min)
2. **[DATABASE_AUDIT_QUICK_SUMMARY.md](./DATABASE_AUDIT_QUICK_SUMMARY.md)** (3 min)
3. Execute table cleanup SQL (30 min)
4. Start ERC1155 backfill (5 min setup, 4-8 hours runtime)
5. Return when backfill completes for validation

### For Deep Dive (2 hours reading)
1. **[DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)** (10 min)
2. **[database-audit-report.md](./database-audit-report.md)** (60 min)
3. **[VIEW_AUDIT_RECOMMENDATIONS.md](./VIEW_AUDIT_RECOMMENDATIONS.md)** (30 min)
4. **[audit-results.txt](./audit-results.txt)** (20 min)

### For View Cleanup (4-5 hours work)
1. **[VIEW_AUDIT_RECOMMENDATIONS.md](./VIEW_AUDIT_RECOMMENDATIONS.md)** (20 min)
2. Export view definitions (backup)
3. Search codebase for view usage
4. Execute view deletion script
5. Update documentation

---

## 🔧 CANONICAL TABLES (USE THESE)

| Purpose | Table | Rows |
|---------|-------|------|
| Trades | `cascadian_clean.fact_trades_clean` | 63.5M |
| Mappings | `cascadian_clean.token_condition_market_map` | 228K |
| Resolutions | `default.staging_resolutions_union` | 544K |
| Markets | `default.api_markets_staging` | 161K |
| Wallets | `default.wallet_metrics` | 996K |
| PNL | `default.wallet_pnl_summary_final` | 935K |

Full list in **[DATABASE_AUDIT_QUICK_SUMMARY.md](./DATABASE_AUDIT_QUICK_SUMMARY.md)**

---

## 📈 TIMELINE SUMMARY

| Phase | Time | Priority |
|-------|------|----------|
| Table cleanup | 1 hour | P0 |
| ERC1155 backfill | 4-8 hours | P0 |
| Test wallet validation | 15 min | P0 |
| Trade table consolidation | 2 hours | P1 |
| View cleanup | 4-5 hours | P1 |
| Resolution consolidation | 3 hours | P2 |
| Market metadata backfill | 2 hours | P2 |
| Schema planning | 4 hours | P2 |
| Monitoring setup | 3 hours | P3 |
| **TOTAL** | **19-24 hours** | 1-2 weeks |

---

## ✅ SUCCESS CRITERIA

**Audit Phase: COMPLETE** ✅
- ✅ Inventoried 61 tables
- ✅ Inventoried 98 views
- ✅ Identified critical gaps
- ✅ Created action plan
- ✅ Generated documentation

**Cleanup Phase: PENDING**
- ⏳ Delete 7.5 GB backups
- ⏳ Delete 60 obsolete views

**Backfill Phase: PENDING**
- ⏳ ERC1155 transfers (291K → 10M+)
- ⏳ Test wallet verification (31 → 2,816 trades)
- ⏳ Market metadata (5.7K → 161K)

**Consolidation Phase: PENDING**
- ⏳ Single canonical fact table
- ⏳ Single canonical resolution view
- ⏳ Schema separation documented

**Production Ready: NOT YET**
- ⏳ ERC1155 coverage >95%
- ⏳ Wallet coverage >95%
- ⏳ Daily incremental refresh
- ⏳ Data quality monitoring

---

## 🚀 NEXT STEPS

**Immediate (Next 30 min):**
1. Read [DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)
2. Run table cleanup SQL (recover 7.5 GB)

**Today (Next 2 hours):**
3. Start ERC1155 backfill (setup + launch)
4. Monitor backfill progress

**This Week (8 hours):**
5. Validate test wallet after backfill
6. Consolidate trade tables
7. View cleanup

**Next 2 Weeks (12 hours):**
8. Resolution consolidation
9. Market metadata backfill
10. Schema planning
11. Monitoring setup

---

## 📞 HANDOFF NOTES

**For Next Agent:**
- All scripts are in project root or `/scripts/`
- Backfill scripts support checkpointing (can resume)
- Test wallet: `0x4ce73141dbfce41e65db3723e31059a730f0abad`
- Expected final coverage: >95% for ERC1155 and wallet trades

**Critical Decisions Needed:**
1. Goldsky vs blockchain RPC for ERC1155 backfill?
   - Recommendation: Goldsky first (faster), then fill gaps
2. Keep both schemas or consolidate?
   - Recommendation: Document separation rationale first
3. Which PNL view is canonical?
   - Recommendation: `cascadian_clean.vw_wallet_pnl_unified`

**Known Issues:**
- ERC1155 timestamp anomaly (1970-01-01) - needs fix
- Trade count discrepancy (157M vs 82M vs 63M) - needs clarification
- Multiple mapping tables - needs consolidation

---

**Audit Status:** ✅ COMPLETE  
**Action Status:** ⏳ PENDING  
**Estimated Completion:** 1-2 weeks  
**Documentation:** 70 KB, 6 files

**Next Agent:** Start with [DATABASE_AUDIT_EXECUTIVE_SUMMARY.md](./DATABASE_AUDIT_EXECUTIVE_SUMMARY.md)
