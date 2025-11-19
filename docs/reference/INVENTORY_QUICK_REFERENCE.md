# P&L Reconciliation - Database Inventory Quick Reference

## Critical Tables for P&L Calculation

### The Three Essential Tables

1. **`trades_raw`** (Source Data)
   - All trades: wallet, market_id, outcome_index, entry_price, shares, etc.
   - Join key: `market_id`

2. **`canonical_condition`** (Primary Bridge View)
   - Maps: `market_id` → `condition_id_norm`
   - Sources: ctf_token_map + condition_market_map (union)
   - Critical for connecting trades to resolutions

3. **`winning_index`** (Resolution Data View)
   - Maps: `condition_id_norm` → `win_idx` (winning outcome index)
   - `win_idx` is the GOLDEN COLUMN for P&L
   - Compare: `trades_raw.outcome_index == winning_index.win_idx`

### Supporting Tables

- **`market_outcomes_expanded`** - Maps outcome indices to labels
- **`market_resolutions`** - Source: Raw resolution data
- **`ctf_token_map`** - Source: Token metadata
- **`condition_market_map`** - Source: Cached mappings

---

## The P&L Formula

```
WINNER = (trades_raw.outcome_index == winning_index.win_idx)
PAYOUT = IF(WINNER, shares * 1.0, 0)
REALIZED_PNL = PAYOUT - trades_raw.usd_value
```

---

## The Join Pattern

```sql
trades_raw t
  JOIN canonical_condition cc ON t.market_id = cc.market_id
  LEFT JOIN winning_index wi ON cc.condition_id_norm = wi.condition_id_norm
```

---

## Table Relationships

```
Trades (market_id)
    |
    v
canonical_condition (market_id → condition_id_norm)
    |
    v
winning_index (condition_id_norm → win_idx)
    |
    v
P&L = IF(outcome_index == win_idx, ...)
```

---

## Status Summary

| Component | Type | Status | Key Column |
|-----------|------|--------|-----------|
| trades_raw | TABLE | EXISTS | outcome_index |
| canonical_condition | VIEW | EXISTS | condition_id_norm |
| winning_index | VIEW | EXISTS | win_idx |
| market_outcomes_expanded | VIEW | EXISTS | outcome_idx, outcome_label |

---

## Next: Step 2 Queries

Once Step 1 (this inventory) is verified, Step 2 will:
1. Validate join coverage (all trades have resolutions)
2. Sample P&L calculations for known wallets
3. Compare calculated P&L with expected values
4. Identify and handle edge cases (unresolved markets, etc.)

---

**End of Quick Reference**
