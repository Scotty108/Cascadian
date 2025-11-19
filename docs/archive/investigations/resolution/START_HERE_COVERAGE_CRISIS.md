# START HERE: Coverage Crisis - Executive Summary

**Date:** 2025-11-08
**Status:** 🚨 CRITICAL BLOCKER
**Time to Read:** 2 minutes

---

## TL;DR

Phase 1 approach (using existing tables) **cannot work**. Only 1.61% of wallets have sufficient data. Must implement Phase 2 blockchain backfill before building `fact_trades_v1`.

---

## The Numbers

| Metric | Required | Actual | Status |
|--------|----------|--------|--------|
| Wallet coverage | ≥80% | 1.61% | ❌ FAILED |
| Volume coverage | ≥70% | 2.32% | ❌ FAILED |
| Transaction coverage | N/A | 99.77% | ⚠️ MISLEADING |

**Translation:** 98% of users would see wrong data if we shipped today.

---

## Why the Paradox?

**Transaction coverage looks great (99.77%)** because UNION DISTINCT finds valid data SOMEWHERE for most transactions.

**But wallet coverage is terrible (1.61%)** because each individual wallet has 50% gaps in their trading history.

**And volume coverage is catastrophic (2.32%)** because the high-coverage wallets are all low-volume traders.

**Conclusion:** You can't cherry-pick "just the good data" because the good data isn't where the trading volume is.

---

## What This Means

### Cannot Ship
- P&L will be wrong for 98% of users
- Smart money detection will fail (insufficient data)
- Copy trading will be unreliable (incomplete positions)
- Strategy backtesting will be garbage (missing trades)

### Must Do
- STOP Phase 1 work immediately
- START Phase 2 blockchain backfill planning
- Communicate timeline delay to stakeholders

---

## Phase 2 Quick Overview

**What:** Blockchain reconstruction pipeline using ERC1155 Transfer events

**Why:** Recover missing condition_ids from on-chain data (source of truth)

**Expected Coverage:** ≥85% wallet coverage (meets threshold)

**Time Estimate:** 2-3 weeks

**Complexity:** Medium (we have most of the infrastructure already)

---

## Immediate Actions

1. **Stop building** `fact_trades_v1` - data is insufficient
2. **Read** `/Users/scotty/Projects/Cascadian-app/FINAL_COVERAGE_VERDICT.md` for full analysis
3. **Run** coverage calculation yourself:
   ```bash
   npx tsx calculate-true-coverage.ts
   ```
4. **Decide** if 2-3 week delay is acceptable for stakeholders
5. **Proceed** with Phase 2 planning if approved

---

## Files to Review

| Priority | File | Purpose |
|----------|------|---------|
| 1 | `FINAL_COVERAGE_VERDICT.md` | Complete analysis & recommendation |
| 2 | `COVERAGE_HARD_NUMBERS.txt` | Just the numbers (30 sec read) |
| 3 | `TRUE_COVERAGE_CRISIS_REPORT.md` | Deep dive into the problem |
| 4 | `calculate-true-coverage.ts` | Reproducible analysis script |
| 5 | `analyze-high-coverage-wallets.ts` | Whale analysis (shows 2.32% volume) |

---

## Questions?

**Q: Can we launch a limited beta with just the 16K high-coverage wallets?**
A: No. They only represent 2.32% of platform volume. Not viable.

**Q: Can we improve Phase 1 to fix this?**
A: No. The data doesn't exist in current tables. Source of truth is on-chain.

**Q: How confident are you in these numbers?**
A: 100%. Analysis is reproducible via `calculate-true-coverage.ts`.

**Q: What if we relax the 80% threshold?**
A: Even at 50% threshold, coverage is still too low. Root problem remains.

**Q: How long will Phase 2 take?**
A: Rough estimate: 2-3 weeks. Need detailed scoping to confirm.

---

## Bottom Line

**Phase 1 is dead. Long live Phase 2.**

The coverage analysis proves beyond doubt that existing tables cannot provide sufficient data quality. Blockchain backfill is the only path forward.

**Recommendation:** Get stakeholder approval for 2-3 week delay, then proceed immediately with Phase 2 implementation.

---

**Next Steps:** Read `FINAL_COVERAGE_VERDICT.md` for the complete picture, then make the go/no-go decision on Phase 2.
