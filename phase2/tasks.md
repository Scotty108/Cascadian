# Task Breakdown: Phase 2 Leaderboard Materialization (mid-2022→present)

## Overview
**Timeline:** 3-4 days | **Prerequisites:** Phase 1 gates passed, baseline P&L locked (-$27,558.71)
**Total Tasks:** 22 | **Test Groups:** 5 | **Total Focused Tests:** 23

**Scope:** Materialize comprehensive wallet performance metrics for mid-2022→present window (block_time ≥ 2022-06-01), enabling multi-dimensional leaderboards and wallet discovery APIs.

---

## Executive Summary

This phase materializes wallet metrics from locked Phase 1 data, building:
1. **Wallet Metrics Table** (ReplacingMergeTree): Per-wallet aggregates (P&L, ROI, win rate, risk metrics)
2. **Leaderboard Views**: Ranked wallets (whale, omega, ROI, accuracy)
3. **Export Pipelines**: JSON/CSV output for API consumption
4. **Dashboard Integration**: Example queries + JOIN patterns

**Key Constraint:** Verify wallet-level metrics sum to global baseline (-$27,558.71) to ensure calculation correctness.

---

## Task List

### Database Layer

#### Task Group 1: Wallet Metrics Calculation Engine
**Dependencies:** None (uses Phase 1 locked data)
**Estimated Time:** Medium (2-3 hours)
**Specialist:** Database Engineer / Backend Engineer

- [ ] 1.0 Create wallet metrics calculation module
  - [ ] 1.1 Write 6 focused tests for metric formulas
    - Test 1: Realized P&L calculation (sum of cashflows) matches cost basis
    - Test 2: Unrealized payout calculation (from market_resolutions_final)
    - Test 3: ROI% formula (total_pnl / initial_deployment ≥ -100%)
    - Test 4: Win rate calculation (count resolved wins / count resolved markets)
    - Test 5: Sharpe ratio (annualized return / return volatility)
    - Test 6: Omega ratio (gain_prob × avg_gain) / (loss_prob × avg_loss)

  - [ ] 1.2 Implement realized P&L calculation function
    - Formula: sum(cashflow_usdc) for all trades + redemptions in market
    - Filter: block_time ≥ 2022-06-01, wallet_address = target
    - Validation: Must be non-positive for losing wallets (cash outflow)

  - [ ] 1.3 Implement unrealized payout calculation function
    - Input: market_resolutions_final (condition_id, winning_outcome_index, payout_vector)
    - Logic: shares × payout_vector[winning_index + 1] / payout_denominator
    - Validation: Only for resolved markets, payout ≥ 0
    - Handle unresolved markets: unrealized_payout = 0

  - [ ] 1.4 Implement ROI percentage calculation
    - Formula: (realized_pnl + unrealized_payout - cost_basis) / cost_basis × 100
    - Edge case: cost_basis = 0 → ROI = N/A, flag with NULL
    - Range check: ROI ∈ [-100%, ∞)

  - [ ] 1.5 Implement win rate and Sharpe/Omega metrics
    - Win rate: count(markets where pnl > 0) / count(resolved markets)
    - Sharpe: (mean_daily_pnl) / (stddev_daily_pnl) × sqrt(252)
    - Omega(τ=0): sum(gains) / sum(losses); handle division by zero → NULL
    - Validation: Sharpe ∈ [-5, 10], Omega ∈ [0, ∞)

  - [ ] 1.6 Ensure metric calculation tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify formulas on sample wallet 0xcce2...58b (baseline -$27,558.71)
    - No NULL critical fields in output
    - All metrics in valid ranges

**Acceptance Criteria:**
- All 6 metric calculation tests pass
- Sample wallet baseline verified: total_pnl = -27,558.71 USD
- Metric formulas validated against manual spot-checks
- No division-by-zero errors (proper NULL handling)

---

#### Task Group 2: Wallet Metrics Table Creation & Population
**Dependencies:** Task Group 1
**Estimated Time:** Medium (2-3 hours)
**Specialist:** Database Engineer

