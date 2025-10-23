# Feature Specification: Wallet & Market Detail Pages Redesign

**Feature Name:** Wallet Detail & Market Detail UX/UI Overhaul
**Component Paths:**
- `/components/wallet-detail-interface/index.tsx`
- `/components/market-detail-interface/index.tsx`

**Created:** 2025-10-21
**Priority:** HIGH
**Sprint Duration:** 6 days (with optional 6-day extension for advanced features)

---

## Executive Summary

This specification outlines a comprehensive redesign of the Wallet Detail and Market Detail pages to address critical UX/UI issues including information overload, poor content truncation, oversized charts, and lack of digestibility. The redesign draws inspiration from Hashdive's compact, information-dense layouts while maintaining CASCADIAN's unique value proposition of smart money analysis.

### Key Problems Addressed

1. **Content runs indefinitely without truncation** → Progressive disclosure with "Show more" patterns
2. **Charts consume excessive space** → Compact sizing with strategic full-width usage
3. **Pages are overwhelming** → Clear visual hierarchy and scannable layouts
4. **Trading DNA takes too much space** → Compact summary with expandable details
5. **Redundant visualizations** → Consolidated, purposeful chart selection

### Expected Outcomes

**Wallet Detail Page:**
- 66% reduction in scroll depth (12,000px → 4,000px)
- 82% reduction in table rows displayed (228+ → ~40)
- 70% faster time to key metrics (<2 seconds)

**Market Detail Page:**
- 56% reduction in scroll depth (8,000px → 3,500px)
- 94% reduction in holder table rows (254+ → ~15)
- 70% faster decision-making time (<3 seconds)

---

## User Stories

### Primary User Story
**As a** prediction market trader analyzing wallet or market performance
**I want** to quickly scan key metrics and insights without excessive scrolling
**So that** I can make informed trading decisions faster

### Supporting User Stories

1. **As a** quick trader
   **I want** all critical metrics visible above the fold
   **So that** I can decide whether to investigate further within 5 seconds

2. **As a** research analyst
   **I want** detailed data available through progressive disclosure
   **So that** I can dive deep when needed without initial overwhelm

3. **As a** mobile user
   **I want** compact, touch-friendly layouts
   **So that** I can analyze markets effectively on smaller screens

4. **As a** whale watcher
   **I want** Trading DNA and identity badges to be informative but compact
   **So that** I can understand trader style without losing screen space

---

## Scope

### In Scope

#### Wallet Detail Page
- ✅ Compact hero metrics section with key performance indicators
- ✅ Reduced chart heights (PnL, Win Rate, Risk Metrics)
- ✅ Progressive disclosure for:
  - Identity badges (show top 3, expand for all)
  - Active positions table (show top 5, expand for all)
  - Finished positions table (show recent 10, expand for all)
  - Trading history (show recent 10, expand for all)
- ✅ Compact Trading DNA summary (150px vs current 400-600px)
- ✅ Smaller Trading Bubble Map (50% width vs full width)
- ✅ Trading Activity Calendar (keep, optimize sizing)
- ✅ Category performance as compact accordion
- ✅ Realistic dummy data generation

#### Market Detail Page
- ✅ Remove tab navigation → single scroll layout
- ✅ Hero metrics section (sentiment, smart money, momentum, signal)
- ✅ Reduced price chart height (450px → 350px)
- ✅ Progressive disclosure for:
  - Holders tables (show top 3 per side, expand for all)
  - Whale activity (show recent 5, expand for all)
  - Order book (show top 5 levels, expand for full depth)
- ✅ Compact related markets section (3 markets vs 6, moved to bottom)
- ✅ Side-by-side layouts for secondary charts (SII + Signal Breakdown)
- ✅ Advanced analytics as collapsible accordions
- ✅ Realistic dummy data generation

#### Both Pages
- ✅ Hashdive-inspired chart types implementation
- ✅ Responsive design optimizations
- ✅ Accessibility improvements (ARIA labels, keyboard navigation)
- ✅ Loading states and skeleton screens
- ✅ "Show more" / "Show less" interaction patterns

### Out of Scope (Future Iterations)
- ❌ Real-time data integration (using mock data)
- ❌ AI-generated insights (Dr. Taylor analysis)
- ❌ User preferences/customization
- ❌ Export functionality
- ❌ Social features (sharing, following)
- ❌ Mobile native app optimizations beyond responsive web

---

## Technical Architecture

### Component Structure

```
components/
├── wallet-detail-interface/
│   ├── index.tsx (main component - refactored)
│   ├── components/
│   │   ├── hero-metrics.tsx (NEW)
│   │   ├── compact-trading-dna.tsx (NEW)
│   │   ├── pnl-ranks-card.tsx (NEW)
│   │   ├── risk-metrics-compact.tsx (NEW)
│   │   ├── truncated-positions-table.tsx (NEW)
│   │   ├── category-accordion.tsx (NEW)
│   │   ├── trading-bubble-chart.tsx (modify - reduce size)
│   │   └── trading-calendar-heatmap.tsx (keep)
│   └── types.ts (existing)
│
├── market-detail-interface/
│   ├── index.tsx (main component - major refactor)
│   ├── components/
│   │   ├── hero-sentiment.tsx (NEW)
│   │   ├── smart-money-indicator.tsx (NEW)
│   │   ├── compact-holders-summary.tsx (NEW)
│   │   ├── whale-activity-feed.tsx (NEW)
│   │   ├── price-chart-compact.tsx (NEW)
│   │   ├── signal-breakdown-compact.tsx (NEW)
│   │   └── advanced-analytics-accordion.tsx (NEW)
│   └── types.ts (existing)
│
└── ui/ (shared shadcn/ui components)
    ├── metric-card.tsx (NEW)
    ├── sparkline.tsx (NEW)
    ├── collapsible-section.tsx (NEW)
    ├── truncated-text.tsx (NEW)
    └── progress-ring.tsx (NEW)
```

