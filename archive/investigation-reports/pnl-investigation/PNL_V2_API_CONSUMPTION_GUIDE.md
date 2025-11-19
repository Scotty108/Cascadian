# PnL V2 API Consumption Guide

**Target Audience:** Frontend developers building Next.js API routes for the Cascadian UI
**Last Updated:** 2025-01-16
**Status:** Production-ready

---

## Table of Contents

1. [Overview](#overview)
2. [Data Architecture](#data-architecture)
3. [Views Reference](#views-reference)
4. [API Patterns](#api-patterns)
5. [Performance Guidelines](#performance-guidelines)
6. [Example API Routes](#example-api-routes)
7. [Field Reference](#field-reference)

---

## Overview

The PnL V2 system provides two main views optimized for API consumption:

- **`vw_wallet_leaderboard_v2`**: Wallet rankings and summary metrics
- **`vw_wallet_positions_v2`**: Individual wallet position details

Both views sit on top of materialized tables (`pm_wallet_summary_v2` and `pm_wallet_market_pnl_v2`) that are automatically updated by the PnL pipeline.

### Key Principles

- **Read-only**: Views are for SELECT queries only
- **Pre-aggregated**: Data is pre-computed; no complex joins needed in API layer
- **Indexed**: Base tables are indexed for fast lookups
- **No window functions**: Rankings computed application-side for better performance

---

## Data Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Layer (Next.js)                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Views (Read-only Layer)                     │
│  • vw_wallet_leaderboard_v2 ─────► pm_wallet_summary_v2    │
│  • vw_wallet_positions_v2   ─────► pm_wallet_market_pnl_v2 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            Base Tables (Materialized, Auto-Updated)          │
│  • pm_wallet_summary_v2      (wallet aggregates)            │
│  • pm_wallet_market_pnl_v2   (position-level data)          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 Source Tables (Trade Data)                   │
│  • pm_trades_canonical_v2    (valid trades)                 │
│  • pm_trades_orphaned_v2     (unresolved trades)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Views Reference

### `vw_wallet_leaderboard_v2`

**Purpose:** Wallet rankings for leaderboard UI
**Base Table:** `pm_wallet_summary_v2`
**Primary Key:** `wallet_address`
**Performance:** ~150-250ms for top 100 queries

**Use Cases:**
- Leaderboard page (top wallets by P&L or volume)
- Wallet search results
- Performance comparisons

**SQL Definition:**

```sql
-- Location: sql/views/vw_wallet_leaderboard_v2.sql
CREATE VIEW IF NOT EXISTS vw_wallet_leaderboard_v2 AS
SELECT
  wallet_address,
  total_pnl_usd,
  realized_pnl_usd,
  unrealized_pnl_usd,
  settlement_pnl_usd,
  total_trades,
  total_markets,
  total_volume_usd,
  win_rate,
  avg_pnl_per_market,
  avg_pnl_per_trade,
  max_profit_usd,
  max_loss_usd,
  days_active,
  first_trade_at,
  last_trade_at,
  open_positions,
  closed_positions,
  resolved_positions,
  CASE WHEN total_pnl_usd > 0 THEN 1 ELSE 0 END AS is_profitable,
  created_at,
  updated_at
FROM pm_wallet_summary_v2;
```

---

### `vw_wallet_positions_v2`

**Purpose:** Position details for wallet detail pages
**Base Table:** `pm_wallet_market_pnl_v2`
**Primary Key:** `(wallet_address, condition_id_norm, outcome_index)`
**Performance:** ~50-500ms depending on position count

**Use Cases:**
- Wallet detail page (all positions)
- Open positions monitoring
- Position history

**SQL Definition:**

```sql
-- Location: sql/views/vw_wallet_positions_v2.sql
CREATE VIEW IF NOT EXISTS vw_wallet_positions_v2 AS
SELECT
  wallet_address,
  condition_id_norm,
  outcome_index,
  market_id_norm,
  total_trades,
  buy_trades,
  sell_trades,
  total_bought_shares,
  total_sold_shares,
  final_position_size,
  total_cost_usd,
  total_proceeds_usd,
  avg_entry_price,
  avg_exit_price,
  realized_pnl_usd,
  unrealized_pnl_usd,
  settlement_pnl_usd,
  total_pnl_usd,
  is_resolved,
  resolved_at,
  winning_outcome,
  payout_per_share,
  current_market_price,
  price_updated_at,
  covered_volume_usd,
  orphan_volume_usd,
  coverage_pct,
  first_trade_at,
  last_trade_at,
  CASE WHEN final_position_size != 0 THEN 1 ELSE 0 END AS is_open_position,
  created_at,
  updated_at
FROM pm_wallet_market_pnl_v2;
```

---

## API Patterns

### Pattern 1: Leaderboard (Top 100 by P&L)

**Endpoint:** `GET /api/leaderboard?sort=pnl&limit=100&offset=0`

```sql
SELECT *
FROM vw_wallet_leaderboard_v2
ORDER BY total_pnl_usd DESC
LIMIT 100
OFFSET 0;
```

**TypeScript Example:**

```typescript
// app/api/leaderboard/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sort = searchParams.get('sort') || 'pnl';
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  const orderByColumn = sort === 'volume' ? 'total_volume_usd' : 'total_pnl_usd';

  const query = `
    SELECT *
    FROM vw_wallet_leaderboard_v2
    ORDER BY ${orderByColumn} DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  // Compute rank application-side
  const withRank = data.map((row, index) => ({
    ...row,
    rank: offset + index + 1,
  }));

  return Response.json({ data: withRank });
}
```

---

### Pattern 2: Wallet Detail (All Positions)

**Endpoint:** `GET /api/wallets/[address]/positions`

```sql
SELECT *
FROM vw_wallet_positions_v2
WHERE wallet_address = '0x...'
ORDER BY abs(total_pnl_usd) DESC;
```

**TypeScript Example:**

```typescript
// app/api/wallets/[address]/positions/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const walletAddress = params.address.toLowerCase();

  const query = `
    SELECT *
    FROM vw_wallet_positions_v2
    WHERE wallet_address = '${walletAddress}'
    ORDER BY abs(total_pnl_usd) DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = await result.json();

  return Response.json({ positions });
}
```

---

### Pattern 3: Profitable Wallets Only

**Endpoint:** `GET /api/leaderboard?filter=profitable`

```sql
SELECT *
FROM vw_wallet_leaderboard_v2
WHERE is_profitable = 1
ORDER BY total_pnl_usd DESC
LIMIT 100;
```

---

### Pattern 4: Open Positions Only

**Endpoint:** `GET /api/wallets/[address]/positions?status=open`

```sql
SELECT *
FROM vw_wallet_positions_v2
WHERE wallet_address = '0x...'
  AND is_open_position = 1
ORDER BY abs(total_pnl_usd) DESC;
```

---

### Pattern 5: Pagination with Total Count

```typescript
// Get total count for pagination
const countQuery = `
  SELECT COUNT(*) AS total
  FROM vw_wallet_leaderboard_v2
  WHERE is_profitable = 1
`;

const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
const { total } = (await countResult.json())[0];

const page = parseInt(searchParams.get('page') || '1');
const pageSize = 100;
const offset = (page - 1) * pageSize;

const dataQuery = `
  SELECT *
  FROM vw_wallet_leaderboard_v2
  WHERE is_profitable = 1
  ORDER BY total_pnl_usd DESC
  LIMIT ${pageSize}
  OFFSET ${offset}
`;

const dataResult = await clickhouse.query({ query: dataQuery, format: 'JSONEachRow' });
const data = await dataResult.json();

return Response.json({
  data,
  pagination: {
    page,
    pageSize,
    total: parseInt(total),
    totalPages: Math.ceil(parseInt(total) / pageSize),
  },
});
```

---

## Performance Guidelines

### Query Performance Targets

| Query Type | Target | Actual (Benchmark) |
|------------|--------|-------------------|
| Top 100 by P&L | < 200ms | 247ms |
| Top 100 by volume | < 200ms | 151ms ✅ |
| Wallet positions (typical) | < 50ms | ~100ms |
| Wallet positions (high-volume) | < 500ms | 379-4617ms |

### Optimization Tips

1. **Always use ORDER BY + LIMIT**: Don't fetch all rows
2. **Avoid SELECT ***: Select only needed fields in production
3. **Cache aggressively**: Leaderboard data changes slowly (15-min cache)
4. **Paginate large result sets**: Use LIMIT + OFFSET
5. **Compute ranks application-side**: Avoid window functions in SQL
6. **Filter early**: Use WHERE clauses before ORDER BY
7. **Consider materialized views**: For frequently accessed complex queries

### Caching Strategy

```typescript
// Recommended caching for leaderboard
export const revalidate = 900; // 15 minutes

// For wallet-specific queries
export const revalidate = 300; // 5 minutes
```

---

## Example API Routes

### Complete Leaderboard API

```typescript
// app/api/leaderboard/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export const revalidate = 900; // 15 minutes

interface LeaderboardQuery {
  sort?: 'pnl' | 'volume';
  filter?: 'profitable' | 'all';
  limit?: number;
  offset?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const params: LeaderboardQuery = {
    sort: (searchParams.get('sort') as 'pnl' | 'volume') || 'pnl',
    filter: (searchParams.get('filter') as 'profitable' | 'all') || 'all',
    limit: Math.min(parseInt(searchParams.get('limit') || '100'), 1000),
    offset: parseInt(searchParams.get('offset') || '0'),
  };

  // Build WHERE clause
  const whereClauses: string[] = [];
  if (params.filter === 'profitable') {
    whereClauses.push('is_profitable = 1');
  }
  const whereClause = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  // Build ORDER BY clause
  const orderByColumn = params.sort === 'volume'
    ? 'total_volume_usd'
    : 'total_pnl_usd';

  // Query
  const query = `
    SELECT
      wallet_address,
      total_pnl_usd,
      realized_pnl_usd,
      total_trades,
      total_markets,
      total_volume_usd,
      win_rate,
      days_active,
      is_profitable
    FROM vw_wallet_leaderboard_v2
    ${whereClause}
    ORDER BY ${orderByColumn} DESC
    LIMIT ${params.limit}
    OFFSET ${params.offset}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  // Add rank
  const withRank = data.map((row, index) => ({
    ...row,
    rank: params.offset + index + 1,
  }));

  return Response.json({
    data: withRank,
    params,
  });
}
```

---

### Complete Wallet Positions API

```typescript
// app/api/wallets/[address]/positions/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export const revalidate = 300; // 5 minutes

interface PositionsQuery {
  status?: 'all' | 'open' | 'closed';
  limit?: number;
  offset?: number;
}

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const { searchParams } = new URL(request.url);
  const walletAddress = params.address.toLowerCase();

  const queryParams: PositionsQuery = {
    status: (searchParams.get('status') as 'all' | 'open' | 'closed') || 'all',
    limit: Math.min(parseInt(searchParams.get('limit') || '100'), 1000),
    offset: parseInt(searchParams.get('offset') || '0'),
  };

  // Build WHERE clause
  const whereClauses = [`wallet_address = '${walletAddress}'`];

  if (queryParams.status === 'open') {
    whereClauses.push('is_open_position = 1');
  } else if (queryParams.status === 'closed') {
    whereClauses.push('is_open_position = 0');
  }

  const whereClause = whereClauses.join(' AND ');

  // Query
  const query = `
    SELECT
      condition_id_norm,
      outcome_index,
      total_trades,
      final_position_size,
      total_pnl_usd,
      realized_pnl_usd,
      unrealized_pnl_usd,
      settlement_pnl_usd,
      is_resolved,
      is_open_position,
      first_trade_at,
      last_trade_at
    FROM vw_wallet_positions_v2
    WHERE ${whereClause}
    ORDER BY abs(total_pnl_usd) DESC
    LIMIT ${queryParams.limit}
    OFFSET ${queryParams.offset}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = await result.json();

  return Response.json({
    wallet_address: walletAddress,
    positions,
    count: positions.length,
  });
}
```

---

## Field Reference

### `vw_wallet_leaderboard_v2` Fields

| Field | Type | UI-Safe | Description |
|-------|------|---------|-------------|
| `wallet_address` | String | ✅ | Normalized wallet address (lowercase, no 0x prefix) |
| `total_pnl_usd` | Float | ✅ | Total P&L (realized + unrealized + settlement) |
| `realized_pnl_usd` | Float | ✅ | P&L from closed positions |
| `unrealized_pnl_usd` | Float | ⚠️  | Currently always 0 (future feature) |
| `settlement_pnl_usd` | Float | ✅ | P&L from resolved positions |
| `total_trades` | Int | ✅ | Count of all trades |
| `total_markets` | Int | ✅ | Count of unique positions |
| `total_volume_usd` | Float | ✅ | Cumulative trade volume |
| `win_rate` | Float | ✅ | Percentage of profitable positions (0-100) |
| `avg_pnl_per_market` | Float | ✅ | Average P&L per position |
| `avg_pnl_per_trade` | Float | ✅ | Average P&L per trade |
| `max_profit_usd` | Float | ✅ | Largest single position profit |
| `max_loss_usd` | Float | ✅ | Largest single position loss |
| `days_active` | Int | ✅ | Days between first and last trade |
| `first_trade_at` | DateTime | ✅ | Timestamp of first trade |
| `last_trade_at` | DateTime | ✅ | Timestamp of most recent trade |
| `open_positions` | Int | ✅ | Count of positions with shares held |
| `closed_positions` | Int | ✅ | Count of fully exited positions |
| `resolved_positions` | Int | ✅ | Count of settled positions |
| `is_profitable` | Int | ✅ | 1 if total_pnl_usd > 0, else 0 |
| `created_at` | DateTime | ⚠️  | Record creation timestamp (internal) |
| `updated_at` | DateTime | ⚠️  | Last update timestamp (internal) |

**Legend:**
- ✅ **UI-Safe**: Display directly in UI
- ⚠️  **Technical**: Use for internal logic, not primary UI display

---

### `vw_wallet_positions_v2` Fields

| Field | Type | UI-Safe | Description |
|-------|------|---------|-------------|
| `wallet_address` | String | ✅ | Normalized wallet address |
| `condition_id_norm` | String | ✅ | 64-char hex condition ID (no 0x) |
| `outcome_index` | Int | ✅ | Outcome index (0 or 1) |
| `market_id_norm` | String | ⚠️  | Optional market ID (may be null) |
| `total_trades` | Int | ✅ | Total trade count for this position |
| `buy_trades` | Int | ✅ | Count of buy trades |
| `sell_trades` | Int | ✅ | Count of sell trades |
| `total_bought_shares` | Float | ✅ | Total shares bought |
| `total_sold_shares` | Float | ✅ | Total shares sold |
| `final_position_size` | Float | ✅ | Current shares held (bought - sold) |
| `total_cost_usd` | Float | ✅ | Total spent on buys |
| `total_proceeds_usd` | Float | ✅ | Total received from sells |
| `avg_entry_price` | Float | ✅ | Average buy price |
| `avg_exit_price` | Float | ✅ | Average sell price |
| `realized_pnl_usd` | Float | ✅ | P&L from sold shares (FIFO) |
| `unrealized_pnl_usd` | Float | ⚠️  | Always 0 (future: mark-to-market) |
| `settlement_pnl_usd` | Float | ✅ | P&L from resolution payout |
| `total_pnl_usd` | Float | ✅ | Total P&L (realized + settlement) |
| `is_resolved` | Int | ✅ | 1 if market resolved, else 0 |
| `resolved_at` | DateTime | ✅ | Resolution timestamp (nullable) |
| `winning_outcome` | Int | ✅ | Winning outcome index (nullable) |
| `payout_per_share` | Float | ⚠️  | Payout amount per winning share |
| `current_market_price` | Float | ⚠️  | Always null (future feature) |
| `price_updated_at` | DateTime | ⚠️  | Always null (future feature) |
| `covered_volume_usd` | Float | ⚠️  | Trade volume with valid IDs |
| `orphan_volume_usd` | Float | ⚠️  | Trade volume with missing IDs |
| `coverage_pct` | Float | ⚠️  | Percentage of volume with valid IDs |
| `first_trade_at` | DateTime | ✅ | Timestamp of first trade |
| `last_trade_at` | DateTime | ✅ | Timestamp of last trade |
| `is_open_position` | Int | ✅ | 1 if final_position_size != 0, else 0 |
| `created_at` | DateTime | ⚠️  | Record creation timestamp |
| `updated_at` | DateTime | ⚠️  | Last update timestamp |

---

## Notes & Gotchas

### 1. Unrealized P&L is Always Zero

Currently, `unrealized_pnl_usd` is always 0 because real-time market prices are not integrated. This is a future feature.

**UI Guidance:** Don't display unrealized P&L prominently. Focus on `realized_pnl_usd` and `settlement_pnl_usd`.

### 2. Market ID May Be Null

The `market_id_norm` field may be null for some positions due to historical data issues.

**UI Guidance:** Fall back to `condition_id_norm` for position identification.

### 3. Wallet Addresses Have No 0x Prefix

All wallet addresses are normalized (lowercase, no 0x prefix).

**UI Guidance:** Add 0x prefix when displaying to users.

```typescript
const displayAddress = `0x${walletAddress}`;
```

### 4. Rankings Not Pre-Computed

Rankings are **not** stored in the database (to avoid expensive window functions). Compute them application-side using LIMIT + OFFSET.

```typescript
const rank = offset + index + 1;
```

### 5. Coverage Fields Are Internal

Fields like `coverage_pct`, `orphan_volume_usd` are for internal diagnostics. Don't display in primary UI.

---

## Testing

Use the provided validation script to test wallet queries:

```bash
npx tsx scripts/validate-pnl-v2-wallets.ts
```

Run benchmarks to verify performance:

```bash
npx tsx scripts/benchmark-pnl-v2-views.ts
```

---

## Support

For questions or issues:
- Check `/docs/operations/` for operational guides
- Review `/docs/features/leaderboard-*.md` for feature specs
- Consult `/sql/views/` for view definitions

---

**End of Guide**