- [ ] 2.0 Materialize wallet metrics in ClickHouse
  - [ ] 2.1 Write 5 focused tests for table creation and population
    - Test 1: Create wallet_metrics ReplacingMergeTree with correct schema
    - Test 2: Populate table with all wallets from trades_with_direction (mid-2022→present)
    - Test 3: Verify unique wallet count matches trades_with_direction
    - Test 4: Verify total P&L across all wallets sums to global baseline
    - Test 5: Verify no NULL values in critical metric columns

  - [ ] 2.2 Create wallet_metrics ReplacingMergeTree schema
    - Columns: wallet_address, time_window (Enum: '30d', '90d', '180d', 'lifetime')
    - Core metrics: realized_pnl, unrealized_payout, roi_pct, win_rate
    - Risk metrics: sharpe_ratio, omega_ratio, max_drawdown, volatility
    - Activity metrics: total_trades, markets_traded, avg_trade_size
    - Metadata: calculated_at DateTime, updated_at DateTime
    - Engine: ReplacingMergeTree(updated_at), PARTITION BY time_window
    - Index: (wallet_address, time_window) as primary order key
    - Reuse pattern: `migrations/clickhouse/004_create_wallet_metrics_complete.sql`

  - [ ] 2.3 Implement population script for 'lifetime' window
    - Source: trades_with_direction (already filtered, validated)
    - Scope: block_time ≥ 2022-06-01
    - Group by: wallet_address
    - Calculate: All metrics from Task Group 1
    - Insert: CREATE TABLE ... AS SELECT, then RENAME (atomic rebuild pattern - AR)
    - Batch size: 1000 wallets per chunk (streaming, memory safe)

  - [ ] 2.4 Implement rolling window calculations (30d, 90d, 180d)
    - Use: dateDiff('day', now(), block_time) for recency filtering
    - Logic: For each wallet, compute metrics over sliding windows
    - Materialized: Insert separate rows per (wallet, window) combination
    - Optimization: Run windows in parallel (3 parallel jobs)

  - [ ] 2.5 Ensure wallet metrics population tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify row count: total rows = unique_wallets × 4_windows
    - Verify P&L parity: sum(lifetime.realized_pnl) = -27,558.71
    - No timeout or OOM issues for 1000+ wallets
    - Verify daily refresh takes <30 minutes

**Acceptance Criteria:**
- All 5 population tests pass
- wallet_metrics table created and populated
- P&L parity verified: sum of all realized_pnl = -27,558.71 USD
- All 4 time windows (30d, 90d, 180d, lifetime) populated
- No NULL values in critical metric columns
- Table supports <500ms queries on leaderboard lookups

---

### API Layer

#### Task Group 3: Leaderboard Ranking Views
**Dependencies:** Task Group 2
**Estimated Time:** Quick (1-2 hours)
**Specialist:** Backend Engineer / API Engineer

