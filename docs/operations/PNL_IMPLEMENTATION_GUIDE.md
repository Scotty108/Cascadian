# P&L Implementation Guide
**Based on:** Token Mapping Investigation (2025-11-11)
**Status:** Ready to implement
**Estimated Time:** 2-3 hours

---

## Overview

This guide provides the exact SQL patterns and implementation steps for calculating wallet P&L based on the validated token mapping data.

---

## Phase 1: Enrich Fills with Outcome Index (30 minutes)

### Create Enriched Fills View

```sql
CREATE OR REPLACE VIEW clob_fills_enriched AS
SELECT
  f.fill_id,
  f.proxy_wallet,
  f.user_eoa,
  f.condition_id,
  f.asset_id,
  f.side,
  f.price,
  f.size,
  f.fee_rate_bps,
  f.timestamp,
  f.tx_hash,
  t.outcome_index,
  -- Calculate cost basis per fill
  CASE
    WHEN f.side = 'BUY' THEN f.size * f.price
    WHEN f.side = 'SELL' THEN -f.size * (1 - f.price)
    ELSE 0
  END as cost_basis_usd
FROM clob_fills f
INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
WHERE f.asset_id != ''
  AND f.proxy_wallet != ''
```

**Validation Query:**
```sql
SELECT
  count() as total_enriched,
  countIf(outcome_index IS NOT NULL) as with_outcome,
  uniq(proxy_wallet) as unique_wallets
FROM clob_fills_enriched
-- Expected: 38.9M fills, 100% with outcome, ~thousands of unique wallets
```

---

## Phase 2: Aggregate Positions by Wallet (45 minutes)

### Create Wallet Positions Table

```sql
CREATE TABLE wallet_positions_by_outcome (
  proxy_wallet String,
  condition_id String,
  outcome_index Int16,

  -- Position aggregates
  total_size_bought Float64,
  total_size_sold Float64,
  net_position Float64,  -- bought - sold

  -- Cost basis
  total_cost_basis_buy Float64,
  total_cost_basis_sell Float64,
  net_cost_basis Float64,  -- buy cost - sell proceeds

  -- Weighted averages
  avg_buy_price Float64,
  avg_sell_price Float64,

  -- Metadata
  first_trade_timestamp DateTime,
  last_trade_timestamp DateTime,
  trade_count UInt32,

  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (proxy_wallet, condition_id, outcome_index)
```

### Populate Positions

```sql
INSERT INTO wallet_positions_by_outcome
SELECT
  proxy_wallet,
  condition_id,
  outcome_index,

  -- Sizes
  sumIf(size, side = 'BUY') as total_size_bought,
  sumIf(size, side = 'SELL') as total_size_sold,
  sumIf(size, side = 'BUY') - sumIf(size, side = 'SELL') as net_position,

  -- Cost basis
  sumIf(cost_basis_usd, side = 'BUY') as total_cost_basis_buy,
  -sumIf(cost_basis_usd, side = 'SELL') as total_cost_basis_sell,  -- Note: negative because cost_basis_usd is negative for SELL
  sumIf(cost_basis_usd, side = 'BUY') + sumIf(cost_basis_usd, side = 'SELL') as net_cost_basis,

  -- Averages
  avgIf(price, side = 'BUY') as avg_buy_price,
  avgIf(price, side = 'SELL') as avg_sell_price,

  -- Metadata
  min(timestamp) as first_trade_timestamp,
  max(timestamp) as last_trade_timestamp,
  count() as trade_count,

  now() as updated_at
FROM clob_fills_enriched
GROUP BY proxy_wallet, condition_id, outcome_index
```

**Validation Query:**
```sql
SELECT
  count() as total_positions,
  countIf(net_position > 0) as long_positions,
  countIf(net_position < 0) as short_positions,
  countIf(net_position = 0) as closed_positions
FROM wallet_positions_by_outcome
```

---

## Phase 3: Join Market Resolutions (45 minutes)

### Prerequisite: Market Resolution Data

**Required Table:** `gamma_markets` (already exists)
**Required Fields:**
- `condition_id` - Match with positions
- `closed` - Market status (1 = resolved)
- Need to add: `winning_index` field

**TODO:** Investigate where `winning_index` data comes from:
- Check `gamma_markets.outcome` field
- Check if resolution data exists in another table
- May need to backfill from Polymarket API

