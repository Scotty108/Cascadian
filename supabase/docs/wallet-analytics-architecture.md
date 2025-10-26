# Wallet Analytics & Smart Score Architecture

**Version:** 2.0
**Last Updated:** 2025-10-24
**Status:** Design Phase

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Concepts](#core-concepts)
4. [Data Pipeline](#data-pipeline)
5. [Database Architecture](#database-architecture)
6. [Metric Calculations](#metric-calculations)
7. [Smart Score Formula](#smart-score-formula)
8. [Market SII Calculation](#market-sii-calculation)
9. [API Endpoints](#api-endpoints)
10. [Performance Optimization](#performance-optimization)
11. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

The Wallet Analytics system tracks prediction market trader performance to identify skilled wallets ("smart money") and generate trading signals based on their behavior. This enables users to follow the best traders and identify market opportunities where smart money diverges from crowd sentiment.

### Key Objectives

1. **Track wallet performance**: Calculate sophisticated metrics (Omega ratio, Sharpe, win rate) for active traders
2. **Identify smart money**: Score wallets to separate skilled traders from noise
3. **Generate market signals**: Detect imbalance when smart money concentrates on one side of a market
4. **Enable copy trading**: Allow users to follow top performers
5. **Flexible formulas**: Support dynamic formula creation via node builder

### Relationship to Existing Systems

- **Extends** current wallet scoring system (lib/SCORING_SYSTEM.md) with historical trade analysis
- **Replaces** current Smart Money Flow's wallet-level SII with market-level SII
- **Uses** existing Polymarket integration (lib/polymarket/README.md) as starting point
- **Adds** new data sources (Goldsky subgraphs) and databases (ClickHouse)

---

## System Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Collection Layer                     │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Goldsky         │         │  Polymarket      │         │
│  │  Subgraphs       │         │  CLOB API        │         │
│  │                  │         │                  │         │
│  │ - Activity       │         │ - Current        │         │
│  │ - Positions      │         │   Positions      │         │
│  │ - PNL            │         │ - Market Data    │         │
│  └────────┬─────────┘         └────────┬─────────┘         │
└───────────┼────────────────────────────┼───────────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      ETL Pipeline Layer                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Node.js/Python ETL Workers (Cron/Event-driven)     │  │
│  │                                                       │  │
│  │  1. Query Goldsky for new trades                    │  │
│  │  2. Filter by position size (>$5k portfolio)        │  │
│  │  3. Transform to internal schema                    │  │
│  │  4. Batch insert to ClickHouse                      │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                             │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  ClickHouse DB   │         │  Postgres        │         │
│  │                  │         │  (Supabase)      │         │
│  │ - trades_raw     │         │                  │         │
│  │ - wallet_metrics │         │ - wallet_scores  │         │
│  │ - market_pos     │         │ - market_sii     │         │
│  └────────┬─────────┘         │ - markets        │         │
│           │                    └────────┬─────────┘         │
│           │                             │                    │
└───────────┼─────────────────────────────┼───────────────────┘
            │                             │
            ▼                             │
┌─────────────────────────────────────────────────────────────┐
│                  Calculation Layer                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Scheduled Jobs (Hourly)                             │  │
│  │                                                       │  │
│  │  1. Identify top N wallets per market                │  │
│  │  2. Calculate smart scores (Omega, Sharpe, etc.)     │  │
│  │  3. Update wallet_scores in Postgres                 │  │
│  │  4. Calculate market SII (smart money imbalance)     │  │
│  │  5. Cache in Redis for fast access                   │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Layer                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js API Routes                                   │  │
│  │                                                       │  │
│  │  GET /api/wallets/[address]/score                    │  │
│  │  GET /api/markets/[id]/sii                           │  │
│  │  POST /api/signals/create (node builder)            │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Market Screener │         │  Node Builder    │         │
│  │  (signals)       │         │  (formulas)      │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Data Collection** | Goldsky GraphQL, Polymarket API | Fetch trade history & positions |
| **Storage (Analytics)** | ClickHouse Cloud | Store 500M+ trade records, fast time-series queries |
| **Storage (Transactional)** | Postgres (Supabase) | Current scores, market data, user data |
| **Cache** | Redis (Upstash) | Hot cache for wallet scores (1hr TTL) |
| **Compute** | Node.js/TypeScript | ETL workers, calculation jobs |
| **API** | Next.js API Routes | RESTful endpoints for frontend |
| **Frontend** | React, TanStack Query | Market screener, node builder |

---

## Core Concepts

### 1. Smart Score (Wallet-Level)

**Definition**: A 0-100 score representing a wallet's trading skill based on historical performance.

**Components:**
- **Omega Ratio**: Probability-weighted gains vs losses (captures asymmetric upside)
- **Omega Momentum**: Rate of change in Omega ratio (is their edge improving?)
- **Sharpe Ratio**: Risk-adjusted returns
- **Win Rate**: Percentage of profitable trades
- **EV/Hour**: Expected value per hour (fast compounding wallets)

**Formula** (example - configurable):
```typescript
smart_score = (
  omega_ratio_30d × 0.30 +
  omega_momentum × 0.25 +
  sharpe_ratio_30d × 0.20 +
  win_rate × 0.15 +
  ev_per_hour × 0.10
) × difficulty_multiplier × sample_size_factor
```

**Grade System:**
| Grade | Score | Label |
|-------|-------|-------|
| S | 90-100 | Elite |
| A | 80-89 | Excellent |
| B | 70-79 | Good |
| C | 60-69 | Average |
| D | 50-59 | Below Average |
| F | 0-49 | Poor |

### 2. Market SII (Market-Level)

**Definition**: Signal Intelligence Index - measures the quality and imbalance of participants in a specific market.

**Key Insight**: Not all liquidity is equal. $5M from elite traders is more informative than $5M from poor performers.

**Calculation:**
```typescript
// Step 1: Get top N positions on each side
yes_positions = getTopNPositions(market_id, side='YES', N=20)
no_positions = getTopNPositions(market_id, side='NO', N=20)

// Step 2: Lookup smart scores for those wallets
yes_scores = yes_positions.map(p => getSmartScore(p.wallet))
no_scores = no_positions.map(p => getSmartScore(p.wallet))

// Step 3: Calculate weighted averages
yes_avg = weightedAverage(yes_scores, yes_positions.map(p => p.value))
no_avg = weightedAverage(no_scores, no_positions.map(p => p.value))

// Step 4: Calculate imbalance
sii_signal = yes_avg - no_avg  // Range: -100 to +100
sii_confidence = (smart_money_total / total_liquidity) × 100
```

**Example:**
```
Market: "Will Bitcoin hit $100K by Dec 2025?"

YES side ($8M total):
- Top 20 positions = $6M (75% of YES liquidity)
- Avg smart score: 82.3 (Elite/Smart traders)

NO side ($4M total):
- Top 20 positions = $3M (75% of NO liquidity)
- Avg smart score: 48.7 (Below average traders)

SII Signal: +33.6 (Strong YES signal)
SII Confidence: 75% (High - top wallets control 75% of liquidity)

Interpretation: Smart money strongly favors YES.
Market price: 55% YES → Potential buying opportunity
```

### 3. Power Law Distribution

**Hypothesis**: In prediction markets, the top 20-100 positions per side represent 60-80% of total liquidity.

**Implications:**
- We only need to calculate scores for ~40-100 wallets per market (not all participants)
- Reduces data requirements from 50,000 wallets globally to ~5,000 active wallets
- Makes real-time calculation feasible

**Configurable Top-N:**
Users can adjust via node builder:
- Conservative: Top 20 (whale-focused)
- Moderate: Top 50 (balanced)
- Broad: Top 100 (includes smaller positions)

---

## Data Pipeline

### Data Sources

#### 1. Goldsky Subgraphs (Historical Trades)

**Public GraphQL endpoints** (no auth required):

```
Activity Subgraph:
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn

Positions Subgraph:
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn

PNL Subgraph:
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn
```

**Data Available:**
- Complete trade history (all time)
- Entry/exit prices, position sizes
- Timestamps, market IDs
- PnL per trade

**Example Query:**
```graphql
query GetWalletTrades($wallet: String!, $limit: Int!) {
  trades(
    where: { user: $wallet }
    first: $limit
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    user
    market
    side
    shares
    price
    timestamp
    value
    pnl
  }
}
```

#### 2. Polymarket CLOB API (Current Positions)

**Endpoint:** `GET /markets/{market_id}/positions`

**Data Available:**
- Current open positions
- Wallet addresses + position sizes
- Used to identify top N wallets per market

### ETL Pipeline Flow

```
┌─────────────────────────────────────────┐
│  Hourly Job: Update Wallet Scores       │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 1: Identify Active Wallets        │
│  - Query all active markets              │
│  - For each market, get top N positions  │
│  - Extract unique wallet addresses       │
│  - Filter: portfolio value > $5k         │
│  Result: ~2,000-5,000 wallets           │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 2: Fetch Trade History            │
│  - For each wallet (batch 10 at a time): │
│    - Query Goldsky activity subgraph     │
│    - Get all trades (or since last sync) │
│  - Insert/update in ClickHouse           │
│  Result: New trades ingested             │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 3: Calculate Metrics               │
│  - For each wallet:                      │
│    - Query ClickHouse for trades         │
│    - Calculate rolling metrics:          │
│      - Omega ratio (30d, 60d, 90d)       │
│      - Sharpe ratio (30d, 60d)           │
│      - Win rate, avg win/loss            │
│      - EV per hour                       │
│    - Compute omega momentum              │
│  Result: Wallet metrics calculated       │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 4: Calculate Smart Scores          │
│  - Apply configurable formula            │
│  - Apply difficulty multiplier           │
│  - Apply sample size penalty             │
│  - Store in Postgres + Redis cache       │
│  Result: Wallet scores ready             │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 5: Calculate Market SII            │
│  - For each active market:               │
│    - Get top N YES positions             │
│    - Get top N NO positions              │
│    - Lookup wallet scores                │
│    - Calculate weighted averages         │
│    - Calculate SII signal & confidence   │
│  - Store in Postgres                     │
│  Result: Market signals ready            │
└─────────────────────────────────────────┘
```

---

## Database Architecture

### ClickHouse (Analytical Database)

**Purpose**: Store high-volume time-series data for complex analytical queries.

#### Table: `trades_raw`

```sql
CREATE TABLE trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192;
```

**Indexes:**
- `(wallet_address, timestamp)` - Query trades for a wallet
- `(market_id, timestamp)` - Query trades for a market

**Size Estimate:**
- 20,000 wallets × 20 trades/day × 365 days = 146M rows/year
- ~50-100GB compressed after 2-3 years

#### Table: `wallet_metrics_daily`

Materialized view pre-calculating daily metrics:

```sql
CREATE MATERIALIZED VIEW wallet_metrics_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, date)
AS SELECT
  wallet_address,
  toDate(timestamp) AS date,
  countIf(pnl > 0) AS wins,
  countIf(pnl <= 0) AS losses,
  sum(pnl) AS total_pnl,
  avg(pnl) AS avg_pnl,
  stddevPop(pnl) AS pnl_stddev,
  sum(usd_value) AS total_volume
FROM trades_raw
WHERE is_closed = true
GROUP BY wallet_address, toDate(timestamp);
```

**Benefits:**
- Fast rolling window calculations (omega, sharpe over 30/60/90 days)
- Pre-aggregated, no need to scan millions of rows

### Postgres (Transactional Database)

**Purpose**: Store current state, user-facing data, API responses.

#### Table: `wallet_scores`

```sql
CREATE TABLE wallet_scores (
  wallet_address TEXT PRIMARY KEY,
  smart_score NUMERIC(5, 2) NOT NULL CHECK (smart_score >= 0 AND smart_score <= 100),
  grade VARCHAR(3) NOT NULL, -- S, A, B, C, D, F

  -- Component scores
  omega_ratio_30d NUMERIC(8, 4),
  omega_ratio_60d NUMERIC(8, 4),
  omega_momentum NUMERIC(8, 4),
  sharpe_ratio_30d NUMERIC(8, 4),
  win_rate NUMERIC(5, 4),
  ev_per_hour NUMERIC(12, 2),

  -- Metadata
  total_trades INTEGER NOT NULL,
  portfolio_value NUMERIC(18, 2),
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  last_calculated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_wallet_scores_smart_score ON wallet_scores(smart_score DESC) WHERE is_active = true;
CREATE INDEX idx_wallet_scores_last_calculated ON wallet_scores(last_calculated_at);
```

**Row Count**: ~5,000-10,000 wallets (only scored wallets)

#### Table: `market_sii`

```sql
CREATE TABLE market_sii (
  market_id TEXT PRIMARY KEY REFERENCES markets(market_id),

  -- SII Metrics
  sii_signal NUMERIC(6, 2) NOT NULL, -- -100 to +100
  sii_confidence NUMERIC(5, 2) NOT NULL, -- 0 to 100

  -- Side Breakdown
  yes_avg_score NUMERIC(5, 2),
  yes_total_liquidity NUMERIC(18, 2),
  yes_smart_money_pct NUMERIC(5, 2),
  yes_wallet_count INTEGER,

  no_avg_score NUMERIC(5, 2),
  no_total_liquidity NUMERIC(18, 2),
  no_smart_money_pct NUMERIC(5, 2),
  no_wallet_count INTEGER,

  -- Configuration
  top_n_used INTEGER NOT NULL, -- How many wallets per side

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_market_sii_signal ON market_sii(sii_signal DESC);
CREATE INDEX idx_market_sii_confidence ON market_sii(sii_confidence DESC);
```

**Row Count**: ~1,000-2,000 markets (only active markets with positions)

### Redis Cache

**Purpose**: Hot cache for frequently accessed data (1 hour TTL).

**Keys:**
```
wallet:score:{address} → { score: 85.3, grade: 'A', updated_at: timestamp }
market:sii:{market_id} → { signal: 33.6, confidence: 75, ... }
```

**Benefits:**
- Sub-millisecond lookups
- Reduces Postgres load
- TTL ensures eventual consistency

---

## Metric Calculations

### Omega Ratio

**Definition**: Ratio of probability-weighted gains to losses above a threshold (usually 0).

**Formula**:
```
Omega(threshold) = Integral(1 - F(x), x > threshold) / Integral(F(x), x < threshold)

Where F(x) is cumulative distribution function of returns
```

**Simplified Implementation**:
```typescript
function calculateOmegaRatio(returns: number[], threshold: number = 0): number {
  const gains = returns.filter(r => r > threshold).reduce((sum, r) => sum + (r - threshold), 0)
  const losses = returns.filter(r => r < threshold).reduce((sum, r) => sum + (threshold - r), 0)

  return losses === 0 ? Infinity : gains / losses
}
```

**Interpretation**:
- Omega > 2.0 = Excellent (gains 2x more likely than losses)
- Omega > 1.5 = Good
- Omega > 1.0 = Profitable (gains > losses)
- Omega < 1.0 = Losing trader

**Rolling Windows**:
- 30-day: Recent performance
- 60-day: Medium-term consistency
- 90-day: Long-term track record

### Omega Momentum

**Definition**: Rate of change in Omega ratio (is the trader's edge improving?).

**Formula**:
```typescript
omega_momentum = (omega_30d - omega_60d) / omega_60d
```

**Interpretation**:
- +0.20 = Omega improving 20% (strengthening edge)
- 0.00 = Stable performance
- -0.20 = Omega declining 20% (weakening edge)

**Use Case**: Filter for wallets with `omega_momentum > 0.1` to find traders whose edge is improving.

### Sharpe Ratio

**Definition**: Risk-adjusted return (mean return / standard deviation).

**Formula**:
```typescript
sharpe_ratio = (mean_return - risk_free_rate) / stddev_return
```

**Interpretation**:
- Sharpe > 2.0 = Excellent risk-adjusted returns
- Sharpe > 1.5 = Very good
- Sharpe > 1.0 = Good
- Sharpe < 0.5 = High risk for low returns

### Win Rate

**Definition**: Percentage of trades that were profitable.

**Formula**:
```typescript
win_rate = (profitable_trades / total_trades) × 100
```

**Interpretation**:
- 75%+ = Elite
- 60-75% = Excellent
- 50-60% = Good
- <50% = Losing trader

### EV Per Hour

**Definition**: Expected value earned per hour (measures fast compounding).

**Formula**:
```typescript
total_pnl = sum(all_trades.pnl)
total_hours = (last_trade_timestamp - first_trade_timestamp) / 3600
ev_per_hour = total_pnl / total_hours
```

**Interpretation**:
- $500/hr+ = Very active, high EV
- $100-500/hr = Good
- <$100/hr = Low activity or small positions

**Why It Matters**: A trader with 80% win rate but only 1 trade/month is less valuable to follow than someone with 65% win rate and 10 trades/day.

---

## Smart Score Formula

### Configurable Formula System

**Design Goal**: Allow formulas to be defined as data (JSON), not hardcoded.

**Formula Definition**:
```json
{
  "formula_id": "smart_score_v1",
  "name": "Omega-Weighted Smart Score",
  "version": "1.0",
  "components": [
    {
      "metric": "omega_ratio_30d",
      "weight": 0.30,
      "normalization": {
        "min": 0,
        "max": 5,
        "excellent": 2.0,
        "good": 1.5,
        "fair": 1.0
      }
    },
    {
      "metric": "omega_momentum",
      "weight": 0.25,
      "normalization": {
        "min": -1.0,
        "max": 1.0,
        "excellent": 0.20,
        "good": 0.10,
        "fair": 0.0
      }
    },
    {
      "metric": "sharpe_ratio_30d",
      "weight": 0.20,
      "normalization": {
        "min": -1.0,
        "max": 4.0,
        "excellent": 2.0,
        "good": 1.5,
        "fair": 1.0
      }
    },
    {
      "metric": "win_rate",
      "weight": 0.15,
      "normalization": {
        "min": 0.0,
        "max": 1.0,
        "excellent": 0.75,
        "good": 0.60,
        "fair": 0.50
      }
    },
    {
      "metric": "ev_per_hour",
      "weight": 0.10,
      "normalization": {
        "min": 0,
        "max": 1000,
        "excellent": 500,
        "good": 200,
        "fair": 50
      }
    }
  ],
  "adjustments": [
    {
      "type": "sample_size_penalty",
      "min_trades": 10,
      "penalty_curve": "sqrt"
    },
    {
      "type": "difficulty_multiplier",
      "category_multipliers": {
        "Crypto": 1.25,
        "Politics": 1.10,
        "Sports": 1.30
      }
    }
  ]
}
```

**Calculation Engine**:
```typescript
function calculateSmartScore(
  wallet: WalletMetrics,
  formula: FormulaDefinition
): number {
  let rawScore = 0

  // Step 1: Calculate weighted sum
  for (const component of formula.components) {
    const value = wallet[component.metric]
    const normalized = normalizeValue(value, component.normalization)
    rawScore += normalized * component.weight
  }

  // Step 2: Apply adjustments
  for (const adjustment of formula.adjustments) {
    if (adjustment.type === 'sample_size_penalty') {
      rawScore *= calculateSampleSizeFactor(wallet.total_trades, adjustment.min_trades)
    }
    if (adjustment.type === 'difficulty_multiplier') {
      rawScore *= adjustment.category_multipliers[wallet.primary_category] || 1.0
    }
  }

  // Step 3: Clamp to 0-100
  return Math.max(0, Math.min(100, rawScore))
}
```

### Sample Size Penalty

**Problem**: A wallet with 2 trades and 100% win rate shouldn't score higher than a wallet with 100 trades and 70% win rate.

**Solution**: Apply confidence factor based on trade count.

```typescript
function calculateSampleSizeFactor(trades: number, min_trades: number): number {
  if (trades >= min_trades) return 1.0
  if (trades <= 1) return 0.2

  // Gradual ramp from 0.2 to 1.0
  return 0.2 + (0.8 * (trades / min_trades))
}
```

**Example**:
- 1 trade → 0.20 factor (score × 0.2)
- 5 trades → 0.60 factor
- 10+ trades → 1.00 factor (no penalty)

---

## Market SII Calculation

### Algorithm

```typescript
interface MarketSIICalculation {
  marketId: string
  topN: number  // Configurable: 20, 50, 100
  weightingMethod: 'equal' | 'liquidityWeighted' | 'sqrtWeighted'
}

async function calculateMarketSII(config: MarketSIICalculation) {
  // Step 1: Get top N positions on each side
  const yesPositions = await getTopPositions(config.marketId, 'YES', config.topN)
  const noPositions = await getTopPositions(config.marketId, 'NO', config.topN)

  // Step 2: Fetch wallet scores from cache/DB
  const yesScores = await fetchWalletScores(yesPositions.map(p => p.wallet))
  const noScores = await fetchWalletScores(noPositions.map(p => p.wallet))

  // Step 3: Calculate weighted averages
  const yesAvg = weightedAverage(
    yesScores,
    yesPositions.map(p => p.usd_value),
    config.weightingMethod
  )
  const noAvg = weightedAverage(
    noScores,
    noPositions.map(p => p.usd_value),
    config.weightingMethod
  )

  // Step 4: Calculate metrics
  const siiSignal = yesAvg - noAvg  // -100 to +100
  const smartMoneyTotal = calculateSmartMoneyTotal(yesPositions, noPositions, yesScores, noScores)
  const totalLiquidity = yesPositions.reduce((sum, p) => sum + p.usd_value, 0) +
                         noPositions.reduce((sum, p) => sum + p.usd_value, 0)
  const siiConfidence = (smartMoneyTotal / totalLiquidity) * 100

  return {
    marketId: config.marketId,
    siiSignal,
    siiConfidence,
    yesAvgScore: yesAvg,
    noAvgScore: noAvg,
    yesTotalLiquidity: yesPositions.reduce((sum, p) => sum + p.usd_value, 0),
    noTotalLiquidity: noPositions.reduce((sum, p) => sum + p.usd_value, 0),
    topNUsed: config.topN,
    calculatedAt: new Date()
  }
}
```

### Weighting Methods

**Equal Weight**:
```typescript
avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
```
- Each wallet contributes equally
- Good for: Measuring crowd consensus

**Liquidity-Weighted**:
```typescript
weighted_sum = scores.map((s, i) => s * positions[i].usd_value).reduce((a, b) => a + b)
total_liquidity = positions.reduce((sum, p) => sum + p.usd_value, 0)
avg = weighted_sum / total_liquidity
```
- Whales have more influence
- Good for: Following the money

**Square Root Weighted** (Reduces whale dominance):
```typescript
weights = positions.map(p => Math.sqrt(p.usd_value))
weighted_sum = scores.map((s, i) => s * weights[i]).reduce((a, b) => a + b)
total_weight = weights.reduce((a, b) => a + b, 0)
avg = weighted_sum / total_weight
```
- Balances whale vs crowd
- Good for: Capturing broader smart money consensus

---

## API Endpoints

### GET /api/wallets/[address]/score

Get smart score for a wallet.

**Response**:
```json
{
  "success": true,
  "data": {
    "wallet_address": "0x123...",
    "smart_score": 85.3,
    "grade": "A",
    "omega_ratio_30d": 2.15,
    "omega_momentum": 0.18,
    "sharpe_ratio_30d": 1.85,
    "win_rate": 0.72,
    "ev_per_hour": 342.50,
    "total_trades": 147,
    "portfolio_value": 125000.00,
    "last_calculated_at": "2025-10-24T14:30:00Z"
  }
}
```

### GET /api/markets/[id]/sii

Get SII analysis for a market.

**Query Params**:
- `topN` (default: 20) - Number of positions per side to analyze
- `weighting` (default: 'liquidityWeighted') - Weighting method

**Response**:
```json
{
  "success": true,
  "data": {
    "market_id": "0xabc...",
    "market_title": "Will Bitcoin hit $100K by Dec 2025?",
    "sii_signal": 33.6,
    "sii_confidence": 75.2,
    "yes": {
      "avg_score": 82.3,
      "total_liquidity": 8000000,
      "smart_money_pct": 78.5,
      "wallet_count": 20
    },
    "no": {
      "avg_score": 48.7,
      "total_liquidity": 4000000,
      "smart_money_pct": 22.1,
      "wallet_count": 20
    },
    "recommendation": {
      "action": "STRONG_YES",
      "reason": "Smart money heavily favors YES (+33.6 signal)",
      "confidence": "high"
    },
    "calculated_at": "2025-10-24T14:30:00Z"
  }
}
```

### POST /api/signals/create

Create custom signal using node builder.

**Request**:
```json
{
  "name": "Elite Omega Momentum Signal",
  "formula": {
    "filters": [
      { "metric": "total_trades", "operator": ">", "value": 10 },
      { "metric": "omega_momentum", "operator": ">", "value": 0.1 }
    ],
    "sort": {
      "metric": "omega_ratio_30d",
      "direction": "desc"
    },
    "topN": 50
  }
}
```

**Response**:
```json
{
  "success": true,
  "signal_id": "sig_abc123",
  "markets_matched": 37,
  "top_markets": [
    {
      "market_id": "0x123...",
      "title": "Bitcoin $100K?",
      "sii_signal": 42.3,
      "confidence": 82.1
    }
  ]
}
```

---

## Performance Optimization

### Caching Strategy

**L1 Cache (Redis)** - 1 hour TTL
- Wallet scores
- Market SII
- Sub-millisecond reads

**L2 Cache (Postgres)** - Recalculated hourly
- Pre-aggregated scores
- Current state

**L3 (ClickHouse Materialized Views)** - Continuous
- Pre-aggregated daily metrics
- Fast rolling window queries

### Query Optimization

**ClickHouse Query Example** (Calculate Omega ratio for 30 days):
```sql
-- Pre-aggregated via materialized view (fast!)
SELECT
  wallet_address,
  sum(total_pnl) AS total_pnl,
  avg(avg_pnl) AS mean_return,
  stddevPop(avg_pnl) AS stddev_return,
  countIf(total_pnl > 0) AS winning_days,
  countIf(total_pnl < 0) AS losing_days
FROM wallet_metrics_daily
WHERE wallet_address = '0x123...'
  AND date >= today() - INTERVAL 30 DAY
GROUP BY wallet_address
```

**Performance**: <50ms for 30-day window query

### Scaling Considerations

**Current capacity** (with proposed architecture):
- 5,000 scored wallets
- 50 trades/day per wallet average
- = 250,000 trades/day
- = 91M trades/year

**ClickHouse can handle**:
- Billions of rows
- 100k+ inserts/second
- Sub-second analytical queries

**Cost estimate**:
- ClickHouse Cloud: $200-400/mo
- Redis (Upstash): $20/mo
- Postgres (Supabase): Existing
- **Total: ~$250-450/mo**

---

## Implementation Roadmap

### Phase 1: Data Foundation (Weeks 1-2)

- [ ] Set up ClickHouse Cloud instance
- [ ] Create ClickHouse schema (trades_raw, wallet_metrics_daily)
- [ ] Create Postgres tables (wallet_scores, market_sii)
- [ ] Set up Redis cache (Upstash)
- [ ] Build ETL pipeline to fetch from Goldsky
- [ ] Backfill historical trade data (test with 100 wallets first)

### Phase 2: Metric Calculation (Weeks 3-4)

- [ ] Implement Omega ratio calculation
- [ ] Implement Omega momentum calculation
- [ ] Implement Sharpe ratio, win rate, EV/hour
- [ ] Build configurable formula system
- [ ] Create hourly job to calculate wallet scores
- [ ] Test with sample data, validate accuracy

### Phase 3: Market SII System (Weeks 5-6)

- [ ] Build top-N position query (from Polymarket API)
- [ ] Implement weighted average calculation
- [ ] Build SII signal calculation
- [ ] Create hourly job to calculate market SII
- [ ] Validate power law hypothesis (top 20 = 70%+ liquidity?)

### Phase 4: API & Integration (Weeks 7-8)

- [ ] Build API endpoints (/wallets/score, /markets/sii)
- [ ] Integrate with existing market screener UI
- [ ] Add SII display to market detail pages
- [ ] Build admin dashboard for monitoring

### Phase 5: Node Builder (Weeks 9-10)

- [ ] Design node builder UI for formula creation
- [ ] Implement formula execution engine
- [ ] Add configurable top-N parameter
- [ ] Add signal backtesting capability
- [ ] User-saved signals/strategies

### Phase 6: Optimization & Scale (Weeks 11-12)

- [ ] Performance testing (1000+ markets, 10k wallets)
- [ ] Optimize slow queries
- [ ] Set up monitoring & alerting
- [ ] Load testing
- [ ] Production deployment

---

## Monitoring & Observability

### Key Metrics to Track

**Data Pipeline Health**:
- ETL job success rate (target: >99%)
- Avg sync duration (target: <15 min)
- Trades ingested per hour
- Wallet score calculation time

**Data Quality**:
- % wallets with >10 trades (target: >60%)
- Avg trades per wallet (target: >50)
- Data freshness (target: <2 hours old)

**System Performance**:
- API response times (p50, p95, p99)
- ClickHouse query latency
- Redis cache hit rate (target: >90%)
- Postgres connection pool usage

**Signal Quality** (measure over time):
- SII signal correlation with market outcomes
- Backtest performance of signals
- User engagement with signals

---

## References

- [Omega Ratio (Wikipedia)](https://en.wikipedia.org/wiki/Omega_ratio)
- [Sharpe Ratio](https://www.investopedia.com/terms/s/sharperatio.asp)
- [ClickHouse Documentation](https://clickhouse.com/docs)
- [Goldsky Polymarket Subgraph](https://docs.goldsky.com)
- [Polymarket CLOB API](https://docs.polymarket.com)

---

**Document Status**: Design Phase - Ready for Implementation
**Next Steps**: Review with Austin, validate Omega ratio approach, begin Phase 1