- [ ] 3.0 Build ranking views and metadata integration
  - [ ] 3.1 Write 5 focused tests for leaderboard views
    - Test 1: Create whale_leaderboard view (top 50 by lifetime realized_pnl)
    - Test 2: Create omega_leaderboard view (top 50 by lifetime omega_ratio)
    - Test 3: Create roi_leaderboard view (top 50 by lifetime roi_pct)
    - Test 4: Create accuracy_leaderboard view (test JOIN with metadata staging table)
    - Test 5: Verify leaderboard row counts and ranking column values

  - [ ] 3.2 Create whale_leaderboard view
    - Rank by: realized_pnl DESC
    - Columns: rank (ROW_NUMBER), wallet_address, realized_pnl, roi_pct, total_trades, markets_traded, win_rate
    - Filter: time_window = 'lifetime', block_time ≥ 2022-06-01
    - Limit: 50 rows (top 50 whales by P&L)
    - Order: By realized_pnl DESC, then by total_trades DESC

  - [ ] 3.3 Create omega_leaderboard view
    - Rank by: omega_ratio DESC
    - Columns: rank, wallet_address, omega_ratio, sharpe_ratio, total_trades, win_rate, realized_pnl
    - Filter: time_window = 'lifetime', omega_ratio IS NOT NULL
    - Minimum threshold: total_trades ≥ 10 (statistical significance)
    - Limit: 50 rows

  - [ ] 3.4 Create roi_leaderboard view
    - Rank by: roi_pct DESC
    - Columns: rank, wallet_address, roi_pct, realized_pnl, total_trades, markets_traded
    - Filter: time_window = 'lifetime', roi_pct ≥ -100 (valid ROI range)
    - Minimum: total_trades ≥ 5 (at least 5 trades)
    - Note: Omega leaderboard serves as primary risk-adjusted view; ROI is secondary

  - [ ] 3.5 Test metadata LEFT JOIN pattern
    - Source: leaderboard view (from wallet_metrics)
    - Join: LEFT JOIN market_metadata_wallet_enriched on wallet_address
    - Fallback: Graceful UNKNOWN if metadata missing (0% coverage expected in MVP)
    - Result: Leaderboard with optional metadata columns (name, label, verified)
    - Expected: All 50 rows returned (no inner join drop-off)

  - [ ] 3.6 Ensure leaderboard view tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify each leaderboard: row_count ≤ 50, ranking column is sequential
    - Check JOIN doesn't drop rows (LEFT JOIN integrity)
    - Verify no NULLs in ranking or key metric columns
    - Benchmark: <100ms query time per leaderboard

**Acceptance Criteria:**
- All 5 leaderboard view tests pass
- Three primary leaderboards created: whale, omega, roi
- Metadata LEFT JOIN implemented (graceful fallback for missing data)
- Each leaderboard returns ≤50 ranked rows
- Query performance: <100ms per leaderboard
- Views ready for API consumption

---

### Frontend & Export Layer

#### Task Group 4: Data Export Pipelines
**Dependencies:** Task Group 3
**Estimated Time:** Quick (1-2 hours)
**Specialist:** Backend Engineer

- [ ] 4.0 Implement export pipelines for leaderboard data
  - [ ] 4.1 Write 4 focused tests for export functionality
    - Test 1: Export wallet_metrics to JSON (nested by wallet, time window)
    - Test 2: Export wallet_metrics to CSV (flat rows for analysis)
    - Test 3: Export whale_leaderboard to JSON with metadata
    - Test 4: Verify export integrity (no NULLs, correct format, UTF-8 encoding)

  - [ ] 4.2 Create JSON export pipeline for wallet_metrics
    - Format: Nested structure by wallet_address
    - Example:
      ```json
      {
        "0xcce2...": {
          "lifetime": { "realized_pnl": -27558.71, "roi_pct": -5.2, "omega_ratio": 0.8 },
          "90d": { ... },
          "30d": { ... }
        }
      }
      ```
    - Output: `exports/wallet_metrics_TIMESTAMP.json`
    - Validation: All rows, UTF-8, no NULLs in critical fields

  - [ ] 4.3 Create CSV export pipeline for wallet_metrics
    - Format: Flat rows (wallet_address, time_window, metric1, metric2, ...)
    - Columns: wallet_address, time_window, realized_pnl, roi_pct, omega_ratio, sharpe_ratio, total_trades, markets_traded, win_rate
    - Output: `exports/wallet_metrics_flat_TIMESTAMP.csv`
    - Encoding: UTF-8 with BOM, RFC 4180 compliant

  - [ ] 4.4 Create JSON export for leaderboards
    - Format: Array of ranked wallets with metadata
    - Example: `[{"rank": 1, "wallet_address": "0x...", "realized_pnl": 50000, "metadata": {...}}]`
    - Files:
      - `exports/leaderboard_whale_TIMESTAMP.json`
      - `exports/leaderboard_omega_TIMESTAMP.json`
      - `exports/leaderboard_roi_TIMESTAMP.json`
    - Include: Timestamp, calculated_at, data_freshness

  - [ ] 4.5 Ensure data export tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify exports: valid JSON/CSV, correct field count, UTF-8 encoding
    - Spot-check: Sample row values match source database
    - No NULLs in critical metric columns
    - File write succeeds and completes <5s per export

