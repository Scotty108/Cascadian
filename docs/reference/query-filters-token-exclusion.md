# Query Filters: Token_* Exclusion

**Purpose**: Filter out ERC1155 token ID placeholders from condition_id queries

**Last Updated**: November 10, 2025

---

## Background

Approximately 0.3% of trades in `trades_raw` (244,260 rows) use `token_*` format instead of hex condition IDs. These represent ERC1155 token IDs that haven't been converted to condition IDs yet.

**Impact**: 
- Trades: 244,260 (0.3%)
- Volume: $913,224 (0.03% of total)
- Status: Low priority, safe to exclude

---

## Standard Filter Pattern

Use this WHERE clause in all condition_id-based queries:

```sql
WHERE length(replaceAll(condition_id, '0x', '')) = 64
```

**What it does**:
- Strips `0x` prefix
- Checks length is exactly 64 characters (32-byte hex)
- Excludes `token_*` entries (60-char numeric)

---

## Usage Examples

### Example 1: Basic Trade Query

```sql
SELECT
  condition_id,
  wallet,
  shares,
  entry_price
FROM default.trades_raw
WHERE length(replaceAll(condition_id, '0x', '')) = 64  -- Filter token_*
  AND wallet = '0xabc...'
ORDER BY block_time DESC;
```

### Example 2: Join with Resolutions

```sql
SELECT
  t.condition_id,
  t.shares,
  r.winning_outcome,
  r.payout_numerators
FROM default.trades_raw t
INNER JOIN default.market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE length(replaceAll(t.condition_id, '0x', '')) = 64  -- Filter token_*
  AND t.wallet = '0xabc...';
```

### Example 3: Aggregation Query

```sql
SELECT
  count() as total_trades,
  uniqExact(condition_id) as unique_markets,
  sum(toFloat64(abs(cashflow_usdc))) as total_volume
FROM default.trades_raw
WHERE length(replaceAll(condition_id, '0x', '')) = 64  -- Filter token_*
  AND block_time >= '2025-01-01';
```

### Example 4: P&L Calculation

```sql
WITH valid_trades AS (
  SELECT
    wallet,
    lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
    outcome_index,
    trade_direction,
    toFloat64(shares) as shares,
    toFloat64(cashflow_usdc) as cashflow_usdc
  FROM default.trades_raw
  WHERE length(replaceAll(condition_id, '0x', '')) = 64  -- Filter token_*
    AND wallet = '0xabc...'
),
with_resolutions AS (
  SELECT
    vt.*,
    r.payout_numerators,
    r.payout_denominator,
    r.winning_index
  FROM valid_trades vt
  INNER JOIN default.market_resolutions_final r
    ON vt.condition_id_norm = r.condition_id_norm
)
SELECT
  sum(
    shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator)
    + cashflow_usdc
  ) as total_pnl
FROM with_resolutions;
```

---

## Alternative: Create View

For cleaner queries, create a view with filter pre-applied:

```sql
CREATE VIEW default.trades_valid AS
SELECT *
FROM default.trades_raw
WHERE length(replaceAll(condition_id, '0x', '')) = 64;
```

Then query the view directly:

```sql
SELECT * FROM default.trades_valid
WHERE wallet = '0xabc...';
```

---

## Token_* Investigation (Optional)

If you need to analyze or map token_* entries:

```sql
-- Find all token_* trades
SELECT
  condition_id,
  count() as trade_count,
  sum(toFloat64(abs(cashflow_usdc))) as volume
FROM default.trades_raw
WHERE condition_id LIKE 'token_%'
GROUP BY condition_id
ORDER BY trade_count DESC;

-- Check if mapping exists
SELECT *
FROM default.erc1155_condition_map
WHERE token_id = '457148706340909084038137474582146255423760525486063031753312'
LIMIT 5;
```

---

## Performance Notes

- **Cost**: Filter adds minimal overhead (~0.1ms per query)
- **Index**: Consider adding computed column if querying frequently:
  ```sql
  ALTER TABLE default.trades_raw 
  ADD COLUMN is_valid_cid UInt8 
  MATERIALIZED length(replaceAll(condition_id, '0x', '')) = 64;
  ```

---

## See Also

- `docs/systems/database/condition-id-normalization.md` - ID format standards
- `docs/systems/pnl/calculation-guide.md` - P&L calculation examples
- `reports/sessions/2025-11-10-session-1.md` - Token_* investigation findings

