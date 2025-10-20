# CASCADIAN Technical Design Document (TDD)
**V1 Implementation Blueprint**

## Overview

This document defines *how* we build CASCADIAN, translating the crypto template into the prediction market platform defined in our 3-Layer PRD.

**Key Technical Constraints:**
- ✅ Keep: React Flow for Strategy Builder (already imported)
- 🔄 Replace: Recharts → ECharts
- 🔄 Replace: Current tables → PrimeVue DataTable
- 📁 Archive: Don't delete crypto pages, move to `/archive`
- 🗄️ Database: Supabase (hot) + S3 (cold) + ClickHouse (future)

---

## 1. Frontend Architecture

### 1.1 Component Library Strategy

#### UI Primitives (Keep)
- ✅ shadcn/ui components (40+ components)
- ✅ Radix UI primitives
- ✅ Tailwind CSS for styling
- ✅ React 19 + Next.js 15

#### Chart Library (Replace)
| Current | Target | Migration Strategy |
|---------|--------|-------------------|
| Recharts | ECharts | Gradual replacement, page by page |

**ECharts Integration:**
```bash
npm install echarts echarts-for-react
```

**Wrapper Pattern:**
```typescript
// components/charts/echarts-wrapper.tsx
import ReactECharts from 'echarts-for-react'

export function PriceChart({ data, options }) {
  const echartsOption = {
    // ECharts config
    xAxis: { type: 'time' },
    yAxis: { type: 'value' },
    series: [{ type: 'candlestick', data }]
  }

  return <ReactECharts option={echartsOption} />
}
```

#### Table Library (Replace)
| Current | Target | Migration Strategy |
|---------|--------|-------------------|
| Various tables | PrimeVue DataTable | Replace all tables systematically |

**PrimeVue DataTable Key Features:**
- ✅ Flex scroll (virtualization for 100k+ rows)
- ✅ Horizontal scroll (for 15+ columns)
- ✅ Expandable row groups (for hierarchical data)
- ✅ Built-in filtering, sorting, pagination

**Installation:**
```bash
npm install primevue primeicons
```

**Example Implementation:**
```typescript
// components/tables/market-screener-table.tsx
import { DataTable } from 'primevue/datatable'
import { Column } from 'primevue/column'

export function MarketScreenerTable({ markets }) {
  return (
    <DataTable
      value={markets}
      scrollable
      scrollHeight="flex"
      virtualScrollerOptions={{ itemSize: 46 }}
      filterDisplay="row"
      sortMode="multiple"
    >
      <Column field="title" header="Market" sortable filter />
      <Column field="sii" header="SII" sortable filter />
      <Column field="momentum" header="Momentum" sortable filter />
      {/* 12 more columns */}
    </DataTable>
  )
}
```

### 1.2 Strategy Builder Architecture

**Current State:**
- ✅ React Flow integration complete (v0 import)
- ✅ 12 crypto nodes exist
- ✅ Node palette, config panels, execution panel

**Required Changes:**
| Component | Action | Details |
|-----------|--------|---------|
| Node Palette | Replace | Remove crypto nodes, add Polymarket nodes |
| Node Definitions | Rewrite | New node logic for WIS, SII, specialist finding |
| Execution Engine | Replace | Connect to Polymarket API instead of exchanges |
| Dedicated Wallets | Add | Generate new wallet per strategy |

**V1 Node Palette (Replace All 12 Crypto Nodes):**

**Triggers:**
- `On Schedule` - Run every N minutes
- `On New Market` - Trigger when market matches filter

**Data Nodes (Layer 1 Signals):**
- `Get Market(s)` - Fetch markets by category/filters
- `Get Market Data` - Returns SII, Momentum, Volume for a market
- `Get Wallet Data` - Returns WIS, Profile for a wallet

**Strategy Nodes:**
- `Find Wallets (by WIS)` - Input: category, min_WIS. Output: Wallet list
- `Find Specialist ("Eggman")` - Input: category. Output: Top specialist wallet
- `Check Wallet Agreement` - Input: Wallet list, Market. Output: Agreement %

**Agent Nodes (External Connectors):**
- `Run "Figure-Out-Able"` - LLM checks if market is subjective
- `Run "Google-able"` - LLM checks if question is researchable
- `Run Deep Research` - Trigger MiroMind/Valyu agent (async)

**Logic Nodes:**
- `Filter: Numeric` - e.g., "SII > 70"
- `Filter: Boolean` - e.g., "is_googleable = true"
- `Wait for Momentum Flip` - Async node, holds until condition met

