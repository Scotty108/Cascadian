# CASCADIAN Component Mapping
**Crypto Template → Prediction Market Platform Translation Guide**

## Overview

This document provides a detailed component-by-component mapping from the crypto trading template to CASCADIAN's prediction market platform. Use this as a practical guide during the migration.

---

## Action Categories

- **🗑️ DELETE**: Remove entirely, not relevant to prediction markets
- **📦 ARCHIVE**: Move to `app/(archive)` for design reference
- **🔄 TRANSLATE**: Modify business logic, keep UI shell
- **✅ KEEP**: No changes needed
- **🆕 CREATE**: Build from scratch (no existing component)

---

## Page-Level Mapping

### Dashboard Pages

| Old Route | Old Purpose | Action | New Route | New Purpose |
|-----------|-------------|--------|-----------|-------------|
| `/` | Crypto dashboard overview | 🔄 TRANSLATE | `/` | Prediction market dashboard overview |
| `/ai-bot` | AI crypto trading bot | 📦 ARCHIVE | N/A | (Not in V1) |
| `/dca-bot` | Dollar cost averaging bot | 📦 ARCHIVE | N/A | (Not in V1) |
| `/arbitrage-bot` | Cross-exchange arbitrage | 📦 ARCHIVE | N/A | (Not in V1) |
| `/signal-bot` | Technical indicator bot | 📦 ARCHIVE | N/A | (Not in V1) |
| `/bot-templates` | Pre-made bot templates | 📦 ARCHIVE | `/automation/templates` | Strategy templates library |
| `/control-panel` | Bot management | 🔄 TRANSLATE | `/automation/strategies` | Strategy management |
| `/my-assets` | Crypto holdings | 🔄 TRANSLATE | `/portfolio/positions` | Active prediction positions |
| `/my-analytics` | Crypto trading analytics | 🔄 TRANSLATE | `/portfolio/performance` | Performance metrics |
| `/portfolio-tracker` | Crypto portfolio tracker | 🔄 TRANSLATE | `/portfolio/tracker` | Position tracker |
| `/pump-screener` | Token price screener | 🔄 TRANSLATE | `/discovery/markets` | Market screener |
| `/trading` | Manual crypto trading | 🔄 TRANSLATE | `/trading/manual` | Manual betting |
| `/wallets` | Crypto wallet management | 🔄 TRANSLATE | `/traders/explorer` | Trader explorer |
| `/defi-center` | DeFi hub | 📦 ARCHIVE | N/A | (Not relevant) |
| `/defi-protocols` | Protocol stats | 📦 ARCHIVE | N/A | (Not relevant) |
| `/strategies-marketplace` | Strategy trading | ✅ KEEP | `/marketplace` | Strategy marketplace |
| `/strategy-builder` | Visual workflow builder | 🔄 TRANSLATE | `/automation/strategy-builder` | Prediction market strategy builder |
| `/settings` | User settings | ✅ KEEP | `/settings` | User settings |
| `/subscription` | Billing | ✅ KEEP | `/subscription` | Billing |
| `/help-center` | Documentation | ✅ KEEP | `/help-center` | Documentation |
| `/invite-friends` | Referrals | ✅ KEEP | `/invite-friends` | Referrals |

### New Pages (Create from Scratch)

| New Route | Purpose | Reference Design |
|-----------|---------|------------------|
| `/discovery/map` | Market treemap | 🆕 CREATE (ECharts treemap) |
| `/discovery/leaderboard` | PnL scatter plot + table | 🆕 CREATE (ECharts scatter + PrimeVue) |
| `/discovery/whales` | 4-chart whale activity grid | 🆕 CREATE (ECharts grid) |
| `/discovery/large-trades` | Streaming large trades | 🆕 CREATE (PrimeVue streaming) |
| `/traders/smart-trades` | Live smart trades feed | 🆕 CREATE (PrimeVue streaming) |
| `/traders/insiders` | Possible insider detection | 🆕 CREATE (PrimeVue + expansion rows) |
| `/analysis/market/[id]` | Market detail drill-down | 🆕 CREATE (ECharts + PrimeVue) |
| `/analysis/wallet/[address]` | Wallet detail drill-down | 🆕 CREATE (ECharts + PrimeVue) |

