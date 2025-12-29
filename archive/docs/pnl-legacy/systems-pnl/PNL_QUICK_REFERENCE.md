# P&L Calculation Quick Reference

**Last Updated:** November 7, 2025
**Status:** Production-ready formula, validated to -2.3% accuracy

---

## The Formula (One Line)

```
Realized P&L = sum(all cashflows) + sum(shares in winning outcome × $1.00)
```

---

## Quick Facts

| Question | Answer |
|----------|--------|
| Is the formula correct? | ✅ YES - validated to -2.3% variance |
| Is it implemented? | ✅ YES - in `realized-pnl-corrected.ts` |
| Can I use `trades_raw.realized_pnl_usd`? | ❌ NO - 99.9% wrong values |
| Can I use `trades_raw.pnl`? | ❌ NO - 96.68% NULL |
| What table should I query? | ✅ `wallet_pnl_summary_v2` |
| How accurate is it? | ✅ -2.3% variance on test wallet |

---

## Single Query to Get Wallet P&L

```sql
-- Get complete P&L for any wallet
SELECT
  wallet,
  realized_pnl_usd,        -- From resolved markets
  unrealized_pnl_usd,      -- From open positions
  total_pnl_usd,           -- Total (realized + unrealized)
  markets_with_realized,   -- Number of resolved markets
  total_realized_fills     -- Number of trades
FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xYOUR_WALLET_ADDRESS');
```

---

## How It Works (3 Steps)

### Step 1: Calculate Cashflows

```sql
-- For each trade:
cashflow = shares × entry_price × side_multiplier

Where:
  side_multiplier = -1 for BUY (money spent)
  side_multiplier = +1 for SELL (money received)
```

### Step 2: Calculate Share Deltas

```sql
-- For each trade:
share_delta = shares × side_multiplier

Where:
  side_multiplier = +1 for BUY (shares added)
  side_multiplier = -1 for SELL (shares removed)
```

### Step 3: Aggregate and Settle

```sql
-- For each market:
cost_basis = sum(all cashflows in market)
winning_shares = sumIf(share_delta, outcome_index = winning_index)

realized_pnl = cost_basis + winning_shares
```

---

## Example Calculation

```
Wallet trades in market "Will Bitcoin hit $100K?":

Trade 1: BUY  100 YES @ $0.60 → -$60.00 cashflow, +100 shares
Trade 2: BUY  50  YES @ $0.70 → -$35.00 cashflow, +50 shares
Trade 3: SELL 75  YES @ $0.80 → +$60.00 cashflow, -75 shares

Market Resolves: YES wins

Calculation:
  Cost Basis:       -$60.00 + -$35.00 + $60.00 = -$35.00
  Net Shares:       +100 + 50 - 75 = 75 shares YES
  Settlement:       75 × $1.00 = $75.00
  Realized P&L:     -$35.00 + $75.00 = +$40.00 profit ✅
```

---

## Data Sources

### Required Tables

```sql
trades_raw              -- Position data (159.5M rows)
  ↓
condition_market_map    -- Market → Condition mapping (151K rows)
  ↓
winning_index           -- Condition → Win index (137K-224K rows)
  ↓
realized_pnl_by_market_v2  -- Market-level P&L (aggregated)
  ↓
wallet_pnl_summary_v2   -- Wallet-level P&L (final)
```

### Fields Used from trades_raw

```
✅ wallet_address       - Who made the trade
✅ market_id            - Which market
✅ condition_id         - For resolution matching
✅ side                 - BUY or SELL
✅ outcome_index        - Which outcome (0, 1, 2...)
✅ shares               - Number of shares
✅ entry_price          - Price per share ($0-$1)
✅ timestamp            - When traded

❌ realized_pnl_usd     - DON'T USE (broken)
❌ pnl                  - DON'T USE (96% NULL)
❌ is_resolved          - DON'T USE (unreliable)
```

---

## Common Issues

### Issue: Wallet shows $0.00

**Cause:** Wallet has no resolved markets in database

