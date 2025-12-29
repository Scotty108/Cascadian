# PnL TDD Validation - Step B: Egg Wallet Full Reconciliation

**Date:** 2025-11-24  
**Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (egg)  
**UI Expected Total PnL:** ~$96,000  
**Our Calculated Total PnL:** **-$18,362.49**  
**Discrepancy:** **$114,362.49** (negative instead of positive!)

---

## Critical Finding: UNITS BUG FIXED

**Issue:** PnL calculations were initially showing BILLIONS of dollars instead of thousands.

**Root Cause:** The `pm_trader_events_v2` table stores `usdc_amount` and `token_amount` in **micro-units** (need to divide by 1,000,000).

**Evidence:**
```
Sample Trade:
  usdc_amount: 2724268099.9999995
  token_amount: 6619000000
  
Actual Values:
  USDC: $2,724.27
  Tokens: 6,619 shares
```

**Fix Applied:**
```sql
sum(t.usdc_amount / 1000000.0)  -- Convert micro-USDC to dollars
sum(t.token_amount / 1000000.0) -- Convert micro-shares to shares
```

---

## Wallet Summary

### Overall Metrics
- **Resolved Markets:** 115
- **Unresolved Markets:** 0
- **Total Resolved PnL:** -$18,362.49
- **Total Markets Traded:** 115

### Top 10 Profitable Resolved Markets
1. Below $4.50 May (eggs): **$26,187.88** (49 trades)
2. Ethereum $6,000 by Dec 31: **$18,448.12** (34 trades)
3. Eggs $3.25-3.50 July: **$9,671.77** (47 trades)
4. Eggs $3.25-3.50 August: **$6,946.99** (47 trades)
5. Fed 50+ bps rate cut: **$6,384.06** (30 trades)
6. Ethereum $5,000 by Dec 31: **$5,914.81** (8 trades)
7. 10-year Treasury 5.7% in 2025: **$4,124.33** (18 trades)
8. Trump Gold Cards 100k+: **$3,498.43** (14 trades)
9. 10-year Treasury 4.8% in 2025: **$2,997.67** (7 trades)
10. US confirms aliens in 2025: **$2,789.67** (1 trade)

---

## Known Discrepancy Analysis

### 1. Below $4.50 May (eggs)
- **UI Expected:** $41,289.47
- **Our Calculated:** $26,560.58 (includes two markets)
- **Gap:** $14,728.89 (35.7% short)
- **Flag:** `PARTIAL_TRADES`
- **Status:** ✅ Found but incomplete

**Breakdown:**
- Main market: $26,187.88 (49 trades)
- Related market ($4.50-4.75): $372.70 (3 trades)

**Analysis:**
Either we're missing 35.7% of the trades OR the UI is using a different calculation methodology.

**Per-Outcome Detail (Main Market):**
- Outcome 0 (No): 7 trades, -1,263.73 shares, $964.05 cash → $0 value (lost)
- Outcome 1 (Yes): 42 trades, +32,937.37 shares, -$7,713.54 cash → $32,937.37 value (won)
- **Net PnL:** -$6,749.49 (cash) + $32,937.37 (value) = $26,187.88

---

### 2. More than $6 March (eggs)
- **UI Expected:** $25,528.83
- **Our Calculated:** $0.00
- **Gap:** $25,528.83 (100% missing)
- **Flag:** `MISSING_TRADES`
- **Status:** ❌ Market does NOT exist in database

**Investigation:**
Searched for markets with "March" and "$6" or "six" - **0 results** for egg wallet, **0 results** for all wallets.

**Conclusion:** This market is NOT in our database at all.

---

### 3. $3.25-3.50 August (eggs)
- **UI Expected:** $5,925.46
- **Our Calculated:** $6,946.99 ✅
- **Gap:** +$1,021.53 (17% OVER)
- **Flag:** `OVER_REPORTED` (we found MORE than expected)
- **Status:** ✅ Found

**Wait, this contradicts our earlier search!**

Re-checking search terms: The script searched for ALL THREE terms: `$3.25` AND `$3.50` AND `August` AND `egg`.

The market we found is: "Will a dozen eggs be between $3.25-3.50 in August?"

**Resolution:** The market EXISTS and shows HIGHER PnL than UI. This is GOOD data.

---

### 4. $3.25-3.50 July (eggs)
- **UI Expected:** $5,637.10
- **Our Calculated:** $9,671.77 ✅
- **Gap:** +$4,034.67 (71% OVER)
- **Flag:** `OVER_REPORTED` (we found MORE than expected)
- **Status:** ✅ Found

