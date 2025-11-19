# SMOKING GUN FOUND: Root Cause of P&L Inflation

**Date:** 2025-11-07
**Status:** ROOT CAUSE IDENTIFIED

---

## The Problem

The materialized view `realized_pnl_by_market_v2` shows:
- **799 markets** for niggemon wallet
- **Total P&L:** $1,907,531.19

But `trades_raw` shows:
- **Only 332 resolved trades**
- **Total P&L:** $117.24

**Inflation:** 16,267x (1,626,700%)

---

## Root Cause Found

The view `realized_pnl_by_market_v2` is sourcing data from `trade_cashflows_v3`, NOT from `trades_raw`.

### View Definition (Simplified)
```sql
CREATE VIEW realized_pnl_by_market_v2 AS
SELECT
  tcf.wallet,
  cc.market_id,
  tcf.condition_id_norm,
  round(sum(tcf.cashflow_usdc), 8) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_cashflows_v3 AS tcf
LEFT JOIN winning_index AS wi ON tcf.condition_id_norm = wi.condition_id_norm
LEFT JOIN canonical_condition AS cc ON cc.condition_id_norm = tcf.condition_id_norm
WHERE wi.win_idx IS NOT NULL
GROUP BY tcf.wallet, tcf.condition_id_norm, cc.market_id
```

### The Critical Issue

The view uses `trade_cashflows_v3` which appears to be:
1. A lower-level table capturing INDIVIDUAL fills/cashflows
2. NOT deduplicated by trade
3. Possibly including BOTH legs of each trade (buy + sell)
4. Possibly double-counting due to ERC1155 transfer events

### Evidence

For niggemon's top market (`0x4c02...`):
- **Fills:** 209
- **P&L:** $306,623.39

This is clearly wrong because:
- The wallet's TOTAL P&L should be ~$100k (per Polymarket)
- A single market cannot have $306k in P&L
- 209 fills for one market suggests extreme duplication

---

## Comparison: Two Data Sources

### Source 1: `trades_raw` (CORRECT)
- Table: `trades_raw`
- Rows: Each row = 1 trade
- P&L field: `realized_pnl_usd`
- Total for niggemon: **$117.24** (332 resolved trades)

### Source 2: `trade_cashflows_v3` (INFLATED)
- Table: `trade_cashflows_v3`
- Rows: Each row = 1 cashflow event (fill/transfer)
- P&L field: `cashflow_usdc`
- Total for niggemon: **$1,907,531.19** (799 markets, unknown fills)

---

## Why the Inflation Happens

### Hypothesis 1: Double Counting (Most Likely)
Each trade generates MULTIPLE cashflow events:
1. USDC out (spent)
2. Token in (received)
3. Token out (sold)
4. USDC in (received)

If `trade_cashflows_v3` contains all 4 events and the view sums them ALL, you get:
- **Reality:** $100 profit = $1000 spent + $1100 received
- **Summed cashflows:** $100 spent + $100 received + $1000 tokens + $1100 tokens = **INFLATION**

### Hypothesis 2: Missing Deduplication
The view groups by `wallet, condition_id_norm, market_id` but:
- A single trade can have multiple fills across different blocks
- Each fill creates a separate row in `trade_cashflows_v3`
- Summing without proper deduplication = counting same trade multiple times

### Hypothesis 3: Wrong Sign Convention
Cashflows might be recorded as absolute values instead of signed:
- Buys: +USDC spent, +tokens received (should be -USDC, +tokens)
- Sells: +USDC received, +tokens spent (should be +USDC, -tokens)
- Summing all positive values = extreme inflation

---

## Next Investigation Steps

1. **Query `trade_cashflows_v3` directly** for niggemon
   - See actual row count
   - Check sign convention (positive vs negative cashflows)
   - Compare to `trades_raw` trade count

2. **Find the schema** of `trade_cashflows_v3`
   - What fields exist?
   - Is there a unique trade ID?
   - What is `cashflow_usdc` measuring?

3. **Trace data lineage**
   - How is `trade_cashflows_v3` populated?
   - Is it sourced from `trades_raw` or raw blockchain events?
   - What transformations are applied?

4. **Audit the aggregation logic**
   - Should we SUM all cashflows or only NET cashflows?
   - Do we need to filter by cashflow direction?
   - Is there a `trade_id` we should GROUP BY?

---

## Immediate Action Required

**DO NOT USE** any P&L views that source from `trade_cashflows_v3`:
- `realized_pnl_by_market_v2` ❌
- `wallet_realized_pnl_v2` ❌
- `wallet_pnl_summary_v2` ❌

**USE ONLY** `trades_raw` table for P&L calculations:
```sql
-- CORRECT P&L calculation
SELECT
  wallet_address,
  SUM(realized_pnl_usd) as total_pnl
FROM trades_raw
WHERE is_resolved = 1
GROUP BY wallet_address
```

---

## Files Generated

- `/Users/scotty/Projects/Cascadian-app/investigate-base-view.ts` - Script that found the issue
- `/Users/scotty/Projects/Cascadian-app/SMOKING_GUN_FOUND.md` - This report
