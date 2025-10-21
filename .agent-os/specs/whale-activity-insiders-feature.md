# Whale Activity & Insiders Feature Specification

**Status**: Draft
**Created**: 2024-10-21
**Last Updated**: 2024-10-21
**Owner**: CASCADIAN Product Team
**Priority**: High

---

## Executive Summary

This specification outlines the design and implementation of CASCADIAN's **Whale Activity** and **Insiders** features to achieve parity with—and exceed—Hashdive's whale-focused analytics tools. These features will provide professional traders, researchers, and retail users with actionable insights into large trader behavior and potential insider activity.

### Goals
1. **Match Hashdive capabilities**: Whale Positions, Whale Trades, Unusual Trades, Insiders detection
2. **Exceed with innovation**: Add Concentration Heatmaps, Position Flips tracking, Flow analysis, Cluster detection
3. **Maximize utility**: Enable actionable workflows (watch, alert, copy, export)
4. **Maintain compliance**: Provide audit trails and compliance exports

### Success Metrics
- **Engagement**: 60%+ daily active users viewing whale data, 8+ min average session
- **Adoption**: 40%+ create watchlists, 25%+ set alerts
- **Satisfaction**: >90% task completion rate, <3 min time to insight
- **Revenue**: Drive Pro subscriptions through gated advanced features

---

## User Research Summary

### Primary Personas

#### 1. Momentum Mike (Professional Trader)
- **Goal**: Copy whale trades in real-time to capitalize on their insights
- **Pain Points**: Too much noise, can't filter to just "smart" whales
- **Needs**: Real-time alerts, quick filtering, mobile access
- **Success**: Receives actionable whale trade alerts, executes copies within minutes

#### 2. Data-Driven Dana (Research Analyst)
- **Goal**: Detect market manipulation and insider trading patterns
- **Pain Points**: Manual analysis is time-consuming, lacks statistical tools
- **Needs**: Cluster analysis, timing analysis, compliance exports
- **Success**: Identifies suspicious clusters, generates compliance reports

#### 3. Smart Money Sam (Retail Follower)
- **Goal**: Follow successful traders without complex analysis
- **Pain Points**: Overwhelmed by data, doesn't know which whales to trust
- **Needs**: Simple smart whale rankings, beginner-friendly UI
- **Success**: Finds 2-3 reliable whales to follow, sets up basic alerts

### Key User Journeys

**Journey 1: Discover and Follow a Whale**
```
Awareness → Browse Scoreboard → View Whale Profile → Add to Watchlist → Set Alert → Monitor Activity
```

**Journey 2: Investigate Suspicious Activity**
```
See Unusual Trade → Check Market Context → View Wallet Profile → Explore Cluster → Flag for Review → Export Report
```

**Journey 3: Copy a Whale Trade**
```
Receive Alert → View Trade Details → Check Whale Track Record → Execute Copy Trade → Track Outcome
```

---

## Information Architecture

### Consolidated Structure (UX Recommendation)

Instead of 13 separate tabs, consolidate into **5 primary views** with progressive disclosure:

```
CASCADIAN Navigation
├── Discovery
│   ├── Market Screener
│   ├── Market Map
│   ├── Whale Activity ← NEW (Main Hub)
│   │   ├── Live Trades (default view)
│   │   ├── Whale Positions
│   │   ├── Analytics ▼
│   │   │   ├── Concentration Heatmap
│   │   │   ├── Position Flips
│   │   │   ├── Flows
│   │   └── Scoreboard
│   ├── Leaderboard
│   └── Whale Tracker (legacy - redirect to Whale Activity)
├── Insiders ← NEW (Separate Page)
│   ├── Dashboard (default view)
│   ├── Wallet Watch
│   ├── Advanced ▼
│   │   ├── Market Watch
│   │   ├── Unusual Trades
│   │   ├── Clusters
│   │   └── Filters/Export
└── Analysis
    ├── Market Detail
    └── Wallet Detail
```

### Progressive Disclosure Strategy

