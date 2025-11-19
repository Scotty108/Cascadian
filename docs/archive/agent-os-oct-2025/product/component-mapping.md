# CASCADIAN Component Mapping
**Detailed Component Migration Strategy for V1**

## Purpose

This document provides a granular component-by-component mapping from the existing crypto trading template to CASCADIAN's prediction market platform, based on the V1 PRD.

**Related Documents:**
- `template-audit.md` - High-level translation strategy
- `hub-specifications.md` - Detailed UI/UX specifications for new hubs
- `technical-design.md` - Backend architecture and data models

---

## Migration Strategy: 3-Phase Approach

### Phase 1: Archive Crypto Components
**Action:** Move crypto-specific components to `/components/_archive/` directory
- Preserves code for reference
- Removes from production bundle
- Cleans up codebase

### Phase 2: Repurpose Reusable Components
**Action:** Fork and modify components with reusable UI patterns
- Keep layouts, table structures, chart configurations
- Replace data models and API calls
- Update labels, copy, and visual styles

### Phase 3: Build New Components
**Action:** Create net-new components for prediction market features
- Market Detail drill-down
- Wallet Detail drill-down
- PnL Leaderboard
- SII-based Market Map
- 18-node Strategy Builder palette

---

## Component Mapping Table

### 🗄️ ARCHIVE - Crypto Bot Components (7 modules)

| Component | Location | Action | Reason |
|-----------|----------|--------|--------|
| `ai-bot-dashboard` | `/components/ai-bot-dashboard/` | **ARCHIVE** | Crypto-specific, no prediction market equivalent |
| `arbitrage-bot-dashboard` | `/components/arbitrage-bot-dashboard/` | **ARCHIVE** | Arbitrage trading irrelevant to predictions |
| `dca-bot-dashboard` | `/components/dca-bot-dashboard/` | **ARCHIVE** | DCA strategy irrelevant to predictions |
| `signal-bot-dashboard` | `/components/signal-bot-dashboard/` | **ARCHIVE** | Technical indicators for crypto only |
| `bot-templates-interface` | `/components/bot-templates-interface/` | **ARCHIVE** | Crypto bot templates, replaced by strategy library |
| `bot-settings-dashboard` | `/components/bot-settings-dashboard/` | **ARCHIVE** | Crypto-specific settings |
| `execution-logs-dashboard` | `/components/execution-logs-dashboard/` | **REPURPOSE** → See Phase 2 |

**Archive Command:**
```bash
mkdir -p components/_archive/crypto-bots
mv components/{ai-bot,arbitrage-bot,dca-bot,signal-bot,bot-templates,bot-settings}-* components/_archive/crypto-bots/
```

---

### 🗄️ ARCHIVE - DeFi Components (5 modules)

| Component | Location | Action | Reason |
|-----------|----------|--------|--------|
| `defi-protocols-interface` | `/components/defi-protocols-interface/` | **ARCHIVE** | DeFi protocols irrelevant to prediction markets |
| `yield-farming-interface` | `/components/yield-farming-interface/` | **ARCHIVE** | Yield farming not in V1 scope |
| `staking-pools-interface` | `/components/staking-pools-interface/` | **ARCHIVE** | Staking not in V1 scope |
| `liquidity-tracker-interface` | `/components/liquidity-tracker-interface/` | **ARCHIVE** | DeFi liquidity tracking irrelevant |

**Archive Command:**
```bash
mkdir -p components/_archive/defi
mv components/{defi-protocols,yield-farming,staking-pools,liquidity-tracker}-* components/_archive/defi/
```

---

## 🔄 REPURPOSE - Crypto → Prediction Market Components

### 1. Dashboard Content
**Component:** `dashboard-content/`

**Current Usage:** Crypto portfolio overview with bot status cards

**CASCADIAN V1 Translation:**
- **New Name:** `dashboard-content/` (keep name, replace content)
- **New Purpose:** Overview of prediction market activity
- **Keep:** Card layouts, grid structure, KPI displays
- **Replace:**
  - Crypto asset balances → Active position count, total invested
  - Bot status cards → Active strategy status cards
  - Token price charts → SII trend chart, recent market activity

**Implementation Notes:**
```typescript
// OLD: Crypto dashboard
<KPICard title="Portfolio Value" value={totalUSD} />
<BotStatusGrid bots={activeBots} />

// NEW: Prediction market dashboard
<KPICard title="Total Invested" value={totalInvested} />
<KPICard title="Realized PnL" value={realizedPnL} />
<StrategyStatusGrid strategies={activeStrategies} />
<RecentMarketsTable markets={recentMarkets} />
```

