# CASCADIAN Product Specification

## Product Overview

**CASCADIAN** is an advanced AI-powered cryptocurrency trading platform that combines automated trading bots, DeFi protocol integration, and comprehensive portfolio management into a unified dashboard experience.

### Vision
Democratize professional-grade crypto trading through AI automation, making sophisticated trading strategies accessible to both novice and experienced traders.

### Target Audience
- **Primary**: Crypto traders seeking automation and efficiency
- **Secondary**: DeFi enthusiasts managing multiple protocols
- **Tertiary**: Portfolio investors tracking crypto assets

## Core Value Propositions

1. **AI-Powered Trading Automation** - Reduce manual trading effort by 90%
2. **Multi-Strategy Bot Support** - DCA, Arbitrage, Signal-based trading
3. **Comprehensive DeFi Integration** - Access multiple protocols from one dashboard
4. **Advanced Portfolio Analytics** - Tax reporting, risk assessment, performance tracking
5. **Strategy Marketplace** - Share and monetize successful trading strategies

## Feature Breakdown

### 1. Trading Automation
**Status**: Active Development

**Components**:
- AI Bot Dashboard (`app/(dashboard)/ai-bot/`)
- DCA Bot (`app/(dashboard)/dca-bot/`)
- Arbitrage Bot (`app/(dashboard)/arbitrage-bot/`)
- Signal Bot (`app/(dashboard)/signal-bot/`)
- Bot Templates (`app/(dashboard)/bot-templates/`)

**Key Capabilities**:
- Automated trade execution
- Multiple strategy support
- Real-time performance monitoring
- Bot configuration and settings

### 2. Portfolio Management
**Status**: Active Development

**Components**:
- Portfolio Tracker (`app/(dashboard)/portfolio-tracker/`)
- My Assets (`app/(dashboard)/my-assets/`)
- My Analytics (`app/(dashboard)/my-analytics/`)

**Key Capabilities**:
- Transaction tracking and history
- Performance analytics
- Tax reporting
- Risk assessment
- Optimization suggestions

### 3. Wallet Management
**Status**: Active Development

**Components**:
- Wallets Interface (`app/(dashboard)/wallets/`)

**Key Capabilities**:
- Multi-wallet support
- Network-specific views
- Security settings
- Backup and recovery
- Address book
- NFT viewing

### 4. DeFi Integration
**Status**: Active Development

**Components**:
- DeFi Center (`app/(dashboard)/defi-center/`)
- DeFi Protocols (`app/(dashboard)/defi-protocols/`)

**Key Capabilities**:
- Protocol overview and stats
- TVL tracking
- Yield farming opportunities
- Protocol-specific interactions

### 5. Strategy Builder
**Status**: ✅ **Completed** (New Feature)

**Components**:
- Strategy Builder (`app/(dashboard)/strategy-builder/`)
- Strategy Library (`components/strategy-library/`)
- Node-based Workflow Designer (React Flow integration)

**Key Capabilities**:
- **Visual Workflow Designer**: Drag-and-drop node-based strategy creation
- **Strategy Library**: Browse and manage trading strategies
- **Default Template**: "Cascadian Intelligence Trading Strategy" with Start/Stop/Stats controls
- **Node Types**: 12+ different nodes (Text Model, Prompt, Conditional, HTTP Request, JavaScript, etc.)
- **Import/Export**: Save and load strategies as JSON
- **Code Export**: Generate executable code from visual workflows
- **Real-time Execution**: Test strategies directly in the builder
- **Strategy Management**: Create new, edit existing, clone, and delete strategies
- **Performance Tracking**: ROI, trades, and win rate metrics per strategy

**User Flows**:
1. **Library View** → Browse templates and custom strategies
2. **Create New** → Start with blank canvas or use default template
3. **Edit Strategy** → Visual node builder with configuration panels
4. **Run Strategy** → Start/stop execution with live status tracking
5. **View Stats** → Monitor performance metrics and trading results

### 6. Trading Tools
**Status**: Active Development

**Components**:
- Trading Interface (`app/(dashboard)/trading/`)
- Control Panel (`app/(dashboard)/control-panel/`)
- Pump Screener (`app/(dashboard)/pump-screener/`)

**Key Capabilities**:
- Manual trading with order book
- Balance summaries
- Bot execution logs
- Token screening and discovery

### 7. Marketplace & Community
**Status**: Active Development

**Components**:
- Strategies Marketplace (`app/(dashboard)/strategies-marketplace/`)
- Invite Friends (`app/(dashboard)/invite-friends/`)

**Key Capabilities**:
- Buy/sell trading strategies
- Strategy ratings and reviews
- Creator profiles
- Referral system

### 8. User Management
**Status**: Active Development