**Level 1 (Casual Users)**:
- 5 core metrics displayed
- Pre-filtered to high-quality signals (WIS ≥70, Size ≥$5k)
- Tooltips explain all metrics
- Smart defaults

**Level 2 (Regular Users)**:
- 10 metrics, expandable filters
- Saved views and custom filters
- Alert creation
- Basic exports (CSV)

**Level 3 (Power Users / Pro)**:
- 20+ metrics including SWS, Insider Scores
- Advanced statistical tools
- Cluster analysis
- API access, compliance exports

---

## Technical Specification

### Technology Stack

- **Frontend**: Next.js 14.2.16, React 18, TypeScript 5.x
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: TailwindCSS 3.4.17
- **Charts**: ECharts (via echarts-for-react)
- **Tables**: Custom DataTable component (PrimeVue-inspired)
- **State Management**: Zustand
- **API**: RESTful endpoints with server-side pagination

### Data Models

#### Whale Position
```typescript
interface WhalePosition {
  whaleAddress: string
  whaleName?: string
  isSmartWhale: boolean
  swsScore?: number // 0-10, Pro feature

  marketId: string
  marketTitle: string
  category: string

  side: 'YES' | 'NO'
  shares: number
  invested: number
  currentValue: number
  avgEntryPrice: number
  currentPrice: number

  unrealizedPnl: number
  unrealizedPnlPct: number

  supplyPercent: number // % of total market supply
  sizeTier: 'whale' | 'megawhale' | 'ultrawhale'

  firstEntryDate: string
  lastActivityDate: string

  updatedAt: string
}
```

#### Whale Trade
```typescript
interface WhaleTrade {
  id: string
  timestamp: string

  whaleAddress: string
  whaleName?: string
  isSmartWhale: boolean

  marketId: string
  marketTitle: string
  category: string

  side: 'YES' | 'NO'
  action: 'BUY' | 'SELL'
  price: number
  shares: number
  amountUsd: number

  marketVolumePercent: number // Trade size / 24h volume
  priceImpactBps: number
  slippageBps: number

  tradeZ?: number // Z-score vs market average (Pro)

  outcome?: 'pending' | 'win' | 'loss'
  outcomePnl?: number
}
```

#### Smart Whale Score (SWS)
```typescript
interface SmartWhaleScore {
  address: string
  swsScore: number // 0-10 composite score
  reliability: number // 0-1 confidence in score

  // Component scores
  winRate: number
  omega: number // Omega ratio
  sortino: number
  realizedRoi: number
  timingEdge: number // vs random entry
  avgSlippageBps: number
  hitRate: number
  avgHoldTime: number // hours

  // Category strengths
  categorySkills: {
    [category: string]: number // 0-10
  }

  // Meta
  totalTrades: number
  totalVolume: number
  marketsTraded: number
  activeDays: number

  updatedAt: string
}
```

#### Insider Profile
```typescript
interface InsiderProfile {
  address: string
  name?: string

  insiderScore: number // 0-10 composite
  riskLevel: 'high' | 'medium' | 'low'

  // Score breakdown
  timingScore: number // Entry timing vs news
  volumeScore: number // Unusual volume patterns
  outcomeScore: number // Win rate anomalies
  clusterScore: number // Network connections

  // Stats
  totalTrades: number
  totalVolume: number
  winRate: number
  avgTimeToOutcome: number // minutes

  // Flags
  flags: {
    type: string
    severity: 'high' | 'medium' | 'low'
    description: string
    timestamp: string
  }[]

  // Connections
  relatedWallets: string[]
  clusterId?: string

  // Investigation status
  status: 'flagged' | 'under_review' | 'cleared' | 'confirmed'
  investigatedBy?: string
  investigationNotes?: string

  updatedAt: string
}
```

