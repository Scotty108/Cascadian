# CASCADIAN Hub Specifications
**Phase 2: Detailed V1 Requirements**

## Overview

This document defines the complete specifications for CASCADIAN's three main hubs:
- **Discovery Hub**: Find high-potential prediction markets
- **Traders Hub**: Analyze smart wallets and their activity
- **Automation Hub**: Build and deploy automated trading strategies

Each hub follows the philosophy: **Discover → Analyze → Automate**

---

## 1. Discovery Hub

The Discovery Hub helps users find high-potential prediction markets using proprietary signals (SII, Momentum).

### 1.1 Market Screener

**Purpose**: Primary discovery tool - filterable table showing all active markets with key signals.

**Route**: `/discovery/markets`

**Layout**: Full-width table with sticky header, virtual scrolling

**Data Requirements (15 SII-Focused Columns)**:
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
```

**API Endpoint**:
```typescript
GET /api/v1/discovery/screener
Query Params:
  - category?: string[]
  - min_sii?: number
  - max_sii?: number
  - min_momentum?: number
  - min_volume?: number
  - min_liquidity?: number
  - sort_by?: string (default: "sii")
  - sort_order?: "asc" | "desc" (default: "desc")
  - page?: number
  - limit?: number (default: 100)
```

**PrimeVue DataTable Configuration (15 Columns)**:
```typescript
<DataTable
  value={markets}
  scrollable
  scrollHeight="calc(100vh - 200px)"
  virtualScrollerOptions={{ itemSize: 46 }}
  filterDisplay="row"
  sortMode="multiple"
  resizableColumns
  columnResizeMode="expand"
  showGridlines
  stripedRows