---

## Component-Level Mapping

### UI Primitives (Keep All)

**Location**: `components/ui/`

All 40+ shadcn/ui components are domain-agnostic and fully reusable:

| Component | Status | Notes |
|-----------|--------|-------|
| Button, Card, Input, Select, etc. | ✅ KEEP | No changes needed |
| Dialog, Sheet, Popover, etc. | ✅ KEEP | No changes needed |
| Table, Tabs, Toast, etc. | ✅ KEEP | No changes needed |
| Progress, Slider, Switch, etc. | ✅ KEEP | No changes needed |

---

### Feature Components (Translate/Archive/Create)

#### Dashboard & Layout

| Old Component | Location | Action | New Component | New Location |
|---------------|----------|--------|---------------|--------------|
| `dashboard-content` | `components/dashboard-content/` | 🔄 TRANSLATE | `prediction-dashboard` | `components/prediction-dashboard/` |
| `dashboardSidebar` | `components/dashboardSidebar.tsx` | 🔄 TRANSLATE | `dashboardSidebar` | `components/dashboardSidebar.tsx` |

**Translation Details for `dashboard-content` → `prediction-dashboard`**:

```typescript
// OLD (Crypto)
interface DashboardData {
  totalAssets: number      // BTC, ETH holdings
  activeBots: number       // Running trading bots
  totalPnL: number         // Crypto trading PnL
  recentTrades: Trade[]    // Recent bot trades
}

// NEW (Prediction Markets)
interface DashboardData {
  activePositions: number       // Open prediction positions
  activeStrategies: number      // Running strategy bots
  totalPnL: number             // Prediction market PnL
  recentBets: Position[]       // Recent manual/bot bets
  watchedMarkets: Market[]     // Followed markets
  followedTraders: Wallet[]    // Followed smart wallets
}
```

**Sidebar Menu Changes**:
```typescript
// OLD sections: "Trading & Bots", "DeFi", "Portfolio", "Tools"
// NEW sections: "Discovery", "Traders", "Portfolio", "Automation"

const newMenuItems = [
  {
    section: "Discovery",
    items: [
      { id: "markets", label: "Market Screener", icon: Search, href: "/discovery/markets" },
      { id: "map", label: "Market Map", icon: Map, href: "/discovery/map" },
      { id: "leaderboard", label: "PnL Leaderboard", icon: Trophy, href: "/discovery/leaderboard" },
      { id: "whales", label: "Whale Activity", icon: Activity, href: "/discovery/whales" },
      { id: "large-trades", label: "Large Trades", icon: Zap, href: "/discovery/large-trades" }
    ]
  },
  {
    section: "Traders",
    items: [
      { id: "explorer", label: "Trader Explorer", icon: Users, href: "/traders/explorer" },
      { id: "smart-trades", label: "Live Smart Trades", icon: Radio, href: "/traders/smart-trades" },
      { id: "insiders", label: "Possible Insiders", icon: Eye, href: "/traders/insiders" }
    ]
  },
  {
    section: "Portfolio",
    items: [
      { id: "positions", label: "My Positions", icon: Briefcase, href: "/portfolio/positions" },
      { id: "performance", label: "My Performance", icon: TrendingUp, href: "/portfolio/performance" },
      { id: "tracker", label: "Position Tracker", icon: PieChart, href: "/portfolio/tracker" }
    ]
  },
  {
    section: "Automation",
    items: [
      { id: "strategy-builder", label: "Strategy Builder", icon: Sparkles, href: "/automation/strategy-builder" },
      { id: "strategies", label: "My Strategies", icon: Layers, href: "/automation/strategies" },
      { id: "templates", label: "Templates", icon: BookOpen, href: "/automation/templates" }
    ]
  }
]
```

