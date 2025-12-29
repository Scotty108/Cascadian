# PnL TDD Validation - Step A: Single-Market Sanity Check

**Date:** 2025-11-24
**Wallet:** egg (`0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`)
**Status:** ✅ PASSED (after critical bug fix)

---

## Executive Summary

Step A validation revealed a **critical case-sensitivity bug** in PnL calculations, but after fixing it, the manual calculation matches the `vw_pm_realized_pnl_v5` view perfectly.

### Test Market Selected

- **Condition ID:** `340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307`
- **Question:** "Will a dozen eggs be between $4.25-4.50 in August?"
- **Trade Count:** 7 trades
- **Resolution:** Outcome 1 won (payout: [0, 1], denominator: 2)
- **Wallet Position:** All trades on Outcome 0 (the LOSING outcome)

---

## Manual PnL Calculation

### Trade Breakdown (Outcome 0)

| Trade | Time | Side | USDC | Shares | Fee | Cash Δ | Shares Δ |
|-------|------|------|------|--------|-----|--------|----------|
| 1 | 2025-09-05 17:52:52 | BUY | 12.91 | 12,914.89 | 0 | -12.91 | +12,914.89 |
| 2 | 2025-09-05 17:52:52 | BUY | 0.04 | 40.65 | 0 | -0.04 | +40.65 |
| 3 | 2025-09-05 17:52:52 | BUY | 0.22 | 218.92 | 0 | -0.22 | +218.92 |
| 4 | 2025-09-05 17:52:52 | BUY | 12.66 | 12,655.32 | 0 | -12.66 | +12,655.32 |
| 5 | 2025-09-10 01:20:32 | SELL | 69.95 | 9,992.94 | 0 | +69.95 | -9,992.94 |
| 6 | 2025-09-10 01:20:32 | SELL | 79.04 | 11,290.94 | 0 | +79.04 | -11,290.94 |
| 7 | 2025-09-10 01:20:32 | SELL | 9.09 | 1,298.00 | 0 | +9.09 | -1,298.00 |

### Aggregated Position

- **Total Cash Delta:** -$25.83 + $158.08 = **$132.24**
- **Final Shares:** 25,829.78 - 22,581.88 = **3,247.90 shares**

### Resolution Calculation

- **Resolution Prices:**
  - Outcome 0: 0 / 2 = **0.000000**
  - Outcome 1: 1 / 2 = **0.500000**

- **Resolution Value:**
  - Outcome 0: 3,247.90 shares × 0.000000 = **$0.00**

- **Realized PnL:**
  - Cash Delta + Resolution Value = $132.24 + $0.00 = **$132.24**

---

## View Comparison

```sql
SELECT * FROM vw_pm_realized_pnl_v5
WHERE condition_id = '340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307'
  AND wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
```

**Result:**
- `trade_cash`: $132.24338
- `resolution_cash`: $0
- `realized_pnl`: **$132.24338**

**Match:** ✅ **PERFECT MATCH** (difference: $0.00)

---

## Critical Bug Found & Fixed

### The Bug

The `pm_trader_events_v2` table stores the `side` column in **lowercase** ('buy', 'sell'), but PnL calculations were using **uppercase** comparison:

```sql
-- WRONG (fails to match)
CASE WHEN t.side = 'BUY' THEN ...

-- CORRECT
CASE WHEN lower(t.side) = 'buy' THEN ...
```

### Impact

Without the lowercase fix:
- ALL trades were treated as SELLs (falling into the ELSE branch)
- Cash deltas had wrong signs
- Shares deltas had wrong signs
- Manual PnL: **$183.90** (incorrect)
- View PnL: **$132.24** (correct)
- **Difference: $51.66** (FAIL)

After the fix:
- Cash deltas correct
- Shares deltas correct
- Manual PnL: **$132.24** (correct)
- View PnL: **$132.24** (correct)
- **Difference: $0.00** (PASS)

### Root Cause

The data ingestion stored sides in lowercase, but the calculation logic assumed uppercase. This is a **silent failure** that would have affected:
- All PnL calculations using raw SQL
- Any scripts manually calculating PnL
- Test validation scripts

---

## Validation Formula (Canonical)

```sql
-- CORRECT PnL calculation formula
WITH trades AS (
    SELECT
        t.event_id,
        t.trade_time,
        t.side,
        m.outcome_index,

        -- BUY: spend USDC (negative), receive shares (positive)
        -- SELL: receive USDC (positive), give up shares (negative)
        CASE WHEN lower(t.side) = 'buy'
             THEN -((t.usdc_amount + t.fee_amount) / 1e6)
             ELSE +((t.usdc_amount - t.fee_amount) / 1e6)
        END as cash_delta,

        CASE WHEN lower(t.side) = 'buy'
             THEN +(t.token_amount / 1e6)
             ELSE -(t.token_amount / 1e6)
        END as shares_delta

    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = :wallet
      AND m.condition_id = :condition_id
)
SELECT
    outcome_index,
    sum(cash_delta) as total_cash,
    sum(shares_delta) as final_shares
FROM trades
GROUP BY outcome_index
```

**Resolution Value Calculation:**
```sql
resolution_value = SUM(final_shares[i] × (payout_numerators[i] / payout_denominator))
```

**Realized PnL:**
```sql
realized_pnl = total_cash + resolution_value
```

---

## Data Quality Observations

1. **Units:** All amounts stored with 6 decimal places (1e6 = 1 USDC/token)
2. **Fees:** All fees are $0 in this test market
3. **Roles:** Trades have both 'maker' and 'taker' roles
4. **Resolution:** Binary market (2 outcomes), winner takes all

---

## Next Steps

- ✅ **Step A COMPLETE:** Single-market calculation validated
- ⏳ **Step B:** Multi-market portfolio PnL validation
- ⏳ **Step C:** Edge cases (partial fills, complex resolutions)
- ⏳ **Step D:** Full wallet reconciliation

---

## Files Created

- `/Users/scotty/Projects/Cascadian-app/scripts/pnl-step-a-single-market-validation.ts` - Main validation script
- `/Users/scotty/Projects/Cascadian-app/scripts/investigate-egg-market-discrepancy.ts` - Detailed investigation
- `/Users/scotty/Projects/Cascadian-app/scripts/check-trader-events-schema.ts` - Schema validation
- `/Users/scotty/Projects/Cascadian-app/scripts/check-pnl-tables.ts` - PnL table discovery
- `/Users/scotty/Projects/Cascadian-app/scripts/check-v5-schema.ts` - View schema validation

---

**Signed:** Claude 4.5 (Database Agent)
**Timezone:** PST
**Validation Status:** ✅ PASSED
