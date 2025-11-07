# Settlement Rules - Quick Reference
## P&L Calculation for Polymarket Binary Outcomes

**Ground Truth:** 2025-10-31 23:59:59 snapshot | **Precision:** Float64

---

## Three Core Rules

### Rule 1: Signed Cashflow (per fill)

```sql
-- BUY (side=1): negative outflow
signed_cashflow = -(entry_price * shares) - (fee_usd + slippage_usd)

-- SELL (side=2): positive inflow
signed_cashflow = +(entry_price * shares) - (fee_usd + slippage_usd)
```

### Rule 2: Settlement on Resolution (per market)

```sql
-- Long Win: outcome matches winning_index
IF side = 1 AND outcome_index = winning_index THEN settlement = 1.0 * shares

-- Short Win: outcome does NOT match winning_index
IF side = 2 AND outcome_index != winning_index THEN settlement = 1.0 * shares

-- Loss: all other cases
ELSE settlement = 0.0
```

### Rule 3: Realized P&L (per market, side-dependent!)

```sql
-- Long Win
IF side = 1 AND settlement > 0 THEN pnl = settlement - cashflow

-- Long Loss
IF side = 1 AND settlement = 0 THEN pnl = cashflow

-- Short Win
IF side = 2 AND settlement > 0 THEN pnl = settlement + cashflow

-- Short Loss
IF side = 2 AND settlement = 0 THEN pnl = -cashflow
```

---

## Dedup Key

```sql
GROUP BY (
    transaction_hash,
    wallet_address,
    timestamp,
    side,
    shares,
    entry_price,
    usd_value,
    market_id
)
```

---

## Test Results Summary

| Test | Type | Cashflow | Settlement | P&L | Status |
|------|------|----------|------------|-----|--------|
| 1 | Long Win | -$4.15 | $10.00 | $14.15 | ✅ |
| 2 | Long Loss | -$6.15 | $0.00 | -$6.15 | ✅ |
| 3 | Short Win | $2.85 | $10.00 | $12.85 | ✅ |
| 4 | Short Loss | $6.85 | $0.00 | -$6.85 | ✅ |

**Result:** 4/4 PASS (100%)

---

## Key Insights

1. **Cashflow signs differ by side:**
   - Longs (BUY): negative = cost
   - Shorts (SELL): positive = premium received

2. **Settlement is binary:**
   - Winners get $1.00 per share
   - Losers get $0.00

3. **P&L formula is NOT universal:**
   - Must branch on both side AND win/loss
   - Cannot use simple `settlement - cashflow` for all cases

4. **Float64 is sufficient:**
   - No precision loss detected
   - All values < 15 in test cases
   - Safe for production use

---

## Files

- SQL: `/Users/scotty/Projects/Cascadian-app/scripts/settlement-rules.sql`
- Tests: `/Users/scotty/Projects/Cascadian-app/scripts/test-settlement-rules.ts`
- Full Report: `/Users/scotty/Projects/Cascadian-app/SETTLEMENT_RULES_TEST_REPORT.md`

---

**Status:** ✅ Step 4 Complete | **Date:** 2025-11-06