---

#### Archive Crypto Bot Components

| Old Component | Location | Action |
|---------------|----------|--------|
| `ai-bot-dashboard` | `components/ai-bot-dashboard/` | 📦 ARCHIVE → `components/(archive)/ai-bot-dashboard/` |
| `dca-bot-dashboard` | `components/dca-bot-dashboard/` | 📦 ARCHIVE → `components/(archive)/dca-bot-dashboard/` |
| `arbitrage-bot-dashboard` | `components/arbitrage-bot-dashboard/` | 📦 ARCHIVE → `components/(archive)/arbitrage-bot-dashboard/` |
| `signal-bot-dashboard` | `components/signal-bot-dashboard/` | 📦 ARCHIVE → `components/(archive)/signal-bot-dashboard/` |
| `bot-templates-interface` | `components/bot-templates-interface/` | 📦 ARCHIVE → `components/(archive)/bot-templates-interface/` |
| `bot-settings-dashboard` | `components/bot-settings-dashboard/` | 📦 ARCHIVE → `components/(archive)/bot-settings-dashboard/` |
| `execution-logs-dashboard` | `components/execution-logs-dashboard/` | 🔄 TRANSLATE → `components/strategy-logs/` |

---

#### Archive DeFi Components

| Old Component | Location | Action |
|---------------|----------|--------|
| `defi-protocols-interface` | `components/defi-protocols-interface/` | 📦 ARCHIVE → `components/(archive)/defi-protocols-interface/` |
| `yield-farming-interface` | `components/yield-farming-interface/` | 📦 ARCHIVE → `components/(archive)/yield-farming-interface/` |
| `staking-pools-interface` | `components/staking-pools-interface/` | 📦 ARCHIVE → `components/(archive)/staking-pools-interface/` |
| `liquidity-tracker-interface` | `components/liquidity-tracker-interface/` | 📦 ARCHIVE → `components/(archive)/liquidity-tracker-interface/` |

---

#### Translate Portfolio Components

| Old Component | Old Location | New Component | New Location | Changes |
|---------------|--------------|---------------|--------------|---------|
| `my-assets` | `components/my-assets/` | `my-positions` | `components/my-positions/` | Replace "Assets" with "Positions", change data model |
| `my-analytics` | `components/my-analytics/` | `my-performance` | `components/my-performance/` | Keep charts, change metrics (WIS, win rate, Sharpe) |
| `portfolio-tracker-interface` | `components/portfolio-tracker-interface/` | `position-tracker-interface` | `components/position-tracker-interface/` | Replace crypto trades with prediction positions |

**Translation Example: `my-assets` → `my-positions`**

```typescript
// OLD (my-assets/data.tsx)
export const mockAssets = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    balance: 0.5,
    value: 21500,
    change24h: 2.5,
    network: "Bitcoin"
  }
]

// NEW (my-positions/data.tsx)
export const mockPositions = [
  {
    marketId: "clob-12345",
    marketTitle: "Will Bitcoin reach $100k by EOY 2025?",
    side: "YES",
    shares: 1000,
    avgPrice: 0.65,
    currentPrice: 0.72,
    value: 720,
    pnl: 70,
    pnlPercent: 10.77,
    marketCategory: "Crypto",
    marketSII: 45,
    openedAt: new Date("2025-01-15"),
    strategy: "Default Template" // If opened by bot
  }
]
```

---

#### Translate Discovery Components

| Old Component | Old Location | New Component | New Location | Changes |
|---------------|--------------|---------------|--------------|---------|
| `pump-screener-interface` | `components/pump-screener-interface/` | `market-screener` | `components/market-screener/` | Replace token data with market data, add SII/WIS columns |
| `wallets-interface` | `components/wallets-interface/` | `trader-explorer` | `components/trader-explorer/` | Replace wallet balances with WIS metrics |
| `trading-interface` | `components/trading-interface/` | `manual-trading` | `components/manual-trading/` | Replace order book with prediction market betting UI |

