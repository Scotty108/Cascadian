# Phase 2: START HERE

## What You Have

Phase 2 leaderboard materialization is **fully planned and ready to implement**. You have:

1. **526 lines** of detailed tasks (22 tasks, 5 groups, all dependencies mapped)
2. **422 lines** of implementation guide (role-based, test patterns, gotchas)
3. **427 lines** of project overview (deliverables, timeline, success criteria)
4. **1,758 lines total** of documentation (everything below)

---

## Read This Based on Your Role

### I'm a Developer (Start Here)
1. **IMPLEMENTATION_GUIDE.md** (8 min) — Your role, test pattern, gotchas
2. **tasks.md** → Your task group (5 min) — Detailed sub-tasks
3. Start writing tests (sub-task X.1)

### I'm a Project Manager (Start Here)
1. **README.md** (10 min) — Timeline, status, checkpoints
2. **tasks.md** (20 min) → "Execution Strategy" section — Day-by-day plan
3. Use task list to track progress

### I'm Reviewing Code (Start Here)
1. **tasks.md** (30 min) — All acceptance criteria
2. Code files (migrations, scripts, docs)
3. Tests — Verify 22 tests passing

### I'm Architecting (Start Here)
1. **spec.md** (15 min) — Business requirements
2. **tasks.md** → "Data Flow" section — Architecture decisions
3. Review metric formulas and JOIN patterns

---

## 60-Second Overview

**Goal:** Build leaderboards from locked P&L baseline (-$27,558.71)

**What you build:**
- wallet_metrics table (per-wallet metrics, 4 time windows)
- 3 leaderboard views (whale, omega, ROI)
- JSON/CSV exports
- Documentation

**Timeline:** 9-13 hours over 3-4 days

**Team:** 3 specialists (can work in parallel)

**Key constraint:** P&L must sum to baseline (validation gate)

---

## Files You'll Create

```
Phase 2 Outputs (after implementation):
├─ migrations/clickhouse/005_create_wallet_metrics_phase2.sql
├─ migrations/clickhouse/views/
│  ├─ v_leaderboard_whale.sql
│  ├─ v_leaderboard_omega.sql
│  └─ v_leaderboard_roi.sql
├─ lib/clickhouse/metrics-calculator.ts
├─ scripts/
│  ├─ compute-wallet-metrics-phase2.ts
│  ├─ export-wallet-metrics-json.ts
│  ├─ export-wallet-metrics-csv.ts
│  └─ export-leaderboards-json.ts
├─ docs/
│  ├─ leaderboard-schema.md
│  ├─ leaderboard-metrics.md
│  ├─ leaderboard-queries.md
│  └─ leaderboard-api-integration.md
└─ tests/phase2/
   ├─ task-group-1.test.ts (6 tests)
   ├─ task-group-2.test.ts (5 tests)
   ├─ task-group-3.test.ts (5 tests)
   ├─ task-group-4.test.ts (4 tests)
   └─ task-group-5.test.ts (2 tests)
```

---

## Task Group Summary

| Group | Name | Tests | Time | Owner |
|-------|------|-------|------|-------|
| 1 | Wallet Metrics Calculation | 6 | 1.5-2h | DB Engineer |
| 2 | Table Materialization | 5 | 2.5-3h | DB Engineer |
| 3 | Leaderboard Views | 5 | 1-1.5h | Backend Engineer |
| 4 | Data Exports | 4 | 1.5-2h | Backend Engineer |
| 5 | Integration & Docs | 2 | 2-3h | Doc Engineer |
| **TOTAL** | | **22** | **9-13h** | **3 team members** |

---

## Quick Links (By File)

| Need | File | Lines | Read Time |
|------|------|-------|-----------|
| Full task list | tasks.md | 526 | 30-50 min |
| Implementation guide | IMPLEMENTATION_GUIDE.md | 422 | 8 min |
| Project overview | README.md | 427 | 10 min |
| Business spec | spec.md | 383 | 15 min |
| This file | START_HERE.md | — | 5 min |

---

## The Test-First Pattern

**For each task group:**

1. Write tests first (sub-task X.1) — 2-8 focused tests
2. Implement code (sub-tasks X.2-X.5) — just enough to pass tests
3. Verify tests pass (sub-task X.6) — run ONLY those tests
4. Move to next group

**Why?** Proves feature works before moving on. Prevents rework.

---

