# P&L Coverage Recovery - Quick Start Guide

**Goal:** Recover P&L calculation capability for 77.4M trades (48.53%) missing `condition_id`

---

## TL;DR - THE ANSWER

**Recommended Approach:** HYBRID (Dune + CLOB API + Blockchain validation)

- **Timeline:** 11-18 hours total
- **Cost:** $0-500 (Dune export, one-time)
- **Coverage:** 95%+ trades, 30-50% resolutions
- **Risk:** LOW (multiple sources validate each other)

---

## Quick Decision Tree

```
Start Here
│
├─ Do you want the FASTEST path? (3-5 hours)
│  └─ Use Dune Analytics ($500 export) → 95% coverage
│
├─ Do you want FREE + HIGH COVERAGE? (11-18 hours)
│  └─ Use HYBRID (Dune + CLOB + Blockchain) → 95%+ coverage, $0-500
│
├─ Do you want ZERO EXTERNAL DEPENDENCIES? (12-18 hours)
│  └─ Use Blockchain Only → 70-85% coverage (risky, complex)
│
└─ Not sure?
   └─ Run validation script first → npx tsx scripts/validate-recovery-options.ts
```

---

## Step 1: Run Validation (15-30 minutes)

```bash
npx tsx scripts/validate-recovery-options.ts
```

This will test:
1. CLOB API historical depth (does it have data back to Dec 2022?)
2. Dune Analytics availability (can we export Polymarket data?)
3. ERC1155 blockchain availability (can we fetch missing token transfers?)

**Output:** Go/no-go decision for each approach

---

## Step 2: Choose Your Path

### OPTION A: HYBRID (RECOMMENDED) ✅

**When to Use:** You want best ROI (fast + reliable + sustainable)

**What You Get:**
- 95%+ trade recovery (recover ~73M missing trades)
- 30-50% resolution coverage (unlock 15K-20K wallets for metrics)
- Established ongoing sync pipeline

**Timeline:**
- Phase 1: Dune backfill (3-5 hours)
- Phase 2: CLOB API sync (2-4 hours)
- Phase 3: Blockchain validation (2-3 hours)
- Phase 4: Resolution expansion (6-8 hours)
- **Total: 13-22 hours**

**Cost:** $0-500 (Dune export if using paid tier, or $0 if chunking on free tier)

**Steps:**
1. Create Dune account (free): https://dune.com
2. Export Polymarket trades (see Dune query in strategy doc)
3. Paginate CLOB API for recent fills
4. Cross-validate with blockchain data
5. Fetch all Polymarket resolutions
6. Apply to trades_raw and compute P&L

**Documentation:** See `/Users/scotty/Projects/Cascadian-app/PNL_COVERAGE_STRATEGIC_DECISION.md` (Section: HYBRID APPROACH)

---

### OPTION B: CLOB API ONLY (IF VALIDATED) ⚠️

**When to Use:** Validation shows CLOB API has full historical depth (Dec 2022+)

**What You Get:**
- 60-80% trade recovery (depends on API historical depth)
- Official Polymarket data (highest quality)
- Free (no external costs)

**Timeline:** 6-10 hours

**Cost:** Free

**Risk:** Medium (CLOB API may not have full historical data)

**Steps:**
1. Paginate CLOB API backwards from present to Dec 2022
2. Store all fills with condition_id + market metadata
3. Match to existing trades_raw by transaction_hash
4. Update condition_id for matched trades

**Documentation:** See strategy doc (Section: OPTION B1)

---

### OPTION C: BLOCKCHAIN ONLY (BACKUP) ❌

**When to Use:** ONLY if all APIs fail validation

**What You Get:**
- 70-85% trade recovery
- Fully deterministic (on-chain source of truth)
- No external dependencies

**Timeline:** 12-18 hours

**Cost:** Free (besides RPC costs)

**Risk:** HIGH (complex, uncertain ERC1155 availability)

**Steps:**
1. Decode 387.7M USDC transfers from raw logs
2. Fetch missing ERC1155 transfers from Polygon archive
3. Extract condition_id from token_id (token_id >> 8)
4. Join USDC + ERC1155 by tx_hash
5. Validate against existing trades_raw

**Documentation:** See strategy doc (Section: OPTION A)

---

## Step 3: Execute (See Implementation Roadmap)