**Acceptance Criteria:**
- All 4 export tests pass
- JSON exports created: wallet_metrics, leaderboards
- CSV exports created: wallet_metrics flat
- Exports include metadata (timestamp, calculated_at)
- All fields correctly formatted (decimal precision, NULL handling)
- Exports ready for API /GET endpoints

---

### Testing & Integration

#### Task Group 5: Integration & Documentation
**Dependencies:** Task Groups 1-4
**Estimated Time:** Quick (1-2 hours)
**Specialist:** Documentation / API Engineer

- [ ] 5.0 Integration testing and documentation
  - [ ] 5.1 Write 2 focused integration tests
    - Test 1: End-to-end: Calculate metrics → materialize → query leaderboard → export
    - Test 2: Verify dashboard JOIN pattern: leaderboard + metadata + prices (example query)

  - [ ] 5.2 Create schema documentation
    - Document: wallet_metrics table structure, column definitions, metric formulas
    - File: `docs/leaderboard-schema.md`
    - Include:
      - Table: wallet_metrics (columns, data types, indexing)
      - Views: whale_leaderboard, omega_leaderboard, roi_leaderboard
      - Time windows: 30d, 90d, 180d, lifetime (date filter logic)
      - Metric formulas: realized_pnl, roi_pct, sharpe_ratio, omega_ratio
      - Coverage gates: Data quality thresholds (if any)

  - [ ] 5.3 Create metric definitions reference
    - File: `docs/leaderboard-metrics.md`
    - Document each metric:
      - Name, formula, units, valid range
      - Interpretation (higher/lower = better)
      - Examples from sample wallets
      - Edge cases (division by zero, NULL handling)
    - Metrics: realized_pnl, roi_pct, omega_ratio, sharpe_ratio, win_rate, total_trades

  - [ ] 5.4 Create example dashboard queries
    - File: `docs/leaderboard-queries.md`
    - Provide sample SQL queries:
      - Query 1: Get top 10 whales by P&L
      - Query 2: Get top 10 by Omega ratio with minimum trade count
      - Query 3: Get wallet metrics + metadata JOIN example
      - Query 4: Export leaderboard snapshot (JSON/CSV format)
      - Query 5: Trend analysis (compare 30d vs lifetime metrics)
    - Each query: Commented, executable, includes expected rowcount

  - [ ] 5.5 Create API integration guide
    - File: `docs/leaderboard-api-integration.md`
    - Document:
      - Endpoint structure: `/api/leaderboards?metric=...&window=...&limit=...`
      - Response format: JSON with leaderboard array + metadata
      - Cache strategy (if any)
      - Rate limits / performance expectations
      - Frontend usage examples (React component snippets)

  - [ ] 5.6 Ensure integration tests pass
    - Run ONLY the 2 tests written in 5.1
    - Verify end-to-end workflow: metrics → leaderboard → export
    - Verify dashboard example queries execute <500ms
    - No missing dependencies or circular references
    - Documentation examples are executable

**Acceptance Criteria:**
- All 2 integration tests pass
- Schema documentation complete and accurate
- Metric definitions documented (formula, range, interpretation)
- Example queries provided and verified executable
- API integration guide written
- Frontend-ready: Clear contract between backend metrics and UI consumption

---

## Execution Strategy

### Phase 2A: Database Layer (Task Groups 1-2) — Day 1-2
**Duration:** 4-6 hours

1. **Task Group 1** (Calculation Engine): Implement metric formulas, run 6 tests
   - Deliverable: Verified metric calculation functions
   - Checkpoint: Test wallet baseline (-$27,558.71) matches P&L parity

