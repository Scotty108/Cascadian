# MAIN CLAUDE - IMMEDIATE ACTION PLAN

**Status:** ERC1155 recovery executing in background
**Timeline:** 3 critical checkpoints in next 4 hours
**Owner:** Main Claude
**Approver:** User

---

## 🎯 YOUR MISSION (NEXT 4 HOURS)

### Checkpoint 1: Monitor Recovery (5-15 min execution)
**What:** ERC1155 recovery joining 159M trades with 206K transfers

**Action:**
- [ ] Let recovery run (already executing in background)
- [ ] Check output every 2-3 minutes
- [ ] Watch for errors

**Success looks like:**
```
✅ Recovery completed successfully
✅ Created trades_raw_updated table
✅ Extracted condition_ids from token_id field
```

**Failure indicators:**
```
❌ ClickHouse timeout or syntax error
❌ Memory exhaustion
❌ JOIN failure
```

---

### Checkpoint 2: Validate Recovery (5-10 min, after Step 1 completes)

**What:** Check if empty condition_ids actually dropped

**Execute these queries:**

```sql
-- Query 1: Check empty count reduction
SELECT COUNT(*) as total_trades,
       SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_count,
       ROUND(empty_count / total_trades * 100, 2) as empty_percentage
FROM trades_raw_updated;

-- EXPECTED: empty_percentage < 0.5% (was 48.53%)
-- If empty_percentage > 10%: Recovery failed, investigate
```

```sql
-- Query 2: Check sample recovered condition_ids
SELECT condition_id, count(*) as cnt
FROM trades_raw_updated
WHERE condition_id != ''
GROUP BY condition_id
LIMIT 10;

-- EXPECTED: All 64-character hex strings, no empty values
-- If mostly empty or NULL: Extraction failed
```

**If validation passes:**
- ✅ Proceed to Checkpoint 3
- Record: Empty IDs before/after for documentation

**If validation fails:**
- ❌ Stop and report error
- Check: ClickHouse error message
- Ask: Third Claude for debugging help

---

### Checkpoint 3: Test Wallets 2-4 P&L (10 min, after validation passes)

**What:** Do wallets 2-4 NOW show P&L matching Polymarket UI?

**After atomic swap (swap trades_raw_updated → trades_raw), execute:**

```sql
-- Recalculate P&L for test wallets
WITH wallet_trades AS (
  SELECT wallet_address, condition_id, outcome_index, shares, entry_price, fee_usd
  FROM trades_raw
  WHERE wallet_address IN (
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
  )
  AND condition_id != ''
),
resolutions AS (
  SELECT condition_id_norm, winning_index, payout_numerators, payout_denominator
  FROM market_resolutions_final
  WHERE is_resolved = 1
)
SELECT
  wallet_address,
  SUM(CASE WHEN outcome_index = r.winning_index
           THEN shares * (payout_numerators[outcome_index + 1] / payout_denominator) - (entry_price * shares) - fee_usd
           ELSE -(entry_price * shares) - fee_usd
      END) as realized_pnl_usd
FROM wallet_trades wt
LEFT JOIN resolutions r ON lower(replaceAll(wt.condition_id, '0x', '')) = r.condition_id_norm
GROUP BY wallet_address;

-- EXPECTED VALUES (from Polymarket UI):
-- Wallet 2: ~$360,492 (was $0 before recovery)
-- Wallet 3: ~$94,730 (was $0 before recovery)
-- Wallet 4: ~$12,171 (was $0 before recovery)

-- TOLERANCE: ±5% (due to post-snapshot trades)
```

**If all three wallets match (±5%):**
- ✅ RECOVERY SUCCESSFUL
- ✅ Proceed immediately to Phase 1 backfill

**If values are still $0:**
- ❌ Recovery had issues
- Check: condition_id extraction format (uppercase? lowercase? 0x prefix?)
- Investigate: Why specific wallets still have empty condition_ids

**If values are wildly different:**
- ❌ Formula issue or resolution data issue
- Check: Are market_resolutions_final data correct?
- Investigate: Sample condition resolution for wallet 2

---

## 🚀 PHASE 1: PARALLEL BACKFILL (AFTER CHECKPOINT 3 PASSES)

**Timeline:** 2-4 hours

**Execute this command:**

```bash
# Parallel backfill for all 996K wallets
for i in {1..8}; do
  npx tsx scripts/backfill-wallet-pnl-parallel.ts $i &
done

echo "✅ 8 workers launched"
echo "⏳ Expected runtime: 2-4 hours"
echo "📊 Monitoring: Check dashboard for wallet_pnl updates"

# Wait for all workers
wait

echo "✅ Backfill complete: All 996K wallets processed"
```

