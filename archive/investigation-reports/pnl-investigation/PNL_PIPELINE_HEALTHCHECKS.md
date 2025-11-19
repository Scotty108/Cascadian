# P&L Pipeline Health Checks
**Purpose:** Validation and monitoring toolkit for Cascadian P&L pipeline
**Status:** Production-ready
**Last Updated:** 2025-11-15

---

## Overview

This document describes the P&L health check toolkit - a suite of scripts and views designed to validate the mathematical consistency, data quality, and coverage of the Polymarket P&L calculation pipeline.

**Use Cases:**
- **Daily monitoring:** Verify P&L pipeline health
- **Pre-deployment validation:** Ensure changes don't break P&L math
- **External data integration:** Validate when new data sources are added
- **Coverage analysis:** Identify gaps in market resolution data

---

## Health Check Components

### 1. Global Resolution Sync (`scripts/123-sync-resolution-status-global.ts`)

**Purpose:** Syncs resolution status from `gamma_resolved` (source of truth) to `pm_markets` (application table).

**What It Checks:**
- Markets where `gamma_resolved` shows resolved but `pm_markets` status != 'resolved'
- Missing `market_type` fields (sets to 'binary')
- Missing `resolved_at` timestamps

**How It Works:**
1. Compares `pm_markets` against `gamma_resolved`
2. Identifies inconsistencies (status mismatch, missing fields)
3. **Dry-run mode (default):** Shows what would change
4. **Execute mode (`--execute`):** Atomically rebuilds `pm_markets` with synced data

**Command:**
```bash
# Dry-run (safe - shows what would change)
npx tsx scripts/123-sync-resolution-status-global.ts

# Execute (applies changes)
npx tsx scripts/123-sync-resolution-status-global.ts --execute
```

**Expected Output (Healthy State):**
```
Current state:
  pm_markets total: 139140
  pm_markets resolved: 139140 (100.0%)
  pm_markets with null/empty type: 0

Markets with inconsistencies: 0

✅ All markets are in sync! No action needed.
```

**When to Run:**
- After `gamma_resolved` backfill or updates
- Weekly as preventive maintenance
- Before major releases

**Safety:**
- Dry-run by default prevents accidental changes
- Atomic CREATE + RENAME pattern ensures rollback capability
- Original data backed up as `pm_markets_backup`

---

### 2. Coverage Classifier View (`pm_wallet_market_coverage_internal`)

**Purpose:** Classifies wallet-market pairs by data completeness to identify coverage gaps.

**Schema:**
```sql
CREATE VIEW pm_wallet_market_coverage_internal AS
SELECT
  wallet_address,           -- Canonical wallet address
  condition_id,             -- Market condition ID
  coverage_category,        -- A_INTERNAL_OK | B_INTERNAL_UNRESOLVED
  market_status,            -- open | resolved
  resolved_at,              -- Resolution timestamp
  market_type,              -- binary | categorical
  market_question,          -- Market question text
  trade_count,              -- Number of trades
  total_shares,             -- Sum of shares traded
  first_trade_at,           -- First trade timestamp
  last_trade_at             -- Last trade timestamp
FROM ...
```

**Coverage Categories:**
- **A_INTERNAL_OK:** Wallet has trades + market is resolved ✅
- **B_INTERNAL_UNRESOLVED:** Wallet has trades + market NOT resolved ⚠️
- **Category C (not in view):** No trades at all - identified by external comparison

**What It Shows:**
- Which markets a wallet has traded
- Whether those markets are resolved
- Trade volume and timing per market

**Direct Queries:**
```sql
-- Count by category for a wallet
SELECT coverage_category, COUNT(*) as markets
FROM pm_wallet_market_coverage_internal
WHERE lower(wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY coverage_category;

-- Global coverage stats
SELECT
  coverage_category,
  COUNT(*) as wallet_market_pairs,
  COUNT(DISTINCT wallet_address) as wallets,
  COUNT(DISTINCT condition_id) as markets
FROM pm_wallet_market_coverage_internal
GROUP BY coverage_category;
```

---

### 3. Wallet Coverage Dump (`scripts/124-dump-wallet-coverage.ts`)

**Purpose:** Generate detailed coverage reports for specific wallets.

**What It Reports:**
- Summary statistics by category
- Top 20 markets by trade count
- Category B (unresolved) markets if any exist
- Market type breakdown

**Command:**
```bash
# Single wallet (by alias)
npx tsx scripts/124-dump-wallet-coverage.ts xcnstrategy

# Single wallet (by address)
npx tsx scripts/124-dump-wallet-coverage.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
```