### Chart Libraries

**Primary:** `echarts-for-react` (already in use)

**Chart Types Needed (Hashdive-inspired):**
1. **Line charts** - Price trends, PnL history, SII trends
2. **Sparklines** - Mini trends in metric cards (custom implementation)
3. **Donut/Pie charts** - Ownership distribution, category breakdown
4. **Heatmaps** - Trading calendar, whale concentration
5. **Treemaps** - PnL distribution by holder
6. **Bubble charts** - Trading DNA bubble map, entry price vs smart score
7. **Bar charts** - Volume by price bucket, category comparison
8. **Candlestick (OHLC)** - Price action detail (toggle view)

### Data Flow

```
Page Component (index.tsx)
  ↓
Mock Data Generation
  ↓
Data Transformation (format for charts)
  ↓
Child Components (hero, charts, tables)
  ↓
UI Rendering (compact layouts)
```

**Future State (out of scope):**
```
Page Component
  ↓
API/Supabase Data Fetch
  ↓
State Management (React Query/SWR)
  ↓
Data Transformation
  ↓
Component Rendering
```

---

## Design Specifications

### Visual Hierarchy Principles

1. **Above the Fold = Decision Drivers**
   - Hero metrics: performance, sentiment, signals
   - Quick stats that answer "Should I care about this?"

2. **First Scroll = Context**
   - Trading DNA / Identity
   - Recent activity and positions

3. **Below Fold = Deep Dive**
   - Full tables with progressive disclosure
   - Advanced analytics
   - Historical comparisons

4. **Bottom = Discovery**
   - Related items
   - Comparisons
   - Additional resources

### Chart Sizing Standards

| Chart Type | Usage | Height | Width | When Full-Width |
|------------|-------|--------|-------|-----------------|
| **Primary Price/PnL** | Main performance visualization | 350px | 100% | Always |
| **Secondary Charts** | SII, Win Rate, Risk Metrics | 250px | 50% | Side-by-side |
| **Metric Sparklines** | Inline trend indicators | 30-80px | 100px-150px | Never |
| **Mini Charts** | Category performance, quick stats | 120-180px | 100% | In accordion |
| **Donut Charts** | Distribution compact | 80-120px dia | 150-200px | Never |
| **Heatmaps** | Trading calendar, concentration | 200-300px | 100% | Desktop only |
| **Bubble Charts** | Trading DNA map | 300-400px | 50-60% | Not full-width |

### Progressive Disclosure Patterns

```
┌─────────────────────────────────────┐
│ COMPACT VIEW (Default)              │
├─────────────────────────────────────┤
│ Top 3-5 items with key metrics      │
│                                     │
│ [Show All {count} Items ▼]         │
└─────────────────────────────────────┘

↓ User clicks "Show All"

┌─────────────────────────────────────┐
│ EXPANDED VIEW                        │
├─────────────────────────────────────┤
│ All items in full table             │
│ (with pagination if > 50 items)     │
│                                     │
│ [Show Less ▲]                       │
└─────────────────────────────────────┘
```

### Spacing & Layout

**Desktop (≥1024px):**
- Container max-width: 1400px
- Section spacing: 32px vertical
- Card padding: 24px
- Grid gap: 24px
- 2-3 column layouts for secondary content

**Tablet (640px-1024px):**
- Container padding: 16px
- Section spacing: 24px
- Card padding: 16px
- Grid gap: 16px
- Mostly 2-column, some single column

**Mobile (<640px):**
- Container padding: 12px
- Section spacing: 16px
- Card padding: 12px
- Grid gap: 12px
- All single column
- Aggressive content prioritization

---

## Wallet Detail Page Specification

### Page Structure

