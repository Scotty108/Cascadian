# Trade Detection via Transaction Hash Grouping

## Executive Summary

**Key Discovery:** Each blockchain transaction (`tx_hash`) represents exactly ONE trade decision by a trader. This is the fundamental unit for copy trading and trade history display.

```
1 tx_hash = 1 trade = 1 copyable action
```

## The Problem

The `pm_canonical_fills_v4` table contains individual **fills** (order executions), not **trades**. One trader's market order can result in 1-1000+ fills as it walks the order book.

**Example:** A $10,000 buy order might execute as:
- Fill 1: 1000 tokens @ $0.50
- Fill 2: 800 tokens @ $0.51
- Fill 3: 1200 tokens @ $0.52
- ... (20 more fills)

All these fills share the same `tx_hash` because they're part of one blockchain transaction.

## Validation Data

Analysis of 143M+ CLOB transactions confirmed:

| Metric | Value |
|--------|-------|
| Total transactions | 143,935,709 |
| Multi-condition transactions | **0** |
| Percentage multi-market | **0%** |

**Every single CLOB transaction targets exactly one market.** This makes `tx_hash` a perfect trade identifier.

### Fill Distribution Per Transaction

| Fills per TX | % of Transactions |
|--------------|-------------------|
| 1 fill | 87% |
| 2-10 fills | 8% |
| 10-100 fills | 4.9% |
| 100+ fills | <0.1% |

Most trades are simple 1-2 fill executions. Large orders walk the book with many fills.

## Implementation

### Core Query Pattern

```sql
-- Group fills by tx_hash to get trades
SELECT
  tx_hash,
  wallet,
  condition_id,
  outcome_index,
  min(event_time) as trade_time,
  sum(CASE WHEN tokens_delta > 0 THEN tokens_delta ELSE 0 END) as tokens_bought,
  sum(CASE WHEN tokens_delta < 0 THEN abs(tokens_delta) ELSE 0 END) as tokens_sold,
  sum(CASE WHEN tokens_delta > 0 THEN abs(usdc_delta) ELSE 0 END) as buy_cost_usd,
  sum(CASE WHEN tokens_delta < 0 THEN usdc_delta ELSE 0 END) as sell_proceeds_usd,
  count() as fill_count,
  max(is_maker) as is_maker
FROM pm_canonical_fills_v4
WHERE source = 'clob'
  AND NOT (is_self_fill = 1 AND is_maker = 1)
GROUP BY tx_hash, wallet, condition_id, outcome_index
```

### Trade Types

After grouping by `tx_hash`, classify trades by net token flow:

| Net Tokens | Trade Type |
|------------|------------|
| > 0 | **BUY** (entry or add to position) |
| < 0 | **SELL** (exit or reduce position) |
| = 0 | **FLIP** (sold and bought in same tx, rare) |

```sql
-- Classify trade type
CASE
  WHEN sum(tokens_delta) > 0 THEN 'BUY'
  WHEN sum(tokens_delta) < 0 THEN 'SELL'
  ELSE 'FLIP'
END as trade_type
```

## Use Cases

### 1. Trade History (Activity Tab)

Show all trades for a wallet, grouped by transaction:

```sql
SELECT
  tx_hash,
  condition_id,
  min(event_time) as trade_time,
  CASE WHEN sum(tokens_delta) > 0 THEN 'BUY' ELSE 'SELL' END as trade_type,
  abs(sum(tokens_delta)) as tokens,
  abs(sum(usdc_delta)) as usdc_amount,
  abs(sum(usdc_delta)) / abs(sum(tokens_delta)) as avg_price,
  count() as fills
FROM pm_canonical_fills_v4
WHERE wallet = {wallet:String}
  AND source = 'clob'
GROUP BY tx_hash, condition_id
ORDER BY trade_time DESC
LIMIT 100
```

### 2. Position Trade Breakdown (Dropdown on Wallet Page)

For a specific position, show all trades that built it:

```sql
-- Get all trades for a specific position
SELECT
  tx_hash,
  min(event_time) as trade_time,
  CASE WHEN sum(tokens_delta) > 0 THEN 'BUY' ELSE 'SELL' END as trade_type,
  abs(sum(tokens_delta)) as tokens,
  abs(sum(usdc_delta)) as usdc_amount,
  abs(sum(usdc_delta)) / nullIf(abs(sum(tokens_delta)), 0) as avg_price,
  count() as fills
FROM pm_canonical_fills_v4
WHERE wallet = {wallet:String}
  AND condition_id = {condition_id:String}
  AND outcome_index = {outcome_index:UInt8}
  AND source = 'clob'
GROUP BY tx_hash
ORDER BY trade_time ASC
```

### 3. Copy Trading Detection

