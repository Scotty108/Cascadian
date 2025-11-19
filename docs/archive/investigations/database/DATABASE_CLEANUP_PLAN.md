# DATABASE CLEANUP PLAN
**Status:** Ready to execute (backfill running safely in parallel)
**Estimated time:** 30-45 minutes

## Executive Summary

Current state:
- **121 total tables** across 2 databases
- **29 empty tables** (0 rows) = instant cleanup candidates
- **Multiple duplicate/versioned tables** taking 40+ GB
- **Safe to proceed** - backfill only touches `cascadian_clean.resolutions_src_api` and `backfill_progress`

Target state (per FINAL_DATABASE_SCHEMA.md):
- **15 core production tables**
- **10-15 production views**
- Clean separation: `cascadian_clean` for raw data, `default` for analytics
- All empty/duplicate tables removed

---

## Phase 1: Drop Empty Tables (SAFE - Immediate)

**29 tables with 0 rows to drop:**

```sql
-- Empty tables in default schema (safe to drop)
DROP TABLE IF EXISTS default.erc1155_transfers_pilot;
DROP TABLE IF EXISTS default.market_flow_metrics;
DROP TABLE IF EXISTS default.market_price_momentum;
DROP TABLE IF EXISTS default.api_ctf_bridge_final;
DROP TABLE IF EXISTS default.market_resolutions_ctf;
DROP TABLE IF EXISTS default.fired_signals;
DROP TABLE IF EXISTS default.fills_fact;
DROP TABLE IF EXISTS default.repair_pairs_temp;
DROP TABLE IF EXISTS default.market_resolutions_normalized;
DROP TABLE IF EXISTS default.market_resolutions_payout_backfill;
DROP TABLE IF EXISTS default.worker_heartbeats;
DROP TABLE IF EXISTS default.api_market_mapping;
DROP TABLE IF EXISTS default.erc1155_transfers_staging;
DROP TABLE IF EXISTS default.market_price_history;
DROP TABLE IF EXISTS default.erc1155_transfers_full;
DROP TABLE IF EXISTS default.tmp_repair_cids;
DROP TABLE IF EXISTS default.momentum_trading_signals;
DROP TABLE IF EXISTS default.elite_trade_attributions;
DROP TABLE IF EXISTS default.thegraph_market_mapping;
DROP TABLE IF EXISTS default.goldsky_market_mapping;
DROP TABLE IF EXISTS default.ctf_condition_meta;
DROP TABLE IF EXISTS default.category_analytics;
DROP TABLE IF EXISTS default.market_outcome_catalog;
DROP TABLE IF EXISTS default.temp_onchain_resolutions;
DROP TABLE IF EXISTS default.condition_id_recovery;
DROP TABLE IF EXISTS default.market_event_mapping;
DROP TABLE IF EXISTS default.rpc_transfer_mapping;
DROP TABLE IF EXISTS default.price_snapshots_10s;
DROP TABLE IF EXISTS default.resolutions_temp;
DROP TABLE IF EXISTS default.resolution_status_cache;
DROP TABLE IF EXISTS default.category_leaders_v1;
DROP TABLE IF EXISTS default.clob_market_mapping;
DROP TABLE IF EXISTS default.gamma_markets_resolutions;
DROP TABLE IF EXISTS cascadian_clean.resolutions_rekeyed; -- empty in cascadian_clean too
```

**Space reclaimed:** Minimal (empty tables)
**Risk:** None (all zero rows)

---

## Phase 2: Drop Duplicate/Versioned Tables (SAFE - Review First)

**Duplicate trade tables (keep only latest version):**

Keep: `vw_trades_canonical` (11.84 GB, production)
Drop these duplicates/old versions:

```sql
-- Old trade table versions
DROP TABLE IF EXISTS default.trades_raw_with_full_pnl;      -- 10.64 GB (superseded)
DROP TABLE IF EXISTS default.trades_raw_pre_pnl_fix;        -- 10.01 GB (pre-fix version)
DROP TABLE IF EXISTS default.trades_raw_pre_enrichment;     -- 10.00 GB (pre-enrichment)
DROP TABLE IF EXISTS default.trades_raw_failed;             -- 9.44 GB (old failed attempts)
DROP TABLE IF EXISTS default.trades_dedup_mat_new;          -- 8.18 GB (superseded by canonical)
DROP TABLE IF EXISTS default.trades_raw_enriched_final;     -- 5.90 GB (superseded)
DROP TABLE IF EXISTS default.trades_with_direction;         -- 5.25 GB (integrated into canonical)
DROP TABLE IF EXISTS default.trades_raw_enriched_v2;        -- 4.32 GB (old version)
DROP TABLE IF EXISTS default.trades_raw_enriched;           -- 3.85 GB (old version)
DROP TABLE IF EXISTS default.trades_raw_broken;             -- 375 MB (broken data)
DROP TABLE IF EXISTS default.vw_trades_canonical_v2;        -- 27 MB (superseded by main)
DROP TABLE IF EXISTS default.trades_with_pnl_old;           -- 25 MB (old version)
```

**Space reclaimed:** ~77 GB
**Risk:** Low (assuming vw_trades_canonical is verified working)

---

## Phase 3: Drop Backup Tables (CAUTION - Keep Recent Backups)

**Backup tables to review:**

