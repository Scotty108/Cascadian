# CASCADIAN Template Audit
**Crypto Template → Prediction Market Platform Translation Guide**

## Overview

This document audits the existing crypto trading template and maps it to CASCADIAN's prediction market requirements.

**Translation Strategy:**
- ✅ **Keep**: UI shell, layouts, components, design system
- 🔄 **Modify**: Page purposes, data models, API calls
- ❌ **Replace**: Crypto-specific logic with Polymarket logic

---

## Current Template Inventory (25 Pages)

### Main Dashboard
| Page | Route | Current Purpose (Crypto) | CASCADIAN Translation |
|------|-------|-------------------------|----------------------|
| Dashboard Home | `/` | Overview of all crypto bots & assets | **Keep Layout** → Overview of all prediction market activity |

### Bot Pages (6) - ❌ REPLACE ENTIRELY
| Page | Route | Current Purpose | CASCADIAN Replacement |
|------|-------|----------------|---------------------|
| AI Bot | `/ai-bot` | AI-powered crypto trading bot | ❌ Remove or repurpose |
| DCA Bot | `/dca-bot` | Dollar cost averaging bot | ❌ Remove |
| Arbitrage Bot | `/arbitrage-bot` | Cross-exchange arbitrage | ❌ Remove |
| Signal Bot | `/signal-bot` | Technical indicator bot | ❌ Remove |
| Bot Templates | `/bot-templates` | Pre-made bot templates | ❌ Remove or → Strategy templates |
| Control Panel | `/control-panel/*` | Bot management (overview, settings, logs) | 🔄 **Modify** → Strategy management |

### Discovery & Analysis Pages - 🔄 HEAVILY MODIFY
| Page | Route | Current Purpose | CASCADIAN Translation |
|------|-------|----------------|---------------------|
| My Assets | `/my-assets` | Crypto holdings overview | 🔄 **→ My Positions** (Active prediction market positions) |
| My Analytics | `/my-analytics` | Crypto trading analytics | 🔄 **→ My Performance** (P&L, win rate for predictions) |
| Portfolio Tracker | `/portfolio-tracker` | Crypto portfolio tracker | 🔄 **→ Position Tracker** (Track all active/closed prediction positions) |
| Pump Screener | `/pump-screener` | Token price movement screener | 🔄 **→ Market Screener** (Find high SII markets) |
| Trading | `/trading` | Manual crypto trading interface | 🔄 **→ Manual Trading** (Place prediction market bets) |

### DeFi Pages (4) - ❌ REMOVE ENTIRELY
| Page | Route | Current Purpose | CASCADIAN Action |
|------|-------|----------------|-----------------|
| DeFi Center | `/defi-center/*` | Yield farming, staking, liquidity | ❌ **Remove** - Not relevant to prediction markets |
| DeFi Protocols | `/defi-protocols` | Protocol stats & integrations | ❌ **Remove** |
| Yield Farming | `/defi-center/yield-farming` | Farm yield on DeFi protocols | ❌ **Remove** |
| Staking Pools | `/defi-center/staking-pools` | Stake tokens for rewards | ❌ **Remove** |
| Liquidity Tracker | `/defi-center/liquidity-tracker` | Track liquidity positions | ❌ **Remove** |

### Wallet & Assets - 🔄 MODIFY TO WALLETS
| Page | Route | Current Purpose | CASCADIAN Translation |
|------|-------|----------------|---------------------|
| Wallets | `/wallets` | Crypto wallet management | 🔄 **→ Trader Wallets** (View top traders by WIS, track wallet activity) |

### Marketplace - 🔄 KEEP CONCEPT
| Page | Route | Current Purpose | CASCADIAN Translation |
|------|-------|----------------|---------------------|
| Strategies Marketplace | `/strategies-marketplace` | Buy/sell trading strategies | ✅ **Keep Concept** → Marketplace for prediction market strategies |

### Strategy Builder - ✅ KEEP SHELL, REPLACE NODES
| Page | Route | Current Purpose | CASCADIAN Translation |
|------|-------|----------------|---------------------|
| Strategy Builder | `/strategy-builder` | Visual workflow builder for crypto bots | ✅ **Keep UI** → Visual builder for prediction market bots with NEW nodes |

### Settings & Support - ✅ KEEP
| Page | Route | Current Purpose | CASCADIAN Action |
|------|-------|----------------|-----------------|
| Settings | `/settings` | User settings | ✅ **Keep** |
| Subscription | `/subscription` | Subscription management | ✅ **Keep** |
| Help Center | `/help-center` | Documentation & support | ✅ **Keep** |
| Invite Friends | `/invite-friends` | Referral program | ✅ **Keep** |