Detect new trades to copy in real-time:

```sql
-- Find new BUY trades from target wallet since last check
SELECT
  tx_hash,
  condition_id,
  outcome_index,
  min(event_time) as trade_time,
  sum(tokens_delta) as net_tokens,
  sum(abs(usdc_delta)) as cost_usd,
  sum(abs(usdc_delta)) / sum(tokens_delta) as entry_price
FROM pm_canonical_fills_v4
WHERE wallet = {target_wallet:String}
  AND source = 'clob'
  AND tokens_delta > 0  -- BUY trades only
  AND event_time > {last_checked:DateTime}
GROUP BY tx_hash, condition_id, outcome_index
ORDER BY trade_time ASC
```

### 4. Trade-Level ROI Calculation

For backtesting copy trading performance:

```sql
WITH buy_trades AS (
  SELECT
    tx_hash,
    wallet,
    condition_id,
    outcome_index,
    min(event_time) as entry_time,
    sum(tokens_delta) as tokens,
    sum(abs(usdc_delta)) as cost_usd,
    sum(abs(usdc_delta)) / sum(tokens_delta) as entry_price
  FROM pm_canonical_fills_v4
  WHERE source = 'clob' AND tokens_delta > 0
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT
  b.*,
  CASE
    WHEN r.payout_numerators = '[1,1]' THEN 0.5
    WHEN r.payout_numerators = '[0,1]' AND b.outcome_index = 1 THEN 1.0
    WHEN r.payout_numerators = '[1,0]' AND b.outcome_index = 0 THEN 1.0
    ELSE 0.0
  END as payout_rate,
  (tokens * payout_rate - cost_usd) / cost_usd as roi
FROM buy_trades b
JOIN pm_condition_resolutions r ON b.condition_id = r.condition_id
WHERE r.is_deleted = 0
```

## UI Implementation Guide

### Activity Tab (Trade History)

**Display columns:**
| Column | Source |
|--------|--------|
| Time | `min(event_time)` |
| Market | Join to `pm_market_metadata.question` |
| Side | BUY/SELL from net `tokens_delta` |
| Tokens | `abs(sum(tokens_delta))` |
| Price | `usdc / tokens` |
| Value | `abs(sum(usdc_delta))` |
| Fills | `count()` |

**Expandable row:** Click to show individual fills within the trade.

### Position Trades Dropdown

When user clicks a position row, show:

```
Position: "Will Trump win?" - YES
Net: 1,500 tokens @ $0.45 avg

▼ Trades (3)
┌─────────────────┬──────┬────────┬─────────┬────────┐
│ Time            │ Side │ Tokens │ Price   │ Fills  │
├─────────────────┼──────┼────────┼─────────┼────────┤
│ Jan 10, 2:30pm  │ BUY  │ 1,000  │ $0.42   │ 12     │
│ Jan 12, 4:15pm  │ BUY  │ 800    │ $0.48   │ 5      │
│ Jan 13, 11:00am │ SELL │ 300    │ $0.52   │ 3      │
└─────────────────┴──────┴────────┴─────────┴────────┘
```

### Implementation Notes

1. **Sort order:** Trades by `trade_time ASC` (earliest first)
2. **Expandable fills:** Optional - show raw fills if user wants granularity
3. **Link to block explorer:** Use `tx_hash` to link to Polygonscan
4. **Caching:** Trade data is immutable - cache aggressively

## Key Filters

Always apply these filters for clean data:

```sql
WHERE source = 'clob'                              -- CLOB trades only
  AND NOT (is_self_fill = 1 AND is_maker = 1)      -- Exclude self-fill maker side
  AND wallet != '0x0000000000000000000000000000000000000000'  -- Exclude null address
```

**Optional additional filters:**
- `abs(usdc_delta / tokens_delta) BETWEEN 0.02 AND 0.98` - Valid prices only
- `abs(usdc_delta) > 0.01` - Exclude dust trades

## Performance Considerations

- **Index on tx_hash:** Already exists in table sort key
- **Partition by date:** Consider for large time ranges
- **Pre-aggregate:** For frequently accessed wallets, cache trade-level data
- **Limit fills display:** Cap at 100 fills per trade in UI

## Related Tables

| Table | Purpose |
|-------|---------|
| `pm_canonical_fills_v4` | Raw fill data |
| `pm_condition_resolutions` | Market outcomes |
| `pm_market_metadata` | Market names/questions |
| `pm_wallet_copy_trading_metrics_v1` | Pre-computed wallet metrics |

## References

- V8 backtester: `scripts/top-asinh-v8-trades.ts`
- PnL engine: `lib/pnl/pnlEngineV1.ts`
- Position builder: `lib/wallet-intelligence/positionBuilder.ts`
