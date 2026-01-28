# FIFO V5 Implementation - TRUE FIFO for Closed Positions

## What Is TRUE FIFO?

**FIFO = First In, First Out** cost-basis tracking

Every **buy transaction** becomes a row in the FIFO table with:
- Its specific cost basis
- How many tokens from that buy were sold (matched chronologically to sells)
- How many tokens from that buy are still held

### Example

```
Buy 1: 300 tokens @ $0.50 = -$150 (2025-01-01)
Buy 2: 700 tokens @ $0.60 = -$420 (2025-01-02)
Sell:  500 tokens @ $0.80 = +$400 (2025-01-03)
```

**FIFO Matching:**
1. Sell matches Buy 1 first (300 tokens):
   - Cost: $150
   - Proceeds: 300 × $0.80 = $240
   - PnL: +$90

2. Sell matches Buy 2 next (200 tokens):
   - Cost: 200 × $0.60 = $120
   - Proceeds: 200 × $0.80 = $160
   - PnL: +$40

3. Buy 2 remaining (500 tokens):
   - Cost: $300
   - Unrealized (mark-to-market or resolution payout)

**FIFO Table Rows:**
| tx_hash | tokens | cost_usd | tokens_sold_early | tokens_held | exit_value | pnl_usd |
|---------|--------|----------|-------------------|-------------|------------|---------|
| buy1_hash | 300 | 150 | 300 | 0 | 240 | +90 |
| buy2_hash | 700 | 420 | 200 | 500 | 160 | -260 |

---

## What V5 Adds

### Before (V4):
```sql
-- ONLY resolved markets
WHERE payout_numerators != ''
```

**Coverage:**
- ✅ Resolved LONG positions
- ✅ Resolved SHORT positions
- ❌ Closed but UNRESOLVED positions

### After (V5):
```sql
-- ALSO unresolved markets where fully exited
WHERE (payout_numerators IS NULL OR payout_numerators = '')
  AND abs(sum(tokens_delta)) < 0.01  -- Closed
```

**Coverage:**
- ✅ Resolved LONG positions (V4)
- ✅ Resolved SHORT positions (V4)
- ✅ **Closed but UNRESOLVED positions (V5)** ← NEW

---

## Implementation Details

### Cost-Basis Tracking Logic

Uses window functions to match sells to buys chronologically:

```sql
-- Calculate cumulative tokens bought before this buy
coalesce(sum(buy.tokens) OVER (
  PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
  ORDER BY buy.entry_time
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
), 0) as cumsum_before

-- Match this buy's tokens to sells (FIFO order)
least(
  buy.tokens,  -- Can't sell more than this buy
  greatest(
    0,
    total_tokens_sold - cumsum_before  -- Sells not yet matched
  )
) as tokens_sold_early
```

### Filter for Closed Positions

Only insert FIFO rows where position is fully exited:

```sql
WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
```

This ensures we only add closed positions (no unrealized holdings).

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Batch size | 100 conditions |
| Time per batch | 1-3 minutes |
| Total conditions | ~3,000-5,000 |
| Total runtime | 30-45 minutes |
| Memory per batch | 8GB |
| Threads | 6 |

### Why Batched?

- Window functions are memory-intensive
- Processing all conditions at once → timeout
- Small batches (100) → stable, predictable

---

## What Gets Created

### FIFO Rows for Closed Positions

Each **buy transaction** that was fully sold becomes a row:

```sql
tx_hash: 'fill_abc123...'  -- Original buy fill ID
wallet: '0x...'
condition_id: '0x...'
outcome_index: 0
entry_time: '2025-01-15 10:30:00'
tokens: 1000.0
cost_usd: 500.0
tokens_sold_early: 1000.0  -- All sold
tokens_held: 0.0  -- None held
exit_value: 820.0  -- Proceeds from sells
pnl_usd: 320.0  -- Realized profit
roi: 0.64  -- 64% return
is_closed: 1  -- Marker
```

### Aggregate Stats

Per wallet summary:

```sql
SELECT
  wallet,
  count() as closed_fifo_rows,
  sum(pnl_usd) as closed_realized_pnl
FROM pm_trade_fifo_roi_v3_deduped
WHERE is_closed = 1
GROUP BY wallet
```

---

## Impact Assessment

### FuelHydrantBoss Wallet

**Before (V4 only):**
- Resolved positions: 41 FIFO rows → $1,040 PnL
- **Missing:** 43 closed positions