2. **Task Group 2** (Metrics Table): Create table, populate wallets, run 5 tests
   - Deliverable: wallet_metrics materialized table with 4 time windows
   - Checkpoint: P&L parity verified at table level

**Gate:** All wallet_metrics tests pass, P&L sums to baseline

---

### Phase 2B: API Layer (Task Group 3) — Day 2-3
**Duration:** 2-3 hours

3. **Task Group 3** (Leaderboard Views): Create ranking views, test metadata JOIN, run 5 tests
   - Deliverable: whale_leaderboard, omega_leaderboard, roi_leaderboard views
   - Checkpoint: Leaderboards queryable <100ms, metadata JOIN graceful

**Gate:** All leaderboard view tests pass, <100ms query time

---

### Phase 2C: Export & Integration (Task Groups 4-5) — Day 3-4
**Duration:** 3-4 hours

4. **Task Group 4** (Export Pipelines): JSON/CSV exports, run 4 tests
   - Deliverable: Export scripts for metrics + leaderboards
   - Checkpoint: Exports valid, complete, <5s per export

5. **Task Group 5** (Integration & Documentation): End-to-end tests, docs, run 2 tests
   - Deliverable: Schema docs, metric definitions, example queries, API guide
   - Checkpoint: Example queries execute, docs complete and accurate

**Gate:** All integration tests pass, documentation reviewed

---

## Test Summary

| Task Group | Test Count | Test Time | Coverage |
|------------|-----------|-----------|----------|
| 1. Metrics Calculation | 6 | ~30 min | Formula validation, edge cases |
| 2. Table Population | 5 | ~30 min | Schema, data integrity, P&L parity |
| 3. Leaderboard Views | 5 | ~20 min | Ranking, JOIN patterns, performance |
| 4. Data Export | 4 | ~20 min | Format validation, encoding, completeness |
| 5. Integration | 2 | ~20 min | End-to-end workflow, documentation |
| **TOTAL** | **22** | **~2 hours** | **All critical paths covered** |

**Test Execution:** Run ONLY the focused tests (23 total) during implementation. Full suite run only at final gate.

---

## Success Criteria

### Phase 2A Success Metrics
- [ ] wallet_metrics table created and populated
- [ ] P&L parity verified: sum(realized_pnl) = -27,558.71 USD
- [ ] All 4 time windows (30d, 90d, 180d, lifetime) populated
- [ ] Metric formulas validated on sample wallets
- [ ] 11 tests (6+5) pass with <2s total runtime

### Phase 2B Success Metrics
- [ ] Three leaderboard views created (whale, omega, roi)
- [ ] Metadata LEFT JOIN implemented (graceful UNKNOWN fallback)
- [ ] Each leaderboard returns ≤50 ranked rows
- [ ] Leaderboard queries execute <100ms
- [ ] 5 tests pass

### Phase 2C Success Metrics
- [ ] JSON exports: wallet_metrics, leaderboards
- [ ] CSV exports: wallet_metrics flat format
- [ ] Exports complete <5s per file
- [ ] Exports valid JSON/CSV, UTF-8 encoded
- [ ] Schema documentation complete (table, metrics, formulas)
- [ ] Example queries provided and verified
- [ ] API integration guide written
- [ ] 6 tests pass (4+2)

### Overall Success Criteria
- [ ] All 22 focused tests pass
- [ ] Total test time <2 hours
- [ ] P&L parity gate passed
- [ ] Leaderboards queryable and exportable
- [ ] Documentation complete and accurate
- [ ] Ready for API/UI integration (Phase 3)

---

## Dependencies & Blockers

### Hard Blockers (Must Complete Before Starting)
- Phase 1 data locked: trades_with_direction validated
- P&L baseline established: -$27,558.71 (0xcce2...58b wallet)
- market_resolutions_final available for unrealized payout calculation
- ClickHouse connection functional

### Soft Blockers (Can Parallel with Phase 2)
- market_metadata_wallet_enriched staging table (optional for MVP)
- Frontend leaderboard component (can use mock data while backend develops)
- Real-time metrics refresh schedule (can batch daily post-launch)