**Translation Example: `pump-screener-interface` → `market-screener`**

```typescript
// OLD (pump-screener-interface/data.tsx)
export interface TokenScreenerRow {
  symbol: string
  name: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number
}

// NEW (market-screener/data.tsx)
export interface MarketScreenerRow {
  marketId: string
  title: string           // Question
  category: string
  sii: number            // -100 to +100
  momentum: number       // 0-100
  figureOutAble: number  // 0-100
  googleAble: number     // 0-100
  volume24h: number
  liquidity: number
  currentPrice: number   // YES price
  priceChange24h: number
  smartMoneyVolume: number
  smartMoneyBias: "YES" | "NO" | "NEUTRAL"
  whaleCount: number
  endDate: Date
  daysUntilClose: number
}
```

**UI Changes**:
- Replace Recharts with ECharts
- Replace current table with PrimeVue DataTable
- Add new columns for SII, smart money metrics
- Add filters for WIS thresholds, contrarian activity

---

#### Translate Strategy Builder Components

| Old Component | Old Location | New Component | New Location | Changes |
|---------------|--------------|---------------|--------------|---------|
| `strategy-library` | `components/strategy-library/` | `strategy-library` | `components/strategy-library/` | Keep UI, change default template content |
| `nodes/` | `components/nodes/` | `nodes/` | `components/nodes/` | **Replace ALL 12 crypto nodes with 18 Polymarket nodes** |

**Node Replacement (Critical)**:

**DELETE OLD NODES** (12):
1. Text Model Node
2. Embedding Model Node
3. Tool Node
4. Structured Output Node
5. Prompt Node
6. Image Generation Node
7. Audio Node
8. JavaScript Node
9. Start Node (keep, but modify)
10. End Node (keep, but modify)
11. Conditional Node (keep, but modify)
12. HTTP Request Node (keep, but modify)

**CREATE NEW NODES** (18):

Trigger Nodes:
1. `OnScheduleNode.tsx` - Cron trigger
2. `OnNewMarketNode.tsx` - Market creation trigger

Data Nodes:
3. `GetMarketsNode.tsx` - Fetch markets with filters
4. `GetMarketDataNode.tsx` - Fetch market signals (SII, momentum, etc.)
5. `GetWalletDataNode.tsx` - Fetch wallet WIS and metrics

Strategy Nodes:
6. `FindWalletsNode.tsx` - Find wallets by WIS threshold
7. `FindSpecialistNode.tsx` - Find top specialist in category
8. `CheckWalletAgreementNode.tsx` - Calculate % agreement among wallets

Agent Nodes:
9. `FigureOutAbleAgentNode.tsx` - Run LLM to check if market is subjective
10. `GoogleAbleAgentNode.tsx` - Run LLM to check if market is researchable
11. `DeepResearchAgentNode.tsx` - Run MiroMind for deep research

Logic Nodes:
12. `FilterNumericNode.tsx` - Numeric comparison filter
13. `FilterBooleanNode.tsx` - Boolean logic (AND/OR/NOT)
14. `WaitMomentumFlipNode.tsx` - Wait for momentum threshold

Risk Management Nodes:
15. `SetMaxBetNode.tsx` - Configure max bet size
16. `SetDiversificationNode.tsx` - Configure position limits

Action Nodes:
17. `AddToWatchlistNode.tsx` - Add market to watchlist
18. `TriggerTradeNode.tsx` - Execute buy/sell signal

**Node Structure Example**:

```typescript
// NEW: components/nodes/FindWalletsNode.tsx
import { Handle, Position } from '@xyflow/react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface FindWalletsNodeData {
  minWIS: number
  maxWIS: number
  specialty?: string
  limit: number
}

export function FindWalletsNode({ data, isConnectable }: any) {
  return (
    <Card className="p-4 min-w-[250px]">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-5 w-5 text-blue-600" />
        <span className="font-semibold">Find Wallets</span>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Min WIS</Label>
          <Input
            type="number"
            value={data.minWIS || 50}
            onChange={(e) => data.updateConfig?.('minWIS', parseInt(e.target.value))}
            className="h-8"
          />
        </div>

        <div>
          <Label className="text-xs">Max WIS</Label>
          <Input
            type="number"
            value={data.maxWIS || 100}
            onChange={(e) => data.updateConfig?.('maxWIS', parseInt(e.target.value))}
            className="h-8"
          />
        </div>

        <div>
          <Label className="text-xs">Specialty (optional)</Label>
          <Select value={data.specialty} onValueChange={(v) => data.updateConfig?.('specialty', v)}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Any" />
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
          <Label className="text-xs">Limit</Label>
          <Input
            type="number"
            value={data.limit || 10}
            onChange={(e) => data.updateConfig?.('limit', parseInt(e.target.value))}
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

#### Keep Marketplace & Settings Components

| Component | Location | Action | Notes |
|-----------|----------|--------|-------|
| `strategies-marketplace-interface` | `components/strategies-marketplace-interface/` | 🔄 TRANSLATE | Keep UI, adapt to prediction market strategies |
| `settings-interface` | `components/settings-interface/` | ✅ KEEP | No changes needed |
| `subscription-interface` | `components/subscription-interface/` | ✅ KEEP | No changes needed |
| `help-center-interface` | `components/help-center-interface/` | 🔄 TRANSLATE | Update documentation content |
| `invite-friends-interface` | `components/invite-friends-interface/` | ✅ KEEP | No changes needed |

---

## Chart Library Migration

### Replace Recharts with ECharts

**Old Pattern** (Recharts):
```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

<LineChart width={500} height={300} data={data}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="name" />
  <YAxis />
  <Tooltip />
  <Legend />
  <Line type="monotone" dataKey="value" stroke="#8884d8" />
</LineChart>
```

**New Pattern** (ECharts):
```typescript
import ReactECharts from 'echarts-for-react'

<ReactECharts
  option={{
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data.map(d => d.name) },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: data.map(d => d.value),
      smooth: true,
      lineStyle: { color: '#8884d8' }
    }]
  }}
  style={{ height: '300px', width: '100%' }}
/>
```

**Migration Checklist**:
- [ ] Install `echarts` and `echarts-for-react`
- [ ] Create wrapper components for common chart types
- [ ] Update all chart imports
- [ ] Test responsive behavior
- [ ] Verify theme compatibility (dark/light mode)

---

## Table Library Migration

### Replace Current Tables with PrimeVue DataTable

**Old Pattern** (shadcn Table):
```typescript
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
```

**New Pattern** (PrimeVue DataTable):
```typescript
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
  <Column field="value" header="Value" sortable filter dataType="numeric" />
</DataTable>
```

**Migration Checklist**:
- [ ] Install `primevue` and required dependencies
- [ ] Configure PrimeVue theme in Next.js
- [ ] Create custom body templates for complex cells
- [ ] Implement virtual scrolling for large datasets
- [ ] Add custom filters (date ranges, multi-select, etc.)

---

## Data Model Migration

### Key Type Changes

**From Crypto Models**:
```typescript
// types/crypto.ts (OLD)
export interface Asset {
  symbol: string           // "BTC", "ETH"
  balance: number
  value: number           // USD value
  network: string         // "Ethereum", "BSC"
}

export interface Bot {
  id: string
  type: "dca" | "arbitrage" | "signal" | "ai"
  status: "running" | "stopped"
  pnl: number
  tradesCount: number
}

export interface Trade {
  id: string
  timestamp: Date
  pair: string           // "BTC/USDT"
  side: "buy" | "sell"
  price: number
  amount: number
  total: number
}
```

**To Prediction Market Models**:
```typescript
// types/prediction-markets.ts (NEW)
export interface Market {
  marketId: string
  question: string
  category: string
  sii: number              // -100 to +100
  momentum: number         // 0-100
  figureOutAble: number    // 0-100
  googleAble: number       // 0-100
  volume24h: number
  liquidity: number
  currentPrice: number     // YES price (0-1)
  priceChange24h: number   // %
  endDate: Date
  outcomes: Outcome[]
}