>
  {/* Column 1: Market */}
  <Column
    field="title"
    header="Market"
    sortable
    filter
    filterPlaceholder="Search"
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
    body={(row) => (
      <div className="flex items-center gap-2">
        <span>{row.momentum}</span>
        <Progress value={row.momentum} className="w-16 h-2" />
      </div>
    )}
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
    filterElement={categoryFilterTemplate}
    style={{ width: '120px' }}
  />

  {/* Column 15: Flag (Rigged Score) */}
  <Column
    field="flag"
    header="Flag"
    style={{ width: '80px' }}
    body={(row) => row.flag ? '🚩' : null}
  />

  {/* Actions column */}
  <Column
    body={(row) => (
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => router.push(`/analysis/market/${row.market_id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => addToWatchlist(row.market_id)}>
          <Star className="h-4 w-4" />
        </Button>
      </div>
    )}
    frozen
    alignFrozen="right"
    style={{ width: '120px' }}
  />
</DataTable>
```

**Filters**:
- Text search on title
- Category multi-select (Politics, Sports, Crypto, Entertainment, Other)
- Numeric range filters on SII, Momentum, Volume, Liquidity, Volatility

**User Flow**:
1. User lands on Market Screener
2. Filters by category (e.g., "Politics") and minSII (e.g., > 60)
3. Sorts by "SII" descending
4. Clicks eye icon to view Market Detail drill-down
5. Clicks star icon to add to watchlist

---

### 1.2 Market Map

**Purpose**: Visual treemap showing all markets sized by volume, colored by SII.

**Route**: `/discovery/map`

**Layout**: Full-screen treemap with category selector and legend

**Data Requirements**:
```typescript
interface MarketMapTile {
  marketId: string
  title: string              // Truncated to fit tile
  category: string
  sii: number               // -100 to +100 (determines color)
  volume24h: number         // Determines tile size
  currentPrice: number      // Displayed on tile
}
```

**API Endpoint**:
```typescript
GET /api/v1/markets/map
Query Params:
  - category?: string[]
  - minVolume?: number
  - limit?: number (default: 200)
```

**ECharts Treemap Configuration**:
```typescript
const option = {
  tooltip: {
    formatter: (info) => {
      const { name, value, data } = info
      return `
        <strong>${data.title}</strong><br/>
        SII: ${data.sii}<br/>
        24h Volume: $${value.toLocaleString()}<br/>
        Price: ${(data.currentPrice * 100).toFixed(1)}¢
      `
    }
  },
  series: [
    {
      type: 'treemap',
      data: markets.map(m => ({
        name: m.marketId,
        value: m.volume24h,
        title: m.title,
        sii: m.sii,
        currentPrice: m.currentPrice
      })),
      // Color by SII: Green (high positive) → Gray (neutral) → Red (high negative)
      colorMappingBy: 'value',
      visualDimension: 'sii',
      visualMin: -100,
      visualMax: 100,
      colorSaturation: [0.3, 0.8],
      itemStyle: {
        borderColor: '#fff',
        borderWidth: 2,
        gapWidth: 2
      },
      levels: [
        {
          itemStyle: {
            borderColor: '#555',
            borderWidth: 4,
            gapWidth: 4
          }
        },
        {
          colorSaturation: [0.3, 0.6],
          itemStyle: {
            gapWidth: 1
          }
        }
      ],
      label: {
        show: true,
        formatter: (params) => {
          // Show title + price
          return `${params.data.title.substring(0, 40)}...\n${(params.data.currentPrice * 100).toFixed(1)}¢`
        }
      }
    }
  ]
}
```

**Color Scale**:
- SII > 70: Dark Green (#16a34a)
- SII 40-70: Light Green (#4ade80)
- SII -40 to 40: Gray (#9ca3af)
- SII -70 to -40: Light Red (#f87171)
- SII < -70: Dark Red (#dc2626)

**User Flow**:
1. User sees full treemap of all markets
2. Filters by category using dropdown
3. Hovers over tile to see tooltip (title, SII, volume, price)
4. Clicks tile to navigate to Market Detail drill-down

---

### 1.3 PnL Leaderboard

**Purpose**: Scatter plot showing all positions by Total Invested (Y-axis) vs Realized PnL (X-axis), colored by ROI, plus sortable table below.

**Route**: `/discovery/leaderboard`

**Layout**: Split view - scatter plot (top 50%) + table (bottom 50%)

**Data Requirements**:
```typescript
interface PnLLeaderboardPosition {
  market_id: string
  market_title: string
  wallet_address: string
  wallet_wis: number           // -100 to +100
  realized_pnl: number         // X-axis: Realized PnL in $
  total_invested: number       // Y-axis: Total capital deployed
  roi: number                  // ROI % (determines color)
  side: 'YES' | 'NO'
  win_rate: number             // % of winning trades
  category: string
  contrarian_score: number     // 0-100%
  contrarian_win_rate: number  // Win rate on contrarian trades
}
```

**API Endpoint**:
```typescript
GET /api/v1/discovery/leaderboard
Query Params:
  - minWIS?: number
  - minROI?: number
  - category?: string[]
  - side?: 'YES' | 'NO'
  - sort?: string (default: "roi:desc")
  - limit?: number (default: 200)
```

**ECharts Scatter Plot Configuration**:
```typescript
const option = {
  grid: { top: 40, right: 80, bottom: 60, left: 80 },
  xAxis: {
    name: 'Realized PnL ($)',
    nameLocation: 'middle',
    nameGap: 35,
    type: 'value',
    axisLabel: {
      formatter: (value) => {
        const absValue = Math.abs(value)
        if (absValue >= 1000) return `$${(value / 1000).toFixed(0)}k`
        return `$${value.toFixed(0)}`
      }
    },
    axisLine: { show: true },
    splitLine: { lineStyle: { type: 'dashed' } }
  },
  yAxis: {
    name: 'Total Invested ($)',
    nameLocation: 'middle',
    nameGap: 50,
    type: 'value',
    axisLabel: {
      formatter: (value) => `$${(value / 1000).toFixed(0)}k`
    }
  },
  tooltip: {
    formatter: (params) => {
      const pos = params.data
      return `
        <strong>${pos.market_title}</strong><br/>
        Wallet: ${pos.wallet_address.substring(0, 8)}...<br/>
        Realized PnL: $${pos.realized_pnl.toLocaleString()}<br/>
        Total Invested: $${pos.total_invested.toLocaleString()}<br/>
        ROI: ${pos.roi.toFixed(1)}%<br/>
        Side: ${pos.side}<br/>
        WIS: ${pos.wallet_wis}
      `
    }
  },
  series: [
    {
      type: 'scatter',
      data: positions.map(p => ({
        value: [p.realized_pnl, p.total_invested],
        market_id: p.market_id,
        market_title: p.market_title,
        wallet_address: p.wallet_address,
        wallet_wis: p.wallet_wis,
        realized_pnl: p.realized_pnl,
        total_invested: p.total_invested,
        roi: p.roi,
        side: p.side
      })),
      itemStyle: {
        color: (params) => {
          // Color by ROI: green for positive, red for negative
          const roi = params.data.roi
          if (roi > 50) return '#16a34a'      // Dark green
          if (roi > 10) return '#4ade80'      // Light green
          if (roi > -10) return '#9ca3af'     // Gray (break-even)
          if (roi > -50) return '#f87171'     // Light red
          return '#dc2626'                     // Dark red
        },
        opacity: 0.7
      },
      symbolSize: 8
    }
  ]
}
```

**PrimeVue DataTable (below scatter plot)**:
```typescript
<DataTable
  value={positions}
  scrollable
  scrollHeight="calc(50vh - 100px)"
  sortMode="multiple"
  filterDisplay="row"
  virtualScrollerOptions={{ itemSize: 46 }}
>
  {/* Column 1: Market (frozen left) */}
  <Column
    field="market_title"
    header="Market"
    sortable
    filter
    frozen
    style={{ minWidth: '250px' }}
    body={(row) => (
      <a href={`/analysis/market/${row.market_id}`} className="text-blue-600 hover:underline">
        {row.market_title}
      </a>
    )}
  />

  {/* Column 2: Wallet */}
  <Column
    field="wallet_address"
    header="Wallet"
    sortable
    filter
    style={{ minWidth: '140px' }}
    body={(row) => (
      <a href={`/analysis/wallet/${row.wallet_address}`} className="font-mono text-blue-600 hover:underline">
        {row.wallet_address.substring(0, 8)}...
      </a>
    )}
  />

  {/* Column 3: WIS */}
  <Column
    field="wallet_wis"
    header="WIS"
    sortable
    filter
    dataType="numeric"
    style={{ width: '100px' }}
    body={(row) => {
      const color = row.wallet_wis > 50 ? 'text-green-600' : row.wallet_wis < -50 ? 'text-red-600' : 'text-gray-600'
      return <span className={`font-semibold ${color}`}>{row.wallet_wis}</span>
    }}
  />

  {/* Column 4: Realized PnL */}
  <Column
    field="realized_pnl"
    header="Realized PnL"
    sortable
    filter
    dataType="numeric"
    style={{ width: '140px' }}
    body={(row) => {
      const color = row.realized_pnl > 0 ? 'text-green-600' : row.realized_pnl < 0 ? 'text-red-600' : 'text-gray-600'
      return <span className={color}>${row.realized_pnl.toLocaleString()}</span>
    }}
  />

  {/* Column 5: Total Invested */}
  <Column
    field="total_invested"
    header="Total Invested"
    sortable
    filter
    dataType="numeric"
    style={{ width: '140px' }}
    body={(row) => `$${row.total_invested.toLocaleString()}`}
  />

  {/* Column 6: ROI */}
  <Column
    field="roi"
    header="ROI (%)"
    sortable
    filter
    dataType="numeric"
    style={{ width: '100px' }}
    body={(row) => {
      const color = row.roi > 10 ? 'text-green-600' : row.roi < -10 ? 'text-red-600' : 'text-gray-600'
      return <span className={`font-semibold ${color}`}>{row.roi.toFixed(1)}%</span>
    }}
  />

  {/* Column 7: Side */}
  <Column
    field="side"
    header="Side"
    sortable
    filter
    style={{ width: '80px' }}
    body={(row) => (
      <span className={row.side === 'YES' ? 'text-green-600' : 'text-red-600'}>
        {row.side}
      </span>
    )}
  />

  {/* Column 8: Win Rate */}
  <Column
    field="win_rate"
    header="Win Rate"
    sortable
    filter
    dataType="numeric"
    style={{ width: '120px' }}
    body={(row) => `${row.win_rate.toFixed(1)}%`}
  />

  {/* Column 9: Category */}
  <Column
    field="category"
    header="Category"
    sortable
    filter
    style={{ width: '120px' }}
  />

  {/* Column 10: Contrarian % */}
  <Column
    field="contrarian_score"
    header="Contrarian %"
    sortable
    filter
    dataType="numeric"
    style={{ width: '130px' }}
    body={(row) => `${row.contrarian_score.toFixed(1)}%`}
  />

  {/* Column 11: Contrarian WR */}
  <Column
    field="contrarian_win_rate"
    header="Contrarian WR"
    sortable
    filter
    dataType="numeric"
    style={{ width: '130px' }}
    body={(row) => `${row.contrarian_win_rate.toFixed(1)}%`}
  />
</DataTable>
```

**User Flow**:
1. User sees scatter plot with all positions (Realized PnL vs Total Invested)
2. Points colored by ROI (green = high positive, red = negative)
3. Hovers over bubbles to see position details (market, wallet, PnL, ROI)
4. Clicks bubble to navigate to Market Detail drill-down
5. Scrolls to table to filter/sort by specific metrics (WIS, ROI, contrarian score)
6. Clicks market title to view Market Detail
7. Clicks wallet address to view Wallet Detail

---

### 1.4 Whale Activity

**Purpose**: Grid of 4 charts showing smart money activity over time.

**Route**: `/discovery/whales`

**Layout**: 2x2 grid of ECharts

**Data Requirements**:
```typescript
interface WhaleActivitySnapshot {
  timestamp: Date

  // Chart 1: Smart Money Flow
  smartMoneyInflow: number   // $ net inflow from WIS > 50 wallets
  smartMoneyOutflow: number  // $ net outflow

  // Chart 2: SII Distribution
  marketsHighSII: number     // Count of markets with SII > 50
  marketsLowSII: number      // Count with SII < -50
  marketsNeutral: number     // Count with -50 < SII < 50

  // Chart 3: Whale Position Size
  whalesActiveCount: number  // # of wallets with position > $10k
  totalWhaleVolume: number   // $ total volume from whales

  // Chart 4: Top Whale Moves (bubble chart)
  topWhaleTrades: Array<{
    walletAddress: string
    wis: number
    tradeSize: number        // $
    marketId: string
    marketTitle: string
    side: "YES" | "NO"
    sii: number
  }>
}
```

**API Endpoint**:
```typescript
GET /api/v1/analytics/whale-activity
Query Params:
  - timeRange: "24h" | "7d" | "30d" | "90d"
  - interval: "1h" | "1d" | "1w"
```

**Chart 1: Smart Money Flow (Line + Bar)**
```typescript
const option = {
  title: { text: 'Smart Money Flow', left: 'center' },
  tooltip: { trigger: 'axis' },
  legend: { data: ['Inflow', 'Outflow'], bottom: 0 },
  xAxis: { type: 'time' },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: (v) => `$${(v/1000).toFixed(0)}k` }
  },
  series: [
    {
      name: 'Inflow',
      type: 'bar',
      data: snapshots.map(s => [s.timestamp, s.smartMoneyInflow]),
      itemStyle: { color: '#16a34a' }
    },
    {
      name: 'Outflow',
      type: 'bar',
      data: snapshots.map(s => [s.timestamp, -s.smartMoneyOutflow]),
      itemStyle: { color: '#dc2626' }
    }
  ]
}
```

**Chart 2: SII Distribution (Stacked Area)**
```typescript
const option = {
  title: { text: 'Market SII Distribution', left: 'center' },
  tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
  legend: { data: ['High SII', 'Neutral', 'Low SII'], bottom: 0 },
  xAxis: { type: 'time' },
  yAxis: { type: 'value', name: 'Market Count' },
  series: [
    {
      name: 'High SII',
      type: 'line',
      stack: 'Total',
      areaStyle: { color: '#16a34a' },
      data: snapshots.map(s => [s.timestamp, s.marketsHighSII])
    },
    {
      name: 'Neutral',
      type: 'line',
      stack: 'Total',
      areaStyle: { color: '#9ca3af' },
      data: snapshots.map(s => [s.timestamp, s.marketsNeutral])
    },
    {
      name: 'Low SII',
      type: 'line',
      stack: 'Total',
      areaStyle: { color: '#dc2626' },
      data: snapshots.map(s => [s.timestamp, s.marketsLowSII])
    }
  ]
}
```

**Chart 3: Active Whales (Dual Axis: Count + Volume)**
```typescript
const option = {
  title: { text: 'Active Whales', left: 'center' },
  tooltip: { trigger: 'axis' },
  legend: { data: ['Whale Count', 'Total Volume'], bottom: 0 },
  xAxis: { type: 'time' },
  yAxis: [
    { type: 'value', name: 'Whale Count', position: 'left' },
    { type: 'value', name: 'Volume ($)', position: 'right', axisLabel: { formatter: (v) => `$${(v/1000000).toFixed(1)}M` } }
  ],
  series: [
    {
      name: 'Whale Count',
      type: 'line',
      data: snapshots.map(s => [s.timestamp, s.whalesActiveCount]),
      itemStyle: { color: '#3b82f6' }
    },
    {
      name: 'Total Volume',
      type: 'bar',
      yAxisIndex: 1,
      data: snapshots.map(s => [s.timestamp, s.totalWhaleVolume]),
      itemStyle: { color: '#8b5cf6' }
    }
  ]
}
```

**Chart 4: Top Whale Moves (Bubble Chart - Last 24h)**
```typescript
const option = {
  title: { text: 'Recent Large Trades (Last 24h)', left: 'center' },
  tooltip: {
    formatter: (params) => {
      const trade = params.data
      return `
        <strong>${trade.walletAddress.substring(0, 8)}...</strong><br/>
        WIS: ${trade.wis}<br/>
        Trade: $${trade.tradeSize.toLocaleString()} ${trade.side}<br/>
        Market: ${trade.marketTitle.substring(0, 40)}...<br/>
        Market SII: ${trade.sii}
      `
    }
  },
  xAxis: { name: 'Time (hours ago)', type: 'value', min: -24, max: 0 },
  yAxis: { name: 'Wallet WIS', type: 'value', min: -100, max: 100 },
  series: [
    {
      type: 'scatter',
      data: topWhaleTrades.map(t => ({
        value: [
          -Math.abs(new Date().getTime() - new Date(t.timestamp).getTime()) / (1000 * 60 * 60), // hours ago
          t.wis
        ],
        symbolSize: Math.sqrt(t.tradeSize) / 10, // Bubble size by trade size
        itemStyle: {
          color: t.side === "YES" ? '#16a34a' : '#dc2626',
          opacity: 0.7
        },
        ...t // Pass all trade data for tooltip
      }))
    }
  ]
}
```

**User Flow**:
1. User lands on Whale Activity grid
2. Selects time range (24h / 7d / 30d)
3. Observes trends in smart money flow
4. Clicks on bubble in Chart 4 to see specific trade
5. Navigates to Market Detail or Wallet Detail for deeper analysis

---

### 1.5 Large Trades

**Purpose**: Real-time streaming table of large trades (top 1% volume), showing wallet WIS and market SII.

**Route**: `/discovery/large-trades`

**Layout**: Full-width streaming table with auto-refresh

**Data Requirements**:
```typescript
interface LargeTrade {
  tradeId: string
  timestamp: Date

  // Wallet Info
  walletAddress: string
  wis: number              // Wallet's WIS score

  // Trade Info
  marketId: string
  marketTitle: string
  side: "YES" | "NO"
  price: number            // Entry price
  shares: number
  sizeUsd: number          // $ size

  // Market Context
  sii: number              // Market's current SII
  marketCategory: string

  // Flags
  isWhale: boolean         // Position > $10k
  isContrarian: boolean    // Against smart money bias
}
```

**API Endpoint**:
```typescript
GET /api/v1/trades/large
Query Params:
  - minSize?: number (default: 1000)
  - limit?: number (default: 100)
  - since?: timestamp (for polling)

// WebSocket (real-time)
WS /api/v1/trades/stream
Subscribe: { type: "subscribe", channel: "large_trades", minSize: 1000 }
```

**PrimeVue DataTable Configuration**:
```typescript
<DataTable
  value={trades}
  scrollable
  scrollHeight="calc(100vh - 160px)"
  virtualScrollerOptions={{ itemSize: 46 }}
  sortMode="single"
  sortField="timestamp"
  sortOrder={-1}
  showGridlines
  stripedRows
>
  <Column field="timestamp" header="Time" sortable body={timeAgoBodyTemplate} frozen style={{ width: '100px' }} />
  <Column field="walletAddress" header="Wallet" body={walletLinkTemplate} frozen style={{ width: '140px' }} />
  <Column field="wis" header="WIS" sortable body={wisBodyTemplate} style={{ width: '80px' }} />
  <Column field="marketTitle" header="Market" body={marketLinkTemplate} style={{ minWidth: '300px' }} />
  <Column field="marketCategory" header="Category" body={categoryBadgeTemplate} style={{ width: '120px' }} />
  <Column field="sii" header="SII" sortable body={siiBodyTemplate} style={{ width: '80px' }} />
  <Column field="side" header="Side" body={sideBodyTemplate} style={{ width: '80px' }} />
  <Column field="price" header="Price" body={priceBodyTemplate} style={{ width: '80px' }} />
  <Column field="shares" header="Shares" sortable body={sharesBodyTemplate} style={{ width: '100px' }} />
  <Column field="sizeUsd" header="Size" sortable body={currencyBodyTemplate} style={{ width: '120px' }} />
  <Column field="isWhale" header="Whale" body={whaleBadgeTemplate} style={{ width: '80px' }} />
  <Column field="isContrarian" header="Contrarian" body={contrarianBadgeTemplate} style={{ width: '100px' }} />
</DataTable>
```

**Auto-Refresh Logic**:
```typescript
// Poll every 10 seconds for new trades
useEffect(() => {
  const interval = setInterval(() => {
    fetchNewTrades(lastTradeTimestamp)
  }, 10000)

  return () => clearInterval(interval)
}, [lastTradeTimestamp])

// OR use WebSocket for real-time
useEffect(() => {
  const ws = new WebSocket('wss://api.cascadian.io/v1/trades/stream')

  ws.onmessage = (event) => {
    const newTrade = JSON.parse(event.data)
    setTrades(prev => [newTrade, ...prev].slice(0, 100)) // Keep last 100
  }

  return () => ws.close()
}, [])
```

**Custom Body Templates**:
```typescript
const timeAgoBodyTemplate = (rowData) => {
  const minutes = Math.floor((Date.now() - new Date(rowData.timestamp).getTime()) / 60000)
  return <span className="text-muted-foreground">{minutes}m ago</span>
}

const sideBodyTemplate = (rowData) => {
  const color = rowData.side === "YES" ? "text-green-600" : "text-red-600"
  return <Badge variant={rowData.side === "YES" ? "success" : "destructive"}>{rowData.side}</Badge>
}

const whaleBadgeTemplate = (rowData) => {
  return rowData.isWhale ? <Badge variant="secondary">🐋 Whale</Badge> : null
}

const contrarianBadgeTemplate = (rowData) => {
  return rowData.isContrarian ? <Badge variant="outline">⚡ Contrarian</Badge> : null
}
```

**User Flow**:
1. User lands on Large Trades streaming table
2. Table auto-updates every 10 seconds (or real-time via WebSocket)
3. New trades appear at top with subtle animation
4. User clicks wallet address to view Wallet Detail
5. User clicks market title to view Market Detail
6. User filters by category, min size, whale/contrarian flags

---

## 2. Traders Hub

The Traders Hub helps users analyze smart wallets and their trading patterns.

### 2.1 Trader Explorer

**Purpose**: Comprehensive trader screener with sorting/filtering by WIS and performance metrics.

**Route**: `/traders/explorer`

**Layout**: Full-width table with sticky header

**Data Requirements**: (Same as LeaderboardWallet from 1.3)
```typescript
interface TraderProfile {
  walletAddress: string
  wis: number                // -100 to +100
  totalPnL: number
  totalVolume: number
  winRate: number
  omegaRatio: number
  sharpeRatio: number
  tradesCount: number
  avgTradeSize: number
  contrarian_score: number   // 0-100%
  contrarian_win_rate: number
  specialty: string[]        // ["Politics", "Sports"]
  activePositions: number    // Current open positions
  lastTradeAt: Date
  createdAt: Date            // First trade date
}
```

**API Endpoint**:
```typescript
GET /api/v1/wallets/explorer
Query Params:
  - minWIS?: number
  - maxWIS?: number
  - minPnL?: number
  - minWinRate?: number
  - specialty?: string[]
  - minTradesCount?: number
  - hasActivePositions?: boolean
  - sort?: string (default: "wis:desc")
  - limit?: number (default: 100)
```

**PrimeVue DataTable Configuration**:
```typescript
<DataTable
  value={traders}
  scrollable
  scrollHeight="calc(100vh - 200px)"
  virtualScrollerOptions={{ itemSize: 46 }}
  filterDisplay="row"
  sortMode="multiple"
  resizableColumns
  showGridlines
>
  <Column field="walletAddress" header="Wallet" sortable filter body={walletLinkTemplate} frozen style={{ minWidth: '160px' }} />
  <Column field="wis" header="WIS" sortable filter dataType="numeric" body={wisBodyTemplate} style={{ width: '100px' }} />
  <Column field="totalPnL" header="Total PnL" sortable filter dataType="numeric" body={currencyColorBodyTemplate} style={{ width: '140px' }} />
  <Column field="totalVolume" header="Volume" sortable filter dataType="numeric" body={currencyBodyTemplate} style={{ width: '140px' }} />
  <Column field="winRate" header="Win Rate" sortable filter dataType="numeric" body={percentBarBodyTemplate} style={{ width: '140px' }} />
  <Column field="omegaRatio" header="Omega" sortable filter dataType="numeric" body={ratioBodyTemplate} style={{ width: '100px' }} />
  <Column field="sharpeRatio" header="Sharpe" sortable filter dataType="numeric" body={ratioBodyTemplate} style={{ width: '100px' }} />
  <Column field="tradesCount" header="Trades" sortable filter dataType="numeric" style={{ width: '100px' }} />
  <Column field="avgTradeSize" header="Avg Size" sortable filter dataType="numeric" body={currencyBodyTemplate} style={{ width: '120px' }} />
  <Column field="contrarian_score" header="Contrarian %" sortable filter dataType="numeric" body={percentBodyTemplate} style={{ width: '140px' }} />
  <Column field="contrarian_win_rate" header="Contrarian WR" sortable filter dataType="numeric" body={percentBodyTemplate} style={{ width: '140px' }} />
  <Column field="specialty" header="Specialty" sortable filter body={specialtyBadgesTemplate} style={{ width: '200px' }} />
  <Column field="activePositions" header="Active Pos" sortable filter dataType="numeric" style={{ width: '120px' }} />
  <Column field="lastTradeAt" header="Last Trade" sortable body={dateBodyTemplate} style={{ width: '140px' }} />
  <Column body={actionsBodyTemplate} frozen alignFrozen="right" style={{ width: '120px' }} />
</DataTable>
```

**Custom Body Templates**:
```typescript
const wisBodyTemplate = (rowData) => {
  let color = 'text-gray-600'
  let bgColor = 'bg-gray-100'

  if (rowData.wis > 70) { color = 'text-green-700'; bgColor = 'bg-green-50' }
  else if (rowData.wis > 40) { color = 'text-green-600'; bgColor = 'bg-green-50' }
  else if (rowData.wis < -70) { color = 'text-red-700'; bgColor = 'bg-red-50' }
  else if (rowData.wis < -40) { color = 'text-red-600'; bgColor = 'bg-red-50' }

  return (
    <div className={`flex items-center justify-center ${bgColor} rounded px-2 py-1`}>
      <span className={`font-bold ${color}`}>{rowData.wis}</span>
    </div>
  )
}

const currencyColorBodyTemplate = (rowData) => {
  const color = rowData.totalPnL > 0 ? 'text-green-600' : 'text-red-600'
  const sign = rowData.totalPnL > 0 ? '+' : ''
  return <span className={`font-semibold ${color}`}>{sign}${rowData.totalPnL.toLocaleString()}</span>
}

const percentBarBodyTemplate = (rowData) => {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono">{rowData.winRate.toFixed(1)}%</span>
      <Progress value={rowData.winRate} className="w-16 h-2" />
    </div>
  )
}

const ratioBodyTemplate = (rowData) => {
  const value = rowData.omegaRatio || rowData.sharpeRatio
  const color = value > 1.5 ? 'text-green-600' : value > 1.0 ? 'text-gray-600' : 'text-red-600'
  return <span className={color}>{value.toFixed(2)}</span>
}

const specialtyBadgesTemplate = (rowData) => {
  return (
    <div className="flex flex-wrap gap-1">
      {rowData.specialty.map(s => (
        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
      ))}
    </div>
  )
}
```

**Filters**:
- Text search on wallet address
- WIS range slider (-100 to +100)
- PnL range (min/max)
- Win Rate range (0-100%)
- Specialty multi-select
- Min trades count
- Active positions only toggle
- Last trade date range

**User Flow**:
1. User lands on Trader Explorer
2. Filters by minWIS (e.g., > 60) and specialty (e.g., "Politics")
3. Sorts by "Total PnL" descending
4. Clicks wallet address to view Wallet Detail drill-down
5. Clicks "Follow" button to add wallet to watchlist

---

### 2.2 Live Smart Trades

**Purpose**: Real-time feed of trades from high-WIS wallets (WIS > 60).

**Route**: `/traders/smart-trades`

**Layout**: Full-width streaming table with auto-refresh

**Data Requirements**:
```typescript
interface SmartTrade {
  tradeId: string
  timestamp: Date

  // Wallet Info
  walletAddress: string
  wis: number              // Must be > 60
  walletWinRate: number
  walletSpecialty: string[]

  // Trade Info
  marketId: string
  marketTitle: string
  side: "YES" | "NO"
  price: number
  shares: number
  sizeUsd: number

  // Market Context
  sii: number
  smartMoneyBias: "YES" | "NO" | "NEUTRAL"

  // Trade Context
  isContrarian: boolean    // Against smart money bias
  isNewPosition: boolean   // First trade in this market for this wallet
  positionSizeNow: number  // Total position in this market after trade
}
```

**API Endpoint**:
```typescript
GET /api/v1/trades/smart
Query Params:
  - minWIS?: number (default: 60)
  - limit?: number (default: 100)
  - since?: timestamp (for polling)

// WebSocket (real-time)
WS /api/v1/trades/stream
Subscribe: { type: "subscribe", channel: "smart_trades", minWIS: 60 }
```

**PrimeVue DataTable Configuration**:
```typescript
<DataTable
  value={smartTrades}
  scrollable
  scrollHeight="calc(100vh - 200px)"
  virtualScrollerOptions={{ itemSize: 46 }}
  sortMode="single"
  sortField="timestamp"
  sortOrder={-1}
  showGridlines
>
  <Column field="timestamp" header="Time" sortable body={timeAgoBodyTemplate} frozen style={{ width: '100px' }} />
  <Column field="walletAddress" header="Wallet" body={walletLinkTemplate} frozen style={{ width: '140px' }} />
  <Column field="wis" header="WIS" sortable body={wisBodyTemplate} style={{ width: '80px' }} />
  <Column field="walletWinRate" header="WR" sortable body={percentBodyTemplate} style={{ width: '80px' }} />
  <Column field="walletSpecialty" header="Specialty" body={specialtyBadgesTemplate} style={{ width: '160px' }} />
  <Column field="marketTitle" header="Market" body={marketLinkTemplate} style={{ minWidth: '300px' }} />
  <Column field="sii" header="SII" sortable body={siiBodyTemplate} style={{ width: '80px' }} />
  <Column field="smartMoneyBias" header="Bias" body={biasBadgeTemplate} style={{ width: '100px' }} />
  <Column field="side" header="Side" body={sideBodyTemplate} style={{ width: '80px' }} />
  <Column field="price" header="Price" body={priceBodyTemplate} style={{ width: '80px' }} />
  <Column field="sizeUsd" header="Size" sortable body={currencyBodyTemplate} style={{ width: '120px' }} />
  <Column field="isContrarian" header="Contrarian" body={contrarianBadgeTemplate} style={{ width: '100px' }} />
  <Column field="isNewPosition" header="New" body={newPositionBadgeTemplate} style={{ width: '80px' }} />
  <Column field="positionSizeNow" header="Position" body={currencyBodyTemplate} style={{ width: '120px' }} />
</DataTable>
```

**Real-Time Updates**:
```typescript
// WebSocket connection with visual notification for new trades
const [newTradeIds, setNewTradeIds] = useState<Set<string>>(new Set())

ws.onmessage = (event) => {
  const newTrade = JSON.parse(event.data)

  // Add to top of list with highlight
  setSmartTrades(prev => [newTrade, ...prev].slice(0, 100))

  // Add to highlight set (remove after 5 seconds)
  setNewTradeIds(prev => new Set([...prev, newTrade.tradeId]))
  setTimeout(() => {
    setNewTradeIds(prev => {
      const next = new Set(prev)
      next.delete(newTrade.tradeId)
      return next
    })
  }, 5000)

  // Show toast notification for very large trades (>$5k)
  if (newTrade.sizeUsd > 5000) {
    toast({
      title: "🐋 Large Smart Trade",
      description: `${newTrade.walletAddress.substring(0, 8)}... bought $${newTrade.sizeUsd.toLocaleString()} ${newTrade.side}`,
      duration: 3000
    })
  }
}

// Apply highlight class to new trades
const rowClassName = (rowData) => {
  return newTradeIds.has(rowData.tradeId) ? 'bg-blue-50 animate-pulse' : ''
}
```

**Filters**:
- Min WIS threshold (default 60, adjustable)
- Specialty filter
- Side filter (YES/NO/Both)
- Contrarian only toggle
- New positions only toggle
- Min size filter

**User Flow**:
1. User lands on Live Smart Trades
2. Sees real-time feed of high-WIS trades
3. Gets toast notification for very large trades (>$5k)
4. Filters to contrarian trades only
5. Clicks wallet to view Wallet Detail
6. Clicks market to view Market Detail

---

### 2.3 Possible Insiders

**Purpose**: Identify wallets that may have insider information based on early entry + high conviction + good outcomes.

**Route**: `/traders/insiders`

**Layout**: Table with "Insider Score" + evidence cards

**Data Requirements**:
```typescript
interface PossibleInsider {
  walletAddress: string
  insiderScore: number      // 0-100 (composite score)
  wis: number

  // Evidence Signals
  earlyEntryRate: number    // % of trades in first 10% of market lifetime
  avgEntryPrice: number     // Avg price at entry (closer to 50¢ = earlier)
  convictionRate: number    // % of trades > $1k
  avgPositionSize: number   // $ avg position size
  fastWinRate: number       // Win rate on trades closed within 7 days
  contrarian_score: number
  contrarian_win_rate: number

  // Recent Activity
  suspiciousMarketsCount: number  // Markets where they entered early + won
  recentSuspiciousTrades: Array<{
    marketId: string
    marketTitle: string
    entryTimestamp: Date
    entryPrice: number
    marketCreatedAt: Date
    hoursAfterCreation: number  // Hours between market creation and entry
    outcome: "WIN" | "LOSS" | "OPEN"
    pnl: number
  }>
}
```

**Insider Score Calculation**:
```typescript
// Composite score (0-100)
insiderScore = (
  earlyEntryRate * 0.3 +        // Weight: 30% (very important)
  convictionRate * 0.2 +         // Weight: 20%
  fastWinRate * 0.25 +           // Weight: 25%
  contrarian_win_rate * 0.15 +   // Weight: 15%
  (avgEntryPrice < 0.55 ? 10 : 0) // Bonus for very early entries
)
```

**API Endpoint**:
```typescript
GET /api/v1/wallets/insiders
Query Params:
  - minInsiderScore?: number (default: 60)
  - minSuspiciousMarkets?: number (default: 3)
  - timeRange?: "30d" | "90d" | "all"
  - sort?: string (default: "insiderScore:desc")
  - limit?: number (default: 50)
```

**PrimeVue DataTable Configuration**:
```typescript
<DataTable
  value={insiders}
  scrollable
  scrollHeight="calc(100vh - 200px)"
  expandedRows={expandedRows}
  onRowToggle={(e) => setExpandedRows(e.data)}
  rowExpansionTemplate={insiderDetailTemplate}
>
  <Column expander style={{ width: '50px' }} />
  <Column field="walletAddress" header="Wallet" body={walletLinkTemplate} frozen style={{ minWidth: '160px' }} />
  <Column field="insiderScore" header="Insider Score" sortable body={insiderScoreBodyTemplate} style={{ width: '140px' }} />
  <Column field="wis" header="WIS" sortable body={wisBodyTemplate} style={{ width: '100px' }} />
  <Column field="earlyEntryRate" header="Early Entry %" sortable body={percentBarBodyTemplate} style={{ width: '140px' }} />
  <Column field="avgEntryPrice" header="Avg Entry Price" sortable body={priceBodyTemplate} style={{ width: '140px' }} />
  <Column field="convictionRate" header="Conviction %" sortable body={percentBodyTemplate} style={{ width: '140px' }} />
  <Column field="avgPositionSize" header="Avg Position" sortable body={currencyBodyTemplate} style={{ width: '140px' }} />
  <Column field="fastWinRate" header="Fast WR" sortable body={percentBarBodyTemplate} style={{ width: '140px' }} />
  <Column field="contrarian_win_rate" header="Contrarian WR" sortable body={percentBodyTemplate} style={{ width: '140px' }} />
  <Column field="suspiciousMarketsCount" header="Suspicious Markets" sortable style={{ width: '160px' }} />
</DataTable>
```

**Custom Body Templates**:
```typescript
const insiderScoreBodyTemplate = (rowData) => {
  let color = 'text-gray-600'
  let bgColor = 'bg-gray-100'
  let icon = '📊'

  if (rowData.insiderScore > 80) {
    color = 'text-red-700';
    bgColor = 'bg-red-50';
    icon = '🚨'
  } else if (rowData.insiderScore > 60) {
    color = 'text-orange-600';
    bgColor = 'bg-orange-50';
    icon = '⚠️'
  }

  return (
    <div className={`flex items-center gap-2 ${bgColor} rounded px-3 py-1`}>
      <span className="text-lg">{icon}</span>
      <span className={`font-bold ${color}`}>{rowData.insiderScore.toFixed(0)}</span>
    </div>
  )
}

// Row expansion template showing evidence
const insiderDetailTemplate = (rowData) => {
  return (
    <div className="p-4 bg-gray-50">
      <h4 className="font-semibold mb-3">Recent Suspicious Trades</h4>
      <div className="space-y-2">
        {rowData.recentSuspiciousTrades.map(trade => (
          <div key={trade.marketId} className="bg-white p-3 rounded border">
            <div className="flex justify-between items-start mb-2">
              <Link href={`/analysis/market/${trade.marketId}`} className="text-blue-600 hover:underline font-medium">
                {trade.marketTitle}
              </Link>
              <Badge variant={trade.outcome === "WIN" ? "success" : trade.outcome === "LOSS" ? "destructive" : "secondary"}>
                {trade.outcome}
              </Badge>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm text-muted-foreground">
              <div>
                <span className="font-medium">Entry:</span> {trade.hoursAfterCreation.toFixed(1)}h after creation
              </div>
              <div>
                <span className="font-medium">Price:</span> {(trade.entryPrice * 100).toFixed(1)}¢
              </div>
              <div>
                <span className="font-medium">Date:</span> {new Date(trade.entryTimestamp).toLocaleDateString()}
              </div>
              <div>
                <span className="font-medium">PnL:</span>
                <span className={trade.pnl > 0 ? 'text-green-600' : 'text-red-600'}>
                  {trade.pnl > 0 ? '+' : ''}${trade.pnl.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**User Flow**:
1. User lands on Possible Insiders
2. Sees table sorted by Insider Score (highest first)
3. Clicks expander arrow to see evidence (recent suspicious trades)
4. Reviews early entry patterns and win rates
5. Clicks wallet to view full Wallet Detail
6. Adds wallet to watchlist for monitoring

---

## 3. Analysis Hub (Drill-Downs)

Deep-dive views accessed from Discovery/Traders hubs.

### 3.1 Market Detail

**Purpose**: Complete analysis of a single market with price history, SII over time, order book, and smart money activity.

**Route**: `/analysis/market/[marketId]`

**Layout**: Multi-section page with 6 main areas

**Data Requirements**:
```typescript
interface MarketDetail {
  // Header
  marketId: string
  title: string
  description: string
  category: string
  outcomes: Array<{
    name: string       // "YES" | "NO"
    price: number
    shares: number
    liquidity: number
  }>
  endDate: Date
  volume: number

  // Current Signals
  sii: number               // -100 to +100 (hero signal)
  momentum: number          // 0-100 (hero signal)
  volatility: number        // 7-day volatility
  spread_bps: number        // Bid-ask spread

  // On-Demand Flags (only if computed by strategy)
  is_rigged?: boolean       // Only present if computed
  is_googleable?: boolean   // Only present if computed

  // Price Chart Data
  priceHistory: Array<{
    timestamp: Date
    price: number      // YES price
    volume: number
  }>

  // SII Chart Data
  siiHistory: Array<{
    timestamp: Date
    sii: number
    smartMoneyYesVolume: number
    smartMoneyNoVolume: number
  }>

  // Smart Money Breakdown
  smartMoneyPositions: Array<{
    walletAddress: string
    wis: number
    side: "YES" | "NO"
    shares: number
    avgPrice: number
    currentValue: number
    pnl: number
  }>

  // Order Book
  orderBook: {
    bids: Array<{ price: number; size: number }>  // Buy YES orders
    asks: Array<{ price: number; size: number }>  // Sell YES orders
  }

  // Recent Activity
  recentTrades: Array<{
    timestamp: Date
    walletAddress: string
    wis: number
    side: "YES" | "NO"
    price: number
    shares: number
    sizeUsd: number
  }>
}
```

**API Endpoint**:
```typescript
GET /api/v1/markets/:marketId/detail
Query Params:
  - priceHistory: "24h" | "7d" | "30d" | "all"
  - includeOrderBook: boolean
```

**Section 1: Header with Key Metrics**
```typescript
<div className="bg-card p-6 rounded-lg border">
  <div className="flex justify-between items-start mb-4">
    <div className="flex-1">
      <h1 className="text-2xl font-bold mb-2">{market.title}</h1>
      <p className="text-muted-foreground mb-4">{market.description}</p>
      <div className="flex gap-2">
        <Badge>{market.category}</Badge>
        <Badge variant="outline">Closes: {formatDate(market.endDate)}</Badge>
      </div>
    </div>
    <div className="text-right">
      <div className="text-3xl font-bold text-green-600">
        {(market.outcomes[0].price * 100).toFixed(1)}¢
      </div>
      <div className="text-sm text-muted-foreground">YES Price</div>
    </div>
  </div>

  <div className="grid grid-cols-4 gap-4">
    <div>
      <div className="text-sm text-muted-foreground">SII</div>
      <div className={`text-2xl font-bold ${getSIIColor(market.sii)}`}>
        {market.sii}
      </div>
    </div>
    <div>
      <div className="text-sm text-muted-foreground">Momentum</div>
      <div className="text-2xl font-bold">{market.momentum}</div>
    </div>
    <div>
      <div className="text-sm text-muted-foreground">24h Volume</div>
      <div className="text-2xl font-bold">${(market.volume / 1000).toFixed(1)}k</div>
    </div>
    <div>
      <div className="text-sm text-muted-foreground">Liquidity</div>
      <div className="text-2xl font-bold">${(market.outcomes[0].liquidity / 1000).toFixed(1)}k</div>
    </div>
  </div>

  <div className="mt-4 grid grid-cols-2 gap-4">
    <div>
      <div className="text-sm text-muted-foreground">Volatility (7d)</div>
      <div className="text-lg font-semibold">{market.volatility.toFixed(2)}</div>
    </div>
    <div>
      <div className="text-sm text-muted-foreground">Spread</div>
      <div className="text-lg font-semibold">{market.spread_bps} bps</div>
    </div>
  </div>

  {/* On-Demand Flags (only shown if computed by strategy) */}
  {(market.is_rigged !== undefined || market.is_googleable !== undefined) && (
    <div className="mt-4 flex gap-4">
      {market.is_rigged !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Rigged:</span>
          {market.is_rigged ? <Badge variant="destructive">🚩 Flagged</Badge> : <Badge variant="secondary">✓ Clean</Badge>}
        </div>
      )}
      {market.is_googleable !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Googleable:</span>
          {market.is_googleable ? <Badge variant="secondary">✓ Yes</Badge> : <Badge variant="outline">No</Badge>}
        </div>
      )}
    </div>
  )}
</div>
```

**Section 2: Price Chart (ECharts Candlestick)**
```typescript
const priceChartOption = {
  title: { text: 'Price History', left: 'center' },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross' }
  },
  grid: { bottom: 100 },
  xAxis: { type: 'time' },
  yAxis: {
    type: 'value',
    scale: true,
    axisLabel: { formatter: (v) => `${(v * 100).toFixed(0)}¢` }
  },
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { show: true, type: 'slider', top: '90%', start: 0, end: 100 }
  ],
  series: [
    {
      name: 'Price',
      type: 'line',
      data: market.priceHistory.map(p => [p.timestamp, p.price]),
      smooth: true,
      lineStyle: { color: '#16a34a', width: 2 },
      areaStyle: { color: 'rgba(22, 163, 74, 0.1)' }
    }
  ]
}
```

**Section 3: SII Over Time (ECharts Dual Axis)**
```typescript
const siiChartOption = {
  title: { text: 'SII & Smart Money Flow', left: 'center' },
  tooltip: { trigger: 'axis' },
  legend: { data: ['SII', 'Smart YES Volume', 'Smart NO Volume'], bottom: 0 },
  xAxis: { type: 'time' },
  yAxis: [
    { type: 'value', name: 'SII', position: 'left', min: -100, max: 100 },
    { type: 'value', name: 'Volume ($)', position: 'right', axisLabel: { formatter: (v) => `$${(v/1000).toFixed(0)}k` } }
  ],
  series: [
    {
      name: 'SII',
      type: 'line',
      data: market.siiHistory.map(s => [s.timestamp, s.sii]),
      smooth: true,
      lineStyle: { color: '#3b82f6', width: 3 }
    },
    {
      name: 'Smart YES Volume',
      type: 'bar',
      yAxisIndex: 1,
      data: market.siiHistory.map(s => [s.timestamp, s.smartMoneyYesVolume]),
      itemStyle: { color: '#16a34a' }
    },
    {
      name: 'Smart NO Volume',
      type: 'bar',
      yAxisIndex: 1,
      data: market.siiHistory.map(s => [s.timestamp, -s.smartMoneyNoVolume]),
      itemStyle: { color: '#dc2626' }
    }
  ]
}
```

**Section 4: Smart Money Positions (PrimeVue Table)**
```typescript
<div className="mt-6">
  <h3 className="text-lg font-semibold mb-3">Smart Money Positions (WIS > 50)</h3>
  <DataTable value={market.smartMoneyPositions} sortMode="multiple">
    <Column field="walletAddress" header="Wallet" body={walletLinkTemplate} />
    <Column field="wis" header="WIS" sortable body={wisBodyTemplate} />
    <Column field="side" header="Side" sortable body={sideBodyTemplate} />
    <Column field="shares" header="Shares" sortable />
    <Column field="avgPrice" header="Avg Price" sortable body={priceBodyTemplate} />
    <Column field="currentValue" header="Value" sortable body={currencyBodyTemplate} />
    <Column field="pnl" header="PnL" sortable body={currencyColorBodyTemplate} />
  </DataTable>
</div>
```

**Section 5: Order Book (Real-Time)**
```typescript
<div className="mt-6 grid grid-cols-2 gap-4">
  <div>
    <h3 className="text-lg font-semibold mb-3 text-green-600">Bids (Buy YES)</h3>
    <div className="space-y-1">
      {market.orderBook.bids.map((bid, i) => (
        <div key={i} className="flex justify-between items-center p-2 bg-green-50 rounded">
          <span className="font-mono">{(bid.price * 100).toFixed(1)}¢</span>
          <span className="text-sm text-muted-foreground">{bid.size.toFixed(0)} shares</span>
        </div>
      ))}
    </div>
  </div>
  <div>
    <h3 className="text-lg font-semibold mb-3 text-red-600">Asks (Sell YES)</h3>
    <div className="space-y-1">
      {market.orderBook.asks.map((ask, i) => (
        <div key={i} className="flex justify-between items-center p-2 bg-red-50 rounded">
          <span className="font-mono">{(ask.price * 100).toFixed(1)}¢</span>
          <span className="text-sm text-muted-foreground">{ask.size.toFixed(0)} shares</span>
        </div>
      ))}
    </div>
  </div>
</div>
```

**Section 6: Recent Trades (Streaming Table)**
```typescript
<div className="mt-6">
  <h3 className="text-lg font-semibold mb-3">Recent Trades</h3>
  <DataTable
    value={market.recentTrades}
    scrollable
    scrollHeight="300px"
    sortField="timestamp"
    sortOrder={-1}
  >
    <Column field="timestamp" header="Time" body={timeAgoBodyTemplate} />
    <Column field="walletAddress" header="Wallet" body={walletLinkTemplate} />
    <Column field="wis" header="WIS" body={wisBodyTemplate} />
    <Column field="side" header="Side" body={sideBodyTemplate} />
    <Column field="price" header="Price" body={priceBodyTemplate} />
    <Column field="sizeUsd" header="Size" body={currencyBodyTemplate} />
  </DataTable>
</div>
```

**User Flow**:
1. User clicks market from Discovery Hub (Market Screener, Market Map, etc.)
2. Lands on Market Detail page
3. Views price history and SII trends
4. Scrolls to see smart money positions (who's betting what)
5. Checks order book for entry opportunities
6. Clicks wallet to drill into Wallet Detail
7. Adds market to watchlist or triggers manual bet

---

### 3.2 Wallet Detail

**Purpose**: Complete analysis of a single wallet with all trades, positions, performance metrics, and specialty breakdown.

**Route**: `/analysis/wallet/[walletAddress]`

**Layout**: Multi-section page with 7 main areas

**Data Requirements**:
```typescript
interface WalletDetail {
  // Header
  walletAddress: string
  ens: string | null  // ENS name if available

  // Core Metrics
  wis: number
  totalPnL: number
  totalVolume: number
  winRate: number
  omegaRatio: number
  sharpeRatio: number
  tradesCount: number
  avgTradeSize: number
  contrarian_score: number
  contrarian_win_rate: number

  // Specialty Breakdown
  specialtyStats: Array<{
    category: string
    tradesCount: number
    winRate: number
    pnl: number
    volume: number
  }>

  // PnL Over Time
  pnlHistory: Array<{
    timestamp: Date
    cumulativePnL: number
    dailyPnL: number
  }>

  // Active Positions
  activePositions: Array<{
    marketId: string
    marketTitle: string
    side: "YES" | "NO"
    shares: number
    avgPrice: number
    currentPrice: number
    marketValue: number
    pnl: number
    marketCategory: string
    marketSII: number
  }>

  // Trade History
  tradeHistory: Array<{
    tradeId: string
    timestamp: Date
    marketId: string
    marketTitle: string
    side: "YES" | "NO"
    price: number
    shares: number
    sizeUsd: number
    marketSII: number
    outcome: "WIN" | "LOSS" | "OPEN"
    pnl: number | null
  }>

  // Contrarian Trades
  contrarianTrades: Array<{
    marketId: string
    marketTitle: string
    side: "YES" | "NO"
    entryPrice: number
    smartMoneyBias: "YES" | "NO"
    outcome: "WIN" | "LOSS" | "OPEN"
    pnl: number
  }>
}
```

**API Endpoint**:
```typescript
GET /api/v1/wallets/:walletAddress/detail
Query Params:
  - includeHistory: boolean
  - historyLimit: number (default: 100)
```

**Section 1: Header with Key Metrics**
```typescript
<div className="bg-card p-6 rounded-lg border">
  <div className="flex justify-between items-start mb-6">
    <div>
      <h1 className="text-2xl font-bold mb-1">
        {wallet.ens || `${wallet.walletAddress.substring(0, 10)}...${wallet.walletAddress.slice(-8)}`}
      </h1>
      <p className="text-sm text-muted-foreground font-mono">{wallet.walletAddress}</p>
    </div>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => copyToClipboard(wallet.walletAddress)}>
        <Copy className="h-4 w-4 mr-2" />
        Copy Address
      </Button>
      <Button onClick={() => addToWatchlist(wallet.walletAddress)}>
        <Star className="h-4 w-4 mr-2" />
        Follow
      </Button>
    </div>
  </div>

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
    <div className="text-center p-4 bg-amber-50 rounded">
      <div className="text-sm text-muted-foreground mb-1">Contrarian Score</div>
      <div className="text-3xl font-bold text-amber-600">{wallet.contrarian_score.toFixed(1)}%</div>
    </div>
    <div className="text-center p-4 bg-cyan-50 rounded">
      <div className="text-sm text-muted-foreground mb-1">Contrarian WR</div>
      <div className="text-3xl font-bold text-cyan-600">{wallet.contrarian_win_rate.toFixed(1)}%</div>
    </div>
    <div className="text-center p-4 bg-purple-50 rounded">
      <div className="text-sm text-muted-foreground mb-1">Omega Ratio</div>
      <div className="text-3xl font-bold text-purple-600">{wallet.omegaRatio.toFixed(2)}</div>
    </div>
  </div>

  <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
    <div>
      <span className="text-muted-foreground">Total Volume:</span>
      <span className="font-semibold ml-2">${(wallet.totalVolume / 1000).toFixed(1)}k</span>
    </div>
    <div>
      <span className="text-muted-foreground">Total Trades:</span>
      <span className="font-semibold ml-2">{wallet.tradesCount}</span>
    </div>
    <div>
      <span className="text-muted-foreground">Avg Trade Size:</span>
      <span className="font-semibold ml-2">${wallet.avgTradeSize.toFixed(0)}</span>
    </div>
    <div>
      <span className="text-muted-foreground">Sharpe Ratio:</span>
      <span className="font-semibold ml-2">{wallet.sharpeRatio.toFixed(2)}</span>
    </div>
  </div>
</div>
```

**Section 2: Specialty Breakdown (ECharts Pie + Bar)**
```typescript
<div className="mt-6 grid grid-cols-2 gap-4">
  <div>
    <h3 className="text-lg font-semibold mb-3">Trade Distribution by Category</h3>
    <ReactECharts
      option={{
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie',
          radius: '50%',
          data: wallet.specialtyStats.map(s => ({
            name: s.category,
            value: s.tradesCount
          }))
        }]
      }}
      style={{ height: '300px' }}
    />
  </div>
  <div>
    <h3 className="text-lg font-semibold mb-3">Win Rate by Category</h3>
    <ReactECharts
      option={{
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: wallet.specialtyStats.map(s => s.category) },
        yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
        series: [{
          type: 'bar',
          data: wallet.specialtyStats.map(s => s.winRate),
          itemStyle: {
            color: (params) => params.value > 70 ? '#16a34a' : params.value > 50 ? '#9ca3af' : '#dc2626'
          }
        }]
      }}
      style={{ height: '300px' }}
    />
  </div>
