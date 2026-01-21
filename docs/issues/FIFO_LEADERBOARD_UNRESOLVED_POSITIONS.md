# FIFO Leaderboard: Unresolved Positions Gap

**Issue Discovered:** January 16, 2026
**Status:** Needs Fix
**Priority:** High - Affects leaderboard accuracy

---

## Problem Summary

The `pm_trade_fifo_roi_v2` table only contains **resolved trades**. This creates misleading metrics because:

1. **Win rates are inflated** - A wallet showing "98% win rate" might have 50% of their trades still unresolved
2. **Active losers are hidden** - Wallets with bad active positions appear better than they are
3. **Recency bias** - Recent traders have fewer resolved trades, skewing comparisons

### Example: Wallet 0x41574db393e4905465d8fe13c9e0cfc8b1ec04f9

| What FIFO Shows | Reality |
|-----------------|---------|
| 42 trades | 84 trades (50% unresolved) |
| 97.6% win rate | Unknown until active bets resolve |
| +$2,902 PnL | Could be much lower |

User verified on Polymarket UI that this wallet has losses in their "active" tab that don't appear in our data.

---

## Root Cause

The `pm_trade_fifo_roi_v2` table is built by joining fills with `pm_condition_resolutions`:

```sql
FROM pm_canonical_fills_v4 f
INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
WHERE r.is_deleted = 0 AND r.payout_numerators != ''
```

This `INNER JOIN` excludes any trades on markets that haven't resolved yet.

---

## Data Discovery Queries

### 1. Check resolved vs total trades for a wallet

```sql
-- Resolved trades (in FIFO table)
SELECT count() as resolved_trades
FROM pm_trade_fifo_roi_v2
WHERE wallet = '0x...' AND entry_time >= now() - INTERVAL 30 DAY;

-- All trades (including unresolved)
SELECT count() as total_trades
FROM (
  SELECT tx_hash, condition_id, outcome_index
  FROM pm_canonical_fills_v4
  WHERE wallet = '0x...'
    AND event_time >= now() - INTERVAL 30 DAY
    AND source = 'clob'
    AND tokens_delta > 0
  GROUP BY tx_hash, condition_id, outcome_index
);
```

### 2. Find unresolved positions for a wallet

```sql
SELECT
  f.condition_id,
  f.outcome_index,
  round(sum(f.tokens_delta), 2) as tokens,
  round(abs(sum(f.usdc_delta)), 2) as cost_usd,
  m.question
FROM pm_canonical_fills_v4 f
LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
WHERE f.wallet = '0x...'
  AND f.event_time >= now() - INTERVAL 30 DAY
  AND f.source = 'clob'
  AND f.tokens_delta > 0
  AND NOT EXISTS (
    SELECT 1 FROM pm_condition_resolutions r
    WHERE r.condition_id = f.condition_id
      AND r.is_deleted = 0
      AND r.payout_numerators != ''
  )
GROUP BY f.condition_id, f.outcome_index, m.question
HAVING cost_usd > 1
ORDER BY cost_usd DESC;
```

### 3. Find wallets with high % resolved (more trustworthy)

```sql
WITH wallet_stats AS (
  SELECT wallet, count() as resolved_trades
  FROM pm_trade_fifo_roi_v2
  WHERE entry_time >= now() - INTERVAL 30 DAY
  GROUP BY wallet
),
all_trades AS (
  SELECT wallet, count() as total_trades
  FROM (
    SELECT wallet, tx_hash, condition_id, outcome_index
    FROM pm_canonical_fills_v4
    WHERE event_time >= now() - INTERVAL 30 DAY
      AND source = 'clob' AND tokens_delta > 0
    GROUP BY wallet, tx_hash, condition_id, outcome_index
  )
  GROUP BY wallet
)
SELECT
  w.wallet,
  w.resolved_trades,
  a.total_trades,
  round(w.resolved_trades * 100.0 / a.total_trades, 1) as pct_resolved
FROM wallet_stats w
JOIN all_trades a ON w.wallet = a.wallet
WHERE pct_resolved >= 70
ORDER BY pct_resolved DESC;
```

---

## Proposed Solution

### Option A: Add "Completeness" Metrics (Quick Fix)

Add columns to leaderboard queries showing data completeness:

```sql
SELECT
  wallet,
  resolved_trades,
  total_trades,
  round(resolved_trades * 100.0 / total_trades, 1) as pct_complete,
  win_rate_pct,
  -- Flag wallets with lots of unresolved
  CASE
    WHEN pct_complete < 50 THEN 'LOW CONFIDENCE'
    WHEN pct_complete < 70 THEN 'MEDIUM CONFIDENCE'
    ELSE 'HIGH CONFIDENCE'
  END as data_confidence
```

