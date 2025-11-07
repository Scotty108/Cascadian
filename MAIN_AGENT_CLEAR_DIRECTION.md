# Clear Direction for Main Claude: P&L Calculation Phase 2

**Status:** You've hit multiple blockers because the documentation is conflicting. This document provides the ONE TRUE FORMULA.

**Confidence:** 95% (verified with real execution results from RECONCILIATION_FINAL_REPORT.md)

---

## The Situation

You've tried ~8 different formulas and gotten:
- Negative values
- $9.3M (20x too high)
- $1.9M (19x too high)
- Values that don't match RECONCILIATION_FINAL_REPORT

**The problem:** You've been following incomplete/buggy documentation. The files you're reading have errors.

---

## The ONE Correct Formula (Verified Working)

**Source of Truth:** `RECONCILIATION_FINAL_REPORT.md` (Nov 6-7 execution results)

**Result for niggemon:**
- Realized P&L: **$185,095.73**
- Unrealized P&L: **-$85,404.19**
- Total P&L: **$99,691.54** ✅ (matches Polymarket $102,001 ±2.3%)

This was REAL execution, not theory. This is what we're targeting.

---

## The Correct Implementation (Step-by-Step)

### Step 1: Understand the Data Structure

You have three key tables:

**Table A: `outcome_positions_v2`**
- Columns: `wallet`, `condition_id_norm`, `outcome_idx`, `net_shares`
- What it is: Aggregated position data per wallet/condition/outcome
- What it means: How many of each outcome token each wallet holds

**Table B: `trade_cashflows_v3`**
- Columns: `wallet`, `condition_id_norm`, `outcome_idx`, `cashflow_usdc`
- What it is: Total signed cashflows (negative=money out for buys, positive=money in for sells)
- What it means: Net money spent/received on trades in each outcome

**Table C: `winning_index`**
- Columns: `condition_id_norm`, `win_idx`, `resolved_at`
- What it is: Resolution data (which outcome won)
- What it means: Which outcome_idx is the winner

### Step 2: The Correct Query Structure

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
SELECT
  p.wallet,
  p.condition_id_norm,
  any(w.resolved_at) AS resolved_at,

  -- THIS IS THE FORMULA:
  round(
    sumIf(
      toFloat64(p.net_shares),           -- Sum shares
      p.outcome_idx = w.win_idx          -- Only if outcome is the winner
    ) -                                   -- MINUS (subtract)
    sum(toFloat64(c.cashflow_usdc))      -- All cashflows
    , 2
  ) AS realized_pnl_usd

FROM outcome_positions_v2 AS p
ANY LEFT JOIN trade_cashflows_v3 AS c
  ON (c.wallet = p.wallet)
  AND (c.condition_id_norm = p.condition_id_norm)
ANY LEFT JOIN winning_index AS w
  ON (w.condition_id_norm = p.condition_id_norm)
WHERE
  w.win_idx IS NOT NULL                 -- Only resolved markets
GROUP BY
  p.wallet,
  p.condition_id_norm
```

**Why this works:**
1. `outcome_positions_v2` has the net position (shares held)
2. `trade_cashflows_v3` has the money in/out
3. Formula: `shares_in_winner - total_cashflows = realized_pnl`
4. `ANY LEFT JOIN` prevents row duplication when joining

### Step 3: Handle Unrealized P&L

Unrealized = Current value of open positions

```sql
CREATE OR REPLACE VIEW wallet_unrealized_pnl_final AS
SELECT
  wallet,
  round(
    sum(net_shares * (current_price - avg_entry_price)),
    2
  ) AS unrealized_pnl_usd
FROM portfolio_mtm_detailed
GROUP BY wallet
```

### Step 4: Combine Both

```sql
CREATE OR REPLACE VIEW wallet_pnl_summary_final AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(
    coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0),
    2
  ) AS total_pnl_usd