</div>
```

**Section 3: PnL Over Time (ECharts Area Chart)**
```typescript
const pnlChartOption = {
  title: { text: 'Cumulative PnL', left: 'center' },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross' }
  },
  xAxis: { type: 'time' },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: (v) => `$${(v/1000).toFixed(0)}k` }
  },
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { show: true, type: 'slider', bottom: 10, start: 0, end: 100 }
  ],
  series: [
    {
      name: 'Cumulative PnL',
      type: 'line',
      data: wallet.pnlHistory.map(p => [p.timestamp, p.cumulativePnL]),
      smooth: true,
      lineStyle: { color: '#16a34a', width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(22, 163, 74, 0.3)' },
            { offset: 1, color: 'rgba(22, 163, 74, 0.05)' }
          ]
        }
      }
    }
  ]
}
```

**Section 4: Active Positions (PrimeVue Table)**
```typescript
<div className="mt-6">
  <h3 className="text-lg font-semibold mb-3">Active Positions ({wallet.activePositions.length})</h3>
  <DataTable
    value={wallet.activePositions}
    sortMode="multiple"
    scrollable
    scrollHeight="400px"
  >
    <Column field="marketTitle" header="Market" body={marketLinkTemplate} style={{ minWidth: '300px' }} />
    <Column field="marketCategory" header="Category" body={categoryBadgeTemplate} />
    <Column field="marketSII" header="Market SII" sortable body={siiBodyTemplate} />
    <Column field="side" header="Side" sortable body={sideBodyTemplate} />
    <Column field="shares" header="Shares" sortable />
    <Column field="avgPrice" header="Avg Price" sortable body={priceBodyTemplate} />
    <Column field="currentPrice" header="Current" sortable body={priceBodyTemplate} />
    <Column field="marketValue" header="Value" sortable body={currencyBodyTemplate} />
    <Column field="pnl" header="PnL" sortable body={currencyColorBodyTemplate} />
  </DataTable>
