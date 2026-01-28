# FIFO V5 Documentation

Complete guide for using TRUE FIFO V5 data with early selling, holding to resolution, and SHORT positions.

---

## Quick Start

**Table:** `pm_trade_fifo_roi_v3_mat_deduped`

**Read:** `/FIFO_V5_QUICK_START.md` (5 min read)

---

## Full Reference

**Read:** `/docs/FIFO_V5_REFERENCE.md` (Complete technical guide)

Includes:
- How FIFO V5 logic works
- Field definitions
- Query patterns for every use case
- Data quirks and edge cases
- Performance tips
- Verification queries

---

## Key Concepts

### 1. One Row Per Buy Transaction

FIFO V5 creates **multiple rows per position** (one per buy):

```
Position: Wallet A, Market X, Outcome 0
  Row 1: tx=0x111, 100 tokens, $10 PnL
  Row 2: tx=0x222, 200 tokens, $20 PnL
  Row 3: tx=0x333, 300 tokens, $30 PnL

Total position PnL: $60
```

### 2. Early Selling Tracked

Each row shows:
- `tokens_sold_early` = sold before resolution
- `tokens_held` = held to resolution

### 3. SHORT Positions Supported

- `is_short = 1`
- Negative `cost_usd`
- Profit when outcome loses

---

## Basic Query

```sql
SELECT
  wallet,
  sum(pnl_usd) as total_pnl,
  count() as buy_transactions,
  uniq(condition_id) as markets
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE abs(cost_usd) >= 5
GROUP BY wallet
ORDER BY total_pnl DESC
LIMIT 100
```

---

## Files

| File | Purpose |
|------|---------|
| `/FIFO_V5_QUICK_START.md` | Quick reference, basic queries |
| `/docs/FIFO_V5_REFERENCE.md` | Complete technical guide |
| `/scripts/create-materialized-deduped.ts` | Rebuild materialized table |

---

## Building the Materialized Table

If table doesn't exist or needs refreshing:

```bash
npx tsx scripts/create-materialized-deduped.ts
```

**Runtime:** 15-30 minutes
**Frequency:** After bulk backfills or weekly

---

## Status Check

```sql
-- Check if table exists and has data
SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped
```

Should return ~78M rows (or current deduplicated count).

---

## Support

Questions? Check `/docs/FIFO_V5_REFERENCE.md` for detailed explanations.