**Expected Output (Healthy State):**
```
Wallet Coverage Report
================================================================================

Wallet: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
Alias: xcnstrategy

Summary Statistics:
┌─────────────────────┬──────────────┬──────────────┬──────────────┐
│ coverage_category   │ market_count │ total_trades │ total_shares │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ A_INTERNAL_OK       │ 45           │ 194          │ 137699.73    │
└─────────────────────┴──────────────┴──────────────┴──────────────┘

Overall Totals:
  Markets: 45
  Trades: 194
  Shares: 137699.73

✅ No Category B markets - all markets with trades are resolved!

Health:
  Resolution coverage: 100.0%
```

**When to Run:**
- After new trades are ingested
- When investigating wallet P&L discrepancies
- Before/after external data integration

---

### 4. P&L Consistency Validation (`scripts/125-validate-pnl-consistency.ts`)

**Purpose:** Validates mathematical consistency and data quality of the P&L pipeline.

**What It Checks:**

**Check 1: Trade Data Sanity**
- ✅ No negative shares
- ✅ All prices between 0 and 1
- ✅ No NULL values in critical fields (condition_id, wallet_address, shares, price)

**Check 2: Resolution Coverage**
- ✅ Percentage of markets with trades that are resolved
- Target: 100% (or ≥95% with warnings)

**Check 3: P&L View Consistency**
- ✅ `pm_wallet_market_pnl_resolved` is populated
- ✅ No NULL `pnl_net` values

**Command:**
```bash
# Single wallet
npx tsx scripts/125-validate-pnl-consistency.ts --wallet xcnstrategy

# All wallets (future)
npx tsx scripts/125-validate-pnl-consistency.ts
```

**Expected Output (Healthy State):**
```
P&L Consistency Validation
================================================================================

Check 1: Trade Data Sanity Checks
✅ 1a. Negative shares: PASS - No trades with negative shares found
✅ 1b. Invalid prices: PASS - All prices are between 0 and 1
✅ 1c. Null critical fields: PASS - No null values in critical fields

Check 2: Resolution Coverage Checks
✅ 2a. Resolution coverage: PASS - 100% of markets with trades are resolved (45/45)

Check 3: P&L View Consistency
✅ 3a. P&L view populated: PASS - pm_wallet_market_pnl_resolved has 45 rows
✅ 3b. NULL P&L values: PASS - No NULL pnl_net values found

VALIDATION SUMMARY
Overall Results:
  ✅ PASS: 6
  ⚠️  WARN: 0
  ❌ FAIL: 0

✅ ALL CHECKS PASSED!
The P&L pipeline is mathematically consistent and ready for production use.
```

**Exit Codes:**
- `0` - All checks passed
- `1` - One or more FAIL status (critical issues)

**When to Run:**
- Before deploying P&L view changes
- After resolution sync operations
- When investigating P&L discrepancies
- Before/after external data integration

---

## Health Check Workflow

### Daily Monitoring Routine

**Run all checks in sequence:**

```bash
# 1. Check resolution sync status
npx tsx scripts/123-sync-resolution-status-global.ts

# 2. Validate P&L consistency
npx tsx scripts/125-validate-pnl-consistency.ts --wallet xcnstrategy

# 3. Generate coverage report
npx tsx scripts/124-dump-wallet-coverage.ts xcnstrategy
```

**Expected results for healthy pipeline:**
- Script 123: "All markets are in sync"
- Script 125: "ALL CHECKS PASSED"
- Script 124: "100.0% resolution coverage"

### Pre-Deployment Checklist

Before deploying changes that affect P&L:

1. ✅ Run resolution sync (dry-run mode)
2. ✅ Run consistency validation for test wallets
3. ✅ Compare coverage reports before/after
4. ✅ Document any changes in resolution coverage
5. ✅ Verify P&L totals match expected values

### Post-External-Data Integration

When C2 completes external data integration:

1. ✅ Run all health checks on `pm_trades` (CLOB-only baseline)
2. ✅ Switch to `pm_trades_complete` (CLOB + external)
3. ✅ Re-run all health checks
4. ✅ Compare coverage reports:
   - Category A should increase (more resolved markets)
   - Category C should decrease (fewer missing trades)
5. ✅ Document delta in P&L totals

---

## Interpreting Results

### ✅ PASS - Healthy State

**Script 123:**
- All markets in sync
- 100% resolution coverage
- No inconsistencies