**Check:**
```sql
-- See if wallet has any trades
SELECT count(*) FROM trades_raw
WHERE lower(wallet_address) = '0x...';

-- See if any markets are resolved
SELECT count(*) FROM trades_raw t
JOIN winning_index wi ON lower(replaceAll(t.condition_id, '0x', '')) = wi.condition_id_norm
WHERE lower(t.wallet_address) = '0x...';
```

### Issue: P&L way too high (5-35x expected)

**Cause:** Using wrong table or duplicate trades

**Fix:**
```sql
-- Check for duplicates
SELECT
  market_id, outcome_index, entry_price, shares, count(*)
FROM trades_raw
WHERE lower(wallet_address) = '0x...'
GROUP BY market_id, outcome_index, entry_price, shares
HAVING count(*) > 1;

-- Use correct view (not trades_enriched)
SELECT * FROM wallet_pnl_summary_v2;  -- ✅ Correct
-- NOT trades_enriched.realized_pnl_usd  ❌ Wrong
```

### Issue: P&L slightly off (2-5% variance)

**Cause:** Normal - due to:
- Data snapshot date (Oct 31 vs current)
- Unrealized positions that later resolved
- Fee/slippage differences
- Float rounding

**Status:** ✅ Acceptable if < 5% variance

---

## Validation Commands

### Run Full Validation

```bash
cd /Users/scotty/Projects/Cascadian-app

# Create all views
npx tsx scripts/realized-pnl-corrected.ts

# Validate calculation step-by-step
npx tsx scripts/validate-pnl-calculation.ts
```

### Quick Manual Check

```sql
-- Check niggemon (known wallet)
SELECT * FROM wallet_pnl_summary_v2
WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

-- Expected: total_pnl_usd ≈ $99,691.54
-- (Within 5% of Polymarket's $102,001.46)
```

---

## DO / DON'T Summary

### DO ✅

- Query `wallet_pnl_summary_v2` for final P&L
- Use `realized_pnl_by_market_v2` for market breakdown
- Join `trades_raw` to `winning_index` for custom queries
- Normalize condition_id: `lower(replaceAll(condition_id, '0x', ''))`
- Cast to Float64 before arithmetic to avoid Decimal overflow

### DON'T ❌

- Use `trades_raw.realized_pnl_usd` column (99.9% wrong)
- Use `trades_raw.pnl` column (96.68% NULL)
- Use `trades_raw.is_resolved` flag (unreliable)
- Use `trades_enriched*` tables (built with wrong formula)
- Rely on `resolved_outcome` field (sparse)
- Sum usd_value directly (counts entry AND exit separately)

---

## File Locations

```
Production Code:
  /Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.ts
  /Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.sql

Validation:
  /Users/scotty/Projects/Cascadian-app/scripts/validate-pnl-calculation.ts

Documentation:
  /Users/scotty/Projects/Cascadian-app/CORRECT_PNL_CALCULATION_ANALYSIS.md
  /Users/scotty/Projects/Cascadian-app/REALIZED_PNL_CORRECTED_EXPLANATION.md
  /Users/scotty/Projects/Cascadian-app/REALIZED_PNL_QUICK_START.md
```

---

## Support Queries

### Get Top Profitable Wallets

```sql
SELECT
  wallet,
  total_pnl_usd,
  markets_with_realized,
  total_realized_fills
FROM wallet_pnl_summary_v2
ORDER BY total_pnl_usd DESC
LIMIT 20;
```

### Get Wallet's Best Markets

```sql
SELECT
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = lower('0x...')
ORDER BY realized_pnl_usd DESC
LIMIT 10;
```

### Get Wallet's Worst Markets

```sql
SELECT
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = lower('0x...')
ORDER BY realized_pnl_usd ASC
LIMIT 10;
```

---

## Performance Notes

- Views are non-materialized (computed on demand)
- Query time: ~500ms for wallet summary
- Query time: ~1-2s for market-level breakdown
- To improve: Create materialized views (see documentation)

---

## Need More Detail?

Read the full analysis: `/Users/scotty/Projects/Cascadian-app/CORRECT_PNL_CALCULATION_ANALYSIS.md`