---

### 2. Pump Screener → Market Screener
**Component:** `pump-screener-interface/`

**Current Usage:** Token price screener with pump detection

**CASCADIAN V1 Translation:**
- **New Name:** `market-screener-interface/`
- **New Purpose:** Discovery Hub - Market Screener (Section 1.1 of hub-specifications.md)
- **Keep:**
  - PrimeVue DataTable structure (sorting, filtering, virtual scrolling)
  - Search bar
  - Category filters
  - Column configuration pattern
- **Replace:**
  - Token columns → Market columns (15 SII-focused columns)
  - Price alerts → SII/Momentum alerts
  - Pump detection → High SII market detection

**New Columns (from hub-specifications.md Section 1.1):**
1. Market (title, links to detail)
2. Outcome (YES/NO)
3. SII (-100 to +100)
4. Last Price (0-1)
5. Momentum (0-100)
6. Volume ($)
7. # Trades
8. # Buyers
9. # Sellers
10. B/S Ratio
11. Volatility (σ)
12. Spread (bps)
13. Liquidity ($)
14. Category
15. Flag (rigged score)

**File Changes:**
```bash
# Rename component
mv components/pump-screener-interface components/market-screener-interface

# Update files inside
# - components/tabs/screener-tab.tsx → Replace with 15-column table
# - types.ts → Replace PumpToken with MarketScreenerRow
# - hooks/use-pump-data.ts → hooks/use-market-data.ts
```

---

### 3. Portfolio Tracker → Position Tracker
**Component:** `portfolio-tracker-interface/`

**Current Usage:** Crypto portfolio tracker with asset breakdown

**CASCADIAN V1 Translation:**
- **New Name:** `position-tracker-interface/`
- **New Purpose:** My Positions - Track all prediction market positions
- **Keep:**
  - Tab structure (Overview, Holdings, History)
  - Donut chart for distribution
  - Table for detailed view
  - Performance metrics cards
- **Replace:**
  - Crypto assets → Prediction positions
  - Token distribution → Position distribution (by category or market)
  - Buy/sell history → Bet history

**New Tabs:**
1. **Overview**: Total invested, realized PnL, ROI, win rate
2. **Active Positions**: Open positions with unrealized PnL
3. **Closed Positions**: Historical positions with realized PnL
4. **Performance**: Win rate by category, ROI trends

**Data Model Changes:**
```typescript
// OLD: Portfolio
interface CryptoAsset {
  symbol: string
  balance: number
  valueUSD: number
  chain: string
}

// NEW: Position
interface PredictionPosition {
  market_id: string
  market_title: string
  outcome: 'YES' | 'NO'
  shares: number
  avg_entry_price: number
  current_price: number
  invested: number
  current_value: number
  unrealized_pnl: number
  realized_pnl?: number
  status: 'OPEN' | 'CLOSED'
}
```

---

### 4. Wallets Interface → Trader Explorer
**Component:** `wallets-interface/`

**Current Usage:** Crypto wallet management (connect, view balances)

**CASCADIAN V1 Translation:**
- **New Name:** `trader-explorer-interface/`
- **New Purpose:** Traders Hub - Trader Explorer (Section 2.1 of hub-specifications.md)
- **Keep:**
  - Table structure with filtering/sorting
  - Address display with truncation
  - Badge/tag system for categories
- **Replace:**
  - Wallet balances → Trader performance metrics
  - Connected wallets → Smart wallets ranked by WIS
  - Balance chart → Win rate chart

**New Columns (from hub-specifications.md Section 2.1):**
1. Wallet Address (link to detail)
2. WIS (-100 to +100)
3. Total PnL
4. Volume
5. Win Rate
6. Omega Ratio
7. Sharpe Ratio
8. Trades Count
9. Avg Trade Size
10. **Contrarian %** (NEW - critical addition)
11. **Contrarian WR** (NEW - critical addition)
12. Specialty (badges for categories)
13. Active Positions
14. Last Trade

---

### 5. My Assets → My Positions
**Component:** `my-assets/`

**Current Usage:** Personal crypto holdings summary

**CASCADIAN V1 Translation:**
- **New Name:** `my-positions/` (or keep as `my-assets/`)
- **New Purpose:** User's active prediction market positions
- **Keep:**
  - Card-based layout
  - Overview metrics
  - Asset list with actions
