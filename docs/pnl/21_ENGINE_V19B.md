# Engine: V19b Unified Ledger (v19b_v1)

**Version:** v1
**Status:** DEPRECATED (does not match Polymarket UI)
**Files:** `lib/pnl/uiActivityEngineV19b.ts`

---

## Algorithm

### Data Loading

```sql
SELECT
  condition_id,
  outcome_index,
  sum(usdc_delta) AS cash_flow,
  sum(token_delta) AS final_tokens,
  any(payout_norm) AS resolution_price
FROM pm_unified_ledger_v9_clob_tbl
WHERE lower(wallet_address) = lower('0x...')
  AND condition_id IS NOT NULL
GROUP BY condition_id, outcome_index
```

### PnL Formula

```typescript
// For each position:
if (resolution_price !== null) {
  realizedPnl = cash_flow + final_tokens * resolution_price;
} else {
  // Synthetic resolution for near-certain outcomes
  const currentPrice = await fetchMarketPrice(condition_id);
  if (currentPrice >= 0.99) {
    realizedPnl = cash_flow + final_tokens * 1.0;
  } else if (currentPrice <= 0.01) {
    realizedPnl = cash_flow + final_tokens * 0.0;
  } else {
    unrealizedPnl = final_tokens * (currentPrice - 0.5);
  }
}
```

---

## The Dedupe Issue

### Discovery (2025-12-17)

For wallet @cozyfnf:
- Total rows in pm_unified_ledger_v9_clob_tbl: **7,110**
- Unique event_ids: **3,178**
- Duplicate rows: **3,932 (55.3%)**

### Impact

Without deduplication:
- V19b realized_pnl: $4,035,798
- UI PnL: $1,409,525
- Delta: **+186%**

With deduplication:
- V19b realized_pnl: $2,435,637
- UI PnL: $1,409,525
- Delta: **+72.8%**

### Why Deduped V19b Still Diverged

1. **Different formula:** Cash flow aggregation ≠ weighted average cost basis
2. **No CTF events:** Missing splits/merges/redemptions
3. **CLOB only:** Missing token acquisitions from other sources

---

## Known Failure Modes

### 1. Duplication

Must always GROUP BY event_id to dedupe.

### 2. Wrong Cost Basis Method

Uses `cash_flow + tokens × price` formula, not weighted average.

### 3. No CTF Events

Only includes CLOB trades, missing splits/merges/redemptions.

---

## Observed Results

### Wallet: 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd (@cozyfnf)

| Variant | Result | vs UI |
|---------|--------|-------|
| V19b (no dedup) | $4,035,798 | +186% ❌ |
| V19b (deduped) | $2,435,637 | +72.8% ❌ |
| UI PnL | $1,409,525 | baseline |

---

## When to Use

**DO NOT USE** for UI parity.

May use for:
- Quick approximation
- Comparison against other engines
- Research on cash flow patterns

---

## Deduped Variant (v19b_dedup_v1)

```sql
WITH deduped AS (
  SELECT
    event_id,
    any(condition_id) as condition_id,
    any(outcome_index) as outcome_index,
    any(usdc_delta) as usdc_delta,
    any(token_delta) as token_delta,
    any(payout_norm) as payout_norm
  FROM pm_unified_ledger_v9_clob_tbl
  WHERE lower(wallet_address) = lower('0x...')
  GROUP BY event_id
)
SELECT
  condition_id,
  outcome_index,
  sum(usdc_delta) AS cash_flow,
  sum(token_delta) AS final_tokens,
  any(payout_norm) AS resolution_price
FROM deduped
GROUP BY condition_id, outcome_index
```