#### Wallet Cluster
```typescript
interface WalletCluster {
  id: string
  members: string[] // Wallet addresses

  // Cluster characteristics
  avgInsiderScore: number
  riskLevel: 'high' | 'medium' | 'low'

  // Connection types
  connections: {
    source: string
    target: string
    weight: number
    type: 'funding' | 'trading' | 'timing'
  }[]

  // Behavioral patterns
  patterns: {
    type: string // e.g., "coordinated_entry", "rapid_succession"
    confidence: number
    description: string
  }[]

  // Meta
  firstDetected: string
  lastActivity: string
  totalVolume: number

  // Investigation
  status: 'detected' | 'monitoring' | 'confirmed' | 'dismissed'

  updatedAt: string
}
```

### API Endpoints

#### Whale Activity Endpoints

```typescript
// Positions
GET /api/whales/positions
  ?timeWindow=24h|7d|30d|all
  &side=all|YES|NO
  &minUsd=100000
  &market=marketId
  &category=Politics|Sports|Crypto|Finance|PopCulture|Tech
  &smartOnly=true|false
  &page=1
  &pageSize=50
  &sortBy=size|pnl|entry|updated
  &sortOrder=asc|desc

// Trades
GET /api/whales/trades
  ?from=timestamp
  &to=timestamp
  &minUsd=100000
  &maxUsd=10000000
  &side=all|YES|NO
  &market=marketId
  &category=Politics
  &flipsOnly=true|false
  &closesOnly=true|false
  &page=1
  &pageSize=50

// Concentration Heatmap
GET /api/whales/concentration
  ?marketId=required
  &side=YES|NO
  &timeWindow=24h|7d|30d

// Unusual Trades
GET /api/whales/unusual
  ?percentile=99 // Top 1%
  &lookbackHours=24
  &market=marketId
  &category=Politics
  &whalesOnly=true|false
  &page=1
  &pageSize=50

// Scoreboard
GET /api/whales/leaderboard
  ?timeWindow=7d|30d|90d|all
  &minMarkets=5
  &minPnl=10000
  &minTrades=10
  &swsGte=7.0
  &category=Politics
  &page=1
  &pageSize=50
  &sortBy=sws|winRate|roi|volume
  &sortOrder=desc

// Flips
GET /api/whales/flips
  ?marketId=optional
  &from=timestamp
  &to=timestamp
  &page=1
  &pageSize=50

// Flows
GET /api/whales/flows
  ?from=timestamp
  &to=timestamp
  &marketId=optional
  &flowType=deposit|withdrawal|net

// Alerts
POST /api/whales/alerts
  body: AlertRule
GET /api/whales/alerts?userId=current
PUT /api/whales/alerts/:id
DELETE /api/whales/alerts/:id
```

#### Insiders Endpoints

```typescript
// Dashboard
GET /api/insiders/candidates
  ?timeWindow=7d|30d|90d
  &marketId=optional
  &category=Politics
  &minScore=6.0
  &riskLevel=high|medium|low
  &status=flagged|under_review|cleared
  &page=1
  &pageSize=50

// Market Watch
GET /api/insiders/market/:marketId
  ?includeActivity=true
  &includeClusters=true

// Wallet Watch
GET /api/insiders/wallet/:address
  ?includeFlags=true
  &includeCluster=true
  &includeBehavior=true

// Clusters
GET /api/insiders/clusters
  ?metric=timing|volume|funding
  &minMembers=3
  &minScore=6.0
  &page=1
  &pageSize=20

GET /api/insiders/clusters/:clusterId
  ?includeGraph=true
  &includeMembers=true

// Export
POST /api/insiders/export
  body: {
    reportType: 'full_audit' | 'flagged_wallets' | 'clusters'
    dateRange: { from: string, to: string }
    format: 'pdf' | 'csv' | 'json'
    include: {
      flaggedWallets: boolean
      clusterAnalysis: boolean
      marketRiskScores: boolean
      investigationNotes: boolean
    }
  }
```

### Database Schema (Materialized Views)