### Create Resolved Positions View (once resolution data available)

```sql
CREATE OR REPLACE VIEW wallet_positions_resolved AS
SELECT
  p.proxy_wallet,
  p.condition_id,
  p.outcome_index,
  p.net_position,
  p.net_cost_basis,
  m.winning_index,

  -- Realized P&L calculation
  CASE
    WHEN m.winning_index = p.outcome_index THEN p.net_position - p.net_cost_basis
    ELSE -p.net_cost_basis
  END as realized_pnl_usd,

  -- Metadata
  p.first_trade_timestamp,
  p.last_trade_timestamp,
  p.trade_count
FROM wallet_positions_by_outcome p
INNER JOIN gamma_markets m ON p.condition_id = m.condition_id
WHERE m.closed = 1
  AND m.winning_index IS NOT NULL
```

---

## Phase 4: Calculate Wallet Total P&L (30 minutes)

### Create Wallet P&L Summary Table

```sql
CREATE TABLE wallet_pnl_summary (
  proxy_wallet String,

  -- Realized P&L (closed positions)
  total_realized_pnl Float64,
  winning_positions_count UInt32,
  losing_positions_count UInt32,

  -- Unrealized P&L (open positions)
  total_unrealized_pnl Float64,
  open_positions_count UInt32,

  -- Combined
  total_pnl Float64,  -- realized + unrealized

  -- Win rate
  win_rate Float64,  -- winning / (winning + losing)

  -- Metadata
  first_trade_date DateTime,
  last_trade_date DateTime,
  total_trades UInt32,
  unique_markets UInt32,

  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY proxy_wallet
```

### Populate Summary

```sql
INSERT INTO wallet_pnl_summary
WITH resolved_pnl AS (
  SELECT
    proxy_wallet,
    sum(realized_pnl_usd) as total_realized_pnl,
    countIf(realized_pnl_usd > 0) as winning_positions_count,
    countIf(realized_pnl_usd <= 0) as losing_positions_count,
    min(first_trade_timestamp) as first_trade,
    max(last_trade_timestamp) as last_trade,
    sum(trade_count) as total_trades,
    uniq(condition_id) as unique_markets
  FROM wallet_positions_resolved
  GROUP BY proxy_wallet
),
unrealized_pnl AS (
  SELECT
    p.proxy_wallet,
    -- TODO: Calculate unrealized P&L based on current market prices
    0 as total_unrealized_pnl,
    count() as open_positions_count
  FROM wallet_positions_by_outcome p
  LEFT JOIN gamma_markets m ON p.condition_id = m.condition_id
  WHERE m.closed = 0 OR m.winning_index IS NULL
  GROUP BY p.proxy_wallet
)
SELECT
  coalesce(r.proxy_wallet, u.proxy_wallet) as proxy_wallet,
  coalesce(r.total_realized_pnl, 0) as total_realized_pnl,
  coalesce(r.winning_positions_count, 0) as winning_positions_count,
  coalesce(r.losing_positions_count, 0) as losing_positions_count,
  coalesce(u.total_unrealized_pnl, 0) as total_unrealized_pnl,
  coalesce(u.open_positions_count, 0) as open_positions_count,
  coalesce(r.total_realized_pnl, 0) + coalesce(u.total_unrealized_pnl, 0) as total_pnl,
  CASE
    WHEN r.winning_positions_count + r.losing_positions_count > 0
    THEN r.winning_positions_count::Float64 / (r.winning_positions_count + r.losing_positions_count)
    ELSE 0
  END as win_rate,
  r.first_trade as first_trade_date,
  r.last_trade as last_trade_date,
  coalesce(r.total_trades, 0) as total_trades,
  coalesce(r.unique_markets, 0) as unique_markets,
  now() as updated_at
FROM resolved_pnl r
FULL OUTER JOIN unrealized_pnl u ON r.proxy_wallet = u.proxy_wallet
```

---

## API Integration

### Endpoint: `/api/wallets/:address/pnl`

