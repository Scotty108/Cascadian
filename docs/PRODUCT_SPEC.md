# CASCADIAN Product Specification

**Last Updated**: 2025-10-23
**Version**: 2.0 (Polymarket Prediction Market Platform)

---

## Product Overview

**CASCADIAN** is an advanced AI-powered prediction market intelligence platform built specifically for Polymarket. It combines intelligent market screening, whale activity tracking, automated trading workflows, and portfolio analytics into a unified, professional-grade trading terminal.

### Vision

**CASCADIAN is the intelligence layer for prediction markets**—transforming Polymarket trading from reactive speculation into systematic, data-driven decision making through probability stacking and autonomous execution.

We democratize institutional-grade trading intelligence by providing:
1. **API-First Intelligence** - Enriched prediction market data and signals accessible via API
2. **Visual Analytics Dashboards** - Real-time whale tracking, insider signals, and market intelligence
3. **Autonomous Strategy Execution** - AI-powered workflow automation with 24/7 market monitoring

Our mission: **Find the "egg man" in every market**—successful traders making consistent profits—and systematically replicate their edge through intelligent automation.

### Target Audience

- **Primary**: Active Polymarket traders seeking data-driven edge and automation (crypto-native, 25-45 years old, $10K+ trading capital)
- **Secondary**: Developers building prediction market tools (API consumers)
- **Third**: Market analysts and researchers tracking prediction market trends for insights
- **Fourth**: Casual traders looking to follow whale activity and insider signals

---

## Core Strategy: Stacking Probabilities

**The CASCADIAN Method**: Minimize risk and maximize returns by systematically stacking multiple probability layers in your favor.

### Theory

**Traditional Prediction Market Trading** (Reactive):
- Individual speculation based on personal knowledge
- No systematic entry/exit strategy
- No whale or insider intelligence
- Manual 24/7 market monitoring (impossible)

**CASCADIAN Approach** (Systematic):
```
Layer 1: Smart Crowd Intelligence
  ↓ Only bet WITH successful wallets (whale scores, win rates)

Layer 2: Market Momentum Signals
  ↓ Entry ONLY when momentum goes UP in predicted direction

Layer 3: Autonomous Position Management
  ↓ Layer OUT positions when momentum FLATTENS

Layer 4: Deep Research Validation
  ↓ AI agents verify fundamental thesis (Mirothink, deep research)

Layer 5: Insider Signal Confirmation
  ↓ Detect unusual wallet activity (insider trading patterns)

Result: 5+ probability layers stacked → Systematic edge
```

### Example: "Finding the Egg Man"

**Real World Case Study**:
- Successful wallet makes **$70K/month** trading egg price markets on Polymarket
- CASCADIAN goal: Identify "egg man" equivalent in EVERY market
- Aggregate intelligence: What do ALL successful traders have in common?
- Systematize: Automate strategies that replicate their patterns

**Implementation**:
1. **Wallet Scoring** - Identify high-performing wallets (Sharpe ratio, ROI, win rate)
2. **Pattern Detection** - Analyze their entry/exit timing, position sizing, market selection
3. **Signal Generation** - Create "follow the smart money" signals
4. **Strategy Automation** - Build workflows that trade like top performers
5. **Continuous Learning** - AI adapts as market patterns evolve

### Strategy Builder Philosophy

**Goal**: Enable users to build strategies that **computers can execute better than humans**.

**Why Computers Win**:
- ✅ **24/7 Monitoring** - Never sleep, never miss opportunities
- ✅ **Instant Execution** - React to signals in milliseconds
- ✅ **No Emotion** - Follow strategy rules without fear/greed
- ✅ **Parallel Processing** - Monitor 1000+ markets simultaneously
- ✅ **Pattern Recognition** - Detect arbitrage and anomalies instantly

**Strategy Builder Workflow**:
```
1. Design → Visual node-based workflow (no code required)
   ↓
2. Test → Paper trade with real market data
   ↓
3. Validate → Win-loss dashboards show performance
   ↓
4. Deploy → Auto-trade when strategy proves profitable
   ↓
5. Monitor → Real-time execution logs and P&L tracking
```

**Example Strategy: Momentum + Whale Confirmation**:
```
[Stream Markets]
  → Filter: Category = Politics, Volume > $10K
  → [Whale Analysis] → Only markets where whales are buying YES
  → [Momentum Check] → Only enter when momentum trending UP
  → [Deep Research] → Mirothink validates fundamental thesis
  → [Buy YES] → Execute position
  → [Monitor] → Layer out when momentum flattens
```

---

## Core Value Propositions

1. **Probability Stacking** - Systematically layer multiple intelligence signals to minimize risk and maximize returns
2. **API-First Intelligence** - Access enriched prediction market data, wallet scores, and signals via developer API
3. **Whale & Insider Intelligence** - Track large position holders, smart money flows, and detect insider activity in real-time
4. **AI-Powered Deep Research** - LLM agents (Mirothink, GPT-4, Claude) perform fundamental analysis and Bayesian forecasting
5. **Visual Workflow Automation** - Build and execute trading strategies with no-code drag-and-drop interface
6. **Autonomous Execution** - Computer-driven 24/7 market monitoring and position management
7. **Portfolio Intelligence** - Track positions, P&L, win rate, Sharpe ratio, and risk metrics across all markets

---

## Product Architecture

### Three-Tier Platform Model

CASCADIAN operates as a **layered intelligence platform** serving three distinct use cases:

```
┌─────────────────────────────────────────────────────────┐
│  TIER 3: Strategy Execution Layer (Autonomous Trading) │
│  • Visual workflow builder with node-based strategies  │
│  • Paper trading and backtesting                       │
│  • Auto-trade with Polymarket account integration      │
│  • Sub-wallets per strategy for isolation              │
│  • 24/7 autonomous market monitoring                   │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────────┐
│  TIER 2: Dashboard Layer (Visual Intelligence)         │
│  • Real-time whale tracking dashboards                 │
│  • Market screener with 1000+ markets                  │
│  • Insider signal detection                            │
│  • Portfolio analytics and P&L tracking                │
│  • Win-loss rate performance metrics                   │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────────┐
│  TIER 1: API Intelligence Layer (Data & Signals)       │
│  • Enriched market data (volume, liquidity, momentum)  │
│  • Wallet intelligence scores (whale, smart money)     │
│  • Market signals (momentum, SII, insider alerts)      │
│  • Deep research API (Mirothink, AI analysis)          │
│  • Developer-friendly REST/GraphQL endpoints           │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  DATA WAREHOUSE & AI ENRICHMENT ENGINE                  │
│  • ClickHouse: High-performance time-series analytics   │
│  • Supabase: Relational data and real-time updates     │
│  • AI Enrichment: Wallet scoring, anomaly detection    │
│  • Pattern Recognition: Identify successful traders    │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  RAW DATA SOURCES (Polymarket)                          │
│  • Gamma API: Markets, events, categories              │
│  • CLOB API: Order books, trades, liquidity            │
│  • Data API: Wallets, positions, holders               │
└─────────────────────────────────────────────────────────┘
```

### Platform Type
**Prediction Market Intelligence API & Trading Terminal**