- **Replace:**
  - Token balances → Position details
  - Send/Receive buttons → Close Position / Add to Position

**New Overview Metrics:**
- Total Invested: $X
- Unrealized PnL: $X (+X%)
- Active Positions: X markets
- Win Rate (Closed): X%

---

### 6. My Analytics → My Performance
**Component:** `my-analytics/`

**Current Usage:** Crypto trading analytics (P&L, trades, volume)

**CASCADIAN V1 Translation:**
- **New Name:** `my-performance/`
- **New Purpose:** Personal prediction market performance analytics
- **Keep:**
  - ECharts visualizations (line, bar, pie charts)
  - Time range selectors (24h, 7d, 30d, All)
  - KPI cards at top
- **Replace:**
  - Crypto trade analytics → Prediction bet analytics
  - Token P&L → Market P&L by category
  - Volume chart → Bet volume over time

**New Charts:**
1. **Cumulative PnL Over Time** (line chart)
2. **Win Rate by Category** (bar chart)
3. **ROI Distribution** (histogram)
4. **Bet Size Distribution** (pie chart)

---

### 7. Trading Interface → Manual Betting
**Component:** `trading-interface/`

**Current Usage:** Manual crypto trading (buy/sell tokens)

**CASCADIAN V1 Translation:**
- **New Name:** `betting-interface/` or `manual-trading/`
- **New Purpose:** Manually place prediction market bets
- **Keep:**
  - Two-panel layout (market selection + order form)
  - Order type selectors
  - Confirmation modals
- **Replace:**
  - Token pairs → Market selection
  - Buy/Sell → YES/NO
  - Limit/Market orders → Shares + Price entry

**New Order Form:**
```typescript
interface BetOrder {
  market_id: string
  outcome: 'YES' | 'NO'
  shares: number           // # of shares to buy
  max_price: number       // Max price willing to pay (0-1)
  strategy_id?: string    // Optional: associate with strategy
}
```

---

### 8. Overview Dashboard → Strategy Overview
**Component:** `overview-dashboard/`

**Current Usage:** Control panel for bots (overview, settings, logs)

**CASCADIAN V1 Translation:**
- **New Name:** `strategy-overview/`
- **New Purpose:** Automate Hub - Strategy overview and management
- **Keep:**
  - Tab navigation (Overview, Settings, Logs)
  - Start/Stop controls
  - Performance metrics cards
  - Execution logs table
- **Replace:**
  - Bot execution data → Strategy execution data
  - Crypto trades → Prediction bets
  - Bot settings → Strategy settings (risk limits, category filters)

**New Tabs:**
1. **Overview**: Strategy status, active positions, P&L
2. **Settings**: Max bet size, category filters, WIS thresholds
3. **Logs**: Execution history (node-by-node execution trace)

---

### 9. Execution Logs → Strategy Execution Logs
**Component:** `execution-logs-dashboard/`

**Current Usage:** Bot execution logs with timestamps and outcomes

**CASCADIAN V1 Translation:**
- **New Name:** `strategy-execution-logs/`
- **New Purpose:** Detailed execution logs for strategy runs
- **Keep:**
  - Table structure
  - Timestamp display
  - Status badges (success, error, warning)
  - Expandable rows for details
- **Replace:**
  - Bot actions → Strategy node executions
  - Trade logs → Bet placement logs

**New Log Entry:**
```typescript
interface StrategyExecutionLog {
  execution_id: string
  strategy_id: string
  timestamp: Date
  node_name: string        // Which node executed
  action: string           // "Fetched market data", "Placed bet", etc.
  status: 'success' | 'error' | 'warning'
  details: Record<string, any>  // Node-specific output
  next_node?: string       // Next node in workflow
}
```

---

