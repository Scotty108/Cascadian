# Phase 2: Leaderboard Materialization (mid-2022→present)

## Overview

Phase 2 materializes wallet metrics and builds multi-dimensional leaderboards from locked Phase 1 data. This phase takes verified P&L (-$27,558.71 baseline) and transforms it into:

1. **Wallet Metrics Table** (ClickHouse ReplacingMergeTree): Per-wallet aggregates across 4 time windows
2. **Ranking Views** (SQL views): Top 50 whales, Omega ratio leaders, ROI leaders
3. **Export Pipelines** (JSON/CSV): Ready for API and dashboard consumption
4. **Documentation**: Schema, metric definitions, example queries, API contract

---

## Status

| Component | Status | Tests | Duration |
|-----------|--------|-------|----------|
| Database Layer (TG 1-2) | Ready to implement | 11 | 4-6h |
| API Layer (TG 3-4) | Ready to implement | 9 | 3-4h |
| Docs & Integration (TG 5) | Ready to implement | 2 | 2-3h |
| **TOTAL** | **Ready for team** | **22** | **9-13h** |

---

## Key Assumptions (Locked)

- **P&L Baseline:** -$27,558.71 USD (wallet 0xcce2...58b)
- **Data Source:** Phase 1 `trades_with_direction` (95.3M rows, validated)
- **Time Window:** mid-2022→present (block_time ≥ 2022-06-01)
- **Market Count:** 141 resolved markets (P&L locked)
- **Coverage:** 0% metadata staging (MVP; graceful UNKNOWN fallback)

---

## Quick Navigation

### For Task Runners
- **START HERE:** `IMPLEMENTATION_GUIDE.md` (5-8 min read)
  - Role-based task assignment
  - Test-first pattern
  - Common gotchas
  - File organization
  - Troubleshooting checklist

### For Project Managers
- **MASTER TASK LIST:** `tasks.md` (30-50 min read)
  - All 22 tasks with 5 task groups
  - Execution strategy (4-day timeline)
  - Success criteria per group
  - Risk mitigation
  - Deliverables checklist

### For Architects/Reviewers
- **SPEC REFERENCE:** `/phase2/spec.md`
  - Original Phase 2 specification
  - Business requirements
  - Data model (materialized views)
  - Performance targets
  - Success criteria

---

## What Gets Built (Deliverables)

### 1. Database Layer
**Files:**
- `migrations/clickhouse/005_create_wallet_metrics_phase2.sql` (schema)
- `lib/clickhouse/metrics-calculator.ts` (calculation functions)
- `scripts/compute-wallet-metrics-phase2.ts` (population script)

**Output:**
- `wallet_metrics` table (ReplacingMergeTree)
  - Columns: wallet_address, time_window, realized_pnl, roi_pct, omega_ratio, sharpe_ratio, ...
  - Rows: All unique wallets × 4 time windows
  - Indexed: (wallet_address, time_window)
  - Partitioned by: time_window

**Tests:** 11 (6 calculation + 5 population)

---

### 2. API Layer
**Files:**
- `migrations/clickhouse/views/v_leaderboard_whale.sql` (top 50 by P&L)
- `migrations/clickhouse/views/v_leaderboard_omega.sql` (top 50 by Omega)
- `migrations/clickhouse/views/v_leaderboard_roi.sql` (top 50 by ROI%)
- `scripts/export-wallet-metrics-json.ts` (nested JSON export)
- `scripts/export-wallet-metrics-csv.ts` (flat CSV export)
- `scripts/export-leaderboards-json.ts` (leaderboard JSON export)

**Output:**
- 3 queryable leaderboard views (<100ms per query)
- JSON/CSV export files (ready for API endpoints)
- Metadata LEFT JOIN pattern (graceful UNKNOWN fallback)

**Tests:** 9 (5 views + 4 exports)

---

### 3. Documentation
**Files:**
- `docs/leaderboard-schema.md` (table structure, indexing)
- `docs/leaderboard-metrics.md` (metric definitions, formulas, ranges)
- `docs/leaderboard-queries.md` (5 example SQL queries)
- `docs/leaderboard-api-integration.md` (API contract, usage examples)

