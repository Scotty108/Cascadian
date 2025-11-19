# CASCADIAN V1: Complete Technical Design Document

**Version:** 1.0
**Last Updated:** 2025-10-20
**Purpose:** Technical blueprint for implementing the CASCADIAN prediction market intelligence platform

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Database Design](#database-design)
4. [Signal Definitions](#signal-definitions)
5. [API Contracts](#api-contracts)
6. [Frontend Architecture](#frontend-architecture)
7. [Migration Strategy](#migration-strategy)
8. [Deployment & Infrastructure](#deployment--infrastructure)

---

## Architecture Overview

CASCADIAN uses a **three-tier data architecture** optimized for cost and performance:

```
┌─────────────────────────────────────────────────────────────┐
│                    TIER 1: HOT STORAGE                      │
│                  Supabase (PostgreSQL)                      │
│  • Product data (markets, users, strategies)                │
│  • Recent trades & prices (30-60 days)                      │
│  • Materialized views for computed signals                  │
│  • Partitioned tables with TTL cleanup                      │
└─────────────────────────────────────────────────────────────┘
                            ↓ Daily dumps
┌─────────────────────────────────────────────────────────────┐
│                   TIER 2: COLD STORAGE                      │
│                    S3 / Cloudflare R2                       │
│  • Historical trades & prices (Parquet format)              │
│  • Append-only archives                                     │
│  • Cost-effective long-term storage                         │
└─────────────────────────────────────────────────────────────┘
                            ↓ When needed (>50-100M rows)
┌─────────────────────────────────────────────────────────────┐
│                   TIER 3: SCALE STORAGE                     │
│                    ClickHouse Cloud                         │
│  • OLAP queries over historical data                        │
│  • Triggered when p95 latency > 300ms                       │
│  • Supabase → ClickHouse via official FDW/wrapper           │
└─────────────────────────────────────────────────────────────┘
```

**Caching Layer:** Redis for hot endpoints (60s TTL on screener queries, leaderboards)

---

## Technology Stack

### Frontend
- **Framework:** Next.js 14.2.16 (App Router)
- **Language:** TypeScript 5.x
- **UI Components:** shadcn/ui (40+ components) ✅ Keep from template
- **Charts:** **ECharts** (replacing Recharts)
- **Tables:** **PrimeVue DataTable** (replacing current table components)
- **Visual Workflow:** React Flow 12.9.0 (@xyflow/react) ✅ Already imported
- **Styling:** TailwindCSS 3.4.17

### Backend
- **Runtime:** Node.js 20.19.3
- **Database:** Supabase (PostgreSQL 15+)
  - pgvector extension for embeddings
  - Partitioned tables for time-series data
  - Materialized views for computed signals
- **Cache:** Redis (Upstash)
- **Storage:** Cloudflare R2 or S3 for Parquet archives
- **OLAP (when needed):** ClickHouse Cloud

### Infrastructure
- **Hosting:** Vercel (primary), Heroku (backup)
- **CI/CD:** GitHub Actions
- **Monitoring:** Sentry (errors), Vercel Analytics (performance)

---

## Database Design

### Core Tables

#### `markets`
```sql
CREATE TABLE markets (
  market_id text PRIMARY KEY,
  title text NOT NULL,
  category text,
  image_url text,
  ends_at timestamptz,
  rules_text text,  -- For on-demand is_rigged checks
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_updated timestamptz DEFAULT now()
);

CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_ends_at ON markets(ends_at) WHERE is_active = true;
```

#### `trades` (Partitioned by timestamp)
```sql
CREATE TABLE trades (
  trade_id text PRIMARY KEY,
  market_id text NOT NULL REFERENCES markets(market_id),
  wallet_address text NOT NULL,
  side text NOT NULL CHECK (side IN ('YES', 'NO')),
  price numeric(18, 8) NOT NULL,
  size_usd numeric(18, 2) NOT NULL,
  shares numeric(18, 8) NOT NULL,
  timestamp timestamptz NOT NULL
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions
CREATE TABLE trades_2025_01 PARTITION OF trades
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
-- ... (automated partition creation job)

-- Covering indexes
CREATE INDEX idx_trades_market_ts ON trades (market_id, timestamp DESC);
CREATE INDEX idx_trades_wallet_ts ON trades (wallet_address, timestamp DESC);
```

**TTL Cleanup Job:**
```sql
-- Drop partitions older than 60 days (after S3 dump verified)
CREATE OR REPLACE FUNCTION cleanup_old_partitions()
RETURNS void AS $$
DECLARE
  partition_name text;
BEGIN
  FOR partition_name IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename LIKE 'trades_20%'
    AND to_date(substring(tablename from 8), 'YYYY_MM') < current_date - interval '60 days'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron or external job
```

#### `positions` (Current holdings snapshot)
```sql
CREATE TABLE positions (
  position_id serial PRIMARY KEY,
  market_id text NOT NULL REFERENCES markets(market_id),
  wallet_address text NOT NULL,
  side text NOT NULL CHECK (side IN ('YES', 'NO')),
  avg_entry_price numeric(18, 8) NOT NULL,
  total_shares numeric(18, 8) NOT NULL,
  total_invested_usd numeric(18, 2) NOT NULL,
  last_updated timestamptz DEFAULT now(),
  UNIQUE(market_id, wallet_address, side)
);

CREATE INDEX idx_positions_market ON positions(market_id);
CREATE INDEX idx_positions_wallet ON positions(wallet_address);
```

#### `prices_1m` (Partitioned 1-minute OHLCV)
```sql
CREATE TABLE prices_1m (
  market_id text NOT NULL REFERENCES markets(market_id),
  timestamp timestamptz NOT NULL,
  open numeric(18, 8),
  high numeric(18, 8),
  low numeric(18, 8),
  close numeric(18, 8),
  volume numeric(18, 2),
  PRIMARY KEY (market_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_prices_1m_ts ON prices_1m (timestamp DESC);
```

#### `strategies`
```sql
CREATE TABLE strategies (
  strategy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  node_graph_json jsonb NOT NULL,  -- React Flow graph definition
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'error')),
  mode text NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),

  -- Dedicated wallet per strategy (CRITICAL FEATURE)
  dedicated_wallet_address text UNIQUE NOT NULL,
  wallet_private_key_enc text NOT NULL,  -- AES-256-GCM encrypted

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_strategies_user ON strategies(user_id);
CREATE INDEX idx_strategies_status ON strategies(status) WHERE status = 'active';
```

**Wallet Encryption/Decryption:**
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32-byte key

export function encryptPrivateKey(privateKey: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(privateKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:encrypted:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decryptPrivateKey(encryptedData: string): string {
  const [ivHex, encrypted, authTagHex] = encryptedData.split(':')

  const decipher = createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(ivHex, 'hex')
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

### Materialized Views

#### `wallet_scores_mv` (Refreshed every 15 minutes)
```sql
CREATE MATERIALIZED VIEW wallet_scores_mv AS
SELECT
  wallet_address,
  calculate_wis(wallet_address) as wis,
  calculate_style_tags(wallet_address) as style_tags,
  calculate_top_category(wallet_address) as top_category,
  calculate_realized_pnl(wallet_address) as realized_pnl,
  calculate_win_rate(wallet_address) as win_rate,
  calculate_omega_ratio(wallet_address) as omega_ratio,
  calculate_sharpe_ratio(wallet_address) as sharpe_ratio,
  calculate_contrarian_score(wallet_address) as contrarian_score,
  calculate_contrarian_win_rate(wallet_address) as contrarian_win_rate,
  COUNT(*) FILTER (WHERE closed_at IS NOT NULL) as trades_count,
  SUM(size_usd) as total_volume,
  now() as last_updated
FROM positions
GROUP BY wallet_address;

CREATE UNIQUE INDEX idx_wallet_scores_mv_wallet ON wallet_scores_mv(wallet_address);
CREATE INDEX idx_wallet_scores_mv_wis ON wallet_scores_mv(wis DESC);
```

#### `market_signals_mv` (Refreshed every 1-5 minutes)
```sql
CREATE MATERIALIZED VIEW market_signals_mv AS
SELECT
  m.market_id,
  calculate_sii(m.market_id) as sii,
  calculate_crowd_score(m.market_id) as crowd_score,
  calculate_momentum(m.market_id) as momentum_score,
  calculate_liquidity_1pct(m.market_id) as liquidity_usd_1pct,
  calculate_spread(m.market_id) as spread_bps,
  calculate_volatility_7d(m.market_id) as volatility_7d,
  -- NOTE: is_rigged and is_googleable are NOT here
  -- They are computed ON-DEMAND only when triggered by strategy nodes
  now() as last_updated
FROM markets m
WHERE m.is_active = true;

CREATE UNIQUE INDEX idx_market_signals_mv_market ON market_signals_mv(market_id);
CREATE INDEX idx_market_signals_mv_sii ON market_signals_mv(sii DESC);
CREATE INDEX idx_market_signals_mv_momentum ON market_signals_mv(momentum_score DESC);
```

### Vector DB (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE market_rules_embeddings (
  market_id text REFERENCES markets(market_id),
  rule_chunk_index int,
  rule_text_chunk text,
  embedding vector(1536),  -- OpenAI ada-002 dimensions
  PRIMARY KEY (market_id, rule_chunk_index)
);

CREATE INDEX idx_market_rules_embedding_vector
  ON market_rules_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

---

## Signal Definitions

### Wallet Intelligence Signals

#### `WIS (Smart Score)`
**Type:** `numeric` (-100 to +100)
**Purpose:** Global skill score for every wallet
**Formula (V1 Conceptual):**
```typescript
WIS = clip(
  WeightedAverage([
    zscore(realized_pnl) * 0.25,
    zscore(win_rate) * 0.20,
    zscore(omega_ratio) * 0.20,
    zscore(sharpe_ratio) * 0.20,
    zscore(pnl_consistency) * 0.15
  ]),
  -100,
  100
)
```

#### `Contrarian Score`
**Type:** `numeric` (0.0 to 1.0)
**Purpose:** Percentage of trades made against crowd sentiment
**Formula:**
```typescript
contrarian_score =
  COUNT(trades WHERE entry_side != sign(crowd_score_at_entry)) /
  COUNT(total_trades)
```

#### `Contrarian Win Rate`
**Type:** `numeric` (0.0 to 1.0)
**Purpose:** Win rate specifically on contrarian trades
**Formula:**
```typescript
contrarian_win_rate =
  COUNT(winning_trades WHERE is_contrarian = true) /
  COUNT(total_trades WHERE is_contrarian = true)
```

#### `Style Tags`
**Type:** `text[]`
**Purpose:** Categorical descriptors of trading behavior
**Values:**
- `WHALE`: `total_volume > $100k`
- `SPECIALIST`: `>70% volume in single category AND win_rate > 0.60`
- `CONTRARIAN`: `contrarian_score > 0.50`
- `LOTTERY_TICKET`: `>50% trades at price < 0.10 OR > 0.90`
- `SENIOR`: `trades_count > 1000`
- `BOT`: `avg_time_between_trades < 5 minutes AND trades_count > 500`
- `CATALYST_HUNTER`: `avg_hold_time < 24 hours`

### Market Intelligence Signals

#### `SII (Smart Imbalance Index)`
**Type:** `numeric` (-100 to +100)
**Purpose:** Net conviction of high-WIS wallets in a market
**Formula:**
```typescript
// Get all positions from wallets with WIS > 70
const smartPositions = positions.filter(p => p.wallet.wis > 70)

const smartBullUsd = sumBy(
  smartPositions.filter(p => p.side === 'YES'),
  p => p.total_invested_usd
)

const smartBearUsd = sumBy(
  smartPositions.filter(p => p.side === 'NO'),
  p => p.total_invested_usd
)

const totalSmartUsd = smartBullUsd + smartBearUsd

SII = totalSmartUsd > 0
  ? 100 * (smartBullUsd - smartBearUsd) / totalSmartUsd
  : 0
```

#### `Crowd Score`
**Type:** `numeric` (-100 to +100)
**Purpose:** Net conviction of ALL wallets in a market (baseline for SII comparison)
**Formula:**
```typescript
// Same as SII but using ALL positions, not filtered by WIS
```

#### `Momentum Score`
**Type:** `numeric` (0 to 100)
**Purpose:** Price velocity and trend strength
**Formula (Composite):**
```typescript
momentum_score = WeightedAverage([
  rsi_14d * 0.30,           // RSI (0-100)
  normalize(macd_signal) * 0.30,  // MACD signal strength
  normalize(price_change_7d) * 0.25,  // % change normalized
  normalize(volume_trend) * 0.15      // Volume acceleration
])
```

#### `Liquidity ($ to move 1%)`
**Type:** `numeric`
**Purpose:** Depth of order book
**Calculation:** Sum of asks/bids needed to move price 1% from current

#### `Spread (bps)`
**Type:** `numeric`
**Purpose:** Bid-ask spread in basis points
**Formula:** `(best_ask - best_bid) / midpoint * 10000`

#### `Volatility (7d)`
**Type:** `numeric`
**Purpose:** Standard deviation of returns over 7 days
**Formula:** `stddev(daily_log_returns) * sqrt(365)`

### On-Demand Signals (Strategy Nodes Only)

**IMPORTANT:** These signals are NOT computed for every market and NOT stored in `market_signals_mv`. They are computed on-demand ONLY when triggered by strategy nodes.

#### `is_rigged`
**Type:** `boolean`
**Purpose:** LLM evaluation of rule subjectivity
**Computed:** Only when triggered by `Run "Figure-Out-Able" Agent` node
**Implementation:**
```typescript
// NOT a materialized view - computed on-demand
async function evaluateIsRigged(marketId: string): Promise<{
  is_rigged: boolean
  reasoning: string
}> {
  const rules = await fetchMarketRules(marketId)

  const prompt = `
    Analyze these market resolution rules and determine if they are subjective or objective.

    Rules: ${rules}

    Return JSON: { "is_rigged": boolean, "reasoning": "1 sentence" }
  `

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }]
  })

  return JSON.parse(response.choices[0].message.content!)
}
```

#### `is_googleable`
**Type:** `boolean`
**Purpose:** LLM evaluation of question researchability
**Computed:** Only when triggered by `Run "Google-able" Agent` node
**Implementation:**
```typescript
async function evaluateIsGoogleable(marketId: string): Promise<{
  is_googleable: boolean
  reasoning: string
}> {
  const market = await fetchMarket(marketId)

  const prompt = `
    Can this prediction market question be answered through research?

    Question: ${market.title}

    Return JSON: { "is_googleable": boolean, "reasoning": "1 sentence" }
  `

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }]
  })

  return JSON.parse(response.choices[0].message.content!)
}
```

---

## API Contracts

### Discovery Hub APIs

#### `GET /api/v1/discovery/screener`

**Purpose:** Powers the Market Screener table with 15 SII-focused columns

**Query Params:**
```typescript
interface ScreenerQuery {
  category?: string[]       // Filter by category
  min_sii?: number         // Min SII threshold
  max_sii?: number         // Max SII threshold
  min_momentum?: number    // Min momentum threshold
  min_volume?: number      // Min 24h volume ($)
  min_liquidity?: number   // Min liquidity ($)
  sort_by?: string         // Column to sort (default: 'sii')
  sort_order?: 'asc' | 'desc'  // Sort direction
  page?: number            // Pagination
  limit?: number           // Results per page (default: 100)
}
```

**Response (15 Columns - SII Focused):**
```typescript
interface MarketScreenerRow {
  // Column 1: Market (links to detail)
  market_id: string
  title: string

  // Column 2: Outcome
  outcome: 'YES' | 'NO'

  // Column 3: SII (Hero Signal)
  sii: number               // -100 to +100

  // Column 4: Last Price
  last_price: number        // Current YES price (0-1)

  // Column 5: Momentum (Hero Signal)
  momentum: number          // 0-100

  // Column 6: Volume ($)
  volume_24h: number        // $ volume last 24h

  // Column 7: # Trades
  trades_24h: number        // Count of trades

  // Column 8: # Buyers
  buyers_24h: number        // Unique buyers

  // Column 9: # Sellers
  sellers_24h: number       // Unique sellers

  // Column 10: Buy/Sell Ratio
  buy_sell_ratio: number    // buyers / sellers

  // Column 11: Volatility (σ)
  volatility: number        // 7-day volatility

  // Column 12: Spread (bps)
  spread_bps: number        // Bid-ask spread

  // Column 13: Liquidity ($)
  liquidity_usd_1pct: number  // $ to move 1%

  // Column 14: Category
  category: string

  // Column 15: Flag (Rigged Score)
  flag: boolean | null      // is_rigged (null if not evaluated)
}

interface ScreenerResponse {
  data: MarketScreenerRow[]
  total: number
  page: number
  limit: number
}
```

**Example:**
```bash
GET /api/v1/discovery/screener?min_sii=60&category=Sports&sort_by=sii&sort_order=desc&limit=50
```

#### `GET /api/v1/discovery/market-map`

**Purpose:** Powers the Market Map treemap visualization

**Query Params:**
```typescript
interface MarketMapQuery {
  category?: string[]
  min_volume?: number
  size_by: 'volume_24h' | 'trades_24h'  // Tile sizing
  color_by: 'sii' | 'momentum' | 'price_change_24h'  // Tile coloring
  limit?: number  // Max tiles (default: 200)
}
```

**Response:**
```typescript
interface MarketMapTile {
  market_id: string
  title: string           // Truncated for tile display
  category: string
  size_value: number     // Value for tile sizing
  color_value: number    // Value for tile coloring
  tooltip_data: {
    full_title: string
    sii: number
    momentum: number
    volume_24h: number
    current_price: number
  }
}

interface MarketMapResponse {
  tiles: MarketMapTile[]
  size_by: string
  color_by: string
  color_scale: {
    min: number
    max: number
    colors: string[]  // Hex color gradient
  }
}
```

#### `GET /api/v1/discovery/pnl-leaderboard`

**Purpose:** Powers the PnL Leaderboard scatter plot + table

**CORRECTED AXES:** X = Realized PnL, Y = Total Invested

**Query Params:**
```typescript
interface PnLLeaderboardQuery {
  period?: '7d' | '30d' | '90d' | 'all'
  min_trades?: number
  category?: string
  limit?: number  // Default: 100
}
```

**Response:**
```typescript
interface PnLLeaderboardPosition {
  market_id: string
  market_title: string
  wallet_address: string
  wallet_wis: number
  realized_pnl: number      // X-axis for scatter (CORRECTED)
  total_invested: number    // Y-axis for scatter (CORRECTED)
  roi: number              // Color gradient
  side: 'YES' | 'NO'
  win_rate: number
  category: string
}

interface PnLLeaderboardResponse {
  scatter_data: PnLLeaderboardPosition[]  // For ECharts scatter
  table_data: PnLLeaderboardPosition[]    // For PrimeVue table
  summary: {
    total_positions: number
    total_pnl: number
    avg_roi: number
  }
}
```

**ECharts Configuration (CORRECTED):**
```typescript
const option = {
  xAxis: {
    name: 'Realized PnL ($)',  // CORRECTED
    type: 'value'
  },
  yAxis: {
    name: 'Total Invested ($)',  // CORRECTED
    type: 'value'
  },
  series: [{
    type: 'scatter',
    data: scatter_data.map(d => ({
      value: [d.realized_pnl, d.total_invested],  // CORRECTED
      itemStyle: { color: getColorByROI(d.roi) }
    }))
  }]
}
```

---

## Frontend Architecture

### Library Integrations

#### ECharts (Replacing Recharts)

**Installation:**
```bash
pnpm add echarts echarts-for-react
```

**Wrapper Component Pattern:**
```typescript
// components/charts/EChartsWrapper.tsx
import ReactECharts from 'echarts-for-react'
import { useTheme } from 'next-themes'

interface EChartsWrapperProps {
  option: any
  style?: React.CSSProperties
  className?: string
}

export function EChartsWrapper({ option, style, className }: EChartsWrapperProps) {
  const { theme } = useTheme()

  // Merge theme-aware defaults
  const mergedOption = {
    backgroundColor: 'transparent',
    textStyle: {
      color: theme === 'dark' ? '#e5e7eb' : '#1f2937'
    },
    ...option
  }

  return (
    <ReactECharts
      option={mergedOption}
      style={style || { height: '400px', width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  )
}
```

#### PrimeVue DataTable (Replacing Current Tables)

**Installation:**
```bash
pnpm add primevue primeicons
```

**Configuration (`app/layout.tsx`):**
```typescript
import 'primevue/resources/themes/lara-light-blue/theme.css'
import 'primevue/resources/primevue.min.css'
import 'primeicons/primeicons.css'
```

**Market Screener Implementation (15 Columns):**
```typescript
// components/discovery/MarketScreener.tsx
import { DataTable } from 'primevue/datatable'
import { Column } from 'primevue/column'

interface MarketScreenerRow {
  market_id: string
  title: string
  outcome: 'YES' | 'NO'
  sii: number
  last_price: number
  momentum: number
  volume_24h: number
  trades_24h: number
  buyers_24h: number
  sellers_24h: number
  buy_sell_ratio: number
  volatility: number
  spread_bps: number
  liquidity_usd_1pct: number
  category: string
  flag: boolean | null
}

export function MarketScreener({ markets }: { markets: MarketScreenerRow[] }) {
  return (
    <DataTable
      value={markets}
      scrollable
      scrollHeight="flex"
      virtualScrollerOptions={{ itemSize: 46 }}
      filterDisplay="row"
      sortMode="multiple"
      showGridlines
      stripedRows
    >
      {/* Column 1: Market */}
      <Column
        field="title"
        header="Market"
        sortable
        filter
        frozen
        style={{ minWidth: '300px' }}
        body={(row) => (
          <a href={`/analysis/market/${row.market_id}`} className="text-blue-600 hover:underline">
            {row.title}
          </a>
        )}
      />

      {/* Column 2: Outcome */}
      <Column
        field="outcome"
        header="Outcome"
        sortable
        style={{ width: '100px' }}
      />

      {/* Column 3: SII (Hero Signal) */}
      <Column
        field="sii"
        header="SII"
        sortable
        filter
        dataType="numeric"
        style={{ width: '100px' }}
        body={(row) => {
          const color = row.sii > 50 ? 'text-green-600' : row.sii < -50 ? 'text-red-600' : 'text-gray-600'
          return <span className={`font-semibold ${color}`}>{row.sii}</span>
        }}
      />

      {/* Column 4: Last Price */}
      <Column
        field="last_price"
        header="Price"
        sortable
        style={{ width: '100px' }}
        body={(row) => `${(row.last_price * 100).toFixed(1)}¢`}
      />

      {/* Column 5: Momentum (Hero Signal) */}
      <Column
        field="momentum"
        header="Momentum"
        sortable
        filter
        dataType="numeric"
        style={{ width: '120px' }}
      />

      {/* Column 6: Volume ($) */}
      <Column
        field="volume_24h"
        header="Volume ($)"
        sortable
        filter
        dataType="numeric"
        style={{ width: '120px' }}
        body={(row) => `$${(row.volume_24h / 1000).toFixed(1)}k`}
      />

      {/* Column 7: # Trades */}
      <Column
        field="trades_24h"
        header="# Trades"
        sortable
        filter
        dataType="numeric"
        style={{ width: '100px' }}
      />

      {/* Column 8: # Buyers */}
      <Column
        field="buyers_24h"
        header="# Buyers"
        sortable
        style={{ width: '100px' }}
      />

      {/* Column 9: # Sellers */}
      <Column
        field="sellers_24h"
        header="# Sellers"
        sortable
        style={{ width: '100px' }}
      />

      {/* Column 10: Buy/Sell Ratio */}
      <Column
        field="buy_sell_ratio"
        header="B/S Ratio"
        sortable
        style={{ width: '100px' }}
        body={(row) => row.buy_sell_ratio.toFixed(2)}
      />

      {/* Column 11: Volatility (σ) */}
      <Column
        field="volatility"
        header="Volatility (σ)"
        sortable
        filter
        dataType="numeric"
        style={{ width: '120px' }}
        body={(row) => row.volatility.toFixed(2)}
      />

      {/* Column 12: Spread (bps) */}
      <Column
        field="spread_bps"
        header="Spread (bps)"
        sortable
        style={{ width: '120px' }}
      />

      {/* Column 13: Liquidity ($) */}
      <Column
        field="liquidity_usd_1pct"
        header="Liquidity ($)"
        sortable
        filter
        dataType="numeric"
        style={{ width: '120px' }}
        body={(row) => `$${(row.liquidity_usd_1pct / 1000).toFixed(1)}k`}
      />

      {/* Column 14: Category */}
      <Column
        field="category"
        header="Category"
        sortable
        filter
        style={{ width: '120px' }}
      />

      {/* Column 15: Flag (Rigged Score) */}
      <Column
        field="flag"
        header="Flag"
        style={{ width: '80px' }}
        body={(row) => row.flag ? '🚩' : null}
      />
    </DataTable>
  )
}
```

### Strategy Builder (React Flow)

**Node Palette (18 Nodes):**

```typescript
// components/strategy-builder/nodes/index.ts
export const NODE_TYPES = {
  // Triggers (2)
  onSchedule: OnScheduleNode,
  onNewMarket: OnNewMarketNode,

  // Data (3)
  getMarkets: GetMarketsNode,
  getMarketData: GetMarketDataNode,
  getWalletData: GetWalletDataNode,

  // Strategy (3)
  findWallets: FindWalletsNode,
  findSpecialist: FindSpecialistNode,
  checkWalletAgreement: CheckWalletAgreementNode,

  // Agents (3)
  runFigureOutAble: RunFigureOutAbleNode,
  runGoogleAble: RunGoogleAbleNode,
  runDeepResearch: RunDeepResearchNode,

  // Logic (3)
  filterNumeric: FilterNumericNode,
  filterBoolean: FilterBooleanNode,
  waitMomentumFlip: WaitMomentumFlipNode,

  // Risk (2)
  setMaxBet: SetMaxBetNode,
  setDiversification: SetDiversificationNode,

  // Actions (2)
  addToWatchlist: AddToWatchlistNode,
  triggerTrade: TriggerTradeNode
}
```

**Node Definition Example (Find Specialist "Eggman"):**
```typescript
// components/strategy-builder/nodes/FindSpecialistNode.tsx
import { Handle, Position } from '@xyflow/react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface FindSpecialistNodeData {
  category: string
  min_win_rate: number
  min_trades: number
}

export function FindSpecialistNode({ data, isConnectable }: any) {
  return (
    <Card className="p-4 min-w-[250px]">
      <div className="flex items-center gap-2 mb-3">
        <Crown className="h-5 w-5 text-yellow-600" />
        <span className="font-semibold">Find Specialist ("Eggman")</span>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Category</Label>
          <Select
            value={data.category}
            onValueChange={(v) => data.updateConfig?.('category', v)}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Politics">Politics</SelectItem>
              <SelectItem value="Sports">Sports</SelectItem>
              <SelectItem value="Crypto">Crypto</SelectItem>
              <SelectItem value="Entertainment">Entertainment</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Min Win Rate (%)</Label>
          <Input
            type="number"
            value={data.min_win_rate || 60}
            onChange={(e) => data.updateConfig?.('min_win_rate', parseInt(e.target.value))}
            className="h-8"
          />
        </div>

        <div>
          <Label className="text-xs">Min Trades</Label>
          <Input
            type="number"
            value={data.min_trades || 100}
            onChange={(e) => data.updateConfig?.('min_trades', parseInt(e.target.value))}
            className="h-8"
          />
        </div>
      </div>

      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </Card>
  )
}
```

---

## Migration Strategy

### Archive (Don't Delete) Crypto Pages

**Create archive directory:**
```bash
mkdir -p app/\(archive\)
```

**Move crypto pages:**
```bash
# Bot pages
mv app/\(dashboard\)/ai-bot app/\(archive\)/ai-bot
mv app/\(dashboard\)/dca-bot app/\(archive\)/dca-bot
mv app/\(dashboard\)/arbitrage-bot app/\(archive\)/arbitrage-bot
mv app/\(dashboard\)/signal-bot app/\(archive\)/signal-bot

# DeFi pages
mv app/\(dashboard\)/defi-center app/\(archive\)/defi-center
mv app/\(dashboard\)/defi-protocols app/\(archive\)/defi-protocols

# Archive components
mv components/ai-bot-dashboard components/\(archive\)/ai-bot-dashboard
mv components/dca-bot-dashboard components/\(archive\)/dca-bot-dashboard
# ... (all crypto-specific components)
```

**Update `.gitignore` to still track archive:**
```gitignore
# .gitignore

# Don't ignore archive (we want design reference)
!app/(archive)
!components/(archive)
```

### Recharts → ECharts Migration

**Step 1: Create wrapper components** (see Frontend Architecture section)

**Step 2: Replace chart by chart:**
```typescript
// BEFORE (Recharts)
import { LineChart, Line, XAxis, YAxis } from 'recharts'

<LineChart width={500} height={300} data={data}>
  <XAxis dataKey="name" />
  <YAxis />
  <Line type="monotone" dataKey="value" stroke="#8884d8" />
</LineChart>

// AFTER (ECharts)
import { EChartsWrapper } from '@/components/charts/EChartsWrapper'

<EChartsWrapper
  option={{
    xAxis: { type: 'category', data: data.map(d => d.name) },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: data.map(d => d.value),
      smooth: true,
      lineStyle: { color: '#8884d8' }
    }]
  }}
/>
```

### Tables → PrimeVue Migration

**Step 1: Install and configure** (see Frontend Architecture)

**Step 2: Replace table by table:**
```typescript
// BEFORE (shadcn Table)
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Value</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {data.map((row) => (
      <TableRow key={row.id}>
        <TableCell>{row.name}</TableCell>
        <TableCell>{row.value}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>

// AFTER (PrimeVue DataTable)
import { DataTable } from 'primevue/datatable'
import { Column } from 'primevue/column'

<DataTable
  value={data}
  scrollable
  scrollHeight="500px"
  virtualScrollerOptions={{ itemSize: 46 }}
  filterDisplay="row"
  sortMode="multiple"
>
  <Column field="name" header="Name" sortable filter />
  <Column field="value" header="Value" sortable filter />
</DataTable>
```

---

## Deployment & Infrastructure

### Database Tier Strategy

#### Hot Tier (Supabase - 30-60 days)

**Partitioning Strategy:**
```sql
-- Create partitions for recent months
DO $$
DECLARE
  start_date date := date_trunc('month', current_date - interval '2 months');
  end_date date := date_trunc('month', current_date + interval '2 months');
  curr_date date := start_date;
BEGIN
  WHILE curr_date < end_date LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS trades_%s PARTITION OF trades FOR VALUES FROM (%L) TO (%L)',
      to_char(curr_date, 'YYYY_MM'),
      curr_date,
      curr_date + interval '1 month'
    );
    curr_date := curr_date + interval '1 month';
  END LOOP;
END $$;
```

**Covering Indexes:**
```sql
-- Primary access patterns
CREATE INDEX idx_trades_market_ts ON trades (market_id, timestamp DESC);
CREATE INDEX idx_trades_wallet_ts ON trades (wallet_address, timestamp DESC);
CREATE INDEX idx_prices_market_ts ON prices_1m (market_id, timestamp DESC);
```

**Materialized View Refresh:**
```sql
-- Refresh wallet scores every 15 minutes
CREATE OR REPLACE FUNCTION refresh_wallet_scores()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY wallet_scores_mv;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron
SELECT cron.schedule('refresh-wallet-scores', '*/15 * * * *', 'SELECT refresh_wallet_scores()');

-- Refresh market signals every 1 minute
CREATE OR REPLACE FUNCTION refresh_market_signals()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY market_signals_mv;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule('refresh-market-signals', '*/1 * * * *', 'SELECT refresh_market_signals()');
```

#### Cold Tier (S3/R2 - Historical archives)

**Daily Dump Job:**
```typescript
// jobs/daily-dump-to-s3.ts
import { createWriteStream } from 'fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import parquet from 'parquetjs'

export async function dumpTradesToParquet(date: string) {
  const trades = await supabase
    .from('trades')
    .select('*')
    .gte('timestamp', `${date}T00:00:00Z`)
    .lt('timestamp', `${date}T23:59:59Z`)

  // Write to Parquet
  const schema = new parquet.ParquetSchema({
    trade_id: { type: 'UTF8' },
    market_id: { type: 'UTF8' },
    wallet_address: { type: 'UTF8' },
    side: { type: 'UTF8' },
    price: { type: 'DOUBLE' },
    size_usd: { type: 'DOUBLE' },
    timestamp: { type: 'TIMESTAMP_MILLIS' }
  })

  const writer = await parquet.ParquetWriter.openFile(schema, `/tmp/trades-${date}.parquet`)

  for (const trade of trades.data) {
    await writer.appendRow(trade)
  }

  await writer.close()

  // Upload to S3/R2
  const s3 = new S3Client({ region: 'auto' })
  const fileStream = createReadStream(`/tmp/trades-${date}.parquet`)

  await s3.send(new PutObjectCommand({
    Bucket: 'cascadian-historical',
    Key: `trades/year=${date.slice(0,4)}/month=${date.slice(5,7)}/trades-${date}.parquet`,
    Body: fileStream
  }))

  console.log(`Dumped trades for ${date} to S3`)
}
```

#### Scale Tier (ClickHouse Cloud - When needed)

**Triggers for ClickHouse:**
- Total row count > 50-100M rows
- Multi-month chart queries with p95 > 300ms
- Need for complex aggregations over historical data

**Migration Path:**
```bash
# 1. Backfill ClickHouse from S3 Parquet
clickhouse-client --query "
  CREATE TABLE trades (
    trade_id String,
    market_id String,
    wallet_address String,
    side String,
    price Float64,
    size_usd Float64,
    timestamp DateTime
  ) ENGINE = MergeTree()
  ORDER BY (market_id, timestamp)
"

# 2. Load from S3
clickhouse-client --query "
  INSERT INTO trades
  SELECT * FROM s3(
    's3://cascadian-historical/trades/**/*.parquet',
    'Parquet'
  )
"
```

**Supabase ↔ ClickHouse Integration:**
```sql
-- Use Supabase's ClickHouse FDW (Foreign Data Wrapper)
CREATE EXTENSION clickhouse_fdw;

CREATE SERVER clickhouse_server
  FOREIGN DATA WRAPPER clickhouse_fdw
  OPTIONS (host 'your-clickhouse-cloud.clickhouse.cloud', port '8123');

CREATE FOREIGN TABLE trades_clickhouse (
  trade_id text,
  market_id text,
  wallet_address text,
  side text,
  price numeric,
  size_usd numeric,
  timestamp timestamptz
)
SERVER clickhouse_server
OPTIONS (table_name 'trades');

-- Now can join Supabase + ClickHouse in single query
SELECT
  m.title,
  COUNT(*) as total_trades,
  SUM(t.size_usd) as total_volume
FROM markets m
JOIN trades_clickhouse t ON m.market_id = t.market_id
WHERE t.timestamp > now() - interval '90 days'
GROUP BY m.title;
```

---

## Next Steps & Recommendations

### Immediate Actions

1. ✅ **Engage Database Expert Agent**
   - Analyze actual data volumes from Polymarket API
   - Calculate storage costs for 3-tier architecture
   - Optimize partition sizes and refresh rates
   - Determine exact ClickHouse migration trigger points

2. ✅ **Install Dependencies**
   ```bash
   pnpm add echarts echarts-for-react primevue primeicons
   pnpm add @xyflow/react  # Already installed
   pnpm add @upstash/redis @aws-sdk/client-s3 parquetjs
   ```

3. ✅ **Database Setup**
   - Implement partitioned tables
   - Create materialized views
   - Set up pg_cron for refresh jobs
   - Implement TTL cleanup jobs

4. ✅ **Archive Migration**
   - Create `app/(archive)` and `components/(archive)`
   - Move all crypto-specific pages/components
   - Update .gitignore to track archives

### V2 Features (Excluded from V1)

1. **AI Co-Pilot** (V2 Feature)
   - Analyst mode for SQL queries
   - Co-Pilot mode for conversational building
   - LangChain/LlamaIndex integration

---

## Summary

This technical design implements:

✅ **Correct signal definitions** (is_rigged/is_googleable on-demand only)
✅ **15-column Market Screener** (SII-focused, no noisy metrics)
✅ **Fixed PnL Leaderboard** (Realized PnL vs Total Invested)
✅ **Contrarian metrics** (score + win rate everywhere)
✅ **React Flow** (not Rete.js)
✅ **18-node palette** (including MiroMind, Find Specialist, etc.)
✅ **Dedicated wallet per strategy** (isolated P&L)
✅ **3-tier database** (Supabase → S3/R2 → ClickHouse Cloud)
✅ **Library migrations** (ECharts + PrimeVue patterns)
✅ **Archive strategy** (not delete)
✅ **Complete API contracts** (all endpoints defined)

**Excluded from V1:** AI Co-Pilot (moved to V2)

**Recommended:** Engage database expert agent to validate storage/cost assumptions before implementation.