export interface Wallet {
  walletAddress: string
  ens: string | null
  wis: number              // -100 to +100 (Smart Score)
  totalPnL: number
  totalVolume: number
  winRate: number          // %
  omegaRatio: number
  sharpeRatio: number
  tradesCount: number
  avgTradeSize: number
  contrarian_score: number      // 0-100%
  contrarian_win_rate: number   // %
  specialty: string[]      // ["Politics", "Sports"]
}

export interface Position {
  marketId: string
  marketTitle: string
  side: "YES" | "NO"
  shares: number
  avgPrice: number         // Entry price
  currentPrice: number
  marketValue: number
  pnl: number
  pnlPercent: number
  marketCategory: string
  marketSII: number
  openedAt: Date
  strategy?: string        // If opened by bot
}

export interface Strategy {
  id: string
  name: string
  description: string
  nodes: Node[]            // React Flow nodes
  edges: Edge[]            // React Flow edges
  status: "active" | "paused" | "stopped"
  walletAddress: string    // Dedicated wallet for this strategy
  balance: number
  pnl: number
  roi: number              // %
  tradesCount: number
  winRate: number          // %
  createdAt: Date
  lastRunAt: Date | null
}
```

---

## API Endpoint Migration

### From Crypto APIs

**OLD**:
```typescript
// Exchange APIs
GET /api/exchanges/binance/ticker
GET /api/exchanges/coinbase/orderbook

// Price feeds
GET /api/prices/coingecko
GET /api/prices/coinmarketcap

// DeFi protocols
GET /api/defi/uniswap/pools
GET /api/defi/aave/positions
```

**NEW**:
```typescript
// Polymarket V1 API (read-only)
GET https://clob.polymarket.com/markets
GET https://clob.polymarket.com/order-book?market_id=xxx

// CASCADIAN Backend API (proprietary signals)
GET /api/v1/markets/screener
GET /api/v1/markets/:id/detail
GET /api/v1/wallets/leaderboard
GET /api/v1/wallets/:address/detail
GET /api/v1/analytics/whale-activity
GET /api/v1/trades/large
GET /api/v1/trades/smart

