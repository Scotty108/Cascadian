# Trade Enrichment - Quick Reference Card

## One-Liner Commands

```bash
# Test the logic (no database required)
npx tsx scripts/test-enrichment-logic.ts

# Check enrichment status
npx tsx scripts/verify-enrichment.ts

# Enrich all trades
npx tsx scripts/enrich-trades.ts

# Test with 1000 trades first
npx tsx scripts/enrich-trades.ts --limit 1000

# Enrich specific market
npx tsx scripts/enrich-trades.ts --condition-id 0x1234...
```

## What Gets Calculated

| Field | Formula | Example |
|-------|---------|---------|
| `outcome` | Trade won? 1 : 0 | `1` |
| `pnl_gross` | `(outcome ? shares : 0) - usd_value` | `$35.00` |
| `fee_usd` | `usd_value × 0.02` | `$1.30` |
| `pnl_net` | `pnl_gross - fee_usd` | `$33.70` |
| `return_pct` | `(pnl_net / usd_value) × 100` | `51.85%` |
| `hours_held` | `(resolution_time - trade_time) / 3600` | `72.5` |

## Expected Results

### Winning Trade
- Entry: $0.65 YES × 100 shares = $65
- Resolves: YES wins ($1.00)
- **P&L Net:** $33.70
- **Return:** +51.85%

### Losing Trade
- Entry: $0.65 YES × 100 shares = $65
- Resolves: NO wins ($0.00)
- **P&L Net:** -$66.30
- **Return:** -102%

## Verification Checklist

Run `npx tsx scripts/verify-enrichment.ts` and check:

- ✅ Enrichment rate > 50%
- ✅ Win rate 20-80%
- ✅ No invalid outcomes (only 0, 1, NULL)
- ✅ Net P&L < Gross P&L
- ✅ Fees > 0
- ✅ Average loss is negative
- ✅ Average win is positive
- ✅ Close prices in [0, 1]

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "No markets found" | Markets not synced | `npx tsx scripts/sync-markets-from-polymarket.ts` |
| "No trades to enrich" | No trades or all enriched | Check `SELECT COUNT(*) FROM trades_raw` |
| "Low enrichment rate" | Missing condition_ids | Check `SELECT COUNT(*) FROM trades_raw WHERE condition_id = ''` |
| "Ambiguous resolution" | Price not 0 or 1 | Normal for invalid/cancelled markets |

## SQL Queries

### Check Status
```sql
SELECT
  COUNT(*) as total,
  COUNTIF(outcome IS NOT NULL) as enriched,
  COUNTIF(outcome IS NULL) as pending
FROM trades_raw
```

### Sample Enriched Trades
```sql
SELECT
  trade_id,
  side,
  entry_price,
  outcome,
  pnl_net,
  return_pct
FROM trades_raw
WHERE outcome IS NOT NULL
LIMIT 10
```

### Find Errors
```sql
SELECT *
FROM trades_raw
WHERE outcome IS NOT NULL
  AND (pnl_net > pnl_gross OR hours_held < 0)
```

## Performance

- **Speed:** 1,000-2,000 trades/sec
- **Memory:** ~100-200 MB
- **Batch:** 10,000 trades
- **Safe:** Idempotent, resumable

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/enrich-trades.ts` | Main pipeline | 869 |
| `scripts/verify-enrichment.ts` | Verification | 622 |
| `scripts/test-enrichment-logic.ts` | Tests | 566 |
| `TRADE_ENRICHMENT_PIPELINE.md` | Full docs | 1,000+ |
| `scripts/README_ENRICHMENT.md` | User guide | 400+ |

## Decision Tree

```
Do you have trades in ClickHouse?
├─ No → Run sync-wallet-trades.ts first
└─ Yes
   │
   Do you have resolved markets?
   ├─ No → Run sync-markets-from-polymarket.ts first
   └─ Yes
      │
      Have you tested the logic?
      ├─ No → Run test-enrichment-logic.ts
      └─ Yes
         │
         Start with test run?
         ├─ Yes → enrich-trades.ts --limit 1000
         └─ No → enrich-trades.ts
            │
            → verify-enrichment.ts
               │
               Errors found?
               ├─ Yes → Review errors, fix, re-run
               └─ No → Production ready ✅
```

## Support

- **Logic tests:** `npx tsx scripts/test-enrichment-logic.ts`
- **Full docs:** `TRADE_ENRICHMENT_PIPELINE.md`
- **User guide:** `scripts/README_ENRICHMENT.md`
- **This card:** `ENRICHMENT_QUICK_REFERENCE.md`
