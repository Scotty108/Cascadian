# CASCADIAN Architecture

## System Overview

CASCADIAN is a full-stack web application built on Next.js 15 with the App Router, combining client-side React components with server-side data fetching and API routes.

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│  (Next.js App Router + React 19 + Tailwind + shadcn/ui)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                       │
│     (Client Components + Server Components + API Routes)     │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│   Supabase       │ │  Exchange    │ │  DeFi Protocol   │
│  (Database +     │ │   APIs       │ │     APIs         │
│   Auth + RT)     │ │ (Binance,    │ │ (Uniswap, Aave)  │
└──────────────────┘ │  Coinbase)   │ └──────────────────┘
                     └──────────────┘
```

## Frontend Architecture

### Page Structure (App Router)

```
app/
├── layout.tsx                    # Root layout (theme provider)
├── globals.css                   # Global styles
├── signin/                       # Public route
│   └── page.tsx
├── signup/                       # Public route
│   └── page.tsx
└── (dashboard)/                  # Route group (shared layout)
    ├── layout.tsx                # Dashboard layout (sidebar + topbar)
    ├── page.tsx                  # Dashboard home
    ├── ai-bot/
    ├── dca-bot/
    ├── arbitrage-bot/
    ├── signal-bot/
    ├── portfolio-tracker/
    ├── my-assets/
    ├── my-analytics/
    ├── wallets/
    ├── defi-center/
    ├── defi-protocols/
    ├── trading/
    ├── strategies-marketplace/
    ├── bot-templates/
    ├── control-panel/
    │   ├── overview/
    │   ├── bot-settings/
    │   └── execution-logs/
    ├── pump-screener/
    ├── settings/
    ├── subscription/
    ├── help-center/
    └── invite-friends/
```

### Component Architecture

```
components/
├── ui/                          # Atomic components (shadcn/ui)
│   ├── button.tsx
│   ├── card.tsx
│   ├── input.tsx
│   ├── dialog.tsx
│   └── ... (40+ primitives)
│
├── theme-provider.tsx           # Global theme context
├── theme-toggle.tsx             # Theme switcher component
│
├── dashboard-sidebar-topbar/    # Layout components
│   ├── index.tsx
│   └── ... (sidebar navigation)
│
├── dashboard-content/           # Dashboard page
│   ├── index.tsx
│   ├── components/
│   ├── hooks/
│   ├── data.tsx                 # Mock data (to be replaced)
│   └── types.ts
│
├── ai-bot-dashboard/            # Feature-specific components
│   ├── index.tsx
│   └── components/
│       ├── kpi-cards.tsx
│       ├── portfolio-section.tsx
│       ├── ai-insights.tsx
│       └── modals/
│
├── portfolio-tracker-interface/
│   ├── index.tsx
│   └── components/
│       ├── header/
│       ├── overview/
│       ├── transactions/
│       └── analytics/
│
├── wallets-interface/
├── defi-protocols-interface/
├── strategies-marketplace-interface/
├── trading-interface/
└── ... (more feature modules)
```

### Design Patterns

#### 1. Component Composition
- **Atomic Design**: UI components → Feature components → Page components
- **Compound Components**: Complex components expose sub-components (e.g., Card.Header, Card.Content)

#### 2. State Management
- **Client State**: React hooks (`useState`, `useReducer`)
- **Server State**: Server Components + Next.js data fetching
- **Future**: Consider Zustand or Jotai for global state

#### 3. Data Flow
```
Server Component (fetch data)
         │
         ▼
Client Component (interactive UI)
         │
         ▼