```
┌───────────────────────────────────────────────────────┐
│ HEADER BAR                                            │
│ [← Back] WhaleTrader42 (0x1a2b...) [Copy] WIS: 85    │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ HERO METRICS (Grid: 2×4 on desktop, 2×2 on mobile)   │
├──────────────┬──────────────┬──────────────┬─────────┤
│ Total PnL    │ Win Rate     │ Rank (All)   │ Active  │
│ $57,000      │ 62.8%        │ #23 / 2,547  │ 8 pos   │
│ +22.8%       │ 98W / 58L    │ Top 9%   ↑   │ $192k   │
│ [sparkline]  │ [sparkline]  │ [sparkline]  │ $12k PnL│
├──────────────┼──────────────┼──────────────┼─────────┤
│ Total        │ Sharpe       │ Avg Trade    │ Markets │
│ Invested     │ Ratio        │ Size         │ Traded  │
│ $250,000     │ 1.85         │ $1,602       │ 42      │
│ 279 days     │ Good         │ 156 trades   │ 8 active│
└──────────────┴──────────────┴──────────────┴─────────┘

┌───────────────────────────────────────────────────────┐
│ PNL PERFORMANCE (350px height, full width)            │
│ [Single line chart: Total PnL over 90 days]          │
│ • Green fill above zero, red below                    │
│ • Current: +$57k (+22.8%)                            │
│ • Breakdown: $45k realized + $12k unrealized         │
│ [▼ Show Realized vs Unrealized] (expandable)         │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ TRADING DNA (Compact: 150px height)                  │
│                                                        │
│ Style: Contrarian Value Hunter | Risk: High Conv.    │
│ ✓ Whale Splash: 212 positions                        │
│ ⚠ Bagholder: 69.9% below entry                       │
│ [View Detailed Analysis ▼]                           │
└───────────────────────────────────────────────────────┘

┌────────────────────────┬──────────────────────────────┐
│ RISK METRICS (250px)   │ PNL RANKS (250px)            │
│ [Compact grid layout]  │ [4 period cards: 1D/7D/30D/All]│
│ Sharpe: 1.85           │ All Time: #23 (Top 9%) ↑     │
│ 30d Volume: $150k      │ 30 Day: #23 (+$12.8k)        │
│ [Volume sparkline]     │ 7 Day: #28 (+$4.2k)          │
└────────────────────────┴──────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ IDENTITY BADGES & CHARACTERISTICS                     │
│                                                        │
│ [Badge] Whale Splash (212)  [Badge] Contrarian (62%) │
│ [Badge] Millionaire                                   │
│ [▼ Show 4 More Badges]                               │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ ACTIVE POSITIONS (Top 5 shown)                       │
│ ┌──────────┬─────────┬────────┬────────┬─────────┐  │
│ │ Market   │ Side    │ Entry  │ Current│ PnL     │  │
│ ├──────────┼─────────┼────────┼────────┼─────────┤  │
│ │ Trump    │ YES 63¢ │ 61¢    │ 63¢    │ +$3.0k  │  │
│ │ 2024     │         │        │        │ +3.28%  │  │
│ │ ...3 more rows...                               │  │
│ └──────────┴─────────┴────────┴────────┴─────────┘  │
│ [Show All 8 Active Positions ▼]                     │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ CATEGORY PERFORMANCE (Accordion - collapsed default) │
│ ▶ Politics (67% WR, +$28k PnL) [+]                   │
│ ▶ Crypto (58% WR, +$15k PnL) [+]                     │
│ ▶ Pop Culture (45% WR, -$5k PnL) [+]                 │
│ ▶ Tech (71% WR, +$12k PnL) [+]                       │
│ ▶ Finance (65% WR, +$7k PnL) [+]                     │
└───────────────────────────────────────────────────────┘

┌────────────────────────┬──────────────────────────────┐
│ TRADING BUBBLE MAP     │ TRADING ACTIVITY CALENDAR    │
│ (300px H, 50% width)   │ (300px H, 50% width)         │
│ [Bubble chart showing  │ [Heatmap calendar showing    │
│  entry price patterns] │  daily trading activity]     │
└────────────────────────┴──────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ FINISHED POSITIONS (Recent 10 shown)                  │
│ ┌──────────┬──────┬──────┬──────┬────────┬─────────┐│
│ │ Market   │ Side │ Entry│ Exit │ Outcome│ PnL     ││
│ ├──────────┼──────┼──────┼──────┼────────┼─────────┤│
│ │ BTC 100k │ NO   │ 30¢  │ 100¢ │ WON    │ +$21k   ││
│ │ ...9 more rows...                                 ││
│ └──────────┴──────┴──────┴──────┴────────┴─────────┘│
│ [Show All 98 Finished Positions ▼]                   │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ RECENT TRADING HISTORY (Last 10 trades)              │
│ [Compact trade list with timestamps]                 │
│ [Show All 156 Trades ▼]                              │
└───────────────────────────────────────────────────────┘
```

### Key Improvements

1. **Hero Metrics Grid**: 8 key metrics in compact 2×4 grid (desktop) vs scattered sections
2. **PnL Chart**: 350px height vs 450px, expandable breakdown vs always-visible split
3. **Trading DNA**: 150px compact summary vs 400-600px detailed view
4. **Progressive Disclosure**:
   - Active positions: 5 → 8 (instead of all 8)
   - Finished positions: 10 → 98 (instead of all 98)
   - Identity badges: 3 → 7 (instead of all 7)
5. **Side-by-side layouts**: Bubble Map + Calendar (50% each vs stacked full-width)
6. **Accordion Categories**: Collapsed by default, expand on click

---

## Market Detail Page Specification

### Page Structure