```sql
-- Whale Positions (refreshed every 5 min)
CREATE MATERIALIZED VIEW whale_positions_mv AS
SELECT
  w.address as whale_address,
  w.name as whale_name,
  w.is_smart_whale,
  w.sws_score,
  p.market_id,
  m.title as market_title,
  m.category,
  p.side,
  p.shares,
  p.invested,
  p.current_value,
  p.avg_entry_price,
  m.current_price,
  (p.current_value - p.invested) as unrealized_pnl,
  ((p.current_value - p.invested) / p.invested * 100) as unrealized_pnl_pct,
  (p.shares / m.total_supply * 100) as supply_percent,
  CASE
    WHEN p.invested >= 100000 THEN 'whale'
    WHEN p.invested >= 500000 THEN 'megawhale'
    WHEN p.invested >= 1000000 THEN 'ultrawhale'
  END as size_tier,
  p.first_entry_date,
  p.last_activity_date,
  NOW() as updated_at
FROM positions p
JOIN wallets w ON p.wallet_address = w.address
JOIN markets m ON p.market_id = m.id
WHERE w.is_whale = true
  AND p.status = 'active';

-- Whale Trades (append-only log, indexed by timestamp)
CREATE TABLE whale_trades (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  whale_address TEXT NOT NULL,
  whale_name TEXT,
  is_smart_whale BOOLEAN,
  market_id TEXT NOT NULL,
  market_title TEXT NOT NULL,
  category TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  price NUMERIC NOT NULL,
  shares NUMERIC NOT NULL,
  amount_usd NUMERIC NOT NULL,
  market_volume_24h NUMERIC,
  market_volume_percent NUMERIC,
  price_impact_bps NUMERIC,
  slippage_bps NUMERIC,
  trade_z NUMERIC,
  outcome TEXT CHECK (outcome IN ('pending', 'win', 'loss')),
  outcome_pnl NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whale_trades_timestamp ON whale_trades(timestamp DESC);
CREATE INDEX idx_whale_trades_whale ON whale_trades(whale_address);
CREATE INDEX idx_whale_trades_market ON whale_trades(market_id);
CREATE INDEX idx_whale_trades_amount ON whale_trades(amount_usd DESC);

-- Smart Whale Scores (refreshed daily)
CREATE MATERIALIZED VIEW whale_scores_mv AS
SELECT
  address,
  compute_sws_score(address) as sws_score,
  compute_sws_reliability(address) as reliability,
  win_rate,
  omega_ratio as omega,
  sortino_ratio as sortino,
  realized_roi,
  timing_edge,
  avg_slippage_bps,
  hit_rate,
  avg_hold_time_hours,
  category_skills,
  total_trades,
  total_volume,
  markets_traded,
  active_days,
  NOW() as updated_at
FROM wallets
WHERE is_whale = true;

-- Insider Profiles (refreshed every hour)
CREATE MATERIALIZED VIEW insider_profiles_mv AS
SELECT
  address,
  name,
  compute_insider_score(address) as insider_score,
  CASE
    WHEN compute_insider_score(address) >= 8 THEN 'high'
    WHEN compute_insider_score(address) >= 6 THEN 'medium'
    ELSE 'low'
  END as risk_level,
  compute_timing_score(address) as timing_score,
  compute_volume_score(address) as volume_score,
  compute_outcome_score(address) as outcome_score,
  compute_cluster_score(address) as cluster_score,
  total_trades,
  total_volume,
  win_rate,
  avg_time_to_outcome_minutes,
  investigation_status,
  NOW() as updated_at
FROM wallets
WHERE compute_insider_score(address) >= 4.0;

-- Wallet Clusters (refreshed every 6 hours)
CREATE TABLE wallet_clusters (
  id UUID PRIMARY KEY,
  members TEXT[] NOT NULL,
  avg_insider_score NUMERIC,
  risk_level TEXT CHECK (risk_level IN ('high', 'medium', 'low')),
  connections JSONB, -- Array of {source, target, weight, type}
  patterns JSONB, -- Array of detected patterns
  first_detected TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ NOT NULL,
  total_volume NUMERIC,
  status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'monitoring', 'confirmed', 'dismissed')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Scoring Algorithms

#### Smart Whale Score (SWS) Calculation

```typescript
// /lib/utils/insiderScoring.ts

