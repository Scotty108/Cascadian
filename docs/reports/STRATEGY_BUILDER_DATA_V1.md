# Strategy Builder Data Layer V1

**Terminal:** Claude 2
**Date:** 2025-12-07
**Status:** V1 Complete

---

## Overview

This document describes the Strategy Builder Data Layer V1 implementation, which adds real-time market data and wallet cohort capabilities to the Strategy Builder.

### What is Live

| Component | Status | Data Source |
|-----------|--------|-------------|
| Dome Market Client | Live | Dome API |
| Market Filter API | Live | Dome API |
| Market Candles API | Live | Dome API |
| Market Price API | Live | Dome API |
| Market Trades API | Live | Dome API |
| Wallet Cohort API | Live | ClickHouse |
| MarketFilterNode | Live | Internal API |
| MarketUniverseNode | Live | Internal API |
| MarketMonitorNode | Live | Internal API |
| WalletCohortNode | Live | Internal API |
| CopyTradeWatchNode | Stub | N/A |

### What is Stubbed

- **Omega filtering** - Disabled in WalletCohortNode until Terminal 1 ships Tier A leaderboard
- **Copy trade execution** - CopyTradeWatchNode is observe-only, no execution logic
- **WebSocket real-time** - MarketMonitorNode supports WS mode flag but currently uses polling

---

## Strategy Builder Node Types

### 1. MarketFilterNode

**Purpose:** Filter markets from Dome API using tags, volume, status, event slug.

**Input/Output Contract:**
```typescript
// Input: None (root node)
// Output:
{
  markets: Array<{
    market_slug: string;
    condition_id: string;
    title: string;
    status: 'open' | 'closed';
    event_slug?: string;
    tags?: string[];
    volume?: number;
  }>;
  totalCount: number;
}
```

**Default Config:**
```typescript
{
  version: 1,
  status: "open",
  limit: 20
}
```

### 2. MarketUniverseNode

**Purpose:** Display count and sample of markets that pass filters. Groups by event when present.

**Input/Output Contract:**
```typescript
// Input: MarketFilterNode output
// Output: Same as input (pass-through with display)
```

**Default Config:**
```typescript
{
  version: 1,
  show_sample_count: 5,
  group_by_event: false
}
```

### 3. MarketMonitorNode

**Purpose:** Real-time price monitoring with sparkline chart.

**Input/Output Contract:**
```typescript
// Input: Single market from MarketUniverseNode
{
  condition_id: string;
  token_id?: string;
  title: string;
}

// Output:
{
  price: number;
  timestamp: number;
  change?: number;
  priceHistory: number[];
}
```

**Default Config:**
```typescript
{
  version: 1,
  mode: "polling",
  poll_interval_seconds: 60,
  candle_interval: 60,  // 1h
  candle_lookback_hours: 24
}
```

### 4. WalletCohortNode

**Purpose:** Query internal DB for percentile-based wallet cohorts.

**Input/Output Contract:**
```typescript
// Input: None (root node)
// Output:
{
  wallets: Array<{
    wallet_address: string;
    realized_pnl_estimate: number | null;
    trade_count: number;
    clob_only: boolean | null;
    last_trade: string | null;
    omega_ratio: number | null;
    win_rate: number | null;
    confidence_label: 'INTERNAL_PRE_TIER_A' | 'TIER_A' | 'VERIFIED';
  }>;
  totalCount: number;
}
```

**Default Config:**
```typescript
{
  version: 1,
  pnl_percentile: 10,     // Top 10%
  min_trade_count: 10,
  time_window: "30d",
  limit: 50
}
```

### 5. CopyTradeWatchNode

**Purpose:** Observe wallets for trade activity. V1 is observe-only.

**Input/Output Contract:**
```typescript
// Input: WalletCohortNode output
// Output: Activity feed (no execution)
{
  watched_wallets: string[];
  recent_trades: Array<{
    wallet: string;
    side: 'BUY' | 'SELL';
    market: string;
    price: number;
    timestamp: number;
  }>;
}
```

**Default Config:**
```typescript
{
  version: 1,
  watch_mode: "observe",  // No execution
  max_recent_trades: 10,
  show_timestamps: true
}
```

---

## API Routes

### POST /api/markets/search

**Request:**
```json
{
  "tags": ["crypto", "sports"],
  "status": "open",
  "min_volume": 100000,
  "event_slug": ["fed-decisions-2025"],
  "limit": 20,
  "offset": 0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "markets": [...],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 150,
      "has_more": true
    }
  },
  "source": "dome"
}
```

### GET /api/markets/candles

**Request:** `?condition_id=0x...&interval=60&start_time=1733000000&end_time=1733100000`

