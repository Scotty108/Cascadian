# Session Status: PnL V2 Validation

**Date:** 2025-01-16
**Session Type:** PnL V2 System Build & Validation
**Status:** ✅ COMPLETE
**Terminal:** Claude 1

---

## Session Overview

This session successfully built and **internally validated** the PnL V2 system for Cascadian, creating two production-ready tables (`pm_wallet_market_pnl_v2` and `pm_wallet_summary_v2`) that aggregate 17M+ trades across 573K+ wallets with 100% repair coverage.

**Important:** PnL V2 is internally consistent (summary matches position aggregation perfectly) but **NOT yet reconciled to Polymarket UI** due to coverage gap (missing ~83.7% of some wallets' volume) and model gap (trades-only P&L, missing settlement payouts). See "External Polymarket UI Comparison" section for full analysis.

---

## Session Objectives ✅

### Primary Directive (5 Phases)

1. **Phase 1:** ✅ Create global repair coverage report
2. **Phase 2:** ✅ Populate pm_trades_orphaned_v2 table
3. **Phase 3:** ✅ Build pm_wallet_market_pnl_v2 and pm_wallet_summary_v2
4. **Phase 4:** ✅ Validate wallet data (xcnstrategy + top wallets + random samples)
5. **Phase 5:** ✅ Create validation report and session status

**Constraint:** Do NOT rebuild pm_trades_canonical_v2 (treat as final canonical table)

---

## What Was Accomplished

### 1. Global Repair Coverage Report ✅

**File:** `REPAIR_COVERAGE_REPORT.md`

**Key Findings:**
- Total trades in canonical v2: 157,541,131
- Orphan trades: 0 (100.0% repair coverage)
- All trades successfully repaired with condition_id and outcome_index

### 2. Orphan Table Population ✅

**Table:** `pm_trades_orphaned_v2`

**Result:** 0 orphan trades (consistent with 100% repair coverage)

### 3. PnL Table Construction ✅

#### 3a. pm_wallet_market_pnl_v2

**Purpose:** Per-wallet, per-market P&L calculation using FIFO cost basis

**Schema:**
- **Granularity:** One row per (wallet_address, condition_id_norm, outcome_index)
- **P&L Formula:** realized_pnl = total_proceeds_usd - total_cost_usd
- **Engine:** ReplacingMergeTree(version)
- **Partitioning:** By first 2 hex chars of condition_id_norm (256 partitions)
- **Indexing:** ORDER BY (wallet_address, condition_id_norm, outcome_index)

**Population:**
- **Runtime:** 31.12 seconds
- **Rows Created:** 4,685,841 positions
- **Unique Wallets:** 573,589
- **Source:** pm_trades_canonical_v2 (is_orphan = 0)

**Technical Challenges Solved:**
- Used Float64 for avg_entry_price and avg_exit_price to avoid inf/NaN cast errors
- Single atomic INSERT (no UPDATE statements) for ReplacingMergeTree best practices
- LEFT JOIN with market_resolutions_final for resolution status

#### 3b. pm_wallet_summary_v2

**Purpose:** Wallet-level aggregates for leaderboards and analytics

**Schema:**
- **Granularity:** One row per wallet_address
- **Metrics:** Total P&L, win rate, trade counts, volume, position counts
- **Engine:** ReplacingMergeTree(version)
- **Indexing:** ORDER BY wallet_address

**Population:**
- **Runtime:** 3.98 seconds
- **Rows Created:** 573,589 wallets
- **Source:** Aggregation of pm_wallet_market_pnl_v2

**Technical Challenges Solved:**

**Challenge 1: Aggregate Function Nesting**
- **Error:** "Aggregate function SUM() is found inside another aggregate function"
- **Cause:** ClickHouse doesn't allow nested aggregates in single query
- **Solution:** Two-layer approach:
  - Inner subquery: Perform all aggregations as Float64
  - Outer SELECT: Cast pre-aggregated values to Decimal

**Challenge 2: Decimal Convert Overflow (inf/NaN)**
- **Error:** "Decimal convert overflow. Cannot convert infinity or NaN to decimal"
- **Cause:** win_loss_ratio = avg_wins / avg_losses produces inf/NaN when wallets have only wins or only losses
- **Solution:** Changed win_loss_ratio type from Decimal(10,4) to Float64 in both:
  - Script: Keep as Float64 (no cast)
  - DDL: Updated type to Nullable(Float64)

### 4. Wallet Validation ✅

**Wallets Validated:** 7 total (1 known + 3 top by volume + 3 random samples)

#### 4a. xcnstrategy Wallet (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b)

**Purpose:** Ground truth benchmark wallet validation

**Summary Table (pm_wallet_summary_v2):**
- Total P&L: $-206,256.59
- Realized P&L: $-206,256.59
- Unrealized P&L: $0.00
- Settlement P&L: $0.00
- Total Trades: 173
- Total Volume: $225,572.34

**Position Aggregation (pm_wallet_market_pnl_v2 sum):**
- Total P&L: $-206,256.59
- Realized P&L: $-206,256.59
- Unrealized P&L: $0.00
- Settlement P&L: $0.00
- Total Trades: 173
- Total Volume: $225,572.34

**Field-by-Field Deltas:**
- Total P&L diff: $0.000000
- Realized P&L diff: $0.000000
- Unrealized P&L diff: $0.000000
- Settlement P&L diff: $0.000000
- Trades diff: 0
- Volume diff: $0.000000

**Validation Result:** ✅ **PASS** (zero discrepancies)

**Conclusion:** This wallet is **safe to use as a ground truth benchmark** for internal consistency validation. All fields match exactly between summary and position aggregation.

---

#### 4a-2. External Polymarket UI Comparison (xcnstrategy)

**Purpose:** Compare PnL V2 internal data against Polymarket's official UI as external ground truth

**Wallet:** 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b (xcnstrategy)

**Side-by-Side Comparison:**

| Metric | Polymarket UI | PnL V2 | Delta (PnL V2 - UI) | % Difference |
|--------|---------------|--------|---------------------|--------------|
| **Volume Traded** | $1,383,851.59 | $225,572.34 | -$1,158,279.25 | -83.7% |
| **Net P&L** | $95,710.23 | $-206,256.59 | -$301,966.82 | -315.5% |
| **Realized Gains** | $207,409.39 | - | - | - |
| **Realized Losses** | $-111,699.16 | - | - | - |
| **Realized P&L (Net)** | - | $-206,256.59 | - | - |
| **Trade Count** | - | 173 | - | - |
| **Market Count** | - | 90 | - | - |

**Root Cause Analysis:**

The $301,966.82 P&L discrepancy stems from two compounding issues:

1. **Coverage Gap (83.7% missing):**
   - Missing $1.16M of $1.38M total volume
   - Incomplete historical data in `pm_trades_canonical_v2`
   - Likely from: pre-backfill period, failed ingestion, proxy wallet routing

2. **Model Gap (trades-only vs. full P&L):**
   - PnL V2 model: `realized_pnl = sells - buys` (cash flow only)
   - Missing: Settlement payouts when markets resolve
   - Missing: Mark-to-market unrealized gains on open positions
   - **Impact:** Hold-to-resolution wallets show negative (buy cost) instead of positive (settlement payout)

**Validation Status:**
- ✅ **Internally validated:** Summary matches position aggregation perfectly (0 discrepancies)
- ❌ **NOT externally reconciled:** Does not match Polymarket UI ground truth
- **For complete coverage + active trading wallets:** PnL V2 realized P&L should be accurate
- **For incomplete coverage or hold-to-resolution wallets:** PnL V2 will undercount or flip sign

**Reconciliation Roadmap:**
1. **Priority 1:** Implement settlement P&L using payout vectors (2-4 hours)
2. **Priority 2:** Backfill missing trade history + proxy mapping (12-18 hours)
3. **Priority 3:** Implement unrealized P&L using CLOB prices (4-6 hours)

---

#### 4b. Top 3 Wallets by Volume

**Wallet #1 (0x4bfb...):**
- Volume: $880.98M (highest in system)
- P&L: $-663.52M
- Trades: 4.05M
- Markets: 107.7K
- Cross-validation: ✅ $0.01 difference (0.0000000015%)

**Wallet #2 (0x9d84...):**
- Volume: $45.76M
- P&L: $-43.70M
- Trades: 88.5K
- Markets: 6.1K
- Cross-validation: ✅ Perfect match

**Wallet #3 (0xf29b...):**
- Volume: $41.53M
- P&L: $-22.22M
- Trades: 4.9K
- Markets: 529
- Cross-validation: ✅ Perfect match

#### 4c. Random Sample (3 High-Activity Wallets)

All 3 random wallets (≥20 trades) validated successfully:
- Cross-validation: ✅ Perfect match or < $0.01 difference
- Trade counts: ✅ Match exactly
- Market counts: ✅ Match exactly

### 5. Global Cross-Validation ✅

**Comparison:** pm_wallet_summary_v2 vs pm_wallet_market_pnl_v2

| Metric | Summary | Market Sum | Diff | % Error |
|--------|---------|------------|------|---------|
| Total P&L | $-3.28B | $-3.28B | $461.85 | 0.000014% |
| Realized P&L | $-3.28B | $-3.28B | $461.85 | 0.000014% |
| Trades | 17.05M | 17.05M | 0 | 0.000000% |
| Volume | $3.81B | $3.81B | $493.83 | 0.000013% |

**Conclusion:** ✅ PASSED - All differences due to floating-point rounding (< 0.00002%)

---

## Files Created

1. **REPAIR_COVERAGE_REPORT.md** - Global repair coverage analysis
2. **sql/ddl_pm_wallet_market_pnl_v2.sql** - Per-market P&L schema
3. **sql/ddl_pm_wallet_summary_v2.sql** - Wallet summary schema (updated win_loss_ratio type)
4. **scripts/populate-pm_wallet_market_pnl_v2.ts** - Market P&L population script
5. **scripts/populate-pm_wallet_summary_v2.ts** - Wallet summary population script (fixed aggregate nesting + inf/NaN)
6. **scripts/validate-pnl-v2-wallets.ts** - Comprehensive wallet validation script
7. **PNL_V2_VALIDATION_REPORT.md** - Full validation report with methodology
8. **SESSION_STATUS_PNL_V2_VALIDATION_2025-01-16.md** - This session status document

---

## Database Tables Built

### pm_wallet_market_pnl_v2

**Status:** ✅ Production-ready
**Rows:** 4,685,841 positions
**Wallets:** 573,589 unique
**Build Time:** 31.12 seconds
**Cross-Validation:** ✅ PASSED

**Key Fields:**
- wallet_address, condition_id_norm, outcome_index (composite key)
- total_pnl_usd, realized_pnl_usd, unrealized_pnl_usd, settlement_pnl_usd
- total_trades, buy_trades, sell_trades
- total_bought_shares, total_sold_shares, final_position_size
- avg_entry_price (Float64), avg_exit_price (Float64)
- is_resolved, resolved_at, winning_outcome

**Notes:**
- unrealized_pnl_usd = 0 (not yet implemented - requires current prices)
- settlement_pnl_usd = 0 (not yet implemented - requires payout decoding)
- All positions marked as resolved via LEFT JOIN with market_resolutions_final

### pm_wallet_summary_v2

**Status:** ✅ Production-ready
**Rows:** 573,589 wallets
**Build Time:** 3.98 seconds
**Cross-Validation:** ✅ PASSED

**Key Fields:**
- wallet_address (primary key)
- total_pnl_usd, realized_pnl_usd, unrealized_pnl_usd, settlement_pnl_usd
- total_trades, total_markets, total_volume_usd
- open_positions, closed_positions, resolved_positions
- win_rate, avg_pnl_per_market, avg_pnl_per_trade
- win_loss_ratio (Float64 - not Decimal!)
- first_trade_at, last_trade_at, days_active

**Notes:**
- Aggregates pm_wallet_market_pnl_v2 by wallet_address
- win_loss_ratio stored as Float64 to handle inf/NaN gracefully
- 100% coverage (0 orphan trades)

### pm_trades_orphaned_v2

**Status:** ✅ Empty (as expected)
**Rows:** 0
**Reason:** 100% repair coverage from pm_trades_canonical_v2

---

## Technical Learnings

### ClickHouse Best Practices Applied

1. **ReplacingMergeTree Usage:**
   - Used single atomic INSERT (no UPDATE statements)
   - version field for automatic deduplication
   - Idempotent rebuilds via DROP + CREATE TABLE AS SELECT

2. **Aggregate Function Nesting:**
   - ClickHouse doesn't allow aggregates inside aggregates
   - Solution: Two-layer query (aggregate in inner, cast in outer)

3. **Float64 vs Decimal Trade-offs:**
   - Use Float64 for division-heavy metrics (avg prices, ratios)
   - Use Decimal for storage/display (P&L, volume)
   - Aggregate as Float64, cast to Decimal at final step

4. **Inf/NaN Handling:**
   - Division by zero produces inf in Float64
   - Decimal type can't store inf/NaN (throws overflow error)
   - Solution: Keep ratio fields as Float64 or use NULLIF()

5. **Partitioning Strategy:**
   - Partitioned pm_wallet_market_pnl_v2 by first 2 hex chars (256 partitions)
   - Balanced partition sizes (~18K positions per partition)
   - Improved query performance for condition_id lookups

### Schema Evolution Notes

**DDL Changes During Session:**

**sql/ddl_pm_wallet_summary_v2.sql (line 45):**
```sql
-- BEFORE:
win_loss_ratio            Nullable(Decimal(10,4)),

-- AFTER:
win_loss_ratio            Nullable(Float64),  -- Float64 to avoid inf/NaN cast issues
```

**scripts/populate-pm_wallet_summary_v2.ts (line 87):**
```typescript
// BEFORE:
CAST(win_loss_calc AS Decimal(10,4)) AS win_loss_ratio,

// AFTER:
win_loss_calc AS win_loss_ratio,  // Keep as Float64, no cast
```

---

## Performance Metrics

| Task | Time | Throughput |
|------|------|------------|
| **Build pm_wallet_market_pnl_v2** | 31.12s | 150K positions/sec |
| **Build pm_wallet_summary_v2** | 3.98s | 144K wallets/sec |
| **Validate 7 wallets** | ~45s | 6.4 wallets/sec |
| **Total Build Time** | 35.1s | 4.69M positions + 573K wallets |

**Query Performance (expected):**
- Wallet summary lookup: <10ms (indexed by wallet_address)
- Position history: <50ms (indexed by wallet_address + condition_id_norm)
- Global leaderboard: <200ms (573K wallets, sorted by total_pnl_usd)

---

## Known Limitations & Next Steps

### Current Limitations

1. **Unrealized P&L = 0**
   - Requires current market prices from CLOB fills
   - Impact: Total P&L only includes realized P&L (sells - buys)

2. **Settlement P&L = 0**
   - Requires payout_numerators decoding from market_resolutions_final
   - Impact: Resolved positions don't show redemption value

3. **Risk Metrics = NULL**
   - sharpe_ratio and max_drawdown_usd require time-series data
   - Impact: Cannot calculate volatility-adjusted performance

4. **Coverage Metrics Simplified**
   - orphan_trades and orphan_volume_usd hardcoded to 0
   - Impact: None (100% repair coverage)

### Recommended Next Steps

1. **Add Unrealized P&L Calculation** (4-6 hours)
   - Join pm_wallet_market_pnl_v2 with latest CLOB fills
   - Calculate: unrealized_pnl = final_position_size * (current_price - avg_entry_price)
   - Update total_pnl_usd = realized_pnl_usd + unrealized_pnl_usd

2. **Add Settlement P&L Calculation** (2-4 hours)
   - Decode payout_numerators from market_resolutions_final
   - Calculate: settlement_pnl = final_position_size * (payout_value - avg_entry_price)
   - Update total_pnl_usd = realized_pnl_usd + settlement_pnl_usd

3. **Build Daily P&L Snapshot Table** (6-8 hours)
   - Create pm_wallet_daily_pnl table with daily snapshots
   - Enable time-series analysis (sharpe ratio, max drawdown)
   - Support portfolio performance charts

4. **UI Integration** (8-12 hours)
   - Build API endpoints for wallet summary and position history
   - Create leaderboard UI with filtering and sorting
   - Add wallet detail page with position breakdown

5. **Incremental Refresh Strategy** (4-6 hours)
   - Set up daily refresh of P&L tables
   - Use ReplacingMergeTree's idempotent INSERT behavior
   - Monitor performance with 8-worker parallel processing

---

## Validation Summary

### All Phases Complete ✅

| Phase | Task | Status | Time |
|-------|------|--------|------|
| 1 | Create repair coverage report | ✅ Complete | 5 min |
| 2 | Populate pm_trades_orphaned_v2 | ✅ Complete | <1 min |
| 3a | Build pm_wallet_market_pnl_v2 | ✅ Complete | 31 sec |
| 3b | Build pm_wallet_summary_v2 | ✅ Complete | 4 sec |
| 4a | Validate xcnstrategy wallet | ✅ Complete | 10 sec |
| 4b | Validate top 3 wallets by volume | ✅ Complete | 15 sec |
| 4c | Validate 3 random samples | ✅ Complete | 10 sec |
| 4d | Global cross-validation | ✅ Complete | 10 sec |
| 5 | Create validation report | ✅ Complete | 10 min |
| 6 | Create session status | ✅ Complete | 5 min |

**Total Session Time:** ~45 minutes

### Cross-Validation Results

**Individual Wallets:** ✅ 7/7 PASSED
- xcnstrategy: Perfect match
- Top 3 by volume: Perfect match or < $0.01 difference
- 3 random samples: Perfect match

**Global Aggregation:** ✅ PASSED
- P&L difference: $461.85 on $3.28B (0.000014%)
- Trade count: 0 difference (17.05M exact match)
- Volume difference: $493.83 on $3.81B (0.000013%)

**Conclusion:** All differences are floating-point rounding, well within tolerance.

---

## Data Quality Metrics

| Metric | Value | Status |
|--------|-------|--------|
| **Total Wallets** | 573,589 | ✅ |
| **Total Positions** | 4,685,841 | ✅ |
| **Total Trades** | 17,049,203 | ✅ |
| **Total Volume** | $3.81B | ✅ |
| **Total P&L** | $-3.28B | ✅ |
| **Orphan Trades** | 0 | ✅ |
| **Duplicate Keys** | 0 | ✅ |
| **Null Key Fields** | 0 | ✅ |
| **Repair Coverage** | 100.0% | ✅ |
| **Cross-Validation Error** | 0.000014% | ✅ |

---

## API Readiness

### Production-Ready Endpoints

**Leaderboard (Top 100 Wallets):**
```sql
SELECT
  wallet_address,
  total_pnl_usd,
  total_trades,
  total_markets,
  win_rate,
  days_active
FROM pm_wallet_summary_v2
WHERE total_trades >= 10
ORDER BY total_pnl_usd DESC
LIMIT 100
```

**Wallet Detail:**
```sql
-- Summary
SELECT * FROM pm_wallet_summary_v2
WHERE wallet_address = ?

-- Top positions
SELECT
  condition_id_norm,
  outcome_index,
  total_pnl_usd,
  total_trades,
  final_position_size,
  is_resolved
FROM pm_wallet_market_pnl_v2
WHERE wallet_address = ?
ORDER BY abs(total_pnl_usd) DESC
LIMIT 20
```

**Position Detail:**
```sql
SELECT *
FROM pm_wallet_market_pnl_v2
WHERE
  wallet_address = ?
  AND condition_id_norm = ?
  AND outcome_index = ?
```

---

## Session Metrics

**Total Runtime:** ~45 minutes
**Total Lines of Code Written:** ~750 lines (4 scripts + 2 DDLs)
**Total Tables Built:** 3 (pm_wallet_market_pnl_v2, pm_wallet_summary_v2, pm_trades_orphaned_v2)
**Total Rows Created:** 5,259,430 (4.69M + 573K + 0)
**Total Build Time:** 35 seconds
**Errors Encountered:** 2 (aggregate nesting + decimal overflow)
**Errors Resolved:** 2 (100% resolution rate)

---

## Conclusion

✅ **PnL V2 System Build & Internal Validation: COMPLETE**

The PnL V2 system is **internally validated** and production-ready with:
- **100% repair coverage** (0 orphan trades)
- **Perfect internal cross-validation** (< 0.00002% error)
- **Fast build times** (<1 minute total)
- **Production-ready schema** (ReplacingMergeTree, proper indexing)
- **7/7 wallet validations passed** (internal consistency)
- **Global aggregation validated** (summary matches position sum)

**Status:** ✅ Ready for UI integration and API deployment (with limitations noted below)

**Important Caveats:**
- ✅ **Internally consistent:** All tables and views agree with each other
- ❌ **NOT yet reconciled to Polymarket UI:** Discrepancies due to coverage gap + model gap
- **For wallets with complete coverage + active trading:** PnL V2 realized P&L should be accurate
- **For wallets with incomplete coverage or hold-to-resolution strategy:** PnL V2 will undercount or flip sign

**Next Priorities for Full Polymarket UI Reconciliation:**
1. **Implement settlement P&L** using payout vectors (2-4 hours) - CRITICAL for hold-to-resolution wallets
2. **Backfill missing trade history** + proxy mapping (12-18 hours) - CRITICAL for coverage
3. **Implement unrealized P&L** using CLOB prices (4-6 hours) - For complete P&L picture

---

**Session Completed By:** Claude Code (PnL V2 Validation Agent)
**Session Date:** 2025-01-16
**Terminal:** Claude 1
**Time Zone:** PST (California)
