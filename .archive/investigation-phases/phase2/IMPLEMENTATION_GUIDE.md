# Phase 2 Implementation Guide: Quick Reference

## For Task Runners

### Quick Start (< 5 min to begin)

1. **Read this entire file first** (8 min)
2. **Open** `/phase2/tasks.md` in your editor (reference throughout)
3. **Pick your role** (see below) and jump to your section
4. **Clone the task template** for your group and start with tests

---

## Role-Based Task Assignment

### Database Engineer (Task Groups 1-2)
**Timeline:** 4-6 hours | **Start:** Day 1

**Your Jobs:**
1. **Task Group 1 (1.5-2 hours):** Implement metric calculation functions
   - Focus: Formulas for P&L, ROI, Sharpe, Omega
   - Output: 6 passing tests + calculation module
   - Success: Baseline wallet test passes (-$27,558.71)

2. **Task Group 2 (2.5-3 hours):** Materialize wallet_metrics table
   - Focus: ReplacingMergeTree creation, population script
   - Output: 5 passing tests + populated table
   - Success: P&L parity verified at table level

**Key Files to Create/Modify:**
- `migrations/clickhouse/005_create_wallet_metrics_phase2.sql` (schema)
- `scripts/compute-wallet-metrics-phase2.ts` (population)
- `lib/clickhouse/metrics-calculator.ts` (calculation functions)

**Testing Pattern:**
```bash
# Run tests as you complete each sub-task
npm run test -- tests/phase2/task-group-1.test.ts
npm run test -- tests/phase2/task-group-2.test.ts
```

**Success Gate:** All 11 tests (6+5) pass, P&L parity verified

---

### Backend Engineer (Task Groups 3-4)
**Timeline:** 3-4 hours | **Start:** Day 2-3 (after Database Engineer completes Task Group 2)

**Your Jobs:**
1. **Task Group 3 (1-1.5 hours):** Create leaderboard ranking views
   - Focus: SQL views for whale, omega, ROI rankings
   - Output: 5 passing tests + 3 views ready for API
   - Success: Leaderboards return <100ms, <50 rows each

2. **Task Group 4 (1.5-2 hours):** Build export pipelines
   - Focus: JSON/CSV export scripts
   - Output: 4 passing tests + export scripts
   - Success: Exports complete <5s per file

**Key Files to Create:**
- `migrations/clickhouse/views/v_leaderboard_whale.sql`
- `migrations/clickhouse/views/v_leaderboard_omega.sql`
- `migrations/clickhouse/views/v_leaderboard_roi.sql`
- `scripts/export-wallet-metrics-json.ts`
- `scripts/export-wallet-metrics-csv.ts`
- `scripts/export-leaderboards-json.ts`

**Testing Pattern:**
```bash
npm run test -- tests/phase2/task-group-3.test.ts
npm run test -- tests/phase2/task-group-4.test.ts
```

**Success Gate:** All 9 tests (5+4) pass, exports valid and complete

---

### Documentation & API Engineer (Task Group 5)
**Timeline:** 2-3 hours | **Start:** Day 3-4 (parallel with Backend, depends on TG 3-4 complete)

**Your Jobs:**
1. **Task Group 5 (2-3 hours):** Integration, documentation, API contract
   - Focus: Schema docs, metric definitions, example queries, API guide
   - Output: 2 passing integration tests + 4 documentation files
   - Success: Documentation complete, examples executable

**Key Files to Create:**
- `docs/leaderboard-schema.md` (table structure + indexing)
- `docs/leaderboard-metrics.md` (metric definitions + formulas)
- `docs/leaderboard-queries.md` (example SQL queries)
- `docs/leaderboard-api-integration.md` (API contract + usage)

**Testing Pattern:**
```bash
npm run test -- tests/phase2/task-group-5.test.ts
```

**Success Gate:** 2 integration tests pass, all docs reviewed and accurate

---

## Timeline at a Glance

```
Day 1 (4-6 hours)
├─ Database Engineer: Task Groups 1-2
│  ├─ TG1 (1.5-2h): Metric calculations (6 tests)
│  └─ TG2 (2.5-3h): wallet_metrics table (5 tests)
│  └─ GATE: P&L parity verified ✓

Day 2-3 (3-4 hours, can start Day 2)
├─ Backend Engineer: Task Groups 3-4
│  ├─ TG3 (1-1.5h): Leaderboard views (5 tests)
│  ├─ TG4 (1.5-2h): Export pipelines (4 tests)
│  └─ GATE: Leaderboards <100ms, exports valid ✓

Day 3-4 (2-3 hours, parallel with TG 3-4)
└─ Doc Engineer: Task Group 5
   ├─ TG5 (2-3h): Integration + docs (2 tests)
   └─ GATE: Docs complete, examples verified ✓

Total: 9-13 hours over 3-4 days (3 person-weeks)
Test coverage: 22 focused tests, ~2 hours runtime
```

---

## Test-First Pattern (Required)

**Never skip this.** For each task group:

