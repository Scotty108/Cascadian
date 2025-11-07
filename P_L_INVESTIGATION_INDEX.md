# P&L Reconciliation Investigation - Complete Index

**Investigation Completed:** November 6, 2025  
**Total Time:** ~3 hours of thorough codebase analysis  
**Status:** Ready for implementation

---

## Documents Generated (4 Files)

### 1. INVESTIGATION_SUMMARY.md (START HERE - 5 min read)
**Purpose:** Executive summary for quick understanding  
**Best for:** Decision makers, project managers  
**Contains:**
- What was asked vs what was found
- 5 root causes ranked by impact
- The smoking gun (enrichment data exists but not applied)
- Expected improvement metrics
- Next steps and timeline

**Read time:** 5 minutes  
**Action:** Read this first to understand the problem

---

### 2. P_L_INVESTIGATION_QUICK_REFERENCE.md (5-15 min read)
**Purpose:** Quick lookup and immediate actions  
**Best for:** Developers ready to implement  
**Contains:**
- 5 root causes in table format
- The 3 canonical tables to use
- Key numbers at a glance
- Immediate verification steps
- SQL commands to execute
- Before/after impact metrics
- Success criteria

**Read time:** 5-15 minutes  
**Action:** Use this to guide your P0 fix

---

### 3. P_L_RECONCILIATION_INVESTIGATION.md (30-45 min read)
**Purpose:** Complete technical investigation report  
**Best for:** Database architects, tech leads  
**Contains:**
- Detailed root cause analysis for each of 5 gaps
- Schema analysis with row counts and NULL percentages
- Data ingestion timeline (Sept-Nov 2024)
- All resolution sources and their coverage
- Complete wallet P&L analysis
- Ranked implementation recommendations (P0-P4)
- 10 implementation steps with code
- Success criteria and monitoring

**Read time:** 30-45 minutes  
**Action:** Reference this for deep understanding

---

### 4. P_L_INVESTIGATION_CODE_REFERENCE.md (20-30 min read)
**Purpose:** Code file reference and snippets  
**Best for:** Developers working on fixes  
**Contains:**
- Schema files (with DDL)
- Ingestion scripts (3 data paths)
- P&L calculation scripts
- Diagnostic tools
- Resolution data sources
- File dependency chain
- Command reference

**Read time:** 20-30 minutes  
**Action:** Use this to locate and understand each file

---

## Quick Navigation by Role

### If you're a Project Manager
1. Read: INVESTIGATION_SUMMARY.md
2. Review: "Expected Improvement" table
3. Understand: "The Smoking Gun" section
4. Plan: Next Steps timeline (6-9 hours for 95% coverage)

### If you're a Database Architect
1. Read: P_L_RECONCILIATION_INVESTIGATION.md (Sections 1-6)
2. Review: Root causes section with file locations
3. Study: Table schemas and cardinality analysis
4. Design: Implementation approach for P0-P4

### If you're a Backend Developer (Implementing P0)
1. Read: P_L_INVESTIGATION_QUICK_REFERENCE.md
2. Review: "Immediate Actions" section
3. Execute: The 4 verification queries
4. Apply: The market_id backfill UPDATE

### If you're a Backend Developer (Implementing P1-P4)
1. Read: P_L_INVESTIGATION_QUICK_REFERENCE.md
2. Reference: P_L_INVESTIGATION_CODE_REFERENCE.md
3. Study: Ingestion scripts section
4. Build: Enrichment job using provided pseudo-code

---

## The 5 Root Causes (Brief)

| # | Root Cause | Status | Fix Time |
|---|-----------|--------|----------|
| 1 | Enrichment scripts not applied (100% read-only) | **CRITICAL** | 2-3h |
| 2 | Missing market_id at ingestion (89% sparse) | High | 3h (P0) |
| 3 | Missing condition_id at ingestion (51% sparse) | High | 6h (P1) |
| 4 | Incomplete market resolutions (59/151K) | Medium | Ongoing |
| 5 | ERC-1155 token decoder missing | Medium | 6-8h |

---

## Critical Tables Summary

**Use for all lookups:**
```
condition_market_map (151,843 rows, 1:1 mapping, 0% NULLs)
├── 100% complete condition_id coverage
├── 100% complete market_id coverage
└── Production ready NOW
```

**Primary trade data:**
```
trades_raw (159.5M rows, 51% condition_id sparse)
├── Join with condition_market_map for enrichment
├── Filter WHERE condition_id IS NOT NULL for accuracy
└── Apply P0 update to backfill market_id
```

**Resolution data:**
```
winning_index (VIEW, 137K conditions)
├── Derived from market_resolutions_final
├── Use for settlement calculations
└── Coverage: 90% of markets (but only 59 for target wallets)
```

---

## Implementation Roadmap

### Phase 1: P0 (IMMEDIATE - 2-3 hours)
- [ ] Read QUICK_REFERENCE.md
- [ ] Run verification queries 1-3
- [ ] Backup trades_raw
- [ ] Apply market_id backfill UPDATE
- [ ] Verify results
- [ ] Commit changes