---

## Component Modules Inventory (27 Modules)

### UI Primitives - ✅ KEEP ALL (40+ components)
**Location**: `components/ui/`

**Contents**:
- shadcn/ui components: Button, Card, Input, Select, Dialog, Tabs, etc.
- All Radix UI primitives
- Typography, Badge, Avatar, Skeleton loaders

**Status**: ✅ **100% Reusable** - These are domain-agnostic UI building blocks

---

### Feature Components - By Translation Status

#### ❌ REMOVE - Crypto Bot Components (7 modules)
| Module | Purpose | Action |
|--------|---------|--------|
| `ai-bot-dashboard` | AI crypto bot interface | ❌ Delete |
| `arbitrage-bot-dashboard` | Arbitrage bot interface | ❌ Delete |
| `dca-bot-dashboard` | DCA bot interface | ❌ Delete |
| `signal-bot-dashboard` | Signal bot interface | ❌ Delete |
| `bot-templates-interface` | Bot template library | ❌ Delete or → Strategy templates |
| `bot-settings-dashboard` | Bot configuration | ❌ Delete or repurpose |
| `execution-logs-dashboard` | Bot execution logs | 🔄 Repurpose → Strategy execution logs |

#### ❌ REMOVE - DeFi Components (4 modules)
| Module | Purpose | Action |
|--------|---------|--------|
| `defi-protocols-interface` | DeFi protocol stats | ❌ Delete |
| `yield-farming-interface` | Yield farming UI | ❌ Delete |
| `staking-pools-interface` | Staking interface | ❌ Delete |
| `liquidity-tracker-interface` | Liquidity positions | ❌ Delete |

#### 🔄 MODIFY - Translate to Prediction Markets (8 modules)
| Module | Current Purpose | CASCADIAN Translation |
|--------|----------------|---------------------|
| `dashboard-content` | Crypto dashboard overview | 🔄 → Prediction market overview (positions, recent bets, active strategies) |
| `my-assets` | Crypto holdings | 🔄 → **My Positions** (Active prediction positions) |
| `my-analytics` | Crypto trading stats | 🔄 → **My Performance** (Win rate, P&L, Sharpe ratio) |
| `portfolio-tracker-interface` | Crypto portfolio | 🔄 → **Position Tracker** (All prediction positions with analytics) |
| `wallets-interface` | Crypto wallet management | 🔄 → **Trader Explorer** (Top traders by WIS, wallet activity) |
| `pump-screener-interface` | Token price screener | 🔄 → **Market Screener** (Find markets by SII, volume, category) |
| `trading-interface` | Crypto trading | 🔄 → **Manual Betting** (Place prediction market bets) |
| `overview-dashboard` | Control panel overview | 🔄 → **Strategy Overview** (Active strategies, performance) |

#### ✅ KEEP - Reusable Concepts (5 modules)
| Module | Purpose | Status |
|--------|---------|--------|
| `strategies-marketplace-interface` | Buy/sell strategies | ✅ Keep concept, adapt to prediction markets |
| `strategy-library` | Strategy templates | ✅ Keep, replace with prediction market strategies |
| `settings-interface` | User settings | ✅ Keep as-is |
| `subscription-interface` | Billing & plans | ✅ Keep as-is |
| `help-center-interface` | Documentation | ✅ Keep, update content |
| `invite-friends-interface` | Referrals | ✅ Keep as-is |

#### 🔄 CRITICAL - Strategy Builder Nodes (REPLACE ALL LOGIC)
| Module | Current Purpose | CASCADIAN Replacement |
|--------|----------------|---------------------|
| `nodes/` | Crypto-specific workflow nodes | 🔄 **Replace 100% of node logic** with Polymarket nodes |

**Current Nodes (12)**: Text Model, Embedding Model, Tool, Structured Output, Prompt, Image Generation, Audio, JavaScript, Start, End, Conditional, HTTP Request

**CASCADIAN V1 Nodes (New)**:
- Get Market Data (SII, Momentum, Volume)
- Find Wallets (by WIS threshold)
- Find Specialist ("Eggman" for category)
- Check Wallet Agreement (% of wallets agreeing)
- Run Google-able Agent
- Run Deep Research Agent (MiroMind)
- Wait for Momentum Flip
- Set Max Bet ($)
- Trigger Buy/Sell Signal
- Check Position Status
- Exit Strategy

---

## Reusable UI Patterns (Keep)

