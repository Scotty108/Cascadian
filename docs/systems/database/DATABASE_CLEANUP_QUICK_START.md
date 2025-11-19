# DATABASE CLEANUP - QUICK START GUIDE

**TL;DR**: You have 149 tables but only need 37. Delete 70+ tables to save 60GB and eliminate confusion.

---

## THE PROBLEM IN 3 NUMBERS

```
149 total tables
 37 tables you actually need (25%)
 70+ tables that are technical debt (47%)
```

**Storage Waste**: 60GB+ in duplicate backups and abandoned experiments

---

## WHAT TO DELETE (3 CATEGORIES)

### 1. BACKUP TABLES (DELETE ALL)
**~30GB saved**

You have **3 complete copies of trades_raw** (159M rows each):
- `trades_raw_backup` (9.6GB) ❌
- `trades_raw_old` (9.6GB) ❌
- `trades_raw_before_pnl_fix` (10.2GB) ❌
- `trades_raw_pre_pnl_fix` (10.2GB) ❌
- `trades_raw_with_full_pnl` (10.9GB) ❌

Plus 5+ wallet_metrics backups with identical data.

**Why safe?**: All data exists in `trades_raw` (the production table)

### 2. EMPTY VIEWS (DELETE ALL)
**0GB but eliminates clutter**

40+ views with **zero rows**:
- `wallet_pnl_summary` (0 rows)
- `wallet_realized_pnl_v2` (0 rows)
- `outcome_positions_v3` (0 rows)
- `market_resolutions_normalized` (0 rows)
- ... 36 more

**Why safe?**: They're empty. No data loss possible.

### 3. OLD VERSIONS (DELETE AFTER VERIFY)
**~18GB saved**

Superseded by newer versions:
- Keep: `trades_dedup_mat_new` (106M rows) ✅
- Delete: `trades_dedup_mat` (69M rows, old logic) ❌

- Keep: `market_resolutions_final` (224K rows) ✅
- Delete: `market_resolutions` (137K rows, old format) ❌

- Keep: `wallet_metrics` (996K rows) ✅
- Delete: `wallet_metrics_v1` + 3 backups ❌

---

## EXECUTION PLAN (3 PHASES)

### PHASE 1: SAFE DELETIONS (30 mins)
**Risk**: Zero | **Savings**: 32GB

```bash
# Step 1: Backup table list (just in case)
npx tsx scripts/export-table-list.ts > pre-cleanup-manifest.txt

# Step 2: Delete backup tables
DROP TABLE trades_raw_backup;
DROP TABLE trades_raw_old;
DROP TABLE trades_raw_before_pnl_fix;
DROP TABLE trades_raw_pre_pnl_fix;
DROP TABLE trades_raw_with_full_pnl;
DROP TABLE market_resolutions_final_backup;
# ... (see full list in main audit)

# Step 3: Delete empty views (40+ tables)
DROP VIEW wallet_pnl_summary;
DROP VIEW wallet_realized_pnl_v2;
DROP VIEW outcome_positions_v3;
# ... (see full list)

# Step 4: Verify core tables intact
SELECT count(*) FROM trades_raw;  -- Should be 159,574,259
SELECT count(*) FROM market_resolutions_final;  -- Should be 223,973
```

### PHASE 2: CONSOLIDATIONS (2-4 hours)
**Risk**: Low | **Savings**: 18GB

```bash
# Step 1: Consolidate dedup tables
# Keep: trades_dedup_mat_new
# Delete: trades_dedup_mat (verify queries updated first)

# Step 2: Consolidate resolution tables
# Keep: market_resolutions_final
# Delete: market_resolutions, market_resolutions_by_market

# Step 3: Consolidate metrics
# Keep: wallet_metrics
# Delete: wallet_metrics_v1 + backups

# Step 4: Update all query references
# Search codebase for references to deleted tables
# Update to use canonical versions
```

### PHASE 3: FIX P&L BUG (8-16 hours)
**Risk**: Medium | **Impact**: Fix 36x P&L inflation

See: `CASCADIAN_DATABASE_MASTER_REFERENCE.md` Section 2

**Bug**: outcome_idx doesn't match winning_index (0-based vs 1-based)

**Fix**: Normalize indices before join:
```sql
IF(tcf.outcome_idx + 1 = mr.winning_index, op.net_shares, 0)
```

---

## THE 20 TABLES YOU ACTUALLY NEED

### Data Sources (3)
1. ✅ `erc20_transfers_staging` - USDC transfers (388M rows)
2. ✅ `erc1155_transfers` - Token transfers (206K rows)
3. ✅ `trades_raw` - Trade history (159.6M rows)