**Script 124:**
- All markets are Category A (INTERNAL_OK)
- No Category B (unresolved) markets
- Trade counts match expectations

**Script 125:**
- All 6 checks pass
- No negative shares or invalid prices
- 100% resolution coverage
- P&L views populated

### ⚠️ WARN - Investigate

**Script 123:**
- Some markets have inconsistencies
- Run with `--execute` after review

**Script 124:**
- Category B markets exist (trades but not resolved)
- Resolution sync needed

**Script 125:**
- Resolution coverage < 100% but ≥ 95%
- Some NULL P&L values
- Review affected markets

### ❌ FAIL - Critical Issues

**Script 123:**
- Row count mismatch after sync
- Resolved count decreased
- Do NOT execute - investigate

**Script 124:**
- Large number of Category B markets
- Resolution data missing

**Script 125:**
- Negative shares found (data corruption)
- Invalid prices (< 0 or > 1)
- NULL critical fields
- P&L views empty
- Fix data quality issues before proceeding

---

## Troubleshooting

### "Markets with inconsistencies: N" (Script 123)

**Cause:** gamma_resolved has newer resolution data than pm_markets

**Fix:**
1. Review inconsistencies in dry-run output
2. If safe, run with `--execute` flag
3. Verify changes with script 124/125

### "Category B (INTERNAL_UNRESOLVED): N markets" (Script 124)

**Cause:** Wallet has trades on markets not yet resolved

**Fix:**
1. Wait for market resolution
2. Or run script 123 to sync latest resolution data

### "FAIL: Negative shares" (Script 125)

**Cause:** Data corruption or incorrect trade direction

**Fix:**
1. Identify affected trades
2. Investigate source data (CLOB fills, ERC1155 transfers)
3. Correct at source and re-ingest

### "FAIL: Resolution coverage < 95%" (Script 125)

**Cause:** Many unresolved markets with trades

**Fix:**
1. Run script 123 to sync latest resolutions
2. Check gamma_resolved backfill coverage
3. Document markets awaiting resolution

---

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `scripts/123-sync-resolution-status-global.ts` | Global resolution sync | ✅ Production |
| `scripts/124a-create-coverage-classifier-view.ts` | Creates pm_wallet_market_coverage_internal | ✅ One-time setup |
| `scripts/124-dump-wallet-coverage.ts` | Wallet coverage reports | ✅ Production |
| `scripts/125-validate-pnl-consistency.ts` | P&L consistency checks | ✅ Production |
| `pm_wallet_market_coverage_internal` (view) | Coverage classifier | ✅ Active |
| `RESOLUTION_GLOBAL_COVERAGE_SUMMARY.md` | Phase 1 documentation | ✅ Complete |
| `PNL_PIPELINE_HEALTHCHECKS.md` | This document | ✅ Complete |

---

## Health Snapshot - 2025-11-15

**Date:** 2025-11-15 09:30 PST
**Wallet:** xcnstrategy (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b)

### Resolution Sync Status (Script 123)
```
✅ PASS - All 139,140 markets in sync
   - pm_markets resolved: 139,140 (100.0%)
   - Inconsistencies: 0
   - Action: None required
```

### Coverage Analysis (Script 124)
```
✅ PASS - Full internal coverage
   - Markets traded: 45
   - Category A (OK): 45 (100%)
   - Category B (Unresolved): 0
   - Total trades: 194
   - Total shares: 137,699.73
```

### P&L Consistency (Script 125)
```
✅ ALL CHECKS PASSED (6/6)
   - No negative shares
   - All prices valid (0-1 range)
   - No NULL critical fields
   - 100% resolution coverage (45/45 markets)
   - pm_wallet_market_pnl_resolved: 45 rows
   - No NULL pnl_net values
```

**Overall Health:** ✅ **EXCELLENT**
**P&L Pipeline Status:** Production-ready, mathematically consistent
**Action Items:** None - all systems nominal

---

## Next Steps

### Immediate (This Session)
- ✅ Health check toolkit complete and documented
- ⏭️ Generalize scripts for multi-wallet support
- ⏭️ Create baseline wallets configuration
- ⏭️ Build P&L snapshot utility (script 126)

### Upcoming (C2 Integration)
- Prepare `pm_trades_complete` interface view
- Update P&L views to use `pm_trades_complete`
- Document switchover plan for external data
- Build diff mode for CLOB vs CLOB+external comparison

---

**Maintainer:** Claude 1
**Status:** Phase 1 Complete
**Last Validated:** 2025-11-15

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._

_— Claude 1_