## ✅ KEEP AS-IS - Reusable Components

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| `settings-interface` | `/components/settings-interface/` | **KEEP** | User settings (profile, API keys, notifications) |
| `subscription-interface` | `/components/subscription-interface/` | **KEEP** | Billing & subscription management |
| `help-center-interface` | `/components/help-center-interface/` | **KEEP** | Documentation & support (update content) |
| `invite-friends-interface` | `/components/invite-friends-interface/` | **KEEP** | Referral program |
| `strategies-marketplace-interface` | `/components/strategies-marketplace-interface/` | **KEEP CONCEPT** | Adapt to prediction market strategies |
| `strategy-library` | `/components/strategy-library/` | **KEEP** | Replace templates with prediction market strategies |
| `ui/` | `/components/ui/` | **KEEP ALL** | 40+ shadcn/ui primitives (fully reusable) |
| `theme-provider.tsx` | `/components/theme-provider.tsx` | **KEEP** | Dark/light theme support |
| `theme-switcher.tsx` | `/components/theme-switcher.tsx` | **KEEP** | Theme toggle UI |
| `dashboardSidebar.tsx` | `/components/dashboardSidebar.tsx` | **MODIFY** | Update navigation links for new routes |
| `topbar.tsx` | `/components/topbar.tsx` | **KEEP** | Top navigation bar |
| `search-bar.tsx` | `/components/search-bar.tsx` | **MODIFY** | Search markets instead of tokens |

---

## 🆕 BUILD FROM SCRATCH - New Components

### 1. Market Detail Drill-Down
**Component:** `market-detail/` (NEW)

**Purpose:** Analysis Hub - Market Detail (Section 3.1 of hub-specifications.md)

**Sections:**
1. Header with key metrics (SII, momentum, volume, liquidity)
2. Price history chart (ECharts line)
3. SII over time chart (ECharts dual-axis)
4. Smart money positions table
5. Order book display
6. Recent activity feed

**Location:** `/components/market-detail/`

**Files:**
```
market-detail/
├── index.tsx                    # Main component
├── components/
│   ├── market-header.tsx        # Title, description, badges, price
│   ├── price-chart.tsx          # ECharts price history
│   ├── sii-chart.tsx            # ECharts SII trend
│   ├── smart-money-table.tsx   # PrimeVue DataTable
│   ├── order-book.tsx          # Bids/asks display
│   └── recent-activity.tsx     # Trade feed
├── hooks/
│   └── use-market-detail.ts    # API hook
└── types.ts                     # MarketDetail interface
```

**Critical Note:** On-demand signals (`is_rigged`, `is_googleable`) should only render when present:
```typescript
{(market.is_rigged !== undefined || market.is_googleable !== undefined) && (
  <div className="mt-4 flex gap-4">
    {market.is_rigged !== undefined && (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Rigged:</span>
        {market.is_rigged ? <Badge variant="destructive">🚩 Flagged</Badge> : <Badge variant="secondary">✓ Clean</Badge>}
      </div>
    )}
  </div>
)}
```

---

### 2. Wallet Detail Drill-Down
**Component:** `wallet-detail/` (NEW)

**Purpose:** Analysis Hub - Wallet Detail (Section 3.2 of hub-specifications.md)

**Sections:**
1. **Header with 6 key metrics** (WIS, Total PnL, Win Rate, **Contrarian Score**, **Contrarian WR**, Omega Ratio)
2. Specialty breakdown (pie + bar charts)
3. PnL over time (line chart)
4. Active positions table
5. Trade history table
6. Contrarian trades table

**Location:** `/components/wallet-detail/`

**Files:**
```
wallet-detail/
├── index.tsx                      # Main component
├── components/
│   ├── wallet-header.tsx          # Address, ENS, 6 metric cards
│   ├── specialty-charts.tsx       # Pie + bar for category breakdown
│   ├── pnl-chart.tsx              # ECharts cumulative PnL
│   ├── active-positions-table.tsx # Current positions
│   ├── trade-history-table.tsx    # All trades
│   └── contrarian-trades.tsx      # Contrarian bets
├── hooks/
│   └── use-wallet-detail.ts       # API hook
└── types.ts                        # WalletDetail interface
```

**Critical Addition - Contrarian Cards:**
```typescript
<div className="grid grid-cols-6 gap-4">
  <div className="text-center p-4 bg-blue-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">WIS</div>
    <div className="text-3xl font-bold text-blue-600">{wallet.wis}</div>
  </div>
  <div className="text-center p-4 bg-green-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">Total PnL</div>
    <div className={`text-3xl font-bold ${wallet.totalPnL > 0 ? 'text-green-600' : 'text-red-600'}`}>
      {wallet.totalPnL > 0 ? '+' : ''}${(wallet.totalPnL / 1000).toFixed(1)}k
    </div>
  </div>
  <div className="text-center p-4 bg-gray-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">Win Rate</div>
    <div className="text-3xl font-bold">{wallet.winRate.toFixed(1)}%</div>
  </div>
  {/* NEW: Contrarian Score */}
  <div className="text-center p-4 bg-amber-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">Contrarian Score</div>
    <div className="text-3xl font-bold text-amber-600">{wallet.contrarian_score.toFixed(1)}%</div>
  </div>
  {/* NEW: Contrarian Win Rate */}
  <div className="text-center p-4 bg-cyan-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">Contrarian WR</div>
    <div className="text-3xl font-bold text-cyan-600">{wallet.contrarian_win_rate.toFixed(1)}%</div>
  </div>
  <div className="text-center p-4 bg-purple-50 rounded">
    <div className="text-sm text-muted-foreground mb-1">Omega Ratio</div>
    <div className="text-3xl font-bold text-purple-600">{wallet.omegaRatio.toFixed(2)}</div>
  </div>
</div>
```

