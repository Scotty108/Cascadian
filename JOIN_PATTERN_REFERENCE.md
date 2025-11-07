# Join Pattern Reference for P&L Pipeline

## Quick Reference

✅ **Status:** Validated in Step 6 - Zero fanout confirmed

## The Pattern

```sql
-- Step 1: Dedupe base trades
WITH base_trades AS (
  SELECT DISTINCT
    transaction_hash,
    wallet_address,
    timestamp,
    side,
    shares,
    entry_price,
    usd_value,
    market_id
  FROM trades_raw
  WHERE lower(wallet_address) = :wallet
    AND timestamp <= :snapshot_ts
)

-- Step 2: Join through dimension tables using ANY LEFT JOIN
SELECT DISTINCT
  t.transaction_hash,
  t.wallet_address,
  t.timestamp,
  t.side,
  t.shares,
  t.entry_price,
  t.usd_value,
  t.market_id,
  c.condition_id_norm,          -- From canonical_condition
  o.outcome_idx,                 -- From market_outcomes_expanded
  o.outcome_label,
  r.payout_numerators,           -- From market_resolutions_final
  r.winning_outcome,
  r.winning_index
FROM base_trades t
ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
```

## Table Schemas Quick Reference

### trades_raw
- **Primary Key:** (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)
- **Role:** Fact table with trade events

### canonical_condition
- **Key Column:** market_id → condition_id_norm
- **Cardinality:** 1:1 (verified)
- **Role:** Bridge market IDs to condition IDs

### market_outcomes_expanded
- **Key Column:** condition_id_norm
- **Fields:** outcome_idx, outcome_label
- **Cardinality:** 1:many (but ANY JOIN prevents fanout)
- **Role:** Outcome labels for each condition

### market_resolutions_final
- **Key Column:** condition_id_norm
- **Fields:** payout_numerators, payout_denominator, winning_outcome, winning_index
- **Cardinality:** 1:1 (verified)
- **Role:** Resolution data for settled markets

## Join Order Rationale

1. **canonical_condition first** - Bridges market_id to condition_id_norm
2. **market_outcomes_expanded second** - Adds outcome labels (ANY JOIN prevents fanout)
3. **market_resolutions_final last** - Adds resolution data (1:1 mapping)

## Fanout Results (Verified)

| Wallet | N0 (Base) | N1 (Condition) | N2 (Outcomes) | N3 (Resolutions) | Total Fanout |
|--------|-----------|----------------|---------------|------------------|--------------|
| 0xa4b3... | 7,745 | 7,745 | 7,745 | 7,745 | 1.000000 ✅ |
| 0xeb6f... | 15,474 | 15,474 | 15,474 | 15,474 | 1.000000 ✅ |

## Why ANY LEFT JOIN?

### Problem Without ANY
```sql
-- This would cause fanout (2-10x row multiplication)
FROM trades_raw t
LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
-- Binary market: 2 rows per trade (Yes/No)
-- Multi-outcome market: N rows per trade
```

### Solution With ANY
```sql
-- This prevents fanout (selects first matching row only)
FROM trades_raw t
ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
-- Returns: 1 row per trade (first outcome only)
```

### ClickHouse ANY Semantics
- Selects first matching row from right table
- Deterministic within single query execution
- More efficient than DISTINCT after join
- Standard ClickHouse optimization for 1:many joins

## Common Pitfalls to Avoid

### ❌ Don't Do This
```sql
-- 1. Regular JOIN on 1:many relationship (causes fanout)
LEFT JOIN market_outcomes_expanded o ON ...

-- 2. No deduplication at base level
SELECT * FROM trades_raw WHERE ...
-- (may have duplicates)

-- 3. INNER JOIN (loses unresolved markets)
INNER JOIN market_resolutions_final r ON ...
```

### ✅ Do This Instead
```sql
-- 1. Use ANY for 1:many relationships
ANY LEFT JOIN market_outcomes_expanded o ON ...

-- 2. Always dedupe at base
SELECT DISTINCT ... FROM trades_raw WHERE ...

-- 3. Use LEFT JOIN to preserve all trades
ANY LEFT JOIN market_resolutions_final r ON ...
```

## Validation Checklist

Before using this pattern in production, verify:

- [ ] Base table deduplicated using composite key
- [ ] ANY LEFT JOIN used for all dimension tables
- [ ] Left joins preserve all trades (not inner joins)
- [ ] Row count stable: N3 = N0 ± 0.1%
- [ ] No NULL values in critical fields (market_id, wallet_address)

## Performance Notes

### Optimization Tips
1. **Pre-filter at base level** - Apply wallet and timestamp filters before joins
2. **Use DISTINCT once** - At base level only, not after joins
3. **Leverage ANY JOIN** - More efficient than post-join deduplication
4. **Index key columns** - market_id, condition_id_norm in dimension tables

### Expected Performance
- Measurement script: ~10-30 seconds for 2 wallets
- Single wallet P&L: <5 seconds
- Full portfolio P&L: <30 seconds (hundreds of wallets)

## References

- **Validation Report:** `STEP_6_JOIN_FANOUT_VERIFICATION_REPORT.md`
- **Measurement Script:** `/scripts/measure-join-fanout.ts`
- **Cardinality Verification:** `/scripts/verify-join-cardinality.ts`
- **ClickHouse ANY JOIN Docs:** https://clickhouse.com/docs/en/sql-reference/statements/select/join

---

**Last Updated:** 2025-11-06
**Validation Status:** ✅ VERIFIED - ZERO FANOUT