**Risk Nodes:**
- `Set Max Bet ($)` - Hard cap per trade
- `Set Diversification` - Max % of portfolio per trade

**Action Nodes:**
- `Add to Watchlist` - Log to Signal Log table
- `Trigger Buy Signal` - Execute buy
- `Trigger Sell Signal` - Execute sell

**Implementation Pattern:**
```typescript
// components/nodes/polymarket/find-specialist-node.tsx
import { Handle, Position } from '@xyflow/react'

export default function FindSpecialistNode({ data, isConnectable }) {
  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-purple-500">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div>
        <div className="font-bold">Find Specialist ("Eggman")</div>
        <div className="text-xs">
          Category: {data.category || 'Sports'}
          Min Win Rate: {data.minWinRate || 70}%
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}
```

### 1.3 Page Archive Strategy

**Don't Delete - Archive Instead:**

```bash
# Create archive structure
mkdir -p app/(archive)/crypto-bots
mkdir -p app/(archive)/defi

# Move crypto bot pages
mv app/(dashboard)/ai-bot app/(archive)/crypto-bots/
mv app/(dashboard)/dca-bot app/(archive)/crypto-bots/
mv app/(dashboard)/arbitrage-bot app/(archive)/crypto-bots/
mv app/(dashboard)/signal-bot app/(archive)/crypto-bots/

# Move DeFi pages
mv app/(dashboard)/defi-center app/(archive)/defi/
mv app/(dashboard)/defi-protocols app/(archive)/defi/
```

**Archive Index Page:**
```typescript
// app/(archive)/page.tsx
export default function ArchivePage() {
  return (
    <div>
      <h1>Design Archive</h1>
      <p>Original crypto template pages preserved for UI reference</p>
      <ul>
        <li><Link href="/archive/crypto-bots/ai-bot">AI Bot (Original)</Link></li>
        <li><Link href="/archive/crypto-bots/dca-bot">DCA Bot (Original)</Link></li>
        {/* ... */}
      </ul>
    </div>
  )
}
```

---

## 2. Database Architecture (V1: Optimized for Cost)

### 2.1 Three-Tier Strategy

**Philosophy:**
- Keep Supabase lean (hot data only)
- Use S3/R2 for cold storage (cheap, infinite)
- Add ClickHouse only when clear triggers hit

### 2.2 Hot Tier: Supabase (PostgreSQL)

**Purpose:** Control plane + recent data (30-60 days)

**Tables:**

#### Product Data (No TTL)
```sql
-- Users, strategies, connectors (permanent)
CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE strategies (
  strategy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(user_id),
  name text NOT NULL,
  node_graph_json jsonb NOT NULL,
  status text CHECK (status IN ('active', 'paused', 'error')),
  mode text CHECK (mode IN ('paper', 'live')),
  dedicated_wallet_address text NOT NULL,
  wallet_private_key_enc text NOT NULL, -- Encrypted
  created_at timestamptz DEFAULT now()
);

CREATE TABLE connectors (
  connector_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(user_id),
  name text NOT NULL,
  type text NOT NULL, -- 'miromind', 'valyu', 'generic_json'
  endpoint_url text NOT NULL,
  api_key_enc text NOT NULL, -- Encrypted
  refresh_schedule text NOT NULL, -- Cron expression
  status text DEFAULT 'active',
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE markets (
  market_id text PRIMARY KEY,
  title text NOT NULL,
  category text,
  image_url text,
  ends_at timestamptz,
  rules_text text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Hot Data (30-60 Day TTL)
```sql
-- Partitioned by month for easy cleanup
CREATE TABLE trades (
  trade_id text PRIMARY KEY,
  market_id text NOT NULL REFERENCES markets(market_id),
  wallet_address text NOT NULL,
  side text CHECK (side IN ('YES', 'NO')),
  price numeric(18, 8) NOT NULL,
  size_usd numeric(18, 2) NOT NULL,
  timestamp timestamptz NOT NULL
) PARTITION BY RANGE (timestamp);

-- Create partitions for current and next 2 months
CREATE TABLE trades_2025_10 PARTITION OF trades
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE trades_2025_11 PARTITION OF trades
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

-- Covering indexes for common queries
CREATE INDEX idx_trades_market_ts ON trades (market_id, timestamp);
CREATE INDEX idx_trades_wallet_ts ON trades (wallet_address, timestamp);