### Layouts
- ✅ Dashboard sidebar + topbar layout
- ✅ Collapsible sidebar with icons
- ✅ Responsive mobile menu
- ✅ Tab-based navigation
- ✅ Card-based grid layouts

### Charts & Visualizations (Recharts)
- ✅ Line charts (for time series)
- ✅ Bar charts (for comparisons)
- ✅ Pie charts (for distributions)
- ✅ Area charts (for trends)
- ✅ Custom tooltips and legends

### Tables & Data Display
- ✅ Sortable tables
- ✅ Pagination
- ✅ Search/filter functionality
- ✅ Status badges (Running, Stopped, etc.)
- ✅ KPI cards (metrics display)

### Forms & Inputs
- ✅ Input fields with validation
- ✅ Select dropdowns
- ✅ Sliders (for ranges)
- ✅ Switches & toggles
- ✅ Date pickers

---

## Critical Data Model Changes

### FROM (Crypto Template)
```typescript
// Crypto-specific data models
type Asset = {
  symbol: string        // BTC, ETH
  balance: number
  value: number        // USD value
  network: string      // Ethereum, BSC
}

type Bot = {
  type: "dca" | "arbitrage" | "signal"
  status: "running" | "stopped"
  pnl: number
}

type Trade = {
  pair: string         // BTC/USD
  side: "buy" | "sell"
  price: number
  amount: number
}
```

### TO (CASCADIAN Prediction Markets)
```typescript
// Prediction market data models
type Market = {
  id: string
  question: string
  category: string
  sii: number          // -100 to +100 (Smart Imbalance Index)
  momentum: number     // Recent SII change
  volume: number       // $ volume
  liquidity: number
  endDate: Date
  outcomes: Outcome[]
}

type Wallet = {
  address: string
  wis: number          // -100 to +100 (Smart Score)
  winRate: number      // %
  pnl: number          // Total P&L
  sharpeRatio: number  // Risk-adjusted returns
  specialty: string[]  // ["Sports", "Politics"]
}

type Position = {
  marketId: string
  outcome: "YES" | "NO"
  shares: number
  avgPrice: number     // Entry price
  currentPrice: number
  pnl: number
  strategy?: string    // If opened by bot
}

type Strategy = {
  id: string
  name: string
  nodes: Node[]        // Visual workflow
  status: "active" | "paused"
  wallet: string       // Dedicated wallet address
  pnl: number
  trades: number
}
```

---

## API Integration Changes

### FROM (Crypto Template)
- Exchange APIs (Binance, Coinbase, Kraken)
- DeFi Protocol APIs (Uniswap, Aave, Compound)
- Price feeds (CoinGecko, CoinMarketCap)
- Blockchain RPCs (Alchemy, Infura)

### TO (CASCADIAN)
- ✅ **Polymarket V1 API** (markets, events, trades)
- ✅ **CASCADIAN Backend API** (WIS scores, SII scores, analytics)
- ✅ **MiroMind API** (deep research agent)
- ✅ **Google-able Agent** (lightweight research)

---

## Translation Summary

### Delete Entirely (11 pages, 11 components)
- All crypto bot pages (AI, DCA, Arbitrage, Signal)
- All DeFi pages (Yield Farming, Staking, Liquidity, Protocols)
- All crypto bot components
- All DeFi components

### Modify/Translate (8 pages, 8 components)
- Dashboard → Prediction market dashboard
- My Assets → My Positions
- My Analytics → My Performance
- Portfolio Tracker → Position Tracker
- Wallets → Trader Explorer (WIS-based)
- Pump Screener → Market Screener (SII-based)
- Trading → Manual Betting
- Control Panel → Strategy Management

### Keep/Reuse (6 pages, 6 components + all UI)
- Settings, Subscription, Help, Invite Friends
- Strategies Marketplace (concept)
- Strategy Builder (shell only, replace nodes)
- All 40+ shadcn/ui primitives
- All layout patterns, charts, tables

### Critical Replacements
- **100% of Strategy Builder nodes** → New Polymarket-specific nodes
- **All data models** → Prediction market models (Market, Wallet, Position, Strategy)
- **All API calls** → Polymarket API + CASCADIAN backend

---

## Next Steps (Phase 2)

After this audit, we will:
1. Define exact CASCADIAN page requirements (Discovery, Analyze, Automate hubs)
2. Create detailed wireframes for new pages (Market Detail, Wallet Detail)
3. Map old component → new component (e.g., `pump-screener` → `market-screener`)
4. Design new Strategy Builder node palette
5. Create migration roadmap with priorities
