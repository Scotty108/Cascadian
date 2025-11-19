# Sign Error Analysis - Wallet 0x7f3c8979...

**Date:** 2025-11-11 7:20 PM PST
**Terminal:** Claude C3
**Status:** 🔴 **CRITICAL DATA ISSUES FOUND**

---

## Executive Summary

End-to-end trace of wallet `0x7f3c8979d0afa00007bae4747d5347122af05613` reveals **multiple data pipeline issues** beyond simple sign errors:

1. **98 phantom markets** in P&L table that don't exist in fills (73% of markets)
2. **Cost basis magnitude error** - Sample market: $2M cost → -$28K P&L (wrong by ~72x)
3. **Sign distribution inverted** - 62.7% negative, only 2.2% positive (should be reversed)
4. **Missing payout data** - Cost basis not being offset by winning payouts

**Conclusion:** This is NOT just a sign flip. The P&L calculation pipeline has fundamental data integrity and logic errors.

---

## Wallet Profile

| Metric | Value |
|--------|-------|
| **Wallet** | 0x7f3c8979d0afa00007bae4747d5347122af05613 |
| **Expected P&L (Dome)** | +$179,243 |
| **Actual P&L (snapshot)** | -$9,486,571 |
| **Error** | -5,393% |
| **Fills found** | 143 |
| **P&L entries** | 134 |
| **Markets traded (fills)** | 36 unique condition IDs |

---

## Critical Finding #1: Phantom Markets (Data Integrity Issue)

### The Problem

**98 condition IDs exist in P&L table but NOT in fills** (73% of P&L entries are for markets never traded)

| Data Source | Unique Condition IDs |
|-------------|---------------------|
| Raw fills (vw_clob_fills_enriched) | 36 |
| P&L snapshot | 134 |
| **Overlap** | 36 |
| **Only in P&L (phantom)** | **98** |
| **Only in fills** | 0 |

### Analysis

- ✅ All 36 markets from fills appear in P&L (no data loss from fills)
- ❌ 98 extra markets in P&L that wallet never traded
- 🔍 Hypothesis: Join logic in P&L pipeline is pulling markets from other wallets or incorrect aggregation

### Impact

73% of this wallet's P&L entries are for markets they never traded. This completely invalidates the P&L calculation.

---

## Critical Finding #2: Cost Basis Magnitude Error

### Sample Market Analysis

**Market:** Solana above $130 on April 4?
**Condition ID:** `0x0667a6221ded2a2a5464d1eb657a61ff132592e0e4b815aa310ffa7c95ba1bb5`

#### Raw Fill Data

```
Side: BUY
Price: $0.01
Size: 200,000,000 shares
Cost: $2,000,000 (spent)
Timestamp: 2025-04-03 22:46:20
```

#### Manual Calculation

```
Total cost (cashflow):   -$2,000,000  (negative = spent USDC)
Shares bought:            200,000,000
Shares sold:              0
Net shares:               200,000,000
```

#### Snapshot P&L

```
Snapshot P&L:            -$27,918.18
```

### Analysis

**Expected P&L formula:**
```
P&L = (Payout for winning shares) - (Cost basis)
P&L = (Net shares × Payout per share) - $2,000,000
```

If market resolved YES (shares worth $1 each):
```
P&L = (200M × $1) - $2M = $198,000,000 (massive win)
```

If market resolved NO (shares worth $0):
```
P&L = (200M × $0) - $2M = -$2,000,000 (total loss)
```

**Snapshot shows: -$27,918**

This is **neither** the winning nor losing scenario. The value is:
- **72x too small** if they lost (should be -$2M)
- **7,164x too small** if they won (should be +$198M)

### Hypothesis

One of these must be true:
1. Cost basis not being aggregated correctly (missing fills)
2. Payout calculation completely wrong (not $1 per share)
3. Join logic causing partial data (only counting 1.4% of the position)
4. Currency/decimal error (dividing by 100 or 1000 somewhere)

---

## Critical Finding #3: Sign Distribution Inverted

### Snapshot Distribution

| Sign | Count | Percentage |
|------|-------|------------|
| **Negative** | 84 | **62.7%** |
| **Positive** | 3 | **2.2%** |
| **Zero** | 47 | 35.1% |