1. **Write tests FIRST** (sub-task X.1)
   - Total per group: 2-8 tests (aim for middle range)
   - Focus: Only critical behaviors, not edge cases
   - Format: Test name should clearly state what's being validated

2. **Implement to make tests pass** (sub-tasks X.2 through X.5)
   - Don't over-engineer
   - Write just enough code to pass the tests
   - Refactor once green

3. **Run ONLY those tests** (sub-task X.6)
   - Use `npm run test -- tests/phase2/task-group-X.test.ts`
   - Don't run entire test suite yet
   - Verify all pass before moving to next group

4. **Move to next group** (when current group has X.6 passing)
   - Each group is independent until Task Group 5 (integration)
   - Parallel execution: DB engineer finishes → Backend engineer starts

---

## Data Parity Gate (Critical)

**Test at end of Task Group 2:**

```sql
-- Verify P&L parity in wallet_metrics
SELECT sum(realized_pnl) as total_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime' AND block_time >= '2022-06-01';

-- Expected: -27558.71 (baseline)
-- If mismatch: Debug in Task Group 1 metric calculation
```

**If test fails:**
1. Re-run baseline wallet test (1.6) to isolate which metric is wrong
2. Check formula in Task Group 1 (1.2-1.5)
3. Verify trades_with_direction data hasn't changed
4. Rerun population script with corrected formula

---

## Common Gotchas

### 1. Array Indexing (CAR)
ClickHouse arrays are **1-indexed**, not 0-indexed.
```sql
-- WRONG: SELECT arrayElement(payout_vector, winning_index)
-- CORRECT:
SELECT arrayElement(payout_vector, winning_index + 1) as payout
```
See: CLAUDE.md → "ClickHouse Array Rule"

### 2. Atomic Rebuilds (AR)
Never use `ALTER ... UPDATE` for large ranges. Use CREATE/RENAME pattern.
```sql
-- WRONG: ALTER TABLE wallet_metrics UPDATE realized_pnl = ... WHERE ...
-- CORRECT:
CREATE TABLE wallet_metrics_new AS SELECT ... FROM wallet_metrics;
RENAME TABLE wallet_metrics TO wallet_metrics_old, wallet_metrics_new TO wallet_metrics;
```
See: CLAUDE.md → "Atomic Rebuild"

### 3. ID Normalization (IDN)
All IDs must be normalized for joins.
```sql
-- Normalize: lowercase, strip 0x, pad/trim to 64 chars
SELECT lower(replaceAll(condition_id, '0x', '')) as condition_id_normalized
-- Expected length: 64 chars
-- Use for all joins on condition_id
```
See: CLAUDE.md → "ID Normalize"

### 4. NULL Handling
Metric calculations can produce NULLs (division by zero, no data). Must be explicit.
```sql
-- Safe division: Handle zero case
SELECT
  CASE WHEN total_losses = 0 THEN NULL ELSE sum_gains / total_losses END as omega_ratio,
  ...
```

### 5. ReplacingMergeTree Versioning
Always include a `_version` or `updated_at` DateTime column for idempotent updates.
```sql
CREATE TABLE wallet_metrics (
  ...
  updated_at DateTime,
  ...
)
ENGINE = ReplacingMergeTree(updated_at)
```

---

## File Organization

```
phase2/
├─ spec.md                          # Original Phase 2 spec
├─ tasks.md                         # THIS FILE → Task breakdown (22 tasks)
├─ IMPLEMENTATION_GUIDE.md          # QUICK REFERENCE (you are here)
│
├─ migrations/clickhouse/
│  ├─ 005_create_wallet_metrics_phase2.sql (TG2)
│  └─ views/
│     ├─ v_leaderboard_whale.sql     (TG3)
│     ├─ v_leaderboard_omega.sql     (TG3)
│     └─ v_leaderboard_roi.sql       (TG3)
│
├─ scripts/
│  ├─ compute-wallet-metrics-phase2.ts          (TG2)
│  ├─ export-wallet-metrics-json.ts             (TG4)
│  ├─ export-wallet-metrics-csv.ts              (TG4)
│  └─ export-leaderboards-json.ts               (TG4)
│
├─ lib/clickhouse/
│  └─ metrics-calculator.ts         (TG1, imported by TG2)
│
├─ docs/
│  ├─ leaderboard-schema.md         (TG5)
│  ├─ leaderboard-metrics.md        (TG5)
│  ├─ leaderboard-queries.md        (TG5)
│  └─ leaderboard-api-integration.md (TG5)
│
└─ tests/phase2/
   ├─ task-group-1.test.ts          (6 tests)
   ├─ task-group-2.test.ts          (5 tests)
   ├─ task-group-3.test.ts          (5 tests)
   ├─ task-group-4.test.ts          (4 tests)
   └─ task-group-5.test.ts          (2 tests)
```

---

## Example: Task Checklist (TG1)

Copy this for your task group and check off as you go:

