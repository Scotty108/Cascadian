# Realized P&L Calculation - Complete Deliverables

## Summary

Fixed ClickHouse GROUP BY syntax error in `realized_pnl_by_market_v2` view and provided complete implementation with verification and debugging tools.

**Root Cause:** Subquery without alias causing ambiguous column references in GROUP BY clause.

**Solution:** Remove subquery and perform direct aggregation on joined tables with explicit table-qualified column references.

---

## Files Delivered

### 1. Production Scripts

#### `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.ts`
**Purpose:** Main executable TypeScript script to create all P&L views

**What it does:**
- Creates 9 views in correct dependency order
- Runs 3 verification probes automatically
- Shows bridge coverage statistics
- Displays final P&L for target wallets
- Compares against expected values with variance %

**Usage:**
```bash
cd /Users/scotty/Projects/Cascadian-app
npx tsx scripts/realized-pnl-corrected.ts
```

**Expected output:** All 9 views created successfully, P&L within 5% of expected values

---

#### `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.sql`
**Purpose:** Standalone SQL file with all view definitions

**What it includes:**
- All 9 view CREATE statements
- Inline comments explaining each view
- 3 verification queries at the end
- Settlement formula documentation

**Usage:**
```bash
# Copy-paste into ClickHouse console, or:
cat scripts/realized-pnl-corrected.sql | clickhouse-client --host=... --password=...
```

---

#### `/Users/scotty/Projects/Cascadian-app/scripts/debug-realized-pnl.ts`
**Purpose:** Comprehensive debugging toolkit for troubleshooting P&L issues

**What it checks:**
1. Duplicate trades in trades_raw
2. Trade counts per market
3. Outcome index consistency (YES/NO mapping)
4. Bridge coverage gaps
5. Sample cashflow calculation
6. P&L calculation method comparison
7. NULL values in key fields
8. Top 5 most profitable markets
9. Top 5 biggest losses

**Usage:**
```bash
npx tsx scripts/debug-realized-pnl.ts
```

**When to use:** After running main script, if P&L variance > 5% or unexpected results

---

### 2. Documentation

#### `/Users/scotty/Projects/Cascadian-app/REALIZED_PNL_CORRECTED_EXPLANATION.md`
**Purpose:** Detailed technical documentation

**Contents:**
- Root cause analysis
- Complete solution explanation
- View dependency chain diagram
- Settlement formula with examples
- Data quality checks
- Troubleshooting guide
- Next steps recommendations

**Audience:** Database architects, technical leads

---

#### `/Users/scotty/Projects/Cascadian-app/REALIZED_PNL_QUICK_START.md`
**Purpose:** Quick reference guide for immediate use

**Contents:**
- What was wrong (code comparison)
- How to run the script
- Expected output examples
- Sample queries for verification
- Common troubleshooting scenarios
- Success criteria checklist

**Audience:** Developers implementing the fix

---

#### `/Users/scotty/Projects/Cascadian-app/REALIZED_PNL_DELIVERABLES.md`
**Purpose:** This file - index of all deliverables

---

## Views Created

The scripts create these 9 ClickHouse views:

| # | View Name | Purpose |
|---|-----------|---------|
| 1 | `canonical_condition` | Maps market_id → condition_id_norm (100% coverage bridge) |
| 2 | `market_outcomes_expanded` | Expands outcome arrays to index/label pairs |
| 3 | `resolutions_norm` | Normalizes resolution data with uppercase labels |
| 4 | `winning_index` | Maps condition_id_norm → winning outcome index |
| 5 | `trade_flows_v2` | Computes cashflow and share deltas per trade |
| 6 | `realized_pnl_by_market_v2` | **CORRECTED** - Settles P&L per wallet+market |
| 7 | `wallet_realized_pnl_v2` | Aggregates realized P&L per wallet |
| 8 | `wallet_unrealized_pnl_v2` | Aggregates unrealized P&L per wallet |
| 9 | `wallet_pnl_summary_v2` | Combined realized + unrealized summary |

**Dependency flow:**
```
trades_raw → trade_flows_v2 ┐
                             ├→ realized_pnl_by_market_v2 → wallet_realized_pnl_v2 ┐
canonical_condition ─────────┤                                                      ├→ wallet_pnl_summary_v2
winning_index ───────────────┘                                                      │
portfolio_mtm_detailed ────────────────────────────────────→ wallet_unrealized_pnl_v2 ┘
```

---

## Key Technical Changes

### Before (Broken)
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  wallet,        -- ❌ Ambiguous reference
  market_id,     -- ❌ Ambiguous reference
  ...
FROM (
  SELECT tf.wallet, tf.market_id, ...
  FROM trade_flows_v2 tf ...
)               -- ❌ No alias
GROUP BY wallet, market_id, condition_id_norm
```

**Error:** `Unknown expression identifier 'wallet' in scope SELECT ...`

### After (Fixed)
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tf.wallet,           -- ✅ Explicit table reference
  tf.market_id,        -- ✅ Explicit table reference
  cc.condition_id_norm,
  round(
    sum(tf.cashflow_usdc) +
    sumIf(tf.delta_shares, outcome = winner)
  , 8) AS realized_pnl_usd
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm  -- ✅ Qualified columns
```

**Result:** View creates successfully, no syntax errors

---

## Settlement Logic

The corrected view implements the proper settlement formula:

```
Realized P&L = Cost Basis + Payout
```

**Cost Basis** (sum of all cashflows):
- BUY trades: `-price × shares` (money spent, negative cashflow)
- SELL trades: `+price × shares` (money received, positive cashflow)

**Payout** (shares held in winning outcome):
- Winning outcome: `shares × $1.00`
- Losing outcome: `0`

