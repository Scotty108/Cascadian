# CASCADIAN Architecture Plan v1.0
## Option B: Custom-First Approach with Mirror Upgrade Path

**Date**: 2025-10-25
**Decision**: Build Live Signals using free data sources, add Goldsky Mirror only when validated
**Cost**: $0/month initially, $73-83/month if Mirror needed later
**Timeline**: 3-4 weeks to full launch

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural Decision](#architectural-decision)
3. [System Architecture](#system-architecture)
4. [Data Sources](#data-sources)
5. [Implementation Phases](#implementation-phases)
6. [Database Schema](#database-schema)
7. [Service Specifications](#service-specifications)
8. [Monitoring & Tripwires](#monitoring--tripwires)
9. [Migration Path to Mirror](#migration-path-to-mirror)
10. [Risk Mitigation](#risk-mitigation)

---

## Executive Summary

### The Decision

We are building CASCADIAN as a **two-tier system**:
- **Tier 1: Discovery** - Elite trader leaderboards, category analytics, 102 metrics (batch updates)
- **Tier 2: Live Signals** - Real-time momentum detection with elite wallet attribution (for watchlist markets)

**Chosen Approach: Option B (Custom-First)**
- Start with FREE data sources (Polymarket WebSocket + Goldsky API polling)
- Signal latency: ~70 seconds (good enough for manual trading)
- Add Goldsky Mirror later ONLY if tripwires fire
- Cost: $0/month initially, validate before spending

### Why Option B Won

**Compared to alternatives:**
- **Option A (Discovery only)**: Too conservative, doesn't validate Live Signals demand
- **Option C (Mirror from day 1)**: Too expensive ($996/year) before validation
- **Option B**: Validates entire vision at zero ongoing cost

**Key insight from analysis:**
- Polymarket WebSocket provides FREE real-time price data (discovered late in analysis)
- Mirror is NOT required for momentum detection (only improves wallet attribution speed)
- 70-second latency is acceptable for manual trading
- Mirror becomes obvious upgrade once users trade at scale

### Success Criteria

**Phase 1 (Discovery) Success:**
- ✅ 100+ active users browsing leaderboards
- ✅ Users favoriting wallets (creates natural watchlist)
- ✅ Average session time >5 minutes
- ✅ Users asking "Can I get alerts when these wallets trade?"

**Phase 2 (Live Signals) Success:**
- ✅ 50+ signals fired per week
- ✅ 10+ users clicking/acting on signals
- ✅ 5+ actual trades executed based on signals
- ✅ Users NOT complaining about 70-second latency

**Triggers for Mirror ($83/month):**
- ❌ Users complaining signals are "too slow"
- ❌ Rate limits hit (>10 429 errors/day)
- ❌ Auto-trading feature requires <30s attribution
- ❌ >20 trades/month executing on signals

---

## Architectural Decision

### The Debate

Three AI analyses (Claude #1, Claude #2, ChatGPT) converged on same architecture:

**All agreed:**
1. Custom price tracker (Polymarket WebSocket) is MANDATORY (no alternatives)
2. Mirror doesn't solve lag simulation or CLV metrics
3. Mirror only improves wallet attribution speed (70s → 13s)
4. Start custom, add Mirror later when validated

**Where we differed:**
- Claude #1 & ChatGPT: "Start custom, add Mirror only if proven necessary"
- Claude #2 (Database Architect): "Use Mirror from day 1 for competitive edge"

**Final synthesis:**
- Database architect was right that speed matters FOR LIVE TRADING
- But Claude #1 was right that we should VALIDATE demand first
- Watchlist architecture (user's insight) resolved this perfectly

### The Watchlist Breakthrough

**Key realization:**
- Don't track ALL 20,000 markets at 10-second intervals (prohibitive)
- Only track USER WATCHLIST markets (50-100 markets)
- Storage: 864k rows/day (vs 172.8M for all markets)
- Cost: Manageable (~2 GB/month vs 400 GB/month)

**How watchlist gets populated:**
1. Users browse Discovery leaderboards
2. Users favorite elite wallets
3. System aggregates: "Which markets do elite wallets trade?"
4. Those markets become watchlist (auto-populated)
5. Live price snapshots ONLY for watchlist markets

### Data Source Analysis

| Data Type | Source | Latency | Cost | Notes |
|-----------|--------|---------|------|-------|
| **Price momentum** | Polymarket WebSocket | <1s | FREE | ✅ Discovered late, game-changer |
| **Wallet attribution** | Goldsky API (polling) | 35-67s | FREE | ⚠️ Rate limits unknown |
| **Wallet attribution (upgrade)** | Goldsky Mirror | 3-5s | $83/mo | 🔄 Add later if needed |
| **Market metadata** | Polymarket Gamma API | Daily | FREE | ✅ Already implemented |
| **Historical trades** | Goldsky Subgraph | Batch | FREE | ✅ Already implemented |

### Performance Comparison

**Signal Latency Timeline:**

```
WITHOUT MIRROR (Option B - FREE):
T+0s:  Elite wallet trades
T+3s:  Price changes (WebSocket broadcast)
T+10s: Momentum detected (our snapshotter)
T+60s: Attribution confirmed (Goldsky API poll)
T+70s: Signal sent to user
       Entry slippage vs elite: ~10-15%

WITH MIRROR (Option C - $83/mo):
T+0s:  Elite wallet trades
T+3s:  Mirror streams trade to ClickHouse
T+3s:  Price changes (WebSocket broadcast)
T+10s: Momentum detected (our snapshotter)
T+13s: Attribution confirmed (Mirror)
T+13s: Signal sent to user
       Entry slippage vs elite: ~1-2%
```

**ROI Analysis:**
- 70s → 13s saves ~10-15% entry slippage
- At $1,000/trade × 10 trades/month = $1,000-1,500 monthly improvement
- Mirror cost: $83/month
- **ROI: ~$920-1,420/month profit** (IF trading at scale)
- **BUT**: Only if users are actually trading (must validate first)

---

## System Architecture

### Two-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│                     TIER 1: DISCOVERY                       │
│  Elite Trader Leaderboards • Category Analytics • 102 Metrics│
├─────────────────────────────────────────────────────────────┤
│  Data Source: Goldsky Subgraph API (batch)                  │
│  Update Frequency: Hourly/Daily                             │
│  Scope: ALL markets, ALL wallets (6,605+)                   │
│  Cost: $0/month                                             │
└─────────────────────────────────────────────────────────────┘
                           ▼
            Users favorite wallets → Creates watchlist
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    TIER 2: LIVE SIGNALS                     │
│  Real-Time Momentum • Elite Wallet Alerts • Auto-Trading    │
├─────────────────────────────────────────────────────────────┤
│  Data Sources:                                              │
│  1. Polymarket WebSocket (price momentum) - FREE            │
│  2. Goldsky API polling (wallet attribution) - FREE         │
│  Update Frequency: 10-second snapshots                      │
│  Scope: WATCHLIST markets only (~50-100)                    │
│  Cost: $0/month                                             │
│                                                             │
│  Optional Upgrade (add later):                              │
│  3. Goldsky Mirror (faster attribution) - $83/month         │
└─────────────────────────────────────────────────────────────┘
```

### One Warehouse (ClickHouse + Supabase)

**ClickHouse** (Time-series analytics):
```
trades_raw              # All wallet trades (from Goldsky)
user_positions          # Materialized view of current positions
price_snapshots_10s     # 10-second price ticks (watchlist only)
market_flow_5m          # Smart money flow (5-minute aggregations)
wallet_metrics_complete # All 102 metrics (4 time windows)
```

**Supabase** (Metadata & Configuration):
```
markets                 # Market metadata + categories (20,219 markets)
wallet_scores           # Discovery leaderboard data
watchlist_markets       # User-selected markets for live tracking
watchlist_wallets       # Elite wallets to monitor
user_strategies         # Custom filter formulas
```

**Key Design Principle:**
- Same schema regardless of data source (Mirror or API)
- Different ingestion modes write to same tables
- No architectural fork when adding Mirror later

---

## Data Sources

### 1. Polymarket WebSocket (Price Momentum)

**Endpoints:**
```typescript
// RTDS (Real-Time Data Socket)
const RTDS_URL = "wss://ws-live-data.polymarket.com";

// CLOB (Central Limit Order Book)
const CLOB_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/";
```

**What we get:**
```typescript
interface PriceUpdate {
  market: string;           // Market slug or ID
  yes_price: number;        // Current YES mid price
  no_price: number;         // Current NO mid price
  yes_bid: number;          // Best YES bid
  yes_ask: number;          // Best YES ask
  spread: number;           // Bid-ask spread
  bid_volume: number;       // Size at best bid
  ask_volume: number;       // Size at best ask
  timestamp: number;        // Unix timestamp
  last_trade_price: number; // Most recent fill price
}
```

**Subscription pattern:**
```typescript
// Subscribe to watchlist markets
rtds.subscribe({
  type: "market",
  market_slugs: watchlistMarkets // ["trump-wins-2024", ...]
});

// Receive updates
rtds.on("price_change", (data: PriceUpdate) => {
  // Sub-second latency
  // Push-based (no polling)
  // Free, no authentication required
});
```

**Characteristics:**
- ✅ FREE (no API key required for public markets)
- ✅ Sub-second latency (push-based)
- ✅ Level 2 data (order book depth)
- ✅ Official TypeScript client available
- ⚠️ Connection limits undocumented (test at scale)
- ⚠️ Reconnection strategy required (handle disconnects)

### 2. Goldsky GraphQL API (Wallet Attribution)

**Endpoint:**
```typescript
const GOLDSKY_ORDERBOOK = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn";
```

**Query for watchlist activity:**
```graphql
query WatchlistActivity($markets: [String!]!, $since: Int!) {
  orderFilledEvents(
    where: {
      market_in: $markets,
      timestamp_gt: $since
    }
    orderBy: timestamp
    orderDirection: desc
    first: 1000
  ) {
    id
    orderHash
    maker
    taker
    makerAssetId
    takerAssetId
    makerAmountFilled
    takerAmountFilled
    fee
    timestamp
    transactionHash
  }
}
```

**Polling pattern:**
```typescript
// Poll every 60 seconds
setInterval(async () => {
  const since = await getLastPollTimestamp();
  const trades = await goldsky.query(WATCHLIST_QUERY, {
    markets: watchlistMarkets,
    since
  });

  // Process and store
  await processAttributionData(trades);
}, 60000);
```

**Characteristics:**
- ✅ FREE (public endpoint)
- ✅ Complete trade data (vs Polymarket API's incomplete data)
- ✅ Already integrated (we have working code)
- ⚠️ Rate limits exist (429 errors observed)
- ⚠️ Polling lag: 35-67 seconds average
- ⚠️ Incremental sync requires cursor management

### 3. Goldsky Mirror (Optional Upgrade)

**When to enable:** Only if tripwires fire (see Monitoring section)

**What it provides:**
```typescript
// Streams same data as API but in real-time
mirror.on("order_filled", (event: OrderFilledEvent) => {
  // 3-5 second latency (vs 60-second polling)
  // Automatic cursor management
  // Handles reorgs
  // Writes directly to ClickHouse
});
```

**Setup (when needed):**
```typescript
const mirror = new GoldskyMirror({
  apiKey: process.env.GOLDSKY_API_KEY,
  pipeline: "polymarket-orderbook",
  sink: {
    type: "clickhouse",
    host: process.env.CLICKHOUSE_HOST,
    database: "cascadian"
  },
  tables: ["trades_raw", "user_positions"]
});
```

**Cost:** $73-83/month (pay-as-you-go after free tier)

### 4. Polymarket Gamma API (Market Metadata)

**Already implemented** - no changes needed

**Endpoint:**
```
https://gamma-api.polymarket.com/events
```

**What we get:**
- Market categories (Politics, Crypto, Sports, etc.)
- Question text and outcomes
- Market metadata
- End dates

**Update frequency:** Daily refresh (categories don't change often)

---

## Implementation Phases

### Phase 0: Schema & Infrastructure (Week 1)

**Goal:** Define data models, create tables, prepare infrastructure

**Tasks:**

1. **Create ClickHouse tables**
```sql
-- price_snapshots_10s (core table for momentum)
CREATE TABLE price_snapshots_10s (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),
  mid_price Decimal(10, 6),
  best_bid Decimal(10, 6),
  best_ask Decimal(10, 6),
  spread_bps UInt16,
  bid_volume Decimal(18, 2),
  ask_volume Decimal(18, 2),
  snapshot_source Enum8('websocket'=1, 'api'=2) DEFAULT 'websocket',
  created_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 8192;

-- Indexes for fast queries
ALTER TABLE price_snapshots_10s
  ADD INDEX idx_market_time (market_id, timestamp) TYPE minmax GRANULARITY 4;
```

2. **Create Supabase watchlist tables**
```sql
-- watchlist_markets (user-selected markets for live tracking)
CREATE TABLE watchlist_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  market_slug TEXT,
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE, -- true if system added based on elite wallet activity
  priority INT DEFAULT 0, -- higher = more important to track
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(market_id)
);

CREATE INDEX idx_watchlist_markets_priority ON watchlist_markets(priority DESC, created_at DESC);

-- watchlist_wallets (elite wallets to monitor)
CREATE TABLE watchlist_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  omega_score DECIMAL(10, 4),
  category TEXT, -- if specialist in specific category
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address)
);

CREATE INDEX idx_watchlist_wallets_score ON watchlist_wallets(omega_score DESC NULLS LAST);
```

3. **Provision infrastructure**
- ClickHouse: 1× VM (8 vCPU, 32GB RAM, NVMe storage)
- App servers: 2× small VMs for WebSocket consumer + polling service
- Monitoring: Set up health check endpoints

**Deliverables:**
- ✅ All tables created with proper indexes
- ✅ Infrastructure provisioned and accessible
- ✅ Migration scripts in `migrations/clickhouse/` and `supabase/migrations/`

---

### Phase 1: Discovery Platform (Weeks 1-2)

**Goal:** Launch elite trader leaderboards, validate demand

**Tasks:**

1. **Bulk wallet discovery**
```bash
# Run enhanced wallet discovery (no 50k cap)
npm run discover-wallets
```

2. **Bulk sync historical trades**
```bash
# Sync all discovered wallets to ClickHouse
npm run bulk-sync-wallets
```

3. **Calculate 102 metrics**
```bash
# Batch calculation for all time windows
npm run calculate-metrics -- --windows=30d,90d,180d,lifetime
```

4. **Launch Discovery UI**
- Elite trader leaderboards (filterable by metrics)
- Category specialists view (Austin Methodology)
- Wallet detail pages (all 102 metrics + charts)
- Favorite wallet functionality (creates watchlist)

**Data source:** Goldsky Subgraph API (batch mode, hourly updates)

**Success metrics:**
- 100+ active users/week
- 50+ wallets favorited (creates watchlist seed)
- Users asking "Can I get alerts on these wallets?"

**Deliverables:**
- ✅ 6,605+ wallets with full metrics
- ✅ Discovery platform live
- ✅ User watchlist populated via favorites

---

### Phase 2: Live Signals - Momentum Detection (Week 3)

**Goal:** Real-time price tracking for watchlist markets

**Service 1: WebSocket Price Snapshotter**

**File:** `services/websocket-snapshotter.ts`

```typescript
/**
 * Polymarket WebSocket Snapshotter
 *
 * Connects to Polymarket RTDS, subscribes to watchlist markets,
 * captures price ticks, downsamples to 10-second snapshots,
 * writes to ClickHouse.
 */

import { PolymarketRTDS } from '@/lib/polymarket/rtds-client';
import { clickhouse } from '@/lib/clickhouse/client';
import { supabase } from '@/lib/supabase/client';

interface PriceTick {
  market: string;
  yes_price: number;
  no_price: number;
  yes_bid: number;
  yes_ask: number;
  spread: number;
  bid_volume: number;
  ask_volume: number;
  timestamp: number;
}

interface PriceSnapshot {
  market_id: string;
  timestamp: Date;
  side: 'YES' | 'NO';
  mid_price: number;
  best_bid: number;
  best_ask: number;
  spread_bps: number;
  bid_volume: number;
  ask_volume: number;
}

class WebSocketSnapshotter {
  private rtds: PolymarketRTDS;
  private buffer: Map<string, PriceTick[]> = new Map();
  private watchlistMarkets: string[] = [];
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor() {
    this.rtds = new PolymarketRTDS({
      url: "wss://ws-live-data.polymarket.com"
    });
  }

  async start() {
    // Load watchlist markets from Supabase
    await this.loadWatchlist();

    // Connect to WebSocket
    await this.connect();

    // Start 10-second flush interval
    this.startFlushInterval();

    // Refresh watchlist every 5 minutes
    setInterval(() => this.loadWatchlist(), 5 * 60 * 1000);
  }

  private async loadWatchlist() {
    const { data, error } = await supabase
      .from('watchlist_markets')
      .select('market_slug')
      .order('priority', { ascending: false })
      .limit(100); // Cap at 100 markets initially

    if (error) {
      console.error('Failed to load watchlist:', error);
      return;
    }

    const newMarkets = data.map(m => m.market_slug);

    // Check if watchlist changed
    if (JSON.stringify(newMarkets) !== JSON.stringify(this.watchlistMarkets)) {
      console.log(`Watchlist updated: ${newMarkets.length} markets`);
      this.watchlistMarkets = newMarkets;

      if (this.isConnected) {
        await this.resubscribe();
      }
    }
  }

  private async connect() {
    try {
      await this.rtds.connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to watchlist
      await this.subscribe();

      // Handle messages
      this.rtds.on('price_change', (data: PriceTick) => {
        this.bufferTick(data);
      });

      // Handle disconnections
      this.rtds.on('disconnect', () => {
        console.warn('WebSocket disconnected');
        this.isConnected = false;
        this.handleReconnect();
      });

      console.log('WebSocket connected successfully');
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      this.handleReconnect();
    }
  }

  private async subscribe() {
    for (const market of this.watchlistMarkets) {
      await this.rtds.subscribe({
        type: "market",
        market_slug: market
      });
    }
    console.log(`Subscribed to ${this.watchlistMarkets.length} markets`);
  }

  private async resubscribe() {
    console.log('Resubscribing to updated watchlist...');
    // Unsubscribe all (if supported), then resubscribe
    await this.subscribe();
  }

  private bufferTick(tick: PriceTick) {
    if (!this.buffer.has(tick.market)) {
      this.buffer.set(tick.market, []);
    }
    this.buffer.get(tick.market)!.push(tick);
  }

  private startFlushInterval() {
    setInterval(() => {
      this.flushSnapshots();
    }, 10000); // Every 10 seconds
  }

  private async flushSnapshots() {
    if (this.buffer.size === 0) return;

    const snapshots: PriceSnapshot[] = [];

    for (const [market, ticks] of this.buffer.entries()) {
      if (ticks.length === 0) continue;

      // Aggregate ticks from last 10 seconds
      const latestTick = ticks[ticks.length - 1];
      const avgVolume = {
        bid: ticks.reduce((sum, t) => sum + t.bid_volume, 0) / ticks.length,
        ask: ticks.reduce((sum, t) => sum + t.ask_volume, 0) / ticks.length
      };

      snapshots.push({
        market_id: market,
        timestamp: new Date(),
        side: 'YES',
        mid_price: latestTick.yes_price,
        best_bid: latestTick.yes_bid,
        best_ask: latestTick.yes_ask,
        spread_bps: Math.round(latestTick.spread * 10000),
        bid_volume: avgVolume.bid,
        ask_volume: avgVolume.ask
      });
    }

    // Write to ClickHouse
    try {
      await clickhouse.insert({
        table: 'price_snapshots_10s',
        values: snapshots,
        format: 'JSONEachRow'
      });

      console.log(`Flushed ${snapshots.length} price snapshots`);

      // Clear buffer
      this.buffer.clear();
    } catch (error) {
      console.error('Failed to flush snapshots:', error);
      // Keep buffer for retry on next cycle
    }
  }

  private async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Manual intervention required.');
      // Alert ops team
      await this.alertOps('WebSocket failed to reconnect after 10 attempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private async alertOps(message: string) {
    // TODO: Implement alerting (email, Slack, PagerDuty, etc.)
    console.error(`🚨 OPS ALERT: ${message}`);
  }
}

// Start the snapshotter
const snapshotter = new WebSocketSnapshotter();
snapshotter.start();
```

**Deployment:**
```bash
# Run as persistent service
pm2 start services/websocket-snapshotter.ts --name websocket-snapshotter

# Monitor
pm2 logs websocket-snapshotter
pm2 monit
```

**Service 2: Momentum Detector**

**File:** `services/momentum-detector.ts`

```typescript
/**
 * Momentum Detector
 *
 * Queries price_snapshots_10s every 10 seconds,
 * calculates velocity and acceleration,
 * fires signals when thresholds crossed.
 */

import { clickhouse } from '@/lib/clickhouse/client';

interface MomentumSignal {
  market_id: string;
  current_price: number;
  velocity_per_sec: number;  // Price change per second
  acceleration: number;       // Change in velocity
  trend_strength: number;     // R² correlation
  volume_surge: number;       // Current / average
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

class MomentumDetector {
  async detectSignals(): Promise<MomentumSignal[]> {
    const query = `
      WITH price_velocity AS (
        SELECT
          market_id,
          timestamp,
          mid_price,
          -- Velocity: price change over 60 seconds (6 snapshots at 10s interval)
          (mid_price - lagInFrame(mid_price, 6) OVER w) / 60 AS velocity_per_sec,
          -- Acceleration: change in velocity over 30 seconds
          ((mid_price - lagInFrame(mid_price, 6) OVER w) / 60) -
          ((lagInFrame(mid_price, 6) OVER w - lagInFrame(mid_price, 12) OVER w) / 60) AS acceleration,
          -- Volume
          bid_volume + ask_volume AS total_volume,
          avg(bid_volume + ask_volume) OVER (PARTITION BY market_id ORDER BY timestamp ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING) AS avg_volume
        FROM price_snapshots_10s
        WHERE
          timestamp > now() - INTERVAL 5 MINUTE
          AND side = 'YES'
        WINDOW w AS (PARTITION BY market_id ORDER BY timestamp)
      )
      SELECT
        market_id,
        mid_price AS current_price,
        velocity_per_sec,
        acceleration,
        -- Trend strength (simplified R² - using correlation)
        abs(velocity_per_sec) / (stddevSamp(mid_price) OVER (PARTITION BY market_id)) AS trend_strength,
        -- Volume surge ratio
        total_volume / nullIf(avg_volume, 0) AS volume_surge,
        timestamp
      FROM price_velocity
      WHERE
        timestamp = (SELECT max(timestamp) FROM price_snapshots_10s)
        AND abs(velocity_per_sec) > 0.01  -- 1% per second = 60% per minute
      ORDER BY abs(velocity_per_sec) DESC
      LIMIT 20
    `;

    const result = await clickhouse.query(query);

    return result.data.map(row => ({
      market_id: row.market_id,
      current_price: row.current_price,
      velocity_per_sec: row.velocity_per_sec,
      acceleration: row.acceleration,
      trend_strength: row.trend_strength,
      volume_surge: row.volume_surge,
      confidence: this.calculateConfidence(row)
    }));
  }

  private calculateConfidence(signal: any): 'LOW' | 'MEDIUM' | 'HIGH' {
    // High confidence: Strong velocity + positive acceleration + volume surge
    if (
      Math.abs(signal.velocity_per_sec) > 0.02 && // 2% per second
      signal.acceleration > 0 &&
      signal.volume_surge > 1.5
    ) {
      return 'HIGH';
    }

    // Medium confidence: Decent velocity + some volume
    if (
      Math.abs(signal.velocity_per_sec) > 0.01 &&
      signal.volume_surge > 1.2
    ) {
      return 'MEDIUM';
    }

    return 'LOW';
  }
}

// Run every 10 seconds
const detector = new MomentumDetector();
setInterval(async () => {
  const signals = await detector.detectSignals();

  if (signals.length > 0) {
    console.log(`🚀 Detected ${signals.length} momentum signals`);
    // TODO: Pass to attribution checker
  }
}, 10000);
```

**Deliverables:**
- ✅ WebSocket snapshotter running 24/7
- ✅ price_snapshots_10s table populated
- ✅ Momentum signals detected within 10 seconds

---

### Phase 3: Live Signals - Elite Attribution (Week 4)

**Goal:** Match momentum signals with elite wallet activity

**Service 3: Watchlist Poller**

**File:** `services/watchlist-poller.ts`

```typescript
/**
 * Watchlist Poller
 *
 * Polls Goldsky API every 60 seconds for trades in watchlist markets,
 * checks if elite wallets are involved,
 * writes attribution data to ClickHouse.
 */

import { orderbookClient } from '@/lib/goldsky/client';
import { clickhouse } from '@/lib/clickhouse/client';
import { supabase } from '@/lib/supabase/client';

interface EliteWallet {
  address: string;
  omega_score: number;
  category: string | null;
}

interface TradeAttribution {
  trade_id: string;
  market_id: string;
  wallet_address: string;
  side: 'BUY' | 'SELL';
  size_usd: number;
  is_elite: boolean;
  elite_omega_score: number | null;
  timestamp: Date;
}

class WatchlistPoller {
  private watchlistMarkets: string[] = [];
  private eliteWallets: Map<string, EliteWallet> = new Map();
  private lastPollTimestamp: number = 0;
  private pollInterval = 60000; // 60 seconds
  private rateLimitErrors = 0;

  async start() {
    // Load initial data
    await this.loadWatchlistMarkets();
    await this.loadEliteWallets();

    // Refresh watchlist/wallets every 5 minutes
    setInterval(() => {
      this.loadWatchlistMarkets();
      this.loadEliteWallets();
    }, 5 * 60 * 1000);

    // Start polling
    this.startPolling();
  }

  private async loadWatchlistMarkets() {
    const { data } = await supabase
      .from('watchlist_markets')
      .select('market_id')
      .order('priority', { ascending: false })
      .limit(100);

    this.watchlistMarkets = data?.map(m => m.market_id) || [];
    console.log(`Loaded ${this.watchlistMarkets.length} watchlist markets`);
  }

  private async loadEliteWallets() {
    const { data } = await supabase
      .from('watchlist_wallets')
      .select('wallet_address, omega_score, category')
      .order('omega_score', { ascending: false })
      .limit(500);

    this.eliteWallets.clear();
    data?.forEach(w => {
      this.eliteWallets.set(w.wallet_address.toLowerCase(), {
        address: w.wallet_address,
        omega_score: w.omega_score,
        category: w.category
      });
    });

    console.log(`Loaded ${this.eliteWallets.size} elite wallets`);
  }

  private startPolling() {
    setInterval(async () => {
      await this.poll();
    }, this.pollInterval);

    // Initial poll
    this.poll();
  }

  private async poll() {
    try {
      const since = this.lastPollTimestamp || (Date.now() / 1000) - 300; // Last 5 min on first run

      const query = `
        query WatchlistTrades($markets: [String!]!, $since: Int!) {
          orderFilledEvents(
            where: {
              market_in: $markets,
              timestamp_gt: $since
            }
            orderBy: timestamp
            orderDirection: asc
            first: 1000
          ) {
            id
            maker
            taker
            makerAssetId
            takerAssetId
            makerAmountFilled
            takerAmountFilled
            timestamp
            transactionHash
          }
        }
      `;

      const data = await orderbookClient.request(query, {
        markets: this.watchlistMarkets,
        since: Math.floor(since)
      });

      const trades = data.orderFilledEvents || [];

      if (trades.length > 0) {
        console.log(`Fetched ${trades.length} new trades`);
        await this.processAttributions(trades);

        // Update last poll timestamp
        const lastTrade = trades[trades.length - 1];
        this.lastPollTimestamp = parseInt(lastTrade.timestamp);
      }

      // Reset rate limit counter on success
      this.rateLimitErrors = 0;

    } catch (error: any) {
      if (error.response?.status === 429) {
        this.rateLimitErrors++;
        console.warn(`Rate limit hit (${this.rateLimitErrors} times)`);

        if (this.rateLimitErrors > 10) {
          // Alert: Consider adding Mirror
          await this.alertOps('Rate limits hit >10 times - consider enabling Mirror');
        }

        // Back off: increase poll interval
        this.pollInterval = Math.min(this.pollInterval * 1.5, 300000); // Max 5 min
        console.log(`Increasing poll interval to ${this.pollInterval}ms`);
      } else {
        console.error('Polling error:', error);
      }
    }
  }

  private async processAttributions(trades: any[]) {
    const attributions: TradeAttribution[] = [];

    for (const trade of trades) {
      // Check if maker or taker is elite
      const makerIsElite = this.eliteWallets.has(trade.maker.toLowerCase());
      const takerIsElite = this.eliteWallets.has(trade.taker.toLowerCase());

      if (makerIsElite || takerIsElite) {
        const eliteAddress = makerIsElite ? trade.maker : trade.taker;
        const elite = this.eliteWallets.get(eliteAddress.toLowerCase())!;

        // Determine if buying or selling
        const makerGivingToken = trade.makerAssetId !== '0';
        const side = makerIsElite
          ? (makerGivingToken ? 'SELL' : 'BUY')
          : (makerGivingToken ? 'BUY' : 'SELL');

        const sizeUsd = parseFloat(trade.makerAssetId === '0'
          ? trade.makerAmountFilled
          : trade.takerAmountFilled) / 1e6;

        attributions.push({
          trade_id: trade.id,
          market_id: trade.market_id, // Need to resolve this
          wallet_address: eliteAddress,
          side,
          size_usd: sizeUsd,
          is_elite: true,
          elite_omega_score: elite.omega_score,
          timestamp: new Date(parseInt(trade.timestamp) * 1000)
        });
      }
    }

    if (attributions.length > 0) {
      console.log(`🎯 ${attributions.length} elite wallet trades detected`);

      // Store attributions
      await clickhouse.insert({
        table: 'elite_trade_attributions',
        values: attributions,
        format: 'JSONEachRow'
      });
    }
  }

  private async alertOps(message: string) {
    console.error(`🚨 OPS ALERT: ${message}`);
    // TODO: Implement alerting
  }
}

// Start poller
const poller = new WatchlistPoller();
poller.start();
```

**Service 4: Signal Generator**

**File:** `services/signal-generator.ts`

```typescript
/**
 * Signal Generator
 *
 * Combines momentum signals (from price snapshots) with
 * elite attributions (from trade polling),
 * fires alerts when both conditions met.
 */

import { clickhouse } from '@/lib/clickhouse/client';
import { supabase } from '@/lib/supabase/client';

interface CombinedSignal {
  market_id: string;
  market_slug: string;
  signal_type: 'ELITE_MOMENTUM' | 'MOMENTUM_ONLY';
  momentum: {
    velocity_per_sec: number;
    acceleration: number;
    current_price: number;
  };
  elite_activity?: {
    wallet_address: string;
    omega_score: number;
    side: 'BUY' | 'SELL';
    size_usd: number;
  };
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  entry_window: string; // e.g., "Next 2-5 minutes"
  timestamp: Date;
}

class SignalGenerator {
  async generateSignals(): Promise<CombinedSignal[]> {
    // Step 1: Get momentum signals
    const momentumSignals = await this.getMomentumSignals();

    if (momentumSignals.length === 0) {
      return [];
    }

    // Step 2: Check for elite attribution (last 2 minutes)
    const signals: CombinedSignal[] = [];

    for (const momentum of momentumSignals) {
      const eliteActivity = await this.getEliteActivity(momentum.market_id);

      if (eliteActivity) {
        // HIGH CONFIDENCE: Momentum + Elite wallet confirmed
        signals.push({
          market_id: momentum.market_id,
          market_slug: await this.getMarketSlug(momentum.market_id),
          signal_type: 'ELITE_MOMENTUM',
          momentum: {
            velocity_per_sec: momentum.velocity_per_sec,
            acceleration: momentum.acceleration,
            current_price: momentum.current_price
          },
          elite_activity: {
            wallet_address: eliteActivity.wallet_address,
            omega_score: eliteActivity.omega_score,
            side: eliteActivity.side,
            size_usd: eliteActivity.size_usd
          },
          confidence: 'HIGH',
          entry_window: this.calculateEntryWindow(momentum, eliteActivity),
          timestamp: new Date()
        });
      } else {
        // MEDIUM CONFIDENCE: Momentum only, no elite confirmation yet
        signals.push({
          market_id: momentum.market_id,
          market_slug: await this.getMarketSlug(momentum.market_id),
          signal_type: 'MOMENTUM_ONLY',
          momentum: {
            velocity_per_sec: momentum.velocity_per_sec,
            acceleration: momentum.acceleration,
            current_price: momentum.current_price
          },
          confidence: 'MEDIUM',
          entry_window: "Next 5-10 minutes",
          timestamp: new Date()
        });
      }
    }

    return signals;
  }

  private async getMomentumSignals(): Promise<any[]> {
    // Query from Phase 2 momentum detector
    const query = `
      WITH price_velocity AS (
        SELECT
          market_id,
          mid_price AS current_price,
          (mid_price - lagInFrame(mid_price, 6) OVER w) / 60 AS velocity_per_sec,
          ((mid_price - lagInFrame(mid_price, 6) OVER w) / 60) -
          ((lagInFrame(mid_price, 6) OVER w - lagInFrame(mid_price, 12) OVER w) / 60) AS acceleration
        FROM price_snapshots_10s
        WHERE
          timestamp > now() - INTERVAL 2 MINUTE
          AND side = 'YES'
        WINDOW w AS (PARTITION BY market_id ORDER BY timestamp)
      )
      SELECT
        market_id,
        current_price,
        velocity_per_sec,
        acceleration
      FROM price_velocity
      WHERE abs(velocity_per_sec) > 0.01
      ORDER BY abs(velocity_per_sec) DESC
      LIMIT 10
    `;

    const result = await clickhouse.query(query);
    return result.data;
  }

  private async getEliteActivity(marketId: string): Promise<any | null> {
    // Check for elite trades in last 2 minutes
    const query = `
      SELECT
        wallet_address,
        elite_omega_score AS omega_score,
        side,
        size_usd,
        timestamp
      FROM elite_trade_attributions
      WHERE
        market_id = {marketId: String}
        AND timestamp > now() - INTERVAL 2 MINUTE
        AND is_elite = true
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const result = await clickhouse.query(query, { marketId });
    return result.data[0] || null;
  }

  private async getMarketSlug(marketId: string): Promise<string> {
    const { data } = await supabase
      .from('markets')
      .select('market_slug')
      .eq('market_id', marketId)
      .single();

    return data?.market_slug || marketId;
  }

  private calculateEntryWindow(momentum: any, elite: any): string {
    // If elite just bought and momentum strong: enter quickly
    if (elite.side === 'BUY' && momentum.velocity_per_sec > 0.015) {
      return "Next 1-3 minutes";
    }

    // If elite sold but momentum up: might be exit, wait
    if (elite.side === 'SELL') {
      return "Wait - elite exiting";
    }

    return "Next 2-5 minutes";
  }

  async sendAlert(signal: CombinedSignal) {
    console.log(`🚨 SIGNAL FIRED:`, signal);

    // TODO: Send to user via:
    // - WebSocket to live dashboard
    // - Push notification
    // - Email/SMS if configured
    // - Webhook for auto-trading bots
  }
}

// Run every 10 seconds
const generator = new SignalGenerator();
setInterval(async () => {
  const signals = await generator.generateSignals();

  for (const signal of signals) {
    await generator.sendAlert(signal);
  }
}, 10000);
```

**Deliverables:**
- ✅ Elite wallet activity tracked
- ✅ Signals combining momentum + attribution
- ✅ Alerts sent to users within ~70 seconds of elite trade

---

## Database Schema

### ClickHouse Tables

**Full schema in:** `migrations/clickhouse/010_live_signals.sql`

```sql
-- Price snapshots (10-second intervals for watchlist)
CREATE TABLE price_snapshots_10s (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),
  mid_price Decimal(10, 6),
  best_bid Decimal(10, 6),
  best_ask Decimal(10, 6),
  spread_bps UInt16,
  bid_volume Decimal(18, 2),
  ask_volume Decimal(18, 2),
  snapshot_source Enum8('websocket'=1, 'api'=2, 'mirror'=3) DEFAULT 'websocket',
  created_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 8192;

-- Elite trade attributions
CREATE TABLE elite_trade_attributions (
  trade_id String,
  market_id String,
  wallet_address String,
  side Enum8('BUY'=1, 'SELL'=2),
  size_usd Decimal(18, 2),
  is_elite Boolean,
  elite_omega_score Nullable(Decimal(10, 4)),
  timestamp DateTime,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp, wallet_address)
SETTINGS index_granularity = 8192;

-- Fired signals (for tracking/analytics)
CREATE TABLE fired_signals (
  signal_id UUID DEFAULT generateUUIDv4(),
  market_id String,
  market_slug String,
  signal_type Enum8('ELITE_MOMENTUM'=1, 'MOMENTUM_ONLY'=2),
  momentum_velocity Decimal(12, 8),
  momentum_acceleration Decimal(12, 8),
  elite_wallet_address Nullable(String),
  elite_omega_score Nullable(Decimal(10, 4)),
  elite_side Nullable(Enum8('BUY'=1, 'SELL'=2)),
  confidence Enum8('LOW'=1, 'MEDIUM'=2, 'HIGH'=3),
  entry_window String,
  price_at_signal Decimal(10, 6),
  timestamp DateTime DEFAULT now(),

  -- Track outcomes (filled by user or auto-trading)
  user_action Nullable(Enum8('IGNORED'=1, 'VIEWED'=2, 'TRADED'=3)),
  user_entry_price Nullable(Decimal(10, 6)),
  user_entry_time Nullable(DateTime),
  signal_pnl Nullable(Decimal(18, 2)) -- Track if signal was profitable
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, market_id)
SETTINGS index_granularity = 8192;
```

### Supabase Tables

**Full schema in:** `supabase/migrations/20251025000001_live_signals.sql`

```sql
-- Watchlist markets (user-selected or auto-added based on elite activity)
CREATE TABLE watchlist_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  market_slug TEXT,
  condition_id TEXT,
  category TEXT,
  question TEXT,

  -- How it was added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT, -- e.g., "Elite wallet X trades this frequently"

  -- Priority for limited resources
  priority INT DEFAULT 0, -- Higher = more important

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(market_id)
);

CREATE INDEX idx_watchlist_markets_priority ON watchlist_markets(priority DESC, created_at DESC);
CREATE INDEX idx_watchlist_markets_category ON watchlist_markets(category) WHERE category IS NOT NULL;

-- Watchlist wallets (elite wallets to monitor)
CREATE TABLE watchlist_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  -- Metrics (cached from wallet_scores)
  omega_score DECIMAL(10, 4),
  win_rate DECIMAL(5, 4),
  closed_positions INT,
  category TEXT, -- if specialist
  grade TEXT, -- S, A, B, C, D, F

  -- How it was added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT,

  -- Tracking
  last_trade_detected_at TIMESTAMPTZ,
  total_signals_generated INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address)
);

CREATE INDEX idx_watchlist_wallets_score ON watchlist_wallets(omega_score DESC NULLS LAST);
CREATE INDEX idx_watchlist_wallets_category ON watchlist_wallets(category) WHERE category IS NOT NULL;

-- User signal preferences
CREATE TABLE user_signal_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),

  -- Filters
  min_confidence TEXT DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH
  require_elite_confirmation BOOLEAN DEFAULT TRUE,
  min_elite_omega_score DECIMAL(10, 4) DEFAULT 2.0,

  -- Categories to watch
  watched_categories TEXT[], -- NULL = all categories

  -- Notification settings
  enable_push_notifications BOOLEAN DEFAULT TRUE,
  enable_email_notifications BOOLEAN DEFAULT FALSE,
  enable_webhook BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signal delivery log (track what was sent to whom)
CREATE TABLE signal_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL, -- References fired_signals in ClickHouse
  user_id UUID REFERENCES auth.users(id),

  delivery_method TEXT NOT NULL, -- 'push', 'email', 'webhook'
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  error_message TEXT,

  -- User action tracking
  viewed_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  traded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signal_delivery_user ON signal_delivery_log(user_id, delivered_at DESC);
CREATE INDEX idx_signal_delivery_status ON signal_delivery_log(delivery_status, delivered_at) WHERE delivery_status = 'pending';
```

---

## Service Specifications

### Service Deployment

**All services as PM2 processes:**

```json
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'websocket-snapshotter',
      script: './services/websocket-snapshotter.ts',
      interpreter: 'ts-node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'watchlist-poller',
      script: './services/watchlist-poller.ts',
      interpreter: 'ts-node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'signal-generator',
      script: './services/signal-generator.ts',
      interpreter: 'ts-node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

**Deployment:**
```bash
# Install PM2
npm install -g pm2

# Start all services
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Logs
pm2 logs websocket-snapshotter
pm2 logs watchlist-poller
pm2 logs signal-generator

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

---

## Monitoring & Tripwires

### Monitoring Dashboard

**Create:** `pages/admin/monitoring.tsx`

**Key metrics to track:**

```typescript
interface MonitoringMetrics {
  // WebSocket health
  websocket: {
    uptime_pct: number;           // Target: >99%
    current_status: 'connected' | 'disconnected';
    reconnects_24h: number;       // Alert if >5
    last_message_at: Date;
    subscribed_markets: number;
    messages_per_second: number;
  };

  // Polling health
  polling: {
    success_rate_24h: number;     // Target: >95%
    rate_limit_errors_24h: number; // Alert if >10
    avg_attribution_lag_sec: number; // Target: <90s
    last_poll_at: Date;
    polls_per_hour: number;
  };

  // Data quality
  data: {
    price_snapshots_24h: number;  // Should be ~8.64M for 100 markets
    elite_trades_detected_24h: number;
    gaps_in_data: number;         // Missing snapshot periods
    oldest_snapshot_age_sec: number;
  };

  // Signals
  signals: {
    fired_24h: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    user_actions_24h: number;     // How many users clicked
    trades_executed_24h: number;
  };

  // Infrastructure
  infra: {
    clickhouse_disk_usage_pct: number; // Alert if >80%
    clickhouse_query_latency_p95_ms: number; // Target: <500ms
    clickhouse_insert_errors_24h: number;
    supabase_response_time_p95_ms: number;
  };
}
```

### Tripwires for Adding Mirror

**Monitor these continuously. If ANY threshold crossed for 7+ consecutive days, add Mirror:**

```typescript
const MIRROR_TRIPWIRES = {
  // Tripwire 1: Rate limiting
  rate_limit_errors_per_day: {
    threshold: 10,
    current: 0, // Updated from monitoring
    description: "Goldsky API rate limiting our polling"
  },

  // Tripwire 2: WebSocket instability
  websocket_disconnects_per_day: {
    threshold: 5,
    current: 0,
    description: "WebSocket connection unstable"
  },

  // Tripwire 3: Attribution lag hurting performance
  avg_attribution_lag_sec: {
    threshold: 90,
    current: 0,
    description: "Attribution slower than 90 seconds average"
  },

  // Tripwire 4: User complaints
  user_complaints_about_speed: {
    threshold: 5,
    current: 0,
    description: "Users explicitly asking for faster signals"
  },

  // Tripwire 5: Trading volume
  trades_executed_per_month: {
    threshold: 20,
    current: 0,
    description: "Users trading at scale (>20 trades/month)"
  },

  // Tripwire 6: Opportunity cost
  estimated_missed_profit_per_month: {
    threshold: 83, // Cost of Mirror
    current: 0,
    description: "Estimated profit lost due to slow attribution > Mirror cost"
  }
};

function checkTripwires(): boolean {
  const tripwiresFired = Object.entries(MIRROR_TRIPWIRES)
    .filter(([_, config]) => config.current >= config.threshold);

  if (tripwiresFired.length > 0) {
    console.warn(`🚨 TRIPWIRES FIRED: ${tripwiresFired.length}`);
    tripwiresFired.forEach(([name, config]) => {
      console.warn(`  - ${name}: ${config.current} >= ${config.threshold} (${config.description})`);
    });

    return true; // Consider adding Mirror
  }

  return false;
}
```

### Alerting Configuration

**File:** `lib/monitoring/alerts.ts`

```typescript
interface Alert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  service: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

async function sendAlert(alert: Alert) {
  console.log(`[${alert.level}] ${alert.service}: ${alert.message}`);

  // TODO: Implement actual alerting
  // Options:
  // - Email (SendGrid, AWS SES)
  // - Slack webhook
  // - Discord webhook
  // - PagerDuty (for CRITICAL)
  // - SMS (Twilio) for on-call

  if (alert.level === 'CRITICAL') {
    // Wake someone up
    await sendSMS(`🚨 CRITICAL: ${alert.message}`);
  }
}

// Example usage
if (metrics.websocket.reconnects_24h > 5) {
  await sendAlert({
    level: 'WARNING',
    service: 'websocket-snapshotter',
    message: 'WebSocket reconnected >5 times in 24h',
    metric: 'reconnects_24h',
    value: metrics.websocket.reconnects_24h,
    threshold: 5
  });
}
```

---

## Migration Path to Mirror

### When to Migrate

**If tripwires fire for 7+ consecutive days**, initiate Mirror setup.

**Timeline:** 1-2 days integration

### Migration Steps

**Step 1: Sign up for Goldsky**
```bash
# Visit https://goldsky.com
# Sign up for free account
# Get API key
```

**Step 2: Configure Mirror pipeline**
```bash
# Install Goldsky CLI
npm install -g @goldskycom/cli

# Login
goldsky login

# Create pipeline configuration
cat > mirror-config.json <<EOF
{
  "name": "cascadian-polymarket-trades",
  "source": {
    "type": "subgraph",
    "url": "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn"
  },
  "sink": {
    "type": "clickhouse",
    "host": "${CLICKHOUSE_HOST}",
    "port": 8123,
    "database": "cascadian",
    "table": "trades_raw",
    "credentials": {
      "username": "${CLICKHOUSE_USER}",
      "password": "${CLICKHOUSE_PASSWORD}"
    }
  },
  "filters": {
    "markets": ["...watchlist market IDs..."]
  }
}
EOF

# Deploy pipeline
goldsky pipeline create mirror-config.json
```

**Step 3: Update code to consume Mirror data**
```typescript
// services/watchlist-poller.ts

// BEFORE (polling):
setInterval(async () => {
  const trades = await goldsky.query(WATCHLIST_QUERY);
  await processAttributions(trades);
}, 60000);

// AFTER (Mirror streams to ClickHouse, we just query):
setInterval(async () => {
  // Query trades_raw table (populated by Mirror)
  const trades = await clickhouse.query(`
    SELECT * FROM trades_raw
    WHERE
      market_id IN {markets: Array(String)}
      AND timestamp > now() - INTERVAL 2 MINUTE
  `, { markets: watchlistMarkets });

  await processAttributions(trades);
}, 10000); // Can check more frequently now (no API limits)
```

**Step 4: Monitor for 7 days**
```typescript
// Verify Mirror is working
const metrics = {
  mirror_events_received_24h: 0,  // Should be > polling results
  mirror_latency_p95_sec: 0,       // Should be <10 seconds
  data_quality_vs_polling: 0,      // Should be 100% match
  cost_first_month: 0              // Track actual cost
};

// After 7 days, if all looks good:
// - Disable watchlist-poller service
// - Update monitoring to track Mirror instead
// - Celebrate 57-second latency improvement!
```

**Step 5: Optimize**
```typescript
// Mirror gives you real-time, so can be more aggressive:
// - Reduce signal generation interval (10s → 5s)
// - Increase watchlist size (100 → 200 markets)
// - Add more sophisticated attribution logic
```

---

## Risk Mitigation

### Technical Risks

**Risk 1: WebSocket disconnects frequently**

**Mitigation:**
```typescript
// Implement robust reconnection logic
class WebSocketReconnector {
  private maxRetries = 10;
  private retryCount = 0;

  async reconnect() {
    if (this.retryCount >= this.maxRetries) {
      // Failover: Switch to API polling temporarily
      await this.enableFallbackPolling();
      await this.alertOps('WebSocket failed, using fallback');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    await sleep(delay);
    await this.connect();
  }

  async enableFallbackPolling() {
    // Temporarily poll Polymarket REST API for prices
    // Slower but keeps system operational
  }
}
```

**Risk 2: Goldsky API rate limits**

**Mitigation:**
```typescript
// Adaptive polling
class AdaptivePoller {
  private pollInterval = 60000; // Start at 60s

  async poll() {
    try {
      await this.fetchData();
      // Success: gradually decrease interval
      this.pollInterval = Math.max(this.pollInterval * 0.95, 30000);
    } catch (error) {
      if (error.status === 429) {
        // Rate limited: back off
        this.pollInterval = Math.min(this.pollInterval * 1.5, 300000);
        console.log(`Backing off to ${this.pollInterval}ms`);
      }
    }
  }
}
```

**Risk 3: ClickHouse storage fills up**

**Mitigation:**
```sql
-- Partition by month, drop old partitions
ALTER TABLE price_snapshots_10s
  DROP PARTITION 202410; -- Drop data older than 90 days

-- Or compress old data
ALTER TABLE price_snapshots_10s
  MODIFY TTL timestamp + INTERVAL 90 DAY;
```

**Risk 4: False positives (bad signals)**

**Mitigation:**
```typescript
// Track signal quality
interface SignalOutcome {
  signal_id: string;
  price_at_signal: number;
  price_5min_later: number;
  price_15min_later: number;
  was_profitable: boolean;
}

// After 30 days, analyze:
const signalQuality = await clickhouse.query(`
  SELECT
    signal_type,
    confidence,
    COUNT(*) as total_signals,
    SUM(CASE WHEN was_profitable THEN 1 ELSE 0 END) / COUNT(*) as success_rate
  FROM signal_outcomes
  GROUP BY signal_type, confidence
`);

// Adjust thresholds if success_rate < 60%
```

### Operational Risks

**Risk 1: Service crashes at 2am**

**Mitigation:**
- PM2 auto-restart (already configured)
- Health check endpoints
- Monitoring with alerting
- On-call rotation (if team grows)

**Risk 2: No one monitors the system**

**Mitigation:**
- Daily automated reports via email
- Weekly review of key metrics
- Quarterly deep-dive on performance
- User feedback loop

**Risk 3: Costs spiral out of control**

**Mitigation:**
```typescript
// Cost tracking
const costTracking = {
  clickhouse_storage_gb: 0,
  clickhouse_queries_per_day: 0,
  goldsky_api_calls_per_day: 0,
  estimated_monthly_cost: 0
};

// Alert if >$200/month unexpected
if (costTracking.estimated_monthly_cost > 200) {
  await alertOps('Infrastructure costs exceeding budget');
}
```

### Product Risks

**Risk 1: Users don't trade on signals**

**Mitigation:**
- Start with paper trading feature
- Track simulated P&L
- Build confidence before real money

**Risk 2: 70-second latency is too slow**

**Mitigation:**
- That's what tripwires are for
- Add Mirror when data proves it's needed
- Don't prematurely optimize

**Risk 3: Elite wallets change behavior**

**Mitigation:**
- Continuously update elite wallet list (daily)
- Re-calculate metrics weekly
- Remove wallets that fall below threshold

---

## Success Metrics

### Phase 1 (Discovery) - Week 2

**Targets:**
- ✅ 100+ weekly active users
- ✅ 50+ wallets favorited
- ✅ Average session time >5 minutes
- ✅ <500ms query response time

### Phase 2 (Live Signals) - Week 4

**Targets:**
- ✅ 50+ signals fired per week
- ✅ 10+ user actions (clicks/views)
- ✅ 5+ trades executed
- ✅ >60% signal success rate (profitable after 15 min)

### Phase 3 (Mirror Upgrade) - Week 5+ (if needed)

**Targets:**
- ✅ Attribution latency <15 seconds p95
- ✅ Signal quality maintained or improved
- ✅ ROI positive (profit from better entry > $83/month)
- ✅ User satisfaction increased

---

## Timeline Summary

```
Week 1: Schema & Discovery Infrastructure
├─ Day 1-2: Create ClickHouse tables, Supabase watchlist tables
├─ Day 3-4: Bulk wallet discovery and sync
├─ Day 5-7: Calculate 102 metrics, launch Discovery UI

Week 2: Discovery Validation
├─ Monitor: User engagement, favorites, session time
├─ Gather: Feedback, feature requests
└─ Outcome: Watchlist populated via user favorites

Week 3: Live Signals - Momentum
├─ Day 1-3: Build WebSocket snapshotter
├─ Day 4-5: Build momentum detector
├─ Day 6-7: Test and deploy, monitor stability

Week 4: Live Signals - Attribution
├─ Day 1-3: Build watchlist poller
├─ Day 4-5: Build signal generator
├─ Day 6-7: Launch Live Signals, monitor tripwires

Week 5+: Iterate & Optimize
├─ Monitor: Tripwires for Mirror
├─ Improve: Signal quality, reduce false positives
├─ Scale: Expand watchlist if infrastructure allows
└─ Migrate: Add Mirror if tripwires fire
```

---

## Conclusion

**We're building Option B** because:

1. ✅ **Validates entire vision at zero cost** ($0/month vs $996/year)
2. ✅ **Polymarket WebSocket provides FREE real-time price data** (game-changer)
3. ✅ **70-second signal latency is good enough for manual trading** (validated by ROI analysis)
4. ✅ **Mirror is easy to add later** (1-2 days, no architectural refactor)
5. ✅ **Data-driven decision point** (tripwires tell us when Mirror is needed)

**This plan:**
- Documents all architectural decisions
- Provides implementation roadmap (4 weeks to launch)
- Defines monitoring and tripwires
- Includes migration path to Mirror
- Mitigates risks
- Sets success criteria

**Next steps:**
1. Review this plan with database architect
2. Begin Phase 0 (schema design) this week
3. Launch Discovery in 2 weeks
4. Add Live Signals in 4 weeks
5. Monitor tripwires, add Mirror only if validated

---

**Plan approved by:** [User to sign off]
**Implementation start:** [Date]
**Target launch:** [Date + 4 weeks]