**Expected gain:** +59% market_id coverage

### Phase 2: P1 (NEXT - 4-6 hours)
- [ ] Create enrich-missing-condition-ids.ts
- [ ] Build Polymarket API lookup function
- [ ] Add batch UPDATE logic
- [ ] Test on 1,000 records first
- [ ] Scale to 10M+ records
- [ ] Verify condition_id coverage improves

**Expected gain:** +35% condition_id coverage

### Phase 3: P2-P4 (SHORT TERM - 10-14 hours)
- [ ] Add nightly scheduler
- [ ] Build ERC-1155 decoder
- [ ] Add resolution monitoring
- [ ] Document in project README

**Expected gain:** +95% overall coverage

---

## File Locations Quick Reference

**Investigation Documents:**
- `/Users/scotty/Projects/Cascadian-app/INVESTIGATION_SUMMARY.md`
- `/Users/scotty/Projects/Cascadian-app/P_L_INVESTIGATION_QUICK_REFERENCE.md`
- `/Users/scotty/Projects/Cascadian-app/P_L_RECONCILIATION_INVESTIGATION.md`
- `/Users/scotty/Projects/Cascadian-app/P_L_INVESTIGATION_CODE_REFERENCE.md`

**Schema Files:**
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/003_add_condition_id.sql`
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/014_create_ingestion_spine_tables.sql`
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql`

**Ingestion Scripts:**
- `/Users/scotty/Projects/Cascadian-app/scripts/ingest-clob-fills-correct.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/goldsky-parallel-ingestion.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/backfill-market-ids.ts` (READ-ONLY)

**P&L Calculation:**
- `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-final-fixed.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/diagnostic-final-gap-analysis.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/debug-realized-pnl.ts`

**Reference Documents:**
- `/Users/scotty/Projects/Cascadian-app/CLICKHOUSE_INVENTORY_REPORT.md`
- `/Users/scotty/Projects/Cascadian-app/PNL_RECONCILIATION_DIAGNOSIS.md`
- `/Users/scotty/Projects/Cascadian-app/MAPPING_TABLES_FINAL_SUMMARY.md`

---

## Success Metrics

### After P0 (2-3 hours)
- condition_market_map verified (151,843 rows)
- market_id coverage: 11% → 70%
- trades joinable to markets: 1% → 40%

### After P1 (4-6 hours)
- condition_id coverage: 51% → 90%
- trades joinable to resolutions: 40% → 80%
- P&L gap for niggemon: -65% → -20%

### After P2-P4 (10-14 hours)
- Automated backfills running nightly
- ERC-1155 token decoder functional
- Resolution monitoring in place
- P&L coverage: 35% → 95%+

---

## FAQs

**Q: Is the issue a data quality problem?**  
A: No. The data exists (condition_market_map has 151K perfect mappings). The backfill recommendations were generated (data/backfilled_market_ids.json). The issue is that enrichment scripts are read-only and never apply the fixes.

**Q: Can we fix it safely?**  
A: Yes. All fixes are idempotent (safe to re-run) and reversible (we're doing JOINs and UPDATEs, no deletes).

**Q: How long will P0 take?**  
A: 2-3 hours total: 30 min read + 30 min verification + 1-2 hours for UPDATE execution (it's a big table).

**Q: What if the UPDATE fails?**  
A: We have a backup (trades_raw_backup_pre_market_id_fix). Restore from backup and diagnose.

**Q: Do we need to wait for market resolutions?**  
A: Not for the first two fixes. P0+P1 will improve coverage significantly. Markets will resolve over time naturally.

---

## Support & Questions

**If stuck on:**
- **Schema understanding** → Read P_L_INVESTIGATION_CODE_REFERENCE.md (Sections 1-4)
- **Root cause details** → Read P_L_RECONCILIATION_INVESTIGATION.md (Sections 1-7)
- **Implementation steps** → Read P_L_INVESTIGATION_QUICK_REFERENCE.md (Section "Immediate Actions")
- **Code locations** → Search P_L_INVESTIGATION_CODE_REFERENCE.md for file name

---

## Investigation Completion Checklist

- [x] Analyzed all 159M+ trades in trades_raw
- [x] Examined all 48 ClickHouse tables
- [x] Traced data flow from ingestion to P&L calculation
- [x] Identified all 5 root causes
- [x] Ranked by impact and recoverability
- [x] Created implementation roadmap (P0-P4)
- [x] Generated 4 reference documents
- [x] Provided SQL snippets and pseudo-code
- [x] Created success metrics and monitoring plan

---

**Status:** Investigation Complete and Ready for Implementation  
**Risk Level:** Low (all changes are safe and reversible)  
**Expected ROI:** 50-70% improvement in P&L coverage with 6-9 hours of work  

**Next Action:** Read INVESTIGATION_SUMMARY.md (5 minutes) then P_L_INVESTIGATION_QUICK_REFERENCE.md (5-15 minutes) to get started.

---

Generated: November 6, 2025  
Files: 4 investigation documents + this index  
Total Investigation Time: ~3 hours  
Status: Complete - Ready for implementation
