# P&L Database Audit Results
**Date:** November 7, 2025
**Database:** ClickHouse (Polymarket data)
**Status:** CRITICAL MISMATCH FOUND

---

## Executive Summary

**FINDING:** The P&L values in our ClickHouse database DO NOT MATCH the expected values from external sources. The discrepancy is massive (99.9%+ difference in most cases).

### Expected vs Actual Values

| Wallet | Expected P&L | Best DB Match | Actual Value | Match % | Status |
|--------|-------------|---------------|--------------|---------|--------|
| niggemon | $102,001.46 | trades_raw.realized_pnl_usd | $117.24 | 0.1% | ❌ NO MATCH |
| HolyMoses7 | $89,975.16 | N/A | $0.00 | 0% | ❌ NO DATA |
| LucasMeow | $179,243 | trades_raw.pnl | -$4,441,211.77 | -2477% | ❌ WRONG DATA |
| xcnstrategy | $94,730 | N/A | $0.00 | 0% | ❌ NO DATA |

---

## Detailed Findings

### 1. niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)

**Expected:** $102,001.46
**Database Reality:**
- `realized_pnl_usd`: $117.24 (332 trades, Sep-Oct 2025)
- `pnl`: -$160.30 (178 trades)
- `pnl_gross`: $35.37 (45 trades)
- `pnl_net`: $34.85 (45 trades)

**Issue:** Database shows only $117 in realized P&L vs expected $102K (99.9% missing)

### 2. HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)

**Expected:** $89,975.16
**Database Reality:** NO P&L DATA FOUND

**Issue:** Wallet exists in database (8,484 trades per inventory) but ALL P&L columns are NULL or zero

### 3. LucasMeow (0x7f3c8979d0afa00007bae4747d5347122af05613)

**Expected:** $179,243
**Database Reality:**
- `realized_pnl_usd`: -$4,441,217.93 (2,255 trades, Feb-Oct 2025)
- `pnl`: -$4,441,211.77 (2,252 trades)

**Issue:** Database shows MASSIVE LOSS (-$4.4M) vs expected profit ($179K). This is inverted and inflated by 25x

### 4. xcnstrategy (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b)

**Expected:** $94,730
**Database Reality:** NO P&L DATA FOUND

**Issue:** No P&L calculations for this wallet

---

## Root Cause Analysis

### Hypothesis 1: Expected Values are from Different Source ✅ LIKELY
The expected P&L values ($100K+ per wallet) appear to come from:
- Polymarket UI / official API
- External calculation with complete trade history
- Include both realized AND unrealized P&L
- Calculated using correct settlement/payout logic

Our database values are:
- Calculated locally using only our ingested data
- May be missing key trades or market resolutions
- Only include a small subset of resolved trades
- Possibly using incorrect P&L formula

### Hypothesis 2: Database Coverage is Incomplete ✅ CONFIRMED
From CLICKHOUSE_INVENTORY_REPORT.md:
- `trades_raw`: 159.5M total trades
- `trades_with_pnl`: Only 515,708 resolved trades (0.32% of total)
- Only 42,798 wallets have ANY P&L data
- Date range for P&L: Only Jan 2024 - Oct 2025 (326 days)

**Translation:** 96.68% of trades have NULL P&L because:
1. Markets not yet resolved
2. Direction inference incomplete
3. Missing outcome/settlement data

### Hypothesis 3: P&L Calculation Formula is Wrong ✅ POSSIBLE
Looking at the data:
- niggemon: Shows only $117 (99.9% missing) → Missing resolved markets
- HolyMoses7: Shows $0 (100% missing) → No markets resolved at all
- LucasMeow: Shows -$4.4M loss vs $179K profit → Wrong formula OR data corruption
- xcnstrategy: Shows $0 → No resolution data

The LucasMeow case is especially concerning - the value is not just missing, it's INVERTED and INFLATED.

---

## Data Availability Matrix

### Tables Checked