**Market:** "Will a dozen eggs be between $3.25-3.50 in July?" (47 trades)

**Resolution:** Same as August - we found MORE PnL than UI expects.

---

## Summary of Discrepancies

| Market | UI PnL | Our PnL | Gap | Status |
|--------|--------|---------|-----|--------|
| Below $4.50 May | $41,289.47 | $26,560.58 | -$14,728.89 (-35.7%) | PARTIAL |
| More than $6 March | $25,528.83 | $0.00 | -$25,528.83 (-100%) | MISSING |
| $3.25-3.50 August | $5,925.46 | $6,946.99 | +$1,021.53 (+17%) | OVER |
| $3.25-3.50 July | $5,637.10 | $9,671.77 | +$4,034.67 (+72%) | OVER |
| **TOTALS** | **$78,380.86** | **$43,179.34** | **-$35,201.52** | **-45%** |

---

## Root Cause Hypotheses

### Why is overall PnL NEGATIVE when UI shows ~$96k positive?

**Hypothesis 1: Missing Data**
- We're missing the "$6 March" market entirely ($25k impact)
- We're missing 35% of "Below $4.50 May" trades ($15k impact)
- Combined: $40k missing
- But this doesn't explain the NEGATIVE total

**Hypothesis 2: Losing Positions Counted Differently**
- UI may only show "realized wins" (markets where user profited)
- Our calculation includes ALL resolved markets (wins AND losses)
- We show -$18k total, meaning egg has MORE losses than wins overall

**Hypothesis 3: Different Resolution Methodology**
- UI might use different payout_numerators
- UI might handle unrealized positions differently
- UI might exclude certain market types

**Hypothesis 4: Data Source Mismatch**
- UI might use Polymarket API data directly
- We use `pm_trader_events_v2` which comes from CLOB fills
- These could be different data sources with different coverage

---

## Data Quality Flags

- **PARTIAL_TRADES:** 1 market (Below $4.50 May)
- **MISSING_TRADES:** 1 market (More than $6 March)
- **OVER_REPORTED:** 2 markets (July and August eggs)
- **MATCH:** 0 markets

---

## Next Steps

### Immediate Actions
1. **Investigate negative PnL:** Query for egg's biggest LOSING markets to understand why total is negative
2. **Find "More than $6 March":** Search Polymarket UI/API to get the exact market name and condition_id
3. **Validate payout_numerators:** Check if resolution prices match between our DB and Polymarket API
4. **Compare data sources:** Pull egg wallet data from Polymarket API directly and compare

### Medium Term
1. **Format Consistency Audit:** Verify all identifier formats, side attribution, outcome conventions
2. **Deduplication Check:** Ensure no double-counting of trades
3. **Unrealized Positions:** Check if egg has open positions that UI counts differently

### Long Term
1. **Build UI Parity Test Suite:** Automated comparison against Polymarket UI for known wallets
2. **Data Pipeline Validation:** Ensure pm_trader_events_v2 has complete coverage
3. **Resolution Price Validation:** Automated checks against Polymarket's resolution data

---

## Technical Notes

### Query Used
```sql
WITH per_outcome AS (
    SELECT
        m.condition_id,
        m.question,
        m.outcome_index,
        sum(CASE WHEN lower(t.side) = 'buy'
                 THEN -(t.usdc_amount / 1000000.0)
                 ELSE +(t.usdc_amount / 1000000.0) END) as cash_delta,
        sum(CASE WHEN lower(t.side) = 'buy'
                 THEN +(t.token_amount / 1000000.0)
                 ELSE -(t.token_amount / 1000000.0) END) as final_shares,
        count(*) as trade_count
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    GROUP BY m.condition_id, m.question, m.outcome_index
),
with_resolution AS (
    SELECT
        p.*,
        CASE
            WHEN r.condition_id IS NOT NULL AND r.payout_numerators != ''
            THEN toFloat64OrZero(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[p.outcome_index + 1])
            ELSE 0
        END as resolved_price
    FROM per_outcome p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
)
SELECT
    condition_id,
    sum(cash_delta) + sum(final_shares * resolved_price) as realized_pnl
FROM with_resolution
GROUP BY condition_id
```

### Tables Used
- `pm_trader_events_v2`: Trade data (CLOB fills)
- `pm_token_to_condition_map_v3`: Token ID → Market mapping
- `pm_condition_resolutions`: Resolution outcomes

---

**Report Generated:** 2025-11-24  
**Script:** `/Users/scotty/Projects/Cascadian-app/scripts/pnl-step-b-egg-wallet-reconciliation.ts`