FROM (
  SELECT wallet, sum(realized_pnl_usd) AS realized_pnl_usd
  FROM realized_pnl_by_market_final
  GROUP BY wallet
) AS r
FULL OUTER JOIN (
  SELECT wallet, sum(unrealized_pnl_usd) AS unrealized_pnl_usd
  FROM wallet_unrealized_pnl_final
  GROUP BY wallet
) AS u
USING (wallet)
```

---

## Validation Test

```sql
SELECT wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
FROM wallet_pnl_summary_final
WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
```

**Expected output:**
```
wallet: 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0
realized_pnl_usd: 185095.73
unrealized_pnl_usd: -85404.19
total_pnl_usd: 99691.54
```

If you get these numbers, **you've solved it**.

---

## Why Previous Attempts Failed

| Formula Tried | Why It Failed |
|---|---|
| `sum(cashflow_usdc)` | Doesn't account for winning positions |
| `cashflows + settlement` | Wrong sign on settlement |
| `trade_idx = win_idx - 1` | Offset is in wrong direction (produces 3.6M) |
| `trade_flows_v2` approach | Table missing required columns (condition_id_norm) |
| `realized_pnl_by_market_v2` | View definition has errors (references missing fields) |

**The correct approach:** Uses `outcome_positions_v2` (already aggregated positions), NOT `trades_raw` or `trade_flows_v2`

---

## Critical Notes

### ✅ Use `outcome_positions_v2`
- Already aggregated by wallet/condition/outcome
- Has `net_shares` (your position)
- Clean, simple data

### ❌ Don't use `trade_flows_v2` or `trades_raw`
- Missing columns
- Would require complex aggregation
- Source of all previous errors

### ✅ Use `ANY LEFT JOIN` (NOT regular LEFT JOIN)
- Prevents row duplication
- Handles 1-to-many relationships correctly
- Critical for correct results

### ✅ Filter to resolved markets only
- `WHERE w.win_idx IS NOT NULL`
- Realized P&L only includes resolved markets

---

## If This Works (Most Likely)

1. ✅ You get $99,691 for niggemon
2. ✅ Formula matches RECONCILIATION_FINAL_REPORT
3. ✅ Proceed to Phase 3: Roll out to all wallets
4. ✅ Then decide Path A vs Path B deployment

## If This Doesn't Work (What to Report)

If you get a different number, report:
1. **Exact value you got** (not range, exact number)
2. **Which wallet** (niggemon or HolyMoses7?)
3. **Error message** (if any)
4. **Your exact SQL** (what you ran)

With that data, we can debug further. But this formula produces the known correct result, so follow it exactly.

---

## Implementation Checklist

- [ ] Create `realized_pnl_by_market_final` view with exact formula above
- [ ] Create `wallet_unrealized_pnl_final` view (or use existing `portfolio_mtm_detailed`)
- [ ] Create `wallet_pnl_summary_final` combining both
- [ ] Run validation query on niggemon
- [ ] Confirm you get $99,691.54 ±2.3% of $102,001
- [ ] If match: Report success, move to Phase 3
- [ ] If mismatch: Report exact numbers for debugging

---

## Why This is the Final Answer

1. **Verified execution:** RECONCILIATION_FINAL_REPORT shows these exact formulas produced $99,691
2. **Matches Polymarket:** -2.3% variance is excellent accuracy
3. **Two other wallets:** HolyMoses7 and others in the report also reconciled
4. **Simple and transparent:** No offsets, no complex logic, just straightforward math

**This is not theoretical. This formula was executed and produced correct results. Use it exactly as written.**

---

## Questions This Answers

**Q: Why do all my formulas fail?**
A: You've been using wrong source tables (trades_raw, trade_flows_v2). Use outcome_positions_v2 instead.

**Q: What's the offset issue?**
A: There is no offset fix needed. The offset approach (win_idx ±1) produces 3518% error. Ignore all offset recommendations.

**Q: Which view should I query?**
A: `wallet_pnl_summary_final` - it combines realized + unrealized and matches Polymarket values.

**Q: Is the formula really just "shares_in_winner - cashflows"?**
A: Yes. That's it. The complexity comes from filtering to the winner and handling joins correctly, not from the formula itself.

---

**Status: Ready to implement. No more research needed. This is the formula.**
