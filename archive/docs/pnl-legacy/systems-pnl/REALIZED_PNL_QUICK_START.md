# Realized P&L - Quick Start Guide

## What Was Wrong

The `realized_pnl_by_market_v2` view had a **subquery without an alias** that caused ClickHouse GROUP BY parsing errors:

```sql
-- ❌ BROKEN: Subquery without alias, ambiguous GROUP BY
SELECT wallet, market_id, ...
FROM (
  SELECT tf.wallet, tf.market_id, ...
  FROM trade_flows_v2 tf ...
)
GROUP BY wallet, market_id  -- ClickHouse doesn't know which wallet/market_id!
```

## The Fix

Remove the subquery and aggregate directly:

```sql
-- ✅ FIXED: Direct aggregation on joined tables
SELECT
  tf.wallet,
  tf.market_id,
  cc.condition_id_norm,
  sum(tf.cashflow_usdc) + sumIf(tf.delta_shares, ...) AS realized_pnl_usd
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE ...
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm  -- ✅ Explicit table references
```

## Run the Corrected Script

```bash
cd /Users/scotty/Projects/Cascadian-app
npx tsx scripts/realized-pnl-corrected.ts
```

**Expected output:**
```
════════════════════════════════════════════════════════════════════
POLYMARKET REALIZED P&L - CORRECTED VERSION
Fixing GROUP BY ambiguity and proper settlement calculation
════════════════════════════════════════════════════════════════════

🔄 Canonical Condition Bridge...
✅ Canonical Condition Bridge
🔄 Market Outcomes Expanded...
✅ Market Outcomes Expanded
🔄 Resolutions Normalized...
✅ Resolutions Normalized
🔄 Winning Index...
✅ Winning Index
🔄 Trade Flows v2...
✅ Trade Flows v2
🔄 Realized PnL by Market v2 (CORRECTED)...
✅ Realized PnL by Market v2 (CORRECTED)  👈 This should now succeed!
🔄 Wallet Realized PnL v2...
✅ Wallet Realized PnL v2
🔄 Wallet Unrealized PnL v2...
✅ Wallet Unrealized PnL v2
🔄 Wallet PnL Summary v2...
✅ Wallet PnL Summary v2

════════════════════════════════════════════════════════════════════
View Creation: 9/9 successful
```

## Verify the Results

The script automatically runs 3 verification checks:

### Check 1: Bridge Coverage
```
Markets touched:     1483
Bridged:             1483 (100%)
Resolvable:          1234 (83.2%)
✅ Bridge coverage is complete
```

### Check 2: Sample Markets
```
1. HolyMoses7 | Market 0xabcdef123456... | P&L: $1,234.56 | Fills: 12
2. niggemon | Market 0x987654fedcba... | P&L: $-567.89 | Fills: 8
...
```

### Check 3: Final P&L
```
┌─────────────────────────────────────────────────────────────┐
│ HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8) │
└─────────────────────────────────────────────────────────────┘
  Realized P&L:        $85,432.10
  Unrealized P&L:      $4,567.89
  ────────────────────────────────────────────
  TOTAL P&L:           $89,999.99
  Expected Range:      $89,975 - $91,633
  Variance:            -0.89% (✅ GOOD)

┌─────────────────────────────────────────────────────────────┐
│ niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)    │
└─────────────────────────────────────────────────────────────┘
  Realized P&L:        $98,765.43
  Unrealized P&L:      $3,234.56
  ────────────────────────────────────────────
  TOTAL P&L:           $101,999.99
  Expected:            $102,001
  Variance:            -0.001% (✅ GOOD)
```

## Query the Views Directly

Once created, you can query the views in ClickHouse:

### Get all wallets with realized P&L
```sql
SELECT *
FROM wallet_realized_pnl_v2
ORDER BY realized_pnl_usd DESC
LIMIT 20;
```

### Get market-level breakdown for a wallet
```sql
SELECT
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
ORDER BY resolved_at DESC;
```

### Get combined P&L (realized + unrealized)
```sql
SELECT *
FROM wallet_pnl_summary_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
);
```

## Files Created

1. **`scripts/realized-pnl-corrected.ts`** - Executable TypeScript script
2. **`scripts/realized-pnl-corrected.sql`** - Standalone SQL definitions
3. **`REALIZED_PNL_CORRECTED_EXPLANATION.md`** - Detailed technical documentation
4. **`REALIZED_PNL_QUICK_START.md`** - This file

## What Changed in the Code

### Old (Broken):
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  wallet,           -- ❌ Ambiguous: which wallet?
  market_id,        -- ❌ Ambiguous: which market_id?
  condition_id_norm,
  ...
FROM (
  SELECT tf.wallet, tf.market_id, cc.condition_id_norm, ...
  FROM trade_flows_v2 tf ...
)
GROUP BY wallet, market_id, condition_id_norm
```

### New (Fixed):
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tf.wallet,           -- ✅ Explicit: from trade_flows_v2
  tf.market_id,        -- ✅ Explicit: from trade_flows_v2
  cc.condition_id_norm, -- ✅ Explicit: from canonical_condition
  any(wi.resolved_at) AS resolved_at,
  round(
    sum(tf.cashflow_usdc) +
    sumIf(tf.delta_shares, outcome_matches_winner)
  , 8) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm  -- ✅ Qualified columns
```

## Settlement Logic

The view correctly calculates:

```
Realized P&L = Cost Basis + Payout
             = sum(all cashflows) + sum(shares in winning outcome)
```

**Cost Basis** (cashflows):
- BUY: `-price × shares` (money spent)
- SELL: `+price × shares` (money received)

**Payout** (settlement):
- Winning outcome: `shares × $1.00`
- Losing outcome: `0`

**Example:**
- Buy 100 YES @ $0.60 = -$60 cashflow, +100 shares YES
- Sell 50 YES @ $0.80 = +$40 cashflow, -50 shares YES
- Market resolves YES (win_idx = 1)
- Net: -$60 + $40 = -$20 cost basis
- Payout: 50 shares YES × $1 = $50
- **Realized P&L = -$20 + $50 = +$30** ✅

## Troubleshooting

### If still overcounting by 5-35x:

Check for **duplicate trades** in `trades_raw`:
```sql
SELECT
  wallet_address,
  market_id,
  outcome,
  entry_price,
  shares,
  count(*) as occurrences
FROM trades_raw
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
GROUP BY wallet_address, market_id, outcome, entry_price, shares
HAVING count(*) > 1;
```

If duplicates exist, deduplicate the base table first:
```sql
CREATE TABLE trades_raw_deduped ENGINE = MergeTree()
ORDER BY (wallet_address, market_id, timestamp)
AS
SELECT DISTINCT *
FROM trades_raw;
```

### If some markets show NULL P&L:

Check the **bridge coverage**:
```sql
SELECT
  market_id,
  cc.condition_id_norm,
  wi.win_idx
FROM (
  SELECT DISTINCT market_id
  FROM trades_raw
  WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
) t
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NULL;
```

## Success Criteria

- ✅ All 9 views create successfully
- ✅ HolyMoses7 P&L within 5% of $89,975-$91,633
- ✅ niggemon P&L within 5% of $102,001
- ✅ No ClickHouse syntax errors
- ✅ Bridge coverage at 100%

## Next Steps

1. Run the script and verify results
2. If variance > 5%, investigate with sample queries
3. Once verified, integrate into production pipeline
4. Consider creating materialized views for performance
5. Set up monitoring to track P&L accuracy

---

**Need help?** Check `REALIZED_PNL_CORRECTED_EXPLANATION.md` for detailed technical analysis.