/**
 * Compute Smart Whale Score (0-10)
 *
 * Components:
 * - Win Rate (20%): Percentage of winning trades
 * - Omega Ratio (20%): Probability-weighted ratio of gains vs losses
 * - Sortino Ratio (15%): Return vs downside deviation
 * - Realized ROI (15%): Total return on investment
 * - Timing Edge (10%): Performance vs random entry
 * - Slippage Management (5%): Ability to minimize slippage
 * - Hit Rate (5%): Consistency of performance
 * - Hold Time (5%): Patience and conviction
 * - Category Skill (5%): Specialization depth
 */
export function computeSWSScore(wallet: {
  winRate: number
  omega: number
  sortino: number
  realizedRoi: number
  timingEdge: number
  avgSlippageBps: number
  hitRate: number
  avgHoldTimeHours: number
  categorySkills: Record<string, number>
  totalTrades: number
}): { score: number; reliability: number } {
  // Require minimum 20 trades for reliable score
  if (wallet.totalTrades < 20) {
    return { score: 0, reliability: 0 }
  }

  // Normalize each component to 0-10 scale
  const components = {
    winRate: normalizeWinRate(wallet.winRate), // 0.5 = 0, 0.7 = 5, 0.9 = 10
    omega: normalizeOmega(wallet.omega), // 1.0 = 0, 1.5 = 5, 2.5+ = 10
    sortino: normalizeSortino(wallet.sortino), // 0 = 0, 1.0 = 5, 2.0+ = 10
    roi: normalizeROI(wallet.realizedRoi), // -50% = 0, 0% = 5, 100%+ = 10
    timing: normalizeTimingEdge(wallet.timingEdge), // -10% = 0, 0% = 5, +20%+ = 10
    slippage: normalizeSlippage(wallet.avgSlippageBps), // 100bps = 0, 20bps = 5, 5bps = 10
    hitRate: normalizeHitRate(wallet.hitRate), // 0.3 = 0, 0.5 = 5, 0.7+ = 10
    holdTime: normalizeHoldTime(wallet.avgHoldTimeHours), // 1h = 0, 24h = 5, 168h+ = 10
    category: Math.max(...Object.values(wallet.categorySkills))
  }

  // Weighted composite
  const score = (
    components.winRate * 0.20 +
    components.omega * 0.20 +
    components.sortino * 0.15 +
    components.roi * 0.15 +
    components.timing * 0.10 +
    components.slippage * 0.05 +
    components.hitRate * 0.05 +
    components.holdTime * 0.05 +
    components.category * 0.05
  )

  // Reliability based on sample size and consistency
  const reliability = Math.min(1, (
    (wallet.totalTrades / 100) * 0.7 +
    (1 - standardDeviation(components)) * 0.3
  ))

  return { score: Math.min(10, Math.max(0, score)), reliability }
}

function normalizeWinRate(winRate: number): number {
  if (winRate <= 0.5) return 0
  if (winRate >= 0.9) return 10
  return ((winRate - 0.5) / 0.4) * 10
}

function normalizeOmega(omega: number): number {
  if (omega <= 1.0) return 0
  if (omega >= 2.5) return 10
  return ((omega - 1.0) / 1.5) * 10
}

// ... other normalization functions
```

#### Insider Score Calculation

```typescript
/**
 * Compute Insider Score (0-10)
 *
 * Components:
 * - Timing Score (30%): Entry timing vs news/outcomes
 * - Volume Score (25%): Unusual size vs market norms
 * - Outcome Score (25%): Win rate anomalies
 * - Cluster Score (20%): Connections to other flagged wallets
 */