### Data Sources
- **Polymarket Gamma API** - Market metadata, events, categories
- **Polymarket CLOB API** - Order books, trade history, liquidity
- **Polymarket Data API** - Wallet positions, holder rankings, transaction history

### Core Technology Stack

**Frontend**:
- Next.js 15.3.4 (App Router)
- React 19.1.0
- TypeScript 5.8.3
- TailwindCSS 3.4.17
- Radix UI + shadcn/ui
- TanStack Query (React Query) for data fetching
- ReactFlow (XYFlow) for workflow editor
- ECharts & Recharts for data visualization

**Backend/Database**:
- Supabase (PostgreSQL 15+) - Production database
- Supabase Auth - User authentication
- Supabase Storage - Asset storage
- Real-time subscriptions for live data

**AI Integration**:
- Vercel AI SDK
- OpenAI GPT-4 - Market analysis and conversational AI
- Anthropic Claude - Strategy building copilot
- Google Gemini - Image generation and multimodal analysis

**Development**:
- pnpm 10.18.1 (Package manager)
- Node.js 20.19.3
- Vercel (Hosting & Serverless Functions)
- GitHub Actions (CI/CD)

---

## Feature Breakdown

### 1. Market Discovery & Intelligence

**Status**: ✅ **Production Ready**

**Components**:
- Market Screener (`app/(dashboard)/discovery/screener/`)
- Market Detail View (`components/market-detail-interface/`)
- Event Browser (`app/(dashboard)/events/`)
- Market Category Map (`app/(dashboard)/discovery/map/`)

**Key Capabilities**:
- Browse 1000+ active Polymarket markets
- **Advanced Filtering**:
  - Category (Politics, Sports, Crypto, Finance, Science, Culture)
  - Volume (24h, total)
  - Liquidity thresholds
  - Price ranges
  - Active vs. closed markets
  - End date ranges
- **Multi-column Sorting** (TanStack Table):
  - Volume, liquidity, price, momentum, trade count
  - Composite sorting (category + volume)
- **Fuzzy Search** (PostgreSQL full-text search)
- **Market Details**:
  - OHLC price charts (1m, 5m, 15m, 1h, 4h, 1d intervals)
  - Live order book (bids/asks)
  - Top holder rankings (YES/NO separated)
  - Related markets suggestions
  - Trade history and analytics
- **Real-time Updates** (5-minute refresh)
- **Performance**:
  - Screener query: < 150ms (p50)
  - Market detail: < 200ms
  - Pagination: Client-side virtual scrolling

**Data Flow**:
```
Polymarket API → Background Sync (5 min) → Supabase → React Query Cache → UI
```

**API Endpoints**:
- `GET /api/polymarket/markets` - List markets with filters
- `GET /api/polymarket/markets/[id]` - Single market detail
- `GET /api/polymarket/events` - Browse events
- `GET /api/polymarket/events/[slug]` - Event detail with nested markets
- `GET /api/polymarket/ohlc/[marketId]` - OHLC price history
- `GET /api/polymarket/order-book/[marketId]` - Live order book
- `GET /api/polymarket/holders` - Top market holders
- `POST /api/polymarket/sync` - Manual sync trigger

---

### 2. Whale Intelligence & Insider Tracking

**Status**: ✅ **Production Ready**

**Components**:
- Whale Activity Dashboard (`app/(dashboard)/discovery/whale-activity/`)
- Whale Discovery (`app/(dashboard)/discovery/whales/`)
- PnL Leaderboard (`app/(dashboard)/discovery/leaderboard/`)
- Insider Signals (`app/(dashboard)/insiders/`)

**Key Capabilities**:
- **Whale Detection**:
  - Identify wallets with large positions (> $10K)
  - Track smart money flows across markets
  - Detect position reversals (flips from YES → NO or vice versa)
  - Calculate whale concentration metrics per market
- **Scoring System**:
  - Whale Score (position size + consistency)
  - Smart Money Score (win rate + Sharpe ratio)
  - Reputation Score (track record over time)
- **Leaderboard Rankings**:
  - Top traders by Sharpe ratio
  - Top traders by ROI
  - Top traders by win rate
  - Top traders by total volume
- **Insider Intelligence**:
  - Detect unusual trading patterns
  - Flag markets with insider activity
  - Track insider wallet profiles
- **Position Tracking**:
  - Monitor whale position changes
  - Alert on large buys/sells
  - Track concentration shifts

**Data Flow**:
```
Polymarket Data API → Whale Analysis → Supabase (wallets, positions) → UI
```

**API Endpoints**:
- `GET /api/whale/positions` - Large positions (whales)
- `GET /api/whale/trades` - Whale trading activity
- `GET /api/whale/flows` - Smart money flow analysis
- `GET /api/whale/flips` - Position reversals
- `GET /api/whale/concentration` - Market concentration metrics
- `GET /api/whale/scoreboard` - Whale rankings
- `GET /api/insiders/markets` - Markets with insider activity
- `GET /api/insiders/wallets` - Insider wallet profiles

**Database Schema**:
- `wallets` - Discovered wallet profiles with scores
- `wallet_positions` - Current holdings per wallet
- `wallet_trades` - Historical trade records

---

### 3. Portfolio Analytics & Wallet Tracking

**Status**: ✅ **Production Ready**

**Components**:
- Wallet Detail View (`components/wallet-detail-interface/`)
- My Analytics (`app/(dashboard)/my-analytics/`)
- My Assets (`app/(dashboard)/my-assets/`)
- Portfolio Tracker (`components/portfolio-tracker-interface/`)

**Key Capabilities**:
- **Position Tracking**:
  - Active positions with real-time P&L
  - Closed positions with realized P&L
  - Position allocation by category
  - Risk metrics per position
- **Performance Analytics**:
  - Overall ROI and Sharpe ratio
  - Win rate (winners / total trades)
  - Performance by time period (7d, 30d, all-time)
  - Performance by category
  - Trade frequency analysis
- **Wallet Intelligence**:
  - Connect any wallet address (0x...)
  - View positions, trades, and activity
  - Calculate portfolio value (total USDC)
  - Track historical performance
  - Activity timeline/log
- **Risk Management**:
  - Position concentration alerts
  - Exposure by market category
  - Unrealized P&L tracking
  - Max drawdown analysis

**Data Flow**:
```
User provides address → Polymarket Data API → Transform → Cache → UI
```

**API Endpoints**:
- `GET /api/polymarket/wallet/[address]/positions` - Open positions
- `GET /api/polymarket/wallet/[address]/closed-positions` - Historical positions with P&L
- `GET /api/polymarket/wallet/[address]/trades` - Trade history
- `GET /api/polymarket/wallet/[address]/value` - Total portfolio value (USDC)
- `GET /api/polymarket/wallet/[address]/activity` - Activity timeline
- `GET /api/wallet/[address]` - Wallet profile info

**React Hooks**:
- `useWalletPositions()` - Real-time positions
- `useWalletClosedPositions()` - Historical positions
- `useWalletTrades()` - Trade history
- `useWalletValue()` - Portfolio value
- `useWalletActivity()` - Activity log

---

### 4. AI-Powered Strategy Builder (Visual Workflow Automation)

**Status**: ✅ **Production Ready** (MVP Complete)