---

### 3. PnL Leaderboard
**Component:** `pnl-leaderboard/` (NEW)

**Purpose:** Discovery Hub - PnL Leaderboard (Section 1.3 of hub-specifications.md)

**Layout:** Split view - scatter plot (top 50%) + table (bottom 50%)

**Critical Correction - Scatter Plot Axes:**
- **X-axis:** Realized PnL ($) — NOT WIS
- **Y-axis:** Total Invested ($) — NOT Total PnL
- **Color:** ROI (%) — Green for positive, red for negative

**Features:**
- ECharts scatter plot showing positions (not wallets)
- PrimeVue DataTable with 11 columns
- Filters: minWIS, minROI, category, side

**Location:** `/components/pnl-leaderboard/`

**Files:**
```
pnl-leaderboard/
├── index.tsx                    # Main split view
├── components/
│   ├── scatter-chart.tsx        # ECharts scatter plot
│   └── leaderboard-table.tsx   # PrimeVue DataTable
├── hooks/
│   └── use-leaderboard-data.ts # API hook
└── types.ts                     # PnLLeaderboardPosition interface
```

**Corrected Scatter Plot:**
```typescript
const option = {
  xAxis: {
    name: 'Realized PnL ($)',  // CORRECTED from WIS
    type: 'value'
  },
  yAxis: {
    name: 'Total Invested ($)',  // CORRECTED from Total PnL
    type: 'value'
  },
  series: [{
    type: 'scatter',
    data: positions.map(p => ({
      value: [p.realized_pnl, p.total_invested],  // CORRECTED axes
      itemStyle: {
        color: p.roi > 10 ? '#16a34a' : p.roi < -10 ? '#dc2626' : '#9ca3af'  // Color by ROI
      }
    }))
  }]
}
```

---

### 4. Market Map (Treemap)
**Component:** `market-map/` (NEW)

**Purpose:** Discovery Hub - Market Map (Section 1.2 of hub-specifications.md)

**Layout:** Full-screen ECharts treemap

**Features:**
- Tile size = 24h volume
- Tile color = SII (-100 to +100)
- Click tile → navigate to Market Detail

**Location:** `/components/market-map/`

**Files:**
```
market-map/
├── index.tsx                 # Main treemap component
├── hooks/
│   └── use-market-map.ts    # API hook
└── types.ts                  # MarketMapTile interface
```

---

### 5. Strategy Builder Nodes (18 New Nodes)
**Component:** `nodes/` (COMPLETE REPLACEMENT)

**Current Nodes (12 crypto/AI nodes):** Text Model, Embedding Model, Tool, Structured Output, Prompt, Image Generation, Audio, JavaScript, Start, End, Conditional, HTTP Request

**CASCADIAN V1 Nodes (18 prediction market nodes):**

#### Data Nodes (4)
1. **Get Market Data** - Fetch market by ID or search criteria, output SII, momentum, volume
2. **Find Markets** - Search markets by category, SII threshold, volume
3. **Get Wallet Data** - Fetch wallet by address, output WIS, PnL, win rate
4. **Find Wallets** - Filter wallets by WIS threshold, specialty

#### Specialist Nodes (2)
5. **Find Specialist ("Eggman")** - Find top wallet for a category (e.g., "Politics specialist with WIS > 70")
6. **Find Contrarians** - Find wallets with high contrarian_score in a category

#### Analysis Nodes (4)
7. **Check Wallet Agreement** - Given a market + list of wallets, calculate % agreeing on YES/NO
8. **Run Googleable Check** - Trigger is_googleable agent for a market
9. **Run Rigged Check** - Trigger is_rigged agent for a market
10. **Run MiroMind Research** - Deep research on a market question

