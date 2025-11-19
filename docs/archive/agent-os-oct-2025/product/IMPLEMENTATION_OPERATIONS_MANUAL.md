# Wallet Intelligence Terminal - Implementation & Operations Manual

**Purpose:** Document how the existing system actually works (technical debt and all) to serve as reference for rebuilding CASCADIAN platform.

**Status:** Phase 2 Complete - Production deployment on Vercel
**Date:** 2025-10-20
**Audience:** Developers building the new CASCADIAN system

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Models & Database Schema](#data-models--database-schema)
3. [Signal Generation Logic](#signal-generation-logic)
4. [Wallet Intelligence Scoring](#wallet-intelligence-scoring)
5. [API Endpoints Reference](#api-endpoints-reference)
6. [Background Jobs (Cron)](#background-jobs-cron)
7. [Configuration & Environment](#configuration--environment)
8. [Deployment Process](#deployment-process)
9. [Known Issues & Troubleshooting](#known-issues--troubleshooting)
10. [Performance Characteristics](#performance-characteristics)

---

## 1. Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vercel Edge CDN                          │
│                    (Global Edge Network)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js 15 Application                      │
│                      (React 19 Frontend)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ /signals-live│  │/whale-tracker│  │  /screener   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (60+ routes)                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  /api/v1/signals/live    (GET)  - Cached 30s          │     │
│  │  /api/v1/wallets/top-performers (GET) - Cached 5m     │     │
│  │  /api/v1/markets/screener (GET) - Cached 1m           │     │
│  │  /api/v1/admin/jobs/* (POST) - No cache               │     │
│  └────────────────────────────────────────────────────────┘     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer (13 services)                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ signal-aggregator│  │   smart-score    │                     │
│  │  (Bayesian)      │  │   (WIS calc)     │                     │
│  └──────────────────┘  └──────────────────┘                     │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ psp-orchestrator │  │ strategy-engine  │                     │
│  │  (4 PSPs)        │  │ (Kelly sizing)   │                     │
│  └──────────────────┘  └──────────────────┘                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL 15                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Core Tables: markets, trades, prices_1m               │     │
│  │  Intelligence: wallet_scores_daily, aggregated_signals │     │
│  │  Trading: paper_trades, strategies                     │     │
│  │  Materialized Views: wallet_scores_mv (8 total)       │     │
│  └────────────────────────────────────────────────────────┘     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Data Source                          │
│              Polymarket Gamma API (gamma-api.polymarket.com)     │
│  - Market data (5 min sync)                                      │
│  - Trade flows (1 min sync)                                      │
│  - Price/order book (1 min sync)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow for Signal Generation

```
1. Cron Trigger (every 15 min)
   ↓
2. /api/v1/admin/jobs/signal-generation (POST)
   ↓
3. For each active market:
   ↓
4. Fetch 4 signal sources in parallel:
   ├─→ PSP Orchestrator (40% weight)
   │   ├─→ DARTS PSP
   │   ├─→ STATS-MOMENTUM PSP
   │   ├─→ RESEARCH PSP
   │   └─→ WHALE PSP
   ├─→ Crowd Wisdom (30% weight)
   │   └─→ Query wallet_scores_mv + trades
   ├─→ Momentum Detector (20% weight)
   │   └─→ Query prices_1m (EMA calculation)
   └─→ Microstructure Analyzer (10% weight)
       └─→ Query prices_1m (order book imbalance)
   ↓
5. Bayesian Signal Aggregator
   ↓
6. Insert into aggregated_signals table
   ↓
7. /api/v1/signals/live reads from aggregated_signals
   ↓
8. Frontend displays in /signals-live dashboard
```

### Key Architectural Decisions (Current Implementation)

**✅ What Works Well:**
- Materialized views for leaderboard performance (<100ms queries)
- In-memory LRU cache for hot API endpoints
- Parallel PSP execution reduces latency
- Cron-based ETL is simple and debuggable

**❌ Technical Debt:**
- No WebSocket support (polling only)
- No real-time signal updates (15 min batch)
- Cron jobs can overlap if slow (no queue system)
- In-memory cache not shared across Vercel instances
- No database connection pooling (relies on Supabase pooler)
- Signal generation is blocking (no async queue)

---

## 2. Data Models & Database Schema

### Core Tables (Detailed Schemas)

#### `markets` Table

```sql
CREATE TABLE markets (
  market_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  description TEXT,
  category TEXT,
  tags TEXT[],

  -- Pricing
  current_price DECIMAL(10,6),
  bid DECIMAL(10,6),
  ask DECIMAL(10,6),
  spread_bps INTEGER,

  -- Volume & Liquidity
  volume_24h DECIMAL(15,2),
  volume_total DECIMAL(15,2),
  liquidity DECIMAL(15,2),

  -- Status
  active BOOLEAN DEFAULT TRUE,
  closed BOOLEAN DEFAULT FALSE,
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  outcomes TEXT[],
  event_slug TEXT,
  market_slug TEXT,
  image_url TEXT,

  -- Computed (updated by jobs)
  momentum_score DECIMAL(5,2),
  smart_money_delta DECIMAL(5,4),
  last_trade_at TIMESTAMPTZ,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markets_active ON markets(active) WHERE active = TRUE;
CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_end_date ON markets(end_date);
CREATE INDEX idx_markets_volume_24h ON markets(volume_24h DESC);
```

**Current Issues:**
- `current_price` sometimes NULL (Polymarket API inconsistency)
- `liquidity` calculation differs from Polymarket UI (we use order book depth, they use something else)
- `momentum_score` not always updated (job can fail silently)

#### `prices_1m` Table (OHLC)

```sql
CREATE TABLE prices_1m (
  market_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,

  -- OHLC
  open DECIMAL(10,6) NOT NULL,
  high DECIMAL(10,6) NOT NULL,
  low DECIMAL(10,6) NOT NULL,
  close DECIMAL(10,6) NOT NULL,

  -- Volume
  volume DECIMAL(15,2) DEFAULT 0,

  -- Order Book Snapshot
  bid DECIMAL(10,6),
  ask DECIMAL(10,6),
  spread_bps INTEGER,

  -- Depth (top 3 levels)
  depth_bid_top3 JSONB,  -- [{price, size}, ...]
  depth_ask_top3 JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (market_id, ts)
);

CREATE INDEX idx_prices_1m_market_ts ON prices_1m(market_id, ts DESC);
```

**Current Issues:**
- Missing data gaps when Polymarket API rate limits
- No backfill mechanism (gaps stay forever)
- JSONB depth columns slow to query (no GIN index)
- Some bars have `open = high = low = close` (no trades in that minute)

#### `trades` Table

```sql
CREATE TABLE trades (
  trade_id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,

  -- Trade Details
  side TEXT NOT NULL,  -- 'YES' or 'NO'
  price DECIMAL(10,6) NOT NULL,
  size DECIMAL(15,6) NOT NULL,

  -- Trader
  trader_address TEXT NOT NULL,

  -- Blockchain
  transaction_hash TEXT,
  block_number BIGINT,

  -- Timing
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  FOREIGN KEY (market_id) REFERENCES markets(market_id)
);

CREATE INDEX idx_trades_market_id ON trades(market_id);
CREATE INDEX idx_trades_trader_address ON trades(trader_address);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_market_timestamp ON trades(market_id, timestamp DESC);
```

**Current Issues:**
- Duplicate trades can slip through if ingest job runs twice
- No unique constraint on `transaction_hash` (should have one)
- `trader_address` not normalized (stored as lowercase hex, but some have checksums)
- Very large table (10M+ rows), queries slow without proper indexes

#### `wallet_scores_daily` Table

```sql
CREATE TABLE wallet_scores_daily (
  wallet_address TEXT NOT NULL,
  date DATE NOT NULL,

  -- Trade Counts
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,

  -- Financial
  total_pnl_usd DECIMAL(15,2) DEFAULT 0,
  total_volume_usd DECIMAL(15,2) DEFAULT 0,

  -- Performance Metrics
  win_rate DECIMAL(5,4),  -- 0.0 to 1.0
  roi_pct DECIMAL(10,4),

  -- Risk Metrics
  sharpe_ratio DECIMAL(10,4),
  sortino_ratio DECIMAL(10,4),
  omega_ratio DECIMAL(10,4),
  max_drawdown_pct DECIMAL(10,4),

  -- Intelligence Score
  smart_score DECIMAL(5,2),  -- WIS: 0-100

  -- Components (for debugging)
  performance_factor DECIMAL(5,4),
  reliability_factor DECIMAL(5,4),
  volume_factor DECIMAL(5,4),
  specialization_factor DECIMAL(5,4),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (wallet_address, date)
);

CREATE INDEX idx_wallet_scores_date ON wallet_scores_daily(date DESC);
CREATE INDEX idx_wallet_scores_smart_score ON wallet_scores_daily(smart_score DESC);
```

**Current Issues:**
- Daily granularity means wallet scores lag by up to 24 hours
- No hourly or real-time scoring
- `sharpe_ratio` calculation uses 30-day rolling window (hardcoded)
- `specialization_factor` only calculated for wallets with 50+ trades (others get 0)

#### `aggregated_signals` Table

```sql
CREATE TABLE aggregated_signals (
  market_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Final Signal
  probability DECIMAL(10,6) NOT NULL,  -- 0.0 to 1.0 (YES probability)
  confidence DECIMAL(10,6) NOT NULL,   -- 0.0 to 1.0
  recommendation TEXT NOT NULL,        -- BUY_YES, BUY_NO, HOLD, SELL
  edge_bp INTEGER,                     -- Basis points edge

  -- Signal Quality
  signal_count INTEGER DEFAULT 0,      -- How many sources available
  agreement_score DECIMAL(5,4),        -- How aligned are signals

  -- Entry/Exit Flags
  entry_recommended BOOLEAN DEFAULT FALSE,
  exit_recommended BOOLEAN DEFAULT FALSE,

  -- Signal Breakdown (weights applied)
  psp_weight DECIMAL(5,4),
  psp_contribution DECIMAL(10,6),
  psp_confidence DECIMAL(5,4),

  crowd_weight DECIMAL(5,4),
  crowd_contribution DECIMAL(10,6),
  crowd_confidence DECIMAL(5,4),

  momentum_weight DECIMAL(5,4),
  momentum_contribution DECIMAL(10,6),
  momentum_confidence DECIMAL(5,4),

  microstructure_weight DECIMAL(5,4),
  microstructure_contribution DECIMAL(10,6),
  microstructure_confidence DECIMAL(5,4),

  -- Raw Signal IDs (for debugging)
  psp_signal_id TEXT,
  crowd_signal_id TEXT,
  momentum_signal_id TEXT,
  microstructure_signal_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (market_id, timestamp)
);

CREATE INDEX idx_aggregated_signals_timestamp ON aggregated_signals(timestamp DESC);
CREATE INDEX idx_aggregated_signals_recommendation ON aggregated_signals(recommendation);
CREATE INDEX idx_aggregated_signals_confidence ON aggregated_signals(confidence DESC);
CREATE INDEX idx_aggregated_signals_entry ON aggregated_signals(entry_recommended) WHERE entry_recommended = TRUE;
```

**Current Issues:**
- No cleanup of old signals (table grows unbounded)
- `edge_bp` calculation assumes market is efficient (often wrong)
- `agreement_score` weighted by confidence, but should it be?
- Signal IDs are UUIDs, making joins slow

#### `paper_trades` Table

```sql
CREATE TABLE paper_trades (
  id BIGSERIAL PRIMARY KEY,
  strategy_id UUID NOT NULL,

  -- Market
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,  -- 'YES' or 'NO'

  -- Entry
  entry_price DECIMAL(10,6) NOT NULL,
  stake_usd DECIMAL(15,2) NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exit
  exit_price DECIMAL(10,6),
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT,  -- 'STOP_LOSS', 'PROFIT_TARGET', 'TIME_BUFFER', 'SIGNAL_EXIT'

  -- P&L
  pnl_usd DECIMAL(15,2),
  pnl_pct DECIMAL(10,4),

  -- Signal Context (at entry)
  signal_confidence DECIMAL(5,4),
  signal_edge_bp INTEGER,
  signal_probability DECIMAL(10,6),

  -- Status
  status TEXT NOT NULL DEFAULT 'open',  -- 'open', 'closed', 'cancelled'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  FOREIGN KEY (strategy_id) REFERENCES strategies(id),
  FOREIGN KEY (market_id) REFERENCES markets(market_id)
);

CREATE INDEX idx_paper_trades_strategy ON paper_trades(strategy_id);
CREATE INDEX idx_paper_trades_status ON paper_trades(status);
CREATE INDEX idx_paper_trades_entry_timestamp ON paper_trades(entry_timestamp DESC);
```

**Current Issues:**
- No position ID (can't track multiple entries for same market)
- `exit_reason` is freeform text (should be enum)
- `pnl_usd` not always calculated correctly (rounding errors)
- No audit trail (can't see position size changes)

#### `strategies` Table

```sql
CREATE TABLE strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,

  -- Strategy Config (JSONB)
  config JSONB NOT NULL,

  -- Status
  active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_strategies_active ON strategies(active) WHERE active = TRUE;
```

**JSONB Config Structure:**
```json
{
  "filters": {
    "categories": ["Crypto", "Sports"],
    "min_liquidity_usd": 5000,
    "max_hours_to_close": 24,
    "min_signal_count": 3
  },
  "entry_conditions": {
    "min_confidence": 0.70,
    "min_edge_bp": 100,
    "max_open_positions": 10
  },
  "position_sizing": {
    "kelly_fraction": 0.25,
    "max_position_usd": 1000,
    "min_position_usd": 100,
    "initial_portfolio_usd": 100000
  },
  "exit_conditions": {
    "profit_target_pct": 0.20,
    "stop_loss_pct": 0.10,
    "trailing_stop_pct": 0.05,
    "time_buffer_hours": 2
  },
  "risk_management": {
    "max_total_exposure_pct": 0.30,
    "max_positions_per_market": 2,
    "max_daily_loss_pct": 0.05
  }
}
```

**Current Issues:**
- No schema validation on JSONB (can insert invalid config)
- Config changes don't version (can't track config history)
- No way to pause/resume strategy (only active/inactive)

### Materialized Views (Performance Layer)

#### `wallet_scores_mv` (Most Critical)

```sql
CREATE MATERIALIZED VIEW wallet_scores_mv AS
SELECT
  wallet_address,
  MAX(date) as latest_date,
  SUM(total_trades) as total_trades,
  SUM(winning_trades) as winning_trades,
  SUM(losing_trades) as losing_trades,
  SUM(total_pnl_usd) as total_pnl_usd,
  SUM(total_volume_usd) as total_volume_usd,
  AVG(win_rate) as avg_win_rate,
  AVG(roi_pct) as avg_roi_pct,
  AVG(sharpe_ratio) as avg_sharpe_ratio,
  AVG(sortino_ratio) as avg_sortino_ratio,
  AVG(omega_ratio) as avg_omega_ratio,
  AVG(max_drawdown_pct) as avg_max_drawdown_pct,
  MAX(smart_score) as smart_score  -- Latest score
FROM wallet_scores_daily
WHERE date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY wallet_address;

CREATE UNIQUE INDEX idx_wallet_scores_mv_address ON wallet_scores_mv(wallet_address);
CREATE INDEX idx_wallet_scores_mv_score ON wallet_scores_mv(smart_score DESC);

-- Refresh every 15 minutes via cron
-- REFRESH MATERIALIZED VIEW CONCURRENTLY wallet_scores_mv;
```

**Current Issues:**
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires `UNIQUE INDEX` (we have it)
- Refresh takes 10-30 seconds for 10k+ wallets (blocks queries)
- Averaging `win_rate` across days is mathematically incorrect (should recalculate)
- 90-day window is arbitrary (should be configurable)

---

## 3. Signal Generation Logic

### Bayesian Signal Aggregator (How It Actually Works)

**File:** `/src/services/signals/signal-aggregator.ts` (614 lines)

#### Step-by-Step Algorithm

```typescript
// STEP 1: Fetch all 4 signal sources in parallel
async function aggregateSignals(marketId: string) {
  const [pspSignal, crowdSignal, momentumSignal, microSignal] = await Promise.all([
    getPSPSignal(marketId),          // 40% weight
    getCrowdWisdomSignal(marketId),  // 30% weight
    getMomentumSignal(marketId),     // 20% weight
    getMicrostructureSignal(marketId) // 10% weight
  ]);

  // STEP 2: Convert each signal to probability (0-1)
  const signals = [
    { prob: pspSignal.probability, conf: pspSignal.confidence, weight: 0.40 },
    { prob: crowdSignal.sm_delta_to_prob(), conf: crowdSignal.confidence, weight: 0.30 },
    { prob: momentumSignal.state_to_prob(), conf: momentumSignal.confidence, weight: 0.20 },
    { prob: microSignal.imbalance_to_prob(), conf: microSignal.confidence, weight: 0.10 }
  ];

  // STEP 3: Adjust weights dynamically if confidence low
  const adjustedWeights = adjustWeights(signals);

  // STEP 4: Weighted average probability
  let weightedProb = 0;
  for (let i = 0; i < signals.length; i++) {
    weightedProb += signals[i].prob * adjustedWeights[i];
  }

  // STEP 5: Calculate confidence as agreement score
  const agreement = calculateAgreement(signals);
  const finalConfidence = agreement * averageConfidence(signals);

  // STEP 6: Generate recommendation
  const recommendation = generateRecommendation(weightedProb, finalConfidence);

  // STEP 7: Calculate edge in basis points
  const marketPrice = await getMarketPrice(marketId);
  const edgeBp = Math.round((weightedProb - marketPrice) * 10000);

  return {
    probability: weightedProb,
    confidence: finalConfidence,
    recommendation,
    edge_bp: edgeBp,
    signal_count: signals.length,
    agreement_score: agreement,
    // ... breakdown
  };
}
```

#### Dynamic Weight Adjustment (Current Implementation)

```typescript
function adjustWeights(signals: Signal[]): number[] {
  // If PSP confidence < 0.5, reduce PSP weight and redistribute
  const pspConf = signals[0].conf;

  if (pspConf < 0.5) {
    const reduction = (0.5 - pspConf) * 0.4;  // Max 40% reduction
    return [
      0.40 - reduction,           // PSP gets less
      0.30 + reduction * 0.5,     // Crowd gets half
      0.20 + reduction * 0.3,     // Momentum gets 30%
      0.10 + reduction * 0.2      // Micro gets 20%
    ];
  }

  // Otherwise use base weights
  return [0.40, 0.30, 0.20, 0.10];
}
```

**Current Issues:**
- Weight adjustment only considers PSP confidence (ignores others)
- No learning/optimization of weights over time
- Hardcoded thresholds (0.5) not validated empirically

#### Agreement Score Calculation

```typescript
function calculateAgreement(signals: Signal[]): number {
  const probs = signals.map(s => s.prob);
  const mean = probs.reduce((a, b) => a + b) / probs.length;

  // Calculate standard deviation
  const variance = probs.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / probs.length;
  const stdDev = Math.sqrt(variance);

  // Lower stdDev = higher agreement
  // Scale to 0-1 (assuming stdDev rarely > 0.3)
  const agreement = Math.max(0, 1 - (stdDev / 0.3));

  return agreement;
}
```

**Current Issues:**
- Assumes standard deviation rarely exceeds 0.3 (not always true)
- No confidence weighting in agreement (all signals equal)
- Could use better statistical measure (correlation, etc.)

#### Recommendation Logic

```typescript
function generateRecommendation(prob: number, conf: number): string {
  const edge = Math.abs(prob - 0.5);

  if (conf < 0.6) return 'HOLD';  // Low confidence

  if (edge < 0.1) return 'HOLD';  // No edge

  if (prob > 0.6) return 'BUY_YES';
  if (prob < 0.4) return 'BUY_NO';

  return 'HOLD';
}
```

**Current Issues:**
- Hardcoded thresholds (0.6 confidence, 0.1 edge)
- No 'SELL' recommendations (only BUY/HOLD)
- Doesn't consider current position (always absolute)

### PSP Orchestrator (Ensemble Coordination)

**File:** `/src/services/psp/orchestrator.ts` (394 lines)

```typescript
async function runPSPEnsemble(marketInput: PSPMarketInput): Promise<EnsembleOutput> {
  const psps = [
    new DartsPSP(),
    new StatsMomentumPSP(),
    new ResearchPSP(),
    new WhalePSP()
  ];

  // Run all PSPs in parallel with timeout
  const results = await Promise.allSettled(
    psps.map(psp =>
      Promise.race([
        psp.analyze(marketInput),
        timeout(5000)  // 5 sec timeout per PSP
      ])
    )
  );

  // Collect votes
  const votes = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  // Weighted voting
  let yesVotes = 0;
  let noVotes = 0;
  let totalWeight = 0;

  votes.forEach(vote => {
    if (vote.vote === 'YES') {
      yesVotes += vote.confidence;
    } else if (vote.vote === 'NO') {
      noVotes += vote.confidence;
    }
    totalWeight += vote.confidence;
  });

  const yesProbability = yesVotes / (yesVotes + noVotes);
  const ensembleConfidence = totalWeight / (psps.length * 1.0);  // Normalize

  return {
    probability: yesProbability,
    confidence: ensembleConfidence,
    votes: votes.length,
    failed: psps.length - votes.length
  };
}
```

**Current Issues:**
- If >2 PSPs fail, ensemble confidence artificially low
- No fallback to cached PSP results
- 5-second timeout too aggressive for complex PSPs
- Vote weighting doesn't account for PSP historical accuracy

---

## 4. Wallet Intelligence Scoring

### WIS Calculation (Actual Implementation)

**File:** `/src/services/wallet-etl/smart-score.ts` (369 lines)

```typescript
function calculateWIS(walletData: WalletPerformance): number {
  // Component 1: Performance (40%)
  const performanceFactor = calculatePerformance(walletData);

  // Component 2: Reliability (30%)
  const reliabilityFactor = calculateReliability(walletData);

  // Component 3: Volume (20%)
  const volumeFactor = calculateVolume(walletData);

  // Component 4: Specialization (10%)
  const specializationFactor = calculateSpecialization(walletData);

  // Weighted sum
  const wis =
    performanceFactor * 0.40 +
    reliabilityFactor * 0.30 +
    volumeFactor * 0.20 +
    specializationFactor * 0.10;

  // Scale to 0-100
  return Math.min(100, Math.max(0, wis * 100));
}
```

#### Performance Factor (40% weight)

```typescript
function calculatePerformance(wallet: WalletPerformance): number {
  const roiScore = normalizeROI(wallet.roi_pct);        // 0-1
  const winRateScore = wallet.win_rate;                 // Already 0-1
  const sharpeScore = normalizeSharpe(wallet.sharpe);   // 0-1
  const sortinoScore = normalizeSortino(wallet.sortino);// 0-1
  const omegaScore = normalizeOmega(wallet.omega);      // 0-1

  // Weighted average
  return (
    roiScore * 0.30 +
    winRateScore * 0.25 +
    sharpeScore * 0.20 +
    sortinoScore * 0.15 +
    omegaScore * 0.10
  );
}

// Normalization functions (CRITICAL IMPLEMENTATION DETAILS)
function normalizeROI(roi: number): number {
  // Assumes ROI ranges from -100% to +500%
  // Maps to 0-1 scale
  if (roi <= -100) return 0;
  if (roi >= 500) return 1;
  return (roi + 100) / 600;
}

function normalizeSharpe(sharpe: number): number {
  // Assumes Sharpe ranges from -2 to +4
  if (sharpe <= -2) return 0;
  if (sharpe >= 4) return 1;
  return (sharpe + 2) / 6;
}

function normalizeSortino(sortino: number): number {
  // Assumes Sortino ranges from -2 to +5
  if (sortino <= -2) return 0;
  if (sortino >= 5) return 1;
  return (sortino + 2) / 7;
}

function normalizeOmega(omega: number): number {
  // Assumes Omega ranges from 0 to 3
  if (omega <= 0) return 0;
  if (omega >= 3) return 1;
  return omega / 3;
}
```

**CRITICAL ISSUES:**
- Normalization ranges are **arbitrary and not validated** on real data
- Wallets with ROI > 500% get capped at 1.0 (loses signal)
- Negative Sharpe/Sortino get clamped to 0 (should they?)

#### Reliability Factor (30% weight)

```typescript
function calculateReliability(wallet: WalletPerformance): number {
  const consistencyScore = calculateConsistency(wallet);  // 0-1
  const volatilityScore = 1 - normalizeVolatility(wallet.returns_std);  // Inverse
  const drawdownScore = 1 - normalizeDrawdown(wallet.max_drawdown_pct);  // Inverse

  return (
    consistencyScore * 0.40 +
    volatilityScore * 0.30 +
    drawdownScore * 0.30
  );
}

function calculateConsistency(wallet: WalletPerformance): number {
  // Measure: What % of days were profitable?
  const profitableDays = wallet.profitable_days || 0;
  const totalDays = wallet.active_days || 1;
  return profitableDays / totalDays;
}

function normalizeVolatility(std: number): number {
  // Assumes std ranges from 0 to 50%
  if (std >= 50) return 1;
  return std / 50;
}

function normalizeDrawdown(dd: number): number {
  // Assumes max drawdown ranges from 0 to 80%
  if (dd >= 80) return 1;
  return dd / 80;
}
```

**Current Issues:**
- `profitable_days` and `active_days` not always populated (can be NULL)
- Volatility normalization assumes 50% is max (crypto can exceed)
- Drawdown assumes 80% max (wallets can blow up 100%)

#### Volume Factor (20% weight)

```typescript
function calculateVolume(wallet: WalletPerformance): number {
  const volumeScore = normalizeVolume(wallet.total_volume_usd);  // 0-1
  const tradeCountScore = normalizeTradeCount(wallet.total_trades);  // 0-1
  const activityScore = normalizeActivity(wallet.active_days);  // 0-1

  return (
    volumeScore * 0.50 +
    tradeCountScore * 0.30 +
    activityScore * 0.20
  );
}

function normalizeVolume(volume: number): number {
  // Log scale: $100 to $1M
  if (volume < 100) return 0;
  if (volume > 1000000) return 1;
  return Math.log10(volume / 100) / Math.log10(10000);
}

function normalizeTradeCount(trades: number): number {
  // Linear scale: 10 to 1000 trades
  if (trades < 10) return 0;
  if (trades > 1000) return 1;
  return (trades - 10) / 990;
}

function normalizeActivity(days: number): number {
  // Linear scale: 7 to 90 days
  if (days < 7) return 0;
  if (days > 90) return 1;
  return (days - 7) / 83;
}
```

**Current Issues:**
- Log scale for volume biases towards small increases at low volumes
- Trade count normalization favors high-frequency traders
- Activity capped at 90 days (longer activity gets no bonus)

#### Specialization Factor (10% weight)

```typescript
function calculateSpecialization(wallet: WalletPerformance): number {
  // Only calculated if wallet has category performance data
  if (!wallet.category_performance || wallet.total_trades < 50) {
    return 0;  // No specialization bonus
  }

  const categories = Object.keys(wallet.category_performance);

  // Find best category
  let bestCategoryROI = -Infinity;
  let bestCategoryTrades = 0;

  categories.forEach(cat => {
    const perf = wallet.category_performance[cat];
    if (perf.roi_pct > bestCategoryROI && perf.trades >= 20) {
      bestCategoryROI = perf.roi_pct;
      bestCategoryTrades = perf.trades;
    }
  });

  if (bestCategoryROI === -Infinity) return 0;

  // Specialization score based on:
  // 1. How much better is best category vs overall?
  const outperformance = bestCategoryROI - wallet.roi_pct;

  // 2. How focused is the wallet? (% of trades in best category)
  const focus = bestCategoryTrades / wallet.total_trades;

  const specializationScore = (
    normalizeOutperformance(outperformance) * 0.60 +
    focus * 0.40
  );

  return specializationScore;
}

function normalizeOutperformance(diff: number): number {
  // Assumes outperformance ranges from 0 to 100%
  if (diff <= 0) return 0;
  if (diff >= 100) return 1;
  return diff / 100;
}
```

**Current Issues:**
- Requires 50+ total trades (arbitrary threshold)
- Requires 20+ trades in category (arbitrary threshold)
- Doesn't account for category difficulty (beating in Crypto vs. Sports)
- Can be 0 for many wallets (making 10% weight wasted)

### Final WIS Score Distribution (Observed)

From production data:
- **P50 (median):** 42
- **P75:** 58
- **P90:** 72
- **P99:** 89
- **Max:** 97 (never seen 100)

**Interpretation:**
- Most wallets cluster in 30-60 range
- Getting above 80 is rare (top 5%)
- Score is not uniformly distributed (skewed low)

---

## 5. API Endpoints Reference

### Public Endpoints (No Auth)

#### `GET /api/v1/signals/live`

**Purpose:** Get latest trading signals with Bayesian fusion

**Cache:** 30 seconds (in-memory LRU)

**Query Params:**
- `limit` (optional): Max signals to return (default: 50)
- `market_id` (optional): Filter by market

**Response:**
```json
{
  "signals": [
    {
      "market_id": "0x123...",
      "question": "Will Bitcoin reach $100k by Dec 2025?",
      "timestamp": "2025-10-20T12:34:56Z",
      "probability": 0.72,
      "confidence": 0.85,
      "recommendation": "BUY_YES",
      "edge_bp": 150,
      "signal_count": 4,
      "agreement_score": 0.89,
      "psp_weight": 0.40,
      "psp_contribution": 0.68,
      "crowd_weight": 0.30,
      "crowd_contribution": 0.75,
      "momentum_weight": 0.20,
      "momentum_contribution": 0.65,
      "microstructure_weight": 0.10,
      "microstructure_contribution": 0.70
    }
  ],
  "count": 50,
  "cached": true,
  "cache_age_sec": 15
}
```

**Current Issues:**
- No pagination (always returns last 50)
- Cache key doesn't include query params (cached result ignores filters)
- Timestamp is when signal was generated (not when fetched)

#### `GET /api/v1/wallets/top-performers`

**Purpose:** Leaderboard of top wallets by WIS

**Cache:** 5 minutes

**Query Params:**
- `limit` (optional): Max wallets (default: 50)
- `min_score` (optional): Filter by min WIS (default: 0)
- `sort` (optional): 'wis', 'win_rate', 'volume' (default: 'wis')

**Response:**
```json
{
  "wallets": [
    {
      "wallet_address": "0xabc...",
      "smart_score": 87.5,
      "total_trades": 234,
      "win_rate": 0.68,
      "roi_pct": 145.2,
      "total_pnl_usd": 12450.00,
      "total_volume_usd": 89000.00,
      "sharpe_ratio": 2.34,
      "sortino_ratio": 3.12,
      "omega_ratio": 1.89,
      "max_drawdown_pct": 15.6,
      "category_specialties": ["Crypto", "Sports"]
    }
  ],
  "count": 50,
  "cached": true
}
```

**Current Issues:**
- Always queries materialized view (can be stale up to 15 min)
- Sorting by `win_rate` or `volume` still returns top 50 by WIS first
- `category_specialties` array can be empty (not all wallets have it)

#### `GET /api/v1/markets/screener`

**Purpose:** All markets for table display

**Cache:** 1 minute

**Query Params:**
- `active` (optional): Filter by active status (default: true)
- `min_liquidity` (optional): Min liquidity USD
- `category` (optional): Filter by category

**Response:**
```json
{
  "markets": [
    {
      "market_id": "0x123...",
      "question": "Will Bitcoin reach $100k?",
      "category": "Crypto",
      "current_price": 0.65,
      "bid": 0.64,
      "ask": 0.66,
      "spread_bps": 200,
      "volume_24h": 125000.00,
      "liquidity": 85000.00,
      "end_date": "2025-12-31T23:59:59Z",
      "hours_to_close": 720,
      "smart_money_delta": 0.12,
      "momentum_score": 0.68,
      "latest_signal": {
        "probability": 0.70,
        "confidence": 0.82,
        "recommendation": "BUY_YES"
      }
    }
  ],
  "count": 1234,
  "cached": true
}
```

**Current Issues:**
- Returns ALL markets (1000+) with no server-side pagination
- `latest_signal` requires LEFT JOIN (slow query, often times out)
- `hours_to_close` calculated on every request (should be pre-computed)

### Admin Endpoints (POST)

#### `POST /api/v1/admin/jobs/signal-generation`

**Purpose:** Trigger Bayesian signal fusion for all active markets

**Auth:** Vercel Cron secret or admin API key

**Request Body:** None

**Process:**
1. Fetch all active markets (WHERE active = TRUE AND closed = FALSE)
2. For each market (parallel, batch of 10):
   - Fetch 4 signal sources
   - Run Bayesian aggregation
   - Insert into `aggregated_signals` table
3. Return summary

**Response:**
```json
{
  "success": true,
  "markets_processed": 234,
  "signals_generated": 234,
  "errors": 0,
  "duration_ms": 12500
}
```

**Current Issues:**
- Batch size of 10 can overwhelm Supabase connection pool
- No retry on individual market failures (all-or-nothing)
- If job takes >60 sec, Vercel timeout kills it
- No checkpoint/resume (if fails at market 200, restarts from 0)

#### `POST /api/v1/admin/jobs/compute-wallet-scores`

**Purpose:** Calculate WIS for all wallets with recent activity

**Auth:** Vercel Cron secret

**Request Body:** None

**Process:**
1. Fetch all wallets with trades in last 90 days
2. For each wallet:
   - Calculate 4 factors (performance, reliability, volume, specialization)
   - Compute WIS (0-100)
   - Upsert into `wallet_scores_daily`
3. Refresh `wallet_scores_mv` materialized view

**Response:**
```json
{
  "success": true,
  "wallets_scored": 1234,
  "mv_refresh_ms": 15000,
  "duration_ms": 45000
}
```

**Current Issues:**
- Full table scan of `trades` (slow, no index on wallet + timestamp)
- Materialized view refresh blocks reads (uses `REFRESH MATERIALIZED VIEW` not `CONCURRENTLY`)
- No incremental updates (recalculates everything every time)

---

## 6. Background Jobs (Cron)

### Cron Schedule (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-markets",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/ingest-trades",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/collect-prices",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/compute-wallet-scores",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/compute-sii",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/wallet-trades-sync",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/v1/admin/jobs/wallet-score-update",
      "schedule": "0 */4 * * *"
    },
    {
      "path": "/api/v1/admin/jobs/crowd-wisdom-sync",
      "schedule": "0 */2 * * *"
    },
    {
      "path": "/api/v1/admin/jobs/signal-generation",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

### Job Details

#### 1. `sync-markets` (Every 5 minutes)

**File:** `/src/app/api/cron/sync-markets/route.ts`

**What it does:**
1. Fetch markets from Polymarket Gamma API
2. Upsert into `markets` table
3. Update: price, bid, ask, volume_24h, liquidity, end_date, active status

**Current Implementation:**
```typescript
// Fetch from Polymarket
const markets = await polymarketClient.getMarkets({ active: true });

// Batch upsert (500 at a time)
for (const batch of chunk(markets, 500)) {
  await supabase
    .from('markets')
    .upsert(batch, { onConflict: 'market_id' });
}
```

**Issues:**
- No error handling for individual markets (batch fails if one market invalid)
- Polymarket API sometimes returns duplicate markets (causes upsert conflicts)
- `volume_24h` from API doesn't always match our calculated volume

#### 2. `ingest-trades` (Every 1 minute)

**File:** `/src/app/api/v1/admin/jobs/ingest-trades/route.ts`

**What it does:**
1. Fetch trades from last 1 minute from Polymarket
2. Insert into `trades` table
3. Update `last_trade_at` timestamp on markets

**Current Implementation:**
```typescript
const since = Date.now() - 60000;  // Last 1 minute
const trades = await polymarketClient.getTrades({ since });

// Insert trades
await supabase
  .from('trades')
  .insert(trades)
  .onConflict('trade_id')
  .ignore();  // Ignore duplicates
```

**Issues:**
- If job misses a run (Vercel downtime), gap in trade data forever
- No backfill mechanism
- Polymarket API rate limit can cause job to fail silently

#### 3. `collect-prices` (Every 1 minute)

**File:** `/src/app/api/v1/admin/jobs/collect-prices/route.ts`

**What it does:**
1. For each active market, fetch current price + order book
2. Aggregate into 1-minute OHLC bar
3. Insert into `prices_1m` table

**Current Implementation:**
```typescript
const markets = await getActiveMarkets();

for (const market of markets) {
  const orderBook = await polymarketClient.getOrderBook(market.market_id);

  const ohlc = {
    market_id: market.market_id,
    ts: roundToMinute(Date.now()),
    open: market.current_price,  // Assuming no change in minute
    high: market.current_price,
    low: market.current_price,
    close: market.current_price,
    volume: 0,  // Updated later from trades
    bid: orderBook.bestBid,
    ask: orderBook.bestAsk,
    spread_bps: calculateSpread(orderBook),
    depth_bid_top3: orderBook.bids.slice(0, 3),
    depth_ask_top3: orderBook.asks.slice(0, 3)
  };

  await supabase.from('prices_1m').insert(ohlc);
}
```

**Issues:**
- Loops through markets sequentially (slow, often times out)
- `open = high = low = close` is incorrect (should aggregate trades)
- `volume` always 0 (separate job updates it later)
- Order book depth is snapshot (not aggregated over minute)

#### 4. `compute-wallet-scores` (Every 15 minutes)

**Covered in Section 4 (Wallet Intelligence Scoring)**

#### 5. `signal-generation` (Every 15 minutes)

**Covered in Section 3 (Signal Generation Logic)**

---

## 7. Configuration & Environment

### Environment Variables (.env.local)

**Required:**
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # For admin operations

# Database (direct connection, optional)
DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres

# Polymarket API (optional, defaults to public endpoint)
POLYMARKET_API_URL=https://gamma-api.polymarket.com

# Vercel Cron Secret (production only)
CRON_SECRET=xxxxx
```

**Optional:**
```bash
# Development proxy (if behind firewall)
ALL_PROXY=http://localhost:8888

# Feature flags
ENABLE_WEBSOCKET=false  # Not implemented yet
ENABLE_LIVE_TRADING=false  # Phase 3

# Performance tuning
CACHE_TTL_SIGNALS=30  # Seconds
CACHE_TTL_WALLETS=300  # Seconds
MAX_PARALLEL_MARKETS=10  # For signal generation
```

### Configuration Files

#### `next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },

  // Allow images from Polymarket CDN
  images: {
    domains: ['polymarket-upload.s3.us-east-2.amazonaws.com']
  },

  // Ignore ESLint during builds (technical debt)
  eslint: {
    ignoreDuringBuilds: true
  },

  // Ignore TypeScript errors during builds (technical debt)
  typescript: {
    ignoreBuildErrors: true
  }
};

module.exports = nextConfig;
```

**CRITICAL ISSUE:** TypeScript and ESLint errors ignored in production builds!

#### `tailwind.config.js`

```javascript
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        // HashDive custom colors
        'hd-bg': '#0a0e1a',
        'hd-surface': '#141829',
        'hd-accent': '#3b82f6',
        'hd-success': '#10b981',
        'hd-danger': '#ef4444'
      }
    }
  },
  plugins: [
    require('tailwindcss-animate')
  ]
};
```

---

## 8. Deployment Process

### Current Deployment (Vercel)

#### Production Branch: `main`

**Trigger:** Git push to `main` branch

**Build Process:**
1. Vercel detects push
2. Runs `pnpm build`
3. Ignores TypeScript errors (see next.config.js)
4. Ignores ESLint errors
5. Builds Next.js app
6. Deploys to Vercel Edge

**Build Time:** ~3-5 minutes

**Current Issues:**
- No pre-deployment tests (deploys even if tests fail)
- No smoke tests after deployment
- Cron jobs start immediately (can cause issues if DB migration pending)

#### Environment Variables (Vercel Dashboard)

Must set in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `CRON_SECRET`

#### Cron Jobs

Automatically configured from `vercel.json`. No manual setup needed.

**Monitoring:** Vercel dashboard shows cron run history (last 100 runs)

### Local Development

```bash
# 1. Clone repo
git clone https://github.com/user/twilly.git
cd twilly

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with Supabase credentials

# 4. Run migrations
npx supabase db push

# 5. Start dev server
pnpm dev

# 6. Visit http://localhost:3000
```

**Common Issues:**
- Port 3000 already in use → Kill other process or change port
- Supabase connection fails → Check firewall/VPN
- Missing environment variables → Copy from Vercel dashboard

### Database Migrations

**Location:** `/supabase/migrations/*.sql`

**Apply Migration (Local):**
```bash
npx supabase db push
```

**Apply Migration (Production):**
Option 1: Supabase Dashboard (SQL Editor)
Option 2: Direct `psql`:
```bash
psql $DATABASE_URL < supabase/migrations/20251019_phase_0_data_foundation.sql
```

**Current Issues:**
- No migration versioning (can't rollback)
- No down migrations (only up)
- Manual tracking of which migrations applied to production

---

## 9. Known Issues & Troubleshooting

### Critical Issues

#### Issue 1: Cron Jobs Can Overlap

**Symptom:** `signal-generation` job runs every 15 min, but sometimes takes 20 min. Next run starts before previous finishes.

**Root Cause:** Vercel cron triggers are independent of job duration.

**Impact:** Database connection pool exhausted, jobs fail with timeout.

**Workaround:** Add mutex check at start of job:
```typescript
const lock = await acquireLock('signal-generation');
if (!lock) {
  return { skipped: true, reason: 'Previous job still running' };
}
```

**Not Implemented:** Need distributed lock (Redis/Supabase)

#### Issue 2: Materialized View Refresh Blocks Queries

**Symptom:** `/api/v1/wallets/top-performers` returns 504 timeout every 15 min.

**Root Cause:** `REFRESH MATERIALIZED VIEW wallet_scores_mv` holds exclusive lock.

**Impact:** Leaderboard unavailable during refresh (15-30 sec).

**Fix:** Use `REFRESH MATERIALIZED VIEW CONCURRENTLY`:
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY wallet_scores_mv;
```

**Status:** Partially fixed (requires UNIQUE INDEX, which we have, but sometimes still locks)

#### Issue 3: Polymarket API Rate Limits

**Symptom:** Trade ingestion job fails with 429 Too Many Requests.

**Root Cause:** Polymarket API rate limit is ~60 req/min. Job makes 100+ requests.

**Impact:** Missing trade data (gaps in historical data).

**Workaround:** Batch requests, add exponential backoff:
```typescript
await retryWithBackoff(() => polymarketClient.getTrades(), {
  maxRetries: 3,
  baseDelay: 1000
});
```

**Status:** Partially implemented (not all API calls use retry)

### Performance Issues

#### Issue 4: Slow Queries on `trades` Table

**Symptom:** Queries filtering by `trader_address` take 10+ seconds.

**Root Cause:** Missing composite index on `(trader_address, timestamp)`.

**Fix:**
```sql
CREATE INDEX idx_trades_trader_timestamp
ON trades(trader_address, timestamp DESC);
```

**Status:** ✅ Fixed in production

#### Issue 5: Signal Generation Times Out on Vercel

**Symptom:** `signal-generation` job fails with 504 after 60 seconds.

**Root Cause:** Processing 1000+ markets takes >60 sec (Vercel limit).

**Workaround:** Process markets in batches:
```typescript
const batches = chunk(markets, 100);
for (const batch of batches) {
  await processSignals(batch);
}
```

**Status:** ✅ Implemented

### Data Quality Issues

#### Issue 6: Wallet Scores Sometimes NULL

**Symptom:** Leaderboard shows wallets with `smart_score = NULL`.

**Root Cause:** WIS calculation fails if wallet has <10 trades.

**Fix:** Filter out low-trade wallets:
```sql
WHERE total_trades >= 10
```

**Status:** ✅ Fixed in query, not in view

#### Issue 7: Duplicate Signals in Database

**Symptom:** Same market has multiple signals at same timestamp.

**Root Cause:** Signal generation job doesn't check for existing signal before insert.

**Fix:** Use upsert:
```typescript
await supabase
  .from('aggregated_signals')
  .upsert(signal, { onConflict: 'market_id,timestamp' });
```

**Status:** ❌ Not fixed (requires composite primary key)

### Frontend Issues

#### Issue 8: Signals Dashboard Flickers on Refresh

**Symptom:** Signal cards disappear and reappear when auto-refresh triggers.

**Root Cause:** React Query invalidates cache before refetch completes.

**Fix:** Use `keepPreviousData: true`:
```typescript
useQuery({
  queryKey: ['signals'],
  queryFn: fetchSignals,
  refetchInterval: 10000,
  keepPreviousData: true
});
```

**Status:** ❌ Not implemented

#### Issue 9: Market Screener Scrolling Laggy

**Symptom:** AG Grid scrolling stutters with 1000+ rows.

**Root Cause:** Re-rendering entire grid on every state change.

**Fix:** Use row virtualization (already enabled) and optimize cell renderers.

**Status:** Partially fixed (still laggy on low-end devices)

### Troubleshooting Guide

#### Problem: Signals not updating

**Check:**
1. Is `signal-generation` cron job running? (Vercel dashboard)
2. Check job logs for errors
3. Verify `aggregated_signals` table has recent rows:
   ```sql
   SELECT MAX(timestamp) FROM aggregated_signals;
   ```
4. Check API cache age:
   ```bash
   curl http://localhost:3000/api/v1/admin/cache/stats
   ```

**Fix:**
- Manually trigger job: `curl -X POST http://localhost:3000/api/v1/admin/jobs/signal-generation`
- Clear cache: `curl -X POST http://localhost:3000/api/v1/admin/cache/clear`

#### Problem: Wallet scores stuck

**Check:**
1. Is `wallet_scores_mv` materialized view stale?
   ```sql
   SELECT MAX(latest_date) FROM wallet_scores_mv;
   ```
2. Check wallet scoring job logs

**Fix:**
- Manually refresh view:
  ```sql
  REFRESH MATERIALIZED VIEW CONCURRENTLY wallet_scores_mv;
  ```
- Manually trigger job:
  ```bash
  curl -X POST http://localhost:3000/api/v1/admin/jobs/compute-wallet-scores
  ```

#### Problem: Missing trade data

**Check:**
1. Check `trades` table for gaps:
   ```sql
   SELECT DATE(timestamp), COUNT(*)
   FROM trades
   GROUP BY DATE(timestamp)
   ORDER BY DATE(timestamp) DESC;
   ```
2. Check Polymarket API status

**Fix:**
- Backfill missing trades (manual script needed)
- Check Polymarket API rate limit status

---

## 10. Performance Characteristics

### API Response Times (P50/P95)

| Endpoint | P50 | P95 | Notes |
|----------|-----|-----|-------|
| `/api/v1/signals/live` | 45ms | 120ms | Cached 30s |
| `/api/v1/wallets/top-performers` | 80ms | 250ms | Cached 5m |
| `/api/v1/markets/screener` | 150ms | 800ms | No cache, slow query |
| `/api/v1/markets/[id]` | 200ms | 1200ms | Joins 4 tables |
| `/api/v1/paper-trades` | 100ms | 350ms | Indexed well |

### Database Query Performance

**Slow Queries (>1 second):**
```sql
-- Market screener with signals (3-5 seconds)
SELECT m.*, s.probability, s.confidence
FROM markets m
LEFT JOIN LATERAL (
  SELECT * FROM aggregated_signals
  WHERE market_id = m.market_id
  ORDER BY timestamp DESC
  LIMIT 1
) s ON TRUE
WHERE m.active = TRUE;

-- Wallet trades aggregation (2-4 seconds)
SELECT
  trader_address,
  COUNT(*) as trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins
FROM trades
WHERE timestamp >= NOW() - INTERVAL '90 days'
GROUP BY trader_address;
```

**Optimized Queries:**
```sql
-- Use materialized view instead
SELECT * FROM wallet_scores_mv ORDER BY smart_score DESC LIMIT 50;
-- 50ms vs 4 seconds
```

### Memory Usage

**Vercel Function Memory:**
- Default: 1024 MB
- Peak: ~850 MB during signal generation
- Average: ~200 MB

**In-Memory Cache:**
- Max size: 100 MB
- Current size: ~15 MB
- Hit rate: ~65%

### Database Connections

**Supabase Pooler:**
- Max connections: 50 (pooler limit)
- Active connections: 5-15 (average)
- Peak connections: 35 (during cron job overlaps)

**Connection Leaks:**
- Yes, connection pool exhaustion happens ~1x per week
- Requires Supabase restart
- Root cause: Long-running queries not closed properly

---

## Summary: What to Preserve vs. Rebuild for CASCADIAN

### ✅ Preserve & Export

**UI Layer (Low Complexity):**
- All shadcn/ui components (`/src/components/ui/`)
- Trading UI components (`/src/components/trading/`)
- Chart components (`/src/components/markets/`)
- Design system (`/src/lib/design-tokens.ts`)
- AG Grid screener configuration

**Utilities (Universal):**
- Kelly Criterion calculations (`/src/lib/trading-utils.ts`)
- Cache middleware (`/src/lib/cache-middleware.ts`)
- HTTP client with retry (`/src/lib/fetch.ts`)
- Time utilities (`/src/lib/time-utils.ts`)

**Architecture Patterns:**
- Materialized views for performance
- In-memory LRU caching strategy
- Parallel signal source execution
- Bayesian fusion framework (math, not weights)

### ⚠️ Adapt for CASCADIAN

**Algorithms (Needs Recalibration):**
- Momentum detection (EMA crossover)
- Microstructure analysis (order book imbalance)
- Kelly Criterion position sizing
- Agreement score calculation

**Type Definitions:**
- Strategy configuration types
- Signal interface types
- Remove Polymarket-specific fields

### ❌ Rebuild from Scratch

**Data Layer:**
- All database tables (different schema)
- All materialized views (different queries)
- All migrations

**API Layer:**
- All data ingestion jobs (Polymarket → CASCADIAN API)
- All cron jobs
- All API endpoints (60+)

**Intelligence Layer:**
- Wallet Intelligence Score (WIS) algorithm
- PSP Orchestrator and all 4 PSPs
- Crowd Wisdom aggregation
- Specialist detection
- Bayesian signal weights

**Signal Sources:**
- PSP implementations (all 4)
- Crowd wisdom calculation
- Smart money delta

---

## Final Notes for CASCADIAN Team

**This document captures the ACTUAL implementation, warts and all.**

**Key Learnings:**
1. Don't ignore TypeScript errors in production builds
2. Use `REFRESH MATERIALIZED VIEW CONCURRENTLY`
3. Implement distributed locks for cron jobs
4. Add retry logic to ALL external API calls
5. Validate JSONB schema on insert
6. Use composite indexes for multi-column queries
7. Don't hardcode normalization ranges (validate empirically)
8. Implement proper pagination (don't return 1000+ rows)
9. Add connection pooling safeguards
10. Build WebSocket support from day 1 (don't rely on polling)

**Use this manual as:**
- ❌ **NOT** a blueprint to copy
- ✅ A "what not to do" guide
- ✅ A logic reference for re-implementation
- ✅ A feature checklist for parity

**Good luck building CASCADIAN better than we built this! 🚀**