**Response:**
```json
{
  "success": true,
  "data": {
    "candles": [
      { "timestamp": 1733000000, "open": 0.45, "high": 0.48, "low": 0.44, "close": 0.47 }
    ],
    "stats": {
      "trendSlope": 0.0001,
      "recentVolatility": 0.02,
      "priceChange": 0.02,
      "priceChangePercent": 4.4
    },
    "conditionId": "0x...",
    "interval": 60
  },
  "source": "dome"
}
```

### GET /api/markets/price

**Request:** `?token_id=12345...`

**Response:**
```json
{
  "success": true,
  "data": {
    "price": 0.65,
    "at_time": 1733100000,
    "token_id": "12345..."
  },
  "source": "dome"
}
```

### POST /api/wallets/cohort

**Request:**
```json
{
  "pnl_percentile": 10,
  "min_trade_count": 10,
  "time_window": "30d",
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallets": [
      {
        "wallet_address": "0x...",
        "realized_pnl_estimate": 15000.50,
        "trade_count": 125,
        "clob_only": true,
        "last_trade": "2025-12-06T10:30:00Z",
        "omega_ratio": 2.5,
        "win_rate": 0.62,
        "confidence_label": "INTERNAL_PRE_TIER_A"
      }
    ],
    "filters_applied": {...},
    "total_matching": 50,
    "source": "clickhouse"
  }
}
```

---

## Integration Point for Terminal 1's Tier A Leaderboard

The WalletCohortNode and `/api/wallets/cohort` are designed to accept Terminal 1's Tier A leaderboard as a data source.

**Current State:**
- Queries ClickHouse `wallet_metrics_complete` table
- Returns `confidence_label: 'INTERNAL_PRE_TIER_A'`
- Omega filtering is disabled with "coming soon" message

**Integration Path:**
1. Terminal 1 exposes a Tier A leaderboard file or API endpoint
2. `/api/wallets/cohort` gains a `source: 'tier_a'` option
3. WalletCohortNode config adds `use_tier_a: boolean`
4. When enabled, cohort queries the Tier A manifest instead of ClickHouse
5. `confidence_label` upgrades to `'TIER_A'` or `'VERIFIED'`

**Required Contract from Terminal 1:**
```typescript
interface TierAWallet {
  wallet_address: string;
  realized_pnl: number;
  trade_count: number;
  omega_ratio?: number;
  win_rate?: number;
  clob_only: boolean;
  last_trade_timestamp: number;
  tier: 'A' | 'B' | 'C';
  verification_timestamp: number;
}

interface TierAManifest {
  wallets: TierAWallet[];
  generated_at: string;
  version: string;
}
```

---

## Known Limitations

1. **Dome API Key Required** - Without `DOME_API_KEY` env var, market routes return mock data
2. **No WebSocket in V1** - MarketMonitorNode uses polling; WS support is wired but not active
3. **Omega Disabled** - WalletCohortNode rejects omega_percentile filter requests
4. **No Execution** - CopyTradeWatchNode is observe-only
5. **Projection Node Deferred** - Simple projection helper exists but no node yet

---

## File Inventory

### Dome Client
- `lib/dome/client.ts` - Market data client (listMarkets, getCandles, getMarketPrice, getTradeHistory)
- `lib/dome/wsClient.ts` - WebSocket client (connect, subscribe, onOrder)
- `lib/dome/index.ts` - Module exports

### API Routes
- `app/api/markets/search/route.ts` - Market search proxy
- `app/api/markets/candles/route.ts` - Candlestick data proxy
- `app/api/markets/price/route.ts` - Point price proxy
- `app/api/markets/trades/route.ts` - Trade history proxy
- `app/api/wallets/cohort/route.ts` - Wallet cohort query

### Strategy Builder Nodes
- `components/strategy-nodes/market-filter-node.tsx`
- `components/strategy-nodes/market-universe-node.tsx`
- `components/strategy-nodes/market-monitor-node.tsx`
- `components/strategy-nodes/wallet-cohort-node.tsx`
- `components/strategy-nodes/copy-trade-watch-node.tsx`

### Types
- `lib/strategy-builder/types.ts` - Added MarketFilterConfig, MarketUniverseConfig, etc.

---

## Testing

Run smoke test:
```bash
npx tsx scripts/markets/smoke-strategy-builder-data.ts
```

Run dev server:
```bash
pnpm dev
```

Navigate to `/strategy-builder` and drag new nodes from palette.

---

## Next Steps

1. **Terminal 1 Integration** - When Tier A leaderboard is ready, add `source: 'tier_a'` option
2. **WebSocket Activation** - Enable Dome WS for live order streaming
3. **Projection Node** - Build ProjectionNode using existing `calculateCandleStats`
4. **Config Panels** - Add config panel UI for each new node type
5. **Paper Trading Execution** - Wire CopyTradeWatchNode to paper trading system