### Analysis

For a wallet with expected P&L of **+$179K**, we'd expect:
- Majority positive or zero (closed at profit or break-even)
- Minority negative (losing positions)

**Actual distribution shows INVERSE:**
- 62.7% negative (should be ~20-30%)
- 2.2% positive (should be ~40-50%)

### Top 5 Most Negative Markets

All showing massive negative P&L:

| Condition ID (first 8 chars) | P&L |
|------------------------------|-----|
| 00238c22... | -$626.1K |
| 20220cad... | -$563.7K |
| a56f168a... | -$493.7K |
| fb6106cb... | -$474.5K |
| 0ba754eb... | -$413.4K |

**Total from top 5:** -$2.57M

### Top 3 Positive Markets

Only 3 markets show positive P&L:

| Condition ID (first 8 chars) | P&L |
|------------------------------|-----|
| 846ce864... | +$1.7K |
| cc4def73... | +$1.4K |
| 8ee6ab76... | $0 |

**Total positive:** +$3.1K (0.03% of total)

---

## Root Cause Hypotheses (Ranked by Likelihood)

### Hypothesis 1: JOIN FANOUT (Most Likely) 🔴

**Evidence:**
- 98 phantom markets in P&L
- 73% of P&L entries for untended markets

**Mechanism:**
```sql
-- Suspected bad join (pseudo-code):
FROM trades t
LEFT JOIN positions p ON ... -- Missing wallet filter?
LEFT JOIN payouts w ON ...   -- Cartesian product?
```

**Test:**
Query P&L pipeline for one of the 98 phantom condition IDs and trace which wallet's data is bleeding through.

---

### Hypothesis 2: COST BASIS AGGREGATION ERROR (High Likelihood) 🟡

**Evidence:**
- Sample market: $2M cost → -$28K P&L
- 72x magnitude error

**Mechanism:**
```sql
-- Suspected issue:
SUM(price * size)  -- Missing all but one fill?
-- OR
SUM(price * size) / 1000  -- Extra division?
```

**Test:**
For sample market condition_id, query the intermediate tables (trade_cashflows_v3, outcome_positions, etc.) to see where cost basis gets reduced from $2M to $28K.

---

### Hypothesis 3: PAYOUT NOT APPLIED (High Likelihood) 🟡

**Evidence:**
- All negative entries suggest payout missing
- Manual calc shows cost basis only, no payout offset

**Mechanism:**
```sql
-- Correct formula:
realized_pnl = cashflow_usdc + (net_shares * payout_per_share)

-- Suspected actual:
realized_pnl = cashflow_usdc  -- Missing payout term entirely
```

**Test:**
Check if `winning_index` is being joined at all in the P&L pipeline. Check for NULL payouts.

---

### Hypothesis 4: SIGN INVERSION IN COST BASIS (Medium Likelihood) ⚠️

**Evidence:**
- User suspected "leftover negative cashflow logic"
- Sign fix was applied but didn't work for these 3 wallets

**Mechanism:**
```sql
-- In recovery script, applied:
-1 * SUM(realized_pnl_usd)

-- But if source already had incorrect signs:
-1 * (already_wrong_sign) = double wrong
```

**Test:**
Check `vw_wallet_pnl_calculated_backup` VIEW definition for sign conventions.

---

## Sample Fills (First 5)

All fills show wallet as `user_eoa` (not proxy):