**Components**:
- Authentication (`app/signin/`, `app/signup/`)
- Settings (`app/(dashboard)/settings/`)
- Subscription (`app/(dashboard)/subscription/`)
- Help Center (`app/(dashboard)/help-center/`)

**Key Capabilities**:
- Email/password auth
- Google OAuth
- User preferences
- Subscription management
- Support documentation

## Technical Architecture

### Frontend Stack
- **Framework**: Next.js 15.3.4 (App Router)
- **Language**: TypeScript 5.8.3
- **Styling**: Tailwind CSS 3.4.17
- **Components**: Radix UI + shadcn/ui
- **Charts**: Recharts 3.0.0
- **Forms**: React Hook Form + Zod
- **Theme**: next-themes (dark/light mode)

### Project Structure
```
/app
  /signin, /signup          - Authentication
  /(dashboard)              - Main app (layout with sidebar)
    /ai-bot                 - AI trading bot
    /dca-bot                - DCA strategy
    /arbitrage-bot          - Arbitrage trading
    /signal-bot             - Signal-based trading
    /portfolio-tracker      - Portfolio analytics
    /my-assets             - Asset management
    /my-analytics          - Performance metrics
    /wallets               - Wallet management
    /defi-center           - DeFi hub
    /defi-protocols        - Protocol integration
    /trading               - Manual trading
    /strategies-marketplace - Strategy trading
    /bot-templates         - Template library
    /control-panel         - Bot management
    /pump-screener         - Token discovery
    /settings              - User settings
    /subscription          - Billing
    /help-center           - Support
    /invite-friends        - Referrals

/components
  /ui                       - shadcn/ui components
  /ai-bot-dashboard        - AI bot components
  /dashboard-content       - Main dashboard
  /portfolio-tracker-interface
  /wallets-interface
  /defi-protocols-interface
  /strategies-marketplace-interface
  /trading-interface
  /dca-bot-dashboard
  /signal-bot-dashboard
  /my-assets
  /my-analytics

/lib
  utils.ts                 - Utility functions (cn helper)
```

### Data Flow
- Client-side state management (React hooks)
- Component-level data with TypeScript interfaces
- Mock data for development (data.tsx files)

### Backend/Database
**Status**: Not Yet Implemented

**Planned**:
- Supabase for PostgreSQL database
- Supabase Auth for authentication
- Real-time subscriptions for price updates
- Supabase Storage for user data

### Deployment
**Status**: Not Configured

**Planned**:
- Vercel for hosting
- GitHub Actions for CI/CD
- Environment-based configs (dev/staging/prod)

## Success Metrics

### User Engagement
- Daily Active Users (DAU)
- Bot activation rate
- Average session duration
- Feature adoption rate

### Trading Performance
- Total trading volume
- Bot profitability rate
- Strategy marketplace sales
- Average ROI per bot

### Platform Health
- User retention rate (30/60/90 day)
- Subscription conversion rate
- Customer support tickets
- Page load performance

## MVP Scope (Current State)

### Completed
✅ UI/UX design system with shadcn/ui
✅ Dashboard layout with sidebar navigation
✅ All major page routes and components
✅ Theme switching (dark/light)
✅ Responsive design
✅ Component architecture
✅ TypeScript setup

### In Progress
🔄 Authentication integration
🔄 Database schema design
🔄 Real trading bot logic
🔄 API integrations (exchanges, DeFi protocols)

### Planned
📋 Supabase backend setup
📋 Real-time price feeds
📋 Payment processing (subscriptions)
📋 Strategy marketplace transactions
📋 Mobile app (React Native)

## Development Priorities

### Phase 1: Foundation (Current)
- Complete authentication with Supabase
- Set up database schema
- Implement core trading bot engine
- Connect to test exchange APIs

### Phase 2: Core Features
- Real-time portfolio tracking
- Live trading execution
- DCA bot implementation
- Wallet integration

### Phase 3: Advanced Features
- AI signal processing
- Arbitrage detection
- Strategy marketplace
- Tax reporting

### Phase 4: Scale & Polish
- Mobile app
- Advanced analytics
- Performance optimization
- Security hardening

## Known Technical Debt
- Mock data needs replacement with real APIs
- Authentication flow incomplete
- No error boundaries
- Missing loading states in some components
- No comprehensive testing suite
- Bundle size optimization needed

## Security Considerations
- API key encryption
- Secure wallet connections
- Rate limiting for trading APIs
- User data privacy (GDPR compliance)
- Two-factor authentication
- Audit logs for trades

## Competitive Advantages
1. **All-in-One Platform** - Trading + DeFi + Portfolio in one dashboard
2. **AI-Powered Automation** - Smarter than rule-based bots
3. **Strategy Marketplace** - Unique monetization for strategy creators
4. **User Experience** - Clean, modern UI vs. cluttered competition
5. **Multi-Strategy Support** - More flexible than single-strategy platforms