#### Signal Nodes (3)
11. **Wait for SII Flip** - Wait until SII crosses threshold (e.g., SII > 60)
12. **Wait for Momentum Flip** - Wait until momentum changes direction
13. **Wait for Price Change** - Wait until price moves by X%

#### Execution Nodes (5)
14. **Set Max Bet** - Configure max bet size for next trade
15. **Place Bet** - Execute YES/NO bet on a market
16. **Close Position** - Exit a position (sell shares)
17. **Check Position Status** - Get current position P&L, unrealized gains
18. **End Strategy** - Terminal node (success/failure)

**Universal Nodes (Keep from original):**
- **Start** (entry point)
- **Conditional** (if/else branching)
- **JavaScript** (custom logic)
- **HTTP Request** (external API calls)

**Location:** `/components/nodes/`

**New Files (18 new nodes):**
```
nodes/
├── get-market-data-node.tsx
├── find-markets-node.tsx
├── get-wallet-data-node.tsx
├── find-wallets-node.tsx
├── find-specialist-node.tsx
├── find-contrarians-node.tsx
├── check-wallet-agreement-node.tsx
├── run-googleable-check-node.tsx
├── run-rigged-check-node.tsx
├── run-miromind-research-node.tsx
├── wait-for-sii-flip-node.tsx
├── wait-for-momentum-flip-node.tsx
├── wait-for-price-change-node.tsx
├── set-max-bet-node.tsx
├── place-bet-node.tsx
├── close-position-node.tsx
├── check-position-status-node.tsx
└── end-strategy-node.tsx
```

**Keep (4 universal nodes):**
```
nodes/
├── start-node.tsx          # KEEP
├── conditional-node.tsx    # KEEP
├── javascript-node.tsx     # KEEP
└── http-request-node.tsx   # KEEP
```

**Archive (8 crypto/AI nodes):**
```bash
mkdir -p components/_archive/crypto-nodes
mv components/nodes/{text-model,embedding-model,tool,structured-output,prompt,image-generation,audio}-node.tsx components/_archive/crypto-nodes/
```

---

### 6. Node Palette (Updated)
**Component:** `node-palette.tsx`

**Current Usage:** Sidebar palette with 12 node types (AI-focused)

**CASCADIAN V1 Translation:**
- **Keep:** Drag-and-drop functionality, collapsible categories
- **Replace:** Node categories and icons

**New Categories:**
1. **Data** (4 nodes): Get Market Data, Find Markets, Get Wallet Data, Find Wallets
2. **Specialists** (2 nodes): Find Specialist, Find Contrarians
3. **Analysis** (4 nodes): Check Wallet Agreement, Googleable Check, Rigged Check, MiroMind Research
4. **Signals** (3 nodes): Wait for SII Flip, Wait for Momentum Flip, Wait for Price Change
5. **Execution** (5 nodes): Set Max Bet, Place Bet, Close Position, Check Position Status, End Strategy
6. **Universal** (4 nodes): Start, Conditional, JavaScript, HTTP Request

---

## 🛠️ Shared Components to Update

### dashboardSidebar.tsx
**Changes:** Update navigation links

**Old Links:**
```typescript
const navItems = [
  { label: 'Dashboard', href: '/', icon: Home },
  { label: 'AI Bot', href: '/ai-bot', icon: Bot },
  { label: 'DCA Bot', href: '/dca-bot', icon: TrendingUp },
  { label: 'My Assets', href: '/my-assets', icon: Wallet },
  { label: 'DeFi Center', href: '/defi-center', icon: Coins },
  { label: 'Strategy Builder', href: '/strategy-builder', icon: Workflow },
]
```

**New Links (CASCADIAN V1):**
```typescript
const navItems = [
  { label: 'Dashboard', href: '/', icon: Home },

  // Discovery Hub
  { label: 'Market Screener', href: '/discovery/screener', icon: Search },
  { label: 'Market Map', href: '/discovery/map', icon: Map },
  { label: 'PnL Leaderboard', href: '/discovery/leaderboard', icon: TrendingUp },
  { label: 'Whale Activity', href: '/discovery/whales', icon: Fish },

  // Traders Hub
  { label: 'Trader Explorer', href: '/traders/explorer', icon: Users },
  { label: 'Trader Comparison', href: '/traders/compare', icon: GitCompare },

  // Automate Hub
  { label: 'Strategy Builder', href: '/strategy-builder', icon: Workflow },
  { label: 'My Strategies', href: '/my-strategies', icon: Layers },
  { label: 'Strategy Library', href: '/strategy-library', icon: BookOpen },

  // My Account
  { label: 'My Positions', href: '/my-positions', icon: Wallet },
  { label: 'My Performance', href: '/my-performance', icon: BarChart },

  // Settings
  { label: 'Settings', href: '/settings', icon: Settings },
]
```