**Example calculation:**

| Action | Outcome | Price | Shares | Cashflow | Position |
|--------|---------|-------|--------|----------|----------|
| BUY    | YES     | 0.60  | 100    | -60.00   | +100 YES |
| BUY    | YES     | 0.70  | 50     | -35.00   | +150 YES |
| SELL   | YES     | 0.80  | 75     | +60.00   | +75 YES  |

If market resolves to **YES**:
```
Cost Basis = -60 + (-35) + 60 = -35
Payout = 75 shares × $1 = 75
Realized P&L = -35 + 75 = +$40 ✅
```

If market resolves to **NO**:
```
Cost Basis = -35
Payout = 0 (held YES, not NO)
Realized P&L = -35 + 0 = -$35 ❌
```

---

## Verification Checklist

After running the main script, verify:

- [ ] All 9 views created successfully (no errors)
- [ ] Bridge coverage at 100% for target wallet markets
- [ ] HolyMoses7 P&L: $89,975 - $91,633 (variance < 5%)
- [ ] niggemon P&L: ~$102,001 (variance < 5%)
- [ ] No duplicate trades detected
- [ ] No NULL values in key fields (outcome_index, price, shares, side)
- [ ] Outcome mapping correct (NO=0, YES=1)
- [ ] Sample market P&L calculations look reasonable

---

## Troubleshooting Guide

### Issue: P&L still overcounted by 5-35x

**Likely cause:** Duplicate trades in `trades_raw`

**Solution:**
```bash
# 1. Run debug script to identify duplicates
npx tsx scripts/debug-realized-pnl.ts

# 2. If duplicates found, deduplicate the table
# (See REALIZED_PNL_CORRECTED_EXPLANATION.md for SQL)
```

---

### Issue: Some markets show NULL P&L

**Likely cause:** Bridge coverage gaps (market_id not mapped to condition_id)

**Solution:**
```bash
# 1. Check which markets are missing
npx tsx scripts/debug-realized-pnl.ts  # See DEBUG 4

# 2. Investigate the bridge sources
# Are markets missing from ctf_token_map AND condition_market_map?
```

---

### Issue: Variance > 10%

**Likely cause:** Wrong outcome index mapping or settlement logic error

**Solution:**
```bash
# 1. Run debug script to check outcome mapping
npx tsx scripts/debug-realized-pnl.ts  # See DEBUG 3

# 2. Verify a sample market manually
# Pick one market, calculate P&L by hand, compare to view output
```

---

## Query Examples

### Get realized P&L for a specific wallet
```sql
SELECT *
FROM wallet_realized_pnl_v2
WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
```

### Get market-level breakdown
```sql
SELECT
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
ORDER BY realized_pnl_usd DESC
LIMIT 20;
```

### Get combined P&L (realized + unrealized)
```sql
SELECT
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
);
```

### Debug: Check trades for a specific market
```sql
SELECT
  toString(side) AS side,
  toString(outcome) AS outcome,
  cast(entry_price AS Float64) AS price,
  cast(shares AS Float64) AS shares,
  round(
    cast(entry_price AS Float64) * cast(shares AS Float64) *
    if(lowerUTF8(toString(side)) = 'buy', -1, 1),
    4
  ) AS cashflow
FROM trades_raw
WHERE lower(market_id) = 'YOUR_MARKET_ID_HERE'
  AND lower(wallet_address) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
ORDER BY timestamp;
```

---

## Performance Considerations

For production use with large datasets:

1. **Add indexes** to trades_raw:
```sql
ALTER TABLE trades_raw
ADD INDEX idx_wallet_market (wallet_address, market_id)
TYPE minmax GRANULARITY 4;
```

2. **Consider materialized views**:
```sql
CREATE MATERIALIZED VIEW realized_pnl_by_market_v2_mat
ENGINE = SummingMergeTree()
ORDER BY (wallet, market_id)
POPULATE AS
SELECT * FROM realized_pnl_by_market_v2;
```

3. **Monitor query performance**:
```sql
-- Check query execution time
SELECT * FROM system.query_log
WHERE query LIKE '%realized_pnl%'
ORDER BY event_time DESC
LIMIT 10;
```

---

## Next Steps

1. **Run the main script** to create all views
2. **Verify results** match expected P&L values
3. **If variance > 5%**, run debug script to investigate
4. **Once verified**, integrate into production pipeline
5. **Set up monitoring** to track P&L accuracy over time
6. **Consider materialized views** for performance optimization
7. **Document any market-specific exceptions** discovered

---

## Success Criteria

This implementation is considered successful when:

- ✅ All 9 views create without syntax errors
- ✅ HolyMoses7 P&L variance < 5% from expected $89,975-$91,633
- ✅ niggemon P&L variance < 5% from expected $102,001
- ✅ Bridge coverage at 100% for target wallet markets
- ✅ No data quality issues (duplicates, NULLs) detected
- ✅ Settlement logic verified with sample calculations
- ✅ Query performance acceptable (<1s for wallet summary)

---

## Support & Documentation

- **Quick Start:** `REALIZED_PNL_QUICK_START.md`
- **Technical Details:** `REALIZED_PNL_CORRECTED_EXPLANATION.md`
- **This Index:** `REALIZED_PNL_DELIVERABLES.md`

For additional help or questions, refer to the inline SQL comments in `realized-pnl-corrected.sql` or run the debug script with specific market IDs to trace calculation logic.

---

**Created:** 2025-11-06
**Database:** ClickHouse Cloud
**Target Wallets:** HolyMoses7 (0xa4b3...), niggemon (0xeb6f...)
**Goal:** Reconcile calculated P&L with Polymarket published all-time P&L data