---

## Deliverables Checklist

### Phase 2A Deliverables
- [x] Task Group 1: Metric calculation functions (6 passing tests)
- [x] Task Group 2: wallet_metrics materialized table (5 passing tests)
  - Files: `migrations/clickhouse/005_create_wallet_metrics_phase2.sql`
  - Files: `scripts/compute-wallet-metrics-phase2.ts` (population script)

### Phase 2B Deliverables
- [x] Task Group 3: Leaderboard ranking views (5 passing tests)
  - Files: `migrations/clickhouse/views/v_leaderboard_whale.sql`
  - Files: `migrations/clickhouse/views/v_leaderboard_omega.sql`
  - Files: `migrations/clickhouse/views/v_leaderboard_roi.sql`

### Phase 2C Deliverables
- [x] Task Group 4: Export pipelines (4 passing tests)
  - Files: `scripts/export-wallet-metrics-json.ts`
  - Files: `scripts/export-wallet-metrics-csv.ts`
  - Files: `scripts/export-leaderboards-json.ts`

- [x] Task Group 5: Integration & documentation (2 passing tests)
  - Files: `docs/leaderboard-schema.md`
  - Files: `docs/leaderboard-metrics.md`
  - Files: `docs/leaderboard-queries.md`
  - Files: `docs/leaderboard-api-integration.md`

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Metrics calculation time | <30 min (1000+ wallets) | Parallel 3-window jobs |
| Leaderboard query time | <100ms | Indexed on (wallet, window) |
| Export time per file | <5s | Streaming writes |
| P&L calculation error | 0% (exact match to -27,558.71) | Baseline parity gate |
| Test execution time | <2 hours total | 22 focused tests only |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| P&L calculation mismatch | Medium | High | Test baseline wallet first (1.6), verify parity at table level (2.4) |
| Leaderboard JOIN drops rows | Low | High | Test LEFT JOIN integrity (3.5), verify row counts |
| Export format invalid | Low | Medium | Validate format (4.5), provide reference examples |
| Query performance regression | Low | Medium | Add indexes, benchmark per leaderboard (3.6) |
| Missing metadata for all wallets | High | Low | Implement graceful fallback (3.5), expect UNKNOWN |

---

## Notes & Conventions

### ID Normalization (IDN)
- condition_id: lowercase, strip 0x, expect 64 chars, store as String
- wallet_address: checksum format, consistent casing
- Always join on normalized condition_id

### Array Indexing (CAR)
- ClickHouse arrays are 1-indexed
- Use `arrayElement(payout_vector, winning_index + 1)`

### Atomic Rebuilds (AR)
- Pattern: `CREATE TABLE ... AS SELECT`, then `RENAME`
- Never use `ALTER ... UPDATE` on large ranges
- Used in 2.3 for wallet_metrics population

### Metrics Formulas (PNL)
- Realized P&L: sum of cashflows (buys = negative, sells = positive)
- Unrealized payout: shares × payout_vector[winner_index + 1] / denominator
- ROI: (pnl_total / cost_basis) × 100
- Omega: sum(gains) / sum(losses)

---

## References

- **Phase 1 Spec:** `/phase1/spec.md`
- **P&L Baseline:** 0xcce2...58b = -$27,558.71 (locked)
- **Database Schema:** `migrations/clickhouse/004_create_wallet_metrics_complete.sql`
- **Standards:** `/docs/archive/agent-os-visible-oct-2025/standards/`

---

## Next Steps (Phase 3)

After Phase 2 completion:
1. **Real-time Metrics Refresh** (30-minute incremental updates)
2. **Advanced Metrics** (Brier score, CLV, edge durability)
3. **Per-Category Leaderboards** (by market category)
4. **Watchlist Signals** (stream new trades → metric recalculation → push notifications)

---

**Status:** READY FOR IMPLEMENTATION

Last Updated: 2025-11-10
Prepared for: Database Engineer + Backend Engineer + API Engineer