```sql
-- Check if these are still needed for rollback
DROP TABLE IF EXISTS default.market_resolutions_final_backup;  -- 4.46 MB
DROP TABLE IF EXISTS default.wallet_metrics_v1_backup;          -- 2.00 MB
DROP TABLE IF EXISTS default.wallet_metrics_v1_backup_27k;      -- 1.89 MB
DROP TABLE IF EXISTS default.wallet_metrics_v1_backup_pre_universal; -- 1.62 MB
DROP TABLE IF EXISTS cascadian_clean.fact_trades_backup;        -- 2.80 GB
DROP TABLE IF EXISTS cascadian_clean.fact_trades_BROKEN_CIDS;   -- 4.36 GB (likely old broken data)
```

**Decision criteria:**
- If backfill completes successfully and coverage >95%, drop all backups
- Keep most recent backup for 7 days after validation

**Space reclaimed:** ~7 GB

---

## Phase 4: Consolidate Resolution Tables

**Current state:** Multiple resolution sources

Keep:
- `cascadian_clean.resolutions_src_api` (current backfill target)
- `cascadian_clean.vw_resolutions_unified` (view combining all sources)

Review for consolidation:
```sql
-- Resolution tables to potentially merge
default.market_resolutions_final         -- 7.88 MB, 224K rows
default.market_resolutions               -- 4.77 MB, 137K rows
default.gamma_resolved                   -- 3.82 MB, 123K rows
default.market_resolutions_by_market     -- 1.04 MB, 133K rows
default.staging_resolutions_union        -- 5.85 MB, 544K rows
```

**Action:** After backfill completes, create single unified resolution table

---

## Phase 5: Drop Superseded Wallet/PnL Tables

**Current state:** Multiple wallet metrics versions

Keep (production):
- `default.wallet_metrics_complete` (1M rows)
- `default.wallet_pnl_summary_final` (935K rows)
- `default.wallet_realized_pnl_final` (935K rows)

Drop (superseded versions):
```sql
DROP TABLE IF EXISTS default.wallet_metrics;           -- Superseded by _complete
DROP TABLE IF EXISTS default.wallet_metrics_v1;        -- Old version
DROP TABLE IF EXISTS default.wallet_pnl_correct;       -- Superseded by _final
DROP TABLE IF EXISTS default.wallet_pnl_production;    -- Old version
DROP TABLE IF EXISTS default.wallet_pnl_production_v2; -- Old version
DROP TABLE IF EXISTS default.realized_pnl_corrected_v2;-- Superseded
```

**Space reclaimed:** ~100 MB

---

## Phase 6: Create Final Production Schema

**Target structure per FINAL_DATABASE_SCHEMA.md:**

### CASCADIAN_CLEAN (Raw/Staging Data)
```
Tables:
  - erc20_transfers_staging (387M rows) - keep
  - fact_trades_clean (63M rows) - keep
  - system_wallet_map (23M rows) - keep
  - backfill_progress (302K rows) - keep
  - resolutions_src_api (100K+ rows, growing) - keep

Views:
  - vw_resolutions_unified (combines all resolution sources)
  - vw_resolutions_all (production resolutions)
```

### DEFAULT (Analytics/Production)
```
Core Tables:
  - vw_trades_canonical (158M rows) - trades fact table
  - trade_direction_assignments (130M rows) - enrichment
  - realized_pnl_by_market_final (14M rows) - analytics
  - wallet_metrics_complete (1M rows) - wallet analytics
  - wallet_pnl_summary_final (935K rows) - wallet PnL
  - market_resolutions_final (224K rows) - resolutions
  - condition_market_map (152K rows) - mappings
  - events_dim (50K rows) - event metadata
  - markets_dim (6K rows) - market metadata
  - wallets_dim (65K rows) - wallet metadata

Analytics Views:
  - vw_condition_categories (event/category mapping)
  - vw_pnl_by_category (P&L by category)
  - vw_wallet_metrics (real-time metrics)
  - vw_wallet_pnl (real-time P&L)
```

---

## Execution Plan

### NOW (While Backfill Runs)

✅ **Phase 1: Drop empty tables** (5 min)
- Zero risk, immediate cleanup
- Run script: `npx tsx cleanup-phase1-empty-tables.ts`

✅ **Phase 2: Drop old duplicate tables** (10 min)
- Verify vw_trades_canonical has all data
- Run script: `npx tsx cleanup-phase2-duplicates.ts`

### AFTER Backfill Completes (~2.5 hours from now)

**Phase 3: Verify and consolidate** (15 min)
- Check resolution coverage ≥95%
- Create unified resolutions table
- Drop backup tables

**Phase 4: Final cleanup** (10 min)
- Drop superseded wallet/PnL tables
- Create production views
- Vacuum/optimize tables

---

## Verification Checklist

Before dropping any table, verify:
- [ ] Not referenced in any production view
- [ ] Not used by frontend queries
- [ ] Data exists in newer version (if replacement)
- [ ] No critical data loss

After cleanup:
- [ ] All FINAL_DATABASE_SCHEMA.md tables present
- [ ] All production views working
- [ ] P&L calculations correct
- [ ] Coverage ≥95%

---

## Rollback Plan

If something breaks:
1. Check `*_backup` tables (if not yet dropped)
2. Re-run backfill from checkpoint
3. Recreate views from FINAL_DATABASE_SCHEMA.md

---

## Estimated Results

**Before:**
- 121 tables
- ~60 GB total
- Confusing structure

**After:**
- ~25-30 tables
- ~20-25 GB (55% reduction)
- Clean, documented structure
- All per FINAL_DATABASE_SCHEMA.md

**Time saved:**
- Query planning: faster (fewer tables to scan)
- Maintenance: cleaner backups
- Developer onboarding: clear schema