export function computeInsiderScore(wallet: {
  avgTimeToOutcome: number // minutes
  avgTradeSize: number
  marketAvgSize: number
  marketStdSize: number
  winRate: number
  expectedWinRate: number
  relatedWallets: string[]
  flaggedRelatedWallets: string[]
}): number {
  // Timing Score: How close to outcomes do they enter?
  const timingScore = computeTimingScore(wallet.avgTimeToOutcome)

  // Volume Score: How abnormal is their size?
  const volumeZ = (wallet.avgTradeSize - wallet.marketAvgSize) / wallet.marketStdSize
  const volumeScore = normalizeZScore(volumeZ) // Convert Z-score to 0-10

  // Outcome Score: Is win rate suspiciously high?
  const winRateDelta = wallet.winRate - wallet.expectedWinRate
  const outcomeScore = normalizeWinRateDelta(winRateDelta)

  // Cluster Score: Connected to other suspicious wallets?
  const clusterRatio = wallet.flaggedRelatedWallets.length / Math.max(1, wallet.relatedWallets.length)
  const clusterScore = clusterRatio * 10

  // Weighted composite
  const score = (
    timingScore * 0.30 +
    volumeScore * 0.25 +
    outcomeScore * 0.25 +
    clusterScore * 0.20
  )

  return Math.min(10, Math.max(0, score))
}

function computeTimingScore(avgMinutesToOutcome: number): number {
  // Shorter time to outcome = higher suspicion
  // 1440 min (24h) = 0, 720 min (12h) = 5, 60 min (1h) = 10
  if (avgMinutesToOutcome >= 1440) return 0
  if (avgMinutesToOutcome <= 60) return 10
  return 10 - ((avgMinutesToOutcome - 60) / 1380) * 10
}

function normalizeZScore(z: number): number {
  // Z > 3 = very suspicious (10)
  // Z = 2 = moderately suspicious (6.7)
  // Z = 1 = slightly unusual (3.3)
  // Z <= 0 = normal (0)
  if (z <= 0) return 0
  if (z >= 3) return 10
  return (z / 3) * 10
}