// Strategy execution
POST /api/v1/strategies/:id/start
POST /api/v1/strategies/:id/stop
GET /api/v1/strategies/:id/status
GET /api/v1/strategies/:id/logs
```

---

## Migration Checklist

### Phase 1: Preparation
- [ ] Create `components/(archive)/` directory
- [ ] Move all crypto bot components to archive
- [ ] Move all DeFi components to archive
- [ ] Update `.gitignore` to still track archived files
- [ ] Document archive location in README

### Phase 2: Library Upgrades
- [ ] Install ECharts: `pnpm add echarts echarts-for-react`
- [ ] Install PrimeVue: `pnpm add primevue`
- [ ] Configure PrimeVue theme in `_app.tsx`
- [ ] Create ECharts wrapper components
- [ ] Create PrimeVue custom body templates

### Phase 3: Component Translation
- [ ] Translate `dashboard-content` → `prediction-dashboard`
- [ ] Translate `dashboardSidebar` (update menu items)
- [ ] Translate `my-assets` → `my-positions`
- [ ] Translate `my-analytics` → `my-performance`
- [ ] Translate `portfolio-tracker-interface` → `position-tracker-interface`
- [ ] Translate `pump-screener-interface` → `market-screener`
- [ ] Translate `wallets-interface` → `trader-explorer`
- [ ] Translate `trading-interface` → `manual-trading`

### Phase 4: Strategy Builder
- [ ] Delete old nodes (12 crypto nodes)
- [ ] Create new nodes (18 Polymarket nodes)
- [ ] Update node palette UI
- [ ] Update default template
- [ ] Test workflow validation

### Phase 5: New Pages
- [ ] Create Discovery Hub pages (5 new pages)
- [ ] Create Traders Hub pages (3 new pages)
- [ ] Create Analysis Hub drill-downs (2 new pages)
- [ ] Update routing

### Phase 6: Data & API
- [ ] Create new TypeScript types (`types/prediction-markets.ts`)
- [ ] Replace mock data in all components
- [ ] Integrate Polymarket API
- [ ] Integrate CASCADIAN backend API
- [ ] Test all API endpoints

### Phase 7: Testing & Polish
- [ ] Test all ECharts in dark/light mode
- [ ] Test all PrimeVue tables with large datasets
- [ ] Test responsive layouts on mobile
- [ ] Performance testing (loading times)
- [ ] User acceptance testing

---

## Component Reusability Matrix

| Component Type | Reusability | Notes |
|----------------|-------------|-------|
| shadcn/ui primitives | 100% | Zero changes needed |
| Layout components | 90% | Minor menu changes |
| Chart components | 0% | Replace Recharts with ECharts |
| Table components | 0% | Replace with PrimeVue DataTable |
| Form components | 100% | Reuse as-is |
| Dashboard cards | 70% | Keep UI, change data |
| Sidebar navigation | 80% | Update menu items only |
| Strategy Builder shell | 90% | Keep UI, replace nodes |
| Strategy Builder nodes | 0% | Replace all nodes |
| Bot management pages | 10% | Archive, design reference only |
| DeFi pages | 10% | Archive, design reference only |
| Settings pages | 100% | No changes |

---

## Success Criteria

Translation is complete when:
1. ✅ All crypto bot pages moved to `(archive)/`
2. ✅ All DeFi pages moved to `(archive)/`
3. ✅ All Recharts replaced with ECharts
4. ✅ All tables replaced with PrimeVue DataTable
5. ✅ Sidebar menu updated with new Discovery/Traders/Automation sections
6. ✅ Dashboard shows prediction market metrics (not crypto)
7. ✅ All 8 new pages created and functional
8. ✅ Strategy Builder has 18 new Polymarket nodes
9. ✅ All API calls use Polymarket/CASCADIAN backend (not crypto APIs)
10. ✅ Type system uses prediction market models (not crypto models)

---

## Quick Reference: What Goes Where

**Components to Archive** → Move to `components/(archive)/`:
- `ai-bot-dashboard/`
- `dca-bot-dashboard/`
- `arbitrage-bot-dashboard/`
- `signal-bot-dashboard/`
- `bot-templates-interface/`
- `bot-settings-dashboard/`
- `defi-protocols-interface/`
- `yield-farming-interface/`
- `staking-pools-interface/`
- `liquidity-tracker-interface/`

**Components to Translate** → Modify in place:
- `dashboard-content/` → Rename to `prediction-dashboard/`
- `my-assets/` → Rename to `my-positions/`
- `my-analytics/` → Rename to `my-performance/`
- `portfolio-tracker-interface/` → Rename to `position-tracker-interface/`
- `pump-screener-interface/` → Rename to `market-screener/`
- `wallets-interface/` → Rename to `trader-explorer/`
- `trading-interface/` → Rename to `manual-trading/`

**Components to Keep** → No changes:
- `ui/` (all 40+ shadcn components)
- `settings-interface/`
- `subscription-interface/`
- `help-center-interface/`
- `invite-friends-interface/`

**Components to Create** → Build from scratch:
- `market-map/` (ECharts treemap)
- `pnl-leaderboard/` (ECharts scatter + PrimeVue table)
- `whale-activity/` (4-chart grid)
- `large-trades-stream/` (PrimeVue streaming table)
- `smart-trades-stream/` (PrimeVue streaming table)
- `insider-detector/` (PrimeVue with expansion rows)
- `market-detail/` (multi-section analysis page)
- `wallet-detail/` (multi-section analysis page)
- `nodes/OnScheduleNode.tsx` through `nodes/TriggerTradeNode.tsx` (18 new nodes)