**Output:**
- Complete schema documentation
- Metric definitions with formulas and interpretation
- Example dashboard queries (copy-paste ready)
- Frontend integration guide

**Tests:** 2 integration (end-to-end + JOIN pattern)

---

## Test Coverage

All tests are **focused** (2-8 per group, max):

| Group | Tests | Focus |
|-------|-------|-------|
| 1. Metrics Calculation | 6 | Formula validation, edge cases, baseline |
| 2. Table Population | 5 | Schema, data integrity, P&L parity |
| 3. Leaderboard Views | 5 | Ranking, JOIN patterns, performance |
| 4. Data Export | 4 | Format validation, encoding, completeness |
| 5. Integration & Docs | 2 | End-to-end workflow, documentation accuracy |
| **TOTAL** | **22** | **Critical paths only** |

**Test Execution:** ~2 hours total (focused tests only, not full suite)

---

## Timeline

```
Day 1 (4-6 hours)
├─ TG1: Metric calculations (1.5-2h)
│   └─ Database Engineer
│   └─ 6 tests, 1 module
├─ TG2: wallet_metrics table (2.5-3h)
│   └─ Database Engineer (depends on TG1)
│   └─ 5 tests, 1 schema, 1 script
│   └─ GATE: P&L parity verified ✓
│
Day 2-3 (3-4 hours, can start Day 2)
├─ TG3: Leaderboard views (1-1.5h)
│   └─ Backend Engineer (depends on TG2)
│   └─ 5 tests, 3 views
├─ TG4: Export pipelines (1.5-2h)
│   └─ Backend Engineer (depends on TG3)
│   └─ 4 tests, 3 scripts
│   └─ GATE: Leaderboards <100ms, exports valid ✓
│
Day 3-4 (2-3 hours, parallel with TG3-4)
└─ TG5: Integration & docs (2-3h)
    └─ Doc/API Engineer (depends on TG3-4)
    └─ 2 tests, 4 docs
    └─ GATE: Docs complete, examples verified ✓

Total: 9-13 hours over 3-4 days
Team: 3 specialists (can work in parallel)
```

---

## Success Criteria

### Phase 2A (Database Layer)
- [x] wallet_metrics table created and populated
- [x] P&L parity verified: sum(realized_pnl) = -27,558.71 USD
- [x] All 4 time windows populated (30d, 90d, 180d, lifetime)
- [x] 11 tests passing (6+5)
- [x] No NULL values in critical metrics

### Phase 2B (API Layer)
- [x] 3 leaderboard views created (whale, omega, roi)
- [x] Metadata LEFT JOIN gracefully handles missing data
- [x] Leaderboards return ≤50 ranked rows each
- [x] Query performance <100ms per leaderboard
- [x] 9 tests passing (5+4)

### Phase 2C (Documentation & Integration)
- [x] Schema documentation complete and accurate
- [x] Metric definitions with formulas and interpretation
- [x] Example queries provided and verified executable
- [x] API integration guide written for frontend team
- [x] 2 integration tests passing
- [x] All 22 tests passing, total runtime <2 hours

---

## Key Decisions

### 1. Test-First Approach
- Write tests BEFORE implementation (standard practice)
- 2-8 focused tests per group (critical behaviors only)
- Skip edge cases, error states, non-critical paths
- Verify each group independently before moving to next

### 2. Atomic Rebuilds (AR Pattern)
- Use `CREATE TABLE ... AS SELECT` then `RENAME` for population
- Never use `ALTER ... UPDATE` on large ranges
- Ensures idempotent, crash-safe updates

### 3. Graceful Metadata Fallback
- Metadata staging table optional for MVP (0% coverage expected)
- LEFT JOIN pattern returns all leaderboard rows
- Missing metadata → "UNKNOWN" or NULL (not an error)