**Components**:
- Strategy Builder Canvas (`app/(dashboard)/strategy-builder/`)
- Strategy Library (`components/strategy-library/`)
- Workflow Editor (`components/workflow-editor/`)
- Node Configuration Panel (`components/node-config-panel.tsx`)
- Node Palette (`components/node-palette.tsx`)
- Conversational AI Copilot (`components/workflow-editor/ConversationalChat.tsx`)

**Key Capabilities**:

**Visual Workflow Designer** (ReactFlow-based):
- Drag-and-drop node-based strategy creation
- Real-time canvas editing with pan/zoom
- Automatic edge connection validation
- Node configuration panels with form validation
- Import/export workflows as JSON
- Code export (generate executable code from visual workflow)

**Node Types** (10+ implemented & planned):

**Core Execution Nodes**:
1. **Start Node** - Workflow entry point
2. **End Node** - Workflow exit point
3. **JavaScript Node** - Custom code execution (sandboxed)
4. **HTTP Request Node** - Call external APIs
5. **Conditional Node** - If/then/else logic

**Polymarket Intelligence Nodes**:
6. **Polymarket Stream** - Fetch markets with filters
7. **Polymarket Filter** - Conditional filtering (volume, price, category)
8. **Polymarket LLM Analysis** - AI-powered market analysis with custom prompts
9. **Polymarket Buy** - Execute market/limit orders (FUTURE - Phase 3)

**Advanced Research & Analysis Nodes** (Phase 2-3):
10. **Mirothink Deep Research** - Conduct comprehensive research on any Polymarket using deep research agents
    - Input: Market ID or topic
    - Output: Structured research report with probability assessments
    - Capabilities: News aggregation, sentiment analysis, expert opinion synthesis
11. **Bayesian Forecasting** - Statistical probability analysis using Bayesian methods
    - Input: Historical price data, market conditions
    - Output: Probability distributions and confidence intervals
    - Capabilities: Fundamental momentum trading analysis, trend prediction
12. **Whale Tracker** - Monitor specific whale wallets for position changes
    - Input: Wallet addresses, markets
    - Output: Position changes, trade alerts, whale activity signals

**Execution Engine**:
- Real-time execution with streaming results
- Node-by-node status tracking (pending → running → success/error)
- Live execution logs with timestamps
- Output display per node
- Error handling and retry logic
- Topological sorting for dependency resolution

**AI Copilot** (Conversational Builder):
- Natural language strategy description
- AI generates workflow nodes and edges
- Suggests optimizations and improvements
- Explains node configurations
- Powered by Vercel AI SDK + Claude

**Paper Trading & Backtesting** (Phase 3):
- **Paper Trading Mode** - Test strategies with simulated funds before risking real capital
  - Virtual portfolio with configurable starting balance
  - Simulate order execution using real-time Polymarket prices
  - Track hypothetical positions, P&L, and win rate
  - No actual funds at risk - pure simulation
  - Transition to live trading when confident

- **Backtesting Engine** - Validate strategies against historical data
  - Load historical OHLC data and trade history
  - Replay market conditions with configurable speed
  - Test multiple timeframes (24h, 7d, 30d, 90d)
  - Generate performance reports (Sharpe ratio, max drawdown, win rate)
  - Compare strategy performance across different market conditions

**Win-Loss Performance Dashboards**:
- **Per-Strategy Analytics** - Detailed performance metrics for each strategy
  - Total trades executed (paper and live)
  - Win rate (% of profitable trades)
  - Average profit per trade
  - ROI (Return on Investment)
  - Sharpe ratio (risk-adjusted returns)
  - Max drawdown (largest peak-to-trough decline)
  - Profit factor (gross profit / gross loss)

- **Visual Performance Charts**:
  - Cumulative P&L over time (line chart)
  - Win/loss distribution (histogram)
  - Trade frequency by market category
  - Performance by time of day / day of week
  - Comparison charts (strategy A vs. strategy B)

- **Trade Journal** - Detailed log of every trade
  - Entry/exit prices and timestamps
  - Position size and outcome
  - Market conditions at entry/exit
  - Strategy that triggered the trade
  - Notes and tags for future analysis

**Sub-Wallet Management** (Phase 3):
- **Isolated Wallets Per Strategy** - Each strategy operates with its own sub-wallet for risk isolation
  - Create sub-wallets dynamically when activating a strategy
  - Allocate specific capital to each strategy (e.g., $500 to "Whale Following", $1,000 to "Momentum Trading")
  - Prevent strategies from interfering with each other
  - Track P&L independently per strategy
  - Rebalance capital allocation based on performance

- **Risk Management**:
  - Set max position size per strategy
  - Daily loss limits (auto-pause strategy if exceeded)
  - Total portfolio exposure limits
  - Automatic position scaling based on win rate

- **Capital Allocation Dashboard**:
  - Visual breakdown of capital by strategy
  - Active positions per sub-wallet
  - Available capital vs. deployed capital
  - Rebalancing recommendations based on performance

**Strategy Management**:
- Browse saved strategies
- Create new from blank canvas or template
- Clone existing strategies
- Edit and version strategies
- Save to database (`workflow_sessions` table)
- Performance tracking (ROI, trades, win rate per strategy)
- Tag and categorize strategies
- Mark strategies as templates
- Favorite strategies for quick access

**Example Probability Stacking Strategy** - "Smart Egg Market Trading Bot":

This example demonstrates how to layer multiple intelligence sources to trade egg markets profitably:

```
START NODE
  ↓
POLYMARKET STREAM NODE
  Filter: category = "Politics", search_term = "egg"
  Output: List of egg-related markets
  ↓
WHALE TRACKER NODE
  Input: Markets from previous node
  Action: Identify wallets with > $10K positions in egg markets
  Output: List of "egg man" whales with 70%+ win rates
  ↓
CONDITIONAL NODE
  Condition: IF whale_win_rate > 70% AND whale_position_size > $10K
  ↓ (TRUE path)
MIROTHINK DEEP RESEARCH NODE
  Input: Market details
  Action: Conduct deep research on egg market fundamentals
  - Analyze recent news about egg prices, avian flu, supply chain
  - Synthesize expert opinions and government reports
  - Generate probability assessment with confidence intervals
  Output: Research report with bullish/bearish thesis
  ↓
BAYESIAN FORECASTING NODE
  Input: Historical price data + Mirothink research
  Action: Statistical probability analysis
  - Calculate momentum indicators
  - Bayesian probability update based on research findings
  - Generate forecast with confidence intervals
  Output: Probability distribution (e.g., 73% chance price > 0.60 in 7 days)
  ↓
CONDITIONAL NODE
  Condition: IF bayesian_probability > 70% AND momentum_score > 0.5 AND mirothink_confidence = "high"
  ↓ (TRUE path - All 3 layers agree)
POLYMARKET BUY NODE (Paper Trading)
  Action: Execute simulated market order
  Position size: 2% of portfolio ($100)
  Entry price: Current market price
  Stop loss: -10% (auto-exit if position drops 10%)
  Take profit: +15% (auto-exit if position gains 15%)
  ↓
END NODE
  Log trade to strategy journal
  Update win-loss dashboard
```