Full implementation details in:
- **Main Strategy Doc:** `PNL_COVERAGE_STRATEGIC_DECISION.md`
- **Section:** "IMPLEMENTATION ROADMAP"

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `PNL_COVERAGE_STRATEGIC_DECISION.md` | Full strategic analysis (all options, risks, recommendations) |
| `PNL_COVERAGE_QUICK_START.md` | This file (quick decision guide) |
| `scripts/validate-recovery-options.ts` | Validation script (test all approaches) |
| `DEBRIEFING_PNL_BUG_AND_RESOLUTION_COVERAGE.md` | Context on resolution coverage crisis |
| `CLOB_BACKFILL_RECOMMENDATIONS.md` | CLOB API analysis |
| `DUNE_BACKFILL_EXECUTIVE_SUMMARY.md` | Dune Analytics analysis |

---

## The Real Problem: Resolution Coverage

**Critical Insight:** Even if we recover all 77.4M missing trades, we still have only **5% resolution coverage**.

**What This Means:**
- Total conditions: ~61,517
- Conditions with resolutions: ~2,858 (4.6%)
- Wallets with ≥1 resolved trade: ~2,959 (11% of 28K wallets)
- **Result:** 89% of wallets can't calculate P&L (no resolved positions)

**Solution Required:**
- Fetch ALL historical resolutions from Polymarket API
- Target: 30-50% resolution coverage (18K-30K conditions)
- Timeline: 6-8 hours (can run in parallel with trade recovery)

**Impact:**
- Before: 2,959 wallets with metrics, 51 on leaderboard
- After: 15K-20K wallets with metrics, 3K-6K on leaderboard

---

## Success Criteria

### Minimum Viable (Week 1)
- [ ] 80%+ trade coverage (127M of 159M trades have condition_id)
- [ ] <5% data quality issues
- [ ] All recovered trades validated against blockchain

### Target (Week 2)
- [ ] 95%+ trade coverage (151M of 159M trades)
- [ ] 30-50% resolution coverage (18K-30K conditions)
- [ ] 15K-20K wallets with metrics

### Optimal (Week 3)
- [ ] 98%+ trade coverage
- [ ] 50%+ resolution coverage
- [ ] Ongoing sync pipeline established

---

## Estimated Timelines by Approach

| Approach | Setup | Coverage | Risk | Recommended |
|----------|-------|----------|------|-------------|
| **Hybrid** | 13-22 hrs | 95%+ | Low | ✅ YES |
| **CLOB Only** | 6-10 hrs | 60-80% | Medium | ⚠️ MAYBE |
| **Blockchain Only** | 12-18 hrs | 70-85% | High | ❌ BACKUP |
| **Dune Only** | 3-5 hrs | 95-99% | Low | ✅ QUICK WIN |

---

## Next Actions

1. **Read full strategy doc** (15 minutes)
   - File: `PNL_COVERAGE_STRATEGIC_DECISION.md`
   - Sections: All (comprehensive analysis)

2. **Run validation script** (15-30 minutes)
   ```bash
   npx tsx scripts/validate-recovery-options.ts
   ```

3. **Make decision** (5 minutes)
   - Based on validation results
   - Review decision matrix in strategy doc

4. **Execute chosen approach** (11-22 hours depending on choice)
   - Follow implementation roadmap in strategy doc
   - Track progress every 2 hours
   - Validate coverage improvements

5. **Expand resolutions** (6-8 hours in parallel)
   - Fetch Polymarket API resolutions
   - Apply to trades_raw
   - Compute realized P&L

**Total Time to 95% Coverage:** 13-22 hours (Hybrid approach)

---

## Critical Skills to Apply

From CLAUDE.md Stable Pack:

- **IDN** (ID Normalize): Always normalize condition_id (lowercase, strip 0x, expect 64 chars)
- **NDR** (Net Direction): Compute BUY/SELL from usdc_net and token_net flows
- **PNL** (PnL from Vector): `pnl_usd = shares * (payout_numerators[winning_index] / denominator) - cost_basis`
- **AR** (Atomic Rebuild): Use CREATE TABLE AS SELECT, then RENAME (no ALTER UPDATE)
- **CAR** (ClickHouse Array Rule): Arrays are 1-indexed, use `arrayElement(arr, index + 1)`
- **JD** (Join Discipline): Join only on normalized IDs, assert rowcount changes
- **GATE** (Quality Gates): Global cash neutrality <2%, per-market <5% worst case

---

## Questions?

- Full analysis: `PNL_COVERAGE_STRATEGIC_DECISION.md`
- Quick reference: This file
- Validation: `npx tsx scripts/validate-recovery-options.ts`
- Context: `DEBRIEFING_PNL_BUG_AND_RESOLUTION_COVERAGE.md`

---

**Generated:** 2025-11-07
**Status:** READY FOR EXECUTION
**Recommended:** HYBRID APPROACH (Dune + CLOB + Blockchain)
