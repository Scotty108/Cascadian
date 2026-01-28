# FIFO V5 Quick Start

## The One Thing You Need to Know

**Table to use:** `pm_trade_fifo_roi_v3_mat_deduped`

Use this table for **ALL** queries. It contains TRUE FIFO V5 logic with:
- Early selling tracking
- Holding to resolution
- SHORT position support
- No duplicates
- Fast queries

---

## Basic Query Template

```sql
SELECT
  wallet,
  tx_hash,
  condition_id,
  outcome_index,
  entry_time,
  resolved_at,
  tokens,
  cost_usd,
  tokens_sold_early,
  tokens_held,
  pnl_usd,
  roi,
  is_short
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE <your filters>
ORDER BY entry_time DESC
```

---

## Key Concepts

### 1. Multiple Rows Per Position

**Each buy transaction = one row**

If you buy the same position 3 times, you get 3 rows:
```
Wallet A, Market X, Outcome 0:
  Row 1: tx_hash=0x111, tokens=100, pnl=$10
  Row 2: tx_hash=0x222, tokens=200, pnl=$20
  Row 3: tx_hash=0x333, tokens=300, pnl=$30
```

**Total position PnL:** $10 + $20 + $30 = $60

### 2. Early Selling vs Holding

Each row shows:
- `tokens_sold_early` = sold BEFORE resolution
- `tokens_held` = held TO resolution
- `tokens` = `tokens_sold_early` + `tokens_held`

**Example:**
```
Buy 1000 tokens @ $0.50 ($500 cost)
Sell 400 early @ $0.75 (+$100 profit so far)
Hold 600 to resolution @ $1.00 (+$300 more profit)

Row data:
  tokens: 1000
  cost_usd: 500
  tokens_sold_early: 400
  tokens_held: 600
  exit_value: 700
  pnl_usd: 200
  roi: 0.40 (40%)
```

### 3. SHORT Positions

SHORT positions have:
- `is_short = 1`
- Negative `cost_usd` (received money for selling)
- Profit when outcome loses

---

## Common Tasks

### Get Wallet PnL

```sql
SELECT sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
```

### Get Position PnL

```sql
SELECT
  sum(pnl_usd) as position_pnl,
  sum(tokens) as total_tokens_bought,
  sum(tokens_sold_early) as sold_early,
  sum(tokens_held) as held_to_resolution
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
  AND condition_id = '0x...'
  AND outcome_index = 0
```

### Get Win Rate

```sql
SELECT
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd <= 0) as losses,
  round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
```

### Find Top Markets

```sql
SELECT
  condition_id,
  count() as buy_transactions,
  uniq(wallet) as unique_traders,
  sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY condition_id
ORDER BY total_pnl DESC
LIMIT 100
```

---

## Important Rules

### ❌ DON'T Do This

```sql
-- WRONG: Loses per-trade detail
SELECT any(pnl_usd)
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
GROUP BY condition_id
```

### ✅ DO This

```sql
-- CORRECT: Sums all buy transactions
SELECT sum(pnl_usd)
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
GROUP BY condition_id
```

---

## Field Definitions (Quick Reference)

| Field | What It Means |
|-------|---------------|
| `tx_hash` | Buy transaction hash (unique ID) |
| `tokens` | Tokens bought in this transaction |
| `cost_usd` | What you paid (negative for SHORT) |
| `tokens_sold_early` | Sold before market resolved |
| `tokens_held` | Held to resolution |
| `pnl_usd` | Profit/loss for this buy transaction |
| `roi` | Return: pnl_usd / abs(cost_usd) |
| `is_short` | 1 = SHORT, 0 = LONG |

---

## Need More?

**Full documentation:** `/docs/FIFO_V5_REFERENCE.md`

Covers:
- Detailed FIFO logic explanation
- Complex query patterns
- Edge cases and data quirks
- Performance optimization
- Data quality checks

---

## That's It

Use `pm_trade_fifo_roi_v3_mat_deduped` for everything. Sum PnL across rows for positions. You're good to go.