```
┌───────────────────────────────────────────────────────┐
│ HEADER BAR                                            │
│ [← Back] Will Trump win 2024? | Politics | 7 days left│
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ KEY METRICS BAR (Grid: 6 columns)                     │
├──────────┬──────────┬──────────┬──────────┬──────────┤
│ Current  │ SII      │ 24h Vol  │ Liquidity│ Signal   │
│ Price    │ Score    │          │          │          │
│ 63¢      │ 75       │ $2.4M    │ $850k    │ BUY YES  │
│ +2.4%    │ 85% conf │ +15%     │ 10 bps   │ 150 bp   │
└──────────┴──────────┴──────────┴──────────┴──────────┘

┌───────────────────────────────────────────────────────┐
│ HERO SENTIMENT SECTION (Grid: 4 columns, 180px H)    │
├─────────────┬─────────────┬─────────────┬───────────┤
│ MARKET      │ SMART MONEY │ MOMENTUM    │ SIGNAL    │
│ SENTIMENT   │ POSITION    │             │           │
│             │             │             │           │
│ YES  67%    │ 78% YES     │ ↑ +12%      │ BUY YES   │
│ [donut]     │ (high-WIS)  │ 24h price   │ 85% conf  │
│ NO   33%    │ 22% NO      │ +85% volume │ Edge:150bp│
└─────────────┴─────────────┴─────────────┴───────────┘

┌───────────────────────────────────────────────────────┐
│ POSITION ANALYSIS                                     │
│                                                        │
│ Who's Holding This Market?                            │
│ ┌──────────────┬──────────────┐                      │
│ │ YES SIDE     │ NO SIDE      │                      │
│ │ 156 holders  │ 98 holders   │                      │
│ │ +$340k PnL   │ -$165k PnL   │                      │
│ │ Avg: 58¢     │ Avg: 41¢     │                      │
│ │ 62% smart $  │ 28% smart $  │                      │
│ └──────────────┴──────────────┘                      │
│                                                        │
│ Top YES Holders (3 shown)                             │
│ 🐋 WhaleTrader42 | 12.5% | +$15k | WIS 85            │
│ 🐋 SmartInvestor  | 8.9%  | +$12.5k | WIS 91         │
│ 📊 MomentumMaster | 6.7%  | +$9.2k  | WIS 68         │
│ [Show All 156 YES Holders ▼]                         │
│                                                        │
│ Top NO Holders (3 shown)                              │
│ 📊 ContraCaptain | 10.2% | -$8.5k | WIS 72           │
│ 📊 BearishBob    | 6.8%  | -$5.2k | WIS 45           │
│ 📊 SkepticalSam  | 5.0%  | -$3.8k | WIS 52           │
│ [Show All 98 NO Holders ▼]                           │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ WHALE ACTIVITY (Recent 5 trades shown)               │
│                                                        │
│ 🟢 2 min ago: WhaleTrader42 bought 50k YES           │
│    $31.5k @ 63¢ | WIS: 85                            │
│ 🟢 47 min ago: SmartInvestor bought 35k YES          │
│    $22k @ 63¢ | WIS: 91                              │
│ ...3 more recent trades...                            │
│ [Show All Whale Trades ▼]                            │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ PRICE ANALYSIS (350px height)                        │
│                                                        │
│ Price History (7 Days) [Line] [OHLC] [Volume]       │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [Interactive YES/NO price chart]                 │ │
│ │ Current: 63¢ (YES) / 37¢ (NO)                   │ │
│ │ ↑ +2.4% (24h)                                    │ │
│ └──────────────────────────────────────────────────┘ │
│                                                        │
│ ┌──────┬──────┬──────┬──────┐                        │
│ │ 24h  │ 7d   │ High │ Low  │                        │
│ │ Vol  │ Vol  │ (7d) │ (7d) │                        │
│ │$2.4M │$15M  │ 68¢  │ 52¢  │                        │
│ └──────┴──────┴──────┴──────┘                        │
└───────────────────────────────────────────────────────┘

┌────────────────────────┬──────────────────────────────┐
│ SII TREND (250px)      │ SIGNAL BREAKDOWN (250px)     │
│ [48h line chart]       │ PSP: 68 ████████ 88% conf   │
│ Current: 75            │ Crowd: 72 ████████ 85%      │
│ Confidence: 85%        │ Momentum: 65 ██████ 82%     │
│                        │ Micro: 70 ███████ 78%       │
└────────────────────────┴──────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ ORDER BOOK & LIQUIDITY (250px)                       │
│ [Depth chart visualization]                           │
│ ┌──────────┬──────────┐                              │
│ │ Top Bids │ Top Asks │ (5 rows each)                │
│ └──────────┴──────────┘                              │
│ [Show Full Order Book ▼]                             │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ ADVANCED ANALYTICS (Accordions - collapsed default)  │
│ ▶ USD Supply by Wallet Age [+]                       │
│ ▶ Holding Duration Distribution [+]                   │
│ ▶ Whale Concentration Heatmap [+]                    │
│ ▶ PnL Distribution (Treemap) [+]                     │
│ ▶ Unusual Trades [+]                                 │
│ ▶ Smart Score Comparison [+]                         │
│ ▶ Trades Explorer [+]                                │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ RELATED MARKETS (3 compact cards)                    │
│ [Biden 2024] [Harris Nom.] [PA Swing State]         │
└───────────────────────────────────────────────────────┘
```

### Key Improvements

1. **Removed Tabs**: Single scroll vs 7 separate tabs
2. **Hero Sentiment**: 4-card grid providing instant decision context
3. **Compact Holders**: Top 3 per side vs full tables (12+ rows each)
4. **Whale Activity**: Recent 5 trades visible vs hidden in tab
5. **Price Chart**: 350px vs 450px, toggle between views vs separate tabs
6. **Side-by-side**: SII Trend + Signal Breakdown (50% each)
7. **Advanced Analytics**: Collapsed accordions vs separate tabs/sections
8. **Related Markets**: 3 compact cards at bottom vs 6 cards in overview

---

## Realistic Dummy Data Specifications

### Data Generation Principles

1. **Realistic distributions**: Follow market dynamics (70/30 YES/NO bias, not 50/50)
2. **Correlated metrics**: High WIS → better PnL, high entry price → lower current upside
3. **Temporal consistency**: Trade timestamps follow logical sequences
4. **Category patterns**: Politics has different characteristics than Crypto
5. **Whale behavior**: Large positions by high-WIS wallets

### Wallet Detail Dummy Data