-- Similar structure for prices_1m
CREATE TABLE prices_1m (
  market_id text NOT NULL REFERENCES markets(market_id),
  timestamp timestamptz NOT NULL,
  price_yes numeric(18, 8),
  price_no numeric(18, 8),
  volume_yes numeric(18, 2),
  volume_no numeric(18, 2),
  PRIMARY KEY (market_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_prices_market_ts ON prices_1m (market_id, timestamp);
```

#### Computed Signals (Materialized Views)
```sql
-- Refreshed every 15 minutes via cron job
CREATE MATERIALIZED VIEW wallet_scores_mv AS
SELECT
  wallet_address,
  calculate_wis(wallet_address) as wis, -- Custom function
  get_style_tags(wallet_address) as style_tags,
  get_top_category(wallet_address) as top_category,
  SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as realized_pnl,
  COUNT(*) FILTER (WHERE is_win = true)::float / COUNT(*) as win_rate,
  calculate_omega(wallet_address) as omega_ratio,
  calculate_sharpe(wallet_address) as sharpe_ratio,
  calculate_contrarian_score(wallet_address) as contrarian_score,
  calculate_contrarian_win_rate(wallet_address) as contrarian_win_rate
FROM positions
GROUP BY wallet_address;

CREATE UNIQUE INDEX idx_wallet_scores_pk ON wallet_scores_mv (wallet_address);

CREATE MATERIALIZED VIEW market_signals_mv AS
SELECT
  market_id,
  calculate_sii(market_id) as sii,
  calculate_crowd_score(market_id) as crowd_score,
  calculate_momentum(market_id) as momentum_score,
  calculate_liquidity(market_id) as liquidity_usd_1pct,
  calculate_spread(market_id) as spread_bps,
  calculate_volatility(market_id) as volatility,
  check_is_rigged(market_id) as is_rigged, -- LLM agent result
  check_is_googleable(market_id) as is_googleable
FROM markets
WHERE is_active = true;

CREATE UNIQUE INDEX idx_market_signals_pk ON market_signals_mv (market_id);
```

#### TTL Jobs (Daily Cleanup)
```sql
-- Supabase Edge Function (runs daily via cron)
CREATE OR REPLACE FUNCTION cleanup_old_partitions()
RETURNS void AS $$
DECLARE
  partition_name text;
  cutoff_date date := CURRENT_DATE - INTERVAL '60 days';
BEGIN
  -- Find partitions older than 60 days
  FOR partition_name IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename LIKE 'trades_20%'
    AND tablename < 'trades_' || to_char(cutoff_date, 'YYYY_MM')
  LOOP
    -- Verify S3 dump exists before dropping
    IF EXISTS (SELECT 1 FROM s3_dump_log WHERE table_name = partition_name AND status = 'success') THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
      RAISE NOTICE 'Dropped partition: %', partition_name;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule via Supabase cron
SELECT cron.schedule(
  'cleanup-old-partitions',
  '0 2 * * *', -- 2 AM daily
  $$ SELECT cleanup_old_partitions(); $$
);
```

### 2.3 Cold Tier: S3/R2 (Infinite Storage)

**Purpose:** Append-only historical data (Parquet format)

**Structure:**
```
s3://cascadian-data/
  trades/
    year=2025/
      month=10/
        trades_2025_10_01.parquet
        trades_2025_10_02.parquet
        ...
  prices_1m/
    year=2025/
      month=10/
        prices_1m_2025_10_01.parquet
        ...
```

**Daily Dump Job:**
```typescript
// Supabase Edge Function: dump-to-s3
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import * as parquet from 'parquetjs'

export async function dumpPartitionToS3(partitionName: string) {
  const supabase = createClient(/* ... */)
  const s3 = new S3Client({ /* ... */ })

  // 1. Extract data from Supabase partition
  const { data: trades } = await supabase
    .from(partitionName)
    .select('*')
    .order('timestamp')

  // 2. Write to Parquet format (columnar, compressed)
  const schema = new parquet.ParquetSchema({
    trade_id: { type: 'UTF8' },
    market_id: { type: 'UTF8' },
    wallet_address: { type: 'UTF8' },
    side: { type: 'UTF8' },
    price: { type: 'DOUBLE' },
    size_usd: { type: 'DOUBLE' },
    timestamp: { type: 'TIMESTAMP_MILLIS' }
  })

  const writer = await parquet.ParquetWriter.openFile(schema, '/tmp/dump.parquet')
  for (const trade of trades) {
    await writer.appendRow(trade)
  }
  await writer.close()

  // 3. Upload to S3
  const fileBuffer = fs.readFileSync('/tmp/dump.parquet')
  await s3.send(new PutObjectCommand({
    Bucket: 'cascadian-data',
    Key: `trades/year=2025/month=10/${partitionName}.parquet`,
    Body: fileBuffer
  }))

  // 4. Log successful dump (for TTL verification)
  await supabase
    .from('s3_dump_log')
    .insert({
      table_name: partitionName,
      status: 'success',
      dump_date: new Date()
    })
}
```

### 2.4 Redis Cache Layer

**Purpose:** Cache hot endpoints (screener, leaderboards)

```typescript
// lib/cache.ts
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN
})