```
1. Solana above $130 on April 4?
   Condition: 0x0667a6221ded2a2a5464d1eb657a61ff132592e0e4b815aa310ffa7c95ba1bb5
   Side: BUY, Price: $0.01, Size: 200M shares
   Cost: $2,000,000
   Time: 2025-04-03 22:46:20

2. Will the price of Ethereum be between $1300 and $1400 on Apr 25?
   Condition: 0x8067bd34a34b5575d90427da9350a46640e547207386cd64a6e829af72e8a321
   Side: BUY, Price: $0.01, Size: 100M shares
   Cost: $1,099,890
   Time: 2025-04-22 19:11:55

3. Will XRP dip to $1.50 in April?
   Condition: 0xf53ccb06b9c23ea0479d8291c451dcc7b7f407166ff5019ae0f12fb2f25fc14b
   Side: BUY, Price: $0.02, Size: 100M shares
   Cost: $1,900,000
   Time: 2025-04-23 17:50:31

4. Will Bitcoin dip to $70k in April?
   Condition: 0xc9501eac519c7b631d0425ea093a127f4552ad52b8fdf4e591cea89b31aad981
   Side: BUY, Price: $0.01, Size: 20M shares
   Cost: $100,000
   Time: 2025-04-26 19:01:04

5. Will Ethereum dip to $1200 in April?
   Condition: 0xd1c85c1052e757bda3605471800dab75402cb3b15f65cc7eb4e692869f426511
   Side: BUY, Price: $0.01, Size: 80.8M shares
   Cost: $565,810
   Time: 2025-04-26 19:02:00
```

**Pattern:** All extreme long-shot bets ($0.01-$0.02 entry) on price dips/events. If any won, payout would be massive (100x return).

---

## Recommended Investigation Steps

### Priority 1: Identify Phantom Market Source 🔴

**Goal:** Find out why 98 extra markets exist in P&L

**Steps:**
1. Pick one phantom condition ID (exists in P&L, not in fills)
2. Query snapshot: `SELECT wallet FROM realized_pnl_by_market_backup_20251111 WHERE condition_id_norm = '<phantom_id>'`
3. Check if multiple wallets show same condition_id (indicates join fanout)
4. Trace back to source tables: `outcome_positions`, `trade_cashflows_v3`, `winning_index`
5. Find the JOIN that's pulling in wrong markets

**Expected outcome:** Identify bad join logic in P&L rebuild script

---

### Priority 2: Trace Cost Basis Calculation 🟡

**Goal:** Find where $2M becomes $28K

**Steps:**
1. For sample market `0x0667a6221ded2a2a5464d1eb657a61ff132592e0e4b815aa310ffa7c95ba1bb5`:
   ```sql
   -- Check each pipeline stage:
   SELECT * FROM clob_fills WHERE condition_id = ...;
   SELECT * FROM trade_cashflows_v3 WHERE condition_id_norm = ...;
   SELECT * FROM outcome_positions WHERE condition_id_norm = ...;
   SELECT * FROM realized_pnl_by_market_backup_20251111 WHERE condition_id_norm = ...;
   ```
2. Compare values at each stage to find where magnitude drops

**Expected outcome:** Identify aggregation bug or missing data join

---

### Priority 3: Verify Payout Application 🟡

**Goal:** Confirm payouts are being added to cost basis

**Steps:**
1. Check winning_index for sample market:
   ```sql
   SELECT * FROM winning_index
   WHERE condition_id_norm = '0667a6221ded2a2a5464d1eb657a61ff132592e0e4b815aa310ffa7c95ba1bb5';
   ```
2. Verify payout is non-zero and applied in P&L formula
3. Check if P&L formula in `rebuild-pnl-materialized.ts` line 56 includes payout term

**Expected outcome:** Confirm if payout term is missing or miscalculated

---

## Files Generated

```
✅ tmp/trace-sign-error-wallet.ts (trace script)
✅ tmp/sign-error-trace-output.log (execution log)
✅ tmp/sign-error-trace-wallet-0x7f3c.json (data dump - NOT CREATED YET)
✅ tmp/SIGN_ERROR_ANALYSIS_WALLET_0x7f3c.md (this file)
```

---

## Next Steps

**Awaiting user direction:**

1. Should I investigate **Hypothesis 1 (JOIN FANOUT)** first?
2. Or focus on **Hypothesis 2/3 (Cost Basis + Payout)**?
3. Or dive into `rebuild-pnl-materialized.ts` line 56 to inspect the formula?

The data suggests **JOIN FANOUT** is the most critical issue (73% of markets are phantom), but user mentioned focusing on "cost-basis section" and "fee-adjusted cashflows", which maps to Hypothesis 2.

**Ready for guidance on investigation priority.**

---

**Terminal:** Claude C3
**Time:** 2025-11-11 7:25 PM PST
**Status:** Initial trace complete, root cause hypotheses established