#### Profile Metrics
```typescript
const generateRealisticWallet = () => ({
  wallet_address: generateEthAddress(), // 0x format
  wallet_alias: generateTraderName(), // "WhaleTrader42", "SmartInvestor", etc.
  wis: generateWIS(), // 40-95, weighted toward 60-80

  // Trading style flags (mutually exclusive logic)
  contrarian_pct: random(30, 80), // % entries below 0.5
  lottery_ticket_count: random(0, 10), // positions with <0.1 entry
  bagholder_pct: random(40, 80), // % positions below entry
  whale_splash_count: random(0, 500), // positions > $20k
  reverse_cramer_count: random(0, 5), // opposite of crowd

  // Performance (correlated with WIS)
  total_invested: random(10000, 1000000),
  realized_pnl: calculateRealisticPnL(total_invested, wis),
  unrealized_pnl: calculateUnrealizedPnL(total_invested, wis),

  // Activity
  total_trades: random(50, 500),
  win_rate: 0.4 + (wis - 50) / 100, // 40-90% based on WIS
  active_positions: random(3, 20),
  markets_traded: Math.floor(total_trades / random(3, 8)),

  // Risk
  sharpe_ratio_30d: random(0.5, 2.5),
  largest_win: random(2000, 50000),
  largest_loss: random(-1000, -20000),
})
```

#### Active Positions (8-15 positions)
```typescript
const generateActivePosition = (marketCategory: string) => ({
  market_id: generateMarketId(category),
  market_title: generateMarketTitle(category),
  category: category, // Politics, Crypto, Tech, Finance, Pop Culture
  side: weightedRandom(['YES', 'NO'], [0.65, 0.35]), // 65% YES bias
  shares: random(10000, 200000),
  avg_entry_price: random(0.15, 0.85),
  current_price: calculateCurrentPrice(avg_entry_price),
  invested: shares * avg_entry_price,
  unrealized_pnl: (current_price - avg_entry_price) * shares,
  market_end_date: futureDate(1, 365), // 1-365 days from now
})
```

#### Finished Positions (50-150 positions)
```typescript
const generateFinishedPosition = (category: string, winRate: number) => {
  const won = random() < winRate
  const side = weightedRandom(['YES', 'NO'], [0.65, 0.35])
  const entry = random(0.15, 0.85)

  return {
    market_id: generateMarketId(category),
    market_title: generateMarketTitle(category),
    category: category,
    side: side,
    avg_entry_price: entry,
    exit_price: won ? (side === 'YES' ? 1.0 : 0.0) : (side === 'YES' ? 0.0 : 1.0),
    invested: random(1000, 50000),
    realized_pnl: won ? invested * random(0.2, 3.0) : -invested,
    market_outcome: won ? side : (side === 'YES' ? 'NO' : 'YES'),
    closed_date: pastDate(1, 365),
  }
}
```

#### Category Statistics
```typescript
const generateCategoryStats = (category: string, trades: FinishedBet[]) => {
  const categoryTrades = trades.filter(t => t.category === category)
  const won = categoryTrades.filter(t => t.realized_pnl > 0)

  return {
    category: category,
    total_trades: categoryTrades.length,
    winning_trades: won.length,
    win_rate: won.length / categoryTrades.length,
    total_pnl: sum(categoryTrades.map(t => t.realized_pnl)),
    avg_trade_size: average(categoryTrades.map(t => t.invested)),
    roi: sum(categoryTrades.map(t => t.realized_pnl_pct)) / categoryTrades.length,
  }
}
```

### Market Detail Dummy Data

#### Market Profile
```typescript
const generateRealisticMarket = (category: string) => ({
  market_id: generateMarketId(category),
  title: generateMarketTitle(category),
  description: generateMarketDescription(category), // 1-3 sentences
  category: category,

  // Current state
  current_price: random(0.30, 0.80), // weighted toward 0.5-0.7
  bid: current_price - random(0.001, 0.005),
  ask: current_price + random(0.001, 0.005),
  spread_bps: random(5, 20),

  // Volume & Liquidity (correlated)
  volume_24h: random(100000, 5000000),
  volume_total: volume_24h * random(15, 60),
  liquidity_usd: volume_24h * random(0.2, 0.6),

  // Timing
  end_date: futureDate(1, 180),
  hours_to_close: calculateHoursToClose(end_date),

  // Signals (correlated with smart money)
  sii: random(40, 90),
  momentum: random(30, 95),
  signal_confidence: 0.75 + random(0, 0.20),
  signal_recommendation: determinSignal(sii, momentum),
  edge_bp: random(50, 200),
})
```

#### Holders (50-250 per side)
```typescript
const generateHolder = (side: 'YES' | 'NO', marketPrice: number) => {
  const wis = random(40, 95)
  const entry = side === 'YES'
    ? random(0.30, marketPrice + 0.10)
    : random(marketPrice - 0.10, 0.70)

  const position = random(1000, 200000)
  const currentValue = position * marketPrice
  const invested = position * entry
  const unrealizedPnL = currentValue - invested

  return {
    wallet_address: generateEthAddress(),
    wallet_alias: generateTraderName(),
    position_usd: invested,
    pnl_total: unrealizedPnL + random(-2000, 5000), // add some realized
    supply_pct: random(0.1, 15.0),
    avg_entry: entry,
    realized_pnl: random(-1000, 3000),
    unrealized_pnl: unrealizedPnL,
    smart_score: wis,
    last_action_time: recentDate(0, 48), // within last 48 hours
  }
}
```

#### Whale Trades (10-50 recent)
```typescript
const generateWhaleTrade = (marketPrice: number) => {
  const side = weightedRandom(['YES', 'NO'], [0.70, 0.30]) // 70% YES
  const action = weightedRandom(['BUY', 'SELL'], [0.85, 0.15]) // 85% BUY

  return {
    trade_id: generateId(),
    timestamp: recentDate(0, 72), // last 3 days
    wallet_address: generateEthAddress(),
    wallet_alias: generateTraderName(),
    wis: random(65, 95), // whales tend to be smart
    side: side,
    action: action,
    shares: random(20000, 100000), // whale-sized
    amount_usd: shares * marketPrice,
    price: marketPrice + random(-0.02, 0.02),
  }
}
```

