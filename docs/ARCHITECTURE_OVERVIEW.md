# CASCADIAN Architecture Overview

**Version:** 2.0
**Last Updated:** 2025-10-24

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Systems](#core-systems)
3. [Technology Stack](#technology-stack)
4. [Data Flow](#data-flow)
5. [Key Features](#key-features)
6. [Documentation Index](#documentation-index)
7. [Development Roadmap](#development-roadmap)

---

## System Overview

CASCADIAN is a prediction market analytics platform that identifies "smart money" and generates trading signals based on wallet performance analysis. The platform analyzes trader behavior on Polymarket to help users identify high-quality trading opportunities.

### Core Value Proposition

**Traditional Prediction Markets:**
- Show only price and volume
- Don't distinguish skilled traders from noise
- No insight into participant quality

**CASCADIAN:**
- **Tracks wallet performance** using sophisticated metrics (Omega ratio, Sharpe, win rate)
- **Identifies smart money** via historical trade analysis
- **Generates signals** when smart money concentrates on one side of a market
- **Enables copy trading** by following top performers
- **Flexible signal creation** via visual node builder

---

## Core Systems

### 1. Wallet Smart Score System

**Purpose**: Calculate 0-100 performance scores for active traders

**Location**: `/supabase/docs/wallet-analytics-architecture.md`

**Key Components:**
- **Omega Ratio**: Probability-weighted gains vs losses
- **Omega Momentum**: Is their edge improving?
- **Sharpe Ratio**: Risk-adjusted returns
- **Win Rate**: % profitable trades
- **EV/Hour**: Fast compounding metric

**Data Requirements:**
- Historical trade data (from blockchain via Goldsky)
- Stored in ClickHouse for analytical queries
- Updated hourly

**Example:**
```
Wallet 0xabc...
├─ Smart Score: 85.3 (Grade A)
├─ Omega Ratio (30d): 2.15
├─ Omega Momentum: +18%
├─ Win Rate: 72%
└─ Total Trades: 147
```

### 2. Market SII (Signal Intelligence Index)

**Purpose**: Measure quality and directional bias of participants in a specific market

**Location**: `/lib/SMART_MONEY_FLOW.md`

**Key Concepts:**
- **SII Signal** (-100 to +100): Yes avg score - No avg score
- **SII Confidence** (0-100%): % liquidity from top wallets
- **Power Law**: Top 20-100 wallets = 60-80% of liquidity

**Calculation:**
```typescript
1. Get top N positions on YES side
2. Get top N positions on NO side
3. Lookup smart scores for those wallets
4. Calculate weighted averages
5. SII Signal = yes_avg - no_avg
6. SII Confidence = (top_N_liquidity / total) × 100
```

**Example:**
```
Market: "Bitcoin $100K by Dec 2025?"
├─ YES Avg Score: 82.3 (from top 20 wallets)
├─ NO Avg Score: 48.7 (from top 20 wallets)
├─ SII Signal: +33.6 (Strong YES)
├─ SII Confidence: 75%
└─ Recommendation: Smart money strongly favors YES
```

### 3. Data Pipeline

**Purpose**: Ingest trade history from blockchain, transform, and load into analytics database

**Location**: `/docs/data-pipeline-architecture.md`

**Flow:**
```
Blockchain (Polygon)
  → Goldsky Subgraphs (GraphQL)
  → ETL Workers (Node.js)
  → ClickHouse (Analytics DB)
  → Calculation Jobs (Hourly)
  → Postgres (Current State)
  → Redis (Cache)
  → API
  → Frontend
```

**Data Sources:**
- **Goldsky Activity Subgraph**: All-time trade history (FREE)
- **Goldsky Positions Subgraph**: Current positions per market
- **Polymarket CLOB API**: Real-time market data

**Update Frequency:**
- ETL sync: Every hour
- Score calculation: Every hour (15min after sync)
- SII calculation: Every hour (30min after sync)

### 4. Node Builder (Upcoming)

**Purpose**: Visual interface to create custom trading signals

**Features:**
- Drag-and-drop formula builder
- Combine multiple metrics (Omega, Sharpe, volume, etc.)
- Apply filters (min trades, momentum threshold)
- Backtest signals on historical data
- Save and share strategies

**Example Signal:**
```
"Elite Omega Momentum"
├─ Filter: total_trades > 10
├─ Filter: omega_momentum > 0.1
├─ Filter: portfolio_value > $10k
├─ Sort by: omega_ratio_30d DESC
├─ Top N: 50 wallets per market
└─ Result: Markets where improving traders favor one side
```

---

## Technology Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI**: React 18, TailwindCSS
- **State**: TanStack Query (React Query)
- **Charts**: Recharts, D3.js
- **Deploy**: Vercel

### Backend
- **API**: Next.js API Routes
- **Runtime**: Node.js 18+
- **Language**: TypeScript

### Databases
- **Transactional DB**: Postgres (Supabase)
  - User data, markets, current scores
  - ~10 GB
- **Analytics DB**: ClickHouse Cloud
  - Historical trades, time-series metrics
  - ~50 GB compressed
- **Cache**: Redis (Upstash)
  - Hot cache for wallet scores (1hr TTL)
  - ~500 MB

### Data Sources
- **Goldsky Subgraphs**: Free, public GraphQL endpoints
- **Polymarket CLOB API**: Current market data
- **The Graph**: Blockchain indexing

### Infrastructure
- **Hosting**: Vercel (frontend + API)
- **Cron Jobs**: Vercel Cron or separate worker service
- **Monitoring**: Vercel Analytics, custom metrics
- **Logs**: Pino (structured logging)

---

## Data Flow

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Data Sources                           │
│  ┌──────────────────┐         ┌──────────────────┐     │
│  │  Goldsky         │         │  Polymarket      │     │
│  │  Subgraphs       │         │  CLOB API        │     │
│  │  (GraphQL)       │         │  (REST)          │     │
│  └────────┬─────────┘         └────────┬─────────┘     │
└───────────┼────────────────────────────┼───────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────┐
│              ETL Workers (Hourly)                        │
│  - Fetch new trades from Goldsky                         │
│  - Fetch market positions from Polymarket                │
│  - Transform to internal schema                          │
│  - Load to ClickHouse                                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│            ClickHouse (Analytics DB)                     │
│  - trades_raw (500M+ rows)                               │
│  - wallet_metrics_daily (materialized view)              │
│  - Fast time-series queries                              │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│          Calculation Jobs (Hourly)                       │
│  Job 1: Calculate Wallet Scores                          │
│    - Query ClickHouse for rolling metrics                │
│    - Calculate Omega, Sharpe, win rate                   │
│    - Apply formula, store in Postgres                    │
│                                                           │
│  Job 2: Calculate Market SII                             │
│    - Get top N positions per market                      │
│    - Lookup wallet scores                                │
│    - Calculate weighted avg per side                     │
│    - Store SII signal in Postgres                        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│       Postgres (Supabase) + Redis Cache                  │
│  - wallet_scores (current scores)                        │
│  - market_sii (current signals)                          │
│  - markets (current market data)                         │
│  - Redis: Hot cache (1hr TTL)                            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Next.js API Routes                          │
│  GET /api/wallets/[address]/score                        │
│  GET /api/markets/[id]/sii                               │
│  GET /api/markets (with SII filter/sort)                 │
│  POST /api/signals/create (node builder)                 │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                Frontend (Next.js)                        │
│  - Market Screener (filter by SII signal)                │
│  - Market Detail (show smart money breakdown)            │
│  - Wallet Profile (performance history)                  │
│  - Node Builder (create custom signals)                  │
└─────────────────────────────────────────────────────────┘
```

### Request Flow Example: Market Screener

```
User visits /markets
  ↓
Frontend: GET /api/markets?sort=sii_signal&limit=100
  ↓
API checks Redis cache for market list
  ├─ Cache hit → Return cached response (5ms)
  └─ Cache miss ↓
       Query Postgres:
         SELECT m.*, sii.sii_signal, sii.sii_confidence
         FROM markets m
         JOIN market_sii sii ON m.market_id = sii.market_id
         WHERE m.active = true
         ORDER BY sii.sii_signal DESC
         LIMIT 100
       (50ms)
  ↓
Cache response in Redis (1hr TTL)
  ↓
Return JSON to frontend
  ↓
Frontend renders market cards with SII badges
```

---

## Key Features

### Current (Phase 1)

- ✅ **Real Polymarket data** - Replaces all mock data generators
- ✅ **Market screener** - Filter/sort by category, volume, liquidity
- ✅ **Category-based wallet scoring** - Different expectations per category
- ✅ **Smart money flow visualization** - Side-by-side breakdown
- ✅ **Automated sync** - 5-minute staleness threshold

### In Development (Phase 2)

- 🚧 **Historical trade ingestion** - Goldsky → ClickHouse pipeline
- 🚧 **Wallet smart scores** - Omega ratio, momentum, Sharpe
- 🚧 **Market SII calculation** - Top N positions, weighted averages
- 🚧 **Power law optimization** - Only track top wallets per market
- 🚧 **Flexible formulas** - JSON-based formula definitions

### Planned (Phase 3)

- 📋 **Node builder UI** - Visual signal creation
- 📋 **Signal backtesting** - Historical performance validation
- 📋 **Wallet profiles** - Detailed trader performance pages
- 📋 **Copy trading alerts** - Notify when top traders enter positions
- 📋 **WebSocket updates** - Real-time market data
- 📋 **Multi-platform support** - Kalshi, Manifold, etc.

---

## Documentation Index

### Core Architecture

| Document | Purpose | Location |
|----------|---------|----------|
| **Architecture Overview** | This document - system-wide overview | `/docs/ARCHITECTURE_OVERVIEW.md` |
| **Wallet Analytics** | Smart score calculation, formulas | `/supabase/docs/wallet-analytics-architecture.md` |
| **Market SII System** | Signal generation from smart money | `/lib/SMART_MONEY_FLOW.md` |
| **Data Pipeline** | Goldsky → ClickHouse ETL | `/docs/data-pipeline-architecture.md` |

### Database & Schema

| Document | Purpose | Location |
|----------|---------|----------|
| **Polymarket Schema** | Current markets table schema | `/supabase/docs/polymarket-schema.md` |
| **Wallet Analytics Schema** | ClickHouse + Postgres tables | `/supabase/docs/wallet-analytics-architecture.md#database-architecture` |
| **Wallet Analytics Quick Ref** | Common queries, testing | `/supabase/docs/wallet-analytics-quick-reference.md` |

### Existing Systems

| Document | Purpose | Location |
|----------|---------|----------|
| **Scoring System** | Current category-based scoring | `/lib/SCORING_SYSTEM.md` |
| **Polymarket Integration** | Current API integration | `/lib/polymarket/README.md` |
| **Trade Aggregation** | Trade processing logic | `/lib/polymarket/TRADE_AGGREGATION.md` |

### Implementation Guides

| Document | Purpose | Location |
|----------|---------|----------|
| **Migration Instructions** | Database migrations | `/supabase/MIGRATION_INSTRUCTIONS.md` |
| **Production Deployment** | Deploy guide | `/PRODUCTION_DEPLOYMENT_GUIDE.md` |
| **Workflow Sessions** | Session management | `/supabase/docs/workflow-sessions-guide.md` |

---

## Development Roadmap

### Phase 1: Foundation ✅ (Complete)

**Timeline:** Completed Oct 2025

**Deliverables:**
- [x] Real Polymarket data integration
- [x] Market screener with filters
- [x] Category-based wallet scoring (simple)
- [x] Supabase schema + migrations
- [x] 5-minute auto-sync

### Phase 2: Smart Score System 🚧 (In Progress)

**Timeline:** Nov-Dec 2025 (8-12 weeks)

**Deliverables:**
- [ ] ClickHouse setup + schema
- [ ] Goldsky ETL pipeline
- [ ] Historical trade backfill
- [ ] Omega ratio calculation
- [ ] Wallet smart score calculation
- [ ] Market SII calculation
- [ ] API endpoints for scores/SII
- [ ] Update market screener UI with SII

**Milestones:**
- Week 2: ClickHouse live with sample data
- Week 4: ETL pipeline processing 100 wallets
- Week 6: Smart score calculation working
- Week 8: Market SII calculation working
- Week 10: API + UI integration
- Week 12: Production deployment

### Phase 3: Node Builder & Signals (Planned)

**Timeline:** Jan-Feb 2026 (6-8 weeks)

**Deliverables:**
- [ ] Visual node builder UI
- [ ] Formula execution engine
- [ ] Signal backtesting capability
- [ ] User-saved signals
- [ ] Signal performance tracking
- [ ] Copy trading alerts

### Phase 4: Advanced Features (Planned)

**Timeline:** Mar-Apr 2026

**Deliverables:**
- [ ] Wallet profile pages
- [ ] WebSocket real-time updates
- [ ] Advanced analytics (cohort analysis, etc.)
- [ ] Multi-platform support (Kalshi, Manifold)
- [ ] Mobile app (React Native)

---

## Getting Started

### Prerequisites

```bash
# Node.js 18+
node --version

# pnpm (package manager)
npm install -g pnpm

# Supabase CLI (optional, for migrations)
npm install -g supabase
```

### Environment Setup

```bash
# Clone repo
git clone [repo-url]
cd Cascadian-app

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Configure environment variables
# Required:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Optional (Phase 2):
CLICKHOUSE_HOST=...
CLICKHOUSE_USER=...
CLICKHOUSE_PASSWORD=...
REDIS_URL=...
```

### Run Development Server

```bash
pnpm dev
# Open http://localhost:3000
```

### Run Tests

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests
pnpm test:e2e
```

---

## Key Decisions & Rationale

### Why ClickHouse?

**Requirements:**
- Store 500M+ trade records
- Fast rolling window queries (30d, 60d, 90d)
- Time-series analytics

**Alternatives considered:**
- Postgres + TimescaleDB: Slower for large analytical queries
- BigQuery: More expensive, vendor lock-in
- DuckDB: Embedded, not designed for our scale

**Decision:** ClickHouse
- Designed for analytical workloads
- 10x faster than Postgres for our queries
- Excellent compression (10:1 ratio)
- Cost-effective at scale

### Why Goldsky?

**Requirements:**
- Historical trade data (all time)
- No cost constraints
- Reliable infrastructure

**Alternatives considered:**
- The Graph Network: Decentralized but costs query fees
- Self-hosted indexer: High ops burden
- Polymarket API: Only 30 days free, premium required

**Decision:** Goldsky
- Free public endpoints
- Hosted by reputable company
- Complete historical data
- GraphQL flexibility

### Why Power Law Optimization?

**Hypothesis:** Top 20-100 wallets per market represent 60-80% of liquidity

**Benefits if true:**
- Only need to score ~5,000 wallets (not 50,000)
- 10x less data to process
- Real-time calculations feasible
- Configurable N per signal

**Validation plan:**
- Analyze current Polymarket markets
- Calculate % liquidity in top 20, 50, 100
- If <60%, adjust strategy

---

## Performance Targets

### API Response Times

| Endpoint | Target (P95) | Current (Phase 1) |
|----------|--------------|-------------------|
| GET /api/markets | < 500ms | ~150ms ✅ |
| GET /api/markets/[id] | < 200ms | ~50ms ✅ |
| GET /api/wallets/[address]/score | < 300ms | N/A (Phase 2) |
| GET /api/markets/[id]/sii | < 500ms | N/A (Phase 2) |

### Database Query Times

| Query | Target (P95) | Database |
|-------|--------------|----------|
| Fetch 100 markets with SII | < 100ms | Postgres |
| Calculate wallet score (30d window) | < 200ms | ClickHouse |
| Fetch wallet trades (1 year) | < 500ms | ClickHouse |
| Top N positions per market | < 300ms | Postgres |

### Job Performance

| Job | Target Duration | Frequency |
|-----|-----------------|-----------|
| Sync 100 wallets (new trades) | < 5 min | Hourly |
| Calculate 5,000 wallet scores | < 15 min | Hourly |
| Calculate 2,000 market SII | < 10 min | Hourly |

---

## Monitoring & Alerts

### Key Metrics

**Data Pipeline Health:**
- ETL job success rate (target: >99%)
- Avg sync duration (target: <15 min)
- Trades ingested per hour
- Data freshness (target: <2 hours old)

**System Performance:**
- API response times (p50, p95, p99)
- ClickHouse query latency
- Redis cache hit rate (target: >90%)
- Error rate (target: <0.1%)

**Business Metrics:**
- Active wallets tracked
- Markets with SII signals
- User engagement (views, filters used)

### Alerts

**Critical (PagerDuty):**
- ETL job failed 3x in a row
- API error rate >1% for 5 minutes
- Database connection pool exhausted

**Warning (Slack):**
- ETL job took >30 min
- Data >4 hours stale
- Cache hit rate <70%

---

## Support & Contributing

### Questions?

1. Check relevant documentation (see index above)
2. Search GitHub issues
3. Ask in team Slack channel

### Contributing

1. Create feature branch from `main`
2. Make changes, add tests
3. Update relevant documentation
4. Submit PR with clear description

### Code Standards

- **TypeScript**: Strict mode enabled
- **Linting**: ESLint + Prettier
- **Testing**: >80% coverage for business logic
- **Documentation**: Update docs when changing architecture

---

**Last Updated:** 2025-10-24
**Maintained By:** Development Team
**Status:** Living Document - Updated as system evolves
