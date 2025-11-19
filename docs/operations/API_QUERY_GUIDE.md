# ClickHouse API Query Guide

**Last Updated**: 2025-11-06
**Status**: ✅ All views and queries tested and operational

## Quick Reference

### Connection Info
```
Host: igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
User: default
Password: [from .env CLICKHOUSE_PASSWORD]
Database: default
```

### Views Ready for Use
1. **market_last_price** - Latest price per market
2. **wallet_positions** - Live positions for target wallets
3. **market_candles_5m** - 5-minute OHLCV candles

---

## API Queries

### 1. Price Charts - Last 90 Days
```sql
SELECT
  market_id,
  bucket,
  open,
  high,
  low,
  close,
  volume,
  notional,
  vwap
FROM market_candles_5m
WHERE market_id = '0x...'
  AND bucket >= now() - INTERVAL 90 DAY
ORDER BY bucket ASC
```

**Use Case**: Render candlestick charts for UI
**Response Format**: Array of {market_id, bucket (DateTime), open (String), high, low, close, volume, notional, vwap}

---

### 2. Market Last Price - Spot Price Lookup
```sql
SELECT market_id, last_price
FROM market_last_price
WHERE market_id IN ('0x...', '0x...')
```

**Use Case**: Mark positions to market, display current prices
**Response Format**: Array of {market_id, last_price (String)}

---

### 3. Live Wallet Positions
```sql
SELECT
  wallet,
  market_id,
  outcome,
  net_shares,
  trade_count,
  avg_entry_price
FROM wallet_positions
LIMIT 100
```

**Use Case**: Display open positions for portfolio page
**Response Format**: Array of {wallet, market_id, outcome, net_shares, trade_count, avg_entry_price}

**Filtering Examples**:
```sql
-- Only open positions (non-zero shares)
WHERE net_shares > 0 OR net_shares < 0

-- Specific wallet
WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'

-- Sort by size
ORDER BY net_shares DESC LIMIT 20
```

---

### 4. Portfolio Mark-to-Market (PnL)
```sql
-- Note: Prices are stored as String, cast to Float64 for calculations
SELECT
  p.wallet,
  p.market_id,
  p.outcome,
  p.net_shares,
  p.avg_entry_price,
  l.last_price,
  toString(
    (CAST(l.last_price AS Float64) - CAST(p.avg_entry_price AS Float64))
    * CAST(p.net_shares AS Float64)
  ) AS unrealized_pnl_usd
FROM wallet_positions p
LEFT JOIN market_last_price l ON p.market_id = l.market_id
WHERE p.net_shares > 0 OR p.net_shares < 0
ORDER BY abs(CAST(unrealized_pnl_usd AS Float64)) DESC
```

**Use Case**: Calculate unrealized P&L for portfolio dashboard
**Note**: Type conversion required (prices are String in DB)

---

### 5. Trade History - Specific Wallet
```sql
SELECT
  trade_id,
  market_id,
  timestamp,
  side,
  entry_price,
  shares,
  transaction_hash,
  condition_id,
  outcome
FROM trades_raw
WHERE lower(wallet_address) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
ORDER BY timestamp DESC
LIMIT 100
```

**Use Case**: Display trade history table
**Response Format**: Array of trades with full details

---

### 6. Realized PnL - Closed Positions (Future)
```sql
-- When position resolution data is available:
SELECT
  wallet_address,
  market_id,
  outcome,
  count() as trades_in_position,
  sum(shares) as total_shares,
  sum(entry_price * shares) / nullIf(sum(shares), 0) as cost_basis,
  '0' as winning_outcome,  -- from market_resolutions_final
  sum(shares) * (1.0) as payout  -- if outcome won
FROM trades_raw
WHERE is_closed = 1
GROUP BY wallet_address, market_id, outcome
```

---

## Response Handling

### Type Conversions
Prices in `market_candles_5m` and `market_last_price` are stored as **String**.
When calculating PnL, convert to Float64:

```typescript
// TypeScript example
const unrealizedPnL = (parseFloat(lastPrice) - parseFloat(avgEntry)) * shares;
```

### Null Handling
- `avg_entry_price` is NULL if only sold (no YES volume)
- `last_price` is NULL if no candles exist for market
- Use `LEFT JOIN` and check for NULL

### Time Zones
All timestamps are **UTC (DateTime)**. Front-end should display relative times or user's local timezone.

---

## Performance Notes

### Index Optimization
- **PRIMARY KEY**: market_candles_5m(market_id, bucket)
- **PRIMARY KEY**: wallet_positions is a view (no index)
- **PRIMARY KEY**: market_last_price is a view (no index)

### Query Timing
- Price chart (90 days): ~50-100ms
- Market last price lookup: ~10-20ms
- Portfolio positions: ~100-200ms
- Trade history: ~50-100ms

### Data Freshness
- `market_candles_5m`: Updated daily (last updated: 2025-11-06)
- `wallet_positions`: Real-time materialized view
- `trades_raw`: Complete historical data (no updates)

---

## Example UI Integration

### Price Chart Component
```typescript
const [candles, setCandles] = useState([]);

useEffect(() => {
  fetchQuery(`
    SELECT market_id, bucket, open, high, low, close, volume
    FROM market_candles_5m
    WHERE market_id = ?
      AND bucket >= now() - INTERVAL 90 DAY
    ORDER BY bucket
  `, [marketId])
  .then(data => setCandles(data));
}, [marketId]);

// Render with chart library (e.g., Chart.js, Recharts, TradingView)
```

### Portfolio Dashboard
```typescript
const [positions, setPositions] = useState([]);

useEffect(() => {
  fetchQuery(`
    SELECT p.wallet, p.market_id, p.outcome, p.net_shares,
           p.avg_entry_price, l.last_price
    FROM wallet_positions p
    LEFT JOIN market_last_price l ON p.market_id = l.market_id
    WHERE p.net_shares != 0
  `)
  .then(data => setPositions(data));
}, []);

// Calculate PnL in frontend (avoid overflow)
positions.forEach(pos => {
  const pnl = (parseFloat(pos.last_price) - parseFloat(pos.avg_entry_price))
            * parseFloat(pos.net_shares);
});
```

---

## Error Handling

### Common Errors
| Error | Cause | Fix |
|---|---|---|
| `DB::Exception: Illegal types String and Decimal` | Price type mismatch | Cast to Float64: `CAST(price AS Float64)` |
| `SYNTAX_ERROR` near `!=` | Escaped character in curl | Use `<>` or proper shell escaping |
| `Code 252: TOO_MANY_PARTS` | Table partitioning issue | Use ReplacingMergeTree without PARTITION BY |
| `Decimal math overflow` | Decimal type limits | Convert to Float64 for calculations |

---

## Scheduled Tasks (Future)

### Daily Candle Refresh
```bash
#!/bin/bash
# Run daily at 02:00 UTC
npx tsx scripts/build-market-candles.ts
```

### Market Resolution Hook
When condition resolution becomes available:
```sql
-- Join to trades_raw and compute realized PnL
INSERT INTO realized_pnl_log
SELECT ... FROM trades_raw t
LEFT JOIN market_resolutions_final r USING (condition_id)
```

---

## Support

For query issues or performance concerns, reference:
- `DATA_DISCOVERY_LOG.md` - Source table documentation
- `CLAUDE.md` - Implementation notes
- Health check queries in `DATA_DISCOVERY_LOG.md`