**Result**: This strategy stacks 5+ probability layers:
1. ✅ Whale intelligence (successful "egg man" identified)
2. ✅ Deep fundamental research (Mirothink validates thesis)
3. ✅ Statistical forecasting (Bayesian analysis confirms direction)
4. ✅ Momentum confirmation (price velocity aligned)
5. ✅ Risk management (position sizing + stop loss)

**Development Workflow**:
1. **Build in Paper Trading** → Test with simulated funds for 30 days
2. **Review Win-Loss Dashboard** → Verify 60%+ win rate and positive ROI
3. **Activate Live Trading** → Connect Polymarket account and allocate $1,000 to sub-wallet
4. **Monitor 24/7** → Strategy runs autonomously, sending alerts on trades
5. **Iterate & Improve** → Clone strategy, adjust parameters, A/B test variations

**User Flows**:
1. **Library View** → Browse templates and custom strategies
2. **Create New** → Start with blank canvas or default template ("Cascadian Intelligence Trading Strategy")
3. **Edit Strategy** → Visual node builder with configuration panels
4. **Run Strategy** → Start execution with real-time status updates (paper or live)
5. **View Execution Logs** → Node-by-node output and debugging
6. **View Performance Dashboard** → Win rate, ROI, P&L charts
7. **Save & Version** → Persist to database with version control

**Data Flow**:
```
User builds workflow → Click "Run" → POST /api/execute-workflow (streaming) →
Executor (topological sort) → Execute nodes sequentially →
Stream results to UI → Display live logs
```

**API Endpoints**:
- `POST /api/execute-workflow` - Execute workflow (streaming SSE)
- `POST /api/ai/conversational-build` - AI copilot chat

**Database Schema**:
- `workflow_sessions` - Saved workflow definitions
  - `id`, `user_id`, `name`, `description`
  - `nodes` (JSONB array), `edges` (JSONB array)
  - `trigger`, `variables`, `version`
  - `tags`, `is_template`, `is_favorite`
  - `status` (draft|active|paused|archived)
  - `execution_count`, `last_executed_at`
- `workflow_executions` - Execution history
  - `id`, `workflow_id`, `user_id`
  - `execution_started_at`, `execution_completed_at`, `duration_ms`
  - `status` (running|completed|failed|cancelled)
  - `nodes_executed`, `outputs` (JSONB), `errors` (JSONB)

**Libraries & Dependencies**:
- `@xyflow/react` (ReactFlow) - Visual workflow canvas
- `react-hook-form` + `zod` - Node configuration forms
- `ai` (Vercel AI SDK) - Streaming AI responses
- Custom executor in `/lib/workflow/executor.ts`
- Node executors in `/lib/workflow/node-executors.ts`

**Performance**:
- Workflow save: < 100ms
- Workflow load: < 150ms
- Node execution: Variable (API calls, LLM analysis)
- Streaming latency: < 100ms per chunk

---

### 5. Intelligence Signals & AI Analysis

**Status**: 🔄 **Active Development** (Phase 2)

**Components**:
- Intelligence Signals Dashboard (`app/(dashboard)/intelligence-signals/`)
- AI Market Analysis (`components/intelligence-signals/`)

**Planned Capabilities**:
- **Momentum Scoring** (Price velocity analysis)
- **Smart Imbalance Index (SII)** (Buy/sell pressure detection)
- **Smart Money Delta** (Whale vs. retail positioning)
- **Sentiment Analysis** (LLM-powered market sentiment)
- **Trend Detection** (Statistical pattern recognition)
- **Anomaly Detection** (Unusual trading activity alerts)
- **Signal Strength Indicators** (Confidence scoring)

**Planned Data Flow**:
```
CLOB Trade Data → Aggregation Pipeline → Signal Calculation →
Database (market_analytics) → UI Display
```

**Future API Endpoints**:
- `GET /api/signals/momentum` - Momentum signals
- `GET /api/signals/sii` - Smart Imbalance Index
- `GET /api/signals/sentiment` - Market sentiment
- `POST /api/polymarket/aggregate` - Trigger trade aggregation

**Database Schema** (Partially implemented):
- `market_analytics` table with:
  - `trades_24h`, `buyers_24h`, `sellers_24h`
  - `buy_volume_24h`, `sell_volume_24h`
  - `buy_sell_ratio` (bullish/bearish indicator)
  - `momentum_score`, `price_change_24h`

---

### 6. Trading Interface (Manual Trading)

**Status**: 🔄 **Active Development**

**Components**:
- Trading Interface (`app/(dashboard)/trading/`)
- Order Placement UI (`components/trading-interface/`)

**Capabilities**:
- Manual order placement (market/limit)
- Balance display (USDC, CTF tokens)
- Order book visualization
- Recent trades display
- Position sizing calculator

**Future Integration**:
- Direct Polymarket CLOB API order submission
- Wallet connection (MetaMask, WalletConnect)
- Order status tracking
- Fill confirmations

---

### 7. Events & Market Categorization

**Status**: ✅ **Production Ready**

**Components**:
- Events Overview (`app/(dashboard)/events/`)
- Event Detail (`app/(dashboard)/events/[slug]/`)
- Event Cards (`components/events-overview/`)
- Event Detail View (`components/event-detail/`)

**Key Capabilities**:
- Browse all Polymarket events
- Filter by category, active/closed
- View nested markets per event
- Event metadata (dates, description, image)
- Category extraction from Polymarket tags

**Data Flow**:
```
Polymarket Gamma API /events → Transform → Supabase → UI
```

---

### 8. Community & Marketplace

**Status**: 🔄 **Active Development**

**Components**:
- Strategy Marketplace (`app/(dashboard)/strategies-marketplace/`)
- Strategy Library (`components/strategy-library/`)
- Invite Friends (`app/(dashboard)/invite-friends/`)

**Capabilities**:
- Browse community strategies
- View strategy performance metrics
- Clone and edit strategies
- Share strategies
- Referral program

**Future Features**:
- Buy/sell strategies (paid templates)
- Creator profiles and ratings
- Strategy reviews and comments

---

### 9. User Management & Settings

**Status**: ✅ **Production Ready**

**Components**:
- Authentication (`app/signin/`, `app/signup/`)
- Settings (`app/(dashboard)/settings/`)
- Subscription (`app/(dashboard)/subscription/`)
- Help Center (`app/(dashboard)/help-center/`)
- Theme Editor (`components/theme-editor/`)

**Key Capabilities**:
- **Authentication**:
  - Email/password sign-in
  - Google OAuth (planned)
  - Supabase Auth integration
  - JWT session management
- **User Settings**:
  - Notification preferences
  - API key management
  - Wallet connections
  - Data export
- **Theme System**:
  - Dark/light mode toggle
  - Custom theme editor
  - Preset themes (12+ options)
  - Per-component color customization
- **Subscription Management**:
  - Free, Pro, Enterprise tiers
  - Usage tracking
  - Billing history
- **Help & Support**:
  - Documentation browser
  - FAQ system
  - Contact support

---

## Technical Architecture

### Frontend Architecture