---

### search-bar.tsx
**Changes:** Search markets instead of tokens

**Old:** Search for crypto tokens (BTC, ETH, etc.)
**New:** Search for prediction markets by title or category

**API Endpoint Change:**
```typescript
// OLD
GET /api/v1/tokens/search?q=bitcoin

// NEW
GET /api/v1/markets/search?q=trump+election
```

---

## 📊 Technology Stack Changes

### Charts: Recharts → ECharts
**Reason:** ECharts provides better performance for large datasets and more advanced chart types (treemap, scatter with gradients)

**Components to Update:**
- All line/bar/pie charts in `my-analytics/`, `portfolio-tracker/`, etc.
- Replace `<LineChart>` → `<ReactECharts option={lineChartOption} />`

**Migration Example:**
```typescript
// OLD: Recharts
<LineChart data={data}>
  <Line dataKey="value" stroke="#8884d8" />
  <XAxis dataKey="name" />
  <YAxis />
</LineChart>

// NEW: ECharts
<ReactECharts
  option={{
    xAxis: { type: 'category', data: data.map(d => d.name) },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: data.map(d => d.value), color: '#8884d8' }]
  }}
/>
```

### Tables: Custom → PrimeVue DataTable
**Reason:** PrimeVue provides virtual scrolling, advanced filtering, and built-in column management for large datasets

**Components to Update:**
- All table components in `pump-screener/`, `wallets-interface/`, `portfolio-tracker/`, etc.
- Replace custom `<Table>` → `<DataTable virtualScrollerOptions={{ itemSize: 46 }} />`

---

## 🗂️ Directory Structure (After Migration)

```
components/
├── _archive/                          # Archived crypto components
│   ├── crypto-bots/                   # AI bot, DCA bot, arbitrage bot, etc.
│   ├── defi/                          # Yield farming, staking, liquidity tracker
│   └── crypto-nodes/                  # Old AI/crypto nodes
│
├── ui/                                # ✅ KEEP ALL - shadcn/ui primitives
│
├── dashboard-content/                 # 🔄 REPURPOSED - Prediction market dashboard
├── market-screener-interface/         # 🔄 REPURPOSED - From pump-screener
├── position-tracker-interface/        # 🔄 REPURPOSED - From portfolio-tracker
├── trader-explorer-interface/         # 🔄 REPURPOSED - From wallets-interface
├── my-positions/                      # 🔄 REPURPOSED - From my-assets
├── my-performance/                    # 🔄 REPURPOSED - From my-analytics
├── betting-interface/                 # 🔄 REPURPOSED - From trading-interface
├── strategy-overview/                 # 🔄 REPURPOSED - From overview-dashboard
├── strategy-execution-logs/           # 🔄 REPURPOSED - From execution-logs-dashboard
│
├── market-detail/                     # 🆕 NEW - Market drill-down
├── wallet-detail/                     # 🆕 NEW - Wallet drill-down
├── pnl-leaderboard/                   # 🆕 NEW - Scatter + table leaderboard
├── market-map/                        # 🆕 NEW - ECharts treemap
├── whale-activity/                    # 🆕 NEW - Smart money flow charts
├── trader-comparison/                 # 🆕 NEW - Compare 2+ wallets
│
├── nodes/                             # 🔄 18 NEW NODES - Prediction market workflow nodes
│   ├── get-market-data-node.tsx
│   ├── find-specialist-node.tsx
│   ├── place-bet-node.tsx
│   └── ... (15 more)
│
├── settings-interface/                # ✅ KEEP
├── subscription-interface/            # ✅ KEEP
├── help-center-interface/             # ✅ KEEP
├── invite-friends-interface/          # ✅ KEEP
├── strategies-marketplace-interface/  # ✅ KEEP CONCEPT
├── strategy-library/                  # ✅ KEEP
│
├── dashboardSidebar.tsx               # 🔄 UPDATE LINKS
├── topbar.tsx                         # ✅ KEEP
├── search-bar.tsx                     # 🔄 UPDATE TO SEARCH MARKETS
├── theme-provider.tsx                 # ✅ KEEP
└── theme-switcher.tsx                 # ✅ KEEP
```