export async function getCachedMarketScreener() {
  const cacheKey = 'screener:markets:all'

  // Try cache first
  const cached = await redis.get(cacheKey)
  if (cached) return cached

  // Cache miss - fetch from Supabase
  const fresh = await fetchFromDatabase()

  // Cache for 60 seconds
  await redis.setex(cacheKey, 60, JSON.stringify(fresh))

  return fresh
}
```

### 2.5 Future Scale Tier: ClickHouse (Add When Needed)

**Triggers to Add ClickHouse:**
- ✅ >50-100M rows in trades table
- ✅ Need charts over 90+ days
- ✅ p95 latency >300ms (even with Redis)

**Migration Pattern (When Triggered):**
```sql
-- 1. Create ClickHouse schema (mirrors Supabase)
CREATE TABLE trades (
  trade_id String,
  market_id String,
  wallet_address String,
  side Enum8('YES' = 1, 'NO' = 2),
  price Float64,
  size_usd Float64,
  timestamp DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp);

-- 2. Backfill from S3 Parquet files
INSERT INTO trades
SELECT * FROM s3(
  's3://cascadian-data/trades/**/*.parquet',
  'Parquet'
);

-- 3. Dual-write pattern (write to both Supabase + ClickHouse)
-- Implement in API layer with feature flag

-- 4. Flip long-range queries to ClickHouse
-- e.g., "Chart for 180 days" → ClickHouse
-- "Chart for 30 days" → Supabase (still faster for recent data)
```

---

## 3. API Architecture

### 3.1 Backend Stack

**Framework:** Next.js API Routes (App Router)
**Database:** Supabase (PostgreSQL)
**Cache:** Upstash Redis
**Auth:** Supabase Auth
**Storage:** Cloudflare R2 (S3-compatible)

### 3.2 Core API Endpoints (V1)

#### Discovery Hub
```typescript
// app/api/v1/discovery/screener/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // Check Redis cache
  const cacheKey = `screener:${searchParams.toString()}`
  const cached = await redis.get(cacheKey)
  if (cached) return Response.json(cached)

  // Query materialized view
  const { data } = await supabase
    .from('market_signals_mv')
    .select('*')
    .gte('sii', searchParams.get('min_sii') || -100)
    .order(searchParams.get('sortBy') || 'sii', { ascending: false })
    .range(
      (parseInt(searchParams.get('page') || '0')) * 50,
      (parseInt(searchParams.get('page') || '0') + 1) * 50 - 1
    )

  // Cache for 60 seconds
  await redis.setex(cacheKey, 60, JSON.stringify(data))

  return Response.json(data)
}
```

#### Traders Hub
```typescript
// app/api/v1/traders/explorer/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const { data } = await supabase
    .from('wallet_scores_mv')
    .select('*')
    .gte('wis', searchParams.get('min_wis') || -100)
    .order('wis', { ascending: false })
    .range(/* pagination */)

  return Response.json(data)
}
```

#### Market Detail Drill-Down
```typescript
// app/api/v1/market-detail/[market_id]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { market_id: string } }
) {
  const marketId = params.market_id

  // Parallel fetch all sections
  const [
    market,
    signals,
    priceHistory,
    trades,
    smartWallets,
    holderAnalysis
  ] = await Promise.all([
    supabase.from('markets').select('*').eq('market_id', marketId).single(),
    supabase.from('market_signals_mv').select('*').eq('market_id', marketId).single(),
    supabase.from('prices_1m').select('*').eq('market_id', marketId).order('timestamp').limit(1440), // 24h
    supabase.from('trades').select('*').eq('market_id', marketId).order('timestamp', { ascending: false }).limit(100),
    supabase.rpc('get_smart_wallets_in_market', { market_id: marketId }),
    supabase.rpc('calculate_holder_analysis', { market_id: marketId })
  ])

  return Response.json({
    header: { ...market.data, ...signals.data },
    charts: {
      priceHistory: priceHistory.data,
      holderAge: holderAnalysis.data
    },
    tables: {
      smartWallets: smartWallets.data,
      recentTrades: trades.data
    }
  })
}
```

#### Strategy Execution
```typescript
// app/api/v1/strategies/[strategy_id]/execute/route.ts
export async function POST(
  request: Request,
  { params }: { params: { strategy_id: string } }
) {
  const { strategy_id } = params

  // 1. Load strategy
  const { data: strategy } = await supabase
    .from('strategies')
    .select('*')
    .eq('strategy_id', strategy_id)
    .single()

  // 2. Parse node graph
  const graph = JSON.parse(strategy.node_graph_json)

  // 3. Execute nodes in order (topological sort)
  const executor = new StrategyExecutor(graph, strategy.dedicated_wallet_address)
  const result = await executor.run()

  // 4. If buy/sell signal generated, execute trade
  if (result.action === 'BUY') {
    await executeTradeOnPolymarket({
      wallet: strategy.dedicated_wallet_address,
      privateKey: decrypt(strategy.wallet_private_key_enc),
      market: result.market_id,
      side: 'YES',
      amount: result.amount
    })
  }

  return Response.json({ status: 'executed', result })
}
```

### 3.3 Polymarket Integration

```typescript
// lib/polymarket.ts
import { ethers } from 'ethers'