**Directory Structure**:
```
/app
  /(dashboard)              # Protected routes with sidebar layout
    /discovery              # Market discovery & screening
      /screener            # Market screener (TanStack Table)
      /whales              # Whale tracking
      /whale-activity      # Whale activity dashboard
      /leaderboard         # PnL leaderboard
      /map                 # Market category map
    /events                # Event browsing
      /[slug]              # Event detail
    /analysis              # Advanced analytics
      /insiders            # Insider signals
      /wallet/[address]    # Wallet detail
      /market/[id]         # Market deep dive
    /strategy-builder      # Visual workflow editor
    /strategies            # Saved strategies
      /[id]                # Strategy detail
    /strategies-marketplace # Community strategies
    /trading               # Manual trading
    /my-analytics          # User analytics
    /my-assets             # Portfolio tracker
    /intelligence-signals  # AI signals
    /insiders              # Insider activity
    /settings              # User settings
    /subscription          # Billing
    /help-center           # Documentation
    /invite-friends        # Referrals
  /(auth)                   # Authentication pages
    /signin
    /signup
  /api                      # API routes (Next.js API Routes)
    /polymarket             # Polymarket integration
      /markets              # Market endpoints
      /events               # Event endpoints
      /wallet/[address]     # Wallet endpoints
      /holders              # Holder rankings
      /ohlc                 # Price history
      /order-book           # Order book
      /sync                 # Data sync
    /whale                  # Whale intelligence
      /positions, /trades, /flows, /flips, /scoreboard, /concentration
    /insiders               # Insider signals
    /execute-workflow       # Workflow execution
    /ai                     # AI integration
      /conversational-build # AI copilot
    /admin                  # Admin operations
    /cron                   # Scheduled jobs

/components
  /ui                       # shadcn/ui base components (40+ components)
  /market-screener-tanstack # Market screener (TanStack Table)
  /market-detail-interface  # Market deep dive
  /whale-activity           # Whale tracking
  /whale-activity-interface # Whale analytics
  /events-overview          # Event cards
  /event-detail             # Event detail view
  /wallet-detail-interface  # Wallet analysis
  /strategy-builder         # Strategy canvas
  /strategy-library         # Strategy browser
  /workflow-editor          # Workflow tools
  /node-config-panel        # Node configuration
  /node-palette             # Node selection
  /nodes                    # Workflow node implementations
    /start-node, /end-node, /javascript-node, /http-request-node,
    /conditional-node, /polymarket-node
  /pnl-leaderboard-interface # Leaderboard
  /portfolio-tracker-interface # Portfolio
  /my-analytics             # User analytics
  /my-assets                # Asset tracker
  /intelligence-signals     # AI signals
  /insider-activity-interface # Insider tracking
  /trading-interface        # Trading UI
  /strategies-marketplace-interface # Marketplace
  /theme-editor             # Theme customization
  /settings-interface       # Settings
  /help-center-interface    # Help docs
  /dashboard-sidebar-topbar # Navigation
  /theme-provider           # Theme context

/hooks                      # Custom React hooks (17+ hooks)
  use-polymarket-markets.ts # Markets list
  use-polymarket-events.ts  # Events list
  use-polymarket-event-detail.ts # Event detail
  use-market-detail.ts      # Market detail
  use-market-ohlc.ts        # OHLC data
  use-market-order-book.ts  # Order book
  use-market-holders.ts     # Holder rankings
  use-related-markets.ts    # Related markets
  use-wallet-positions.ts   # Wallet positions
  use-wallet-closed-positions.ts # Closed positions
  use-wallet-trades.ts      # Trade history
  use-wallet-value.ts       # Portfolio value
  use-wallet-activity.ts    # Activity log
  use-wallet-connection.ts  # Wallet connect
  use-toast.ts              # Notifications
  use-keyboard-shortcuts.ts # Hotkeys
  use-intersection-observer.ts # Lazy loading

/lib                        # Business logic & services
  /polymarket               # Polymarket API client
    client.ts               # HTTP client with retry logic
    config.ts               # Configuration
    utils.ts                # Data transformation
    sync.ts                 # Background sync orchestration
    trade-aggregator.ts     # Trade analytics
    mock-client.ts          # Test data
  /services                 # Service layer
    workflow-session-service.ts # Workflow CRUD
    llm-analyzer.ts         # AI analysis
    data-transformer.ts     # Data normalization
  /workflow                 # Workflow execution engine
    executor.ts             # Workflow runtime
    node-executors.ts       # Node execution logic
    market-transformer.ts   # Market data transformations
  supabase.ts               # Supabase client
  utils.ts                  # Utilities
  wallet-cache.ts           # In-memory cache
  theme-presets.ts          # Theme configs

/types                      # TypeScript definitions
  polymarket.ts             # Polymarket types
  workflow.ts               # Workflow types
  database.ts               # Database types

/supabase                   # Database migrations & docs
  /migrations               # SQL migration files (10+ migrations)
  /docs                     # Database documentation
  /seed                     # Seed data
```

### State Management

**Client-Side**:
- **TanStack Query (React Query)** - Server state management
  - Automatic caching (5-minute stale time for markets)
  - Request deduplication
  - Automatic refetch on window focus
  - Retry logic (2 retries with exponential backoff)
  - Optimistic updates
- **React Context** - UI state
  - Theme provider (dark/light mode)
  - Toast notifications
  - Modal dialogs
- **URL Search Params** - Filter state
  - Market screener filters
  - Strategy builder edit mode
  - Pagination state
- **Local Storage** - Persistence
  - Workflow definitions (fallback)
  - Theme preference
  - User settings

### Data Persistence

**Supabase PostgreSQL**:

**Markets Table** (`markets`):
- Primary key: `market_id`
- Columns: title, description, category, tags, outcomes, prices, volume, liquidity, active, closed, end_date
- Indexes: active, category, volume, end_date, full-text search (GIN)
- Real-time subscriptions for price updates

**Market Analytics** (`market_analytics`):
- Primary key: `market_id`
- Columns: trades_24h, buyers_24h, sellers_24h, buy/sell volumes, momentum_score
- Joined with markets for advanced screener

**Wallets** (`wallets`):
- Primary key: `address`
- Columns: wallet_alias, is_whale, whale_score, smart_money_score, reputation_score

**Wallet Positions** (`wallet_positions`):
- Composite key: (wallet_address, market_id)
- Columns: shares, entry_price, current_price, unrealized_pnl

**Wallet Trades** (`wallet_trades`):
- Columns: wallet_address, market_id, outcome, side, amount, price, timestamp

**Workflows** (`workflow_sessions`):
- Primary key: `id` (UUID)
- Columns: user_id, name, description, nodes (JSONB), edges (JSONB), version, status

**Workflow Executions** (`workflow_executions`):
- Primary key: `id` (UUID)
- Columns: workflow_id, status, outputs (JSONB), errors (JSONB), duration_ms

**OHLC Prices** (`prices_1m`):
- Composite key: (market_id, timestamp)
- Columns: open, high, low, close, volume

### API Integration Architecture

**Polymarket Integration**:
- **Gamma API** - Market metadata, events
- **CLOB API** - Order books, trade history
- **Data API** - Wallets, positions, holders

**Error Handling**:
- Exponential backoff retry (max 4 attempts)
- Timeout management (5-10s per request)
- Rate limit detection (429 errors)
- Graceful degradation (return stale DB data)
- Comprehensive error logging

