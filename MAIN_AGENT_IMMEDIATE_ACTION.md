# Main Agent - Immediate Action Required

**From:** Secondary Research Agent
**Date:** 2025-11-07
**Status:** 🔴 BLOCKER - Requires Your Input
**Estimated Time:** 15 min (for Test 1 execution)

---

## The Situation in 30 Seconds

1. **Phase 1: ✅ COMPLETE**
   - niggemon: -2.3% variance (PASS)
   - HolyMoses7: Gap explained by file date (PASS)
   - Formula proven: `Total P&L = Realized + Unrealized`

2. **Phase 2: 🔴 BLOCKED**
   - 5 test wallets returned $0.00
   - User confirmed: "zero is not correct for those wallets"
   - Root cause: UNKNOWN (could be query bug or data issue)
   - **Decision needed:** Run Test 1 to diagnose

3. **Production Status:** 🔴 CANNOT DEPLOY
   - Until we know if $0.00 is a query bug (affects all) or data issue (affects some)

---

## What You Need to Do (Right Now)

### Step 1: Execute Test 1 (10 minutes)

**File:** `PHASE_2_TEST1_MANUAL_EXECUTION.md`

**Quick Path - ClickHouse CLI:**

```bash
# 1. Start ClickHouse if not running
docker compose up -d

# 2. Connect to ClickHouse
docker compose exec clickhouse clickhouse-client

# 3. Select database
USE polymarket;

# 4. Copy-paste this query
SELECT
  'trades_enriched_with_condition' as source,
  wallet_address,
  count() as trade_count,
  min(created_at) as first_trade,
  max(created_at) as last_trade
FROM trades_enriched_with_condition
WHERE lower(wallet_address) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet_address
ORDER BY trade_count DESC;
```

### Step 2: Report Results

**Include in your message:**
- Did the query return rows? (YES / NO / PARTIAL)
- If YES: How many wallets found? Trade counts?
- If NO: Proceed to Test 1b (check trades_raw table)

### Step 3: I Analyze and Guide Next Steps

Based on your results, I'll tell you:
- What the root cause is
- Whether to run Test 2-5 (if query bug) OR backfill (if data issue)
- Exact next diagnostic steps

---

## Expected Outcomes and What They Mean

### 🟢 If Rows Returned (Wallets Found)

```
Example result:
wallet_address                          | trade_count
0x7f3c8979d0afa00007bae4747d5347122af | 145
0x1489046ca0f9980fc2d9a950d103d3bec0  | 78
(etc)
```

**Interpretation:**
- ✅ Wallets exist in database
- ✅ Have trading data
- ❌ But query returned $0.00 = QUERY BUG (not data bug)
- 🔴 This affects ALL production wallets if not fixed

**Next Action:**
- Run Test 2 (check resolved positions)
- Find which part of the formula fails
- Fix query logic
- Re-validate all 5 wallets
- Test on 2-3 more diverse wallets
- Then: Safe to deploy

**Timeline:** 20-30 min to fix

---

### 🔴 If NO Rows (Wallets Not Found)

**Interpretation:**
- ❌ Wallets not in database
- ✅ Data is intact (not a query bug affecting all)
- ⚠️ These 5 wallets need special handling

**Next Action (Choose A or B):**

**A) Verify Addresses**
- Check if these wallet addresses are correct
- Ask user if these are the right wallets to test
- If correct but missing: Proceed to B

**B) Backfill Specific Wallets**
- Run backfill script for these 5 wallets
- Confirm data loads
- Re-run Test 1
- Then: Run Tests 2-5 to validate

**Timeline:** 30-60 min depending on backfill speed

---

## All Supporting Documents

| Document | Purpose | Use For |
|----------|---------|---------|
| `PHASE_2_TEST1_MANUAL_EXECUTION.md` | Step-by-step Test 1 guide | Running the diagnosis |
| `PHASE_2_DEBUG_CRITICAL.md` | Complete 5-test sequence | After Test 1, if needed |
| `SECONDARY_AGENT_STATUS_SESSION3.md` | Full status report | Understanding context |
| `scripts/phase2-test1-wallet-existence.ts` | Automated script | When ClickHouse online |
| `MAIN_AGENT_GUIDANCE_SESSION_2.md` | Prior breakthrough strategy | Reference material |
| `HOLYMOSES_BREAKTHROUGH_STRATEGY.md` | HolyMoses7 resolution | Reference material |

---

## Why This Matters

**Three scenarios, three different outcomes:**

| Scenario | Probability | Impact | Fix Time |
|----------|------------|--------|----------|
| Query bug (wallets exist) | 40-50% | Affects ALL production | 15-20 min |
| Data gap (wallets missing) | 30-40% | Affects only these wallets | 20-30 min |
| Address mismatch (typo) | 10-20% | Affects only Phase 2 testing | 5 min |

**No matter what,** Test 1 takes you from 0% knowledge to 100% clarity in 10 minutes.

---

## Critical Rules

```
🔴 DO NOT:
   - Deploy without resolving this blocker
   - Change query logic without Test 1 results
   - Assume the $0.00 is correct
   - Skip Test 1 and jump to speculation

✅ DO:
   - Execute Test 1 immediately
   - Report results clearly
   - Wait for my analysis
   - Follow the diagnostic sequence in order
```

---

## After Test 1: Your Path Forward

```
You execute Test 1
        ↓
You report results
        ↓
I analyze and provide:
   - Root cause identification
   - Exact next steps
   - SQL for Tests 2-5 (if needed)
   - Timeline to completion
        ↓
You execute next diagnostic step
        ↓
(Repeat until resolved)
        ↓
Phase 2 validation complete
        ↓
Production deployment ready ✅
```

---

## Summary

**What:** Execute Test 1 (Wallet Existence Check)
**When:** Right now (before any other work)
**How:** Copy-paste SQL from manual execution guide
**Time:** 10-15 minutes
**Why:** Determines if this is a query bug (critical) or data issue (manageable)
**After:** Report results back, I'll guide next steps

---

## The Test 1 SQL (Copy-Paste Ready)

```sql
-- PHASE 2 TEST 1: WALLET EXISTENCE CHECK
-- Checks if 5 test wallets exist in trades_enriched_with_condition

SELECT
  'trades_enriched_with_condition' as source,
  wallet_address,
  count() as trade_count,
  min(created_at) as first_trade,
  max(created_at) as last_trade
FROM trades_enriched_with_condition
WHERE lower(wallet_address) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet_address
ORDER BY trade_count DESC;
```

**Run this in:** ClickHouse CLI or Web UI (`http://localhost:8123/play`)

---

## When Ready to Report Back

Say something like:

> **Test 1 Results:**
> - Wallets found: YES / NO / PARTIAL
> - [Paste 2-3 sample rows if YES]
> - [Include trade counts]

Then I'll immediately provide:
1. Root cause analysis
2. Exact next steps
3. Any fixes needed
4. Timeline to completion

---

**Ready to go?** Start with `docker compose up -d` to ensure ClickHouse is running, then execute the Test 1 SQL above.

I'm here to analyze your results and guide the next diagnostic step.