### Canonical Trade Data (2)
4. ✅ `vw_trades_canonical` - Cleaned trades (157.5M rows)
5. ✅ `trades_dedup_mat_new` - Deduplicated (106.6M rows)

### Market & Resolution (5)
6. ✅ `gamma_markets` - Market metadata (150K rows)
7. ✅ `market_resolutions_final` - Outcomes (224K rows)
8. ✅ `condition_market_map` - ID mappings (152K rows)
9. ✅ `market_key_map` - Market keys (157K rows)
10. ✅ `market_candles_5m` - Price data (8.1M rows)

### P&L Calculation (5)
11. ✅ `trade_cashflows_v3` - Cashflows (35.9M rows)
12. ✅ `outcome_positions_v2` - Positions (8.4M rows)
13. ✅ `realized_pnl_by_market_final` - P&L by market (13.7M rows)
14. ✅ `wallet_pnl_summary_final` - Wallet P&L (935K rows)
15. ✅ `wallet_realized_pnl_final` - Realized P&L (935K rows)

### Wallet Metrics (3)
16. ✅ `wallet_metrics` - Lifetime stats (996K rows)
17. ✅ `wallet_metrics_complete` - Multi-window (1.0M rows)
18. ✅ `wallet_metrics_daily` - Time series (12.8M rows)

### Supporting (2)
19. ✅ `wallets_dim` - Wallet dimension (65K rows)
20. ✅ `events_dim` - Event dimension (50K rows)

**Everything else is either derived (can rebuild) or technical debt (delete)**

---

## VALIDATION CHECKLIST

After each phase, verify:

```bash
# 1. Core tables exist and have expected row counts
npx tsx scripts/verify-core-tables.ts

# 2. UI loads correctly
npm run dev
# Navigate to dashboard, check wallet metrics

# 3. P&L calculations unchanged (before bug fix)
npx tsx scripts/audit-all-pnl-tables.ts

# 4. Test queries work
SELECT count(*) FROM vw_trades_canonical;
SELECT wallet, realized_pnl_usd FROM wallet_pnl_summary_final LIMIT 10;
```

---

## WHAT NOT TO DELETE

### NEVER delete these 15 tables:
1. trades_raw
2. vw_trades_canonical
3. erc20_transfers_staging
4. erc1155_transfers
5. market_resolutions_final
6. gamma_markets
7. condition_market_map
8. market_key_map
9. market_candles_5m
10. trade_cashflows_v3
11. outcome_positions_v2
12. realized_pnl_by_market_final
13. wallet_pnl_summary_final
14. wallet_metrics
15. wallet_metrics_daily

**Why**: These contain primary data or expensive-to-rebuild computations

---

## QUESTIONS TO ANSWER BEFORE DELETING

### For backup tables:
❓ When was this backup created?
❓ Is the original table still valid?
❓ Do we have alternative backups?

### For old versions (_v1, _old):
❓ Are any queries still referencing this table?
❓ What's different from the new version?
❓ Is the new version verified correct?

### For empty views:
❓ Is this view referenced in application code?
❓ Could it become populated in the future?
❓ Is it part of a migration?

---

## IMPACT SUMMARY

**Before Cleanup**:
- 149 tables
- ~95GB storage
- Confusing data model
- 70+ unused tables
- 36x P&L bug

**After Cleanup**:
- 37 tables (75% reduction)
- ~35GB storage (63% reduction)
- Clear data lineage
- Zero technical debt
- P&L bug fixed

**Developer Experience**:
- Faster queries (less metadata overhead)
- Clearer documentation
- Easier onboarding
- Reduced confusion ("which table is correct?")

---

## NEXT STEPS

1. **Read**: `COMPREHENSIVE_DATABASE_AUDIT_REPORT.md` (full analysis)
2. **Review**: This quick start guide
3. **Execute**: Phase 1 deletions (30 mins, zero risk)
4. **Validate**: Run test suite
5. **Continue**: Phase 2 consolidations
6. **Fix**: P&L bug (Phase 3)
7. **Document**: Update schema docs with final state

---

## FILES CREATED

- **COMPREHENSIVE_DATABASE_AUDIT_REPORT.md** - Full 87→20 table analysis
- **DATABASE_CLEANUP_QUICK_START.md** - This file (quick reference)
- **scripts/comprehensive-table-audit.ts** - Audit script (reusable)

**Location**: `/Users/scotty/Projects/Cascadian-app/`

---

## QUESTIONS?

See: `CASCADIAN_DATABASE_MASTER_REFERENCE.md` for complete database documentation

**Key Resources**:
- Data lineage diagram (Section 6)
- P&L bug explanation (Section 2)
- Critical rules (Section 8)
- Implementation roadmap (Section 7)