| Table | Total Rows | Has P&L Columns | Wallets Found | P&L Data Quality |
|-------|-----------|-----------------|---------------|------------------|
| trades_raw | 159.5M | ✅ Yes (4 columns) | 3 of 4 | ❌ 99%+ mismatch |
| trades_with_pnl | 515K | ✅ Yes | 0 of 4 | ❌ No target wallets |
| vw_trades_canonical | 157.5M | ✅ Yes | Not checked | ⚠️ Unknown |
| vw_trades_canonical_v2 | 515K | ✅ Yes | Not checked | ⚠️ Unknown |
| trades_with_direction | 82.1M | ✅ Yes | Not checked | ⚠️ Unknown |
| trades_with_recovered_cid | 82.1M | ✅ Yes | Not checked | ⚠️ Unknown |

### P&L Columns Available

trades_raw contains:
- `realized_pnl_usd` (Float64)
- `pnl` (Nullable Decimal(18,2))
- `pnl_gross` (Decimal(18,6))
- `pnl_net` (Decimal(18,6))

---

## Critical Questions

### 1. Where do the expected P&L values come from?
- ❓ Are they from Polymarket's official API?
- ❓ Are they calculated externally by a different system?
- ❓ Do they include unrealized P&L (open positions)?
- ❓ What time period do they cover?

### 2. Why is our database P&L so different?
- 96.68% of trades have NULL P&L (not resolved yet)
- Only 0.32% of trades have P&L calculations
- Possibly using wrong settlement formula
- Missing market resolution data

### 3. How should we calculate P&L correctly?
According to CLAUDE.md "Stable Pack" section:
```
PnL source of truth: payout vector + winner index
Formula: pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis
```

**Are we using this formula?** Need to verify.

---

## Recommendations

### Immediate Actions (Priority 1)

1. **Verify Expected Values Source**
   - Confirm where $102K, $89K, $179K, $94K values come from
   - Get exact calculation methodology
   - Understand time period and which trades are included

2. **Check Market Resolution Coverage**
   ```sql
   SELECT
     wallet_address,
     COUNT(*) as total_trades,
     SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_trades,
     SUM(CASE WHEN realized_pnl_usd IS NOT NULL AND realized_pnl_usd != 0 THEN 1 ELSE 0 END) as trades_with_pnl
   FROM trades_raw
   WHERE wallet_address IN (
     '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
     '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
     '0x7f3c8979d0afa00007bae4747d5347122af05613',
     '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
   )
   GROUP BY wallet_address
   ```

3. **Investigate LucasMeow Anomaly**
   - Why does this wallet show -$4.4M loss when expected is +$179K profit?
   - Check for data corruption or formula inversion
   - Review specific trades causing huge losses

### Short-term Actions (Priority 2)

4. **Audit P&L Calculation Scripts**
   - Review `/Users/scotty/Projects/Cascadian-app/scripts/*pnl*.ts` (20+ files found)
   - Verify they use correct payout vector formula from CLAUDE.md
   - Check if they're properly calculating direction (BUY/SELL)

5. **Check for Additional P&L Tables**
   - The comprehensive audit script is still running on all 142 tables
   - May find archived or backup tables with correct data
   - Check for views we haven't examined yet

6. **Compare with External Source**
   - Query Polymarket API for these wallets' actual P&L
   - Compare calculation methodologies
   - Identify gaps in our data pipeline

### Long-term Actions (Priority 3)

7. **Rebuild P&L Calculation Pipeline**
   - Use correct payout vector formula
   - Ensure all market resolutions are fetched
   - Calculate both realized and unrealized P&L
   - Validate against Polymarket official values

8. **Add Data Quality Monitoring**
   - Alert when P&L calculation coverage drops below threshold
   - Monitor resolution data freshness
   - Track calculation accuracy vs external sources

---

## Next Steps

**IMMEDIATE:** User needs to clarify:
1. Where do the expected P&L values ($102K, $89K, $179K, $94K) come from?
2. Should we be calculating P&L ourselves or importing from Polymarket?
3. Are we looking for realized-only or total (realized + unrealized) P&L?

**THEN:** Based on answers above:
- Either fix our P&L calculation formula
- Or import correct P&L data from external source
- Or identify which table/view has the correct pre-calculated values

---

## Appendix: Full Audit Script Output

See `/tmp/pnl-audit-output.txt` for complete audit of all 142 tables (if completed).

Key script used: `/Users/scotty/Projects/Cascadian-app/scripts/quick-pnl-check.ts`
