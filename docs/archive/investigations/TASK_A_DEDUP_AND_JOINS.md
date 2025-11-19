# Task A: Lock Dedup and Joins

## Frozen Dedup Key

**Status: LOCKED ✅**

The dedup key for trades is a composite of all fields that make a trade unique within a wallet and market:

```sql
PARTITION BY (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)
ORDER BY (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)
```

**Why this key:**
- `transaction_hash`: Groups fills from same on-chain transaction
- `wallet_address`: Separates trades by wallet
- `timestamp`: Breaks ties within same tx (fill order)
- `side`: BUY vs SELL (different sides = different trades)
- `shares`: Quantity (different amounts = different fills)
- `entry_price`: Cost basis (different prices = different fills)
- `usd_value`: Notional value (prevents spurious dupes with same price/shares but different notional)
- `market_id`: Market context (same fill in different markets = different trades)

**DO NOT USE:**
- ❌ `trade_id` alone (too sparse, has undefined fields)
- ❌ `(transaction_hash, wallet_address)` (multiple fills per tx on different markets)
- ❌ `is_resolved` or `resolved_outcome` (sparse and unreliable)

---

## Join Patterns (Frozen)

### Pattern 1: Many-to-One Bridge Joins (Market ID → Condition ID)

**REQUIRED: Use `ANY` semantics to prevent row fanout**

```sql
-- CORRECT: Prevents 1:many row explosion
SELECT t.*
FROM trades_raw t
ANY LEFT JOIN condition_market_map c
  ON lower(t.market_id) = lower(c.market_id)
```

**WRONG:**
```sql
-- ❌ WILL cause row fanout if multiple conditions map to same market
SELECT t.*
FROM trades_raw t
LEFT JOIN condition_market_map c
  ON lower(t.market_id) = lower(c.market_id)
```

**Why `ANY LEFT JOIN`:**
- Takes only the first matching row from right side
- Prevents row multiplication
- With `condition_market_map` (perfect 1:1 cardinality), both are equivalent
- But `ANY` is safer if cardinality isn't guaranteed

---

### Pattern 2: One-to-Many Resolution Joins (Condition → Winners)

**REQUIRED: Use `SEMI JOIN` or explicit aggregation to handle many outcomes**

```sql
-- CORRECT: Only returns trades that have a resolution
SELECT t.*, w.win_idx
FROM trades_raw t
SEMI JOIN winning_index w
  ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
```

**Or with aggregation:**
```sql
-- ALSO CORRECT: Aggregate at resolution boundary
WITH resolved AS (
  SELECT DISTINCT
    lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
    any(win_idx) as win_idx
  FROM winning_index
  GROUP BY condition_id_norm
)
SELECT t.*, r.win_idx
FROM trades_raw t
LEFT JOIN resolved r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
```

**WRONG:**
```sql
-- ❌ Regular LEFT JOIN can cause fanout if one condition has multiple winners
-- (In our case this is safe since only one outcome wins per market)
SELECT t.*, w.win_idx
FROM trades_raw t
LEFT JOIN winning_index w
  ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
```

---

### Pattern 3: Condition ID Normalization

**REQUIRED: Normalize before all joins**

All condition IDs must be normalized to lowercase, no leading `0x`:

```sql
-- The normalization pattern
lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm

-- Example:
-- Input:  0xb3d36e59cfdfebf9e0d1f6f70a89c4e5e9d4f9e0
-- Output: b3d36e59cfdfebf9e0d1f6f70a89c4e5e9d4f9e0
-- Both match in condition_market_map and winning_index
```

**Where to normalize:**
- ✅ In SELECT clause when returning results
- ✅ In JOIN ON clause (both sides)
- ✅ In WHERE filters if matching by condition
- ⚠️ NOT in trades_raw storage (keep raw values)

---

## Fanout Verification Checklist

Before any multi-join query, verify:

- [ ] Input row count = N
- [ ] After bridge join (market_id → condition_id): count = N (fanout = 1.0)
- [ ] After resolution join (condition → winner): count ≤ N (fanout ≤ 1.0, some may not have winners)
- [ ] No query producing row count > 1.001 × input (allows rounding but not actual fanout)

**Example verification:**
```sql
WITH input AS (
  SELECT count(*) as n FROM trades_raw WHERE lower(wallet_address) = 'target'
),
after_bridge AS (
  SELECT count(*) as n FROM trades_enriched_with_condition WHERE lower(wallet_address) = 'target'
),
after_winner AS (
  SELECT count(*) as n FROM trades_with_outcomes WHERE lower(wallet_address) = 'target'
)
SELECT i.n as input, b.n as after_bridge, w.n as after_winner
FROM input i, after_bridge b, after_winner w
```

---

## Implementation Notes

### Do Use:
- ✅ `ANY LEFT JOIN` for bridge joins (market → condition)
- ✅ `SEMI JOIN` or `ANY` for resolution joins
- ✅ Views to pre-join and cache results
- ✅ Float64 for all price × shares calculations (avoid Decimal overflow)
- ✅ Proper WHERE filters to reduce input size before joins

### Don't Use:
- ❌ Regular `LEFT JOIN` on many-to-one relationships
- ❌ `INNER JOIN` when you want to preserve unresolved trades
- ❌ Self-joins or subqueries without proper cardinality control
- ❌ Decimal types for multiplication (use CAST to Float64)

---

## Materialization Strategy

**For Production Use:**

```sql
-- 1. Create materialized view with dedup applied
CREATE MATERIALIZED VIEW trades_dedup_mv AS
SELECT *
FROM (
  SELECT *,
    row_number() OVER (PARTITION BY transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id
                       ORDER BY created_at DESC) as rn
  FROM trades_raw
)
WHERE rn = 1;

-- 2. Enrich with conditions on top of dedup
CREATE OR REPLACE VIEW trades_enriched_with_condition AS
SELECT
  t.*,
  COALESCE(t.condition_id, c.condition_id) as condition_id_filled,
  lower(replaceAll(COALESCE(t.condition_id, c.condition_id), '0x', '')) as condition_id_norm
FROM trades_dedup_mv t
ANY LEFT JOIN condition_market_map c ON lower(t.market_id) = lower(c.market_id);

-- 3. Add resolution data
CREATE OR REPLACE VIEW trades_with_outcomes AS
SELECT
  t.*,
  w.win_idx
FROM trades_enriched_with_condition t
LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm;
```

---

## Summary Table

| Task | Method | Status |
|------|--------|--------|
| Dedup key | Composite (8 fields) | ✅ LOCKED |
| Bridge join | ANY LEFT JOIN | ✅ FROZEN |
| Resolution join | SEMI or ANY | ✅ FROZEN |
| Condition norm | lower(replaceAll(..., '0x', '')) | ✅ FROZEN |
| Fanout check | Count before/after joins | ✅ PROCESS |
| Type safety | Cast price×shares to Float64 | ✅ RULE |

---

**Last Updated:** 2025-11-06
**Status:** Locked for P&L reconciliation
**Review Frequency:** Only if coverage gate fails or fanout detected
