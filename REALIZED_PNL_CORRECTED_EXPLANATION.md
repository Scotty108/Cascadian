# Realized P&L Calculation - Corrected Implementation

## Problem Summary

The original `realized_pnl_by_market_v2` view was failing with "Unknown expression identifier" errors in ClickHouse due to incorrect GROUP BY syntax when using a subquery.

## Root Cause

The original query structure was:

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  any(resolved_at) AS resolved_at,
  round(sum(total_cashflow) + sum(winning_shares), 8) AS realized_pnl_usd,
  sum(fill_count) AS fill_count
FROM (
  SELECT
    tf.wallet,
    tf.market_id,
    cc.condition_id_norm,
    wi.resolved_at,
    tf.cashflow_usdc AS total_cashflow,
    if(...) AS winning_shares,
    1 AS fill_count
  FROM trade_flows_v2 tf
  JOIN canonical_condition cc ON cc.market_id = tf.market_id
  LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
  WHERE ...
)
GROUP BY wallet, market_id, condition_id_norm
```

**Issues:**
1. The subquery had no alias (missing `AS subquery_name`)
2. ClickHouse was unable to resolve which `wallet`, `market_id`, and `condition_id_norm` to use in the GROUP BY
3. The intermediate aggregations in the subquery were unnecessary complexity

## Solution

Remove the subquery entirely and perform aggregation directly on the joined tables:

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tf.wallet,
  tf.market_id,
  cc.condition_id_norm,
  any(wi.resolved_at) AS resolved_at,
  round(
    sum(tf.cashflow_usdc) +
    sumIf(
      tf.delta_shares,
      coalesce(
        tf.trade_idx,
        multiIf(
          upperUTF8(tf.outcome_raw) = 'YES', 1,
          upperUTF8(tf.outcome_raw) = 'NO', 0,
          NULL
        )
      ) = wi.win_idx
    ),
    8
  ) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
  AND coalesce(
    tf.trade_idx,
    multiIf(
      upperUTF8(tf.outcome_raw) = 'YES', 1,
      upperUTF8(tf.outcome_raw) = 'NO', 0,
      NULL
    )
  ) IS NOT NULL
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm
```

## Key Improvements

### 1. **Simplified Query Structure**
- No subquery - direct aggregation on joined tables
- Clearer table aliases (`tf`, `cc`, `wi`)
- Explicit column references in GROUP BY

### 2. **Proper ClickHouse Syntax**
- Uses `sumIf()` instead of filtering in a subquery
- GROUP BY explicitly references table-qualified columns
- Aggregation functions (`sum`, `sumIf`, `any`, `count`) work correctly

### 3. **Correct Settlement Logic**
The formula correctly implements:
```
Realized P&L = sum(all cashflows) + sum(shares in winning outcome)
```

Where:
- **Cashflows**: `sum(tf.cashflow_usdc)`
  - BUY trades: negative (cost paid)
  - SELL trades: positive (revenue received)
- **Payout**: `sumIf(tf.delta_shares, outcome_idx = win_idx)`
  - Only shares in the winning outcome
  - BUY: positive shares (added)
  - SELL: negative shares (removed)

### 4. **Float64 Precision**
All arithmetic uses `Float64` to avoid Decimal overflow issues:
```sql
round(
  cast(entry_price as Float64) * cast(shares as Float64) *
  if(lowerUTF8(toString(side)) = 'buy', -1, 1),
  8
) AS cashflow_usdc
```

## Complete View Dependency Chain

```
trades_raw (base table)
    ↓
trade_flows_v2 (compute cashflows & share deltas)
    ↓
    ├─→ canonical_condition (market_id → condition_id_norm)
    ↓       ↓
    └─→ winning_index (condition_id_norm → win_idx, resolved_at)
            ↓
realized_pnl_by_market_v2 (aggregate to market position & settle)
    ↓
wallet_realized_pnl_v2 (sum across markets)
    ↓
wallet_pnl_summary_v2 (realized + unrealized)
```

## Settlement Example

For a wallet with these trades in a resolved market:

| Trade | Side | Outcome | Price | Shares | Cashflow | Delta Shares |
|-------|------|---------|-------|--------|----------|--------------|
| 1     | BUY  | YES     | 0.65  | 100    | -65.00   | +100         |
| 2     | BUY  | YES     | 0.70  | 50     | -35.00   | +50          |
| 3     | SELL | YES     | 0.80  | 75     | +60.00   | -75          |