**Caching Strategy**:
- **Backend**: In-flight request deduplication, mutex-based sync locking
- **Frontend**: React Query with 5-minute stale time for markets, 30-second for wallets
- **Database**: 5-minute staleness threshold triggers auto-sync

### Performance Optimizations

**Database**:
- Partial indexes on `active=true` markets
- Composite indexes (category + volume)
- Full-text search with pg_trgm extension
- Batch UPSERT (500 markets per batch)

**Frontend**:
- Virtual scrolling in large tables (TanStack)
- Lazy loading with Intersection Observer
- Component code splitting
- Memoization of expensive computations
- Debounced search inputs

**API**:
- Request deduplication
- Pagination (limit/offset)
- Selective field projection
- Streaming responses for long operations

---

## CASCADIAN Developer API (Tier 1: Intelligence Layer)

**Status**: 🔄 **Planned** (Phase 4-5)

### Vision

**CASCADIAN as the go-to API for prediction market intelligence** - enabling developers to build sophisticated trading tools, analytics dashboards, and research platforms on top of our enriched data layer.

We transform raw Polymarket data into actionable intelligence through:
1. **AI-enriched market data** - Momentum scores, sentiment analysis, anomaly detection
2. **Wallet intelligence scores** - Whale detection, smart money tracking, insider signals
3. **Market signals** - Smart Imbalance Index (SII), trend detection, probability assessments
4. **Deep research capabilities** - Mirothink integration, Bayesian forecasting, fundamental analysis

### API Architecture

**RESTful API** (Phase 4):
- JSON responses with consistent schema
- Standard HTTP methods (GET, POST, PUT, DELETE)
- Rate limiting (1000 requests/hour free tier, 10K for paid)
- API key authentication
- Webhook support for real-time updates

**GraphQL API** (Phase 5 - Future):
- Flexible queries for complex data requirements
- Single endpoint with schema introspection
- Subscription support for live data streams
- Reduced over-fetching with field selection

### Endpoint Catalog

**Market Intelligence Endpoints**:

```
GET /api/v1/markets
  - List markets with enriched intelligence
  - Filters: category, volume, liquidity, momentum_score
  - Response: Market metadata + momentum + SII + whale activity

GET /api/v1/markets/{market_id}
  - Detailed market data with full intelligence suite
  - Response: OHLC data, order book, signals, whale positions

GET /api/v1/markets/{market_id}/signals
  - Market signals and probability assessments
  - Response: Momentum score, SII, insider alerts, AI sentiment

GET /api/v1/markets/{market_id}/research
  - Deep research report powered by Mirothink
  - Response: News aggregation, expert opinions, probability forecast
```

**Whale Intelligence Endpoints**:

```
GET /api/v1/wallets
  - List tracked wallets with intelligence scores
  - Filters: min_position_size, win_rate, sharpe_ratio
  - Response: Wallet addresses + performance metrics + scores

GET /api/v1/wallets/{address}
  - Detailed wallet profile and trading history
  - Response: Positions, trade history, P&L, performance metrics

GET /api/v1/wallets/{address}/activity
  - Recent wallet activity and alerts
  - Response: Position changes, trade alerts, insider signals

GET /api/v1/whales/leaderboard
  - Top-performing whales ranked by metrics
  - Response: Ranked list by ROI, Sharpe ratio, win rate
```

**Signal Endpoints**:

```
GET /api/v1/signals/momentum
  - Markets with strong momentum signals
  - Filters: direction (up/down), min_score, timeframe
  - Response: Markets with momentum scores and trends

GET /api/v1/signals/sii
  - Smart Imbalance Index signals
  - Filters: imbalance_threshold, market_category
  - Response: Markets with buy/sell pressure indicators

GET /api/v1/signals/insider
  - Insider trading detection alerts
  - Filters: confidence_level, market_id
  - Response: Suspected insider activity with evidence

GET /api/v1/signals/whale-flows
  - Smart money flow analysis
  - Response: Markets with significant whale position changes
```

**Research & Analysis Endpoints**:

```
POST /api/v1/research/analyze
  - Request deep research on a market using Mirothink
  - Body: { market_id, research_depth: "standard" | "deep" }
  - Response: Research report with probability assessments (async job)

GET /api/v1/research/jobs/{job_id}
  - Check status of research job
  - Response: Job status + results when complete

POST /api/v1/forecasting/bayesian
  - Bayesian probability forecast for a market
  - Body: { market_id, timeframe, historical_window }
  - Response: Probability distribution with confidence intervals
```

**Portfolio Analytics Endpoints**:

```
GET /api/v1/portfolio/{address}
  - Portfolio analytics for a wallet
  - Response: Positions, P&L, win rate, performance over time

GET /api/v1/portfolio/{address}/metrics
  - Performance metrics (Sharpe, ROI, max drawdown)
  - Response: Detailed performance analytics
```

### Authentication & Rate Limiting

**API Keys**:
```
Authorization: Bearer {api_key}
```

**Rate Limits**:
- **Free Tier**: 1,000 requests/hour
- **Developer Tier**: 10,000 requests/hour ($49/month)
- **Enterprise Tier**: 100,000 requests/hour (custom pricing)

**Webhook Subscriptions**:
```
POST /api/v1/webhooks/subscribe
  - Subscribe to real-time events
  - Events: whale_activity, momentum_signal, insider_alert, position_change
  - Response: Webhook URL registration confirmation
```

### Response Schema

**Standard Response Format**:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2025-10-23T12:00:00Z",
    "request_id": "req_abc123",
    "rate_limit": {
      "remaining": 950,
      "reset_at": "2025-10-23T13:00:00Z"
    }
  }
}
```

**Error Response Format**:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 15 minutes.",
    "details": { ... }
  },
  "meta": { ... }
}
```

### Use Cases

**Use Case 1: Trading Bot**
A developer builds a trading bot that:
1. Polls `/api/v1/signals/momentum` every 5 minutes
2. Filters for markets with momentum_score > 0.7
3. Calls `/api/v1/markets/{market_id}` for detailed data
4. Executes trades via Polymarket CLOB API

**Use Case 2: Research Dashboard**
A researcher builds an analytics dashboard that:
1. Fetches whale leaderboard from `/api/v1/whales/leaderboard`
2. Tracks specific whales via `/api/v1/wallets/{address}/activity`
3. Displays whale position changes in real-time
4. Subscribes to webhooks for instant alerts

**Use Case 3: Market Analysis Tool**
An analyst builds a market research tool that:
1. Requests deep research via `/api/v1/research/analyze`
2. Fetches Bayesian forecasts via `/api/v1/forecasting/bayesian`
3. Combines with momentum signals for probability stacking
4. Exports comprehensive market reports

### Monetization Strategy

**API Tiers**:
- **Free Tier** - 1K requests/hour, basic endpoints
- **Developer Tier** - 10K requests/hour, all endpoints ($49/month)
- **Enterprise Tier** - 100K requests/hour, dedicated support (custom pricing)

**Revenue Sharing**:
- 70% to CASCADIAN, 30% to data providers (Mirothink, etc.)
- Volume discounts for high-usage customers
- White-label options for enterprise clients

---

## Success Metrics

### User Engagement
- **Daily Active Users (DAU)**: Target 500+ by Month 3
- **Workflow Creation Rate**: 50+ new workflows/week
- **Average Session Duration**: 15+ minutes
- **Feature Adoption Rate**: 70%+ users use 3+ features

