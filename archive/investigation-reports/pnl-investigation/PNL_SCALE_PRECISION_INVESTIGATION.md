# P&L Scale/Precision Investigation Report

**Date:** 2025-11-15
**Status:** 🔴 Critical Data Quality Issues Detected
**Reporter:** Claude 1

---

## Executive Summary

The `pm_wallet_market_pnl_resolved` view was successfully created per PM_PNL_SPEC_C1.md, but diagnostics reveal severe data quality issues:

- **Conservation Failure:** 99.63% of markets fail zero-sum check (expected <5%)
- **Scale Anomaly:** Total fees of $592 trillion (vs expected ~millions)
- **Zero Fees:** Many positions show $0 fees despite having trades
- **Extreme Values:** Top wallet has +$224 trillion P&L

**Impact:** Cannot proceed with fixture validation (Task P4) until root cause identified and fixed.

---

## Diagnostic Results Summary

### Coverage Statistics
```
Total Positions:     1,328,644
Distinct Wallets:      230,588
Distinct Markets:       61,656
Total Trades:       10,605,535
```

### P&L Distribution (Red Flags)
```
Total Net P&L:  -$248,147,000,000,000 (trillion)
Total Fees:     +$592,418,000,000,000 (trillion)
Min P&L:        -$285,987,000,000,000
Max P&L:        +$224,473,000,000,000
```

### Conservation Check (Critical Failure)
```
Markets Checked:                    61,656
Perfect Conservation (<$0.01):         225 (0.36%)  ← Expected >95%
Good Conservation (<$1.00):            225 (0.36%)
High Deviation (≥$100):             61,430 (99.63%)
Average Absolute Deviation:  $7,748,671,429
Max Deviation:              $2,896,925,000,000
```

### Top Failing Markets
| Market | Total P&L | Total Fees | Deviation | Question |
|--------|-----------|------------|-----------|----------|
| Market 1 | +$2.9T | $0.00 | +$2.9T | Fed rate cut by March 20? |
| Market 2 | +$2.2T | $0.00 | +$2.2T | Will Donald Trump be President... |
| Market 3 | +$1.5T | $0.00 | +$1.5T | [Large market] |

**Pattern:** Most failing markets show $0 fees despite having wallets/trades.

---

## Hypothesis: Root Causes

### Hypothesis 1: Fee Calculation Error ⭐ (Most Likely)
**Evidence:**
- Many markets show `fees_paid = 0` despite having trades
- Some single positions show fees of -$198 trillion
- Fee amounts are aggregated via `SUM(t.fee_amount)` from pm_trades

**Investigation Needed:**
- Check if `pm_trades.fee_amount` is correctly populated from `clob_fills.fee_rate_bps`
- Verify fee calculation: `fee_amount = abs(price * size) * (fee_rate_bps / 10000)`
- Check for NULL fees being treated as 0 vs actual $0 fees

### Hypothesis 2: Share Quantity Scale Error
**Evidence:**
- P&L values in trillions suggest 10^12 or 10^15 multiplier
- Shares might be stored as wei (10^18) or micro-units
- pm_trades.shares comes from clob_fills.size

**Investigation Needed:**
- Check scale of `clob_fills.size` field
- Verify if shares need to be divided by 10^6 or 10^18
- Compare raw clob_fills.size to expected share quantities (typically 1-100,000)

### Hypothesis 3: Price Scale Error
**Evidence:**
- Prices should be [0, 1] for binary markets
- If prices stored as basis points, would need /10000 conversion
- pm_trades.price comes from clob_fills.price

**Investigation Needed:**
- Check range of `clob_fills.price` values
- Verify if prices are decimal [0, 1] or need scaling
- Check if price * shares notional values make sense

### Hypothesis 4: Data Completeness (Less Likely)
**Evidence:**
- Zero-sum failure could indicate missing trades
- But 100% join coverage was verified in previous tasks

**Investigation Needed:**
- Verify no trades filtered out unintentionally
- Check if INNER JOIN drops any data vs LEFT JOIN

---

## Investigation Plan

### Step 1: Sample Raw Data from clob_fills
Query a single failing market to examine raw values:
```sql
SELECT
  market_id,
  asset_id,
  size,  -- Are these 100, or 100000000000000000?
  price, -- Is this 0.6, or 6000?
  fee_rate_bps,
  price * size as notional,
  (price * size * fee_rate_bps / 10000) as calculated_fee
FROM clob_fills
WHERE market_id = '<top_failing_market>'
LIMIT 10
```

### Step 2: Compare pm_trades to clob_fills
For the same market, check if pm_trades matches:
```sql
SELECT
  market_id,
  shares,      -- Compare to clob_fills.size
  price,       -- Compare to clob_fills.price
  fee_amount,  -- Compare to calculated fee
  shares * price as notional
FROM pm_trades
WHERE condition_id = '<matching_condition_id>'
LIMIT 10
```

### Step 3: Check Fee Distribution
```sql
SELECT
  COUNT(*) as total_trades,
  COUNT(CASE WHEN fee_amount = 0 THEN 1 END) as zero_fee_trades,
  COUNT(CASE WHEN fee_amount IS NULL THEN 1 END) as null_fee_trades,
  MIN(fee_amount) as min_fee,
  MAX(fee_amount) as max_fee,
  AVG(fee_amount) as avg_fee
FROM pm_trades
```

### Step 4: Check Share/Price Ranges
```sql
SELECT
  MIN(shares) as min_shares,
  MAX(shares) as max_shares,
  AVG(shares) as avg_shares,
  MIN(price) as min_price,
  MAX(price) as max_price,
  AVG(price) as avg_price,
  MIN(shares * price) as min_notional,
  MAX(shares * price) as max_notional
FROM pm_trades
```

---

## Expected vs Actual Values

### Expected for Typical Binary Market
- **Shares per trade:** 1 - 100,000 (typical retail to whale)
- **Price:** 0.00 - 1.00 (decimal probability)
- **Notional per trade:** $1 - $100,000
- **Fee rate:** 0-200 bps (0-2%)
- **Fee amount per trade:** $0.01 - $2,000
- **Market total P&L + fees:** ≈ $0 (zero-sum)

### Actual Values Observed
- **Total fees:** $592 trillion (!!!)
- **Single wallet P&L:** +$224 trillion
- **Market deviation:** $2.9 trillion
- **Conservation rate:** 0.36% (expected >95%)

**Scale Error Factor:** ~10^12 to 10^15 (trillion vs million)

---

## Next Steps

1. ✅ Document this investigation (this file)
2. ⏳ Execute Investigation Plan Steps 1-4
3. ⏳ Identify exact scale/precision issue
4. ⏳ Fix pm_trades view or source data
5. ⏳ Re-run diagnostics to verify fix
6. ⏳ Proceed with Task P4 (fixture validation)

---

## Blockers

- **Cannot proceed with Task P4** until data quality issues resolved
- Fixture validation requires correct P&L calculations
- Zero-sum property is fundamental invariant that must hold

---

## Files Referenced

- `PM_PNL_SPEC_C1.md` - P&L specification (formulas correct)
- `scripts/90-build-pm_wallet_market_pnl_resolved_view.ts` - View implementation (logic correct)
- `scripts/91-pm-wallet-pnl-diagnostics.ts` - Diagnostics (revealed issues)
- `scripts/80-build-pm-trades-view.ts` - Upstream view (suspect source)
- `scripts/62-build-clob-fills.ts` - Original data source (need to check)

---

**Status:** Investigation in progress. Will update with findings.

---
**Reported by:** Claude 1
**Terminal:** Terminal 1