</div>
```

**Section 5: Trade History (PrimeVue Table with Filters)**
```typescript
<div className="mt-6">
  <h3 className="text-lg font-semibold mb-3">Trade History ({wallet.tradesCount} total)</h3>
  <DataTable
    value={wallet.tradeHistory}
    sortMode="multiple"
    filterDisplay="row"
    scrollable
    scrollHeight="500px"
    virtualScrollerOptions={{ itemSize: 46 }}
  >
    <Column field="timestamp" header="Date" sortable body={dateBodyTemplate} filter filterElement={dateFilterTemplate} />
    <Column field="marketTitle" header="Market" filter body={marketLinkTemplate} style={{ minWidth: '300px' }} />
    <Column field="side" header="Side" sortable filter filterElement={sideFilterTemplate} body={sideBodyTemplate} />
    <Column field="price" header="Price" sortable body={priceBodyTemplate} />
    <Column field="shares" header="Shares" sortable />
    <Column field="sizeUsd" header="Size" sortable filter dataType="numeric" body={currencyBodyTemplate} />
    <Column field="marketSII" header="SII" sortable filter dataType="numeric" body={siiBodyTemplate} />
    <Column field="outcome" header="Outcome" sortable filter filterElement={outcomeFilterTemplate} body={outcomeBodyTemplate} />
    <Column field="pnl" header="PnL" sortable filter dataType="numeric" body={currencyColorBodyTemplate} />
  </DataTable>