### Trading Performance
- **Total Markets Tracked**: 1000+ active markets
- **Workflow Execution Volume**: 10K+ executions/week
- **Strategy Win Rate**: 55%+ average across all strategies
- **Whale Signals Accuracy**: 65%+ predictive accuracy

### Platform Health
- **User Retention**: 60% (30-day), 40% (90-day)
- **API Uptime**: 99.5%+
- **Screener Query Performance**: < 150ms (p95)
- **Sync Success Rate**: 98%+

---

## MVP Scope (Current State)

### ✅ Completed (Production Ready)

**Infrastructure**:
- ✅ Next.js 15 App Router with TypeScript
- ✅ TailwindCSS styling with shadcn/ui components
- ✅ Theme system (dark/light + custom themes)
- ✅ Supabase integration (database + auth)
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ TanStack Query data fetching

**Polymarket Integration**:
- ✅ Complete Gamma API integration (markets, events)
- ✅ CLOB API integration (order books, trades)
- ✅ Data API integration (wallets, positions, holders)
- ✅ Background sync system (5-minute intervals)
- ✅ Database schema (markets, analytics, wallets, workflows)
- ✅ 16+ API endpoints

**Market Discovery**:
- ✅ Market screener with advanced filters
- ✅ Multi-column sorting and pagination
- ✅ Fuzzy search with full-text indexing
- ✅ Market detail view with OHLC charts
- ✅ Order book visualization
- ✅ Related markets suggestions

**Whale Intelligence**:
- ✅ Whale detection and scoring
- ✅ Position tracking across markets
- ✅ Whale leaderboard (Sharpe, ROI, win rate)
- ✅ Smart money flow analysis
- ✅ Position reversal detection

**Portfolio Analytics**:
- ✅ Wallet position tracking
- ✅ P&L calculation (realized + unrealized)
- ✅ Win rate and performance metrics
- ✅ Portfolio value tracking
- ✅ Activity timeline

**Strategy Builder** (MVP):
- ✅ Visual workflow editor (ReactFlow)
- ✅ 6+ node types (Start, End, JavaScript, HTTP, Conditional, Polymarket)
- ✅ Real-time execution with streaming
- ✅ Workflow save/load to database
- ✅ Strategy library and templates
- ✅ AI copilot (conversational builder)
- ✅ Code export feature

### 🔄 In Progress

**Phase 2 - Intelligence Signals**:
- 🔄 Momentum scoring algorithm
- 🔄 Smart Imbalance Index (SII)
- 🔄 Smart money delta tracking
- 🔄 Trade aggregation pipeline
- 🔄 Real-time WebSocket updates

**Trading Execution**:
- 🔄 Wallet connection (MetaMask, WalletConnect)
- 🔄 Order placement via CLOB API
- 🔄 Order status tracking
- 🔄 Position entry/exit automation

**Community Features**:
- 🔄 Strategy marketplace (buy/sell)
- 🔄 User profiles and ratings
- 🔄 Strategy reviews and comments

### 📋 Planned (Future Phases)

**Phase 3 - Advanced Automation**:
- 📋 Scheduled workflow execution
- 📋 Webhook triggers
- 📋 Multi-step conditional workflows
- 📋 Portfolio rebalancing strategies
- 📋 Risk management automation

**Phase 4 - Advanced Analytics**:
- 📋 Custom signal creation
- 📋 Backtesting engine
- 📋 Strategy performance comparison
- 📋 Market correlation analysis
- 📋 Sentiment tracking (social media integration)

**Phase 5 - Mobile & Notifications**:
- 📋 Mobile app (React Native)
- 📋 Push notifications (whale alerts, signal alerts)
- 📋 Mobile-optimized workflow builder
- 📋 Offline mode with sync

**Phase 6 - Enterprise Features**:
- 📋 Team collaboration (shared workflows)
- 📋 Advanced permissions and roles
- 📋 White-label options
- 📋 API access for developers
- 📋 Custom integrations

---

## Development Roadmap

### Phase 1: Foundation ✅ (Complete)
**Duration**: Weeks 1-8
**Status**: ✅ Complete

- ✅ Complete Polymarket API integration
- ✅ Database schema and migrations
- ✅ Market screener with advanced filters
- ✅ Whale detection and tracking
- ✅ Portfolio analytics
- ✅ Visual workflow builder (MVP)
- ✅ Background sync system
- ✅ Authentication and user management

### Phase 2: Intelligence & Signals 🔄 (Current)
**Duration**: Weeks 9-12
**Status**: 🔄 In Progress

- 🔄 Trade aggregation pipeline
- 🔄 Momentum scoring implementation
- 🔄 Smart Imbalance Index (SII)
- 🔄 Smart money delta tracking
- 🔄 Real-time WebSocket updates
- 🔄 Insider signal detection
- 🔄 Advanced market analytics

### Phase 3: Execution & Automation
**Duration**: Weeks 13-16

- 📋 Wallet connection (MetaMask, WalletConnect)
- 📋 Direct order placement via CLOB API
- 📋 Automated workflow execution (scheduled)
- 📋 Position management automation
- 📋 Risk management features
- 📋 Portfolio rebalancing strategies

### Phase 4: Community & Marketplace
**Duration**: Weeks 17-20

- 📋 Strategy marketplace (buy/sell)
- 📋 User profiles and creator pages
- 📋 Strategy reviews and ratings
- 📋 Social features (follow, share)
- 📋 Referral program enhancement
- 📋 Community leaderboards

### Phase 5: Advanced Analytics
**Duration**: Weeks 21-24

- 📋 Backtesting engine
- 📋 Strategy performance comparison
- 📋 Custom signal creation UI
- 📋 Market correlation analysis
- 📋 Sentiment tracking (Twitter/social)
- 📋 Advanced charting and technical indicators

### Phase 6: Scale & Polish
**Duration**: Weeks 25-28

- 📋 Mobile app (React Native)
- 📋 Push notifications
- 📋 Performance optimization
- 📋 Security hardening
- 📋 API rate limiting
- 📋 Comprehensive testing suite
- 📋 Enterprise features (teams, white-label)

---

## Known Technical Debt

**High Priority**:
- [ ] Implement comprehensive error boundaries
- [ ] Add loading skeletons to all data-heavy components
- [ ] Implement comprehensive testing suite (unit, integration, E2E)
- [ ] Bundle size optimization (code splitting, lazy loading)
- [ ] API rate limiting and quota management
- [ ] Security audit (RLS policies, API key rotation)

**Medium Priority**:
- [ ] Improve TypeScript type coverage (currently ~85%)
- [ ] Add Storybook for component documentation
- [ ] Implement service worker for offline support
- [ ] Add analytics tracking (PostHog, Mixpanel)
- [ ] Performance monitoring (Sentry, DataDog)
- [ ] Database query optimization (explain analyze on slow queries)

**Low Priority**:
- [ ] Improve accessibility (WCAG 2.1 AA compliance)
- [ ] Add keyboard shortcuts for power users
- [ ] Implement advanced theme customization
- [ ] Add export/import for user data
- [ ] Create comprehensive API documentation

---

## Security Considerations