```typescript
// app/api/wallets/[address]/pnl/route.ts
import { clickhouse } from '@/lib/clickhouse/client'

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const { address } = params

  const result = await clickhouse.query({
    query: `
      SELECT
        proxy_wallet,
        total_realized_pnl,
        total_unrealized_pnl,
        total_pnl,
        winning_positions_count,
        losing_positions_count,
        win_rate,
        total_trades,
        unique_markets
      FROM wallet_pnl_summary
      WHERE proxy_wallet = {address:String}
    `,
    query_params: { address },
    format: 'JSONEachRow'
  })

  const data = await result.json()

  if (data.length === 0) {
    return Response.json({ error: 'Wallet not found' }, { status: 404 })
  }

  return Response.json(data[0])
}
```

### Endpoint: `/api/leaderboard/pnl`

```typescript
// app/api/leaderboard/pnl/route.ts
import { clickhouse } from '@/lib/clickhouse/client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const minTrades = parseInt(searchParams.get('min_trades') || '10')

  const result = await clickhouse.query({
    query: `
      SELECT
        proxy_wallet,
        total_pnl,
        total_realized_pnl,
        win_rate,
        total_trades,
        unique_markets
      FROM wallet_pnl_summary
      WHERE total_trades >= {minTrades:UInt32}
      ORDER BY total_pnl DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { limit, minTrades },
    format: 'JSONEachRow'
  })

  const data = await result.json()
  return Response.json(data)
}
```

---

## Testing & Validation

### Test 1: Sample Wallet P&L
```sql
-- Pick a known active wallet
SELECT * FROM wallet_pnl_summary
WHERE proxy_wallet = '0x4bfb41d5b4962dc8f041c07e23b7c7e7c6bfb40e'
```

### Test 2: Leaderboard
```sql
SELECT
  proxy_wallet,
  total_pnl,
  win_rate,
  total_trades
FROM wallet_pnl_summary
WHERE total_trades >= 10
ORDER BY total_pnl DESC
LIMIT 20
```

### Test 3: Position Detail
```sql
SELECT
  condition_id,
  outcome_index,
  net_position,
  net_cost_basis,
  realized_pnl_usd
FROM wallet_positions_resolved
WHERE proxy_wallet = '0x4bfb41d5b4962dc8f041c07e23b7c7e7c6bfb40e'
ORDER BY realized_pnl_usd DESC
LIMIT 10
```

---

## Maintenance & Updates

### Incremental Updates (for new fills)

```sql
-- After new fills are ingested, update positions
INSERT INTO wallet_positions_by_outcome
SELECT
  proxy_wallet,
  condition_id,
  outcome_index,
  sumIf(size, side = 'BUY') as total_size_bought,
  sumIf(size, side = 'SELL') as total_size_sold,
  sumIf(size, side = 'BUY') - sumIf(size, side = 'SELL') as net_position,
  sumIf(cost_basis_usd, side = 'BUY') as total_cost_basis_buy,
  -sumIf(cost_basis_usd, side = 'SELL') as total_cost_basis_sell,
  sumIf(cost_basis_usd, side = 'BUY') + sumIf(cost_basis_usd, side = 'SELL') as net_cost_basis,
  avgIf(price, side = 'BUY') as avg_buy_price,
  avgIf(price, side = 'SELL') as avg_sell_price,
  min(timestamp) as first_trade_timestamp,
  max(timestamp) as last_trade_timestamp,
  count() as trade_count,
  now() as updated_at
FROM clob_fills_enriched
WHERE timestamp > (SELECT max(last_trade_timestamp) FROM wallet_positions_by_outcome)
GROUP BY proxy_wallet, condition_id, outcome_index
```

### Refresh Summary (periodic job)

```sql
-- Run every 5 minutes or on-demand
TRUNCATE TABLE wallet_pnl_summary;
INSERT INTO wallet_pnl_summary (/* full query from Phase 4 */);
```

---

## Current Blockers

1. **Missing `winning_index` data** - Need to:
   - Check gamma_markets.outcome field structure
   - Identify resolution data source
   - Backfill winning_index for closed markets

2. **Unrealized P&L** - Need current market prices to calculate

---

## Next Steps

1. ✅ Token mapping validated (this guide)
2. 🔄 Investigate market resolution data
3. ⏳ Implement enriched fills view
4. ⏳ Build position aggregation
5. ⏳ Create P&L summary tables
6. ⏳ Build API endpoints
7. ⏳ Connect to frontend dashboard

**Estimated Total Time:** 6-8 hours for complete implementation

---

**Guide Created:** 2025-11-11
**Agent:** Claude (Database Architect)
**Status:** Ready for implementation once resolution data is available