</div>
```

**Section 6: Contrarian Trades Analysis**
```typescript
<div className="mt-6">
  <h3 className="text-lg font-semibold mb-3">
    Contrarian Trades ({wallet.contrarianTrades.length})
    - Win Rate: {wallet.contrarian_win_rate.toFixed(1)}%
  </h3>
  <DataTable
    value={wallet.contrarianTrades}
    sortMode="single"
    sortField="pnl"
    sortOrder={-1}
  >
    <Column field="marketTitle" header="Market" body={marketLinkTemplate} style={{ minWidth: '300px' }} />
    <Column field="side" header="Side" body={sideBodyTemplate} />
    <Column field="smartMoneyBias" header="Smart Bias" body={biasBadgeTemplate} />
    <Column field="entryPrice" header="Entry" body={priceBodyTemplate} />
    <Column field="outcome" header="Outcome" body={outcomeBodyTemplate} />
    <Column field="pnl" header="PnL" sortable body={currencyColorBodyTemplate} />
  </DataTable>
</div>
```

**User Flow**:
1. User clicks wallet from Discovery/Traders Hub
2. Lands on Wallet Detail page
3. Views WIS, PnL, win rate, risk metrics
4. Scrolls to see specialty breakdown (which categories they trade)
5. Views PnL chart over time
6. Checks active positions to see current exposure
7. Reviews trade history to understand patterns
8. Analyzes contrarian trades to see if they're a "fade the crowd" trader
9. Clicks "Follow" to add to watchlist
10. Clicks market titles to drill into Market Detail

---

## 4. Automation Hub

### 4.1 Strategy Builder (Node-Based Workflow Designer)

**Purpose**: Visual workflow builder for creating automated prediction market trading bots using custom nodes.

**Route**: `/automation/strategy-builder`

**Layout**: React Flow canvas with left sidebar (node palette), right sidebar (node config), bottom panel (logs/status)

**Node Palette** (18 nodes total):

#### Trigger Nodes (2)
1. **On Schedule**
   - Config: Cron expression (e.g., "0 */6 * * *" = every 6 hours)
   - Output: Timestamp

2. **On New Market**
   - Config: Category filter (Politics, Sports, etc.)
   - Output: marketId

#### Data Nodes (3)
3. **Get Market(s)**
   - Config: Filter (category, minVolume, minLiquidity)
   - Input: None or marketId
   - Output: Market[] or Market

4. **Get Market Data**
   - Config: Fields to fetch (SII, Momentum, Figure-Out-Able, etc.)
   - Input: marketId
   - Output: MarketData object

5. **Get Wallet Data**
   - Config: walletAddress or "Find Wallets" output
   - Input: walletAddress
   - Output: WalletData object

#### Strategy Nodes (3)
6. **Find Wallets (by WIS)**
   - Config: minWIS, maxWIS, specialty filter
   - Output: walletAddress[]

7. **Find Specialist**
   - Config: category (e.g., "Crypto"), minWIS
   - Output: walletAddress (top specialist in category)

8. **Check Wallet Agreement**
   - Config: walletAddresses[], marketId, side ("YES" or "NO")
   - Output: agreementPercentage (0-100%)

#### Agent Nodes (3)
9. **Run "Figure-Out-Able" Agent**
   - Config: marketId
   - Input: marketId
   - Output: figureOutAbleScore (0-100), reasoning

10. **Run "Google-able" Agent**
    - Config: marketId
    - Input: marketId
    - Output: googleAbleScore (0-100), reasoning

11. **Run Deep Research Agent (MiroMind)**
    - Config: marketId, researchDepth ("standard" | "deep")
    - Input: marketId
    - Output: researchReport (markdown), prediction ("YES" | "NO"), confidence (0-100%)

#### Logic Nodes (3)
12. **Filter (Numeric)**
    - Config: operator (>, <, >=, <=, ==), threshold
    - Input: number
    - Output: boolean (pass/fail)

13. **Filter (Boolean)**
    - Config: condition (AND, OR, NOT)
    - Input: boolean[]
    - Output: boolean

14. **Wait for Momentum Flip**
    - Config: marketId, direction ("up" | "down"), threshold
    - Input: marketId
    - Output: triggered (boolean)

#### Risk Management Nodes (2)
15. **Set Max Bet**
    - Config: maxBetUsd, maxBetPercent (of wallet balance)
    - Output: maxBetAmount

16. **Set Diversification**
    - Config: maxMarketsSimultaneous, maxPerCategory
    - Output: canOpenPosition (boolean)

#### Action Nodes (3)
17. **Add to Watchlist**
    - Config: None
    - Input: marketId
    - Output: success (boolean)

18. **Trigger Buy/Sell Signal**
    - Config: side ("YES" | "NO"), sizeUsd or sizePercent
    - Input: marketId
    - Output: orderId, executionPrice

**Example Strategy Flow**:
```
On Schedule (every 6h)
  ↓