```markdown
### Task Group 1: Wallet Metrics Calculation Engine ✓

- [x] 1.1 Write 6 focused tests
  - [x] Test 1: Realized P&L calculation
  - [x] Test 2: Unrealized payout calculation
  - [x] Test 3: ROI% formula
  - [x] Test 4: Win rate calculation
  - [x] Test 5: Sharpe ratio
  - [x] Test 6: Omega ratio
  - Command: npm run test -- tests/phase2/task-group-1.test.ts
  - Result: ALL PASS ✓

- [x] 1.2 Implement realized P&L calculation
  - File: lib/clickhouse/metrics-calculator.ts
  - Function: calculateRealizedPnL()
  - Tested by: Test 1 (PASS)

- [x] 1.3 Implement unrealized payout calculation
  - File: lib/clickhouse/metrics-calculator.ts
  - Function: calculateUnrealizedPayout()
  - Tested by: Test 2 (PASS)

- [x] 1.4 Implement ROI percentage calculation
  - File: lib/clickhouse/metrics-calculator.ts
  - Function: calculateROI()
  - Tested by: Test 3 (PASS)

- [x] 1.5 Implement risk metrics (Sharpe, Omega)
  - File: lib/clickhouse/metrics-calculator.ts
  - Functions: calculateSharpe(), calculateOmega()
  - Tested by: Tests 5-6 (PASS)

- [x] 1.6 Verify all metric calculation tests pass
  - Command: npm run test -- tests/phase2/task-group-1.test.ts
  - Result: 6/6 PASS ✓
  - Baseline validation: wallet 0xcce2...58b = -$27,558.71 ✓

GATE: Task Group 1 complete, Database Engineer can proceed to TG2
```

---

## How to Ask for Help

If you get stuck:

1. **Check Task Group PDF** (tasks.md) for context
2. **Check CLAUDE.md** for stable patterns and conventions
3. **Check error message** — if it's a metric formula issue, debug in isolation
4. **Ask for extended thinking** if problem involves:
   - Complex SQL optimization (use `@ultrathink`)
   - Multi-step calculation validation
   - Performance debugging

### Example Help Request
```
"Task Group 2: wallet_metrics population is timing out.
Tests 2.4 (rolling windows) hangs after 5 min.
Wallets: 1500. Window: 30d sliding.
Suspicion: Inefficient date filtering in GROUP BY.

Can you help optimize the SELECT logic?"

→ Use @ultrathink to analyze query plan and suggest index/rewrite
```

---

## Quick Links

| Need | Link | Relevance |
|------|------|-----------|
| Task details | `phase2/tasks.md` | Daily reference |
| Project context | `CLAUDE.md` | Conventions, patterns |
| Metric formulas | `CLAUDE.md` → "Stable Pack" | Copy formulas accurately |
| Database schema | `migrations/clickhouse/004_*` | Reference for table structure |
| Test examples | `tests/phase2/task-group-1.test.ts` | Template for your tests |
| Performance target | `phase2/tasks.md` → "Performance Targets" | Benchmark goals |

---

## Definition of Done (Per Task Group)

### Task Group Complete When:
- [ ] All sub-tasks (X.1 through X.6) marked DONE
- [ ] All focused tests written and passing
- [ ] Code reviewed for:
  - Correct formula implementation
  - No unhandled NULLs
  - Proper indexing and query efficiency
  - Comments explaining non-obvious logic
- [ ] Files created match specification
- [ ] No regressions in Phase 1 data
- [ ] Ready for next task group

### Phase 2 Complete When:
- [ ] All 5 task groups complete (22 tests passing)
- [ ] P&L parity gate passed (sum = -$27,558.71)
- [ ] Leaderboard views queryable <100ms
- [ ] Exports valid and complete
- [ ] Documentation reviewed and accurate
- [ ] No open blockers or regressions

---

## Troubleshooting Checklist

**Tests won't run:**
- [ ] ClickHouse running? (`docker-compose up clickhouse`)
- [ ] Database tables exist? (Run migrations first)
- [ ] Node modules installed? (`npm install`)

**P&L doesn't match baseline:**
- [ ] trades_with_direction data unchanged?
- [ ] Date filter correct? (block_time >= 2022-06-01)
- [ ] Metric formula correct? (spot-check with calculator)
- [ ] Decimal precision? (use Float64 or Decimal(18,2), not Float32)

**Leaderboard returns wrong count:**
- [ ] Window filter applied? (time_window = 'lifetime')
- [ ] ROW_NUMBER() function correct?
- [ ] JOIN drops rows? (check LEFT JOIN vs INNER JOIN)

**Exports fail:**
- [ ] Write permissions on exports/ folder?
- [ ] Disk space available?
- [ ] No special characters in JSON strings? (escape quotes)
- [ ] NULL handling in export? (expected columns present)

---

## Sign-Off

When complete, update status in task group:

```markdown
## Status: COMPLETE ✓

- Completed by: [Your Name]
- Date: [YYYY-MM-DD]
- Tests passed: [22/22]
- P&L parity: [VERIFIED]
- Ready for: Phase 3 (Real-time Metrics)
```

---

**Last Updated:** 2025-11-10
**For:** Phase 2 Implementation Team
**Questions?** Check CLAUDE.md or reference task group directly in tasks.md