#### Price History (168 points for 7 days hourly)
```typescript
const generatePriceHistory = (currentPrice: number, days: number) => {
  const points = days * 24 // hourly
  let price = currentPrice - random(0.05, 0.15) // start lower

  return Array.from({ length: points }, (_, i) => {
    // Trend upward with noise
    price += random(-0.01, 0.015)
    price = Math.max(0.1, Math.min(0.9, price)) // bounds

    return {
      timestamp: new Date(Date.now() - (points - i) * 3600000).toISOString(),
      price: price,
      volume: random(5000, 30000),
    }
  })
}
```

### Data Realism Checklist

- [ ] WIS scores follow normal distribution (mean ~65, std ~15)
- [ ] High WIS correlates with better PnL (+0.3 to +0.5 correlation)
- [ ] Win rates range 40-75% (not unrealistic 90%+)
- [ ] Position sizes follow power law (few whales, many small traders)
- [ ] Entry prices cluster around psychological levels (0.5, 0.7, 0.3)
- [ ] Trade timestamps follow realistic patterns (more during market hours)
- [ ] Category characteristics differ (Politics more contrarian than Crypto)
- [ ] Market prices don't jump unrealistically (max 2-3% per hour)
- [ ] Holder PnL distribution: 60-70% winners, 30-40% losers
- [ ] Smart money (WIS 80+) holds 40-60% of total supply

---

## Implementation Roadmap

### Sprint 1 (6 Days) - Core Redesign

#### Day 1-2: Component Infrastructure
**Tasks:**
- Create shared UI components (MetricCard, Sparkline, CollapsibleSection, TruncatedText)
- Set up design tokens (spacing, colors, chart heights)
- Implement progressive disclosure hooks
- Create realistic data generators

**Deliverables:**
- `components/ui/metric-card.tsx`
- `components/ui/sparkline.tsx`
- `components/ui/collapsible-section.tsx`
- `lib/generate-realistic-data.ts`

#### Day 3-4: Wallet Detail Redesign
**Tasks:**
- Refactor main Wallet Detail component
- Implement hero metrics grid
- Create compact Trading DNA component
- Implement PnL Ranks card
- Add progressive disclosure to tables
- Reduce chart heights
- Create category accordion

**Deliverables:**
- Refactored `/components/wallet-detail-interface/index.tsx`
- New components in `/components/wallet-detail-interface/components/`
- Updated mock data with realistic generators

#### Day 5-6: Market Detail Redesign
**Tasks:**
- Remove tab navigation
- Create hero sentiment section
- Implement compact holders summary
- Build whale activity feed
- Reduce price chart height
- Create side-by-side layouts (SII + Signal)
- Implement advanced analytics accordions
- Compact related markets section

**Deliverables:**
- Refactored `/components/market-detail-interface/index.tsx`
- New components in `/components/market-detail-interface/components/`
- Updated mock data with realistic generators

### Sprint 2 (Optional 6 Days) - Polish & Advanced Features

#### Day 7-8: Hashdive Chart Types
**Tasks:**
- Implement donut charts for distributions
- Create heatmap components (trading calendar, whale concentration)
- Build treemap for PnL distribution
- Add bubble chart enhancements

**Deliverables:**
- Hashdive-style chart components
- Chart configuration utilities

#### Day 9-10: Responsive & Accessibility
**Tasks:**
- Mobile layout optimizations
- Touch-friendly interactions
- ARIA labels and keyboard navigation
- Focus management for expandable sections
- Screen reader testing

**Deliverables:**
- Responsive CSS refinements
- Accessibility audit report
- Keyboard shortcuts documentation

#### Day 11-12: Performance & Testing
**Tasks:**
- Lazy loading for below-fold content
- Chart rendering optimizations
- Loading states and skeleton screens
- Unit tests for new components
- E2E tests for progressive disclosure
- Visual regression tests

**Deliverables:**
- Performance optimization report
- Test coverage reports
- Final documentation

---

## Success Criteria

### Quantitative Metrics

**Wallet Detail Page:**
- [ ] Scroll depth reduced by ≥60% (from 12,000px)
- [ ] Above-fold metrics display ≥8 key stats
- [ ] Time to view all categories ≤15 seconds (vs 60+ seconds)
- [ ] Progressive disclosure reduces initial table rows by ≥80%
- [ ] Trading DNA height ≤200px (vs 400-600px)

**Market Detail Page:**
- [ ] Scroll depth reduced by ≥50% (from 8,000px)
- [ ] Hero section displays ≥4 decision metrics above fold
- [ ] Holders tables show ≤6 rows by default (3 per side)
- [ ] Related markets section ≤300px height (vs 600px+)
- [ ] All charts fit within specified height limits

**Both Pages:**
- [ ] Mobile scroll depth ≤2 screen heights to key content
- [ ] Lighthouse accessibility score ≥90
- [ ] No full-width charts except primary price/PnL
- [ ] All "Show more" interactions functional
- [ ] Realistic dummy data passes realism checklist

### Qualitative Metrics

**User Experience:**
- [ ] Page feels scannable within 5 seconds
- [ ] Visual hierarchy clearly prioritizes important information
- [ ] Progressive disclosure feels natural and unintrusive
- [ ] Chart sizes feel balanced (not overwhelming)
- [ ] Trading DNA is informative but doesn't dominate
- [ ] Related content feels relevant, not distracting