Get Market(s) [filter: category=Politics, minVolume=10000]
  ↓
Get Market Data [fields: SII, Momentum]
  ↓
Filter (Numeric) [SII > 60]
  ↓ (if pass)
Find Wallets (by WIS) [minWIS=70, specialty=Politics]
  ↓
Check Wallet Agreement [50% agree on YES]
  ↓
Filter (Numeric) [agreementPercent > 60]
  ↓ (if pass)
Run "Figure-Out-Able" Agent
  ↓
Filter (Numeric) [figureOutAbleScore < 40] (want objective markets)
  ↓ (if pass)
Set Max Bet [$500, 5% of wallet]
  ↓
Trigger Buy/Sell Signal [side=YES, sizeUsd=$500]
```

**Node Configuration UI**:
```typescript
// Right sidebar when node is selected
<div className="p-4 border-l bg-card">
  <h3 className="font-semibold mb-4">{selectedNode.type}</h3>

  {/* Dynamic form based on node type */}
  {selectedNode.type === "Filter (Numeric)" && (
    <>
      <Label>Operator</Label>
      <Select value={config.operator} onValueChange={(v) => updateConfig('operator', v)}>
        <SelectItem value=">">Greater than (&gt;)</SelectItem>
        <SelectItem value="<">Less than (&lt;)</SelectItem>
        <SelectItem value=">=">Greater or equal (&gt;=)</SelectItem>
        <SelectItem value="<=">Less or equal (&lt;=)</SelectItem>
        <SelectItem value="==">Equal (==)</SelectItem>
      </Select>

      <Label className="mt-4">Threshold</Label>
      <Input type="number" value={config.threshold} onChange={(e) => updateConfig('threshold', e.target.value)} />
    </>
  )}

  {selectedNode.type === "Trigger Buy/Sell Signal" && (
    <>
      <Label>Side</Label>
      <RadioGroup value={config.side} onValueChange={(v) => updateConfig('side', v)}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="YES" id="yes" />
          <Label htmlFor="yes">YES</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="NO" id="no" />
          <Label htmlFor="no">NO</Label>
        </div>
      </RadioGroup>

      <Label className="mt-4">Size ($)</Label>
      <Input type="number" value={config.sizeUsd} onChange={(e) => updateConfig('sizeUsd', e.target.value)} />

      <Label className="mt-4">Or Size (% of wallet)</Label>
      <Slider value={[config.sizePercent]} onValueChange={([v]) => updateConfig('sizePercent', v)} max={100} step={1} />
      <span className="text-sm text-muted-foreground">{config.sizePercent}%</span>
    </>
  )}
