# P&L Bug #4 - Root Cause Analysis & Fix

**Date**: 2025-11-12
**Terminal**: Claude 1
**Status**: 🔍 **ROOT CAUSE IDENTIFIED**

---

## Root Cause: Missing 1e6 Scaling Divisions

After analyzing the view definitions and raw data, I've identified the **exact scaling bugs** causing the P&L discrepancy:

### ✅ Confirmed: Raw Data Uses 1e6 Micro-Share Units

From `clob_fills`:
```
price: 0.016 (USD per share, decimal)
size:  891000000 (micro-shares, needs ÷1e6 to get actual shares)
```

**Example**:
- size = 891000000 micro-shares
- Actual shares = 891000000 ÷ 1,000,000 = **891 shares**
- Cost = 0.016 × 891 = **$14.256**

### ❌ Bug #1: `trade_cashflows_v3` Missing ÷1e6

**Current formula** (`scripts/realized-pnl-final-fixed.ts:62-66`):
```sql
round(
  toFloat64(entry_price) * toFloat64(shares) *  -- ❌ Missing ÷1e6
  if(side = 'YES' OR side = 1, -1, 1),
  8
) AS cashflow_usdc
```

**Problem**:
- Calculates: 0.016 × 891000000 = **14,256,000** (wrong by 1,000,000×)
- Should be: 0.016 × (891000000 ÷ 1e6) = **14.256**

### ❌ Bug #2: `realized_pnl_by_market_final` Missing ÷1e6 on Payout

**Current formula** (`scripts/realized-pnl-final-fixed.ts:128-133`):
```sql
round(
  sum(total_cashflow) + sumIf(net_shares, outcome_idx = win_idx),  -- ❌ Missing ÷1e6
  4
) AS realized_pnl_usd
```

**Problem**:
- For winning position with net_shares = 7,611,200,000 micro-shares
- Current payout: 7,611,200,000 (wrong)
- Correct payout: 7,611,200,000 ÷ 1e6 = **7,611.20** shares = **$7,611.20** (at $1/share)

### ❌ Bug #3: `outcome_positions_v2` Also Needs ÷1e6

**Current formula** (`scripts/realized-pnl-final-fixed.ts:77`):
```sql
sum(if(side = 'YES' OR side = 1, 1.0, -1.0) * sh) AS net_shares  -- ❌ Stored in micro-shares
```

**Problem**:
- `sh` is loaded from `shares` which is in micro-shares
- Should divide by 1e6 to convert to actual share units

---

## Impact Analysis

Using wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`:

| Component | Current Value | Correct Value | Error Factor |
|-----------|--------------|---------------|--------------|
| **cashflow_usdc** | $14,256,000 | $14.256 | 1,000,000× too high |
| **net_shares (payout)** | 7,611,200,000 | $7,611.20 | 1,000,000× too high |
| **Total P&L (validator)** | $34,957 | Should be ~$87,030 | ~2.5× too low |

**Why validator shows $34,957 instead of $87,030**:
1. Validator divides cashflow by 1e6 (scripts/validate-corrected-pnl-comprehensive-fixed.ts:101)
2. But then **subtracts** payout which is ALSO divided by 1e6 (line 100)
3. This partially compensates for missing divisions, but formula is inverted

**Why database shows $71.4K**:
1. Database views have NO ÷1e6 anywhere
2. The raw sum of 71,431,164,434 micro-USD ÷ 1e6 = **$71,431**
3. Still ~$15K short of $87K because formula is wrong

---

## Correct Formulas

### Fix #1: trade_cashflows_v3
```sql
CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
  outcome_index AS outcome_idx,
  toFloat64(entry_price) AS px,
  toFloat64(shares) / 1000000.0 AS sh,  -- ✅ Convert to actual shares
  round(
    toFloat64(entry_price) * (toFloat64(shares) / 1000000.0) *  -- ✅ Divide by 1e6
    if(side = 'YES' OR side = 1, -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup
WHERE condition_id IS NOT NULL
```

### Fix #2: outcome_positions_v2
```sql
CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  outcome_idx,
  sum(if(side = 'YES' OR side = 1, 1.0, -1.0) * sh) AS net_shares
FROM (
  SELECT
    lower(wallet_address) AS wallet,
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    side,
    toFloat64(shares) / 1000000.0 AS sh  -- ✅ Convert to actual shares
  FROM trades_dedup
  WHERE condition_id IS NOT NULL
)
GROUP BY wallet, market_id, condition_id_norm, outcome_idx
```

### Fix #3: realized_pnl_by_market_final
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH pos_cf AS (
  SELECT
    p.wallet,
    p.market_id,
    p.condition_id_norm,
    p.outcome_idx,
    p.net_shares,  -- ✅ Already in actual shares after fix #2
    sum(c.cashflow_usdc) AS total_cashflow  -- ✅ Already in USD after fix #1
  FROM outcome_positions_v2 p
  ANY LEFT JOIN trade_cashflows_v3 c
    ON c.wallet = p.wallet
    AND c.market_id = p.market_id
    AND c.condition_id_norm = p.condition_id_norm
    AND c.outcome_idx = p.outcome_idx
  GROUP BY p.wallet, p.market_id, p.condition_id_norm, p.outcome_idx, p.net_shares
),
with_win AS (
  SELECT
    pos_cf.wallet,
    pos_cf.market_id,
    pos_cf.condition_id_norm,
    wi.resolved_at,
    wi.win_idx,
    pos_cf.outcome_idx,
    pos_cf.net_shares,
    pos_cf.total_cashflow
  FROM pos_cf
  ANY LEFT JOIN winning_index wi USING (condition_id_norm)
  WHERE wi.win_idx IS NOT NULL
)
SELECT
  wallet,
  market_id,
  condition_id_norm,
  resolved_at,
  round(
    sum(total_cashflow) + sumIf(net_shares, outcome_idx = win_idx),  -- ✅ Both in correct units now
    4
  ) AS realized_pnl_usd
FROM with_win
GROUP BY wallet, market_id, condition_id_norm, resolved_at
```

**Key insight**: The fix in `realized_pnl_by_market_final` uses `+` not `-` because:
- `total_cashflow` is negative for buys (money spent: -$14.26)
- Payout is positive for wins (money received: +$7,611.20)
- P&L = payout + cashflow = $7,611.20 + (-$14.26) = **$7,596.94**

---

## Validation Impact

After these fixes:
- ✅ `net_shares` will be in actual shares (891 not 891000000)
- ✅ `cashflow_usdc` will be in USD ($14.26 not $14,256,000)
- ✅ `realized_pnl_usd` will be correct (~$87K for test wallet)
- ✅ Validator will match database output
- ✅ <2% variance target will be achievable

---

## Next Steps

1. **Create consolidated fix script** that rebuilds all three views atomically
2. **Run the fix** to update all views
3. **Validate** using `scripts/validate-corrected-pnl-comprehensive-fixed.ts`
4. **Test** on all Dome baseline wallets
5. **Update** reconciliation report

---

**Terminal**: Claude 1
**Root Cause**: Missing ÷1e6 conversions in 3 view definitions
**Status**: Fix ready to implement