API Route (/api/*)
         │
         ▼
Supabase / External APIs
```

#### 4. File Colocation
Each feature module contains:
- `index.tsx` - Main component
- `components/` - Sub-components
- `hooks/` - Custom hooks
- `types.ts` - TypeScript interfaces
- `data.tsx` - Mock data (temporary)

## Backend Architecture (Planned)

### Database Schema (Supabase/PostgreSQL)

```sql
-- Users (managed by Supabase Auth)
users
  - id (uuid, pk)
  - email
  - created_at
  - subscription_tier (free/pro/enterprise)

-- User Wallets
wallets
  - id (uuid, pk)
  - user_id (fk → users)
  - address (string)
  - network (ethereum/bsc/polygon)
  - nickname (string)
  - created_at

-- Trading Bots
bots
  - id (uuid, pk)
  - user_id (fk → users)
  - type (dca/arbitrage/signal/ai)
  - name (string)
  - config (jsonb)
  - status (active/paused/stopped)
  - created_at
  - updated_at

-- Bot Execution Logs
execution_logs
  - id (uuid, pk)
  - bot_id (fk → bots)
  - timestamp
  - action (buy/sell/error)
  - details (jsonb)
  - success (boolean)

-- Trades
trades
  - id (uuid, pk)
  - user_id (fk → users)
  - bot_id (fk → bots, nullable)
  - exchange (string)
  - pair (string)
  - side (buy/sell)
  - amount (numeric)
  - price (numeric)
  - fee (numeric)
  - timestamp

-- Strategies (Marketplace)
strategies
  - id (uuid, pk)
  - creator_id (fk → users)
  - name (string)
  - description (text)
  - category (string)
  - price (numeric)
  - config (jsonb)
  - rating (numeric)
  - downloads (integer)
  - created_at

-- Strategy Purchases
strategy_purchases
  - id (uuid, pk)
  - buyer_id (fk → users)
  - strategy_id (fk → strategies)
  - price_paid (numeric)
  - purchased_at
```

### API Routes

```
app/api/
├── auth/
│   ├── signin/route.ts
│   ├── signup/route.ts
│   └── signout/route.ts
│
├── bots/
│   ├── route.ts                 # GET all, POST create
│   ├── [id]/route.ts            # GET, PATCH, DELETE
│   ├── [id]/start/route.ts      # POST
│   └── [id]/stop/route.ts       # POST
│
├── trades/
│   ├── route.ts                 # GET all trades
│   └── [id]/route.ts            # GET single trade
│
├── portfolio/
│   ├── balance/route.ts         # GET current balance
│   ├── history/route.ts         # GET historical performance
│   └── analytics/route.ts       # GET analytics data
│
├── wallets/
│   ├── route.ts                 # GET all, POST connect
│   ├── [id]/route.ts            # GET, DELETE
│   └── [id]/transactions/route.ts
│
├── strategies/
│   ├── route.ts                 # GET all, POST create
│   ├── [id]/route.ts            # GET, PATCH, DELETE
│   └── [id]/purchase/route.ts   # POST
│
├── defi/
│   ├── protocols/route.ts       # GET all protocols
│   └── yield/route.ts           # GET yield opportunities
│
└── webhooks/
    ├── exchange/route.ts        # Exchange webhooks
    └── stripe/route.ts          # Payment webhooks
```

### External Service Integration

#### 1. Exchange APIs
```typescript
// lib/exchanges/base.ts
interface ExchangeAdapter {
  connect(apiKey: string, apiSecret: string): Promise<void>
  getBalance(): Promise<Balance>
  createOrder(params: OrderParams): Promise<Order>
  getOrderStatus(orderId: string): Promise<OrderStatus>
  cancelOrder(orderId: string): Promise<void>
}

// lib/exchanges/binance.ts
class BinanceAdapter implements ExchangeAdapter { ... }

// lib/exchanges/coinbase.ts
class CoinbaseAdapter implements ExchangeAdapter { ... }
```

#### 2. DeFi Protocol Integration
```typescript
// lib/defi/protocols/uniswap.ts
interface UniswapAdapter {
  swap(from: Token, to: Token, amount: number): Promise<Transaction>
  addLiquidity(params: LiquidityParams): Promise<Transaction>
  getAPY(poolId: string): Promise<number>
}
```

#### 3. Price Feed Service
```typescript
// lib/services/price-feed.ts
class PriceFeedService {
  // WebSocket for real-time updates
  subscribeToPrice(symbol: string, callback: (price: number) => void)
  unsubscribe(symbol: string)

  // REST API for historical data
  getHistoricalPrices(symbol: string, timeframe: string): Promise<Price[]>
}
```

### Bot Execution System

```typescript
// lib/bots/engine.ts
class BotEngine {
  private bots: Map<string, Bot>

  async start(botId: string) {
    const bot = await this.loadBot(botId)
    this.bots.set(botId, bot)

    // Schedule execution based on bot config
    const interval = bot.config.interval
    const job = scheduleJob(interval, () => bot.execute())
  }

  async stop(botId: string) {
    const bot = this.bots.get(botId)
    bot?.stop()
    this.bots.delete(botId)
  }
}

// lib/bots/strategies/dca.ts
class DCABot extends BaseBot {
  async execute() {
    const { pair, amount, interval } = this.config

    try {
      // Check if it's time to buy
      if (this.shouldBuy()) {
        const order = await this.exchange.createOrder({
          type: 'market',
          side: 'buy',
          symbol: pair,
          amount: amount
        })

        await this.logExecution(order)
      }
    } catch (error) {
      await this.logError(error)
    }
  }
}
```

## Security Architecture

### Authentication Flow

```
User → Next.js App → Supabase Auth
                          │
                          ├─ Email/Password
                          ├─ Google OAuth
                          └─ Magic Link

Protected Route → Middleware → Check Session → Allow/Deny
```

### API Key Management

```typescript
// Encrypted storage in database
api_keys
  - id (uuid, pk)
  - user_id (fk → users)
  - exchange (string)
  - encrypted_key (text)      // Encrypted with user-specific key
  - encrypted_secret (text)
  - created_at
  - last_used

// Server-side decryption only
class APIKeyManager {
  async decrypt(userId: string, keyId: string): Promise<Credentials> {
    // Decrypt using server-side master key + user salt
  }
}
```

### Row Level Security (RLS)

```sql
-- Users can only see their own data
CREATE POLICY "Users can view own bots"
  ON bots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own bots"
  ON bots FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

## Performance Optimization

### 1. Server-Side Rendering (SSR)
- Dashboard pages use Server Components
- Data fetching happens on server
- Reduced client-side JavaScript

### 2. Code Splitting
```typescript
// Dynamic imports for heavy components
const TradingChart = dynamic(() => import('@/components/trading-chart'), {
  loading: () => <Skeleton />,
  ssr: false
})
```

### 3. Caching Strategy
```typescript
// Next.js cache
export const revalidate = 60 // Revalidate every 60 seconds

// Supabase cache
const { data } = await supabase
  .from('trades')
  .select('*')
  .limit(100)
  .cache({ ttl: 300 }) // 5 minutes
```

### 4. Database Optimization
- Indexes on frequently queried columns (user_id, created_at)
- Materialized views for complex analytics
- Connection pooling with Supabase

### 5. Asset Optimization
- Image optimization with Next.js Image
- Font subsetting
- Lazy loading for below-fold content

## Deployment Architecture

```
GitHub Repository
        │
        ▼
GitHub Actions (CI/CD)
        │
        ├─ Run tests
        ├─ Build Next.js app
        ├─ Run type checks
        └─ Deploy to Vercel

Vercel Edge Network
        │
        ├─ Static assets (CDN)
        ├─ Server functions (serverless)
        └─ Edge functions (middleware)

Supabase (Database)
        │
        ├─ PostgreSQL (primary)
        ├─ Realtime (WebSocket)
        └─ Storage (S3-compatible)
```

### Environment Structure

```
Development (local)
  - DATABASE_URL=localhost
  - NEXT_PUBLIC_SUPABASE_URL=dev.supabase.co

Staging (staging branch)
  - DATABASE_URL=staging.supabase.co
  - NEXT_PUBLIC_SUPABASE_URL=staging.supabase.co

Production (main branch)
  - DATABASE_URL=prod.supabase.co
  - NEXT_PUBLIC_SUPABASE_URL=prod.supabase.co
```

## Monitoring & Observability

### Error Tracking
- Sentry for error monitoring
- Custom error boundaries
- API error logging

### Analytics
- Vercel Analytics for performance
- Custom events for user actions
- Bot execution metrics

### Logging
```typescript
// Structured logging
logger.info('Bot execution started', {
  botId,
  userId,
  type: 'dca',
  config
})

logger.error('Order failed', {
  botId,
  error: error.message,
  exchange: 'binance'
})
```

## Scalability Considerations

### Horizontal Scaling
- Stateless Next.js functions (auto-scale on Vercel)
- Bot execution can move to separate workers
- Database read replicas for analytics

### Vertical Scaling
- Optimize SQL queries
- Use database indexes
- Cache frequently accessed data

### Future: Microservices
If scale demands:
- Bot execution service (separate from web app)
- Price feed service
- Analytics service
- Notification service
