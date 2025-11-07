# DATABASE FIXES - QUICK START GUIDE

**Objective:** Fix P&L calculation from $3.6M (broken) to $99K (verified)

**Time Estimate:** 2-3 hours total

**Difficulty:** Medium (mostly debugging, one formula fix)

---

## THE PROBLEM IN ONE PICTURE

```
What's Happening:
trades_raw (159.5M)
    → trade_flows_v2 (cashflows calculated CORRECTLY)
    → realized_pnl_by_market_v2 (settlement=0 BUG)
    → Result: $3.69M (should be $99K)

The Bug:
    realized_pnl = SUM(cashflows) + sumIf(delta_shares, outcome_idx = win_idx)

    Where:
    - SUM(cashflows) = $3.69M ✅ CORRECT
    - sumIf(delta_shares, ...) = $0 ❌ BUG (returns 0 for all rows)

    Result: $3.69M + $0 = $3.69M ❌

The Fix:
    Find why outcome_idx never equals win_idx
    (Likely: 0-based vs 1-based indexing mismatch)
    Apply offset correction
    Result: $99K ✅
```

---

## 3 PHASES TO SUCCESS

### Phase 1: DEBUG (45 min)

**Run this diagnostic script:**

```sql
-- DIAGNOSTIC: Check index alignment
SELECT
  SUM(CASE WHEN trade_flows_v2.outcome_idx = winning_index.win_idx THEN 1 ELSE 0 END) as exact_match,
  SUM(CASE WHEN trade_flows_v2.outcome_idx = winning_index.win_idx + 1 THEN 1 ELSE 0 END) as off_by_plus_one,
  SUM(CASE WHEN trade_flows_v2.outcome_idx + 1 = winning_index.win_idx THEN 1 ELSE 0 END) as off_by_minus_one,
  COUNT(*) as total
FROM trade_flows_v2
JOIN winning_index ON trade_flows_v2.condition_id_norm = winning_index.condition_id_norm;
```

**Expected Output:** One of these will dominate:
- `exact_match > 0` → No offset needed
- `off_by_plus_one` dominate → Add 1 to outcome_idx
- `off_by_minus_one` dominate → Add 1 to win_idx

**Document your finding:** It will tell you exactly how to fix Phase 2

---

### Phase 2: FIX (1 hour)

**Edit:** `scripts/realized-pnl-corrected.ts` (line ~135)

**Current Code (BROKEN):**
```typescript
sumIf(tf.delta_shares, tf.trade_idx = wi.win_idx) AS settlement
```

**Fixed Code (using your diagnostic result):**

If `exact_match` dominates:
```typescript
sumIf(tf.delta_shares, tf.outcome_idx = wi.win_idx) AS settlement
```

If `off_by_plus_one` dominates:
```typescript
sumIf(tf.delta_shares, tf.outcome_idx = wi.win_idx + 1) AS settlement
```

If `off_by_minus_one` dominates:
```typescript
sumIf(tf.delta_shares, tf.outcome_idx + 1 = wi.win_idx) AS settlement
```

**Re-run the script:**
```bash
npx tsx scripts/realized-pnl-corrected.ts
```

**Test the result:**
```sql
SELECT realized_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0');
```

**Expected:** ~$99,691 (not $3,685,851)

---

### Phase 3: VALIDATE & DEPLOY (30 min)

**Test all 4 wallets:**
```sql
SELECT
  wallet,
  ROUND(total_pnl_usd, 2) as pnl,
  CASE
    WHEN wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0') THEN '$102,001 target'
    WHEN wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8') THEN '$89,975 target'
    WHEN wallet = lower('0x7f3c8979d0afa00007bae4747d5347122af05613') THEN '$179,243 target'
    WHEN wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b') THEN '$94,730 target'
  END as expected
FROM wallet_pnl_summary_v2
WHERE wallet IN (
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'),
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
)
ORDER BY pnl DESC;
```

**Success Criteria:**
- niggemon: within ±5% of $102,001 ✅
- HolyMoses7: within ±5% of $89,975 ✅
- Others: within ±5% of targets ✅

**Deploy:**
1. Update API endpoint: `src/app/api/wallets/[address]/pnl/route.ts`
2. Change query to use fixed `wallet_pnl_summary_v2`
3. Run tests
4. Deploy to production

---

## KEY THINGS TO REMEMBER

### ✅ DO These Things

- Normalize condition_id: `lower(replaceAll(cond_id, '0x', ''))`
- Filter bad data: `WHERE market_id NOT IN ('12', '0x00...')`
- Test against niggemon: should be ~$99K
- Use trade_flows_v2 for cashflows (already correct)
- Calculate settlement fresh (don't trust pre-aggregated)

### ❌ DON'T Do These Things

- Don't use `trades_raw.realized_pnl_usd` (99.9% wrong)
- Don't use `trades_raw.pnl` (96.68% NULL)
- Don't use pre-aggregated outcome_positions tables
- Don't assume outcome_idx and win_idx align (they don't!)
- Don't ignore market_id='12' (it's corrupted)

---

## WHAT'S ALREADY CORRECT

✅ **These are working fine, don't change:**

- `trades_raw` - Complete and clean (99.2% good data)
- `trade_flows_v2` - Cashflows calculated correctly
- `market_resolutions_final` - Authoritative resolution data
- `condition_market_map` - Market↔condition mapping works
- `market_candles_5m` - Price data 100% complete

---

## IF SOMETHING BREAKS

**Symptom:** P&L still showing $3.6M

→ Check: Did settlement calculation really change? Run diagnostic again.

**Symptom:** P&L shows $0 for all wallets

→ Check: Did you accidentally filter all markets? Verify market_id filter

**Symptom:** niggemon shows $89K instead of $99K

→ Check: You may have reversed the index offset. Try the opposite.

**Symptom:** One wallet is correct, others are wrong

→ Check: Some markets may have different outcome ordering. Run diagnostic per wallet.

---

## REFERENCE DOCUMENTS

For deep understanding, see:
- `CASCADIAN_DATABASE_MASTER_REFERENCE.md` - Complete reference
- `VERIFIED_CORRECT_PNL_APPROACH.md` - The formula that works
- `DATABASE_COMPLETE_EXPLORATION.md` - All tables documented

---

## QUICK REFERENCE: WHERE EVERYTHING IS

| What | Where |
|------|-------|
| P&L Views | `scripts/realized-pnl-corrected.ts` |
| API Endpoint | `src/app/api/wallets/[address]/pnl/route.ts` |
| Tests | Run diagnostic query above |
| Documentation | See reference documents list |

---

**Status:** Ready to execute
**Next Step:** Run Phase 1 diagnostic
**Questions?** See CASCADIAN_DATABASE_MASTER_REFERENCE.md