</div>
```

**Execution Panel (Bottom)**:
```typescript
<div className="border-t bg-card p-4">
  <Tabs defaultValue="status">
    <TabsList>
      <TabsTrigger value="status">Status</TabsTrigger>
      <TabsTrigger value="logs">Logs</TabsTrigger>
      <TabsTrigger value="trades">Trades</TabsTrigger>
    </TabsList>

    <TabsContent value="status">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Badge variant={strategyStatus === "running" ? "success" : "secondary"}>
            {strategyStatus === "running" ? "Running" : "Stopped"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Last run: {lastRunTimestamp ? formatDistanceToNow(lastRunTimestamp) + " ago" : "Never"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button onClick={startStrategy} disabled={strategyStatus === "running"}>
            <Play className="h-4 w-4 mr-2" />
            Start
          </Button>
          <Button variant="destructive" onClick={stopStrategy} disabled={strategyStatus !== "running"}>
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="p-3 bg-gray-50 rounded">
          <div className="text-sm text-muted-foreground">ROI</div>
          <div className={`text-2xl font-bold ${strategyPnL > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {strategyPnL > 0 ? '+' : ''}{((strategyPnL / strategyInitialBalance) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="p-3 bg-gray-50 rounded">
          <div className="text-sm text-muted-foreground">Total PnL</div>
          <div className={`text-2xl font-bold ${strategyPnL > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {strategyPnL > 0 ? '+' : ''}${strategyPnL.toLocaleString()}
          </div>
        </div>
        <div className="p-3 bg-gray-50 rounded">
          <div className="text-sm text-muted-foreground">Trades</div>
          <div className="text-2xl font-bold">{strategyTradesCount}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded">
          <div className="text-sm text-muted-foreground">Win Rate</div>
          <div className="text-2xl font-bold">{strategyWinRate.toFixed(1)}%</div>
        </div>
      </div>
    </TabsContent>

    <TabsContent value="logs">
      <div className="bg-black text-green-400 font-mono text-sm p-4 rounded h-48 overflow-y-auto">
        {executionLogs.map((log, i) => (
          <div key={i}>
            [{log.timestamp}] {log.message}
          </div>
        ))}
      </div>
    </TabsContent>

    <TabsContent value="trades">
      <DataTable value={strategyTrades} scrollable scrollHeight="200px">
        <Column field="timestamp" header="Date" body={dateBodyTemplate} />
        <Column field="marketTitle" header="Market" body={marketLinkTemplate} />
        <Column field="side" header="Side" body={sideBodyTemplate} />
        <Column field="price" header="Price" body={priceBodyTemplate} />
        <Column field="sizeUsd" header="Size" body={currencyBodyTemplate} />
        <Column field="outcome" header="Outcome" body={outcomeBodyTemplate} />
        <Column field="pnl" header="PnL" body={currencyColorBodyTemplate} />
      </DataTable>
    </TabsContent>
  </Tabs>
</div>
```

**User Flow**:
1. User clicks "Create New Strategy" from library
2. Lands on blank canvas with node palette
3. Drags "On Schedule" trigger onto canvas
4. Connects to "Get Market(s)" node
5. Configures filters in right sidebar
6. Continues building workflow by connecting nodes
7. Clicks "Test Run" to validate workflow
8. Reviews logs for any errors
9. Clicks "Start" to deploy strategy
10. Strategy runs automatically, creating trades
11. User monitors performance in execution panel

---

## 5. Implementation Priorities

Based on the PRD and user flow, here's the recommended implementation order:

### Phase 1: Core Discovery (Weeks 1-2)
1. Market Screener (highest impact - primary discovery tool)
2. Market Detail drill-down
3. ECharts integration
4. PrimeVue DataTable integration

### Phase 2: Trader Analysis (Weeks 3-4)
1. Trader Explorer
2. Wallet Detail drill-down
3. PnL Leaderboard (scatter plot)
4. Live Smart Trades (streaming)

### Phase 3: Advanced Discovery (Weeks 5-6)
1. Market Map (treemap)
2. Whale Activity (4-chart grid)
3. Large Trades (streaming)
4. Possible Insiders

### Phase 4: Strategy Builder (Weeks 7-10)
1. Replace crypto nodes with V1 node palette (18 nodes)
2. Node configuration UI
3. Execution engine (backend)
4. Performance tracking
5. Real trading integration

### Phase 5: Polish & Scale (Weeks 11-12)
1. Real-time WebSocket updates
2. Caching optimizations
3. Database migrations (hot/cold tier)
4. Mobile responsive improvements
5. User testing & feedback

---

## Next Steps

After this specification document:

1. **Create Component Mapping Document**: Map old crypto components → new prediction market components
2. **Create Wireframes**: Visual mockups for each page
3. **Database Schema**: Finalize tables, indexes, partitions
4. **API Contract**: Complete endpoint specifications
5. **Begin Implementation**: Start with Market Screener (Phase 1)