### 4. P&L Parity Gate
- Sum of all wallet P&L must equal baseline (-$27,558.71)
- Critical validation at end of Task Group 2
- If mismatch, debug metric formulas in Task Group 1
- Blocks progression to Phase 2B until verified

### 5. Time Window Isolation
- Each (wallet, time_window) is independent row
- 4 windows: 30d, 90d, 180d, lifetime
- No circular dependencies or inter-window calculations
- Can be computed in parallel

---

## Data Flow

```
Phase 1 Outputs (Locked)
├─ trades_with_direction (95.3M rows)
├─ trades_with_direction has: wallet, condition_id, cashflow_usdc, direction, block_time
├─ market_resolutions_final (141 rows)
└─ Has: condition_id, winning_outcome_index, payout_vector

Phase 2A: Metrics Calculation (TG1-2)
├─ Extract per-wallet P&L from trades_with_direction
├─ Calculate realized_pnl, roi_pct, sharpe_ratio, omega_ratio
├─ Fetch unrealized payouts from market_resolutions_final
├─ Materialize to wallet_metrics table
└─ OUTPUT: wallet_metrics (all wallets × 4 windows)

Phase 2B: Ranking Views (TG3)
├─ Query wallet_metrics table
├─ LEFT JOIN metadata_staging (optional)
├─ Rank by different metrics
├─ Filter to top 50 per metric
└─ OUTPUT: 3 leaderboard views

Phase 2C: Exports & Docs (TG4-5)
├─ Export wallet_metrics to JSON/CSV
├─ Export leaderboards to JSON
├─ Create schema/metric documentation
├─ Create example queries for dashboard
└─ OUTPUT: 3 exports + 4 documentation files

Result: Leaderboards live, API-ready, documented
```

---

## Implementation Checkpoints

### After Task Group 1 (Metrics Calculation)
```
✓ 6 metric calculation tests passing
✓ Baseline wallet (0xcce2...58b) verified: -$27,558.71
✓ Sample wallet spot-checks match manual calculations
✓ Ready for Task Group 2
```

### After Task Group 2 (Metrics Table)
```
✓ 5 population tests passing
✓ wallet_metrics table exists and is populated
✓ P&L parity gate: sum(realized_pnl) = -$27,558.71 ✓
✓ 4 time windows populated (30d, 90d, 180d, lifetime)
✓ Ready for Task Group 3
```

### After Task Group 3 (Leaderboard Views)
```
✓ 5 leaderboard view tests passing
✓ 3 views created: whale, omega, roi
✓ Leaderboard queries execute <100ms
✓ Each returns ≤50 ranked rows
✓ Metadata LEFT JOIN verified (graceful fallback)
✓ Ready for Task Group 4
```

### After Task Group 4 (Exports)
```
✓ 4 export tests passing
✓ JSON exports: wallet_metrics, leaderboards
✓ CSV exports: wallet_metrics (flat)
✓ All exports complete <5s per file
✓ Exports valid JSON/CSV, UTF-8 encoded
✓ Ready for Task Group 5
```

### After Task Group 5 (Integration & Docs)
```
✓ 2 integration tests passing
✓ End-to-end workflow verified
✓ Schema documentation complete
✓ Metric definitions with formulas
✓ Example queries provided and executable
✓ API integration guide written
✓ PHASE 2 COMPLETE ✓
```

---

## How to Use This Repository

### 1. For Developers
Start with `IMPLEMENTATION_GUIDE.md`:
- Choose your role (Database Engineer / Backend Engineer / Doc Engineer)
- Follow your task group sequence
- Use `tasks.md` as detailed reference
- Run tests as you complete each sub-task

### 2. For Reviewers
Check these files in order:
1. `tasks.md` - Task breakdown and success criteria
2. Code files (migrations, scripts, docs) - Implementation
3. Test files - Verification

### 3. For Project Managers
Monitor progress using `tasks.md`:
- Each task group has X.1 through X.6 sub-tasks
- Checkpoints are gates (TG1→TG2, TG2→TG3, etc.)
- Expected timeline: 9-13 hours over 3-4 days

---

## References