**Authentication & Authorization**:
- ✅ Supabase Auth with JWT tokens
- ✅ Row-Level Security (RLS) policies on all tables
- 📋 Two-factor authentication (2FA)
- 📋 API key encryption and rotation
- 📋 Session management and timeout

**Data Protection**:
- ✅ HTTPS enforced (Vercel)
- ✅ Environment variable encryption
- 📋 Data encryption at rest (Supabase)
- 📋 GDPR compliance (data export, deletion)
- 📋 Audit logs for sensitive operations

**API Security**:
- ✅ Rate limiting (Vercel serverless functions)
- ✅ Input validation (Zod schemas)
- 📋 CORS configuration
- 📋 API key rate limiting
- 📋 Request signing for critical operations

**Smart Contract/Wallet Security**:
- 📋 Wallet connection security (WalletConnect v2)
- 📋 Transaction signing verification
- 📋 Phishing protection
- 📋 Safe transaction limits

---

## Competitive Advantages

### 1. **Polymarket-Native Design**
Unlike general crypto trading platforms adapted for prediction markets, CASCADIAN is purpose-built for Polymarket from the ground up. Every feature is optimized for prediction market workflows.

### 2. **Institutional-Grade Whale Intelligence**
No other Polymarket tool offers comprehensive whale tracking, smart money flow analysis, and insider signal detection at this level of sophistication.

### 3. **Visual Workflow Automation**
The only Polymarket platform with a no-code visual strategy builder powered by AI copilot. Competitors require coding knowledge.

### 4. **Real-Time Intelligence Signals**
AI-powered momentum scoring, SII, and sentiment analysis provide actionable signals unavailable elsewhere.

### 5. **Comprehensive Portfolio Analytics**
Beyond basic position tracking—offers Sharpe ratio, win rate, risk metrics, and performance attribution by category.

### 6. **Professional-Grade UI/UX**
Clean, modern interface inspired by Bloomberg Terminal and TradingView—far superior to cluttered competitor dashboards.

---

## Target User Personas

### Persona 1: "The Whale Hunter" - Alex
- **Age**: 32
- **Background**: Former trader, crypto-native, $50K+ trading capital
- **Goals**: Follow whale activity, copy smart money trades, maximize ROI
- **Pain Points**: Can't identify whale wallets manually, misses large position changes
- **CASCADIAN Solution**: Real-time whale tracking, position reversal alerts, leaderboard rankings

### Persona 2: "The Quantitative Analyst" - Sarah
- **Age**: 28
- **Background**: Data scientist, Python proficient, analytical mindset
- **Goals**: Build automated trading strategies, backtest signals, optimize performance
- **Pain Points**: Polymarket lacks API documentation, no backtesting tools available
- **CASCADIAN Solution**: Visual workflow builder, AI copilot, real-time execution engine

### Persona 3: "The Market Researcher" - Marcus
- **Age**: 35
- **Background**: Political analyst, tracks prediction markets for insights
- **Goals**: Monitor market trends, identify insider activity, export data for research
- **Pain Points**: Manual data collection, no trend analysis tools, data scattered
- **CASCADIAN Solution**: Market screener, insider signals, event categorization, data export

### Persona 4: "The Casual Trader" - Jamie
- **Age**: 26
- **Background**: Part-time trader, moderate crypto experience, $5K capital
- **Goals**: Follow winning strategies, reduce time researching markets, learn from pros
- **Pain Points**: Don't know which markets to trade, overwhelmed by options
- **CASCADIAN Solution**: Strategy marketplace, AI-generated signals, win rate tracking

---

## Revenue Model (Future)

### Free Tier
- 10 workflow executions/day
- Basic market screening
- Limited whale tracking
- Standard portfolio analytics

### Pro Tier - $49/month
- Unlimited workflow executions
- Advanced whale intelligence
- Real-time signals (momentum, SII)
- Priority API access
- Advanced analytics
- Email alerts

### Enterprise Tier - $299/month
- Team collaboration (5 users)
- Custom signals and automations
- API access for developers
- White-label options
- Dedicated support
- Advanced security features

### Marketplace Revenue
- 10% commission on strategy sales
- Premium strategy templates ($10-$50 each)
- Featured placement fees

---

## Compliance & Legal

**Terms of Service**:
- Platform is for informational purposes only
- Not financial advice disclaimer
- User assumes all trading risk
- Platform not liable for losses

**Privacy Policy**:
- GDPR compliance (EU users)
- CCPA compliance (California users)
- Data collection transparency
- User data deletion rights

**Regulatory Considerations**:
- Not a licensed broker-dealer
- No custody of user funds
- No guarantee of profits
- Educational platform disclaimer

---

## Documentation & Support

**User Documentation**:
- Getting Started Guide
- Feature-by-feature tutorials
- Video walkthroughs
- FAQ system
- Keyboard shortcuts reference

**Developer Documentation**:
- API reference
- Database schema docs
- Component library (Storybook)
- Workflow node development guide
- Integration examples

**Support Channels**:
- In-app help center
- Email support
- Discord community
- Twitter (@CascadianApp)
- GitHub (public roadmap)

---

## Appendix

### Tech Stack Summary

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 15.3.4 (App Router) |
| **Language** | TypeScript 5.8.3 |
| **UI Library** | React 19.1.0 |
| **Styling** | TailwindCSS 3.4.17 |
| **Components** | Radix UI + shadcn/ui |
| **State Management** | TanStack Query (React Query) |
| **Database** | Supabase (PostgreSQL 15+) |
| **Authentication** | Supabase Auth |
| **API Integration** | Polymarket (Gamma, CLOB, Data APIs) |
| **AI Integration** | Vercel AI SDK, OpenAI, Claude, Gemini |
| **Charts** | ECharts, Recharts |
| **Workflow Editor** | ReactFlow (@xyflow/react) |
| **Forms** | React Hook Form + Zod |
| **Hosting** | Vercel |
| **Package Manager** | pnpm 10.18.1 |
| **Node Version** | 20.19.3 |

### Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Polymarket
POLYMARKET_API_URL=https://gamma-api.polymarket.com
ADMIN_API_KEY=
CRON_SECRET=

# AI Services
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Optional
VERCEL_URL=
NEXT_PUBLIC_APP_URL=
```

### Key File Paths

**Critical Files**:
- `/app/layout.tsx` - Root layout with providers
- `/lib/supabase.ts` - Supabase client initialization
- `/lib/polymarket/client.ts` - Polymarket API client (430 lines)
- `/lib/polymarket/sync.ts` - Background sync orchestration (340 lines)
- `/lib/workflow/executor.ts` - Workflow execution engine
- `/components/market-screener-tanstack/index.tsx` - Market screener
- `/components/strategy-builder/index.tsx` - Workflow canvas
- `/supabase/migrations/` - Database migrations (10+ files)

**Configuration Files**:
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `tailwind.config.ts` - TailwindCSS configuration
- `next.config.js` - Next.js configuration
- `.env.local.example` - Environment variable template

---

**Document Version**: 2.0
**Last Updated**: 2025-10-23
**Next Review**: 2025-11-23
**Maintained By**: Product Team
**Status**: ✅ Production Ready (Phase 1), 🔄 Phase 2 In Progress