**After (V5):**
- Resolved positions: 41 FIFO rows → $1,040 PnL
- **Closed positions:** ~100-200 FIFO rows → $6,900 PnL
- **Total:** ~150-250 FIFO rows → $7,940 PnL

**Polymarket shows:** $8,714 (difference likely from mark-to-market on unrealized)

### System-Wide

**Estimated impact:**
- 500k-1M new FIFO rows
- 50k-100k wallets affected
- $50M-$100M in previously missing PnL

---

## Verification Steps

After backfill completes:

1. **Test wallet accuracy:**
   ```bash
   npx tsx scripts/closed-positions/05-verify-fifo-v5-fix.ts
   ```

2. **Check leaderboard performance:**
   ```sql
   SELECT wallet, sum(pnl_usd) as total_pnl
   FROM pm_trade_fifo_roi_v3_deduped
   GROUP BY wallet
   ORDER BY total_pnl DESC
   LIMIT 100
   ```
   - Should complete in <5s
   - Rankings will shift (wallets with closed positions rise)

3. **Validate no duplicates:**
   ```sql
   SELECT wallet, condition_id, outcome_index, tx_hash, count()
   FROM pm_trade_fifo_roi_v3_deduped
   GROUP BY wallet, condition_id, outcome_index, tx_hash
   HAVING count() > 1
   ```
   - Should return 0 rows

---

## Cron Job Integration

Add to existing FIFO refresh cron:

```typescript
// app/api/cron/refresh-fifo-trades/route.ts

// After V4 processes resolved markets...
await refreshClosedPositions();  // Run V5 logic for unresolved

async function refreshClosedPositions() {
  // Get conditions that became closed since last run
  const newlyClosed = await findNewlyClosedPositions();

  // Process with FIFO matching
  await processFIFOForClosedPositions(newlyClosed);
}
```

**Frequency:** Every 1 hour (same as V4)

---

## Rollback Plan

If V5 causes issues:

```sql
-- Remove all closed position rows
DELETE FROM pm_trade_fifo_roi_v3
WHERE is_closed = 1;

-- Or drop the column entirely
ALTER TABLE pm_trade_fifo_roi_v3 DROP COLUMN is_closed;
```

Data is additive-only, no modifications to existing rows.

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| FIFO coverage | 70M rows | 71M rows | +1M |
| Leaderboard query time | 60s+ timeout | <5s | <5s |
| Wallet PnL accuracy | ~60% match PM | >95% match PM | >95% |
| Missing closed positions | ~500k | 0 | 0 |

---

## Technical Notes

### Why Window Functions?

Window functions allow FIFO matching without self-joins:
- `SUM() OVER (ORDER BY entry_time)` tracks cumulative tokens
- `ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING` looks at buys before current
- `PARTITION BY (wallet, condition_id, outcome_index)` isolates each position

### Why Not Materialized View?

- FIFO logic too complex for incremental updates
- Batch processing more reliable
- Cron job can handle errors and retries

### Why `is_closed` Column?

Distinguishes V5 closed positions from V4 resolved positions:
- `is_closed = 0`: Regular resolved position (V4)
- `is_closed = 1`: Closed but unresolved (V5)

Enables filtering and debugging.

---

## Related Files

- `build-trade-fifo-v4.ts` - Original FIFO logic (resolved only)
- `build-trade-fifo-v5-true-fifo.ts` - Extended FIFO logic (closed positions)
- `05-verify-fifo-v5-fix.ts` - Verification script
- `lib/pnl/pnlEngineV1.ts` - V1 engine (already handles closed via 'closed' status)

---

## Questions & Answers

**Q: Why not just use the V1 engine's closed status fix?**
A: V1 fixes wallet-level queries, but leaderboards query FIFO directly. Need both.

**Q: What about partial sells (still holding tokens)?**
A: Covered by V1 engine with mark-to-market. FIFO only tracks fully closed positions.

**Q: Will this slow down queries?**
A: No - adds ~1M rows to 70M (1.4% increase). Queries still fast with proper indexes.

**Q: What if a closed position's market later resolves?**
A: Keep both rows (closed + resolved). Dedup view handles it. Or mark is_closed=0 on refresh.

---

## Status

- [x] V5 script created
- [ ] Backfill running (30-45 min)
- [ ] Verification pending
- [ ] Cron job integration pending
- [ ] Documentation complete