### Phase 2 Documents (This Folder)
- **spec.md** - Original business requirement
- **tasks.md** - Detailed task breakdown (22 tasks, 5 groups)
- **IMPLEMENTATION_GUIDE.md** - Quick reference for task runners
- **README.md** - This file (overview)

### Phase 1 Documents (Parent)
- `../phase1/spec.md` - Phase 1 specification
- `../phase1/tasks.md` - Phase 1 tasks (completed)

### Project Standards
- `CLAUDE.md` - Project conventions, patterns, terminology
- `docs/archive/agent-os-*/standards/` - Coding standards
- `migrations/clickhouse/` - ClickHouse schema patterns

### Key Data Sources
- `lib/clickhouse/client.ts` - ClickHouse query client
- `lib/clickhouse/mutations.ts` - Table mutation patterns
- `lib/clickhouse/queries/` - Example query structure
- `migrations/clickhouse/004_create_wallet_metrics_complete.sql` - Reference schema

---

## FAQ

### Q: Can we parallelize task groups?
**A:** Yes! TG1-2 are sequential (DB layer), but TG3-4 can start once TG2 completes. TG5 can start alongside TG3-4 if documentation can be sketched early.

### Q: What if P&L doesn't match baseline?
**A:** Debug in Task Group 1 metric calculation tests. Check formula against manual spot-check. Most common: incorrect array indexing (use `+1` for ClickHouse) or wrong division handling (NULL for zero).

### Q: Do we need metadata staging table?
**A:** No, it's optional for MVP. Implement LEFT JOIN with graceful fallback (expect UNKNOWN for all wallets in MVP). Can add metadata later.

### Q: How many wallets will be in wallet_metrics?
**A:** All unique wallets in trades_with_direction (likely 2,800-10,000 depending on data). Each gets 4 rows (one per time window).

### Q: What's the expected runtime for Task Groups?
**A:** TG1: 1.5-2h, TG2: 2.5-3h, TG3: 1-1.5h, TG4: 1.5-2h, TG5: 2-3h. Total: 9-13h over 3-4 days.

### Q: Are there any blockers?
**A:** No hard blockers. Phase 1 data is locked. ClickHouse is running. Ready to start immediately.

---

## Next Steps

### Immediately (When Phase 2 starts)
1. Assign roles: Database Engineer (TG1-2), Backend Engineer (TG3-4), Doc Engineer (TG5)
2. Read IMPLEMENTATION_GUIDE.md (5 min each)
3. Clone test template and create task-group-1.test.ts
4. Start TG1 (metric calculations)

### After Phase 2 Complete
1. Merge leaderboard views to main
2. Deploy exports to API endpoints
3. Integrate leaderboard into frontend dashboard
4. Start Phase 3 (Real-time metrics refresh)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Realized P&L** | Sum of all cashflows from trades (buys = -USDC, sells = +USDC) + redemptions |
| **Unrealized P&L** | Payout value of open positions if market resolved today |
| **ROI%** | (Total P&L / Cost Basis) × 100 |
| **Omega Ratio** | Sum of gains / sum of losses (higher = better risk-adjusted returns) |
| **Sharpe Ratio** | (Mean return / Volatility) × sqrt(252) (annualized) |
| **Time Windows** | 30d, 90d, 180d rolling, and lifetime (all-time) |
| **Leaderboard** | Ranked list of top 50 wallets by metric (P&L, Omega, ROI) |
| **Materialized** | Pre-computed and stored in a table (not a view) |
| **P&L Parity Gate** | Verification that sum of all wallet P&L = -$27,558.71 (baseline) |
| **AR (Atomic Rebuild)** | CREATE TABLE AS SELECT → RENAME pattern (never ALTER UPDATE) |

---

## Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2025-11-10 | Initial release: 5 task groups, 22 tests, 9-13h timeline |

---

**Status:** READY FOR IMPLEMENTATION

**Last Updated:** 2025-11-10

**Questions?** Check IMPLEMENTATION_GUIDE.md or detailed tasks in tasks.md