export class PolymarketClient {
  private wallet: ethers.Wallet
  private apiBase = 'https://data-api.polymarket.com'

  constructor(privateKey: string) {
    this.wallet = new ethers.Wallet(privateKey)
  }

  async getMarkets(category?: string) {
    const params = new URLSearchParams()
    if (category) params.set('category', category)

    const response = await fetch(`${this.apiBase}/markets?${params}`)
    return response.json()
  }

  async getTrades(marketId: string, limit = 100) {
    const response = await fetch(`${this.apiBase}/trades?market=${marketId}&limit=${limit}`)
    return response.json()
  }

  async placeBet(params: {
    marketId: string
    side: 'YES' | 'NO'
    amount: number
  }) {
    // Sign order with wallet
    const order = await this.signOrder(params)

    // Submit to Polymarket
    const response = await fetch(`${this.apiBase}/order`, {
      method: 'POST',
      body: JSON.stringify(order)
    })

    return response.json()
  }
}
```

---

## 4. Migration Roadmap

### Phase 1: Infrastructure (Week 1-2)
- [ ] Set up Supabase project
- [ ] Create schema (tables, partitions, indexes)
- [ ] Set up Redis (Upstash)
- [ ] Set up S3/R2 bucket
- [ ] Implement daily S3 dump job
- [ ] Implement TTL cleanup job

### Phase 2: Data Pipeline (Week 3-4)
- [ ] Build Polymarket connector
- [ ] Ingest trades (live + backfill)
- [ ] Ingest prices_1m
- [ ] Build WIS calculation functions
- [ ] Build SII calculation functions
- [ ] Set up materialized view refresh jobs

### Phase 3: UI Library Migration (Week 5-8)
- [ ] Install ECharts + echarts-for-react
- [ ] Install PrimeVue + primeicons
- [ ] Replace Market Screener table (PrimeVue)
- [ ] Replace all dashboard charts (ECharts)
- [ ] Archive crypto bot pages to `/archive`

### Phase 4: Page Translation (Week 9-12)
- [ ] Discovery Hub (5 views)
- [ ] Traders Hub (3 views)
- [ ] Market Detail Page (drill-down)
- [ ] Wallet Detail Page (drill-down)
- [ ] Strategy Management Dashboard

### Phase 5: Strategy Builder (Week 13-16)
- [ ] Replace crypto nodes with Polymarket nodes
- [ ] Implement dedicated wallet generation
- [ ] Build execution engine
- [ ] Connect to Polymarket API
- [ ] Add AI Co-Pilot (LLM integration)

---

## 5. Performance Targets

### V1 Targets (Before ClickHouse)
- Screener load: <500ms (with Redis)
- Market Detail load: <1s
- Wallet Detail load: <1s
- Strategy execution: <2s
- Data freshness: 60s (Redis cache TTL)

### Scale Triggers (Add ClickHouse)
- ✅ >50-100M rows in trades
- ✅ Need 90+ day historical charts
- ✅ p95 latency >300ms

---

## 6. Security

### API Key Storage
```typescript
// lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex') // 32 bytes

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decrypt(encrypted: string): string {
  const [ivHex, encryptedHex, authTagHex] = encrypted.split(':')

  const decipher = createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(ivHex, 'hex')
  )

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

### Wallet Security
- Private keys encrypted at rest (AES-256-GCM)
- Server-side only (never sent to client)
- Isolated wallets per strategy (perfect P&L tracking)

---

This TDD is now aligned with your technical constraints. Ready to proceed with implementation?