## The P&L Parity Gate

**At end of Task Group 2, verify:**

```sql
SELECT sum(realized_pnl) as total_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime';

-- Expected: -27558.71
-- If different: Debug in Task Group 1 metric formulas
```

This is a critical validation. Don't skip it.

---

## Timeline (For Scheduling)

```
├─ Day 1: Task Groups 1-2 (Database Engineer) — 4-6 hours
│  └─ End with: P&L parity verified ✓
│
├─ Day 2: Task Groups 3-4 (Backend Engineer) — 3-4 hours
│  └─ Start after: TG2 complete
│  └─ End with: Leaderboards queryable ✓
│
└─ Day 3: Task Group 5 (Doc Engineer) — 2-3 hours
   └─ Start after: TG3 complete
   └─ End with: All docs written ✓

Total: 9-13 hours over 3-4 days (can compress to 2 days if team is full-time)
```

---

## Success Looks Like

**After all 5 task groups:**
- [ ] 22 tests passing (< 2 hours runtime)
- [ ] P&L parity verified: sum = -$27,558.71
- [ ] Leaderboards queryable in <100ms
- [ ] Exports valid and complete
- [ ] Schema/metrics/query documentation complete
- [ ] Ready for Phase 3 (real-time metrics)

---

## Immediate Next Steps

### If you're implementing:
1. Open IMPLEMENTATION_GUIDE.md
2. Find your role section
3. Start Task Group 1 or (if DB layer done) Task Group 3

### If you're planning:
1. Open tasks.md
2. Review "Execution Strategy" section
3. Assign roles and start timeline

### If you're reviewing:
1. Open tasks.md
2. Check "Success Criteria" section
3. Verify against implementation code/tests

---

## FAQ (Quick Answers)

**Q: Where do I start?**
A: IMPLEMENTATION_GUIDE.md (find your role) → tasks.md (read your task group) → Write tests

**Q: What if I get stuck?**
A: Check "Common Gotchas" in IMPLEMENTATION_GUIDE.md or reference metric formula in tasks.md

**Q: Can we parallelize?**
A: Yes. TG1-2 sequential (DB layer). TG3-4 parallel (can start once TG2 done). TG5 optional parallel.

**Q: What if P&L doesn't match?**
A: Debug in Task Group 1. Check formula against manual calculation. Most common: array indexing (+1 for ClickHouse).

**Q: How long will this take?**
A: 9-13 hours total. Depends on team size and prior ClickHouse experience. Can compress to 2-3 days full-time.

---

## Document Map

```
phase2/
├─ START_HERE.md ..................... This file (navigation)
├─ README.md ......................... Overview, timeline, checkpoints
├─ tasks.md .......................... Detailed task breakdown (22 tasks)
├─ IMPLEMENTATION_GUIDE.md ........... Quick reference for developers
├─ spec.md ........................... Original business requirement
│
└─ (Will be created during implementation)
   ├─ migrations/clickhouse/
   ├─ lib/clickhouse/
   ├─ scripts/
   ├─ docs/
   └─ tests/phase2/
```

---

## Key Definitions

| Term | Meaning |
|------|---------|
| **Realized P&L** | Sum of all trades (buys/sells) + redemptions |
| **Unrealized P&L** | Potential payout of open positions |
| **ROI%** | (Total P&L / Cost Basis) × 100 |
| **Omega Ratio** | Gain/loss ratio (higher = better) |
| **Sharpe Ratio** | Return / volatility (annualized) |
| **Leaderboard** | Top 50 wallets ranked by metric |
| **Materialized** | Pre-computed table (not a view) |
| **P&L Parity Gate** | Validation: sum of all wallets = baseline |

---

## Still Have Questions?

1. **"How do I implement [X]?"** → See IMPLEMENTATION_GUIDE.md → Troubleshooting
2. **"What are the exact sub-tasks for my group?"** → See tasks.md → Your Task Group
3. **"What's the business requirement?"** → See spec.md
4. **"What's the timeline again?"** → See README.md → Timeline section

---

**Next Steps:** Choose your path above and open the corresponding file.

**Questions?** Check the FAQ or reference the appropriate document.

**Ready?** Open IMPLEMENTATION_GUIDE.md → Find your role → Let's build.

---

**Status:** READY FOR IMPLEMENTATION
**Last Updated:** 2025-11-10
**For:** Phase 2 Implementation Team