**Design Quality:**
- [ ] Consistent spacing and alignment
- [ ] Color usage follows Hashdive patterns (blue YES, yellow NO, green profit, red loss)
- [ ] Typography hierarchy clear
- [ ] Loading states smooth and non-jarring
- [ ] Mobile layouts feel native, not cramped

---

## Risks & Mitigation

### Risk 1: Over-Truncation
**Risk:** Users might miss important information if too much is hidden
**Mitigation:**
- User testing to validate default vs expanded views
- Analytics tracking "Show more" click rates (should be 20-40%)
- Clear indicators of hidden content

### Risk 2: Chart Size Too Small
**Risk:** Compact charts might lose readability
**Mitigation:**
- Maintain minimum 250px height for secondary charts
- Ensure touch targets ≥44px for mobile
- Test with real data patterns
- Allow chart expansion via modal/fullscreen

### Risk 3: Mobile Performance
**Risk:** Reduced space on mobile might make pages harder to use
**Mitigation:**
- Mobile-first design process
- Aggressive content prioritization for mobile
- Swipe gestures for table navigation
- Bottom sheet modals for expanded content

### Risk 4: Data Realism
**Risk:** Dummy data might not reflect actual market patterns
**Mitigation:**
- Research actual Polymarket/Kalshi data distributions
- Validate with domain experts
- Use statistical distributions (normal, power law)
- Document data generation assumptions

### Risk 5: Component Reusability
**Risk:** Too many one-off components, hard to maintain
**Mitigation:**
- Design system approach with shared components
- Document component API clearly
- Create Storybook stories for all components
- Regular refactoring sprints

---

## Testing Strategy

### Unit Tests
- [ ] MetricCard component renders correctly
- [ ] Sparkline generates accurate SVG paths
- [ ] CollapsibleSection expand/collapse logic
- [ ] TruncatedText truncation at correct character count
- [ ] Data generators produce valid outputs

### Integration Tests
- [ ] Progressive disclosure updates URL state
- [ ] Chart data transforms correctly
- [ ] Responsive layouts switch at breakpoints
- [ ] Keyboard navigation flows logically

### E2E Tests
**Wallet Detail:**
- [ ] Load page → verify hero metrics visible
- [ ] Click "Show All Active Positions" → table expands
- [ ] Click category accordion → chart expands
- [ ] Scroll to Trading DNA → compact view shown
- [ ] Click "View Detailed Analysis" → full breakdown appears

**Market Detail:**
- [ ] Load page → verify hero sentiment cards
- [ ] Click "Show All YES Holders" → full table appears
- [ ] Toggle price chart view → OHLC appears
- [ ] Click advanced analytics accordion → chart loads
- [ ] Mobile: swipe holder table → scrolls horizontally

### Visual Regression Tests
- [ ] Snapshot hero metrics section (desktop)
- [ ] Snapshot compact Trading DNA (desktop)
- [ ] Snapshot holders summary (desktop)
- [ ] Snapshot hero sentiment (mobile)
- [ ] Snapshot progressive disclosure states

### Accessibility Tests
- [ ] Keyboard-only navigation complete
- [ ] Screen reader announces expandable states
- [ ] ARIA labels present on all interactive elements
- [ ] Color contrast meets WCAG AA
- [ ] Focus indicators visible

---

## Documentation Requirements

### Developer Documentation
- [ ] Component API documentation (props, types)
- [ ] Chart configuration guide
- [ ] Progressive disclosure patterns guide
- [ ] Responsive breakpoint strategy
- [ ] Data generation utilities guide

### Design Documentation
- [ ] Design tokens reference
- [ ] Chart sizing standards
- [ ] Color palette usage
- [ ] Typography scale
- [ ] Spacing system

### User Documentation
- [ ] Feature announcement (what changed)
- [ ] Interactive tutorial for new layout
- [ ] FAQ for progressive disclosure
- [ ] Mobile tips and tricks

---

## Appendix A: Hashdive Reference Implementation

### Chart Types Mapping

| Hashdive Chart | CASCADIAN Usage | Component Path | Height |
|----------------|-----------------|----------------|--------|
| Metric Cards with Sparklines | Hero metrics, quick stats | `/ui/metric-card.tsx` | 100-120px |
| Price Line Chart (YES/NO) | Market price history | Market detail primary | 350px |
| PnL Line Chart | Wallet performance | Wallet detail primary | 350px |
| Donut Charts | Ownership distribution, sentiment | Market detail hero | 100-150px |
| Heatmap Calendar | Trading activity | Wallet detail calendar | 250-300px |
| Treemap | PnL distribution by holder | Advanced analytics | 300-400px |
| Bubble Chart | Trading DNA, entry patterns | Wallet detail | 300px (50% width) |
| Bar/Histogram | Volume by price bucket | Advanced analytics | 250px |
| Scatter Plot | Entry price vs smart score | Advanced analytics | 300px |
| OHLC Candlestick | Price action detail | Market detail (toggle) | 350px |
| Depth Chart | Order book visualization | Market detail order book | 250px |
| Stacked Area | Holding duration | Advanced analytics | 300px |
| Density Curves | Score distribution | Advanced analytics | 250px |

### Layout Patterns

**Hashdive Pattern:** Metric Cards Row
```
┌────────┬────────┬────────┬────────┐
│ Metric │ Metric │ Metric │ Metric │ 100-120px height
│ Value  │ Value  │ Value  │ Value  │ Sparkline inside
│ [---]  │ [---]  │ [---]  │ [---]  │
└────────┴────────┴────────┴────────┘
```
**CASCADIAN Implementation:** Hero Metrics Grid (2×4)