**What's happening:**
- Worker 1: Wallets with hash % 8 = 0 (~124K wallets)
- Worker 2: Wallets with hash % 8 = 1 (~124K wallets)
- ... (8 workers total)
- All inserting into `wallet_pnl_final` table
- ClickHouse handles concurrent inserts safely

**Success criteria:**
- [ ] All 8 workers complete without errors
- [ ] wallet_pnl_final has ~996K rows
- [ ] P&L distribution looks reasonable (not all $0 or all $1M)

---

## ✅ PHASE 1 VALIDATION (30 min after backfill completes)

```sql
-- Sanity check: Overall stats
SELECT
  COUNT(*) as total_wallets,
  COUNT(CASE WHEN realized_pnl_usd > 0 THEN 1 END) as profitable_wallets,
  COUNT(CASE WHEN realized_pnl_usd < 0 THEN 1 END) as losing_wallets,
  COUNT(CASE WHEN realized_pnl_usd = 0 THEN 1 END) as breakeven_wallets,
  ROUND(SUM(realized_pnl_usd), 2) as total_pnl_usd,
  ROUND(AVG(realized_pnl_usd), 2) as avg_pnl_usd
FROM wallet_pnl_final;

-- EXPECTED:
-- total_wallets: ~996,000
-- profitable_wallets: 70-90% (markets favor traders)
-- total_pnl_usd: Should be positive overall
-- avg_pnl_usd: Should be reasonable (not $1M per wallet!)
```

---

## 📊 DASHBOARD INTEGRATION (2-3 hours after backfill validation)

**What to do:**
1. Update API endpoint to use `wallet_pnl_final` (not old P&L tables)
2. Deploy leaderboards:
   - Top 1K by P&L (whale leaderboard)
   - Distribution chart (profitable vs losing)
   - Category breakdown (if applicable)
3. Validate real-time updates work

**Files to update:**
- `/src/app/api/pnl/[wallet].ts` - Single wallet P&L endpoint
- `/src/app/api/leaderboard.ts` - Top wallets
- `/src/components/dashboard/` - UI components

---

## ❌ ABORT CONDITIONS

Stop and report if:

1. **Recovery takes > 30 min:**
   - Query is too slow
   - Need to rewrite with better batching
   - Contact: Third Claude for optimization

2. **Wallets 2-4 still show $0 after recovery:**
   - Recovery didn't work
   - Need to investigate condition_id format
   - Contact: Third Claude for diagnosis

3. **Backfill takes > 6 hours:**
   - Workers are bottlenecked
   - Database is under load
   - Contact: Main Claude for worker parallelism tuning

4. **Dashboard queries fail:**
   - New P&L table schema issue
   - Contact: Main Claude for debugging

---

## 📋 CHECKLIST

### Recovery Phase (Checkpoint 1-3)
- [ ] Monitor recovery execution (10-15 min)
- [ ] Validate empty_id reduction (5-10 min)
- [ ] Test wallets 2-4 P&L (10 min)
- [ ] If all pass → Proceed to backfill

### Backfill Phase
- [ ] Launch 8 parallel workers
- [ ] Monitor for 2-4 hours
- [ ] Validate total wallet count (~996K)
- [ ] Check P&L distribution

### Dashboard Phase
- [ ] Update API endpoints
- [ ] Deploy leaderboards
- [ ] Validate real-time updates
- [ ] Test with 10 sample wallets

### Success State
- [ ] Recovery: 77.4M empty → <100K empty
- [ ] Wallets 2-4: $0 → Match Polymarket UI
- [ ] Backfill: 0 wallets → 996K wallets
- [ ] Dashboard: Deployed and live

---

## 🎯 FINAL SUCCESS CRITERIA

By end of today (Day 1):
- ✅ ERC1155 recovery complete
- ✅ Wallets 2-4 validated
- ✅ 8-worker backfill launched

By tomorrow morning (Day 2):
- ✅ All 996K wallets backfilled
- ✅ Dashboard deployed
- ✅ Live to production

---

## HELP & ESCALATION

If you get stuck:

1. **Recovery query error?**
   - Show: Full error message
   - Escalate to: Third Claude for ClickHouse debugging

2. **Wallets 2-4 still showing wrong P&L?**
   - Show: Actual values vs expected
   - Escalate to: Third Claude for root cause analysis

3. **Backfill too slow?**
   - Show: Worker progress logs
   - Escalate to: Main Claude for worker optimization

4. **Dashboard queries break?**
   - Show: API endpoint error
   - Escalate to: Main Claude for schema debugging

---

**You've got this. Three checkpoints. Four hours. Let's go.** ✅