If market resolves to **YES** (win_idx = 1):
```
Cost basis = sum(cashflows) = -65.00 + (-35.00) + 60.00 = -40.00
Net shares in YES = 100 + 50 + (-75) = 75
Payout = 75 shares × $1 = 75.00

Realized P&L = -40.00 + 75.00 = $35.00 profit ✅
```

If market resolves to **NO** (win_idx = 0):
```
Cost basis = -40.00 (same)
Net shares in NO = 0 (trader held YES, not NO)
Payout = 0

Realized P&L = -40.00 + 0 = -$40.00 loss ❌
```

## Files Provided

### 1. `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.sql`
Standalone SQL file with all view definitions and verification queries. Can be executed directly in ClickHouse console.

### 2. `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.ts`
TypeScript script that:
- Creates all 9 views in correct order
- Runs 3 verification probes
- Shows bridge coverage stats
- Displays sample market-level P&L
- Compares final P&L against expected values

## Usage

### Option A: Run TypeScript Script
```bash
cd /Users/scotty/Projects/Cascadian-app
npx tsx scripts/realized-pnl-corrected.ts
```

### Option B: Execute SQL Directly
```bash
# Copy SQL content and paste into ClickHouse client
cat scripts/realized-pnl-corrected.sql | clickhouse-client --host=... --password=...
```

## Expected Results

For target wallets:
- **HolyMoses7** (`0xa4b366ad22fc0d06f1e934ff468e8922431a87b8`):
  - Expected P&L: $89,975 - $91,633
  - Variance should be < 5%

- **niggemon** (`0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0`):
  - Expected P&L: ~$102,001
  - Variance should be < 5%

## Data Quality Checks

The script includes three verification probes:

### Probe 1: Bridge Coverage
```sql
-- Checks that all markets can be mapped to condition_ids
-- Expected: 100% bridged, high % resolvable
```

### Probe 2: Market Sample
```sql
-- Shows first 10 resolved markets with P&L breakdown
-- Helps verify calculations are reasonable
```

### Probe 3: Final P&L Summary
```sql
-- Compares calculated P&L against expected values
-- Shows variance percentage
```

## Troubleshooting

### If P&L is still overcounted (5-35x):

1. **Check for duplicate trades in trades_raw**:
```sql
SELECT
  wallet_address,
  market_id,
  outcome_index,
  entry_price,
  shares,
  count() as duplicate_count
FROM trades_raw
WHERE wallet_address IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
GROUP BY wallet_address, market_id, outcome_index, entry_price, shares
HAVING count() > 1
```

2. **Check outcome_index mapping**:
```sql
SELECT DISTINCT
  outcome,
  outcome_index
FROM trades_raw
WHERE market_id IN (SELECT DISTINCT market_id FROM trades_raw LIMIT 10)
ORDER BY outcome_index
```

3. **Verify resolution data**:
```sql
SELECT
  condition_id_norm,
  win_idx,
  resolved_at
FROM winning_index
LIMIT 20
```

### If view creation fails:

1. Check that prerequisite tables exist:
   - `trades_raw`
   - `ctf_token_map`
   - `condition_market_map`
   - `market_outcomes`
   - `market_resolutions`
   - `portfolio_mtm_detailed`

2. Verify ClickHouse version supports `CREATE OR REPLACE VIEW`

3. Check for permission issues on view creation

## Next Steps After Successful Creation

1. **Validate a sample of markets manually** against Polymarket UI
2. **Add indexes** if query performance is slow:
   ```sql
   -- On trades_raw
   ALTER TABLE trades_raw ADD INDEX idx_wallet_market (wallet_address, market_id) TYPE minmax GRANULARITY 4;
   ```

3. **Create materialized views** for production use (optional):
   ```sql
   CREATE MATERIALIZED VIEW realized_pnl_by_market_v2_mat
   ENGINE = SummingMergeTree()
   ORDER BY (wallet, market_id)
   POPULATE AS
   SELECT * FROM realized_pnl_by_market_v2;
   ```

4. **Set up monitoring** to track P&L calculation accuracy over time

## Summary

This corrected implementation:
- ✅ Fixes GROUP BY syntax errors
- ✅ Properly aggregates fills to market positions
- ✅ Correctly handles BUY/SELL cost basis
- ✅ Matches winning outcome by index (not string labels)
- ✅ Uses Float64 for precision
- ✅ Includes comprehensive verification queries
- ✅ Provides clear documentation and examples

The views should now execute successfully and produce accurate realized P&L calculations matching Polymarket's published values.