function normalizeWinRateDelta(delta: number): number {
  // Win rate 20%+ above expected = max score (10)
  // Win rate 10% above = moderate score (5)
  // At or below expected = min score (0)
  if (delta <= 0) return 0
  if (delta >= 0.20) return 10
  return (delta / 0.20) * 10
}
```

---

## Design System

### Color Palette

```typescript
// /lib/design-tokens/whale-insiders-colors.ts
export const whaleInsidersColors = {
  // Signal Colors
  bullish: '#10B981',      // Green for long positions
  bearish: '#EF4444',      // Red for short positions
  neutral: '#6B7280',      // Gray for neutral

  // Score Gradients
  scoreHigh: '#10B981',    // High scores (8-10)
  scoreMid: '#F59E0B',     // Mid scores (4-7)
  scoreLow: '#EF4444',     // Low scores (0-3)

  // Whale Types
  smartWhale: '#8B5CF6',   // Purple for verified smart whales
  regularWhale: '#3B82F6', // Blue for regular whales
  insider: '#DC2626',      // Bright red for flagged insiders
  suspicious: '#F97316',   // Orange for suspicious activity

  // Chart Overlays
  heatmapHigh: '#DC2626',
  heatmapMid: '#FBBF24',
  heatmapLow: '#3B82F6',

  // UI Elements
  tableBorder: '#E5E7EB',
  tableHover: '#F9FAFB',
  chipBg: '#F3F4F6',
  chipActive: '#DBEAFE',

  // Status
  profit: '#10B981',
  loss: '#EF4444',
  pending: '#F59E0B',
}
```

### Typography Scale

```typescript
export const whaleTypography = {
  pageTitle: 'text-3xl font-bold',        // 30px - Page headers
  sectionTitle: 'text-xl font-semibold',  // 20px - Section headers
  cardTitle: 'text-lg font-medium',       // 18px - Card titles
  tableHeader: 'text-sm font-semibold',   // 14px - Table headers
  tableCell: 'text-sm font-normal',       // 14px - Table cells
  metric: 'text-2xl font-bold',           // 24px - Key metrics
  label: 'text-xs font-medium',           // 12px - Labels
  caption: 'text-xs text-gray-500',       // 12px - Captions
  chip: 'text-xs font-medium',            // 12px - Filter chips
}
```

---

## Implementation Plan

### Phase 1: Foundation (Days 1-2)

**Goal**: Core infrastructure and basic whale activity viewing

**Tasks**:
1. Set up database schema and materialized views
2. Create API endpoints for positions and trades
3. Build base page structure and navigation
4. Implement FilterBar component with presets
5. Build basic DataTable component with sorting
6. Create Positions tab with summary cards
7. Create Trades tab with basic table view

**Deliverables**:
- `/discovery/whale-activity` page accessible
- Users can view whale positions and trades
- Basic filtering by time, market, size works
- Mobile responsive layouts

### Phase 2: Analytics & Visualization (Days 3-5)

**Goal**: Add advanced visualizations and scoreboard

**Tasks**:
1. Implement TradeChart with ECharts (price + trade dots)
2. Build ConcentrationHeatmap component
3. Create Scoreboard with SWS calculation
4. Add FlipsTimeline view
5. Implement Flows tracking with volume share chart
6. Build UnusualTrades detection and card layout
7. Add column chooser and saved views

**Deliverables**:
- All 8 Whale Activity sub-tabs functional
- Charts render correctly with theme support
- Users can save filter presets
- Scoreboard ranks whales by SWS

### Phase 3: Insiders Detection (Days 6-8)

**Goal**: Launch Insiders page with flagging system

**Tasks**:
1. Implement Insider Score calculation
2. Build FlaggedWalletsTable component
3. Create WalletInsiderProfile detail view
4. Implement MarketWatch analysis
5. Add SuspiciousActivityChart
6. Build basic cluster detection
7. Add compliance export (CSV)

**Deliverables**:
- `/insiders` page accessible
- Dashboard shows flagged wallets
- Wallet Watch provides detailed profiles
- Users can export compliance CSVs

### Phase 4: Advanced Features (Days 9-11)

**Goal**: Cluster analysis, alerts, and Pro features

**Tasks**:
1. Implement ClusterGraph with network visualization
2. Build cluster detection algorithms
3. Create AlertRuleBuilder component
4. Implement alert triggering system
5. Add email/push notification integration
6. Build compliance PDF export (Pro)
7. Implement Pro feature gating

**Deliverables**:
- Cluster analysis functional
- Users can create custom alerts
- Alerts trigger via email/push
- Pro features clearly gated

### Phase 5: Polish & Optimization (Days 12-14)

**Goal**: Performance, UX refinement, mobile optimization

**Tasks**:
1. Add loading states and skeleton screens
2. Implement infinite scroll for tables
3. Optimize chart rendering performance
4. Add onboarding tooltips and tours
5. Improve mobile layouts and touch interactions
6. Conduct user testing sessions
7. Fix bugs and edge cases

**Deliverables**:
- Smooth, polished UX
- Mobile experience optimized
- Load times <2s for all views
- Bug-free core workflows

### Phase 6: Launch & Iterate (Day 15+)

**Goal**: Public launch and rapid iteration

**Tasks**:
1. Deploy to production
2. Monitor analytics and error rates
3. Gather user feedback
4. Iterate on top pain points
5. Add requested features to backlog
6. Plan next sprint based on data

---

## Success Criteria

### Must-Have (MVP)
- [ ] Whale Positions table with real-time data
- [ ] Whale Trades feed with filtering
- [ ] Scoreboard with SWS rankings
- [ ] Insiders Dashboard with flagged wallets
- [ ] Basic alert creation (position, trade)
- [ ] Mobile responsive design
- [ ] CSV export for compliance

### Should-Have (V1.5)
- [ ] Concentration Heatmap
- [ ] Position Flips timeline
- [ ] Unusual Trades detection
- [ ] Cluster analysis and graph
- [ ] Wallet Watch detailed profiles
- [ ] Advanced alerts (flips, flows)
- [ ] PDF compliance export (Pro)

### Nice-to-Have (V2+)
- [ ] Real-time WebSocket updates
- [ ] Copy-trade functionality
- [ ] Social features (follow, share insights)
- [ ] ML-powered insider detection
- [ ] Custom dashboards
- [ ] API access for Pro users

---

## Risk Mitigation

### Technical Risks

**Risk**: ECharts performance degrades with 1000+ data points
**Mitigation**: Implement data sampling, use canvas renderer, add virtualization

**Risk**: Real-time updates cause UI flicker
**Mitigation**: Use optimistic updates, debounce state changes, implement reconciliation

**Risk**: Complex clustering algorithm times out
**Mitigation**: Pre-compute clusters in background jobs, cache results, use approximate algorithms

### UX Risks

**Risk**: Users overwhelmed by data density
**Mitigation**: Smart defaults, progressive disclosure, onboarding tooltips

**Risk**: Too many clicks to insight
**Mitigation**: Side panels instead of page loads, quick actions on every row

**Risk**: Mobile experience cramped
**Mitigation**: Simplified mobile IA, horizontal scroll tables, bottom sheets

### Business Risks

**Risk**: Legal liability from false insider accusations
**Mitigation**: Clear disclaimers, "algorithmic flags not legal accusations", allow appeals

**Risk**: Whales game the system to improve SWS
**Mitigation**: Include hard-to-game metrics (timing edge, Sortino), update scoring regularly

**Risk**: Pro conversion too low to justify investment
**Mitigation**: Gate highest-value features (SWS, Insider Scores, exports), trial period

---

## Open Questions

1. **Data Retention**: How long do we store whale trade history? (Recommendation: 2 years)
2. **Whale Threshold**: What USD volume qualifies as "whale"? (Recommendation: $50k+ total stake)
3. **Real-time Updates**: WebSocket or polling? (Recommendation: Start with 30s polling, add WebSocket in V2)
4. **Insider Appeal Process**: How do flagged users dispute scores? (Recommendation: Manual review form, 48h SLA)
5. **Cluster Sensitivity**: What correlation threshold triggers cluster flagging? (Recommendation: 0.7+ timing correlation)

---

## Appendix

### Component File Structure

```
/components/whale-activity/
├── index.tsx (main page)
├── tabs/
│   ├── PositionsTab/
│   ├── TradesTab/
│   ├── ConcentrationTab/
│   ├── UnusualTradesTab/
│   ├── ScoreboardTab/
│   ├── FlipsTab/
│   ├── FlowsTab/
│   └── AlertsTab/
└── shared/
    ├── FilterBar/
    ├── DataTable/
    ├── MetricCard/
    └── ExportButton/

/components/insiders/
├── index.tsx (main page)
├── tabs/
│   ├── DashboardTab/
│   ├── MarketWatchTab/
│   ├── WalletWatchTab/
│   ├── ClustersTab/
│   └── FiltersExportTab/
└── shared/
    ├── InsiderScoreBadge/
    ├── RiskIndicator/
    └── ComplianceExport/

/lib/
├── design-tokens/whale-insiders-colors.ts
├── store/whale-activity-store.ts
├── store/insiders-store.ts
├── utils/insiderScoring.ts
├── utils/clusterDetection.ts
└── utils/formatters.ts
```

### Reference Links

- UX Research Report: `.agent-os/ux-research/whale-activity-insiders-user-needs-analysis.md`
- UI Design Spec: Included in agent output above
- Hashdive Competitor Analysis: (To be added)
- Agent OS Standards: `~/.agent-os/standards/`

---

## Sign-off

**Prepared by**: Claude (UX Research, UI Design, Technical Architecture)
**Reviewed by**: [Product Team]
**Approved by**: [Engineering Lead, Product Owner]
**Next Steps**: Engineering team review → Sprint planning → Development kickoff