**Pros:** Quick to implement, transparent to users
**Cons:** Doesn't solve the underlying issue

### Option B: Include Unrealized PnL (Better)

Create a new table or view that includes unrealized positions with estimated current value:

```sql
CREATE TABLE pm_trade_fifo_roi_with_unrealized_v1 (
  -- Same columns as pm_trade_fifo_roi_v2
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  tokens Float64,
  cost_usd Float64,

  -- New columns for unrealized
  is_resolved UInt8,              -- 0 = still open, 1 = resolved
  current_price Float64,          -- Latest price from order book (for unrealized)
  unrealized_value Float64,       -- tokens * current_price
  unrealized_pnl Float64,         -- unrealized_value - cost_usd

  -- Resolved columns (null if unresolved)
  exit_value Nullable(Float64),
  pnl_usd Nullable(Float64),
  roi Nullable(Float64),
  resolved_at Nullable(DateTime)
)
```

**Implementation Steps:**

1. **Get current prices for unresolved markets**
   - Use `pm_clob_orderbook_snapshots` or similar
   - Or fetch from Polymarket API: `GET /prices?token_ids=...`

2. **Build unrealized positions table**
   ```sql
   -- For each unresolved position, calculate:
   -- unrealized_value = tokens * current_best_bid
   -- unrealized_pnl = unrealized_value - cost_usd
   ```

3. **Merge with resolved trades**
   - Union resolved trades (from existing FIFO table)
   - With unrealized positions (new calculation)

4. **Update leaderboard queries**
   - Show both realized and unrealized PnL
   - Calculate "adjusted win rate" including unrealized losers

**Pros:** Complete picture, accurate rankings
**Cons:** More complex, needs price feed integration

### Option C: Mark-to-Market Leaderboard (Best)

Calculate all positions at current market prices, whether resolved or not:

```
Total PnL = Realized PnL + Unrealized PnL

Where:
- Realized PnL = sum of (exit_value - cost) for resolved trades
- Unrealized PnL = sum of (current_value - cost) for open positions
- Current Value = tokens * current_price
```

This is how professional trading systems work.

---

## Data Sources Needed

### For Current Prices (Unrealized Positions)

**Option 1: Polymarket CLOB API**
```
GET https://clob.polymarket.com/prices?token_ids={token_id1},{token_id2}
```

Returns current best bid/ask for each token.

**Option 2: Our orderbook snapshots**
Check if `pm_clob_orderbook_snapshots` or similar table exists with recent prices.

**Option 3: Gamma API**
```
GET https://gamma-api.polymarket.com/markets/{condition_id}
```

Returns market info including current prices.

### Token ID Mapping

Need to map condition_id + outcome_index to token_id:
- `pm_token_to_condition_map_v5` table has this mapping
- token_id for outcome 0 vs outcome 1

---

## Validation Approach

After implementing, validate by:

1. **Pick 5 wallets** with known active positions (verify on Polymarket UI)
2. **Compare our data** to what Polymarket shows
3. **Check edge cases:**
   - Wallet with 100% resolved (should match current)
   - Wallet with 50% resolved (should show new unrealized)
   - Wallet with mostly losers in active (should show lower win rate)

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/build-trade-fifo-v3.ts` | Add unrealized positions logic |
| `pm_trade_fifo_roi_v2` table | Either add columns or create new table |
| Leaderboard queries | Include completeness metrics |
| Price fetching | New script/cron to get current prices |

---

## Acceptance Criteria

1. [ ] Leaderboard shows % of trades resolved for each wallet
2. [ ] Unrealized PnL calculated for open positions
3. [ ] Win rate includes unrealized losers (positions underwater)
4. [ ] Validation against 5 wallets matches Polymarket UI
5. [ ] Documentation updated

---

## Related Tables

- `pm_trade_fifo_roi_v2` - Current resolved-only FIFO trades
- `pm_canonical_fills_v4` - Raw fills (source of truth)
- `pm_condition_resolutions` - Resolution outcomes
- `pm_token_to_condition_map_v5` - Token ID mapping
- `pm_market_metadata` - Market questions/titles

---

## Questions for Implementation

1. **How often to update unrealized prices?**
   - Real-time via API on each query? (slow but accurate)
   - Cached every 5 minutes? (fast but slightly stale)
   - Daily snapshot? (fast but potentially very stale)

2. **How to handle partially sold positions?**
   - Some tokens sold (realized), some still held (unrealized)
   - Need FIFO tracking for partial exits

3. **Should unrealized affect leaderboard ranking?**
   - Yes: More accurate but volatile (prices change)
   - No: Only use for confidence flagging, rank by realized only

---

## Priority

**High** - This fundamentally affects the accuracy of our "best traders" list. Users are making copy-trading decisions based on incomplete data.