**Hashdive Pattern:** Side-by-Side Charts
```
┌─────────────────┬─────────────────┐
│ Chart 1         │ Chart 2         │ 250-300px height
│ (50% width)     │ (50% width)     │ Equal widths
└─────────────────┴─────────────────┘
```
**CASCADIAN Implementation:** SII Trend + Signal Breakdown, Risk Metrics + PnL Ranks

**Hashdive Pattern:** Compact Summary → Full Table
```
┌───────────────────────────────────┐
│ Summary Stats                     │ 60-80px
│ Avg: X | Total: Y | Count: Z     │
├───────────────────────────────────┤
│ Top 3 Items (compact)             │ 100-120px
│ [Show All N Items ▼]             │
└───────────────────────────────────┘
```
**CASCADIAN Implementation:** Holders Summary + Top 3 Preview

---

## Appendix B: Component Code Examples

### MetricCard Component

```tsx
// components/ui/metric-card.tsx
import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon?: ReactNode;
  sparklineData?: number[];
  className?: string;
}

export function MetricCard({
  label,
  value,
  change,
  changeType = 'neutral',
  icon,
  sparklineData,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-sm text-muted-foreground">{label}</div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>

      <div className="text-2xl font-bold mb-1">{value}</div>

      {change && (
        <div className={cn(
          'text-xs font-medium',
          changeType === 'positive' && 'text-green-600',
          changeType === 'negative' && 'text-red-600',
          changeType === 'neutral' && 'text-muted-foreground'
        )}>
          {change}
        </div>
      )}

      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-2">
          <Sparkline data={sparklineData} height={30} />
        </div>
      )}
    </Card>
  );
}
```

### Sparkline Component

```tsx
// components/ui/sparkline.tsx
interface SparklineProps {
  data: number[];
  height?: number;
  className?: string;
  color?: string;
}

export function Sparkline({
  data,
  height = 30,
  className = '',
  color = 'currentColor'
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = ((max - value) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ height: `${height}px`, width: '100%' }}
      className={className}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}
```

### CollapsibleSection Component

```tsx
// components/ui/collapsible-section.tsx
import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CollapsibleSectionProps {
  title: string;
  defaultExpanded?: boolean;
  children: ReactNode;
  showCount?: number;
  compactView?: ReactNode;
}

export function CollapsibleSection({
  title,
  defaultExpanded = false,
  children,
  showCount,
  compactView,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>

      {!isExpanded && compactView && (
        <div className="mb-3">{compactView}</div>
      )}

      {isExpanded && (
        <div className="mb-3">{children}</div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-4 w-4 mr-2" />
            Show Less
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4 mr-2" />
            Show All {showCount && `(${showCount})`}
          </>
        )}
      </Button>
    </div>
  );
}
```

### TruncatedTable Component

```tsx
// components/ui/truncated-table.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table } from '@/components/ui/table';

interface TruncatedTableProps<T> {
  data: T[];
  initialRows?: number;
  renderRow: (item: T, index: number) => ReactNode;
  renderHeader: () => ReactNode;
  emptyMessage?: string;
}

export function TruncatedTable<T>({
  data,
  initialRows = 5,
  renderRow,
  renderHeader,
  emptyMessage = 'No data available',
}: TruncatedTableProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayData = isExpanded ? data : data.slice(0, initialRows);
  const hasMore = data.length > initialRows;

  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      <Table>
        {renderHeader()}
        <tbody>
          {displayData.map((item, index) => renderRow(item, index))}
        </tbody>
      </Table>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full mt-2"
        >
          {isExpanded
            ? 'Show Less'
            : `Show All ${data.length} Items`}
        </Button>
      )}
    </div>
  );
}
```

---

## Appendix C: Design Tokens

### Spacing Scale
```typescript
export const spacing = {
  xs: '4px',   // Inline elements
  sm: '8px',   // Compact spacing
  md: '12px',  // Default mobile
  lg: '16px',  // Default tablet
  xl: '24px',  // Default desktop
  '2xl': '32px', // Section spacing
  '3xl': '48px', // Major sections
};
```

### Chart Heights
```typescript
export const chartHeights = {
  sparkline: '30px',
  mini: '80px',
  compact: '120px',
  small: '180px',
  medium: '250px',
  large: '350px',
  full: '450px',
};
```

### Colors (Hashdive-inspired)
```typescript
export const marketColors = {
  yes: '#3b82f6',      // Blue
  no: '#f59e0b',       // Amber/Yellow
  profit: '#10b981',   // Green
  loss: '#ef4444',     // Red
  neutral: '#6b7280',  // Gray
  smartMoney: '#8b5cf6', // Purple
};
```

### Typography Scale
```typescript
export const typography = {
  metricValue: 'text-2xl font-bold',
  metricLabel: 'text-sm text-muted-foreground',
  sectionHeader: 'text-xl font-semibold',
  cardHeader: 'text-lg font-semibold',
  bodyText: 'text-base',
  caption: 'text-xs text-muted-foreground',
};
```

---

## Conclusion

This specification provides a comprehensive roadmap for overhauling the Wallet Detail and Market Detail pages. By implementing progressive disclosure, compact layouts, and Hashdive-inspired chart patterns, we will dramatically improve page digestibility while maintaining information completeness.

The redesign prioritizes quick decision-making (above-fold hero metrics) while enabling deep analysis (expandable detailed sections). Realistic dummy data ensures the design can be fully tested and refined before real data integration.

Implementation can be completed in a single 6-day sprint for core features, with an optional second sprint for advanced analytics and polish.