---

## 📋 Migration Checklist

### Phase 1: Archive (Week 1)
- [ ] Create `/components/_archive/` directory structure
- [ ] Move 7 crypto bot components to `_archive/crypto-bots/`
- [ ] Move 5 DeFi components to `_archive/defi/`
- [ ] Move 8 old nodes to `_archive/crypto-nodes/`
- [ ] Update imports in `app/` routes to remove archived component references
- [ ] Test build to ensure no broken imports

### Phase 2: Repurpose (Week 2-3)
- [ ] Rename `pump-screener-interface/` → `market-screener-interface/`
- [ ] Update Market Screener with 15 SII-focused columns
- [ ] Rename `portfolio-tracker-interface/` → `position-tracker-interface/`
- [ ] Update Position Tracker data models (CryptoAsset → PredictionPosition)
- [ ] Rename `wallets-interface/` → `trader-explorer-interface/`
- [ ] Update Trader Explorer with WIS-based metrics + contrarian columns
- [ ] Update `my-assets/` to show prediction positions
- [ ] Update `my-analytics/` to show prediction performance
- [ ] Update `trading-interface/` for YES/NO betting
- [ ] Update `overview-dashboard/` for strategy management
- [ ] Update `execution-logs-dashboard/` for strategy logs
- [ ] Update `dashboardSidebar.tsx` navigation links
- [ ] Update `search-bar.tsx` to search markets

### Phase 3: Build New (Week 4-6)
- [ ] Build `market-detail/` component (Section 3.1 of hub-specifications.md)
- [ ] Build `wallet-detail/` component with 6 header cards including contrarian metrics
- [ ] Build `pnl-leaderboard/` component with corrected scatter plot axes
- [ ] Build `market-map/` component (Section 1.2 of hub-specifications.md)
- [ ] Build `whale-activity/` component (Section 1.4 of hub-specifications.md)
- [ ] Build `trader-comparison/` component (Section 2.2 of hub-specifications.md)
- [ ] Build 18 new Strategy Builder nodes
- [ ] Update `node-palette.tsx` with new categories
- [ ] Migrate all Recharts → ECharts
- [ ] Migrate all custom tables → PrimeVue DataTable

### Phase 4: Testing & QA (Week 7)
- [ ] Test all repurposed components with mock data
- [ ] Test all new components with mock data
- [ ] Test Strategy Builder with new nodes
- [ ] Integration test: Create end-to-end strategy workflow
- [ ] Performance test: Ensure PrimeVue virtual scrolling works with 10k+ rows
- [ ] Visual QA: Ensure all components match hub-specifications.md designs

---

## 🔗 Related Documentation

- **Hub Specifications:** `.agent-os/product/hub-specifications.md` - Detailed UI/UX for all components
- **Technical Design:** `.agent-os/product/technical-design.md` - Backend APIs and data models
- **Template Audit:** `.agent-os/product/template-audit.md` - High-level translation strategy
- **Tech Stack:** `.agent-os/product/tech-stack.md` - Framework and library choices

---

## 📝 Critical Corrections Applied

This component mapping incorporates all V1 PRD corrections:

1. ✅ **Market Screener:** 15 SII-focused columns (removed figureOutAble, googleAble, smartMoneyVolume, smartMoneyBias, whaleCount)
2. ✅ **PnL Leaderboard:** Corrected scatter plot axes (X = Realized PnL, Y = Total Invested, Color = ROI)
3. ✅ **Contrarian Metrics:** Added contrarian_score and contrarian_win_rate throughout (Trader Explorer, Wallet Detail)
4. ✅ **On-Demand Signals:** is_rigged and is_googleable are booleans, only rendered when computed
5. ✅ **18-Node Palette:** Complete Strategy Builder node set for prediction markets
6. ✅ **Technology Stack:** ECharts for charts, PrimeVue for tables, React Flow for workflows
7. ✅ **3-Tier Database:** Supabase → S3/R2 → ClickHouse architecture reflected in data models
8. ✅ **Dedicated Wallets:** Each strategy has its own wallet for isolated P&L tracking

---

## 🚀 Next Steps

After completing this component migration:
1. Implement backend APIs from technical-design.md
2. Connect components to real Polymarket data
3. Deploy to staging for user testing
4. Iterate based on feedback
5. Launch CASCADIAN V1 🎉
