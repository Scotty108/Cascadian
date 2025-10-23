# Technical Specifications

# 1. Introduction

#### Executive Summary

**CASCADIAN** is an advanced AI-powered prediction market intelligence platform designed to transform how traders interact with Polymarket, the world's largest prediction market platform. Polymarket is the world's largest prediction market where users trade on the world's most highly-debated topics like crypto, politics, sports, current events, and more.

#### Core Business Problem

The prediction market ecosystem faces critical intelligence gaps that prevent traders from making systematic, data-driven decisions:

- **Information Asymmetry**: Large traders ("whales") with significant capital can influence market outcomes, but their activities are opaque to retail traders
- **Manual Market Monitoring**: With over 1,000+ active markets on Polymarket, manual screening and analysis is impossible for individual traders
- **Lack of Systematic Trading Tools**: Current prediction market platforms offer basic trading interfaces without advanced analytics, whale tracking, or automated execution capabilities
- **Reactive Trading Approach**: Most traders rely on personal speculation rather than systematic intelligence gathering and probability stacking

#### Key Stakeholders and Users

| Stakeholder Group | Profile | Primary Needs |
|---|---|---|
| **Active Polymarket Traders** | Crypto-native users, 25-45 years, $10K+ capital | Whale intelligence, automated strategies, portfolio analytics |
| **Quantitative Analysts** | Data scientists, Python proficient | Strategy automation, backtesting, API access |
| **Market Researchers** | Political/financial analysts | Insider signals, trend analysis, data export |
| **Casual Traders** | Part-time traders, $5K capital | Strategy marketplace, win rate tracking, educational tools |

#### Expected Business Impact and Value Proposition

CASCADIAN addresses the $9 billion prediction market opportunity by providing institutional-grade intelligence tools to retail traders. Polymarket has a post-money valuation of $9 billion following ICE's investment of up to $2 billion, reflecting a valuation of approximately $8 billion pre-investment. The platform democratizes sophisticated trading intelligence through:

**Immediate Value Creation**:
- **55%+ Strategy Win Rate**: Target average across all automated strategies through probability stacking
- **65%+ Signal Accuracy**: Whale and insider signal predictive accuracy
- **10K+ Weekly Executions**: Automated workflow execution volume
- **500+ DAU by Month 3**: Daily active user growth target

**Long-term Market Impact**:
- Transform prediction market trading from reactive speculation to systematic intelligence-driven decision making
- Create the first comprehensive API for prediction market intelligence, enabling ecosystem development
- Establish CASCADIAN as the "Bloomberg Terminal for prediction markets"

#### System Overview

#### Project Context

**Market Positioning**: CASCADIAN operates in the rapidly expanding prediction market sector, which has seen explosive growth following the 2024 U.S. election cycle. The 2024 election cycle proved their accuracy, with both Kalshi and Polymarket outperforming polling averages and driving a 300% spike in user adoption. 2025 marks the inflection point for prediction markets. Polymarket's $9 billion valuation and Kalshi's volume dominance illustrate not competition, but convergence of crypto-native innovation with regulated financial discipline.

**Current System Limitations**: Existing prediction market platforms provide basic trading functionality but lack:
- Comprehensive whale tracking and smart money analysis
- Automated strategy execution and workflow builders
- Real-time market intelligence signals and anomaly detection
- Portfolio analytics with risk management tools
- API access for developers and institutional users

**Enterprise Integration**: CASCADIAN integrates with the broader prediction market ecosystem through:
- **Polymarket APIs**: Direct integration with Gamma (markets), CLOB (trading), and Data (analytics) APIs
- **AI Services**: OpenAI GPT-4, Anthropic Claude, Google Gemini for market analysis
- **Financial Infrastructure**: ICE will become a global distributor of Polymarket's event-driven data, providing customers with sentiment indicators on topics of market relevance

#### High-Level Description

**Primary System Capabilities**:

| Core Capability | Description | Business Value |
|---|---|---|
| **Whale Intelligence** | Track large position holders, detect insider activity, analyze smart money flows | Identify profitable trading opportunities by following successful traders |
| **AI-Powered Analytics** | LLM-driven market analysis, momentum scoring, sentiment detection | Generate actionable trading signals from complex market data |
| **Visual Workflow Automation** | No-code strategy builder with 24/7 autonomous execution | Enable systematic trading without programming knowledge |
| **Portfolio Intelligence** | Comprehensive P&L tracking, risk metrics, performance analytics | Optimize trading performance through data-driven insights |

**Major System Components**:

```plaintext
┌─────────────────────────────────────────────────────────┐
│  TIER 3: Strategy Execution Layer (Autonomous Trading) │
│  • Visual workflow builder with AI copilot             │
│  • Paper trading and backtesting engine                │
│  • 24/7 autonomous market monitoring                   │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────────┐
│  TIER 2: Dashboard Layer (Visual Intelligence)         │
│  • Real-time whale tracking dashboards                 │
│  • Market screener with advanced filters               │
│  • Portfolio analytics and performance metrics         │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────────┐
│  TIER 1: API Intelligence Layer (Data & Signals)       │
│  • Enriched market data and whale intelligence         │
│  • AI-powered signals and anomaly detection            │
│  • Developer-friendly REST/GraphQL endpoints           │
└─────────────────────────────────────────────────────────┘
```

**Core Technical Approach**:
- **API-First Architecture**: All functionality accessible via REST APIs for maximum flexibility
- **Real-Time Intelligence**: 5-minute market sync with streaming execution updates
- **AI-Enhanced Decision Making**: LLM integration for market analysis and strategy optimization
- **Probability Stacking Methodology**: Systematic layering of multiple intelligence signals to minimize risk

#### Success Criteria

**Measurable Objectives**:

| Metric Category | Target | Measurement Method |
|---|---|---|
| **User Engagement** | 500+ DAU by Month 3 | Analytics tracking, session monitoring |
| **Trading Performance** | 55%+ average strategy win rate | Automated P&L calculation across all strategies |
| **Platform Reliability** | 99.5%+ API uptime | Infrastructure monitoring, error tracking |
| **Market Coverage** | 1,000+ active markets tracked | Database metrics, sync success rates |

**Critical Success Factors**:
1. **Data Quality & Reliability**: Maintain accurate, real-time market data with <5-minute staleness
2. **User Experience Excellence**: Intuitive interfaces that make complex trading concepts accessible
3. **AI Signal Accuracy**: Achieve 65%+ predictive accuracy for whale and momentum signals
4. **Scalable Architecture**: Support 10K+ concurrent users with sub-200ms response times

**Key Performance Indicators (KPIs)**:

| KPI | Current | Month 3 Target | Month 6 Target |
|---|---|---|---|
| Daily Active Users | 50 | 500 | 1,500 |
| Workflow Executions/Week | 100 | 10,000 | 50,000 |
| Average Session Duration | 8 min | 15 min | 20 min |
| User Retention (30-day) | 45% | 60% | 70% |
| API Response Time (p95) | 180ms | <150ms | <100ms |

#### Scope

#### In-Scope

#### Core Features and Functionalities

**Must-Have Capabilities (Phase 1 - Production Ready)**:
- **Market Discovery & Intelligence**: Advanced screener with 1,000+ markets, real-time OHLC charts, order book visualization
- **Whale Intelligence System**: Comprehensive tracking of large position holders, smart money flow analysis, insider signal detection
- **Portfolio Analytics**: Real-time P&L tracking, performance metrics (Sharpe ratio, win rate), risk management tools
- **Visual Workflow Builder**: No-code strategy automation with 6+ node types, AI copilot assistance, real-time execution

**Priority Integrations (Phase 2 - In Development)**:
- **AI-Powered Signals**: Momentum scoring, Smart Imbalance Index (SII), sentiment analysis
- **Trading Execution**: Direct Polymarket CLOB API integration, wallet connection (MetaMask, WalletConnect)
- **Advanced Analytics**: Backtesting engine, strategy performance comparison, custom signal creation

#### Implementation Boundaries

| Boundary Type | Scope Definition |
|---|---|
| **System Boundaries** | Web-based platform with API access, no mobile app in Phase 1 |
| **User Groups Covered** | Active Polymarket traders, analysts, developers (API consumers) |
| **Geographic Coverage** | Global access (excluding restricted jurisdictions) |
| **Data Domains** | Polymarket markets, events, wallet data, trade history, price feeds |

#### Key Technical Requirements

**Performance Requirements**:
- Market screener queries: <150ms (p95)
- Workflow execution: Real-time streaming with <100ms latency
- Database sync: Complete market refresh in <10 seconds
- API uptime: 99.5% availability target

**Integration Requirements**:
- **Polymarket APIs**: Gamma (markets), CLOB (trading), Data (wallets)
- **AI Services**: OpenAI GPT-4, Anthropic Claude, Google Gemini
- **Infrastructure**: Vercel (hosting), Supabase (database), Next.js (framework)

#### Out-of-Scope

#### Explicitly Excluded Features/Capabilities

**Phase 1 Exclusions**:
- Mobile application (iOS/Android native apps)
- Direct fund custody or wallet management
- Regulatory compliance for financial advice
- Integration with exchanges other than Polymarket
- Advanced charting tools (TradingView-level complexity)
- Social trading features (copy trading, social feeds)

**Technical Limitations**:
- No support for prediction markets outside Polymarket ecosystem
- No integration with traditional financial markets (stocks, forex)
- No cryptocurrency trading beyond USDC on Polygon
- No support for fiat currency deposits/withdrawals

#### Future Phase Considerations

**Phase 3-4 Roadmap Items** (Not in Current Scope):
- Mobile app development (React Native)
- Multi-platform prediction market support (Kalshi, Augur)
- Enterprise team collaboration features
- White-label platform options
- Advanced backtesting with historical market replay

#### Integration Points Not Covered

**External Services Not Integrated**:
- Traditional brokerage APIs (Interactive Brokers, TD Ameritrade)
- Social media platforms for sentiment analysis (Twitter, Reddit)
- News aggregation services beyond AI-powered analysis
- Payment processors for fiat transactions
- KYC/AML compliance services

#### Unsupported Use Cases

**User Scenarios Outside Scope**:
- Professional financial advisory services
- Institutional asset management
- Regulatory reporting and compliance
- Tax optimization and reporting
- Multi-asset portfolio management beyond prediction markets
- High-frequency trading with sub-second execution requirements

---

**Document Section**: Introduction
**Version**: 2.0
**Last Updated**: 2025-10-23
**Next Review**: 2025-11-23
**Maintained By**: Product Team

# 2. Product Requirements

#### Feature Catalog

#### F-001: Market Discovery & Intelligence System

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-001 |
| **Feature Name** | Market Discovery & Intelligence System |
| **Category** | Core Data Management |
| **Priority** | Critical |
| **Status** | Completed |

**Description:**
- **Overview**: Comprehensive market data indexing and metadata service that provides additional market categorization, indexed volume, and other market metadata through a REST API
- **Business Value**: Enables users to efficiently discover and analyze 1000+ active Polymarket markets with advanced filtering and search capabilities
- **User Benefits**: Reduces market research time from hours to minutes through intelligent filtering and real-time data access
- **Technical Context**: Built on Polymarket's Gamma API that indexes on-chain market data and provides hosted service with additional metadata

**Dependencies:**
- **Prerequisite Features**: None (foundational feature)
- **System Dependencies**: Supabase PostgreSQL, Next.js API Routes
- **External Dependencies**: Polymarket Gamma API, CLOB API, Data API
- **Integration Requirements**: Background sync system, TanStack Query caching

---

#### F-002: Whale Intelligence & Tracking System

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-002 |
| **Feature Name** | Whale Intelligence & Tracking System |
| **Category** | Advanced Analytics |
| **Priority** | Critical |
| **Status** | Completed |

**Description:**
- **Overview**: Intelligent system for detecting, scoring, and tracking large position holders (whales) across prediction markets
- **Business Value**: Provides institutional-grade intelligence on smart money flows and insider activity
- **User Benefits**: Enables users to follow successful traders and identify profitable trading opportunities
- **Technical Context**: Analyzes wallet positions and trading patterns to generate whale scores and smart money indicators

**Dependencies:**
- **Prerequisite Features**: F-001 (Market Discovery)
- **System Dependencies**: Wallet analytics database schema, scoring algorithms
- **External Dependencies**: Polymarket Data API for wallet positions and activity
- **Integration Requirements**: Real-time position tracking, leaderboard calculations

---

#### F-003: Visual Workflow Automation Engine

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-003 |
| **Feature Name** | Visual Workflow Automation Engine |
| **Category** | Strategy Automation |
| **Priority** | Critical |
| **Status** | Completed (MVP) |

**Description:**
- **Overview**: No-code visual strategy builder with drag-and-drop interface for creating automated trading workflows
- **Business Value**: Democratizes algorithmic trading by eliminating coding requirements
- **User Benefits**: Enables systematic trading strategies with 24/7 autonomous execution
- **Technical Context**: ReactFlow-based canvas with node execution engine and AI copilot assistance

**Dependencies:**
- **Prerequisite Features**: F-001 (Market Discovery), F-002 (Whale Intelligence)
- **System Dependencies**: Workflow execution engine, node executors, streaming infrastructure
- **External Dependencies**: OpenAI GPT-4, Anthropic Claude for AI copilot
- **Integration Requirements**: Real-time streaming (SSE), database persistence

---

#### F-004: Portfolio Analytics & Wallet Tracking

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-004 |
| **Feature Name** | Portfolio Analytics & Wallet Tracking |
| **Category** | Performance Analytics |
| **Priority** | High |
| **Status** | Completed |

**Description:**
- **Overview**: Comprehensive portfolio tracking with P&L calculation, performance metrics, and risk analysis
- **Business Value**: Provides professional-grade analytics for trading performance optimization
- **User Benefits**: Real-time position tracking, win rate analysis, and risk management insights
- **Technical Context**: Integrates with Polymarket Data API for position and trade history analysis

**Dependencies:**
- **Prerequisite Features**: F-001 (Market Discovery)
- **System Dependencies**: Portfolio calculation engine, performance metrics algorithms
- **External Dependencies**: Polymarket Data API for wallet positions and trade history
- **Integration Requirements**: Real-time P&L updates, historical data processing

---

#### F-005: AI-Powered Intelligence Signals

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-005 |
| **Feature Name** | AI-Powered Intelligence Signals |
| **Category** | Advanced Analytics |
| **Priority** | High |
| **Status** | In Development |

**Description:**
- **Overview**: Machine learning-driven signal generation including momentum scoring, sentiment analysis, and anomaly detection
- **Business Value**: Provides predictive intelligence for systematic trading decisions
- **User Benefits**: Automated signal generation with 65%+ accuracy for trading opportunities
- **Technical Context**: LLM integration with statistical analysis for market intelligence

**Dependencies:**
- **Prerequisite Features**: F-001 (Market Discovery), F-002 (Whale Intelligence)
- **System Dependencies**: Trade aggregation pipeline, signal calculation algorithms
- **External Dependencies**: OpenAI GPT-4, Anthropic Claude, Google Gemini
- **Integration Requirements**: Real-time data processing, WebSocket updates

---

#### F-006: Trading Execution Interface

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-006 |
| **Feature Name** | Trading Execution Interface |
| **Category** | Trading Operations |
| **Priority** | High |
| **Status** | In Development |

**Description:**
- **Overview**: Direct trading interface with wallet connection and order execution capabilities
- **Business Value**: Enables seamless transition from analysis to execution within the platform
- **User Benefits**: Integrated trading without switching between platforms
- **Technical Context**: Integration with Polymarket's CLOB (Central Limit Order Book) for order execution

**Dependencies:**
- **Prerequisite Features**: F-001 (Market Discovery), F-003 (Workflow Automation)
- **System Dependencies**: Wallet connection infrastructure, order management system
- **External Dependencies**: Polymarket CLOB API, MetaMask, WalletConnect
- **Integration Requirements**: Secure wallet integration, order status tracking

---

#### F-007: Community Strategy Marketplace

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-007 |
| **Feature Name** | Community Strategy Marketplace |
| **Category** | Community Features |
| **Priority** | Medium |
| **Status** | In Development |

**Description:**
- **Overview**: Platform for sharing, rating, and monetizing trading strategies within the community
- **Business Value**: Creates network effects and additional revenue streams through strategy sales
- **User Benefits**: Access to proven strategies and ability to monetize successful approaches
- **Technical Context**: Strategy versioning, performance tracking, and payment processing integration

**Dependencies:**
- **Prerequisite Features**: F-003 (Workflow Automation), F-004 (Portfolio Analytics)
- **System Dependencies**: User profiles, rating system, payment processing
- **External Dependencies**: Payment processors, content moderation services
- **Integration Requirements**: Strategy performance validation, revenue sharing

---

#### F-008: Real-Time Data Synchronization

| **Attribute** | **Details** |
|---|---|
| **Feature ID** | F-008 |
| **Feature Name** | Real-Time Data Synchronization |
| **Category** | Infrastructure |
| **Priority** | Critical |
| **Status** | Completed |

**Description:**
- **Overview**: Background synchronization system maintaining fresh market data with 5-minute refresh cycles
- **Business Value**: Ensures data accuracy and platform reliability for trading decisions
- **User Benefits**: Always current market information without manual refresh
- **Technical Context**: Scheduled sync jobs with error handling and graceful degradation

**Dependencies:**
- **Prerequisite Features**: None (foundational infrastructure)
- **System Dependencies**: Cron scheduling, database UPSERT operations, mutex locking
- **External Dependencies**: Polymarket Gamma API reliability
- **Integration Requirements**: Background job processing, error monitoring

---

#### Functional Requirements Tables

#### F-001: Market Discovery & Intelligence System

| **Requirement ID** | **Description** | **Acceptance Criteria** | **Priority** | **Complexity** |
|---|---|---|---|---|
| F-001-RQ-001 | Market Data Ingestion | System shall sync 1000+ markets every 5 minutes | Must-Have | Medium |
| F-001-RQ-002 | Advanced Filtering | Support category, volume, liquidity, date range filters | Must-Have | Low |
| F-001-RQ-003 | Full-Text Search | Fuzzy search across market titles and descriptions | Must-Have | Medium |
| F-001-RQ-004 | Real-Time Charts | OHLC price charts with multiple timeframes | Should-Have | High |
| F-001-RQ-005 | Order Book Display | Live bid/ask visualization with depth | Should-Have | Medium |

**Technical Specifications:**
- **Input Parameters**: Category filters, volume thresholds, search terms, pagination
- **Output/Response**: Paginated market list with metadata, OHLC data, order book snapshots
- **Performance Criteria**: <150ms query response time (p95), 99.5% API uptime
- **Data Requirements**: PostgreSQL with indexed columns, full-text search capabilities

**Validation Rules:**
- **Business Rules**: Only active markets displayed by default, volume thresholds validated
- **Data Validation**: Market IDs must be valid hex strings, dates in ISO format
- **Security Requirements**: Rate limiting, input sanitization, SQL injection prevention
- **Compliance Requirements**: Data retention policies, user privacy protection

---

#### F-002: Whale Intelligence & Tracking System

| **Requirement ID** | **Description** | **Acceptance Criteria** | **Priority** | **Complexity** |
|---|---|---|---|---|
| F-002-RQ-001 | Whale Detection | Identify wallets with positions >$10K | Must-Have | Medium |
| F-002-RQ-002 | Smart Money Scoring | Calculate win rate, Sharpe ratio, ROI metrics | Must-Have | High |
| F-002-RQ-003 | Position Tracking | Monitor position changes and reversals | Must-Have | Medium |
| F-002-RQ-004 | Leaderboard Rankings | Rank traders by performance metrics | Should-Have | Low |
| F-002-RQ-005 | Insider Detection | Flag unusual trading patterns | Could-Have | High |

**Technical Specifications:**
- **Input Parameters**: Wallet addresses, position thresholds, time windows
- **Output/Response**: Whale scores, position data, trading activity, rankings
- **Performance Criteria**: <100ms wallet lookup, real-time position updates
- **Data Requirements**: Wallet positions table, trade history, calculated metrics

**Validation Rules:**
- **Business Rules**: Minimum position size for whale classification, scoring algorithms
- **Data Validation**: Valid Ethereum addresses, positive position values
- **Security Requirements**: Wallet address anonymization options, data privacy
- **Compliance Requirements**: No personal information storage, public data only

---

#### F-003: Visual Workflow Automation Engine

| **Requirement ID** | **Description** | **Acceptance Criteria** | **Priority** | **Complexity** |
|---|---|---|---|---|
| F-003-RQ-001 | Visual Canvas | Drag-and-drop workflow builder with ReactFlow | Must-Have | High |
| F-003-RQ-002 | Node Execution | Support 10+ node types with streaming execution | Must-Have | High |
| F-003-RQ-003 | AI Copilot | Conversational strategy building with LLM | Should-Have | High |
| F-003-RQ-004 | Strategy Persistence | Save/load workflows to database | Must-Have | Medium |
| F-003-RQ-005 | Real-Time Logs | Stream execution status and outputs | Must-Have | Medium |

**Technical Specifications:**
- **Input Parameters**: Workflow definition (nodes, edges), execution variables
- **Output/Response**: Streaming execution events, node outputs, error states
- **Performance Criteria**: <100ms streaming latency, 10-second execution timeout
- **Data Requirements**: JSONB workflow storage, execution history tracking

**Validation Rules:**
- **Business Rules**: Workflow validation, cycle detection, node configuration
- **Data Validation**: Valid node types, required parameters, edge connections
- **Security Requirements**: Sandboxed code execution, resource limits
- **Compliance Requirements**: User workflow ownership, data isolation

---

#### F-004: Portfolio Analytics & Wallet Tracking

| **Requirement ID** | **Description** | **Acceptance Criteria** | **Priority** | **Complexity** |
|---|---|---|---|---|
| F-004-RQ-001 | Position Tracking | Real-time P&L calculation for all positions | Must-Have | Medium |
| F-004-RQ-002 | Performance Metrics | Calculate Sharpe ratio, win rate, ROI | Must-Have | Medium |
| F-004-RQ-003 | Risk Analysis | Position concentration, exposure by category | Should-Have | Medium |
| F-004-RQ-004 | Historical Analysis | Performance over time periods (7d, 30d, all-time) | Should-Have | Low |
| F-004-RQ-005 | Activity Timeline | Chronological trade and position history | Could-Have | Low |

**Technical Specifications:**
- **Input Parameters**: Wallet address, time periods, position filters
- **Output/Response**: Portfolio value, P&L metrics, position details, activity log
- **Performance Criteria**: <80ms wallet data retrieval, real-time updates
- **Data Requirements**: Position snapshots, trade history, price data

**Validation Rules:**
- **Business Rules**: P&L calculation accuracy, metric definitions
- **Data Validation**: Valid wallet addresses, positive values, date ranges
- **Security Requirements**: Public wallet data only, no private keys
- **Compliance Requirements**: Data accuracy disclaimers, no financial advice

---

#### F-005: AI-Powered Intelligence Signals

| **Requirement ID** | **Description** | **Acceptance Criteria** | **Priority** | **Complexity** |
|---|---|---|---|---|
| F-005-RQ-001 | Momentum Scoring | Price velocity analysis with confidence intervals | Must-Have | High |
| F-005-RQ-002 | Smart Imbalance Index | Buy/sell pressure detection algorithm | Must-Have | High |
| F-005-RQ-003 | Sentiment Analysis | LLM-powered market sentiment scoring | Should-Have | High |
| F-005-RQ-004 | Anomaly Detection | Statistical outlier identification | Should-Have | High |
| F-005-RQ-005 | Signal Aggregation | Combine multiple signals with weighting | Could-Have | Medium |

**Technical Specifications:**
- **Input Parameters**: Market data, trade history, time windows, signal types
- **Output/Response**: Signal scores, confidence levels, trend indicators
- **Performance Criteria**: <500ms signal calculation, 65%+ accuracy target
- **Data Requirements**: Trade aggregation pipeline, statistical models

**Validation Rules:**
- **Business Rules**: Signal accuracy thresholds, confidence scoring
- **Data Validation**: Sufficient data volume, valid time periods
- **Security Requirements**: Model protection, API rate limiting
- **Compliance Requirements**: Signal accuracy disclaimers, no guarantees

---

#### Feature Relationships

#### Dependency Map

```mermaid
graph TD
    F001[F-001: Market Discovery] --> F002[F-002: Whale Intelligence]
    F001 --> F003[F-003: Workflow Automation]
    F001 --> F004[F-004: Portfolio Analytics]
    F001 --> F005[F-005: Intelligence Signals]
    
    F002 --> F003
    F002 --> F005
    
    F003 --> F006[F-006: Trading Execution]
    F003 --> F007[F-007: Strategy Marketplace]
    
    F004 --> F007
    
    F008[F-008: Data Sync] --> F001
    F008 --> F002
    F008 --> F004
```

#### Integration Points

| **Feature Pair** | **Integration Type** | **Shared Components** | **Data Flow** |
|---|---|---|---|
| F-001 ↔ F-002 | Data Dependency | Market data, wallet positions | Market data feeds whale analysis |
| F-001 ↔ F-003 | Service Integration | Market screener, API endpoints | Workflow nodes consume market data |
| F-002 ↔ F-003 | Intelligence Layer | Whale scores, position tracking | Whale signals trigger workflow actions |
| F-003 ↔ F-006 | Execution Pipeline | Order placement, position management | Workflows execute trades automatically |
| F-004 ↔ F-007 | Performance Validation | Strategy metrics, P&L tracking | Strategy performance drives marketplace ratings |

#### Common Services

| **Service** | **Used By Features** | **Purpose** |
|---|---|---|
| Polymarket API Client | F-001, F-002, F-004, F-006 | External data integration |
| Database Layer | All Features | Data persistence and retrieval |
| Authentication Service | F-003, F-004, F-006, F-007 | User management and security |
| Caching Layer | F-001, F-002, F-005 | Performance optimization |
| Streaming Infrastructure | F-003, F-005, F-008 | Real-time updates |

#### Implementation Considerations

#### F-001: Market Discovery & Intelligence System

**Technical Constraints:**
- API rate limiting: 1,000 calls/hour for basic access, premium tiers for higher volume
- Database storage limits on Supabase free tier (500MB)
- Next.js serverless function timeout (10 seconds)

**Performance Requirements:**
- Market screener queries: <150ms (p95)
- Full market sync: <10 seconds for 1000+ markets
- Database query optimization with proper indexing

**Scalability Considerations:**
- Horizontal scaling through Vercel serverless functions
- Database read replicas for analytics queries
- CDN caching for static market metadata

**Security Implications:**
- Input validation for all query parameters
- SQL injection prevention through parameterized queries
- Rate limiting to prevent API abuse

**Maintenance Requirements:**
- Daily monitoring of sync success rates
- Weekly database performance analysis
- Monthly API usage review and optimization

---

#### F-002: Whale Intelligence & Tracking System

**Technical Constraints:**
- Polymarket Data API limitations for wallet activity tracking
- Complex scoring algorithms requiring significant computation
- Large dataset processing for historical analysis

**Performance Requirements:**
- Whale detection: <100ms for position lookup
- Score calculation: Batch processing for efficiency
- Real-time position updates with minimal latency

**Scalability Considerations:**
- Background job processing for score calculations
- Caching of frequently accessed whale data
- Database partitioning by wallet address

**Security Implications:**
- Wallet address validation and sanitization
- Privacy protection for whale identities
- Secure storage of sensitive trading data

**Maintenance Requirements:**
- Regular algorithm tuning based on performance
- Monitoring of whale detection accuracy
- Periodic cleanup of stale position data

---

#### F-003: Visual Workflow Automation Engine

**Technical Constraints:**
- ReactFlow performance with large workflow graphs
- Serverless function execution time limits
- Memory constraints for complex workflow execution

**Performance Requirements:**
- Canvas rendering: <100ms for workflow load
- Node execution: Variable based on complexity
- Streaming latency: <100ms per update

**Scalability Considerations:**
- Workflow execution queue for high volume
- Distributed processing for parallel node execution
- Caching of frequently used workflow templates

**Security Implications:**
- Sandboxed code execution in JavaScript nodes
- Resource limits to prevent abuse
- User workflow isolation and access control

**Maintenance Requirements:**
- Regular testing of node executors
- Performance monitoring of workflow execution
- User feedback integration for UX improvements

---

#### F-004: Portfolio Analytics & Wallet Tracking

**Technical Constraints:**
- Dependency on Polymarket Data API for position data
- Complex P&L calculations requiring historical price data
- Real-time updates challenging with large portfolios

**Performance Requirements:**
- Portfolio load: <80ms for wallet data retrieval
- P&L calculation: <200ms for complex portfolios
- Real-time updates: <5 second latency

**Scalability Considerations:**
- Caching of calculated metrics
- Background processing for heavy computations
- Database optimization for time-series data

**Security Implications:**
- Public wallet data only, no private information
- Secure handling of financial calculations
- Data accuracy validation and error handling

**Maintenance Requirements:**
- Regular validation of P&L accuracy
- Monitoring of data sync reliability
- Performance optimization based on usage patterns

---

#### F-005: AI-Powered Intelligence Signals

**Technical Constraints:**
- LLM API rate limits and costs
- Complex statistical calculations requiring significant compute
- Real-time processing challenges with large datasets

**Performance Requirements:**
- Signal calculation: <500ms for standard signals
- LLM analysis: <2 seconds for sentiment scoring
- Batch processing: Efficient handling of multiple markets

**Scalability Considerations:**
- Distributed signal processing
- Caching of expensive LLM results
- Queue-based processing for high volume

**Security Implications:**
- API key protection for LLM services
- Model output validation and sanitization
- Rate limiting to control costs

**Maintenance Requirements:**
- Regular accuracy testing of signals
- Cost monitoring for LLM usage
- Algorithm updates based on market changes

---

#### Traceability Matrix

| **Business Requirement** | **Features** | **Technical Components** | **Test Cases** |
|---|---|---|---|
| Market Intelligence Platform | F-001, F-002, F-005 | Market screener, whale tracking, signals | Integration tests, performance tests |
| Automated Trading System | F-003, F-006 | Workflow engine, trading interface | End-to-end automation tests |
| Portfolio Management | F-004 | Analytics engine, P&L calculation | Accuracy validation tests |
| Community Platform | F-007 | Strategy marketplace, user profiles | User acceptance tests |
| Real-Time Data | F-008 | Sync system, caching layer | Data consistency tests |

---

**Document Version**: 2.0  
**Last Updated**: 2025-10-23  
**Next Review**: 2025-11-23  
**Maintained By**: Product Team

# 3. Technology Stack

## 3.1 Programming Languages

### 3.1.1 Primary Languages

**TypeScript 5.8.3** - Primary development language
- **Justification**: TypeScript builds on top of JavaScript by adding syntax for types, allowing us to explain intent and have other tools check our code to catch mistakes like typos, issues with null and undefined, and more. Types also power TypeScript's editor tooling like the auto-completion, code navigation, and refactorings
- **Selection Criteria**: 
  - Strong type safety for large-scale application development
  - Excellent IDE support and developer experience
  - Seamless integration with React and Next.js ecosystem
  - TypeScript 5.8 brings significant improvements in code safety, build efficiency, and diagnostics responsiveness. These updates help developers catch errors early, work more efficiently with iterables, and maintain productivity during large-scale builds
- **Constraints**: Must maintain compatibility with React 19.2.0 and Next.js 15.5

**JavaScript ES2024** - Runtime execution and legacy compatibility
- **Justification**: Required for browser execution and Node.js runtime compatibility
- **Selection Criteria**: Modern ES features for optimal performance and developer experience
- **Constraints**: Must support Node.js 20.19.3 runtime environment

### 3.1.2 Platform-Specific Languages

**SQL (PostgreSQL 15+)** - Database operations and stored procedures
- **Justification**: Native database language for complex queries, triggers, and functions
- **Selection Criteria**: Advanced PostgreSQL features including JSONB, full-text search, and Row-Level Security
- **Constraints**: Must be compatible with Supabase PostgreSQL distribution

## 3.2 Frameworks & Libraries

### 3.2.1 Core Frontend Framework

**Next.js 15.5** - Full-stack React framework
- **Justification**: Next.js 15.5 includes Turbopack builds in beta, stable Node.js middleware, TypeScript improvements, next lint deprecation, and deprecation warnings for Next.js 16
- **Selection Criteria**:
  - Server-side rendering (SSR) and static site generation (SSG) capabilities
  - Built-in API routes for serverless functions
  - Excellent developer experience with hot reloading
  - Turbopack now powers Vercel websites including vercel.com, v0.app, and nextjs.org, accelerating iteration velocity through faster preview and production deployment builds
- **Compatibility Requirements**: React 19.2.0, TypeScript 5.8.3, Node.js 20.19.3
- **Version Constraints**: Using App Router architecture (not Pages Router)

**React 19.2.0** - UI component library
- **Justification**: React 19.2 is now available on npm! This is our third release in the last year, following React 19 in December and React 19.1 in June. In this post, we'll give an overview of the new features in React 19.2
- **Selection Criteria**:
  - Component-based architecture for maintainable UI
  - Excellent ecosystem and community support
  - Early benchmarks show React 19 improves hydration speed, reduces unnecessary re-renders, and decreases bundle sizes, resulting in faster load times and smoother interactions compared to React 18
- **Compatibility Requirements**: TypeScript 5.8.3, Next.js 15.5

### 3.2.2 Styling & UI Components

**TailwindCSS 4.1** - Utility-first CSS framework
- **Justification**: Tailwind CSS v4.1 is here and it's packed with improvements that will help you (or your LLM, you coward) build even better interactive experiences
- **Selection Criteria**:
  - Rapid UI development with utility classes
  - New high-performance engine — where full builds are up to 5x faster, and incremental builds are over 100x faster — and measured in microseconds. Designed for the modern web — built on cutting-edge CSS features like cascade layers, registered custom properties with @property, and color-mix(). Simplified installation — fewer dependencies, zero configuration, and just a single line of code in your CSS file
  - Consistent design system across the application
- **Compatibility Requirements**: PostCSS, Next.js 15.5
- **Version Constraints**: Using v4.x architecture with @theme configuration

**Radix UI + shadcn/ui** - Accessible component primitives
- **Justification**: Provides unstyled, accessible components that integrate seamlessly with TailwindCSS
- **Selection Criteria**:
  - WAI-ARIA compliant components
  - Headless architecture for maximum customization
  - Excellent TypeScript support
- **Compatibility Requirements**: React 19.2.0, TailwindCSS 4.1

### 3.2.3 State Management & Data Fetching

**TanStack Query (React Query) 5.x** - Server state management
- **Justification**: Industry-standard solution for server state synchronization and caching
- **Selection Criteria**:
  - Automatic caching with configurable stale times
  - Request deduplication and background refetching
  - Optimistic updates and error handling
  - Excellent developer experience with DevTools
- **Compatibility Requirements**: React 19.2.0, TypeScript 5.8.3

**React Context API** - Client-side state management
- **Justification**: Built-in React solution for global UI state (theme, modals, notifications)
- **Selection Criteria**: Lightweight, no additional dependencies, excellent TypeScript support

### 3.2.4 Specialized Libraries

**ReactFlow (@xyflow/react) 12.x** - Workflow visualization
- **Justification**: Purpose-built for node-based workflow editors with excellent performance
- **Selection Criteria**:
  - Drag-and-drop node editing capabilities
  - Custom node types and edge connections
  - Built-in zoom, pan, and selection features
  - TypeScript support and React 19 compatibility

**ECharts 5.x & Recharts 2.x** - Data visualization
- **Justification**: Complementary charting libraries for different use cases
- **Selection Criteria**:
  - ECharts: High-performance OHLC charts and complex visualizations
  - Recharts: React-native charts for simple data visualization
  - Both support responsive design and theming

## 3.3 Open Source Dependencies

### 3.3.1 Core Dependencies

| Package | Version | Registry | Purpose | License |
|---------|---------|----------|---------|---------|
| `next` | 15.5.x | npm | React framework | MIT |
| `react` | 19.2.x | npm | UI library | MIT |
| `react-dom` | 19.2.x | npm | React DOM renderer | MIT |
| `typescript` | 5.8.3 | npm | Type system | Apache-2.0 |
| `tailwindcss` | 4.1.x | npm | CSS framework | MIT |
| `@tanstack/react-query` | 5.x | npm | Data fetching | MIT |
| `@xyflow/react` | 12.x | npm | Workflow editor | MIT |

### 3.3.2 UI & Styling Dependencies

| Package | Version | Registry | Purpose | License |
|---------|---------|----------|---------|---------|
| `@radix-ui/react-*` | Latest | npm | UI primitives | MIT |
| `class-variance-authority` | Latest | npm | CSS class utilities | Apache-2.0 |
| `clsx` | Latest | npm | Conditional classes | MIT |
| `tailwind-merge` | Latest | npm | TailwindCSS class merging | MIT |
| `lucide-react` | Latest | npm | Icon library | ISC |

### 3.3.3 Form & Validation Dependencies

| Package | Version | Registry | Purpose | License |
|---------|---------|----------|---------|---------|
| `react-hook-form` | 7.x | npm | Form management | MIT |
| `zod` | 3.x | npm | Schema validation | MIT |
| `@hookform/resolvers` | 3.x | npm | Form validation integration | MIT |

### 3.3.4 Development Dependencies

| Package | Version | Registry | Purpose | License |
|---------|---------|----------|---------|---------|
| `@types/node` | 20.x | npm | Node.js types | MIT |
| `@types/react` | 19.x | npm | React types | MIT |
| `@types/react-dom` | 19.x | npm | React DOM types | MIT |
| `eslint` | 9.x | npm | Code linting | MIT |
| `prettier` | 3.x | npm | Code formatting | MIT |
| `autoprefixer` | Latest | npm | CSS vendor prefixes | MIT |
| `postcss` | Latest | npm | CSS processing | MIT |

### 3.3.5 Package Manager Configuration

**pnpm 10.18.1** - Package manager
- **Justification**: Faster installs, disk space efficiency, and strict dependency resolution
- **Selection Criteria**:
  - Monorepo support for future scaling
  - Better security with isolated node_modules
  - Excellent performance compared to npm/yarn

## 3.4 Third-Party Services

### 3.4.1 External APIs & Integrations

**Polymarket APIs** - Core data source
- **Gamma API**: `https://gamma-api.polymarket.com` - Market metadata and events
- **CLOB API**: `https://clob.polymarket.com` - Order books and trade history  
- **Data API**: `https://data-api.polymarket.com` - Wallet positions and holder rankings
- **Integration Pattern**: HTTP client with retry logic and exponential backoff
- **Rate Limits**: 100 requests/minute (managed through request queuing)

### 3.4.2 AI & Machine Learning Services

**OpenAI GPT-4** - Market analysis and conversational AI
- **Integration**: Vercel AI SDK for streaming responses
- **Use Cases**: Market sentiment analysis, strategy recommendations, AI copilot
- **Rate Limits**: Managed through API key rotation and request batching

**Anthropic Claude** - Strategy building copilot
- **Integration**: Vercel AI SDK for conversational workflow building
- **Use Cases**: Natural language to workflow conversion, strategy optimization
- **Rate Limits**: Tier-based limits with fallback to other providers

**Google Gemini** - Multimodal analysis and image generation
- **Integration**: Direct API integration for specialized use cases
- **Use Cases**: Image analysis, chart generation, multimodal market research
- **Rate Limits**: Pay-per-use model with cost monitoring

### 3.4.3 Authentication & Security Services

**Supabase Auth** - User authentication and authorization
- **Integration**: Native Supabase client integration
- **Features**: Email/password, OAuth providers, JWT tokens, Row-Level Security
- **Security**: HTTPS-only, secure cookie handling, automatic token refresh

### 3.4.4 Monitoring & Analytics Services

**Vercel Analytics** - Web performance monitoring
- **Integration**: Built-in Next.js integration
- **Metrics**: Core Web Vitals, page performance, user engagement
- **Privacy**: GDPR compliant, no personal data collection

## 3.5 Databases & Storage

### 3.5.1 Primary Database

**Supabase PostgreSQL 15+** - Production database
- **Justification**: Supabase Postgres is a batteries-included PostgreSQL distribution that provides unmodified PostgreSQL with a curated set of the most useful extensions pre-installed. Think of it as PostgreSQL with superpowers - you get the reliability and power of standard PostgreSQL, plus immediate access to extensions. The goal is simple: make it fast and easy to get started with a production-ready PostgreSQL setup
- **Selection Criteria**:
  - Managed PostgreSQL with automatic backups and scaling
  - Built-in Row-Level Security (RLS) for data isolation
  - Real-time subscriptions for live data updates
  - Full-text search capabilities with pg_trgm extension
- **Configuration**: Connection pooling via PgBouncer, read replicas for analytics queries
- **Extensions Used**: pg_trgm (fuzzy search), uuid-ossp (UUID generation), pg_stat_statements (query analysis)

### 3.5.2 Data Persistence Strategies

**Relational Data Model**:
```sql
-- Core entities with proper indexing
markets (market_id, title, category, volume_24h, active, end_date)
market_analytics (market_id, trades_24h, momentum_score, buy_sell_ratio)
wallets (address, whale_score, smart_money_score, reputation_score)
wallet_positions (wallet_address, market_id, shares, unrealized_pnl)
workflow_sessions (id, user_id, nodes JSONB, edges JSONB, version)
```

**JSONB Storage**:
- Workflow definitions stored as JSONB for flexibility
- Market metadata from Polymarket APIs preserved as JSONB
- User preferences and settings in structured JSONB format

**Indexing Strategy**:
- Partial indexes on `active=true` markets for performance
- Composite indexes (category + volume) for common query patterns
- GIN indexes for JSONB queries and full-text search
- B-tree indexes for timestamp-based queries

### 3.5.3 Caching Solutions

**Multi-Layer Caching Architecture**:

1. **Browser Cache (React Query)**:
   - 5-minute stale time for market data
   - 30-second stale time for wallet data
   - Automatic background refetching
   - Request deduplication

2. **API Response Cache (Future - Redis)**:
   - 1-minute cache for expensive queries
   - Shared across all users
   - Cache invalidation on data updates

3. **Database Query Cache (PostgreSQL)**:
   - Built-in query plan caching
   - Connection pooling via PgBouncer
   - Prepared statement caching

### 3.5.4 Storage Services

**Supabase Storage** - File and asset storage
- **Use Cases**: User avatars, workflow exports, generated reports
- **Configuration**: Public and private buckets with RLS policies
- **Integration**: Direct upload from client with signed URLs

**Vercel Edge Config** (Future) - Global configuration storage
- **Use Cases**: Feature flags, API rate limits, system configuration
- **Benefits**: Ultra-low latency global distribution
- **Integration**: Next.js middleware integration

## 3.6 Development & Deployment

### 3.6.1 Development Tools

**Node.js 20.19.3** - JavaScript runtime
- **Justification**: LTS version with excellent stability and performance
- **Selection Criteria**: 
  - Long-term support until April 2026
  - Native ES modules support
  - Improved performance over Node.js 18
- **Constraints**: Node.js 18 reached its official end of life on April 30, 2025 and no longer receives security updates or critical fixes. Continuing to support unsupported runtimes introduces risks for both developers and end users. Please upgrade to a supported Node.js version (20 or later)

**Visual Studio Code** - Primary IDE
- **Extensions**: TypeScript, Prettier, ESLint, TailwindCSS IntelliSense
- **Configuration**: Workspace settings for consistent formatting and linting
- **Integration**: Built-in Git support, integrated terminal, debugging capabilities

### 3.6.2 Build System

**Next.js Build System** - Integrated build pipeline
- **Features**:
  - Turbopack Builds (beta): Production turbopack builds (next build --turbopack) now in beta. Turbopack now powers Vercel websites including vercel.com, v0.app, and nextjs.org
  - Automatic code splitting and tree shaking
  - Image optimization with next/image
  - CSS optimization and minification
- **Configuration**: Custom webpack config for specialized requirements
- **Performance**: <5 second build times for incremental changes

**PostCSS Pipeline** - CSS processing
- **Plugins**: TailwindCSS, Autoprefixer, CSS Nano (production)
- **Configuration**: Optimized for TailwindCSS v4 architecture
- **Integration**: Seamless Next.js integration with hot reloading

### 3.6.3 Containerization

**Docker** - Development environment consistency
- **Use Cases**: Local development with Supabase, CI/CD pipeline consistency
- **Configuration**: Multi-stage builds for optimized production images
- **Integration**: Docker Compose for local development stack

**Supabase CLI** - Local development environment
- **Features**: Local PostgreSQL instance, Edge Functions, Auth emulation
- **Configuration**: Matches production Supabase environment
- **Integration**: Seamless migration between local and production

### 3.6.4 CI/CD Requirements

**GitHub Actions** - Continuous integration and deployment
- **Pipeline Stages**:
  1. **Lint & Type Check**: ESLint, Prettier, TypeScript compilation
  2. **Build**: Next.js production build with Turbopack
  3. **Test**: Unit tests, integration tests (future)
  4. **Deploy**: Automatic deployment to Vercel on main branch
- **Configuration**: Matrix builds for Node.js versions, caching for dependencies
- **Security**: Encrypted secrets, dependency vulnerability scanning

**Vercel Deployment** - Production hosting
- **Features**:
  - Automatic deployments from Git
  - Preview deployments for pull requests
  - Edge functions for API routes
  - Global CDN with automatic optimization
- **Configuration**: Environment variables, custom domains, analytics
- **Integration**: GitHub integration, automatic HTTPS, performance monitoring

### 3.6.5 Quality Assurance Tools

**ESLint 9.x** - Code linting and style enforcement
- **Configuration**: Next.js recommended rules, TypeScript strict mode
- **Custom Rules**: Import ordering, naming conventions, accessibility checks
- **Integration**: Pre-commit hooks, IDE integration, CI/CD pipeline

**Prettier 3.x** - Code formatting
- **Configuration**: Consistent formatting across TypeScript, CSS, JSON, Markdown
- **Integration**: Save-on-format in IDE, pre-commit hooks
- **Compatibility**: ESLint integration to avoid conflicts

**TypeScript Strict Mode** - Enhanced type checking
- **Configuration**: Strict null checks, no implicit any, exact optional property types
- **Benefits**: Catch errors at compile time, improved IDE experience
- **Coverage**: Target 95%+ type coverage across codebase

### 3.6.6 Security Considerations

**Dependency Security**:
- Automated vulnerability scanning with GitHub Dependabot
- Regular dependency updates with automated testing
- License compliance checking for all dependencies

**Code Security**:
- Input validation with Zod schemas
- SQL injection prevention through parameterized queries
- XSS protection through React's built-in escaping
- CSRF protection through SameSite cookies

**Infrastructure Security**:
- HTTPS enforcement across all environments
- Environment variable encryption
- Row-Level Security (RLS) policies in database
- API rate limiting and abuse prevention

This technology stack provides a robust, scalable foundation for CASCADIAN's prediction market intelligence platform, leveraging modern web technologies while maintaining security, performance, and developer experience as top priorities.

##### 4. Process Flowcharts

## 4.1 System Workflow Overview

### 4.1.1 High-Level System Architecture Flow

The CASCADIAN platform operates through interconnected workflows that process prediction market data, execute intelligent analysis, and provide automated trading capabilities. Flowcharts are composed of nodes (geometric shapes) and edges (arrows or lines), with the Mermaid code defining how nodes and edges are made and accommodating different arrow types, multi-directional arrows, and any linking to and from subgraphs.

```mermaid
flowchart TD
    %% External Data Sources
    PM_GAMMA[Polymarket Gamma API<br/>Markets & Events]
    PM_CLOB[Polymarket CLOB API<br/>Order Books & Trades]
    PM_DATA[Polymarket Data API<br/>Wallets & Positions]
    
    %% Core System Components
    SYNC[Data Synchronization<br/>Engine]
    DB[(Supabase PostgreSQL<br/>Database)]
    API[Next.js API Routes<br/>Business Logic]
    UI[React Frontend<br/>User Interface]
    
    %% AI Services
    OPENAI[OpenAI GPT-4<br/>Market Analysis]
    CLAUDE[Anthropic Claude<br/>Strategy Copilot]
    GEMINI[Google Gemini<br/>Multimodal AI]
    
    %% Workflow Engine
    EXECUTOR[Workflow Execution<br/>Engine]
    
    %% User Actions
    USER[User Interactions]
    
    %% Data Flow
    PM_GAMMA --> SYNC
    PM_CLOB --> SYNC
    PM_DATA --> SYNC
    
    SYNC --> DB
    DB --> API
    API --> UI
    
    USER --> UI
    UI --> API
    API --> EXECUTOR
    
    EXECUTOR --> OPENAI
    EXECUTOR --> CLAUDE
    EXECUTOR --> GEMINI
    
    OPENAI --> EXECUTOR
    CLAUDE --> EXECUTOR
    GEMINI --> EXECUTOR
    
    EXECUTOR --> API
    API --> UI
    
    %% Styling
    classDef external fill:#e1f5fe,stroke:#0277bd,stroke-width:2px
    classDef core fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef ai fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef user fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    
    class PM_GAMMA,PM_CLOB,PM_DATA external
    class SYNC,DB,API,UI,EXECUTOR core
    class OPENAI,CLAUDE,GEMINI ai
    class USER user
```

### 4.1.2 Core Business Process Flow

```mermaid
flowchart LR
    %% User Journey Stages
    START([User Accesses Platform])
    AUTH{Authenticated?}
    LOGIN[Sign In/Sign Up]
    DASHBOARD[Dashboard Landing]
    
    %% Core Features
    DISCOVER[Market Discovery<br/>& Screening]
    WHALE[Whale Intelligence<br/>Tracking]
    PORTFOLIO[Portfolio Analytics<br/>& Tracking]
    STRATEGY[Strategy Builder<br/>& Automation]
    
    %% Decision Points
    FEATURE_CHOICE{Choose Feature}
    
    %% Outcomes
    INSIGHTS[Generate Trading<br/>Insights]
    EXECUTE[Execute Trading<br/>Strategies]
    MONITOR[Monitor Performance<br/>& Results]
    
    %% Flow Connections
    START --> AUTH
    AUTH -->|No| LOGIN
    AUTH -->|Yes| DASHBOARD
    LOGIN --> DASHBOARD
    
    DASHBOARD --> FEATURE_CHOICE
    
    FEATURE_CHOICE -->|Market Research| DISCOVER
    FEATURE_CHOICE -->|Follow Whales| WHALE
    FEATURE_CHOICE -->|Track Portfolio| PORTFOLIO
    FEATURE_CHOICE -->|Automate Trading| STRATEGY
    
    DISCOVER --> INSIGHTS
    WHALE --> INSIGHTS
    PORTFOLIO --> INSIGHTS
    STRATEGY --> EXECUTE
    
    INSIGHTS --> EXECUTE
    EXECUTE --> MONITOR
    MONITOR --> FEATURE_CHOICE
    
    %% Styling
    classDef start fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef decision fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef process fill:#2196f3,stroke:#1565c0,color:#fff
    classDef outcome fill:#9c27b0,stroke:#6a1b9a,color:#fff
    
    class START start
    class AUTH,FEATURE_CHOICE decision
    class LOGIN,DASHBOARD,DISCOVER,WHALE,PORTFOLIO,STRATEGY process
    class INSIGHTS,EXECUTE,MONITOR outcome
```

## 4.2 Core Feature Workflows

### 4.2.1 Market Discovery & Intelligence Workflow

```mermaid
flowchart TD
    %% User Entry Points
    USER_SEARCH[User Searches Markets]
    USER_FILTER[User Applies Filters]
    AUTO_SYNC[Scheduled Sync Trigger]
    
    %% Cache Check
    CACHE_CHECK{Check React Query<br/>Cache}
    CACHE_VALID{Cache Valid?<br/>< 5 min stale}
    
    %% API Layer
    API_CALL[GET /api/polymarket/markets]
    VALIDATE_PARAMS[Validate Query Parameters<br/>Zod Schema]
    
    %% Database Operations
    DB_STALE_CHECK{Database Stale?<br/>Last sync > 5 min}
    TRIGGER_SYNC[Trigger Background Sync<br/>Non-blocking]
    DB_QUERY[Execute PostgreSQL Query<br/>With Indexes]
    
    %% Data Processing
    TRANSFORM_DATA[Transform & Format Data<br/>Currency, Dates, Metadata]
    JOIN_ANALYTICS[Join Market Analytics<br/>If Requested]
    
    %% Response & UI
    RETURN_RESPONSE[Return JSON Response<br/>With Metadata]
    UPDATE_UI[Update Market Screener<br/>TanStack Table]
    
    %% Error Handling
    ERROR_HANDLER[Error Handler]
    FALLBACK_DATA[Return Stale DB Data<br/>Graceful Degradation]
    
    %% Sync Process (Parallel)
    SYNC_START[Background Sync Process]
    FETCH_POLYMARKET[Fetch from Polymarket<br/>Gamma API]
    BATCH_UPSERT[Batch UPSERT to DB<br/>500 markets/batch]
    SYNC_COMPLETE[Sync Complete<br/>Update Timestamps]
    
    %% Flow Connections
    USER_SEARCH --> CACHE_CHECK
    USER_FILTER --> CACHE_CHECK
    AUTO_SYNC --> SYNC_START
    
    CACHE_CHECK --> CACHE_VALID
    CACHE_VALID -->|Yes| UPDATE_UI
    CACHE_VALID -->|No| API_CALL
    
    API_CALL --> VALIDATE_PARAMS
    VALIDATE_PARAMS --> DB_STALE_CHECK
    VALIDATE_PARAMS --> ERROR_HANDLER
    
    DB_STALE_CHECK -->|Yes| TRIGGER_SYNC
    DB_STALE_CHECK -->|No| DB_QUERY
    TRIGGER_SYNC --> DB_QUERY
    
    DB_QUERY --> TRANSFORM_DATA
    DB_QUERY --> ERROR_HANDLER
    
    TRANSFORM_DATA --> JOIN_ANALYTICS
    JOIN_ANALYTICS --> RETURN_RESPONSE
    RETURN_RESPONSE --> UPDATE_UI
    
    ERROR_HANDLER --> FALLBACK_DATA
    FALLBACK_DATA --> UPDATE_UI
    
    %% Parallel Sync Process
    SYNC_START --> FETCH_POLYMARKET
    FETCH_POLYMARKET --> BATCH_UPSERT
    BATCH_UPSERT --> SYNC_COMPLETE
    
    %% Styling
    classDef user fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef cache fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef api fill:#2196f3,stroke:#1565c0,color:#fff
    classDef database fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    classDef sync fill:#607d8b,stroke:#37474f,color:#fff
    
    class USER_SEARCH,USER_FILTER user
    class CACHE_CHECK,CACHE_VALID cache
    class API_CALL,VALIDATE_PARAMS,TRANSFORM_DATA,JOIN_ANALYTICS,RETURN_RESPONSE,UPDATE_UI api
    class DB_STALE_CHECK,TRIGGER_SYNC,DB_QUERY database
    class ERROR_HANDLER,FALLBACK_DATA error
    class AUTO_SYNC,SYNC_START,FETCH_POLYMARKET,BATCH_UPSERT,SYNC_COMPLETE sync
```

### 4.2.2 Whale Intelligence Tracking Workflow

```mermaid
flowchart TD
%% Data Collection
COLLECT_START["Whale Data Collection<br/>Trigger"]
FETCH_HOLDERS["Fetch Market Holders<br/>Polymarket Data API"]
FETCH_POSITIONS["Fetch Wallet Positions<br/>Per Market"]

%% Analysis Engine
POSITION_ANALYSIS["Position Size Analysis<br/>> $10K = Whale"]
CALCULATE_SCORES["Calculate Intelligence Scores"]

%% Scoring Components
WHALE_SCORE["Whale Score<br/>Position Size + Consistency"]
SMART_MONEY["Smart Money Score<br/>Win Rate + Sharpe Ratio"]
REPUTATION["Reputation Score<br/>Track Record + Longevity"]

%% Pattern Detection
DETECT_PATTERNS["Detect Trading Patterns"]
POSITION_CHANGES["Track Position Changes"]
INSIDER_SIGNALS["Identify Insider Activity"]
REVERSALS["Detect Position Reversals<br/>YES ↔ NO Flips"]

%% Database Operations
UPSERT_WALLETS["UPSERT Wallet Profiles<br/>With Scores"]
UPDATE_POSITIONS["Update Current Positions"]
LOG_TRADES["Log Trade History"]

%% Real-time Updates
STREAM_UPDATES["Stream Updates to UI<br/>WebSocket/SSE"]
UPDATE_LEADERBOARD["Update Whale Leaderboard<br/>Rankings"]

%% Alert System
GENERATE_ALERTS["Generate Whale Alerts"]
LARGE_POSITION["Large Position Alert<br/>> $50K"]
POSITION_FLIP["Position Reversal Alert"]
INSIDER_ALERT["Insider Activity Alert"]

%% Error Handling
API_ERROR{"API Error?"}
RETRY_LOGIC["Exponential Backoff<br/>Retry (Max 4 attempts)"]
LOG_ERROR["Log Error & Continue<br/>With Available Data"]

%% Flow Connections
COLLECT_START --> FETCH_HOLDERS
FETCH_HOLDERS --> FETCH_POSITIONS
FETCH_POSITIONS --> API_ERROR

API_ERROR -->|Yes| RETRY_LOGIC
API_ERROR -->|No| POSITION_ANALYSIS
RETRY_LOGIC --> FETCH_POSITIONS
RETRY_LOGIC --> LOG_ERROR

POSITION_ANALYSIS --> CALCULATE_SCORES
CALCULATE_SCORES --> WHALE_SCORE
CALCULATE_SCORES --> SMART_MONEY
CALCULATE_SCORES --> REPUTATION

WHALE_SCORE --> DETECT_PATTERNS
SMART_MONEY --> DETECT_PATTERNS
REPUTATION --> DETECT_PATTERNS

DETECT_PATTERNS --> POSITION_CHANGES
DETECT_PATTERNS --> INSIDER_SIGNALS
DETECT_PATTERNS --> REVERSALS

POSITION_CHANGES --> UPSERT_WALLETS
INSIDER_SIGNALS --> UPSERT_WALLETS
REVERSALS --> UPSERT_WALLETS

UPSERT_WALLETS --> UPDATE_POSITIONS
UPDATE_POSITIONS --> LOG_TRADES
LOG_TRADES --> STREAM_UPDATES

STREAM_UPDATES --> UPDATE_LEADERBOARD
UPDATE_LEADERBOARD --> GENERATE_ALERTS

GENERATE_ALERTS --> LARGE_POSITION
GENERATE_ALERTS --> POSITION_FLIP
GENERATE_ALERTS --> INSIDER_ALERT

LOG_ERROR --> STREAM_UPDATES

%% Styling
classDef collection fill:#4caf50,stroke:#2e7d32,color:#fff
classDef analysis fill:#2196f3,stroke:#1565c0,color:#fff
classDef scoring fill:#ff9800,stroke:#ef6c00,color:#fff
classDef database fill:#9c27b0,stroke:#6a1b9a,color:#fff
classDef alerts fill:#f44336,stroke:#c62828,color:#fff
classDef error fill:#795548,stroke:#5d4037,color:#fff

class COLLECT_START,FETCH_HOLDERS,FETCH_POSITIONS collection
class POSITION_ANALYSIS,CALCULATE_SCORES,DETECT_PATTERNS,POSITION_CHANGES,INSIDER_SIGNALS,REVERSALS analysis
class WHALE_SCORE,SMART_MONEY,REPUTATION scoring
class UPSERT_WALLETS,UPDATE_POSITIONS,LOG_TRADES,STREAM_UPDATES,UPDATE_LEADERBOARD database
class GENERATE_ALERTS,LARGE_POSITION,POSITION_FLIP,INSIDER_ALERT alerts
class API_ERROR,RETRY_LOGIC,LOG_ERROR error
```

### 4.2.3 Visual Workflow Automation Engine

```mermaid
flowchart TD
    %% User Workflow Creation
    USER_CREATE["User Creates/Edits<br/>Workflow"]
    CANVAS_EDIT["ReactFlow Canvas<br/>Drag & Drop Nodes"]
    NODE_CONFIG["Configure Node<br/>Parameters"]
    SAVE_WORKFLOW["Save Workflow<br/>to Database"]
    
    %% Workflow Execution Trigger
    EXECUTE_TRIGGER["User Clicks Run<br/>Execute Workflow"]
    VALIDATE_WORKFLOW["Validate Workflow<br/>Structure"]
    
    %% Validation Checks
    VALID_NODES{"Valid Node Types?"}
    VALID_EDGES{"Valid Connections?"}
    NO_CYCLES{"No Circular<br/>Dependencies?"}
    
    %% Execution Engine
    TOPO_SORT["Topological Sort<br/>Determine Execution Order"]
    START_EXECUTION["Start Streaming<br/>Execution (SSE)"]
    
    %% Node Execution Loop
    NEXT_NODE["Get Next Node<br/>in Execution Order"]
    NODE_STATUS["Stream Node Status<br/>running"]
    EXECUTE_NODE["Execute Node<br/>Based on Type"]
    
    %% Node Type Executors
    START_NODE["Start Node<br/>No-op Return {}"]
    STREAM_NODE["Polymarket Stream<br/>Fetch Markets"]
    FILTER_NODE["Filter Node<br/>Apply Conditions"]
    LLM_NODE["LLM Analysis<br/>Call AI Service"]
    HTTP_NODE["HTTP Request<br/>External API Call"]
    JS_NODE["JavaScript Node<br/>Custom Code Execution"]
    END_NODE["End Node<br/>Final Output"]
    
    %% Execution Results
    NODE_SUCCESS["Node Success<br/>Stream Output"]
    NODE_ERROR["Node Error<br/>Stream Error Details"]
    
    %% Completion
    MORE_NODES{"More Nodes<br/>to Execute?"}
    EXECUTION_COMPLETE["Execution Complete<br/>Stream Final Status"]
    LOG_EXECUTION["Log Execution<br/>to Database"]
    
    %% Error Handling
    VALIDATION_ERROR["Validation Error<br/>Return Error Response"]
    EXECUTION_ERROR["Execution Error<br/>Stop & Report"]
    TIMEOUT_ERROR["Timeout Error<br/>10 Second Limit"]
    
    %% AI Copilot (Parallel Process)
    AI_COPILOT["AI Copilot<br/>Conversational Builder"]
    PARSE_INTENT["Parse User Intent<br/>Natural Language"]
    GENERATE_NODES["Generate Workflow<br/>Nodes & Edges"]
    SUGGEST_OPTIMIZE["Suggest Optimizations<br/>& Improvements"]
    
    %% Flow Connections
    USER_CREATE --> CANVAS_EDIT
    CANVAS_EDIT --> NODE_CONFIG
    NODE_CONFIG --> SAVE_WORKFLOW
    
    SAVE_WORKFLOW --> EXECUTE_TRIGGER
    EXECUTE_TRIGGER --> VALIDATE_WORKFLOW
    
    VALIDATE_WORKFLOW --> VALID_NODES
    VALID_NODES -->|No| VALIDATION_ERROR
    VALID_NODES -->|Yes| VALID_EDGES
    VALID_EDGES -->|No| VALIDATION_ERROR
    VALID_EDGES -->|Yes| NO_CYCLES
    NO_CYCLES -->|No| VALIDATION_ERROR
    NO_CYCLES -->|Yes| TOPO_SORT
    
    TOPO_SORT --> START_EXECUTION
    START_EXECUTION --> NEXT_NODE
    
    NEXT_NODE --> NODE_STATUS
    NODE_STATUS --> EXECUTE_NODE
    
    EXECUTE_NODE --> START_NODE
    EXECUTE_NODE --> STREAM_NODE
    EXECUTE_NODE --> FILTER_NODE
    EXECUTE_NODE --> LLM_NODE
    EXECUTE_NODE --> HTTP_NODE
    EXECUTE_NODE --> JS_NODE
    EXECUTE_NODE --> END_NODE
    
    START_NODE --> NODE_SUCCESS
    STREAM_NODE --> NODE_SUCCESS
    STREAM_NODE --> NODE_ERROR
    FILTER_NODE --> NODE_SUCCESS
    LLM_NODE --> NODE_SUCCESS
    LLM_NODE --> NODE_ERROR
    HTTP_NODE --> NODE_SUCCESS
    HTTP_NODE --> NODE_ERROR
    JS_NODE --> NODE_SUCCESS
    JS_NODE --> NODE_ERROR
    END_NODE --> NODE_SUCCESS
    
    NODE_SUCCESS --> MORE_NODES
    NODE_ERROR --> EXECUTION_ERROR
    
    MORE_NODES -->|Yes| NEXT_NODE
    MORE_NODES -->|No| EXECUTION_COMPLETE
    
    EXECUTION_COMPLETE --> LOG_EXECUTION
    
    %% AI Copilot Flow
    USER_CREATE --> AI_COPILOT
    AI_COPILOT --> PARSE_INTENT
    PARSE_INTENT --> GENERATE_NODES
    GENERATE_NODES --> SUGGEST_OPTIMIZE
    SUGGEST_OPTIMIZE --> CANVAS_EDIT
    
    %% Error Flows
    EXECUTE_NODE --> TIMEOUT_ERROR
    TIMEOUT_ERROR --> EXECUTION_ERROR
    
    %% Styling
    classDef user fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef validation fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef execution fill:#2196f3,stroke:#1565c0,color:#fff
    classDef nodes fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef ai fill:#00bcd4,stroke:#0097a7,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    
    class USER_CREATE,CANVAS_EDIT,NODE_CONFIG,SAVE_WORKFLOW,EXECUTE_TRIGGER user
    class VALIDATE_WORKFLOW,VALID_NODES,VALID_EDGES,NO_CYCLES validation
    class TOPO_SORT,START_EXECUTION,NEXT_NODE,NODE_STATUS,EXECUTE_NODE,NODE_SUCCESS,MORE_NODES,EXECUTION_COMPLETE,LOG_EXECUTION execution
    class START_NODE,STREAM_NODE,FILTER_NODE,LLM_NODE,HTTP_NODE,JS_NODE,END_NODE nodes
    class AI_COPILOT,PARSE_INTENT,GENERATE_NODES,SUGGEST_OPTIMIZE ai
    class VALIDATION_ERROR,NODE_ERROR,EXECUTION_ERROR,TIMEOUT_ERROR error
```

### 4.2.4 Portfolio Analytics & Wallet Tracking Workflow

```mermaid
flowchart TD
    %% User Input
    USER_INPUT[User Enters<br/>Wallet Address]
    VALIDATE_ADDRESS[Validate Ethereum<br/>Address Format]
    
    %% Cache Strategy
    CHECK_CACHE{Check Wallet<br/>Cache}
    CACHE_FRESH{Cache Fresh?<br/>< 30 seconds}
    
    %% Data Fetching
    FETCH_POSITIONS[Fetch Current Positions<br/>Polymarket Data API]
    FETCH_CLOSED[Fetch Closed Positions<br/>Historical Data]
    FETCH_TRADES[Fetch Trade History<br/>All Transactions]
    FETCH_VALUE[Calculate Portfolio Value<br/>Total USDC]
    
    %% Data Processing
    PROCESS_POSITIONS[Process Position Data<br/>Calculate Unrealized P&L]
    PROCESS_CLOSED[Process Closed Positions<br/>Calculate Realized P&L]
    PROCESS_TRADES[Process Trade History<br/>Entry/Exit Analysis]
    
    %% Analytics Calculations
    CALC_METRICS[Calculate Performance Metrics]
    WIN_RATE[Win Rate Calculation<br/>Winners / Total Trades]
    SHARPE_RATIO[Sharpe Ratio<br/>Risk-Adjusted Returns]
    ROI_CALC[ROI Calculation<br/>Total Return %]
    DRAWDOWN[Max Drawdown<br/>Peak-to-Trough]
    
    %% Risk Analysis
    RISK_ANALYSIS[Risk Analysis]
    CONCENTRATION[Position Concentration<br/>By Market/Category]
    EXPOSURE[Category Exposure<br/>Risk Distribution]
    
    %% Activity Timeline
    BUILD_TIMELINE[Build Activity Timeline<br/>Chronological Events]
    TRADE_EVENTS[Trade Events<br/>Buy/Sell Actions]
    POSITION_CHANGES[Position Changes<br/>Size Adjustments]
    
    %% Data Aggregation
    AGGREGATE_DATA[Aggregate All Data<br/>Comprehensive Profile]
    
    %% Response & Caching
    CACHE_RESULT[Cache Result<br/>30 Second TTL]
    RETURN_RESPONSE[Return JSON Response<br/>Complete Analytics]
    UPDATE_UI[Update Portfolio UI<br/>Charts & Tables]
    
    %% Error Handling
    ADDRESS_ERROR{Valid Address?}
    API_ERROR{API Error?}
    RETRY_FETCH[Retry with<br/>Exponential Backoff]
    PARTIAL_DATA[Return Partial Data<br/>With Error Flags]
    
    %% Real-time Updates
    SUBSCRIBE_UPDATES[Subscribe to<br/>Real-time Updates]
    POSITION_CHANGE[Position Change<br/>Detected]
    UPDATE_CACHE[Update Cache<br/>Invalidate Stale Data]
    
    %% Flow Connections
    USER_INPUT --> VALIDATE_ADDRESS
    VALIDATE_ADDRESS --> ADDRESS_ERROR
    ADDRESS_ERROR -->|No| RETURN_RESPONSE
    ADDRESS_ERROR -->|Yes| CHECK_CACHE
    
    CHECK_CACHE --> CACHE_FRESH
    CACHE_FRESH -->|Yes| UPDATE_UI
    CACHE_FRESH -->|No| FETCH_POSITIONS
    
    FETCH_POSITIONS --> API_ERROR
    API_ERROR -->|Yes| RETRY_FETCH
    API_ERROR -->|No| FETCH_CLOSED
    RETRY_FETCH --> FETCH_POSITIONS
    RETRY_FETCH --> PARTIAL_DATA
    
    FETCH_CLOSED --> FETCH_TRADES
    FETCH_TRADES --> FETCH_VALUE
    FETCH_VALUE --> PROCESS_POSITIONS
    
    PROCESS_POSITIONS --> PROCESS_CLOSED
    PROCESS_CLOSED --> PROCESS_TRADES
    PROCESS_TRADES --> CALC_METRICS
    
    CALC_METRICS --> WIN_RATE
    CALC_METRICS --> SHARPE_RATIO
    CALC_METRICS --> ROI_CALC
    CALC_METRICS --> DRAWDOWN
    
    WIN_RATE --> RISK_ANALYSIS
    SHARPE_RATIO --> RISK_ANALYSIS
    ROI_CALC --> RISK_ANALYSIS
    DRAWDOWN --> RISK_ANALYSIS
    
    RISK_ANALYSIS --> CONCENTRATION
    RISK_ANALYSIS --> EXPOSURE
    
    CONCENTRATION --> BUILD_TIMELINE
    EXPOSURE --> BUILD_TIMELINE
    
    BUILD_TIMELINE --> TRADE_EVENTS
    BUILD_TIMELINE --> POSITION_CHANGES
    
    TRADE_EVENTS --> AGGREGATE_DATA
    POSITION_CHANGES --> AGGREGATE_DATA
    
    AGGREGATE_DATA --> CACHE_RESULT
    CACHE_RESULT --> RETURN_RESPONSE
    RETURN_RESPONSE --> UPDATE_UI
    
    PARTIAL_DATA --> UPDATE_UI
    
    %% Real-time Flow
    UPDATE_UI --> SUBSCRIBE_UPDATES
    SUBSCRIBE_UPDATES --> POSITION_CHANGE
    POSITION_CHANGE --> UPDATE_CACHE
    UPDATE_CACHE --> CHECK_CACHE
    
    %% Styling
    classDef input fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef cache fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef fetch fill:#2196f3,stroke:#1565c0,color:#fff
    classDef analytics fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    classDef realtime fill:#00bcd4,stroke:#0097a7,color:#fff
    
    class USER_INPUT,VALIDATE_ADDRESS input
    class CHECK_CACHE,CACHE_FRESH,CACHE_RESULT cache
    class FETCH_POSITIONS,FETCH_CLOSED,FETCH_TRADES,FETCH_VALUE,PROCESS_POSITIONS,PROCESS_CLOSED,PROCESS_TRADES fetch
    class CALC_METRICS,WIN_RATE,SHARPE_RATIO,ROI_CALC,DRAWDOWN,RISK_ANALYSIS,CONCENTRATION,EXPOSURE,BUILD_TIMELINE,TRADE_EVENTS,POSITION_CHANGES,AGGREGATE_DATA analytics
    class ADDRESS_ERROR,API_ERROR,RETRY_FETCH,PARTIAL_DATA error
    class SUBSCRIBE_UPDATES,POSITION_CHANGE,UPDATE_CACHE,RETURN_RESPONSE,UPDATE_UI realtime
```

## 4.3 Integration Workflows

### 4.3.1 Polymarket API Integration Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant UI as React Frontend
    participant API as Next.js API Routes
    participant Cache as React Query Cache
    participant DB as Supabase DB
    participant PM as Polymarket APIs
    participant AI as AI Services

    Note over U,AI: Market Discovery Flow
    
    U->>UI: Search/Filter Markets
    UI->>Cache: Check cached data
    
    alt Cache Hit (< 5 min stale)
        Cache-->>UI: Return cached markets
        UI-->>U: Display results
    else Cache Miss/Stale
        UI->>API: GET /api/polymarket/markets
        API->>DB: Check data staleness
        
        alt DB Stale (> 5 min)
            API->>PM: Fetch fresh data (background)
            PM-->>API: Market data
            API->>DB: Batch UPSERT
        end
        
        API->>DB: Query with filters
        DB-->>API: Market results
        API-->>UI: JSON response
        UI->>Cache: Update cache
        UI-->>U: Display results
    end

    Note over U,AI: Workflow Execution Flow
    
    U->>UI: Execute workflow
    UI->>API: POST /api/execute-workflow (SSE)
    API->>API: Validate & sort nodes
    
    loop For each node
        API->>UI: Stream node status "running"
        
        alt Polymarket Node
            API->>PM: Fetch market data
            PM-->>API: Market response
        else LLM Node
            API->>AI: Analyze with prompt
            AI-->>API: Analysis result
        else HTTP Node
            API->>PM: External API call
            PM-->>API: API response
        end
        
        API->>UI: Stream node output
    end
    
    API->>DB: Log execution
    API->>UI: Stream "complete"
    UI-->>U: Show final results

    Note over U,AI: Error Handling
    
    alt API Error
        PM-->>API: Error response
        API->>API: Retry with backoff
        
        alt Max Retries Exceeded
            API->>DB: Fallback to stale data
            DB-->>API: Cached results
            API-->>UI: Partial data + warning
        end
    end
```

### 4.3.2 Data Synchronization Workflow

```mermaid
flowchart TD
    %% Trigger Sources
    CRON_TRIGGER["Vercel Cron Job<br/>Every 5 Minutes"]
    MANUAL_TRIGGER["Manual Sync Trigger<br/>Admin/User Request"]
    STALE_DETECTION["Stale Data Detection<br/>During API Request"]
    
    %% Sync Orchestrator
    SYNC_START["Sync Process Start<br/>Acquire Mutex Lock"]
    CHECK_LOCK{"Sync Already<br/>Running?"}
    
    %% Data Collection Phase
    COLLECT_EVENTS["Collect Events<br/>Polymarket Gamma API"]
    PAGINATE_EVENTS["Paginate Through<br/>Event Pages 100/page"]
    EXTRACT_MARKETS["Extract Nested<br/>Markets from Events"]
    
    %% Data Transformation Phase
    TRANSFORM_START["Data Transformation<br/>Phase"]
    PARSE_JSON["Parse JSON Strings<br/>Outcomes, Prices"]
    CONVERT_TYPES["Convert Data Types<br/>String → Number"]
    VALIDATE_DATA["Validate Constraints<br/>Dates, Volumes"]
    EXTRACT_CATEGORIES["Extract Categories<br/>From Tags"]
    DEDUPLICATE["Deduplicate Markets<br/>By market_id"]
    
    %% Database Operations Phase
    BATCH_PREPARE["Prepare Batch Operations<br/>500 Markets/Batch"]
    BATCH_UPSERT["Execute Batch UPSERT<br/>ON CONFLICT UPDATE"]
    UPDATE_ANALYTICS["Update Market Analytics<br/>Derived Metrics"]
    
    %% Completion Phase
    UPDATE_TIMESTAMPS["Update Sync<br/>Timestamps"]
    RELEASE_LOCK["Release Mutex Lock"]
    LOG_SUCCESS["Log Sync Success<br/>Metrics & Duration"]
    
    %% Error Handling
    API_TIMEOUT{"API Timeout?"}
    RETRY_LOGIC["Exponential Backoff<br/>Retry Max 3 attempts"]
    PARTIAL_SUCCESS["Partial Success<br/>Log Errors & Continue"]
    SYNC_FAILURE["Sync Failure<br/>Log Error & Release Lock"]
    
    %% Monitoring & Alerts
    MONITOR_METRICS["Monitor Sync Metrics<br/>Duration, Success Rate"]
    ALERT_THRESHOLD{"Duration > 30s<br/>or Failure Rate > 5%?"}
    SEND_ALERT["Send Alert<br/>Slack/Email Notification"]
    
    %% Cache Invalidation
    INVALIDATE_CACHE["Invalidate React Query<br/>Cache Keys"]
    NOTIFY_CLIENTS["Notify Connected Clients<br/>WebSocket/SSE"]
    
    %% Flow Connections
    CRON_TRIGGER --> SYNC_START
    MANUAL_TRIGGER --> SYNC_START
    STALE_DETECTION --> SYNC_START
    
    SYNC_START --> CHECK_LOCK
    CHECK_LOCK -->|Yes| SYNC_FAILURE
    CHECK_LOCK -->|No| COLLECT_EVENTS
    
    COLLECT_EVENTS --> API_TIMEOUT
    API_TIMEOUT -->|Yes| RETRY_LOGIC
    API_TIMEOUT -->|No| PAGINATE_EVENTS
    RETRY_LOGIC --> COLLECT_EVENTS
    RETRY_LOGIC --> PARTIAL_SUCCESS
    
    PAGINATE_EVENTS --> EXTRACT_MARKETS
    EXTRACT_MARKETS --> TRANSFORM_START
    
    TRANSFORM_START --> PARSE_JSON
    PARSE_JSON --> CONVERT_TYPES
    CONVERT_TYPES --> VALIDATE_DATA
    VALIDATE_DATA --> EXTRACT_CATEGORIES
    EXTRACT_CATEGORIES --> DEDUPLICATE
    
    DEDUPLICATE --> BATCH_PREPARE
    BATCH_PREPARE --> BATCH_UPSERT
    BATCH_UPSERT --> UPDATE_ANALYTICS
    
    UPDATE_ANALYTICS --> UPDATE_TIMESTAMPS
    UPDATE_TIMESTAMPS --> RELEASE_LOCK
    RELEASE_LOCK --> LOG_SUCCESS
    
    LOG_SUCCESS --> MONITOR_METRICS
    MONITOR_METRICS --> ALERT_THRESHOLD
    ALERT_THRESHOLD -->|Yes| SEND_ALERT
    ALERT_THRESHOLD -->|No| INVALIDATE_CACHE
    SEND_ALERT --> INVALIDATE_CACHE
    
    INVALIDATE_CACHE --> NOTIFY_CLIENTS
    
    PARTIAL_SUCCESS --> UPDATE_TIMESTAMPS
    SYNC_FAILURE --> MONITOR_METRICS
    
    %% Styling
    classDef trigger fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef sync fill:#2196f3,stroke:#1565c0,color:#fff
    classDef transform fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef database fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    classDef monitor fill:#607d8b,stroke:#37474f,color:#fff
    
    class CRON_TRIGGER,MANUAL_TRIGGER,STALE_DETECTION trigger
    class SYNC_START,CHECK_LOCK,COLLECT_EVENTS,PAGINATE_EVENTS,EXTRACT_MARKETS sync
    class TRANSFORM_START,PARSE_JSON,CONVERT_TYPES,VALIDATE_DATA,EXTRACT_CATEGORIES,DEDUPLICATE transform
    class BATCH_PREPARE,BATCH_UPSERT,UPDATE_ANALYTICS,UPDATE_TIMESTAMPS,RELEASE_LOCK,LOG_SUCCESS database
    class API_TIMEOUT,RETRY_LOGIC,PARTIAL_SUCCESS,SYNC_FAILURE error
    class MONITOR_METRICS,ALERT_THRESHOLD,SEND_ALERT,INVALIDATE_CACHE,NOTIFY_CLIENTS monitor
```

### 4.3.3 AI Service Integration Workflow

```mermaid
flowchart TD
    %% AI Service Entry Points
    LLM_REQUEST["LLM Analysis Request<br/>From Workflow Node"]
    COPILOT_REQUEST["AI Copilot Request<br/>Conversational Builder"]
    SENTIMENT_REQUEST["Sentiment Analysis<br/>Market Intelligence"]
    
    %% Service Selection
    SELECT_SERVICE{"Select AI Service"}
    OPENAI_SERVICE["OpenAI GPT-4<br/>Market Analysis"]
    CLAUDE_SERVICE["Anthropic Claude<br/>Strategy Building"]
    GEMINI_SERVICE["Google Gemini<br/>Multimodal Analysis"]
    
    %% Request Preparation
    PREPARE_REQUEST["Prepare API Request<br/>Format Prompt & Context"]
    ADD_CONTEXT["Add Market Context<br/>Price Data, Volume, etc."]
    VALIDATE_INPUT["Validate Input Length<br/>Token Limits"]
    
    %% Rate Limiting & Queue
    CHECK_RATE_LIMIT{"Rate Limit<br/>Exceeded?"}
    QUEUE_REQUEST["Queue Request<br/>With Backoff"]
    
    %% API Execution
    EXECUTE_REQUEST["Execute API Request<br/>With Timeout"]
    STREAM_RESPONSE["Stream Response<br/>If Supported"]
    
    %% Response Processing
    PARSE_RESPONSE["Parse AI Response<br/>Extract Structured Data"]
    VALIDATE_OUTPUT["Validate Output<br/>Schema Compliance"]
    TRANSFORM_RESULT["Transform Result<br/>For Application Use"]
    
    %% Caching Strategy
    CACHE_RESPONSE["Cache Response<br/>1 Hour TTL"]
    CHECK_CACHE{"Check Response<br/>Cache First"}
    
    %% Error Handling
    API_ERROR{"API Error?"}
    RETRY_DIFFERENT["Retry with Different<br/>Service (Fallback)"]
    LOG_ERROR["Log Error Details<br/>For Monitoring"]
    RETURN_ERROR["Return Error Response<br/>With Context"]
    
    %% Cost Monitoring
    TRACK_USAGE["Track Token Usage<br/>& API Costs"]
    COST_ALERT{"Cost Threshold<br/>Exceeded?"}
    SEND_COST_ALERT["Send Cost Alert<br/>To Admin"]
    
    %% Response Delivery
    RETURN_SUCCESS["Return Successful<br/>Response"]
    STREAM_TO_CLIENT["Stream to Client<br/>Real-time Updates"]
    
    %% Quality Assurance
    QUALITY_CHECK["Quality Check<br/>Response Relevance"]
    FEEDBACK_LOOP["Collect User Feedback<br/>For Improvement"]
    
    %% Flow Connections
    LLM_REQUEST --> CHECK_CACHE
    COPILOT_REQUEST --> CHECK_CACHE
    SENTIMENT_REQUEST --> CHECK_CACHE
    
    CHECK_CACHE -->|Hit| RETURN_SUCCESS
    CHECK_CACHE -->|Miss| SELECT_SERVICE
    
    SELECT_SERVICE --> OPENAI_SERVICE
    SELECT_SERVICE --> CLAUDE_SERVICE
    SELECT_SERVICE --> GEMINI_SERVICE
    
    OPENAI_SERVICE --> PREPARE_REQUEST
    CLAUDE_SERVICE --> PREPARE_REQUEST
    GEMINI_SERVICE --> PREPARE_REQUEST
    
    PREPARE_REQUEST --> ADD_CONTEXT
    ADD_CONTEXT --> VALIDATE_INPUT
    VALIDATE_INPUT --> CHECK_RATE_LIMIT
    
    CHECK_RATE_LIMIT -->|Yes| QUEUE_REQUEST
    CHECK_RATE_LIMIT -->|No| EXECUTE_REQUEST
    QUEUE_REQUEST --> EXECUTE_REQUEST
    
    EXECUTE_REQUEST --> API_ERROR
    API_ERROR -->|Yes| RETRY_DIFFERENT
    API_ERROR -->|No| STREAM_RESPONSE
    
    RETRY_DIFFERENT --> SELECT_SERVICE
    RETRY_DIFFERENT --> LOG_ERROR
    LOG_ERROR --> RETURN_ERROR
    
    STREAM_RESPONSE --> PARSE_RESPONSE
    PARSE_RESPONSE --> VALIDATE_OUTPUT
    VALIDATE_OUTPUT --> TRANSFORM_RESULT
    
    TRANSFORM_RESULT --> CACHE_RESPONSE
    CACHE_RESPONSE --> TRACK_USAGE
    
    TRACK_USAGE --> COST_ALERT
    COST_ALERT -->|Yes| SEND_COST_ALERT
    COST_ALERT -->|No| RETURN_SUCCESS
    SEND_COST_ALERT --> RETURN_SUCCESS
    
    RETURN_SUCCESS --> STREAM_TO_CLIENT
    STREAM_TO_CLIENT --> QUALITY_CHECK
    QUALITY_CHECK --> FEEDBACK_LOOP
    
    %% Styling
    classDef request fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef service fill:#2196f3,stroke:#1565c0,color:#fff
    classDef processing fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef cache fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    classDef monitor fill:#607d8b,stroke:#37474f,color:#fff
    
    class LLM_REQUEST,COPILOT_REQUEST,SENTIMENT_REQUEST request
    class SELECT_SERVICE,OPENAI_SERVICE,CLAUDE_SERVICE,GEMINI_SERVICE,EXECUTE_REQUEST,STREAM_RESPONSE service
    class PREPARE_REQUEST,ADD_CONTEXT,VALIDATE_INPUT,PARSE_RESPONSE,VALIDATE_OUTPUT,TRANSFORM_RESULT processing
    class CHECK_CACHE,CACHE_RESPONSE cache
    class API_ERROR,RETRY_DIFFERENT,LOG_ERROR,RETURN_ERROR error
    class CHECK_RATE_LIMIT,QUEUE_REQUEST,TRACK_USAGE,COST_ALERT,SEND_COST_ALERT,QUALITY_CHECK,FEEDBACK_LOOP monitor
```

## 4.4 Error Handling & Recovery Workflows

### 4.4.1 Comprehensive Error Handling Flow

```mermaid
flowchart TD
    %% Error Detection Points
    API_ERROR[API Request Error<br/>External Service Failure]
    DB_ERROR[Database Error<br/>Connection/Query Failure]
    VALIDATION_ERROR[Validation Error<br/>Invalid Input Data]
    TIMEOUT_ERROR[Timeout Error<br/>Request Duration Exceeded]
    AUTH_ERROR[Authentication Error<br/>Invalid/Expired Token]
    RATE_LIMIT_ERROR[Rate Limit Error<br/>Too Many Requests]
    
    %% Error Classification
    CLASSIFY_ERROR{Classify Error Type}
    
    %% Retry Strategies
    RETRYABLE{Retryable Error?}
    EXPONENTIAL_BACKOFF[Exponential Backoff<br/>Retry Strategy]
    CIRCUIT_BREAKER[Circuit Breaker<br/>Pattern]
    
    %% Fallback Mechanisms
    FALLBACK_STRATEGY{Fallback Available?}
    STALE_DATA[Return Stale Data<br/>From Cache/DB]
    ALTERNATIVE_SERVICE[Use Alternative<br/>Service/Endpoint]
    DEGRADED_MODE[Degraded Mode<br/>Limited Functionality]
    
    %% Error Logging & Monitoring
    LOG_ERROR[Log Error Details<br/>Structured Logging]
    TRACK_METRICS[Track Error Metrics<br/>Rate, Type, Impact]
    ALERT_THRESHOLD{Alert Threshold<br/>Exceeded?}
    SEND_ALERT[Send Alert<br/>Slack/Email/PagerDuty]
    
    %% User Experience
    USER_NOTIFICATION[User Notification<br/>Friendly Error Message]
    PARTIAL_SUCCESS[Partial Success<br/>Show Available Data]
    RETRY_SUGGESTION[Suggest User Retry<br/>With Guidance]
    
    %% Recovery Actions
    AUTO_RECOVERY[Automatic Recovery<br/>Self-Healing]
    MANUAL_INTERVENTION[Manual Intervention<br/>Required]
    ESCALATION[Escalate to<br/>Engineering Team]
    
    %% Error Response
    ERROR_RESPONSE[Structured Error<br/>Response]
    HTTP_STATUS[Appropriate HTTP<br/>Status Code]
    ERROR_CONTEXT[Error Context<br/>& Debugging Info]
    
    %% Flow Connections
    API_ERROR --> CLASSIFY_ERROR
    DB_ERROR --> CLASSIFY_ERROR
    VALIDATION_ERROR --> CLASSIFY_ERROR
    TIMEOUT_ERROR --> CLASSIFY_ERROR
    AUTH_ERROR --> CLASSIFY_ERROR
    RATE_LIMIT_ERROR --> CLASSIFY_ERROR
    
    CLASSIFY_ERROR --> RETRYABLE
    
    RETRYABLE -->|Yes| EXPONENTIAL_BACKOFF
    RETRYABLE -->|No| FALLBACK_STRATEGY
    
    EXPONENTIAL_BACKOFF --> CIRCUIT_BREAKER
    CIRCUIT_BREAKER --> FALLBACK_STRATEGY
    
    FALLBACK_STRATEGY -->|Yes| STALE_DATA
    FALLBACK_STRATEGY -->|Yes| ALTERNATIVE_SERVICE
    FALLBACK_STRATEGY -->|Yes| DEGRADED_MODE
    FALLBACK_STRATEGY -->|No| LOG_ERROR
    
    STALE_DATA --> PARTIAL_SUCCESS
    ALTERNATIVE_SERVICE --> AUTO_RECOVERY
    DEGRADED_MODE --> USER_NOTIFICATION
    
    LOG_ERROR --> TRACK_METRICS
    TRACK_METRICS --> ALERT_THRESHOLD
    
    ALERT_THRESHOLD -->|Yes| SEND_ALERT
    ALERT_THRESHOLD -->|No| ERROR_RESPONSE
    
    SEND_ALERT --> MANUAL_INTERVENTION
    MANUAL_INTERVENTION --> ESCALATION
    
    PARTIAL_SUCCESS --> USER_NOTIFICATION
    AUTO_RECOVERY --> USER_NOTIFICATION
    USER_NOTIFICATION --> RETRY_SUGGESTION
    
    RETRY_SUGGESTION --> ERROR_RESPONSE
    ERROR_RESPONSE --> HTTP_STATUS
    HTTP_STATUS --> ERROR_CONTEXT
    
    ESCALATION --> ERROR_RESPONSE
    
    %% Styling
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    classDef retry fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef fallback fill:#2196f3,stroke:#1565c0,color:#fff
    classDef monitor fill:#607d8b,stroke:#37474f,color:#fff
    classDef user fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef recovery fill:#9c27b0,stroke:#6a1b9a,color:#fff
    
    class API_ERROR,DB_ERROR,VALIDATION_ERROR,TIMEOUT_ERROR,AUTH_ERROR,RATE_LIMIT_ERROR,CLASSIFY_ERROR error
    class RETRYABLE,EXPONENTIAL_BACKOFF,CIRCUIT_BREAKER retry
    class FALLBACK_STRATEGY,STALE_DATA,ALTERNATIVE_SERVICE,DEGRADED_MODE fallback
    class LOG_ERROR,TRACK_METRICS,ALERT_THRESHOLD,SEND_ALERT monitor
    class USER_NOTIFICATION,PARTIAL_SUCCESS,RETRY_SUGGESTION,ERROR_RESPONSE,HTTP_STATUS,ERROR_CONTEXT user
    class AUTO_RECOVERY,MANUAL_INTERVENTION,ESCALATION recovery
```

### 4.4.2 Circuit Breaker Pattern Implementation

```mermaid
stateDiagram-v2
    [*] --> Closed
    
    Closed --> Open : Failure threshold exceeded<br/>(5 failures in 1 minute)
    Open --> HalfOpen : Timeout period elapsed<br/>(30 seconds)
    HalfOpen --> Closed : Success threshold met<br/>(3 consecutive successes)
    HalfOpen --> Open : Any failure detected
    
    state Closed {
        [*] --> MonitorRequests
        MonitorRequests --> ExecuteRequest : Request received
        ExecuteRequest --> RecordSuccess : Success
        ExecuteRequest --> RecordFailure : Failure
        RecordSuccess --> MonitorRequests
        RecordFailure --> CheckThreshold
        CheckThreshold --> MonitorRequests : Below threshold
        CheckThreshold --> [*] : Threshold exceeded
    }
    
    state Open {
        [*] --> RejectRequests
        RejectRequests --> ReturnFallback : Request received
        ReturnFallback --> StartTimer
        StartTimer --> RejectRequests
        StartTimer --> [*] : Timeout reached
    }
    
    state HalfOpen {
        [*] --> AllowLimitedRequests
        AllowLimitedRequests --> ExecuteTestRequest : Request received
        ExecuteTestRequest --> CountSuccess : Success
        ExecuteTestRequest --> [*] : Failure
        CountSuccess --> AllowLimitedRequests : < 3 successes
        CountSuccess --> [*] : 3 successes reached
    }
    
    note right of Closed
        Normal operation
        All requests allowed
        Monitor failure rate
    end note
    
    note right of Open
        Service unavailable
        Fail fast with fallback
        Prevent cascade failures
    end note
    
    note right of HalfOpen
        Testing recovery
        Limited requests allowed
        Quick failure detection
    end note
```

## 4.5 State Management Workflows

### 4.5.1 React Query State Management Flow

```mermaid
flowchart TD
    %% User Actions
    USER_ACTION[User Action<br/>Search, Filter, Navigate]
    
    %% Query Key Generation
    GENERATE_KEY[Generate Query Key<br/>Based on Parameters]
    
    %% Cache Lookup
    CACHE_LOOKUP[Cache Lookup<br/>Check Existing Data]
    CACHE_STATUS{Cache Status}
    
    %% Cache States
    FRESH_DATA[Fresh Data<br/>< Stale Time]
    STALE_DATA[Stale Data<br/>> Stale Time]
    NO_DATA[No Cached Data<br/>First Request]
    
    %% Background Refetch
    BACKGROUND_REFETCH[Background Refetch<br/>Update Stale Data]
    
    %% Network Request
    NETWORK_REQUEST[Network Request<br/>Fetch Fresh Data]
    
    %% Request States
    LOADING_STATE[Loading State<br/>Show Spinner/Skeleton]
    SUCCESS_STATE[Success State<br/>Update Cache & UI]
    ERROR_STATE[Error State<br/>Show Error Message]
    
    %% Cache Updates
    UPDATE_CACHE[Update Cache<br/>Store New Data]
    INVALIDATE_CACHE[Invalidate Related<br/>Cache Keys]
    
    %% Optimistic Updates
    OPTIMISTIC_UPDATE[Optimistic Update<br/>Immediate UI Change]
    ROLLBACK_UPDATE[Rollback Update<br/>On Error]
    
    %% Garbage Collection
    GARBAGE_COLLECT[Garbage Collection<br/>Remove Unused Data]
    
    %% UI Updates
    UPDATE_UI[Update UI Components<br/>Re-render with New Data]
    
    %% Flow Connections
    USER_ACTION --> GENERATE_KEY
    GENERATE_KEY --> CACHE_LOOKUP
    CACHE_LOOKUP --> CACHE_STATUS
    
    CACHE_STATUS --> FRESH_DATA
    CACHE_STATUS --> STALE_DATA
    CACHE_STATUS --> NO_DATA
    
    FRESH_DATA --> UPDATE_UI
    
    STALE_DATA --> UPDATE_UI
    STALE_DATA --> BACKGROUND_REFETCH
    
    NO_DATA --> LOADING_STATE
    LOADING_STATE --> NETWORK_REQUEST
    
    BACKGROUND_REFETCH --> NETWORK_REQUEST
    
    NETWORK_REQUEST --> SUCCESS_STATE
    NETWORK_REQUEST --> ERROR_STATE
    
    SUCCESS_STATE --> UPDATE_CACHE
    UPDATE_CACHE --> INVALIDATE_CACHE
    INVALIDATE_CACHE --> UPDATE_UI
    
    ERROR_STATE --> UPDATE_UI
    
    %% Optimistic Flow
    USER_ACTION --> OPTIMISTIC_UPDATE
    OPTIMISTIC_UPDATE --> UPDATE_UI
    ERROR_STATE --> ROLLBACK_UPDATE
    ROLLBACK_UPDATE --> UPDATE_UI
    
    %% Cleanup
    UPDATE_CACHE --> GARBAGE_COLLECT
    
    %% Styling
    classDef user fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef cache fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef network fill:#2196f3,stroke:#1565c0,color:#fff
    classDef state fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef ui fill:#00bcd4,stroke:#0097a7,color:#fff
    
    class USER_ACTION user
    class GENERATE_KEY,CACHE_LOOKUP,CACHE_STATUS,FRESH_DATA,STALE_DATA,NO_DATA,UPDATE_CACHE,INVALIDATE_CACHE,GARBAGE_COLLECT cache
    class BACKGROUND_REFETCH,NETWORK_REQUEST network
    class LOADING_STATE,SUCCESS_STATE,ERROR_STATE,OPTIMISTIC_UPDATE,ROLLBACK_UPDATE state
    class UPDATE_UI ui
```

### 4.5.2 Workflow Session State Management

```mermaid
flowchart TD
    %% Session Lifecycle
    CREATE_SESSION[Create New Session<br/>Generate UUID]
    LOAD_SESSION[Load Existing Session<br/>From Database]
    
    %% State Initialization
    INIT_STATE[Initialize State<br/>Nodes, Edges, Variables]
    VALIDATE_STATE[Validate State<br/>Schema Compliance]
    
    %% State Mutations
    ADD_NODE[Add Node<br/>Update Nodes Array]
    REMOVE_NODE[Remove Node<br/>Clean Edges]
    UPDATE_NODE[Update Node<br/>Configuration Changes]
    ADD_EDGE[Add Edge<br/>Connect Nodes]
    REMOVE_EDGE[Remove Edge<br/>Disconnect Nodes]
    
    %% State Validation
    VALIDATE_GRAPH{Valid Graph?<br/>No Cycles, Connected}
    VALIDATION_ERROR[Validation Error<br/>Show User Feedback]
    
    %% Persistence Strategy
    AUTO_SAVE{Auto-save Enabled?}
    DEBOUNCED_SAVE[Debounced Save<br/>500ms Delay]
    MANUAL_SAVE[Manual Save<br/>User Triggered]
    
    %% Database Operations
    UPSERT_SESSION[UPSERT Session<br/>To Database]
    VERSION_CONTROL[Version Control<br/>Increment Version]
    
    %% Execution State
    EXECUTION_START[Execution Started<br/>Mark as Running]
    EXECUTION_PROGRESS[Track Progress<br/>Node Status Updates]
    EXECUTION_COMPLETE[Execution Complete<br/>Store Results]
    
    %% State Synchronization
    SYNC_STATE[Sync State<br/>Across Components]
    BROADCAST_CHANGES[Broadcast Changes<br/>To Subscribers]
    
    %% Cleanup & Recovery
    CLEANUP_STATE[Cleanup State<br/>Remove Temp Data]
    RECOVER_STATE[Recover State<br/>From Last Save]
    
    %% Error Handling
    STATE_ERROR{State Error?}
    ROLLBACK_STATE[Rollback State<br/>To Previous Version]
    
    %% Flow Connections
    CREATE_SESSION --> INIT_STATE
    LOAD_SESSION --> INIT_STATE
    
    INIT_STATE --> VALIDATE_STATE
    VALIDATE_STATE --> SYNC_STATE
    
    ADD_NODE --> VALIDATE_GRAPH
    REMOVE_NODE --> VALIDATE_GRAPH
    UPDATE_NODE --> VALIDATE_GRAPH
    ADD_EDGE --> VALIDATE_GRAPH
    REMOVE_EDGE --> VALIDATE_GRAPH
    
    VALIDATE_GRAPH -->|Valid| AUTO_SAVE
    VALIDATE_GRAPH -->|Invalid| VALIDATION_ERROR
    
    AUTO_SAVE -->|Yes| DEBOUNCED_SAVE
    AUTO_SAVE -->|No| MANUAL_SAVE
    
    DEBOUNCED_SAVE --> UPSERT_SESSION
    MANUAL_SAVE --> UPSERT_SESSION
    
    UPSERT_SESSION --> STATE_ERROR
    STATE_ERROR -->|Yes| ROLLBACK_STATE
    STATE_ERROR -->|No| VERSION_CONTROL
    
    VERSION_CONTROL --> SYNC_STATE
    SYNC_STATE --> BROADCAST_CHANGES
    
    %% Execution Flow
    EXECUTION_START --> EXECUTION_PROGRESS
    EXECUTION_PROGRESS --> EXECUTION_COMPLETE
    EXECUTION_COMPLETE --> SYNC_STATE
    
    %% Cleanup
    BROADCAST_CHANGES --> CLEANUP_STATE
    ROLLBACK_STATE --> RECOVER_STATE
    RECOVER_STATE --> SYNC_STATE
    
    VALIDATION_ERROR --> SYNC_STATE
    
    %% Styling
    classDef session fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef mutation fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef persistence fill:#2196f3,stroke:#1565c0,color:#fff
    classDef execution fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef sync fill:#00bcd4,stroke:#0097a7,color:#fff
    classDef error fill:#f44336,stroke:#c62828,color:#fff
    
    class CREATE_SESSION,LOAD_SESSION,INIT_STATE,VALIDATE_STATE session
    class ADD_NODE,REMOVE_NODE,UPDATE_NODE,ADD_EDGE,REMOVE_EDGE mutation
    class AUTO_SAVE,DEBOUNCED_SAVE,MANUAL_SAVE,UPSERT_SESSION,VERSION_CONTROL persistence
    class EXECUTION_START,EXECUTION_PROGRESS,EXECUTION_COMPLETE execution
    class SYNC_STATE,BROADCAST_CHANGES,CLEANUP_STATE sync
    class VALIDATE_GRAPH,VALIDATION_ERROR,STATE_ERROR,ROLLBACK_STATE,RECOVER_STATE error
```

## 4.6 Performance Optimization Workflows

### 4.6.1 Database Query Optimization Flow

```mermaid
flowchart TD
    %% Query Entry Point
    QUERY_REQUEST[Database Query<br/>Request]
    
    %% Query Analysis
    ANALYZE_QUERY[Analyze Query<br/>Structure & Complexity]
    CHECK_INDEXES{Indexes Available?}
    
    %% Index Strategy
    USE_INDEX[Use Existing Index<br/>Optimal Path]
    PARTIAL_INDEX[Use Partial Index<br/>Filtered Results]
    COMPOSITE_INDEX[Use Composite Index<br/>Multiple Columns]
    FULL_SCAN[Full Table Scan<br/>No Index Available]
    
    %% Query Optimization
    OPTIMIZE_WHERE[Optimize WHERE<br/>Clauses]
    OPTIMIZE_JOIN[Optimize JOIN<br/>Operations]
    OPTIMIZE_ORDER[Optimize ORDER BY<br/>Sorting]
    
    %% Execution Plan
    EXPLAIN_PLAN[EXPLAIN Query Plan<br/>Cost Analysis]
    COST_THRESHOLD{Cost > Threshold?}
    
    %% Performance Monitoring
    MONITOR_DURATION[Monitor Query<br/>Duration]
    DURATION_THRESHOLD{Duration > 100ms?}
    
    %% Caching Strategy
    CACHE_RESULT{Cache Result?}
    STORE_CACHE[Store in Cache<br/>TTL Based]
    
    %% Query Execution
    EXECUTE_QUERY[Execute Optimized<br/>Query]
    
    %% Result Processing
    PROCESS_RESULTS[Process Query<br/>Results]
    TRANSFORM_DATA[Transform Data<br/>For Application]
    
    %% Performance Logging
    LOG_PERFORMANCE[Log Performance<br/>Metrics]
    SLOW_QUERY_LOG[Slow Query Log<br/>For Analysis]
    
    %% Optimization Recommendations
    RECOMMEND_INDEX[Recommend New<br/>Index Creation]
    RECOMMEND_REFACTOR[Recommend Query<br/>Refactoring]
    
    %% Flow Connections
    QUERY_REQUEST --> ANALYZE_QUERY
    ANALYZE_QUERY --> CHECK_INDEXES
    
    CHECK_INDEXES -->|Yes| USE_INDEX
    CHECK_INDEXES -->|Partial| PARTIAL_INDEX
    CHECK_INDEXES -->|Composite| COMPOSITE_INDEX
    CHECK_INDEXES -->|No| FULL_SCAN
    
    USE_INDEX --> OPTIMIZE_WHERE
    PARTIAL_INDEX --> OPTIMIZE_WHERE
    COMPOSITE_INDEX --> OPTIMIZE_WHERE
    FULL_SCAN --> OPTIMIZE_WHERE
    
    OPTIMIZE_WHERE --> OPTIMIZE_JOIN
    OPTIMIZE_JOIN --> OPTIMIZE_ORDER
    OPTIMIZE_ORDER --> EXPLAIN_PLAN
    
    EXPLAIN_PLAN --> COST_THRESHOLD
    COST_THRESHOLD -->|High| RECOMMEND_REFACTOR
    COST_THRESHOLD -->|Low| EXECUTE_QUERY
    
    EXECUTE_QUERY --> MONITOR_DURATION
    MONITOR_DURATION --> DURATION_THRESHOLD
    
    DURATION_THRESHOLD -->|High| SLOW_QUERY_LOG
    DURATION_THRESHOLD -->|Low| PROCESS_RESULTS
    
    SLOW_QUERY_LOG --> RECOMMEND_INDEX
    RECOMMEND_INDEX --> PROCESS_RESULTS
    RECOMMEND_REFACTOR --> PROCESS_RESULTS
    
    PROCESS_RESULTS --> CACHE_RESULT
    CACHE_RESULT -->|Yes| STORE_CACHE
    CACHE_RESULT -->|No| TRANSFORM_DATA
    STORE_CACHE --> TRANSFORM_DATA
    
    TRANSFORM_DATA --> LOG_PERFORMANCE
    
    %% Styling
    classDef query fill:#4caf50,stroke:#2e7d32,color:#fff
    classDef index fill:#ff9800,stroke:#ef6c00,color:#fff
    classDef optimize fill:#2196f3,stroke:#1565c0,color:#fff
    classDef monitor fill:#9c27b0,stroke:#6a1b9a,color:#fff
    classDef cache fill:#00bcd4,stroke:#0097a7,color:#fff
    classDef recommend fill:#795548,stroke:#5d4037,color:#fff
    
    class QUERY_REQUEST,ANALYZE_QUERY,EXECUTE_QUERY,PROCESS_RESULTS,TRANSFORM_DATA query
    class CHECK_INDEXES,USE_INDEX,PARTIAL_INDEX,COMPOSITE_INDEX,FULL_SCAN index
    class OPTIMIZE_WHERE,OPTIMIZE_JOIN,OPTIMIZE_ORDER,EXPLAIN_PLAN optimize
    class MONITOR_DURATION,DURATION_THRESHOLD,COST_THRESHOLD,LOG_PERFORMANCE,SLOW_QUERY_LOG monitor
    class CACHE_RESULT,STORE_CACHE cache
    class RECOMMEND_INDEX,RECOMMEND_REFACTOR recommend
```

### 4.6.2 Frontend Performance Optimization Flow

```mermaid
flowchart TD
    %% Component Lifecycle
    COMPONENT_MOUNT[Component Mount<br/>Initial Render]
    
    %% Performance Analysis
    ANALYZE_RENDER[Analyze Render<br/>Performance]
    EXPENSIVE_CALC{Expensive<br/>Calculations?}
    FREQUENT_RERENDERS{Frequent<br/>Re-renders?}
    LARGE_DATASET{Large Dataset<br/>Rendering?}
    
    %% Optimization Strategies
    MEMOIZATION[React.memo()<br/>Component Memoization]
    USE_MEMO[useMemo()<br/>Value Memoization]
    USE_CALLBACK[useCallback()<br/>Function Memoization]
    
    %% Virtual Scrolling
    VIRTUAL_SCROLL[Implement Virtual<br/>Scrolling]
    WINDOWING[React Window<br/>List Virtualization]
    
    %% Code Splitting
    LAZY_LOADING[React.lazy()<br/>Component Splitting]
    DYNAMIC_IMPORT[Dynamic Import<br/>Route Splitting]
    
    %% Bundle Optimization
    ANALYZE_BUNDLE[Analyze Bundle<br/>Size & Dependencies]
    TREE_SHAKING[Tree Shaking<br/>Remove Dead Code]
    
    %% Image Optimization
    OPTIMIZE_IMAGES[Optimize Images<br/>next/image]
    LAZY_IMAGES[Lazy Load Images<br/>Intersection Observer]
    
    %% Caching Strategy
    BROWSER_CACHE[Browser Caching<br/>Static Assets]
    SERVICE_WORKER[Service Worker<br/>Offline Caching]
    
    %% Performance Monitoring
    MEASURE_VITALS[Measure Core<br/>Web Vitals]
    LCP_OPTIMIZATION[Optimize LCP<br/>Largest Contentful Paint]
    FID_OPTIMIZATION[Optimize FID<br/>First Input Delay]
    CLS_OPTIMIZATION[Optimize CLS<br/>Cumulative Layout Shift]
    
    %% Performance Budget
    PERFORMANCE_

# 5. System Architecture

## 5.1 High-Level Architecture

#### System Overview

CASCADIAN employs a **modern three-tier serverless architecture** built on Next.js 15 App Router, designed specifically for prediction market intelligence and trading automation. The system follows a **server-first rendering approach** with selective client-side interactivity, optimizing for performance while maintaining rich user experiences.

The architecture is fundamentally **API-driven** with clear separation of concerns between data persistence, business logic, and presentation layers. The App Router in Next.js 15 is a modern, performance-first full-stack model: server-first rendering, fine-grained caching, ergonomic mutations via Server Actions, persistent layouts, and streaming by default. Treat the server as your primary rendering surface, ship minimal client JS, and control freshness explicitly.

**Key Architectural Principles:**

- **Serverless-First Design**: Leveraging Vercel's edge infrastructure for automatic scaling and global distribution
- **Progressive Enhancement**: Core functionality works without JavaScript, enhanced with client-side interactivity
- **Data-Driven Intelligence**: Real-time synchronization with Polymarket APIs feeding enriched analytics
- **Workflow-Centric Automation**: Visual workflow builder enabling no-code trading strategy creation
- **Multi-Layer Caching**: Aggressive caching strategy from browser to database for optimal performance

The system integrates deeply with Polymarket's ecosystem while maintaining independence through abstracted service layers, enabling future expansion to additional prediction market platforms.

#### Core Components Table

| Component Name | Primary Responsibility | Key Dependencies | Integration Points |
|---|---|---|---|
| **Next.js Frontend** | Server/client rendering, routing, UI state management | React 19.2, TanStack Query, ReactFlow | Supabase Auth, API Routes, External APIs |
| **API Layer** | Business logic, external integrations, data transformation | Polymarket APIs, AI services | Supabase DB, Streaming responses |
| **Supabase Database** | Data persistence, real-time subscriptions, authentication | PostgreSQL 15+, Row-Level Security | API layer, Auth service |
| **Workflow Engine** | Strategy execution, node orchestration, streaming updates | Custom executors, AI services | Database, External APIs |

#### Data Flow Description

The system processes data through multiple interconnected flows optimized for real-time intelligence and automated execution:

**Primary Intelligence Flow**: Market data originates from Polymarket's three APIs (Gamma, CLOB, Data) and flows through a background synchronization service that runs every 5 minutes. This service transforms raw API responses, enriches them with calculated analytics, and persists them to Supabase PostgreSQL with proper indexing for fast retrieval.

**User Query Flow**: When users interact with the market screener or analytics dashboards, requests first check TanStack Query's browser cache (5-minute stale time). Cache misses trigger API routes that query the database with optimized indexes, returning enriched data with metadata about freshness and pagination.

**Workflow Execution Flow**: User-created trading strategies execute through a streaming architecture where the workflow engine performs topological sorting of nodes, executes them sequentially, and streams real-time status updates via Server-Sent Events. Each node can integrate with external services (Polymarket APIs, AI services) while maintaining state isolation.

**Real-Time Updates**: Supabase leverages PostgreSQL's Logical Replication feature to stream database changes. Unlike physical replication, logical replication sends data changes (inserts, updates, deletes) as logical messages rather than binary files, enabling fine-grained, table-level change subscriptions.

#### External Integration Points

| System Name | Integration Type | Data Exchange Pattern | Protocol/Format |
|---|---|---|---|
| **Polymarket Gamma API** | RESTful API | Pull-based sync every 5 minutes | HTTPS/JSON |
| **Polymarket CLOB API** | RESTful API | On-demand order book queries | HTTPS/JSON |
| **Polymarket Data API** | RESTful API | Wallet analytics on-demand | HTTPS/JSON |
| **OpenAI GPT-4** | AI Service | Request/response with streaming | HTTPS/JSON + SSE |

## 5.2 Component Details

#### Frontend Layer (Next.js Client)

**Purpose and Responsibilities:**
The frontend layer serves as the primary user interface, handling both server-side rendering for initial page loads and client-side interactivity for dynamic features. Server Components (default): render on the server, ship no client JS, can read secrets, talk to DB/APIs directly, and await in JSX. Not allowed: useState, useEffect, DOM APIs (window, document), event handlers. Client Components: add "use client" at the top of the file; render on server then hydrate on the client; you can use state/effects/events and browser APIs. Pattern: Keep most UI as server components; isolate interactivity in small client islands imported inside server components.

**Technologies and Frameworks:**
- **Next.js 15.5** with App Router for file-system based routing and React Server Components
- **React 19.2** for component architecture with selective client-side hydration
- **TailwindCSS 4.1** for utility-first styling with design system consistency
- **ReactFlow 12.x** for visual workflow editor with drag-and-drop capabilities
- **ECharts 5.x** for high-performance financial charting and data visualization

**Key Interfaces and APIs:**
The frontend communicates exclusively through Next.js API routes, maintaining a clean separation between client and server logic. All data fetching utilizes TanStack Query for intelligent caching and state management, with query keys structured hierarchically for efficient invalidation patterns.

**Scaling Considerations:**
App Router replaces getServerSideProps/getStaticProps with route segment config and fetch caching: Default (dynamic = 'auto'): static when possible, dynamic when needed. Force SSR: export const dynamic = 'force-dynamic' or export const revalidate = 0. Force SSG: export const dynamic = 'force-static' (disallow dynamic APIs). ISR: export const revalidate = 60 (seconds) or per-request fetch(url, { next: { revalidate: 60 } }).

#### API Layer (Serverless Functions)

**Purpose and Responsibilities:**
The API layer orchestrates all business logic, external service integration, and data transformation. Built on Vercel's serverless infrastructure, it automatically scales based on demand while maintaining stateless operation principles.

**Technologies and Frameworks:**
- **Next.js API Routes** running on Vercel Edge Runtime for global distribution
- **Custom HTTP clients** with exponential backoff retry logic for external API integration
- **Zod schemas** for comprehensive input validation and type safety
- **Server-Sent Events (SSE)** for real-time streaming of workflow execution

**Key Interfaces and APIs:**
The layer exposes RESTful endpoints following consistent patterns: collections use plural nouns (`/api/markets`), single resources include identifiers (`/api/markets/[id]`), and actions use descriptive verbs (`/api/execute-workflow`). All responses follow a standardized format with success/error indicators and metadata.

**Data Persistence Requirements:**
API routes maintain no persistent state, relying entirely on Supabase for data storage and session management. Temporary execution state for workflows is streamed directly to clients without database persistence.

**Scaling Considerations:**
Serverless functions automatically scale from zero to thousands of concurrent executions. The 10-second timeout limit is managed through streaming responses for long-running operations, while memory usage is optimized through selective data loading and transformation.

#### Database Layer (Supabase PostgreSQL)

**Purpose and Responsibilities:**
This integrates with PostgreSQL's Row Level Security and the API servers. A standalone web server that turns your Postgres database directly into a RESTful API. We use this with our pg_graphql extension to provide a GraphQL API. The database layer provides ACID-compliant data persistence with real-time capabilities and built-in security through Row-Level Security policies.

**Technologies and Frameworks:**
- **PostgreSQL 15+** with advanced indexing strategies and full-text search capabilities
- **Supabase extensions** including pg_trgm for fuzzy search and uuid-ossp for identifier generation
- **Row-Level Security (RLS)** policies for data isolation and access control
- **Real-time subscriptions** via PostgreSQL's logical replication for live updates

**Key Interfaces and APIs:**
Database access occurs through Supabase's client libraries, which provide both direct SQL query capabilities and real-time subscription management. The schema is designed with proper foreign key relationships and optimized indexes for common query patterns.

**Scaling Considerations:**
Optimize your connection pool settings to ensure efficient use of database resources. Properly managing connections can prevent bottlenecks and maximize throughput. Regularly review and update your indexes. Over time, as your data and query patterns evolve, some indexes may become less effective while new indexing opportunities may arise. Consider auto-scaling features to adjust resources based on demand. Supabase can automatically scale your database and serverless functions to match the current load, ensuring optimal performance without manual intervention.

#### Workflow Execution Engine

**Purpose and Responsibilities:**
The workflow engine enables visual strategy creation and autonomous execution through a node-based system. It handles topological sorting of workflow graphs, sequential node execution with dependency management, and real-time status streaming to connected clients.

**Technologies and Frameworks:**
- **Custom TypeScript execution engine** with pluggable node executors
- **ReactFlow** for visual workflow representation and manipulation
- **Server-Sent Events** for real-time execution status streaming
- **AI service integration** for intelligent node execution and strategy optimization

**Key Interfaces and APIs:**
The engine exposes a streaming execution endpoint (`/api/execute-workflow`) that accepts workflow definitions and returns real-time execution events. Node executors implement a standardized interface enabling extensible functionality for different node types.

**Data Persistence Requirements:**
Workflow definitions are stored as JSONB in PostgreSQL, enabling flexible schema evolution while maintaining query performance. Execution history is logged for performance analysis and debugging, with configurable retention policies.

**Scaling Considerations:**
The engine is designed for horizontal scaling through stateless execution. Long-running workflows are broken into discrete node executions, each completing within serverless function timeout limits while maintaining overall workflow state through database persistence.

```mermaid
graph TB
    subgraph "Client Tier"
        A[Next.js React App]
        B[TanStack Query Cache]
        C[ReactFlow Canvas]
    end
    
    subgraph "Application Tier"
        D[Next.js API Routes]
        E[Workflow Engine]
        F[AI Integration Layer]
    end
    
    subgraph "Data Tier"
        G[Supabase PostgreSQL]
        H[Real-time Subscriptions]
    end
    
    subgraph "External Services"
        I[Polymarket APIs]
        J[OpenAI GPT-4]
        K[Anthropic Claude]
    end
    
    A --> B
    A --> C
    B --> D
    C --> E
    D --> G
    E --> F
    E --> H
    F --> J
    F --> K
    D --> I
    G --> H
    H --> B
```

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API Layer
    participant W as Workflow Engine
    participant D as Database
    participant P as Polymarket API
    
    U->>F: Create Workflow
    F->>A: POST /api/execute-workflow
    A->>W: Initialize Execution
    W->>D: Load Workflow Definition
    D-->>W: Workflow Nodes & Edges
    W->>W: Topological Sort
    
    loop For Each Node
        W->>F: Stream Status (running)
        W->>P: Execute Node Logic
        P-->>W: Node Result
        W->>F: Stream Output
    end
    
    W->>D: Log Execution History
    W->>F: Stream Complete
    F->>U: Display Results
```

## 5.3 Technical Decisions

#### Architecture Style Decisions and Tradeoffs

**Serverless vs. Traditional Server Architecture**

The decision to adopt a serverless architecture using Vercel's platform was driven by several key factors:

| Decision Factor | Serverless Benefits | Traditional Server Tradeoffs |
|---|---|---|
| **Scaling** | Automatic scaling from 0 to thousands of requests | Manual scaling configuration and monitoring |
| **Cost Efficiency** | Pay-per-execution model with zero idle costs | Fixed server costs regardless of usage |
| **Global Distribution** | Built-in edge deployment across regions | Complex CDN and load balancer setup |
| **Maintenance** | Zero infrastructure management overhead | Server patching, monitoring, and maintenance |

The primary tradeoff is the 10-second execution timeout, which we address through streaming responses and workflow decomposition into discrete, stateless operations.

**React Server Components vs. Traditional SPA**

By default, all page and layout files are Server Components, meaning they render on the server and their code is not sent to the browser. Client Components (marked with the "use client" directive) are used only when interactivity, state, or browser APIs are needed. In practice, a Server Component can import and include a Client Component (to add interactive parts), but not vice versa. This allows a single page's component tree to interleave server-rendered UI with interactive client-side widgets. By pushing as much UI as possible into Server Components, Next.js reduces the amount of JavaScript that must hydrate on the client, improving performance.

This architectural choice significantly reduces client-side JavaScript bundle sizes while maintaining rich interactivity where needed, particularly important for the complex data visualizations and workflow editor components.

#### Communication Pattern Choices

**Server-Sent Events for Real-Time Updates**

The choice of Server-Sent Events over WebSockets for workflow execution streaming was based on:

- **Simplicity**: SSE provides unidirectional streaming without connection management complexity
- **HTTP Compatibility**: Works through standard HTTP infrastructure without special proxy configuration
- **Automatic Reconnection**: Built-in browser reconnection handling for network interruptions
- **Serverless Compatibility**: Aligns with stateless serverless function architecture

**TanStack Query for State Management**

TanStack Query (formerly known as React Query) is often described as the missing data-fetching library for web applications, but in more technical terms, it makes fetching, caching, synchronizing and updating server state in your web applications a breeze. Most core web frameworks do not come with an opinionated way of fetching or updating data in a holistic way. Because of this developers end up building either meta-frameworks which encapsulate strict opinions about data-fetching, or they invent their own ways of fetching data. This usually means cobbling together component-based state and side-effects, or using more general purpose state management libraries to store and provide asynchronous data throughout their apps. While most traditional state management libraries are great for working with client state, they are not so great at working with async or server state.

The decision to use TanStack Query over traditional state management solutions provides:

- **Intelligent Caching**: Automatic cache invalidation and background refetching
- **Request Deduplication**: Multiple components requesting the same data result in single API calls
- **Optimistic Updates**: Immediate UI feedback with automatic rollback on errors
- **Background Synchronization**: Automatic data freshness without user intervention

#### Data Storage Solution Rationale

**Supabase PostgreSQL vs. Alternative Databases**

The selection of Supabase PostgreSQL was driven by specific requirements for prediction market intelligence:

| Requirement | PostgreSQL Advantage | Alternative Limitations |
|---|---|---|
| **Complex Queries** | Advanced SQL with joins, aggregations, window functions | NoSQL databases lack complex query capabilities |
| **Real-Time Updates** | Built-in logical replication and subscriptions | Additional infrastructure needed for real-time features |
| **Full-Text Search** | Native pg_trgm extension for fuzzy search | Separate search infrastructure required |
| **ACID Compliance** | Strong consistency for financial data | Eventual consistency models inappropriate for trading |

The combination of PostgreSQL's JSON support and pgVector extension enables integrated processing of relational and vector data, forming the technical foundation for this success. In fact, several newly created databases on Supabase implement vector search with pgvector, and the metrics clearly demonstrate the value of this integration for the AI-era.

#### Caching Strategy Justification

**Multi-Layer Caching Architecture**

The caching strategy implements multiple layers optimized for different access patterns:

```mermaid
graph TD
    A[Browser Cache<br/>TanStack Query<br/>5min stale time] --> B[API Response Cache<br/>In-memory<br/>1min TTL]
    B --> C[Database Query Cache<br/>PostgreSQL<br/>Connection pooling]
    C --> D[External API<br/>Polymarket<br/>5min sync interval]
    
    A -->|Cache Miss| B
    B -->|Cache Miss| C
    C -->|Stale Data| D
```

**Layer-Specific Optimizations:**

- **Browser Layer**: 5-minute stale time balances data freshness with user experience
- **API Layer**: 1-minute cache for expensive computations shared across users
- **Database Layer**: Optimized indexes and connection pooling for sub-100ms queries
- **Sync Layer**: 5-minute intervals prevent API rate limiting while maintaining reasonable freshness

#### Security Mechanism Selection

**Row-Level Security vs. Application-Level Authorization**

The decision to implement security primarily through PostgreSQL's Row-Level Security rather than application-level checks provides:

- **Defense in Depth**: Security enforced at the database level regardless of application bugs
- **Consistent Enforcement**: All data access paths (API, direct queries, real-time subscriptions) respect the same policies
- **Performance Benefits**: Security checks integrated with query planning and execution
- **Audit Trail**: Database-level logging of all security policy evaluations

```mermaid
flowchart TD
    A[User Request] --> B{Authenticated?}
    B -->|No| C[Return 401]
    B -->|Yes| D[Extract JWT Claims]
    D --> E[Execute Query with RLS]
    E --> F{RLS Policy Check}
    F -->|Pass| G[Return Filtered Data]
    F -->|Fail| H[Return Empty Result]
```

## 5.4 Cross-Cutting Concerns

#### Monitoring and Observability Approach

The system implements comprehensive observability through multiple integrated monitoring layers designed to provide both technical metrics and business intelligence:

**Application Performance Monitoring:**
- **Vercel Analytics** provides Core Web Vitals tracking, page performance metrics, and user engagement analytics with built-in Next.js integration
- **Custom metrics collection** through API route instrumentation tracks response times, error rates, and business-specific KPIs like workflow execution success rates
- **Database performance monitoring** via Supabase dashboard tracks query performance, connection pool utilization, and slow query identification

**Business Metrics Tracking:**
- **User engagement metrics** including daily active users, session duration, and feature adoption rates
- **Trading performance metrics** tracking strategy win rates, execution volume, and user portfolio performance
- **System health indicators** monitoring sync success rates, API uptime, and data freshness across all external integrations

#### Logging and Tracing Strategy

**Structured Logging Architecture:**
All application logs follow a consistent JSON structure enabling efficient querying and analysis:

```typescript
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  service: string
  operation: string
  userId?: string
  metadata: Record<string, any>
  duration?: number
  error?: ErrorDetails
}
```

**Distributed Tracing:**
Workflow executions generate trace IDs that follow requests across multiple services, enabling end-to-end performance analysis and debugging. Each node execution within a workflow maintains parent-child relationships for complete execution visibility.

**Log Aggregation and Analysis:**
- **Vercel Function Logs** capture all serverless function execution details with automatic retention policies
- **Database query logs** through Supabase provide query performance analysis and optimization opportunities
- **Custom application logs** track business logic execution, user actions, and system state changes

#### Error Handling Patterns

The system implements a comprehensive error handling strategy with graceful degradation and user-friendly error reporting:

```mermaid
flowchart TD
    A[Error Occurs] --> B{Error Type}
    B -->|Network Error| C[Retry with Exponential Backoff]
    B -->|Validation Error| D[Return User-Friendly Message]
    B -->|System Error| E[Log Error & Return Generic Message]
    
    C --> F{Max Retries?}
    F -->|No| G[Retry Request]
    F -->|Yes| H[Fallback to Cached Data]
    
    G --> A
    H --> I[Display Stale Data Warning]
    D --> J[Display Validation Errors]
    E --> K[Display Generic Error]
    
    I --> L[Continue Operation]
    J --> L
    K --> L
```

**Error Classification and Handling:**

| Error Type | Handling Strategy | User Experience | Recovery Action |
|---|---|---|---|
| **Network Errors** | Exponential backoff retry (max 4 attempts) | Loading indicator with retry option | Fallback to cached data |
| **Validation Errors** | Immediate user feedback with specific field errors | Inline error messages | User corrects input |
| **Rate Limiting** | Queue requests with backoff | Progress indicator | Automatic retry after delay |
| **System Errors** | Log for investigation, generic user message | Friendly error page | Manual refresh or support contact |

#### Authentication and Authorization Framework

**Multi-Layer Security Architecture:**
The authentication system leverages Supabase Auth with JWT tokens, enhanced by PostgreSQL Row-Level Security for comprehensive data protection:

**Authentication Flow:**
1. User credentials validated through Supabase Auth service
2. JWT access token issued with user claims and permissions
3. Client stores token securely and includes in all API requests
4. API routes validate token and extract user context
5. Database queries execute with RLS policies enforcing data access rules

**Authorization Patterns:**
- **Resource-Based Access**: Users can only access their own workflows, executions, and settings
- **Public Data Access**: Market data, whale intelligence, and analytics available to all authenticated users
- **Admin Operations**: Restricted endpoints for system administration and data management
- **API Rate Limiting**: Per-user request limits to prevent abuse and ensure fair resource allocation

#### Performance Requirements and SLAs

**Response Time Targets:**

| Operation Category | Target Response Time | Measurement Method | Escalation Threshold |
|---|---|---|---|
| **Market Screener Queries** | < 150ms (p95) | API route instrumentation | > 300ms for 5 minutes |
| **Workflow Execution Start** | < 100ms initial response | SSE connection establishment | > 500ms connection time |
| **Database Sync Operations** | < 10 seconds complete sync | Background job monitoring | > 30 seconds duration |
| **User Authentication** | < 200ms token validation | Supabase Auth metrics | > 1 second response time |

**Availability and Reliability:**
- **System Uptime**: 99.5% availability target with automatic failover to cached data during outages
- **Data Freshness**: Market data staleness not exceeding 10 minutes under normal operations
- **Workflow Execution**: 95% success rate for workflow executions with automatic retry for transient failures

#### Disaster Recovery Procedures

**Data Backup and Recovery:**
- **Automated Database Backups**: Supabase provides continuous backup with point-in-time recovery capabilities
- **Configuration Backup**: Environment variables and deployment configurations stored in version control
- **User Data Export**: Comprehensive data export functionality enabling user data portability

**Service Recovery Procedures:**
1. **Automatic Failover**: Vercel's global edge network provides automatic traffic routing during regional outages
2. **Database Recovery**: Supabase handles database failover with minimal downtime through read replicas
3. **External API Failures**: Graceful degradation to cached data with user notifications about reduced functionality
4. **Complete System Recovery**: Documented procedures for full system restoration from backups with estimated 4-hour recovery time objective

**Business Continuity:**
- **Read-Only Mode**: System can operate in read-only mode during database maintenance, allowing users to view data and create workflows without execution
- **Cached Data Serving**: Extended cache TTLs during external API outages maintain basic functionality
- **User Communication**: Automated status page updates and email notifications for significant service disruptions

# 6. SYSTEM COMPONENTS DESIGN

## 6.1 Component Architecture Overview

### 6.1.1 System Component Hierarchy

CASCADIAN leverages Next.js 15's App Router architecture with React Server Components (RSC) as the foundation, representing one of the most significant changes to React's architecture. The new architecture is designed to support React Server Components, allowing them to run exclusively on the server and leverage server-side rendering benefits.

The system follows a **hybrid server-client component architecture** where components are strategically distributed between server and client execution environments based on their functional requirements:

```mermaid
graph TB
    subgraph "Server Environment"
        RSC[React Server Components]
        API[API Route Handlers]
        DB[Database Operations]
        AI[AI Service Integration]
    end
    
    subgraph "Client Environment"
        CC[Client Components]
        STATE[State Management]
        UI[Interactive UI]
        CACHE[Client Cache]
    end
    
    subgraph "Shared Environment"
        UTILS[Utility Functions]
        TYPES[TypeScript Types]
        CONFIG[Configuration]
    end
    
    RSC --> CC
    API --> RSC
    DB --> API
    AI --> API
    CC --> STATE
    STATE --> UI
    UI --> CACHE
    
    UTILS --> RSC
    UTILS --> CC
    TYPES --> RSC
    TYPES --> CC
    CONFIG --> RSC
    CONFIG --> CC
```

### 6.1.2 Component Classification Strategy

Server Components are the default in Next.js App Router and React Server Components paradigm. Once a file is marked with "use client", all its imports and child components are considered part of the client bundle.

| Component Type | Execution Environment | Use Cases | Bundle Impact |
|---|---|---|---|
| **Server Components** | Server-only | Data fetching, static rendering, AI processing | Zero client bundle |
| **Client Components** | Client-side | Interactivity, state management, browser APIs | Included in bundle |
| **Shared Components** | Both environments | Utilities, types, pure functions | Minimal impact |

### 6.1.3 Network Boundary Strategy

In React, you choose where to place the network boundary in your component tree. For example, you can fetch data and render a user's posts on the server (using Server Components), then render the interactive LikeButton for each post on the client (using Client Components).

The network boundary is strategically placed to optimize performance while maintaining rich interactivity:

- **Server-side**: Market data fetching, whale intelligence calculations, AI analysis
- **Client-side**: User interactions, real-time updates, workflow canvas manipulation
- **Hybrid**: Portfolio analytics (server calculation, client visualization)

## 6.2 Core System Components

### 6.2.1 Market Intelligence Engine (Server Component)

**Component Responsibility**: Processes and enriches raw Polymarket data into actionable intelligence signals.

**Architecture Pattern**: Server components can run at build time to read from the filesystem or fetch static content, so a web server is not required.

```typescript
// Server Component - No client bundle impact
export default async function MarketIntelligenceEngine({
  filters,
  timeframe
}: MarketIntelligenceProps) {
  // Direct database access - server-only
  const markets = await fetchMarketsFromDB(filters)
  const whaleData = await calculateWhaleScores(markets)
  const signals = await generateIntelligenceSignals(markets, whaleData)
  
  return (
    <div className="market-intelligence">
      <MarketGrid markets={markets} />
      <WhaleActivityFeed whaleData={whaleData} />
      <SignalsDashboard signals={signals} />
      {/* Client component for interactivity */}
      <MarketFilters />
    </div>
  )
}
```

**Key Capabilities**:
- **Real-time Data Sync**: 5-minute background synchronization with Polymarket APIs
- **Whale Detection Algorithm**: Identifies wallets with positions >$10K using statistical analysis
- **Signal Generation**: Momentum scoring, Smart Imbalance Index (SII), insider detection
- **Performance Optimization**: Server-side rendering eliminates client-side data fetching waterfalls

**Integration Points**:
- **Database Layer**: Direct PostgreSQL queries with optimized indexes
- **External APIs**: Polymarket Gamma, CLOB, and Data APIs
- **AI Services**: OpenAI GPT-4 for market sentiment analysis
- **Client Components**: Passes processed data to interactive filtering components

### 6.2.2 Workflow Execution Engine (Hybrid Component)

**Component Responsibility**: Orchestrates visual workflow creation and autonomous strategy execution.

**Architecture Pattern**: One common pattern is known as the "children as props" pattern. This flexibility allows you to create more efficient applications by keeping data-fetching and heavy computations on the server while still providing interactivity where needed.

```typescript
// Server Component - Workflow orchestration
export default async function WorkflowExecutionEngine({
  workflowId,
  userId
}: WorkflowEngineProps) {
  // Server-side workflow validation and preparation
  const workflow = await loadWorkflowFromDB(workflowId, userId)
  const executionContext = await prepareExecutionContext(workflow)
  
  return (
    <div className="workflow-engine">
      {/* Server-rendered workflow metadata */}
      <WorkflowMetadata workflow={workflow} />
      
      {/* Client component for interactive canvas */}
      <WorkflowCanvas workflow={workflow}>
        {/* Server components as children */}
        <NodeExecutionLogs executionContext={executionContext} />
        <PerformanceMetrics workflowId={workflowId} />
      </WorkflowCanvas>
      
      {/* Client component for real-time execution */}
      <ExecutionController workflowId={workflowId} />
    </div>
  )
}
```

**Key Capabilities**:
- **Visual Workflow Builder**: ReactFlow-based drag-and-drop interface (client-side)
- **Node Execution Engine**: Server-side topological sorting and sequential execution
- **Real-time Streaming**: Server-Sent Events for live execution status updates
- **AI Copilot Integration**: Conversational strategy building with Claude/GPT-4

**Component Breakdown**:

| Sub-Component | Type | Responsibility | Justification |
|---|---|---|---|
| `WorkflowCanvas` | Client | Interactive node manipulation | Requires DOM events, drag-and-drop |
| `NodeExecutor` | Server | Strategy logic execution | Heavy computation, API calls |
| `ExecutionStreamer` | Server | Real-time status updates | Server-Sent Events, database logging |
| `AIStrategyBuilder` | Server | LLM-powered workflow generation | AI service integration, prompt processing |

### 6.2.3 Portfolio Analytics Engine (Server Component)

**Component Responsibility**: Calculates comprehensive portfolio metrics and performance analytics.

**Architecture Pattern**: This pattern means users need to download and parse an additional 75K (gzipped) of libraries, and wait for a second request to fetch the data after the page loads, just to render static content that will not change for the lifetime of the page.

By moving portfolio calculations to the server, we eliminate the need for heavy financial calculation libraries on the client.

```typescript
// Server Component - Portfolio calculations
export default async function PortfolioAnalyticsEngine({
  walletAddress,
  timeframe = '30d'
}: PortfolioProps) {
  // Server-side financial calculations
  const positions = await fetchWalletPositions(walletAddress)
  const trades = await fetchTradeHistory(walletAddress, timeframe)
  
  // Heavy calculations on server (no client bundle impact)
  const metrics = await calculatePortfolioMetrics({
    positions,
    trades,
    timeframe
  })
  
  const riskAnalysis = await performRiskAnalysis(positions)
  const performanceAttribution = await calculatePerformanceAttribution(trades)
  
  return (
    <div className="portfolio-analytics">
      <PortfolioSummary metrics={metrics} />
      <PerformanceCharts data={performanceAttribution} />
      <RiskMetrics analysis={riskAnalysis} />
      <PositionTable positions={positions} />
      
      {/* Client component for interactive features */}
      <PortfolioFilters />
    </div>
  )
}
```

**Key Capabilities**:
- **Real-time P&L Calculation**: Unrealized and realized profit/loss tracking
- **Performance Metrics**: Sharpe ratio, win rate, ROI, maximum drawdown
- **Risk Analysis**: Position concentration, category exposure, correlation analysis
- **Activity Timeline**: Chronological trade and position history

**Performance Benefits**:
- **Zero Client Bundle**: Financial calculation libraries remain on server
- **Faster Initial Load**: Pre-calculated metrics sent as HTML
- **Reduced Memory Usage**: No client-side number crunching

### 6.2.4 Real-time Data Synchronization Service (Server Component)

**Component Responsibility**: Maintains data freshness through background synchronization and streaming updates.

```typescript
// Server Component - Background sync orchestration
export default async function DataSyncService() {
  // Server-only background processes
  const syncStatus = await getSyncStatus()
  const lastSyncTime = await getLastSyncTime()
  const queuedJobs = await getQueuedSyncJobs()
  
  return (
    <div className="data-sync-service">
      <SyncStatusIndicator status={syncStatus} lastSync={lastSyncTime} />
      <QueueMonitor jobs={queuedJobs} />
      
      {/* Client component for manual sync trigger */}
      <ManualSyncButton />
    </div>
  )
}

// Background sync job (API Route)
export async function POST(request: Request) {
  const mutex = new Mutex('polymarket-sync')
  
  try {
    await mutex.acquire()
    
    // Fetch from Polymarket APIs
    const events = await polymarketClient.getEvents()
    const markets = extractMarketsFromEvents(events)
    
    // Transform and validate data
    const transformedMarkets = await transformMarketData(markets)
    
    // Batch UPSERT to database
    await batchUpsertMarkets(transformedMarkets)
    
    // Update sync timestamp
    await updateSyncTimestamp()
    
    return Response.json({ success: true, count: markets.length })
  } finally {
    await mutex.release()
  }
}
```

**Key Capabilities**:
- **Scheduled Synchronization**: Vercel Cron jobs trigger sync every 5 minutes
- **Mutex Locking**: Prevents concurrent sync operations
- **Batch Processing**: Efficient database operations (500 markets per batch)
- **Error Recovery**: Exponential backoff retry logic with graceful degradation

## 6.3 Client-Side Interactive Components

### 6.3.1 Market Screener Interface (Client Component)

**Component Responsibility**: Provides interactive market filtering, sorting, and selection capabilities.

You can create a Client Component by adding the "use client" directive at the top of the file, above your imports. "use client" is used to declare a boundary between the Server and Client module graphs (trees).

```typescript
'use client'

import { useState, useMemo } from 'react'
import { usePolymarketMarkets } from '@/hooks/use-polymarket-markets'

export default function MarketScreenerInterface() {
  const [filters, setFilters] = useState<MarketFilters>({
    category: 'all',
    volumeMin: 0,
    active: true
  })
  
  const [sorting, setSorting] = useState<SortConfig>({
    field: 'volume_24h',
    direction: 'desc'
  })
  
  // React Query for server state management
  const { data: markets, isLoading, error } = usePolymarketMarkets({
    filters,
    sorting,
    staleTime: 5 * 60 * 1000 // 5 minutes
  })
  
  // Client-side filtering for instant feedback
  const filteredMarkets = useMemo(() => {
    if (!markets) return []
    return applyClientSideFilters(markets, filters)
  }, [markets, filters])
  
  return (
    <div className="market-screener">
      <FilterBar 
        filters={filters} 
        onFiltersChange={setFilters}
      />
      
      <SortingControls
        sorting={sorting}
        onSortingChange={setSorting}
      />
      
      <VirtualizedTable
        data={filteredMarkets}
        loading={isLoading}
        error={error}
      />
    </div>
  )
}
```

**Client-Side Justification**:
- **Interactive Filtering**: Real-time filter updates require client state
- **Sorting Controls**: Immediate visual feedback on sort changes
- **Virtual Scrolling**: Performance optimization for large datasets
- **Optimistic Updates**: Instant UI feedback while server requests process

### 6.3.2 Workflow Canvas Editor (Client Component)

**Component Responsibility**: Provides drag-and-drop workflow creation and visual editing capabilities.

```typescript
'use client'

import { useCallback, useState } from 'react'
import ReactFlow, { 
  Node, 
  Edge, 
  addEdge, 
  useNodesState, 
  useEdgesState 
} from '@xyflow/react'

export default function WorkflowCanvasEditor({
  initialWorkflow
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialWorkflow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialWorkflow.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge(params, eds))
  }, [setEdges])
  
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node)
  }, [])
  
  // Auto-save workflow changes
  const { mutate: saveWorkflow } = useSaveWorkflow()
  
  useEffect(() => {
    const debounced = debounce(() => {
      saveWorkflow({ nodes, edges })
    }, 1000)
    
    debounced()
    return debounced.cancel
  }, [nodes, edges, saveWorkflow])
  
  return (
    <div className="workflow-canvas">
      <NodePalette onNodeDrag={handleNodeDrag} />
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      
      {selectedNode && (
        <NodeConfigurationPanel
          node={selectedNode}
          onConfigChange={handleNodeConfigChange}
        />
      )}
    </div>
  )
}
```

**Client-Side Justification**:
- **Drag-and-Drop Interaction**: Requires DOM manipulation and mouse events
- **Real-time Canvas Updates**: Immediate visual feedback during editing
- **State Management**: Complex workflow state needs client-side coordination
- **Performance**: Smooth 60fps interactions require client-side rendering

### 6.3.3 Real-time Execution Monitor (Client Component)

**Component Responsibility**: Displays live workflow execution status and streaming logs.

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useServerSentEvents } from '@/hooks/use-server-sent-events'

export default function ExecutionMonitor({
  workflowId
}: ExecutionMonitorProps) {
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    currentNode: null,
    logs: [],
    outputs: {}
  })
  
  // Server-Sent Events for real-time updates
  const { data: executionEvents, error } = useServerSentEvents(
    `/api/execute-workflow/${workflowId}/stream`
  )
  
  useEffect(() => {
    if (executionEvents) {
      setExecutionState(prev => ({
        ...prev,
        ...executionEvents
      }))
    }
  }, [executionEvents])
  
  return (
    <div className="execution-monitor">
      <ExecutionStatus status={executionState.status} />
      
      <NodeStatusGrid
        nodes={executionState.nodes}
        currentNode={executionState.currentNode}
      />
      
      <ExecutionLogs
        logs={executionState.logs}
        autoScroll={true}
      />
      
      <OutputViewer
        outputs={executionState.outputs}
        format="json"
      />
    </div>
  )
}
```

**Client-Side Justification**:
- **Real-time Updates**: Server-Sent Events require client-side event handling
- **Dynamic UI Updates**: Status changes need immediate visual feedback
- **Interactive Logs**: User can scroll, filter, and search execution logs
- **State Persistence**: Execution state maintained during navigation

## 6.4 Shared Component Libraries

### 6.4.1 UI Component System (shadcn/ui + Radix UI)

One of the popular component libraries these days is shadcn/ui, which uses Tailwind primitive classes and creates ready-made components from them. Moreover, there is no need to install this library as a dependency in the project, but the code is dropped into the components directory, so we have access to the source code. The shadcn/ui components come with basic styling, making them easily configurable for application design.

**Component Architecture**:
```
/components/ui/
├── button.tsx           # Base button component
├── input.tsx            # Form input component
├── table.tsx            # Data table component
├── dialog.tsx           # Modal dialog component
├── select.tsx           # Dropdown select component
├── tabs.tsx             # Tab navigation component
├── card.tsx             # Content card component
├── badge.tsx            # Status badge component
├── skeleton.tsx         # Loading skeleton component
└── toast.tsx            # Notification toast component
```

**Design System Integration**:
- **Consistent Theming**: CSS custom properties for color schemes
- **Accessibility**: WAI-ARIA compliant components from Radix UI
- **Customization**: TailwindCSS utility classes for rapid styling
- **Type Safety**: Full TypeScript support with proper prop interfaces

### 6.4.2 Business Logic Components

**Component Organization**:
```
/components/
├── market-screener-tanstack/     # Market filtering and display
├── whale-activity-interface/     # Whale tracking components
├── workflow-editor/              # Strategy building components
├── portfolio-tracker-interface/  # Portfolio analytics components
├── intelligence-signals/         # AI signals and insights
└── trading-interface/            # Manual trading components
```

**Reusability Strategy**:
- **Composition over Inheritance**: Small, focused components that compose together
- **Props Interface Design**: Flexible props that support multiple use cases
- **Context Providers**: Shared state management for related component groups
- **Custom Hooks**: Reusable business logic extracted into hooks

### 6.4.3 Data Visualization Components

**Chart Component Architecture**:
```typescript
// Shared chart wrapper component
export function ChartContainer({
  data,
  type,
  config,
  loading = false
}: ChartContainerProps) {
  if (loading) {
    return <ChartSkeleton />
  }
  
  switch (type) {
    case 'ohlc':
      return <OHLCChart data={data} config={config} />
    case 'line':
      return <LineChart data={data} config={config} />
    case 'bar':
      return <BarChart data={data} config={config} />
    default:
      return <div>Unsupported chart type</div>
  }
}
```

**Chart Library Integration**:
- **ECharts**: High-performance OHLC charts for market data
- **Recharts**: React-native charts for simple visualizations
- **Custom Components**: Specialized charts for whale activity and portfolio metrics
- **Responsive Design**: Charts adapt to container size and device capabilities

## 6.5 Component Communication Patterns

### 6.5.1 Server-to-Client Data Flow

The rendering work is split into chunks, by individual route segments (layouts and pages): Server Components are rendered into a special data format called the React Server Component Payload (RSC Payload). The RSC Payload is a compact binary representation of the rendered React Server Components tree.

**Data Flow Architecture**:
```mermaid
sequenceDiagram
    participant Server as Server Components
    participant RSC as RSC Payload
    participant Client as Client Components
    participant State as Client State
    
    Server->>RSC: Render to RSC Payload
    RSC->>Client: Stream to client
    Client->>State: Hydrate with data
    State->>Client: Update UI
    Client->>Server: User interactions
```

**Implementation Pattern**:
```typescript
// Server Component - Data preparation
export default async function MarketDataProvider({
  children
}: {
  children: React.ReactNode
}) {
  const markets = await fetchMarkets()
  const whaleData = await fetchWhaleIntelligence()
  
  return (
    <MarketDataContext.Provider value={{ markets, whaleData }}>
      {children}
    </MarketDataContext.Provider>
  )
}

// Client Component - Data consumption
'use client'
export function MarketScreener() {
  const { markets, whaleData } = useMarketData()
  const [filters, setFilters] = useState({})
  
  const filteredMarkets = useMemo(() => 
    applyFilters(markets, filters), [markets, filters]
  )
  
  return <MarketTable data={filteredMarkets} />
}
```

### 6.5.2 Client-to-Server Communication

**API Route Integration**:
```typescript
// Client Component - API calls
'use client'
export function WorkflowExecutor({ workflowId }: { workflowId: string }) {
  const [isExecuting, setIsExecuting] = useState(false)
  
  const executeWorkflow = async () => {
    setIsExecuting(true)
    
    try {
      const response = await fetch('/api/execute-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId })
      })
      
      if (!response.ok) throw new Error('Execution failed')
      
      // Handle streaming response
      const reader = response.body?.getReader()
      // Process streaming execution updates...
      
    } catch (error) {
      console.error('Workflow execution failed:', error)
    } finally {
      setIsExecuting(false)
    }
  }
  
  return (
    <Button onClick={executeWorkflow} disabled={isExecuting}>
      {isExecuting ? 'Executing...' : 'Run Workflow'}
    </Button>
  )
}
```

### 6.5.3 Component State Management

**State Management Strategy**:

| State Type | Management Approach | Components | Justification |
|---|---|---|---|
| **Server State** | TanStack Query | Market data, whale intelligence | Caching, background updates, error handling |
| **UI State** | React Context | Theme, modals, notifications | Shared across component tree |
| **Form State** | React Hook Form | Workflow configuration, filters | Performance, validation |
| **URL State** | Next.js router | Pagination, filters | Shareable URLs, browser history |

**Context Provider Architecture**:
```typescript
// Theme context for UI state
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('dark')
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// Market data context for server state
export const MarketDataProvider = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient()
  
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
```

## 6.6 Component Performance Optimization

### 6.6.1 Server Component Optimization

**Bundle Size Reduction**:
Server Components run only on the server and have zero impact on bundle-size. Their code is never downloaded to clients, helping to reduce bundle sizes and improve startup time.

**Optimization Strategies**:
- **Heavy Computation on Server**: Financial calculations, AI processing, data transformations
- **Library Exclusion**: Database drivers, AI SDKs, heavy utilities stay on server
- **Static Rendering**: Pre-render components at build time when possible
- **Streaming**: Progressive rendering of components as data becomes available

### 6.6.2 Client Component Optimization

**Code Splitting Strategy**:
```typescript
// Dynamic imports for heavy components
const WorkflowCanvas = dynamic(
  () => import('@/components/workflow-editor/WorkflowCanvas'),
  { 
    ssr: false,
    loading: () => <WorkflowCanvasSkeleton />
  }
)

const MarketChart = dynamic(
  () => import('@/components/charts/MarketChart'),
  {
    ssr: false,
    loading: () => <ChartSkeleton />
  }
)
```

**Performance Patterns**:
- **React.memo**: Prevent unnecessary re-renders of expensive components
- **useMemo**: Cache expensive calculations
- **useCallback**: Stabilize function references
- **Virtual Scrolling**: Handle large datasets efficiently

### 6.6.3 Caching and State Optimization

**React Query Configuration**:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes for market data
      cacheTime: 10 * 60 * 1000, // 10 minutes cache retention
      refetchOnWindowFocus: true,
      retry: 2
    }
  }
})
```

**Optimization Benefits**:
- **Request Deduplication**: Multiple components requesting same data result in single API call
- **Background Refetching**: Automatic data freshness without user intervention
- **Optimistic Updates**: Immediate UI feedback with automatic rollback on errors
- **Intelligent Caching**: Stale-while-revalidate pattern for optimal user experience

## 6.7 Component Testing Strategy

### 6.7.1 Server Component Testing

**Testing Approach**:
```typescript
// Server component test
import { render } from '@testing-library/react'
import MarketIntelligenceEngine from '@/components/MarketIntelligenceEngine'

// Mock server-side dependencies
jest.mock('@/lib/polymarket/client')
jest.mock('@/lib/database')

describe('MarketIntelligenceEngine', () => {
  it('renders market data correctly', async () => {
    const mockMarkets = [
      { id: '1', title: 'Test Market', volume: 10000 }
    ]
    
    jest.mocked(fetchMarketsFromDB).mockResolvedValue(mockMarkets)
    
    const { getByText } = render(
      await MarketIntelligenceEngine({ filters: {}, timeframe: '24h' })
    )
    
    expect(getByText('Test Market')).toBeInTheDocument()
  })
})
```

### 6.7.2 Client Component Testing

**Testing Approach**:
```typescript
// Client component test
import { render, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MarketScreenerInterface from '@/components/MarketScreenerInterface'

describe('MarketScreenerInterface', () => {
  it('filters markets when filter is applied', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    
    const { getByLabelText, getByText } = render(
      <QueryClientProvider client={queryClient}>
        <MarketScreenerInterface />
      </QueryClientProvider>
    )
    
    const categoryFilter = getByLabelText('Category')
    fireEvent.change(categoryFilter, { target: { value: 'Politics' } })
    
    await waitFor(() => {
      expect(getByText('Politics markets')).toBeInTheDocument()
    })
  })
})
```

### 6.7.3 Integration Testing

**End-to-End Component Flow**:
```typescript
// Integration test for workflow execution
describe('Workflow Execution Flow', () => {
  it('executes workflow from canvas to completion', async () => {
    // 1. Render workflow canvas
    const { getByTestId } = render(<WorkflowCanvasEditor />)
    
    // 2. Add nodes to workflow
    const startNode = getByTestId('start-node')
    fireEvent.click(startNode)
    
    // 3. Execute workflow
    const executeButton = getByTestId('execute-workflow')
    fireEvent.click(executeButton)
    
    // 4. Verify execution monitor updates
    await waitFor(() => {
      expect(getByTestId('execution-status')).toHaveTextContent('running')
    })
    
    // 5. Verify completion
    await waitFor(() => {
      expect(getByTestId('execution-status')).toHaveTextContent('completed')
    }, { timeout: 10000 })
  })
})
```

This comprehensive system components design ensures optimal performance, maintainability, and user experience by strategically leveraging Next.js 15's React Server Components architecture while maintaining clear separation of concerns between server and client execution environments.

## 6.1 Core Services Architecture

#### Core Services Architecture is not applicable for this system

Based on the comprehensive analysis of CASCADIAN's technical architecture, **Core Services Architecture is not applicable for this system**. Here's why:

#### Architecture Classification

CASCADIAN employs a **serverless-first monolithic architecture** rather than a distributed microservices architecture. The system is built as a unified Next.js application that leverages Vercel's serverless infrastructure for automatic scaling and deployment.

#### Architectural Rationale

| Aspect | CASCADIAN's Approach | Microservices Alternative |
|---|---|---|
| **Service Boundaries** | Single Next.js application with API routes | Multiple independent services |
| **Deployment Model** | Serverless functions that scale automatically | Container orchestration |
| **Communication** | Internal function calls and database queries | Inter-service API communication |
| **Data Management** | Shared Supabase PostgreSQL database | Service-specific databases |

#### Why Serverless Monolith Over Microservices

**1. Application Characteristics**
- **Prediction market intelligence platform** with tightly coupled data flows
- **Real-time data synchronization** requiring consistent state across features
- **Workflow execution engine** that benefits from shared context and resources

**2. Team and Scale Considerations**
- **Single development team** building cohesive product experience
- **Early-stage product** (Phase 1-2) where microservices complexity outweighs benefits
- **Rapid iteration requirements** favor simplified deployment and debugging

**3. Technical Benefits of Current Architecture**

Vercel Functions now have improved automatic concurrency scaling, with up to 30,000 functions running simultaneously for Pro and 100,000 for Enterprise with the option for extended concurrency. This ensures your project can automatically scale even during the highest bursts of traffic.

You don't need to worry about server failures or downtime, as functions scale and failover automatically across availability zones (and even regions). Further, features like Instant Rollback and Skew Protection provide more ways to ensure your site is always online.

#### Alternative Architecture: Serverless Scaling Patterns

Instead of traditional microservices, CASCADIAN implements **serverless scaling patterns** that provide similar benefits:

#### Functional Service Boundaries

```mermaid
graph TB
    subgraph "Next.js Application (Single Deployment)"
        subgraph "API Routes (Serverless Functions)"
            A[Market Intelligence APIs]
            B[Whale Tracking APIs]
            C[Workflow Execution APIs]
            D[Portfolio Analytics APIs]
            E[AI Integration APIs]
        end
        
        subgraph "Frontend Components"
            F[Market Screener]
            G[Strategy Builder]
            H[Portfolio Tracker]
            I[Whale Dashboard]
        end
        
        subgraph "Shared Services"
            J[Database Layer]
            K[Authentication]
            L[Caching Layer]
        end
    end
    
    subgraph "External Services"
        M[Polymarket APIs]
        N[AI Services]
        O[Supabase]
    end
    
    A --> J
    B --> J
    C --> J
    D --> J
    E --> N
    
    F --> A
    G --> C
    H --> D
    I --> B
    
    J --> O
    K --> O
    L --> O
    
    A --> M
    B --> M
    D --> M
```

#### Serverless Resilience Patterns

**1. Automatic Scaling and Load Distribution**

We always keep at least one function instance running. Instead of scaling to zero, we scale to one. This works automatically for qualifying deployments; there is nothing you need to configure or enable.

| Pattern | Implementation | Benefit |
|---|---|---|
| **Scale-to-One** | Always maintain warm instances | Eliminates cold start delays |
| **Burst Scaling** | Burst concurrency allows for a temporary increase in the concurrency limit to handle sudden traffic influxes. After the initial burst, Vercel continues to scale your function by a maximum of 500 concurrency per minute. | Handles traffic spikes |
| **Regional Failover** | Fluid automatically fails over across multiple availability zones within a region. For Enterprise customers, Fluid also has multi-region failover capabilities. | High availability |

**2. Resource Optimization Patterns**

Fluid, our new compute model, reduces total compute consumption by utilizing existing resources before scaling new ones. Instead of launching a new function for every request, it intelligently reuses available capacity, ensuring that compute isn't sitting idle.

```mermaid
sequenceDiagram
    participant Client
    participant Vercel Edge
    participant Function Pool
    participant Database
    
    Client->>Vercel Edge: Request
    Vercel Edge->>Function Pool: Route to available instance
    
    alt Warm Instance Available
        Function Pool->>Database: Execute query
        Database-->>Function Pool: Return data
        Function Pool-->>Client: Response (fast)
    else Scale New Instance
        Function Pool->>Function Pool: Provision new instance
        Function Pool->>Database: Execute query
        Database-->>Function Pool: Return data
        Function Pool-->>Client: Response (slower)
    end
```

#### Performance and Reliability Architecture

**1. Multi-Layer Resilience**

| Layer | Resilience Mechanism | Recovery Time |
|---|---|---|
| **Edge Network** | Automatic failover and DDoS protection | < 1 second |
| **Function Runtime** | Automatic retry with exponential backoff | 2-8 seconds |
| **Database Layer** | Supabase managed failover | < 30 seconds |
| **External APIs** | Graceful degradation to cached data | Immediate |

**2. Monitoring and Observability**

Serverless Functions now support increased log lengths, enabling better observability into your application when investigating function logs. Previously, there was a 4KB log limit per function invocation, which could lead to truncated logs when debugging. With this change, it's now easier to debug errors that include large stack traces.

```mermaid
graph LR
    subgraph "Observability Stack"
        A[Vercel Analytics]
        B[Function Logs]
        C[Performance Metrics]
        D[Error Tracking]
    end
    
    subgraph "Application Monitoring"
        E[API Response Times]
        F[Database Query Performance]
        G[External API Health]
        H[User Experience Metrics]
    end
    
    A --> E
    B --> F
    C --> G
    D --> H
```

#### Future Scaling Considerations

**When Microservices Might Become Relevant:**

| Trigger | Threshold | Architectural Response |
|---|---|---|
| **Team Growth** | 15+ developers | Consider domain-based service separation |
| **Data Volume** | 100M+ API calls/month | Evaluate specialized data services |
| **Feature Complexity** | Independent release cycles needed | Extract specific domains |
| **Performance Requirements** | Sub-10ms response times | Consider edge computing services |

**Migration Path (Future Phase 4-5):**
1. **Extract AI Services** - Move LLM processing to dedicated inference services
2. **Separate Data Pipeline** - Create dedicated ETL services for market data
3. **API Gateway Pattern** - Implement service mesh for inter-service communication
4. **Event-Driven Architecture** - Add message queues for asynchronous processing

#### Conclusion

CASCADIAN's serverless-first architecture provides the scalability, resilience, and performance benefits typically associated with microservices while maintaining the simplicity and rapid development velocity of a monolithic application. This all means that serverless offers a tighter alignment between cost and revenue-generating events. While other factors can influence costs (like background tasks or surge traffic), serverless gives you better visibility into how your infrastructure spend relates to customer value.

The current architecture is optimally suited for the platform's requirements and growth stage, with clear migration paths available when the complexity and scale justify transitioning to a distributed microservices architecture.

## 6.2 Database Design

### 6.2.1 Schema Design Overview

CASCADIAN employs a **PostgreSQL 15+ database** hosted on Supabase, designed specifically for prediction market intelligence and real-time trading analytics. The schema follows a **hybrid normalized-denormalized approach** optimized for both data integrity and query performance.

#### Core Design Principles

| Principle | Implementation | Rationale |
|---|---|---|
| **Selective Normalization** | Normalization is a fundamental concept in database design. It involves organizing your data to minimize redundancy and improve data integrity. While a fully normalized database can ensure data consistency, sometimes denormalization may be necessary for performance reasons, such as reducing the number of joins in a query. | Balance data integrity with query performance |
| **Strategic Indexing** | Frequent Filtering: Use indexes on columns frequently appearing in WHERE conditions to speed up lookups. Join Operations: Index foreign key columns to improve JOIN performance between large tables. | Optimize for prediction market query patterns |
| **Row-Level Security** | Use Row-Level Security (RLS) to secure your data at the row level, ensuring that only the users who have the required permissions can access the data. | Secure multi-tenant data access |
| **Real-Time Capabilities** | Supabase makes it simple to add real-time functionality — but broadcasting every table change is not always ideal. Enable real-time only on necessary tables. | Selective real-time updates for performance |

#### Entity Relationship Diagram

```mermaid
erDiagram
    MARKETS {
        text market_id PK
        text title
        text description
        text category
        text[] tags
        jsonb outcomes
        numeric[] prices
        numeric volume_24h
        numeric liquidity
        boolean active
        boolean closed
        timestamptz end_date
        timestamptz created_at
        timestamptz updated_at
        jsonb raw_polymarket_data
    }
    
    MARKET_ANALYTICS {
        text market_id PK
        integer trades_24h
        integer buyers_24h
        integer sellers_24h
        numeric buy_volume_24h
        numeric sell_volume_24h
        numeric buy_sell_ratio
        numeric momentum_score
        numeric price_change_24h
        timestamptz calculated_at
    }
    
    WALLETS {
        text address PK
        text wallet_alias
        boolean is_whale
        numeric whale_score
        numeric smart_money_score
        numeric reputation_score
        integer total_trades
        numeric total_volume
        numeric win_rate
        numeric sharpe_ratio
        timestamptz first_trade_at
        timestamptz last_trade_at
        timestamptz created_at
        timestamptz updated_at
    }
    
    WALLET_POSITIONS {
        uuid id PK
        text wallet_address FK
        text market_id FK
        text outcome
        numeric shares
        numeric entry_price
        numeric current_price
        numeric unrealized_pnl
        timestamptz position_opened_at
        timestamptz updated_at
    }
    
    WALLET_TRADES {
        uuid id PK
        text wallet_address FK
        text market_id FK
        text outcome
        text side
        numeric amount
        numeric price
        numeric fee
        text transaction_hash
        timestamptz timestamp
        timestamptz created_at
    }
    
    WORKFLOW_SESSIONS {
        uuid id PK
        uuid user_id FK
        text name
        text description
        jsonb nodes
        jsonb edges
        jsonb variables
        text trigger
        integer version
        text status
        text[] tags
        boolean is_template
        boolean is_favorite
        integer execution_count
        timestamptz last_executed_at
        timestamptz created_at
        timestamptz updated_at
    }
    
    WORKFLOW_EXECUTIONS {
        uuid id PK
        uuid workflow_id FK
        uuid user_id FK
        text status
        timestamptz execution_started_at
        timestamptz execution_completed_at
        integer duration_ms
        integer nodes_executed
        jsonb outputs
        jsonb errors
        timestamptz created_at
    }
    
    PRICES_1M {
        uuid id PK
        text market_id FK
        timestamptz timestamp
        numeric open
        numeric high
        numeric low
        numeric close
        numeric volume
        integer trades
    }
    
    USERS {
        uuid id PK
        text email
        text encrypted_password
        timestamptz email_confirmed_at
        timestamptz created_at
        timestamptz updated_at
    }
    
    USER_SETTINGS {
        uuid id PK
        uuid user_id FK
        jsonb preferences
        jsonb theme_config
        text[] notification_types
        timestamptz created_at
        timestamptz updated_at
    }

    %% Relationships
    MARKETS ||--|| MARKET_ANALYTICS : "has analytics"
    MARKETS ||--o{ WALLET_POSITIONS : "has positions"
    MARKETS ||--o{ WALLET_TRADES : "has trades"
    MARKETS ||--o{ PRICES_1M : "has price history"
    
    WALLETS ||--o{ WALLET_POSITIONS : "owns positions"
    WALLETS ||--o{ WALLET_TRADES : "makes trades"
    
    USERS ||--o{ WORKFLOW_SESSIONS : "creates workflows"
    USERS ||--|| USER_SETTINGS : "has settings"
    
    WORKFLOW_SESSIONS ||--o{ WORKFLOW_EXECUTIONS : "has executions"
```

### 6.2.2 Core Data Models

#### Markets Table Structure

The `markets` table serves as the foundation for all prediction market intelligence, storing enriched Polymarket data with additional analytics metadata.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `market_id` | text | PRIMARY KEY | Unique Polymarket identifier |
| `title` | text | NOT NULL | Market question/title |
| `category` | text | NOT NULL | Extracted category (Politics, Sports, etc.) |
| `volume_24h` | numeric | DEFAULT 0 | 24-hour trading volume in USDC |

**Key Design Decisions**:
- **JSONB Storage**: You must define the "data type" when you create a column. Every column is a predefined type. Postgres provides many default types, and you can even design your own (or use extensions) if the default types don't fit your needs. Raw Polymarket API responses stored as JSONB for flexibility
- **Denormalized Categories**: Categories extracted from tags and stored directly for fast filtering
- **Composite Pricing**: Outcomes and prices stored as arrays for multi-outcome markets

#### Wallet Intelligence Schema

The wallet-related tables implement a **star schema pattern** optimized for analytical queries on trading behavior and whale detection.

```sql
-- Wallet profiles with calculated intelligence scores
CREATE TABLE wallets (
    address text PRIMARY KEY,
    wallet_alias text,
    is_whale boolean DEFAULT false,
    whale_score numeric DEFAULT 0,
    smart_money_score numeric DEFAULT 0,
    reputation_score numeric DEFAULT 0,
    total_trades integer DEFAULT 0,
    total_volume numeric DEFAULT 0,
    win_rate numeric DEFAULT 0,
    sharpe_ratio numeric DEFAULT 0,
    first_trade_at timestamptz,
    last_trade_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Current positions (fact table)
CREATE TABLE wallet_positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address text REFERENCES wallets(address),
    market_id text REFERENCES markets(market_id),
    outcome text NOT NULL,
    shares numeric NOT NULL,
    entry_price numeric NOT NULL,
    current_price numeric NOT NULL,
    unrealized_pnl numeric GENERATED ALWAYS AS (
        shares * (current_price - entry_price)
    ) STORED,
    position_opened_at timestamptz NOT NULL,
    updated_at timestamptz DEFAULT now()
);
```

#### Workflow System Architecture

The workflow system uses a **document-oriented approach** within PostgreSQL, storing node graphs as JSONB for maximum flexibility while maintaining relational integrity.

| Table | Purpose | Key Features |
|---|---|---|
| `workflow_sessions` | Workflow definitions | JSONB nodes/edges, versioning |
| `workflow_executions` | Execution history | Performance tracking, error logs |
| `workflow_templates` | Reusable templates | Community sharing, ratings |

### 6.2.3 Indexing Strategy

#### Performance-Optimized Index Design

Indexes are a powerful tool for optimizing query performance in PostgreSQL, but they require careful planning and management. Understanding different index types, applying them strategically, and following best practices such as avoiding over-indexing and regularly maintaining indexes can significantly enhance database efficiency. To ensure optimal performance, monitor index usage, test query execution plans, and make adjustments as needed. With a well-structured indexing strategy, PostgreSQL databases can handle large workloads efficiently and deliver high-performance queries.

#### Primary Indexes (B-Tree)

```sql
-- Markets table indexes optimized for screener queries
CREATE INDEX idx_markets_active ON markets (active) WHERE active = true;
CREATE INDEX idx_markets_category_volume ON markets (category, volume_24h DESC) 
    WHERE active = true;
CREATE INDEX idx_markets_end_date ON markets (end_date ASC) 
    WHERE active = true AND end_date > now();

-- Wallet positions for portfolio analytics
CREATE INDEX idx_wallet_positions_address ON wallet_positions (wallet_address);
CREATE INDEX idx_wallet_positions_market ON wallet_positions (market_id);
CREATE INDEX idx_wallet_positions_composite ON wallet_positions 
    (wallet_address, market_id, outcome);

-- Wallet trades for performance analysis
CREATE INDEX idx_wallet_trades_address_timestamp ON wallet_trades 
    (wallet_address, timestamp DESC);
CREATE INDEX idx_wallet_trades_market_timestamp ON wallet_trades 
    (market_id, timestamp DESC);
```

#### Specialized Indexes

**Full-Text Search (GIN)**:
```sql
-- Market title and description search
CREATE INDEX idx_markets_title_search ON markets 
    USING gin(to_tsvector('english', title || ' ' || description));

-- Tag-based filtering
CREATE INDEX idx_markets_tags_gin ON markets USING gin(tags);
```

**JSONB Indexes (GIN)**:
```sql
-- Workflow node and edge queries
CREATE INDEX idx_workflow_nodes_gin ON workflow_sessions USING gin(nodes);
CREATE INDEX idx_workflow_edges_gin ON workflow_sessions USING gin(edges);

-- Raw Polymarket data queries
CREATE INDEX idx_markets_raw_data_gin ON markets 
    USING gin(raw_polymarket_data);
```

**Partial Indexes for Performance**:
A partial index covers just a subset of a table's data. It's an index with a WHERE clause. The idea is to increase the efficiency of the index by reducing its size. A smaller index takes less storage, is easier to maintain, and is faster to scan.

```sql
-- Only index active markets (reduces index size by ~50%)
CREATE INDEX idx_markets_active_volume ON markets (volume_24h DESC) 
    WHERE active = true;

-- Only index whale wallets for leaderboard queries
CREATE INDEX idx_wallets_whale_scores ON wallets 
    (whale_score DESC, smart_money_score DESC) 
    WHERE is_whale = true;
```

#### Index Performance Metrics

| Index Type | Use Case | Performance Gain | Maintenance Cost |
|---|---|---|---|
| **Partial B-Tree** | Active market filtering | 10x faster queries | Low |
| **Composite B-Tree** | Category + volume sorting | 5x faster queries | Medium |
| **GIN (JSONB)** | Workflow node queries | 20x faster queries | High |
| **GIN (Full-text)** | Market title search | 50x faster queries | Medium |

### 6.2.4 Partitioning Strategy

#### Time-Series Data Partitioning

For high-volume time-series data like price history and trade records, CASCADIAN implements **range partitioning by timestamp**:

```sql
-- Partitioned price history table
CREATE TABLE prices_1m (
    id uuid DEFAULT gen_random_uuid(),
    market_id text NOT NULL,
    timestamp timestamptz NOT NULL,
    open numeric NOT NULL,
    high numeric NOT NULL,
    low numeric NOT NULL,
    close numeric NOT NULL,
    volume numeric NOT NULL,
    trades integer NOT NULL
) PARTITION BY RANGE (timestamp);

-- Monthly partitions for price data
CREATE TABLE prices_1m_2025_01 PARTITION OF prices_1m
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE prices_1m_2025_02 PARTITION OF prices_1m
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- ... additional monthly partitions
```

**Partitioning Benefits**:
- **Query Performance**: Indexing strategies should consider how data in partitioned tables is accessed. For example, if older partitions (e.g., in a time-based partitioning setup) are rarely accessed, it might not be worth maintaining certain indexes.
- **Maintenance Efficiency**: Old partitions can be dropped without affecting current data
- **Parallel Processing**: Queries can execute across multiple partitions simultaneously

### 6.2.5 Replication Configuration

#### Supabase Managed Replication

CASCADIAN leverages Supabase's managed PostgreSQL infrastructure with built-in replication capabilities:

```mermaid
graph TB
    subgraph "Supabase Infrastructure"
        PRIMARY[Primary Database<br/>Write Operations]
        REPLICA1[Read Replica 1<br/>Analytics Queries]
        REPLICA2[Read Replica 2<br/>Reporting]
        
        PRIMARY --> REPLICA1
        PRIMARY --> REPLICA2
    end
    
    subgraph "Application Layer"
        WRITE_OPS[Write Operations<br/>Market Sync, User Data]
        READ_OPS[Read Operations<br/>Screener, Analytics]
        HEAVY_QUERIES[Heavy Analytics<br/>Whale Calculations]
    end
    
    WRITE_OPS --> PRIMARY
    READ_OPS --> REPLICA1
    HEAVY_QUERIES --> REPLICA2
```

#### Real-Time Replication Features

Supabase makes it simple to add real-time functionality — but broadcasting every table change is not always ideal. Enable real-time only on necessary tables. Disable UPDATE and DELETE events if you only need INSERT notifications.

**Selective Real-Time Tables**:
```sql
-- Enable real-time for market price updates
ALTER PUBLICATION supabase_realtime ADD TABLE markets;

-- Enable real-time for workflow execution status
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_executions;

-- Disable real-time for historical data (performance optimization)
-- wallet_trades, prices_1m tables excluded from real-time
```

### 6.2.6 Backup Architecture

#### Automated Backup Strategy

Supabase provides **continuous backup** with point-in-time recovery capabilities:

| Backup Type | Frequency | Retention | Recovery Time |
|---|---|---|---|
| **Continuous WAL** | Real-time | 7 days | < 1 minute |
| **Daily Snapshots** | 24 hours | 30 days | < 5 minutes |
| **Weekly Archives** | 7 days | 90 days | < 30 minutes |

#### Disaster Recovery Procedures

```mermaid
flowchart TD
    INCIDENT[Database Incident<br/>Detected]
    
    ASSESS{Assess Severity}
    
    MINOR[Minor Issue<br/>< 5 min downtime]
    MAJOR[Major Issue<br/>> 5 min downtime]
    CRITICAL[Critical Failure<br/>Data Loss Risk]
    
    AUTO_FAILOVER[Automatic Failover<br/>to Read Replica]
    MANUAL_RESTORE[Manual Point-in-Time<br/>Recovery]
    FULL_RESTORE[Full Database<br/>Restoration]
    
    VERIFY[Verify Data Integrity<br/>& Application Health]
    MONITOR[Enhanced Monitoring<br/>24-48 hours]
    
    INCIDENT --> ASSESS
    
    ASSESS --> MINOR
    ASSESS --> MAJOR
    ASSESS --> CRITICAL
    
    MINOR --> AUTO_FAILOVER
    MAJOR --> MANUAL_RESTORE
    CRITICAL --> FULL_RESTORE
    
    AUTO_FAILOVER --> VERIFY
    MANUAL_RESTORE --> VERIFY
    FULL_RESTORE --> VERIFY
    
    VERIFY --> MONITOR
```

### 6.2.7 Data Management Procedures

#### Migration Strategy

CASCADIAN uses **Supabase CLI** for database schema management with version-controlled migrations:

```sql
-- Migration: 20250123_001_add_market_analytics.sql
CREATE TABLE market_analytics (
    market_id text PRIMARY KEY REFERENCES markets(market_id),
    trades_24h integer DEFAULT 0,
    buyers_24h integer DEFAULT 0,
    sellers_24h integer DEFAULT 0,
    buy_volume_24h numeric DEFAULT 0,
    sell_volume_24h numeric DEFAULT 0,
    buy_sell_ratio numeric GENERATED ALWAYS AS (
        CASE 
            WHEN sell_volume_24h > 0 THEN buy_volume_24h / sell_volume_24h
            ELSE 0
        END
    ) STORED,
    momentum_score numeric DEFAULT 0,
    price_change_24h numeric DEFAULT 0,
    calculated_at timestamptz DEFAULT now()
);

-- Create indexes for analytics queries
CREATE INDEX idx_market_analytics_momentum ON market_analytics 
    (momentum_score DESC) WHERE momentum_score > 0;
```

#### Data Versioning & Schema Evolution

| Migration Type | Approach | Downtime | Risk Level |
|---|---|---|---|
| **Additive Changes** | Online schema changes | Zero | Low |
| **Column Modifications** | Staged deployment | < 30 seconds | Medium |
| **Table Restructuring** | Blue-green deployment | < 5 minutes | High |

#### Archival Policies

**Data Retention Rules**:
```sql
-- Archive old price data (> 1 year) to separate tables
CREATE TABLE prices_1m_archive (LIKE prices_1m);

-- Automated archival procedure
CREATE OR REPLACE FUNCTION archive_old_prices()
RETURNS void AS $$
BEGIN
    -- Move data older than 1 year to archive
    WITH archived_data AS (
        DELETE FROM prices_1m 
        WHERE timestamp < now() - interval '1 year'
        RETURNING *
    )
    INSERT INTO prices_1m_archive SELECT * FROM archived_data;
END;
$$ LANGUAGE plpgsql;

-- Schedule monthly archival
SELECT cron.schedule('archive-prices', '0 0 1 * *', 'SELECT archive_old_prices();');
```

### 6.2.8 Compliance & Security

#### Row-Level Security Implementation

Use Row-Level Security (RLS) to secure your data at the row level, ensuring that only the users who have the required permissions can access the data.

```sql
-- Enable RLS on user-specific tables
ALTER TABLE workflow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only access their own workflows
CREATE POLICY "Users can manage own workflows" ON workflow_sessions
    FOR ALL USING (auth.uid() = user_id);

-- Users can view their own execution history
CREATE POLICY "Users can view own executions" ON workflow_executions
    FOR SELECT USING (auth.uid() = user_id);

-- Public read access for market data
CREATE POLICY "Anyone can read markets" ON markets
    FOR SELECT TO anon, authenticated USING (true);

-- Only service role can write market data
CREATE POLICY "Service role can write markets" ON markets
    FOR ALL TO service_role USING (true);
```

#### Data Privacy Controls

**Sensitive Data Handling**:
But let's say sensitive information is stored in a public schema's table, something like encrypted third party refresh/access tokens or the like. For example, let's just say a table called public.tokens. With an RLS policy, I can make it so a user can only access their own tokens; that makes sense.

```sql
-- Separate schema for sensitive data
CREATE SCHEMA private;

-- API keys and sensitive settings in private schema
CREATE TABLE private.user_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    service_name text NOT NULL,
    encrypted_key text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Strict RLS on private schema
ALTER TABLE private.user_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own API keys" ON private.user_api_keys
    FOR ALL USING (auth.uid() = user_id);
```

#### Audit Mechanisms

```sql
-- Audit log table for sensitive operations
CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,
    action text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamptz DEFAULT now()
);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_logs (
        user_id, action, table_name, record_id, 
        old_values, new_values, ip_address
    ) VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::text, OLD.id::text),
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        inet_client_addr()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

### 6.2.9 Performance Optimization

#### Query Optimization Patterns

**Materialized Views for Heavy Analytics**:
```sql
-- Pre-calculated whale leaderboard
CREATE MATERIALIZED VIEW whale_leaderboard AS
SELECT 
    address,
    wallet_alias,
    whale_score,
    smart_money_score,
    win_rate,
    total_volume,
    ROW_NUMBER() OVER (ORDER BY whale_score DESC) as rank
FROM wallets 
WHERE is_whale = true
ORDER BY whale_score DESC
LIMIT 100;

-- Refresh leaderboard hourly
SELECT cron.schedule('refresh-leaderboard', '0 * * * *', 
    'REFRESH MATERIALIZED VIEW whale_leaderboard;');
```

#### Connection Pooling Configuration

Use connection pooling to avoid hitting max clients (Supabase does this for you if hosted).

Supabase provides **PgBouncer connection pooling** with optimized settings:

| Pool Mode | Max Connections | Use Case |
|---|---|---|
| **Transaction** | 25 per database | API routes, short queries |
| **Session** | 5 per database | Long-running analytics |
| **Statement** | 50 per database | High-concurrency reads |

#### Batch Processing Optimization

```sql
-- Efficient batch UPSERT for market sync
INSERT INTO markets (market_id, title, category, volume_24h, active, updated_at)
SELECT 
    data->>'market_id',
    data->>'title',
    data->>'category',
    (data->>'volume_24h')::numeric,
    (data->>'active')::boolean,
    now()
FROM unnest($1::jsonb[]) AS data
ON CONFLICT (market_id) DO UPDATE SET
    title = EXCLUDED.title,
    category = EXCLUDED.category,
    volume_24h = EXCLUDED.volume_24h,
    active = EXCLUDED.active,
    updated_at = EXCLUDED.updated_at;
```

#### Database Maintenance Procedures

Routine maintenance tasks, like VACUUM and ANALYZE, play a crucial role in optimizing indexes in a PostgreSQL database, so with best practices, you can get serious results. The ANALYZE operation deserves special attention. When you run ANALYZE, the system examines the tables and updates the statistics related to the distribution of values within the tables. These statistics are vital because the query planner relies on them to devise the most efficient strategy to execute a query, which often includes deciding whether to use an index. Implementing a regular routine for these maintenance tasks (e.g., weekly) can be highly beneficial. Such a schedule ensures that the database is rid of dead rows—obsolete data no longer accessible due to updates or deletions—and has up-to-date statistics.

```sql
-- Automated maintenance procedures
CREATE OR REPLACE FUNCTION weekly_maintenance()
RETURNS void AS $$
BEGIN
    -- Update table statistics
    ANALYZE markets;
    ANALYZE wallets;
    ANALYZE wallet_positions;
    ANALYZE wallet_trades;
    
    -- Vacuum tables with high update frequency
    VACUUM (ANALYZE, VERBOSE) markets;
    VACUUM (ANALYZE, VERBOSE) wallet_positions;
    
    -- Reindex fragmented indexes if needed
    REINDEX INDEX CONCURRENTLY idx_markets_category_volume;
    REINDEX INDEX CONCURRENTLY idx_wallet_positions_composite;
END;
$$ LANGUAGE plpgsql;

-- Schedule weekly maintenance
SELECT cron.schedule('weekly-maintenance', '0 2 * * 0', 
    'SELECT weekly_maintenance();');
```

This comprehensive database design provides CASCADIAN with a robust, scalable, and secure foundation for prediction market intelligence, optimized for both real-time operations and analytical workloads while maintaining strict data privacy and compliance requirements.

## 6.3 Integration Architecture

### 6.3.1 Integration Architecture Overview

CASCADIAN implements a **comprehensive integration architecture** that orchestrates data flow between multiple external systems, real-time streaming services, and internal processing engines. The platform serves as an intelligent middleware layer that transforms raw prediction market data into actionable trading intelligence.

#### Integration Strategy

The integration architecture follows a **hub-and-spoke pattern** with CASCADIAN as the central intelligence hub, connecting to:

- **External Data Sources**: Polymarket APIs for market data, positions, and trading activity
- **AI Services**: Multiple LLM providers for market analysis and strategy generation  
- **Real-time Systems**: Supabase for live data subscriptions and streaming updates
- **Client Applications**: Next.js frontend and future mobile applications

```mermaid
graph TB
    subgraph "External Data Sources"
        PM_GAMMA[Polymarket Gamma API<br/>Markets & Events]
        PM_CLOB[Polymarket CLOB API<br/>Order Books & Trades]
        PM_DATA[Polymarket Data API<br/>Wallets & Positions]
    end
    
    subgraph "AI Service Providers"
        OPENAI[OpenAI GPT-4<br/>Market Analysis]
        CLAUDE[Anthropic Claude<br/>Strategy Copilot]
        GEMINI[Google Gemini<br/>Multimodal AI]
    end
    
    subgraph "CASCADIAN Integration Hub"
        API_LAYER[Next.js API Routes<br/>Integration Layer]
        SYNC_ENGINE[Background Sync<br/>Engine]
        WORKFLOW_ENGINE[Workflow Execution<br/>Engine]
        STREAM_PROCESSOR[Real-time Stream<br/>Processor]
    end
    
    subgraph "Data Persistence"
        SUPABASE[Supabase PostgreSQL<br/>Real-time Database]
        CACHE[TanStack Query<br/>Client Cache]
    end
    
    subgraph "Client Applications"
        FRONTEND[Next.js Frontend<br/>React Components]
        MOBILE[Future Mobile Apps<br/>React Native]
    end
    
    PM_GAMMA --> API_LAYER
    PM_CLOB --> API_LAYER
    PM_DATA --> API_LAYER
    
    OPENAI --> WORKFLOW_ENGINE
    CLAUDE --> WORKFLOW_ENGINE
    GEMINI --> WORKFLOW_ENGINE
    
    API_LAYER --> SYNC_ENGINE
    API_LAYER --> WORKFLOW_ENGINE
    API_LAYER --> STREAM_PROCESSOR
    
    SYNC_ENGINE --> SUPABASE
    WORKFLOW_ENGINE --> SUPABASE
    STREAM_PROCESSOR --> SUPABASE
    
    SUPABASE --> CACHE
    CACHE --> FRONTEND
    FRONTEND --> MOBILE
```

### 6.3.2 API Design

#### Protocol Specifications

**Primary Protocol**: HTTP/HTTPS RESTful APIs with Next.js API routes that are server-side only bundles and won't increase client-side bundle size

**Secondary Protocol**: Server-Sent Events (SSE) for real-time streaming using text/event-stream MIME type with messages separated by newline pairs

**Tertiary Protocol**: Supabase real-time subscriptions using WebSocket connections for database change notifications

#### API Endpoint Architecture

| Endpoint Category | Protocol | Content Type | Use Case |
|---|---|---|---|
| **Market Data** | HTTP REST | application/json | Market discovery, filtering, details |
| **Workflow Execution** | HTTP + SSE | text/event-stream | Real-time strategy execution |
| **Real-time Updates** | WebSocket | application/json | Live data subscriptions |
| **AI Integration** | HTTP REST | application/json | LLM analysis requests |

#### Request/Response Patterns

**Standard REST Response Format**:
```typescript
interface APIResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  metadata?: {
    total?: number
    page?: number
    limit?: number
    stale?: boolean
    last_synced?: string
  }
}
```

**Streaming Response Format** (SSE):
```typescript
// Server-Sent Event format
data: {"type":"node_status","nodeId":"stream-markets","status":"running","timestamp":1640995200000}

data: {"type":"node_output","nodeId":"stream-markets","status":"success","output":[...],"timestamp":1640995200000}

data: {"type":"execution_complete","workflowId":"uuid","duration":5000,"timestamp":1640995200000}
```

#### Authentication Methods

**Primary Authentication**: Supabase JWT tokens with Row-Level Security policies requiring authentication for private channels

**Authentication Flow**:
```mermaid
sequenceDiagram
    participant Client
    participant Supabase Auth
    participant API Routes
    participant Database
    
    Client->>Supabase Auth: Sign in with email/password
    Supabase Auth-->>Client: JWT access token + refresh token
    Client->>API Routes: Request with Authorization header
    API Routes->>Supabase Auth: Validate JWT token
    Supabase Auth-->>API Routes: User context + permissions
    API Routes->>Database: Query with RLS policies
    Database-->>API Routes: Filtered data based on user
    API Routes-->>Client: JSON response
```

**Token Management**:
- **Access Token**: Short-lived (1 hour) JWT for API requests
- **Refresh Token**: Long-lived (30 days) for automatic token renewal
- **Session Management**: Automatic refresh before expiration
- **Security**: httpOnly cookies for token storage (future enhancement)

#### Authorization Framework

**Row-Level Security (RLS) Policies**:
```sql
-- Users can only access their own workflows
CREATE POLICY "Users can manage own workflows" ON workflow_sessions
    FOR ALL USING (auth.uid() = user_id);

-- Public read access for market data
CREATE POLICY "Anyone can read markets" ON markets
    FOR SELECT TO anon, authenticated USING (true);

-- Service role can write market data
CREATE POLICY "Service role can write markets" ON markets
    FOR ALL TO service_role USING (true);
```

**Authorization Levels**:

| Resource Type | Access Level | Policy |
|---|---|---|
| **Market Data** | Public Read | All authenticated users |
| **User Workflows** | Private | Owner only (RLS) |
| **Execution History** | Private | Owner only (RLS) |
| **Admin Operations** | Restricted | Service role only |

#### Rate Limiting Strategy

**Multi-Layer Rate Limiting**:

```mermaid
flowchart TD
    REQUEST[Incoming Request]
    
    VERCEL_LIMIT{Vercel Function<br/>Rate Limit}
    CUSTOM_LIMIT{Custom Rate<br/>Limiting}
    EXTERNAL_LIMIT{External API<br/>Rate Limits}
    
    QUEUE[Request Queue<br/>with Backoff]
    EXECUTE[Execute Request]
    CACHE[Return Cached<br/>Response]
    
    REQUEST --> VERCEL_LIMIT
    VERCEL_LIMIT -->|Exceeded| CACHE
    VERCEL_LIMIT -->|OK| CUSTOM_LIMIT
    CUSTOM_LIMIT -->|Exceeded| QUEUE
    CUSTOM_LIMIT -->|OK| EXTERNAL_LIMIT
    EXTERNAL_LIMIT -->|Exceeded| QUEUE
    EXTERNAL_LIMIT -->|OK| EXECUTE
    
    QUEUE --> EXECUTE
```

**Rate Limit Configuration**:

| Service | Limit | Window | Strategy |
|---|---|---|---|
| **Vercel Functions** | 1000 req/min | Per function | Built-in |
| **Polymarket APIs** | 100 req/min | Per API key | Exponential backoff |
| **OpenAI API** | 3000 req/min | Per API key | Queue with retry |
| **User Requests** | 60 req/min | Per user | Future: Redis-based |

#### Versioning Approach

**API Versioning Strategy**: Path-based versioning for future API evolution

```typescript
// Current API structure (v1 implicit)
/api/polymarket/markets
/api/whale/positions
/api/execute-workflow

// Future versioned APIs
/api/v2/polymarket/markets
/api/v2/whale/positions
/api/v2/execute-workflow
```

**Backward Compatibility**:
- Maintain v1 endpoints for 12 months after v2 release
- Deprecation warnings in response headers
- Migration guides for breaking changes
- Feature flags for gradual rollout

#### Documentation Standards

**OpenAPI 3.0 Specification** (Future):
```yaml
openapi: 3.0.0
info:
  title: CASCADIAN API
  version: 1.0.0
  description: Prediction Market Intelligence API

paths:
  /api/polymarket/markets:
    get:
      summary: List prediction markets
      parameters:
        - name: category
          in: query
          schema:
            type: string
            enum: [Politics, Sports, Crypto, Finance]
      responses:
        '200':
          description: Market list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MarketListResponse'
```

### 6.3.3 Message Processing

#### Event Processing Patterns

**Event-Driven Architecture**:

```mermaid
flowchart LR
    subgraph "Event Sources"
        MARKET_SYNC[Market Sync<br/>Events]
        USER_ACTION[User Action<br/>Events]
        WORKFLOW_EXEC[Workflow Execution<br/>Events]
    end
    
    subgraph "Event Processing"
        EVENT_BUS[Event Bus<br/>Supabase Real-time]
        PROCESSORS[Event Processors]
        HANDLERS[Event Handlers]
    end
    
    subgraph "Event Consumers"
        UI_UPDATES[UI Updates]
        NOTIFICATIONS[Notifications]
        ANALYTICS[Analytics]
    end
    
    MARKET_SYNC --> EVENT_BUS
    USER_ACTION --> EVENT_BUS
    WORKFLOW_EXEC --> EVENT_BUS
    
    EVENT_BUS --> PROCESSORS
    PROCESSORS --> HANDLERS
    
    HANDLERS --> UI_UPDATES
    HANDLERS --> NOTIFICATIONS
    HANDLERS --> ANALYTICS
```

**Event Types and Handlers**:

| Event Type | Source | Handler | Action |
|---|---|---|---|
| **market_updated** | Sync Engine | UI Refresh | Update market screener |
| **workflow_started** | User Action | Status Update | Show execution progress |
| **whale_detected** | Analysis Engine | Notification | Alert user |
| **position_changed** | External API | Portfolio Update | Recalculate P&L |

#### Stream Processing Design

**Real-time Data Streams**:

Supabase real-time subscriptions using broadcast channels for scalable real-time updates

```typescript
// Real-time subscription pattern
const subscription = supabase
  .channel(`market_updates`)
  .on('broadcast', { event: 'market_price_change' }, (payload) => {
    // Update UI with new price data
    updateMarketPrice(payload.market_id, payload.new_price)
  })
  .subscribe()
```

**Stream Processing Architecture**:

```mermaid
sequenceDiagram
    participant External API
    participant Sync Engine
    participant Database
    participant Real-time Channel
    participant Client
    
    External API->>Sync Engine: Market data update
    Sync Engine->>Database: UPSERT market data
    Database->>Real-time Channel: Broadcast change event
    Real-time Channel->>Client: Stream update to UI
    Client->>Client: Update component state
```

#### Batch Processing Flows

**Background Sync Processing**:

Next.js API routes are server-side only bundles that handle batch processing without affecting client-side performance

```typescript
// Batch processing workflow
export async function POST(request: Request) {
  const mutex = new Mutex('polymarket-sync')
  
  try {
    await mutex.acquire()
    
    // Fetch data in batches
    const events = await polymarketClient.getEvents({ limit: 100 })
    const markets = extractMarketsFromEvents(events)
    
    // Process in chunks of 500
    const chunks = chunkArray(markets, 500)
    
    for (const chunk of chunks) {
      await batchUpsertMarkets(chunk)
    }
    
    return Response.json({ 
      success: true, 
      processed: markets.length 
    })
  } finally {
    await mutex.release()
  }
}
```

**Batch Processing Schedule**:

| Process | Frequency | Batch Size | Duration |
|---|---|---|---|
| **Market Sync** | Every 5 minutes | 500 markets | 8-10 seconds |
| **Whale Analysis** | Every 15 minutes | 100 wallets | 30-45 seconds |
| **Price History** | Every 1 minute | 50 markets | 5-8 seconds |
| **Analytics Update** | Every 30 minutes | All markets | 2-3 minutes |

#### Error Handling Strategy

**Comprehensive Error Recovery**:

```mermaid
flowchart TD
    ERROR[Error Occurs]
    
    CLASSIFY{Classify Error}
    
    TRANSIENT[Transient Error<br/>Network, Rate Limit]
    PERMANENT[Permanent Error<br/>Auth, Validation]
    UNKNOWN[Unknown Error]
    
    RETRY[Exponential Backoff<br/>Retry]
    FALLBACK[Fallback to<br/>Cached Data]
    LOG_ERROR[Log Error<br/>& Alert]
    
    MAX_RETRIES{Max Retries<br/>Reached?}
    
    ERROR --> CLASSIFY
    
    CLASSIFY --> TRANSIENT
    CLASSIFY --> PERMANENT
    CLASSIFY --> UNKNOWN
    
    TRANSIENT --> RETRY
    PERMANENT --> LOG_ERROR
    UNKNOWN --> RETRY
    
    RETRY --> MAX_RETRIES
    MAX_RETRIES -->|No| RETRY
    MAX_RETRIES -->|Yes| FALLBACK
    
    FALLBACK --> LOG_ERROR
```

**Error Recovery Patterns**:

```typescript
// Retry with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 4
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error
      }
      
      const delay = Math.pow(2, attempt) * 1000 // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

// Graceful degradation
async function getMarketsWithFallback(filters: MarketFilters) {
  try {
    return await fetchMarketsFromAPI(filters)
  } catch (error) {
    console.warn('API failed, falling back to cached data:', error)
    return await getMarketsFromCache(filters)
  }
}
```

### 6.3.4 External Systems

#### Third-Party Integration Patterns

**Polymarket API Integration**:

Next.js API routes handle different HTTP methods and provide built-in request helpers for external API integration

```typescript
// Polymarket client with retry logic
class PolymarketClient {
  private baseURL = 'https://gamma-api.polymarket.com'
  private timeout = 10000
  
  async getMarkets(params: MarketParams): Promise<Market[]> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseURL}/events`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CASCADIAN/1.0'
        },
        signal: AbortSignal.timeout(this.timeout)
      })
      
      if (!response.ok) {
        throw new APIError(response.status, await response.text())
      }
      
      return response.json()
    })
  }
}
```

**AI Service Integration Patterns**:

```typescript
// Multi-provider AI integration
interface AIProvider {
  name: string
  analyze(prompt: string, data: any): Promise<AIResponse>
}

class AIServiceManager {
  private providers: AIProvider[] = [
    new OpenAIProvider(),
    new ClaudeProvider(),
    new GeminiProvider()
  ]
  
  async analyzeWithFallback(prompt: string, data: any): Promise<AIResponse> {
    for (const provider of this.providers) {
      try {
        return await provider.analyze(prompt, data)
      } catch (error) {
        console.warn(`${provider.name} failed, trying next provider:`, error)
        continue
      }
    }
    throw new Error('All AI providers failed')
  }
}
```

#### API Gateway Configuration

**Next.js as API Gateway**:

Next.js 15 route handlers support multiple HTTP methods and provide extended Request/Response APIs

```typescript
// Centralized API gateway pattern
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint')
  
  // Route to appropriate service
  switch (endpoint) {
    case 'markets':
      return handleMarketsRequest(request)
    case 'whales':
      return handleWhalesRequest(request)
    case 'workflows':
      return handleWorkflowsRequest(request)
    default:
      return Response.json({ error: 'Unknown endpoint' }, { status: 404 })
  }
}
```

**Gateway Features**:

| Feature | Implementation | Benefit |
|---|---|---|
| **Request Routing** | Path-based routing | Centralized endpoint management |
| **Authentication** | JWT validation middleware | Consistent auth across services |
| **Rate Limiting** | Per-user request tracking | Prevent API abuse |
| **Response Caching** | In-memory cache with TTL | Reduced external API calls |

#### External Service Contracts

**Service Level Agreements (SLAs)**:

| External Service | Availability SLA | Response Time | Rate Limits |
|---|---|---|---|
| **Polymarket APIs** | 99.9% | < 500ms | 100 req/min |
| **OpenAI API** | 99.9% | < 2000ms | 3000 req/min |
| **Supabase** | 99.95% | < 100ms | Connection-based |
| **Vercel Platform** | 99.99% | < 50ms | Function-based |

**Contract Monitoring**:

```typescript
// Service health monitoring
class ServiceMonitor {
  private healthChecks = new Map<string, HealthCheck>()
  
  async checkServiceHealth(serviceName: string): Promise<ServiceHealth> {
    const startTime = Date.now()
    
    try {
      await this.pingService(serviceName)
      const responseTime = Date.now() - startTime
      
      return {
        status: 'healthy',
        responseTime,
        lastChecked: new Date()
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date()
      }
    }
  }
}
```

### 6.3.5 Integration Flow Diagrams

#### Market Data Integration Flow

```mermaid
sequenceDiagram
    participant Cron as Vercel Cron
    participant Sync as Sync Engine
    participant PM as Polymarket API
    participant DB as Supabase DB
    participant RT as Real-time Channel
    participant UI as Frontend UI
    
    Cron->>Sync: Trigger sync (every 5 min)
    Sync->>PM: GET /events?limit=100
    PM-->>Sync: Events data
    
    loop Process Events
        Sync->>Sync: Extract markets
        Sync->>Sync: Transform data
        Sync->>DB: Batch UPSERT markets
    end
    
    DB->>RT: Broadcast market_updated
    RT->>UI: Stream update event
    UI->>UI: Refresh market data
```

#### Workflow Execution Integration Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Frontend
    participant API as API Route
    participant Engine as Workflow Engine
    participant AI as AI Services
    participant PM as Polymarket API
    participant DB as Database
    
    User->>UI: Click "Run Workflow"
    UI->>API: POST /api/execute-workflow (SSE)
    API->>Engine: Initialize execution
    
    Engine->>UI: Stream: execution_started
    
    loop For Each Node
        Engine->>UI: Stream: node_running
        
        alt Polymarket Node
            Engine->>PM: Fetch market data
            PM-->>Engine: Market response
        else AI Node
            Engine->>AI: Analyze with prompt
            AI-->>Engine: Analysis result
        end
        
        Engine->>UI: Stream: node_complete
    end
    
    Engine->>DB: Log execution
    Engine->>UI: Stream: execution_complete
```

#### Real-time Data Subscription Flow

```mermaid
sequenceDiagram
    participant Client
    participant Supabase
    participant Database
    participant External
    
    Client->>Supabase: Subscribe to channel
    Supabase-->>Client: Subscription confirmed
    
    External->>Database: Update market data
    Database->>Supabase: Trigger change event
    Supabase->>Client: Broadcast update
    Client->>Client: Update UI state
    
    Note over Client,External: Real-time updates continue...
    
    Client->>Supabase: Unsubscribe
    Supabase-->>Client: Unsubscribe confirmed
```

### 6.3.6 Performance and Scalability

#### Integration Performance Metrics

| Integration Point | Target Latency | Current Performance | Optimization |
|---|---|---|---|
| **Polymarket API** | < 500ms | 200-400ms | Request batching |
| **AI Services** | < 2000ms | 800-1500ms | Provider fallback |
| **Database Queries** | < 100ms | 50-80ms | Indexed queries |
| **Real-time Updates** | < 100ms | 20-50ms | WebSocket optimization |

#### Scalability Patterns

**Horizontal Scaling Strategy**:

Next.js serverless functions automatically scale and are server-side only bundles

```mermaid
graph TB
    subgraph "Auto-Scaling Layer"
        LB[Vercel Edge Network<br/>Load Balancer]
        
        subgraph "Function Instances"
            F1[Function Instance 1]
            F2[Function Instance 2]
            F3[Function Instance N]
        end
    end
    
    subgraph "Shared Resources"
        DB[Supabase Database<br/>Connection Pool]
        CACHE[Distributed Cache<br/>Future: Redis]
    end
    
    LB --> F1
    LB --> F2
    LB --> F3
    
    F1 --> DB
    F2 --> DB
    F3 --> DB
    
    F1 --> CACHE
    F2 --> CACHE
    F3 --> CACHE
```

**Connection Pooling**:

Supabase provides connection pooling via PgBouncer and manages database connections efficiently

```typescript
// Database connection optimization
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: {
      schema: 'public'
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)
```

This comprehensive integration architecture ensures CASCADIAN can efficiently orchestrate data flow between multiple external systems while maintaining high performance, reliability, and scalability as the platform grows.

## 6.4 Security Architecture

### 6.4.1 Security Architecture Overview

CASCADIAN implements a **comprehensive multi-layer security architecture** designed specifically for prediction market intelligence platforms. The system leverages Supabase Auth uses JSON Web Tokens (JWTs) for authentication. Auth integrates with Supabase's database features, making it easy to use Row Level Security (RLS) for authorization.

The security architecture follows a **defense-in-depth strategy** with multiple security layers protecting different aspects of the system:

```mermaid
graph TB
    subgraph "External Security Layer"
        VERCEL_EDGE[Vercel Edge Network<br/>DDoS Protection & WAF]
        HTTPS[HTTPS/TLS Encryption<br/>Certificate Management]
    end
    
    subgraph "Application Security Layer"
        MIDDLEWARE[Next.js Middleware<br/>Route Protection]
        API_AUTH[API Route Authentication<br/>JWT Validation]
        RATE_LIMIT[Rate Limiting<br/>Request Throttling]
    end
    
    subgraph "Database Security Layer"
        RLS[Row-Level Security<br/>PostgreSQL Policies]
        ENCRYPTION[Data Encryption<br/>At Rest & In Transit]
        BACKUP[Automated Backups<br/>Point-in-Time Recovery]
    end
    
    subgraph "Identity & Access Layer"
        SUPABASE_AUTH[Supabase Authentication<br/>JWT Token Management]
        SESSION_MGT[Session Management<br/>Token Refresh & Expiry]
        USER_ROLES[User Role Management<br/>Permission Enforcement]
    end
    
    VERCEL_EDGE --> MIDDLEWARE
    HTTPS --> API_AUTH
    MIDDLEWARE --> SUPABASE_AUTH
    API_AUTH --> RLS
    RATE_LIMIT --> SESSION_MGT
    SUPABASE_AUTH --> USER_ROLES
    RLS --> ENCRYPTION
    SESSION_MGT --> BACKUP
```

### 6.4.2 Authentication Framework

### 6.4.1 Identity Management System

**Primary Authentication Provider**: Supabase Auth with JWT-based authentication

JWTs provide the foundation for Row Level Security. Each Supabase product is able to securely decode and verify the validity of a JWT it receives before using Postgres policies and roles to authorize access to the project's data.

**Authentication Flow Architecture**:

```mermaid
sequenceDiagram
    participant User as User
    participant Frontend as Next.js Frontend
    participant Supabase as Supabase Auth
    participant API as API Routes
    participant Database as PostgreSQL
    
    User->>Frontend: Sign In (email/password)
    Frontend->>Supabase: POST /auth/v1/token
    Supabase->>Supabase: Validate Credentials
    Supabase-->>Frontend: JWT Access Token + Refresh Token
    Frontend->>Frontend: Store tokens securely
    
    Note over Frontend,Database: Authenticated Request Flow
    
    Frontend->>API: API Request + Authorization Header
    API->>Supabase: Validate JWT Token
    Supabase-->>API: User Context + Claims
    API->>Database: Query with RLS Context
    Database->>Database: Apply RLS Policies
    Database-->>API: Filtered Results
    API-->>Frontend: JSON Response
```

**JWT Token Structure**:

```typescript
interface CascadianJWT {
  // Standard JWT Claims
  iss: string          // Issuer: https://project_id.supabase.co/auth/v1
  sub: string          // Subject: User UUID
  aud: string          // Audience: authenticated
  exp: number          // Expiration timestamp
  iat: number          // Issued at timestamp
  
  // Supabase Claims
  email: string        // User email address
  phone?: string       // User phone number (optional)
  role: 'authenticated' | 'anon' | 'service_role'
  
  // Custom Application Claims
  app_metadata: {
    provider: string   // Authentication provider
    providers: string[] // Available providers
  }
  user_metadata: {
    avatar_url?: string
    full_name?: string
  }
}
```

### 6.4.2 Multi-Factor Authentication (Future Enhancement)

**Planned MFA Implementation**:

| MFA Method | Implementation | Security Level | User Experience |
|---|---|---|---|
| **TOTP (Time-based)** | Google Authenticator, Authy | High | Medium friction |
| **SMS Verification** | Supabase Phone Auth | Medium | Low friction |
| **Email Verification** | Magic links | Medium | Low friction |
| **Hardware Keys** | WebAuthn/FIDO2 | Very High | Medium friction |

### 6.4.3 Session Management

**Token Lifecycle Management**:

```typescript
interface SessionManagement {
  accessToken: {
    duration: '1 hour'
    autoRefresh: true
    refreshThreshold: '5 minutes before expiry'
  }
  refreshToken: {
    duration: '30 days'
    rotation: true // New refresh token issued on use
    maxSessions: 5 // Limit concurrent sessions
  }
  sessionSecurity: {
    httpOnly: false // Future: Move to httpOnly cookies
    secure: true
    sameSite: 'strict'
    domain: '.cascadian.app'
  }
}
```

**Session Security Controls**:

- **Automatic Token Refresh**: Supabase Auth continuously issues a new JWT for each user session, for as long as the user remains signed in. JWT signing keys provide fine grained control over this important process for the security of your application.
- **Session Timeout**: Configurable idle timeout (default: 24 hours)
- **Concurrent Session Limits**: Maximum 5 active sessions per user
- **Device Tracking**: Track login devices and locations (future enhancement)

### 6.4.4 Password Policies

**Current Password Requirements**:

| Policy | Requirement | Enforcement |
|---|---|---|
| **Minimum Length** | 8 characters | Client + Server validation |
| **Complexity** | Mixed case, numbers, symbols | Zod schema validation |
| **Common Passwords** | Blocked via dictionary check | Server-side validation |
| **Breach Detection** | HaveIBeenPwned integration (future) | API validation |

### 6.4.3 Authorization System

### 6.4.1 Role-Based Access Control (RBAC)

**User Role Hierarchy**:

```mermaid
graph TD
    ANON[Anonymous User<br/>Public market data only]
    AUTH[Authenticated User<br/>Full platform access]
    PREMIUM[Premium User<br/>Advanced features]
    ADMIN[Admin User<br/>System administration]
    SERVICE[Service Role<br/>System operations]
    
    ANON --> AUTH
    AUTH --> PREMIUM
    PREMIUM --> ADMIN
    AUTH --> SERVICE
```

**Role Permissions Matrix**:

| Resource | Anonymous | Authenticated | Premium | Admin | Service |
|---|---|---|---|---|---|
| **Market Data** | Read | Read | Read | Read/Write | Read/Write |
| **User Workflows** | None | Own Only | Own Only | All | All |
| **Whale Intelligence** | Limited | Full | Full | Full | Full |
| **API Access** | None | Basic | Advanced | Full | Full |
| **User Management** | None | Own Profile | Own Profile | All Users | All Users |

### 6.4.2 Row-Level Security Implementation

**Database Security Policies**:

Supabase provides some helpers that simplify RLS if you're using Supabase Auth. Enable RLSalter table profiles enable row level security

```sql
-- Enable RLS on all user-specific tables
ALTER TABLE workflow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only access their own workflows
CREATE POLICY "Users can manage own workflows" 
ON workflow_sessions FOR ALL 
USING (auth.uid() = user_id);

-- Users can view their own execution history
CREATE POLICY "Users can view own executions" 
ON workflow_executions FOR SELECT 
USING (auth.uid() = user_id);

-- Public read access for market data
CREATE POLICY "Anyone can read markets" 
ON markets FOR SELECT 
TO anon, authenticated 
USING (true);

-- Only service role can write market data
CREATE POLICY "Service role can write markets" 
ON markets FOR ALL 
TO service_role 
USING (true);
```

### 6.4.3 API Authorization Middleware

**Next.js API Route Protection**:

```typescript
// Authentication middleware for API routes
export async function withAuth(
  handler: NextApiHandler,
  options: AuthOptions = {}
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Extract JWT from Authorization header
      const token = req.headers.authorization?.replace('Bearer ', '')
      
      if (!token) {
        return res.status(401).json({ 
          error: 'Authentication required' 
        })
      }
      
      // Validate token with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (error || !user) {
        return res.status(401).json({ 
          error: 'Invalid or expired token' 
        })
      }
      
      // Check role-based permissions
      if (options.requiredRole && !hasRole(user, options.requiredRole)) {
        return res.status(403).json({ 
          error: 'Insufficient permissions' 
        })
      }
      
      // Add user context to request
      req.user = user
      
      return handler(req, res)
    } catch (error) {
      return res.status(500).json({ 
        error: 'Authentication error' 
      })
    }
  }
}
```

### 6.4.4 Resource Authorization Policies

**Workflow Access Control**:

```typescript
interface WorkflowPermissions {
  create: (userId: string) => boolean
  read: (workflowId: string, userId: string) => boolean
  update: (workflowId: string, userId: string) => boolean
  delete: (workflowId: string, userId: string) => boolean
  execute: (workflowId: string, userId: string) => boolean
}

const workflowPermissions: WorkflowPermissions = {
  create: (userId) => !!userId, // Any authenticated user
  read: async (workflowId, userId) => {
    const workflow = await getWorkflow(workflowId)
    return workflow.user_id === userId || workflow.is_public
  },
  update: async (workflowId, userId) => {
    const workflow = await getWorkflow(workflowId)
    return workflow.user_id === userId
  },
  delete: async (workflowId, userId) => {
    const workflow = await getWorkflow(workflowId)
    return workflow.user_id === userId
  },
  execute: async (workflowId, userId) => {
    const workflow = await getWorkflow(workflowId)
    return workflow.user_id === userId || workflow.is_public
  }
}
```

### 6.4.4 Data Protection

### 6.4.1 Encryption Standards

**Data Encryption Implementation**:

| Data State | Encryption Method | Key Management | Compliance |
|---|---|---|---|
| **Data in Transit** | TLS 1.3 (HTTPS) | Vercel managed certificates | SOC 2, ISO 27001 |
| **Data at Rest** | AES-256 encryption | Supabase managed keys | SOC 2, GDPR |
| **JWT Tokens** | RS256 signing | Supabase key rotation | Industry standard |
| **API Keys** | Environment variables | Vercel encrypted storage | SOC 2 |

**Encryption Architecture**:

```mermaid
graph LR
    subgraph "Client Side"
        BROWSER[Browser]
        HTTPS_CLIENT[HTTPS/TLS 1.3]
    end
    
    subgraph "Transport Layer"
        VERCEL_EDGE[Vercel Edge Network<br/>TLS Termination]
        CDN[Global CDN<br/>Certificate Management]
    end
    
    subgraph "Application Layer"
        NEXTJS[Next.js Application<br/>Encrypted Environment Variables]
        API_ROUTES[API Routes<br/>JWT Validation]
    end
    
    subgraph "Database Layer"
        SUPABASE[Supabase PostgreSQL<br/>AES-256 Encryption at Rest]
        BACKUPS[Encrypted Backups<br/>Point-in-Time Recovery]
    end
    
    BROWSER --> HTTPS_CLIENT
    HTTPS_CLIENT --> VERCEL_EDGE
    VERCEL_EDGE --> CDN
    CDN --> NEXTJS
    NEXTJS --> API_ROUTES
    API_ROUTES --> SUPABASE
    SUPABASE --> BACKUPS
```

### 6.4.2 Key Management System

**JWT Signing Key Management**:

When a JWT is issued by Supabase Auth, the key used to create its signature is known as the signing key. Supabase provides two systems for dealing with signing keys: the Legacy system based on the JWT secret, and the new Signing keys system. We've designed the Signing keys system to address many problems the legacy system had.

**Key Rotation Strategy**:

```typescript
interface KeyManagement {
  jwtSigningKeys: {
    algorithm: 'RS256' // RSA with SHA-256
    keyRotation: 'automatic' // Supabase managed
    rotationFrequency: '90 days'
    gracePeriod: '24 hours' // Old keys remain valid
  }
  apiKeys: {
    environment: 'encrypted' // Vercel environment variables
    rotation: 'manual' // Developer initiated
    scope: 'project-specific'
  }
  databaseKeys: {
    encryption: 'AES-256'
    management: 'supabase-managed'
    backup: 'encrypted'
  }
}
```

### 6.4.3 Data Masking and Privacy

**Sensitive Data Handling**:

```sql
-- Separate schema for sensitive data
CREATE SCHEMA private;

-- API keys and sensitive settings in private schema
CREATE TABLE private.user_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    service_name text NOT NULL,
    encrypted_key text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Strict RLS on private schema
ALTER TABLE private.user_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own API keys" ON private.user_api_keys
    FOR ALL USING (auth.uid() = user_id);
```

**Data Privacy Controls**:

| Data Type | Privacy Level | Access Control | Retention Policy |
|---|---|---|---|
| **User Profiles** | Personal | User + Admin | Account lifetime |
| **Workflow Definitions** | Private | Owner only | User controlled |
| **Execution Logs** | Private | Owner only | 90 days |
| **Market Data** | Public | All users | Indefinite |
| **API Keys** | Sensitive | Owner only | Until revoked |

### 6.4.4 Compliance Controls

**GDPR Compliance Implementation**:

```typescript
interface GDPRCompliance {
  dataSubjectRights: {
    access: 'GET /api/user/data-export'
    rectification: 'PATCH /api/user/profile'
    erasure: 'DELETE /api/user/account'
    portability: 'GET /api/user/data-export?format=json'
    restriction: 'PATCH /api/user/data-processing'
  }
  legalBasis: {
    userProfiles: 'consent'
    marketData: 'legitimate-interest'
    analytics: 'consent'
    security: 'legal-obligation'
  }
  dataRetention: {
    userAccounts: 'until-deletion-request'
    executionLogs: '90-days'
    auditLogs: '7-years'
    marketData: 'indefinite'
  }
}
```

### 6.4.5 Network Security

### 6.4.1 Transport Security

**HTTPS/TLS Configuration**:

- **TLS Version**: Minimum TLS 1.2, preferred TLS 1.3
- **Certificate Management**: Automatic certificate provisioning and renewal via Vercel
- **HSTS Headers**: Strict-Transport-Security enforced
- **Certificate Transparency**: Public certificate logs monitored

### 6.4.2 API Security Controls

**Rate Limiting Implementation**:

Rate Limiting (Beta): This feature allows you to limit the frequency of requests from individual users or IP addresses, effectively mitigating brute-force attacks, API token abuse, and other forms of malicious activity.

```typescript
// Rate limiting configuration
interface RateLimitConfig {
  global: {
    requests: 1000
    window: '1 hour'
    identifier: 'ip'
  }
  authenticated: {
    requests: 5000
    window: '1 hour'
    identifier: 'user_id'
  }
  apiEndpoints: {
    '/api/execute-workflow': {
      requests: 10
      window: '1 minute'
      identifier: 'user_id'
    }
    '/api/polymarket/sync': {
      requests: 1
      window: '5 minutes'
      identifier: 'admin'
    }
  }
}
```

**Input Validation and Sanitization**:

```typescript
// Zod schema validation for API inputs
const MarketQuerySchema = z.object({
  category: z.enum(['Politics', 'Sports', 'Crypto', 'Finance']).optional(),
  active: z.boolean().optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0),
  search: z.string().max(100).optional()
})

// SQL injection prevention through parameterized queries
const getMarkets = async (filters: MarketFilters) => {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('active', filters.active)
    .ilike('title', `%${filters.search}%`)
    .range(filters.offset, filters.offset + filters.limit - 1)
  
  return { data, error }
}
```

### 6.4.3 DDoS Protection

**Vercel Edge Network Protection**:

Vercel's WAF provides robust protection against common web attacks, including SQL injection, cross-site scripting (XSS), and remote file inclusion (RFI). Unlike some providers that charge based on traffic volume, Vercel uses features such as built-in DDoS mitigation to absorb the cost of malicious traffic, protecting you from unexpected expenses.

**Multi-Layer DDoS Mitigation**:

```mermaid
graph TD
    ATTACK[DDoS Attack] --> EDGE[Vercel Edge Network]
    EDGE --> WAF[Web Application Firewall]
    WAF --> RATE[Rate Limiting]
    RATE --> CHALLENGE[Challenge Mode]
    CHALLENGE --> APP[Application Layer]
    
    EDGE --> BLOCK1[Block Malicious IPs]
    WAF --> BLOCK2[Filter Attack Patterns]
    RATE --> BLOCK3[Throttle Requests]
    CHALLENGE --> BLOCK4[Human Verification]
```

### 6.4.6 Application Security

### 6.4.1 Cross-Site Scripting (XSS) Prevention

**XSS Protection Mechanisms**:

| Protection Layer | Implementation | Coverage |
|---|---|---|
| **React Built-in** | Automatic HTML escaping | All user content |
| **Content Security Policy** | Strict CSP headers | Script execution |
| **Input Sanitization** | DOMPurify for rich content | User-generated content |
| **Output Encoding** | Context-aware encoding | Dynamic content |

**Content Security Policy Configuration**:

```typescript
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live;
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
```

### 6.4.2 Cross-Site Request Forgery (CSRF) Protection

**CSRF Mitigation Strategy**:

- **SameSite Cookies**: Strict SameSite attribute on authentication cookies
- **Origin Validation**: Verify Origin and Referer headers
- **Custom Headers**: Require X-Requested-With header for API calls
- **Token Validation**: CSRF tokens for state-changing operations (future)

### 6.4.3 SQL Injection Prevention

**Database Security Measures**:

```typescript
// Safe parameterized queries using Supabase client
const getUserWorkflows = async (userId: string, filters: WorkflowFilters) => {
  const query = supabase
    .from('workflow_sessions')
    .select('*')
    .eq('user_id', userId) // Parameterized - safe from SQL injection
  
  if (filters.status) {
    query.eq('status', filters.status)
  }
  
  if (filters.search) {
    query.ilike('name', `%${filters.search}%`)
  }
  
  return query
}

// Row-Level Security provides additional protection
// Even if SQL injection occurred, RLS policies would limit access
```

### 6.4.7 Security Monitoring and Incident Response

### 6.4.1 Security Event Monitoring

**Monitoring Architecture**:

```mermaid
graph LR
    subgraph "Event Sources"
        APP[Application Logs]
        AUTH[Authentication Events]
        DB[Database Audit Logs]
        API[API Access Logs]
    end
    
    subgraph "Monitoring Layer"
        VERCEL[Vercel Analytics]
        SUPABASE[Supabase Monitoring]
        CUSTOM[Custom Metrics]
    end
    
    subgraph "Alerting System"
        SLACK[Slack Notifications]
        EMAIL[Email Alerts]
        DASHBOARD[Security Dashboard]
    end
    
    APP --> VERCEL
    AUTH --> SUPABASE
    DB --> SUPABASE
    API --> CUSTOM
    
    VERCEL --> SLACK
    SUPABASE --> EMAIL
    CUSTOM --> DASHBOARD
```

**Security Metrics Tracking**:

| Metric Category | Specific Metrics | Alert Threshold | Response Action |
|---|---|---|---|
| **Authentication** | Failed login attempts | >10 per IP per hour | IP blocking |
| **Authorization** | Permission denied events | >5 per user per hour | Account review |
| **API Security** | Rate limit violations | >100 per hour | Enhanced monitoring |
| **Data Access** | Unusual query patterns | Statistical anomaly | Security review |

### 6.4.2 Incident Response Procedures

**Security Incident Classification**:

| Severity Level | Definition | Response Time | Escalation |
|---|---|---|---|
| **Critical** | Data breach, system compromise | 15 minutes | Immediate |
| **High** | Authentication bypass, privilege escalation | 1 hour | Within 2 hours |
| **Medium** | Suspicious activity, policy violations | 4 hours | Next business day |
| **Low** | Minor security events, informational | 24 hours | Weekly review |

**Incident Response Workflow**:

```mermaid
flowchart TD
    DETECT[Security Event Detected] --> ASSESS[Assess Severity Level]
    
    ASSESS --> CRITICAL{Critical<br/>Incident?}
    ASSESS --> HIGH{High Priority<br/>Incident?}
    ASSESS --> MEDIUM{Medium Priority<br/>Incident?}
    ASSESS --> LOW[Low Priority<br/>Log & Monitor]
    
    CRITICAL --> IMMEDIATE[Immediate Response<br/>15 minutes]
    HIGH --> URGENT[Urgent Response<br/>1 hour]
    MEDIUM --> STANDARD[Standard Response<br/>4 hours]
    
    IMMEDIATE --> CONTAIN[Contain Threat]
    URGENT --> CONTAIN
    STANDARD --> INVESTIGATE[Investigate Issue]
    
    CONTAIN --> INVESTIGATE
    INVESTIGATE --> REMEDIATE[Implement Fix]
    REMEDIATE --> DOCUMENT[Document Incident]
    DOCUMENT --> REVIEW[Post-Incident Review]
    
    LOW --> DOCUMENT
```

### 6.4.3 Audit Logging

**Comprehensive Audit Trail**:

```sql
-- Audit log table for sensitive operations
CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    success boolean DEFAULT true,
    error_message text,
    created_at timestamptz DEFAULT now()
);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id, 
        old_values, new_values, ip_address
    ) VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::text, OLD.id::text),
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        inet_client_addr()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

### 6.4.8 Security Testing and Validation

### 6.4.1 Automated Security Testing

**Security Testing Pipeline**:

| Test Type | Tool/Method | Frequency | Coverage |
|---|---|---|---|
| **Static Analysis** | ESLint security rules | Every commit | Code vulnerabilities |
| **Dependency Scanning** | GitHub Dependabot | Daily | Known vulnerabilities |
| **Authentication Testing** | Custom test suite | Every deployment | Auth flows |
| **Authorization Testing** | RLS policy tests | Every deployment | Access controls |

### 6.4.2 Penetration Testing (Future)

**Planned Security Assessments**:

- **Quarterly Internal Testing**: Automated vulnerability scans
- **Annual External Audit**: Third-party penetration testing
- **Bug Bounty Program**: Community-driven security testing (future)
- **Compliance Audits**: SOC 2 Type II certification (future)

### 6.4.3 Security Metrics and KPIs

**Security Performance Indicators**:

| KPI | Target | Current | Measurement Method |
|---|---|---|---|
| **Authentication Success Rate** | >99.5% | 99.8% | Supabase Auth metrics |
| **API Security Events** | <10 per day | 3 per day | Custom monitoring |
| **Failed Login Attempts** | <1% of total | 0.3% | Authentication logs |
| **Security Incident Response** | <1 hour | 45 minutes | Incident tracking |

This comprehensive security architecture ensures CASCADIAN maintains the highest standards of security while providing a seamless user experience for prediction market intelligence and trading automation.

## 6.5 Monitoring and Observability

### 6.5.1 Monitoring Architecture Overview

CASCADIAN implements a **comprehensive multi-layer monitoring and observability strategy** that leverages both built-in platform capabilities and modern observability standards. The system is designed to provide complete visibility into application performance, user experience, and business metrics across the entire prediction market intelligence platform.

#### Observability Philosophy

Observability is crucial for understanding and optimizing the behavior and performance of your Next.js app. By leveraging observability tools, such as logging and metrics, developers can gain insights into their application's behavior and identify areas for optimization. With observability, developers can proactively address issues before they become major problems and provide a better user experience.

The monitoring architecture follows the **three pillars of observability**:

1. **Metrics** - Quantitative measurements of system behavior over time
2. **Logs** - Discrete events that occurred within the application
3. **Traces** - Request flows across distributed components

```mermaid
graph TB
    subgraph "Data Collection Layer"
        VERCEL[Vercel Analytics<br/>Core Web Vitals]
        SUPABASE[Supabase Metrics<br/>Database Performance]
        OTEL[OpenTelemetry<br/>Custom Instrumentation]
        LOGS[Application Logs<br/>Structured Logging]
    end
    
    subgraph "Processing & Storage"
        VERCEL_DASH[Vercel Dashboard<br/>Built-in Analytics]
        SUPABASE_DASH[Supabase Dashboard<br/>Database Reports]
        EXTERNAL[External Observability<br/>Future: Grafana/DataDog]
    end
    
    subgraph "Alerting & Response"
        ALERTS[Alert Manager<br/>Threshold-based]
        NOTIFICATIONS[Notifications<br/>Slack/Email]
        RUNBOOKS[Incident Runbooks<br/>Response Procedures]
    end
    
    VERCEL --> VERCEL_DASH
    SUPABASE --> SUPABASE_DASH
    OTEL --> EXTERNAL
    LOGS --> EXTERNAL
    
    VERCEL_DASH --> ALERTS
    SUPABASE_DASH --> ALERTS
    EXTERNAL --> ALERTS
    
    ALERTS --> NOTIFICATIONS
    NOTIFICATIONS --> RUNBOOKS
```

#### Current Implementation Status

| Monitoring Component | Status | Implementation | Coverage |
|---|---|---|---|
| **Vercel Analytics** | ✅ Production | Built-in platform monitoring | Frontend performance, API routes |
| **Supabase Monitoring** | ✅ Production | Database dashboard & metrics | Database performance, queries |
| **Application Logging** | ✅ Production | Console.log + Vercel logs | Error tracking, debug info |
| **OpenTelemetry** | 📋 Planned | Custom instrumentation | End-to-end tracing |

### 6.5.2 Metrics Collection

#### Platform-Native Metrics

**Vercel Analytics & Observability**

Granular insights into application performance to ensure you're always up and running. Real users, real performance data. Performance from the right point of view. See detailed views of your website's performance metrics with Speed Insights, facilitating informed decisions for optimization.

CASCADIAN leverages Vercel's comprehensive observability platform which provides:

| Metric Category | Specific Metrics | Collection Method | Retention |
|---|---|---|---|
| **Core Web Vitals** | LCP, FID, CLS, TTFB | Automatic browser instrumentation | 30 days |
| **Function Performance** | Duration, memory usage, cold starts | Serverless function monitoring | 30 days |
| **API Metrics** | Response times, error rates, throughput | Built-in API route tracking | 30 days |
| **Traffic Analytics** | Page views, unique visitors, referrers | First-party analytics | 30 days |

**Supabase Database Metrics**

Each project hosted on the Supabase platform comes with a Prometheus-compatible metrics endpoint, updated every minute, which can be used to gather insight into the health and status of your project. You can use this endpoint to ingest data into your own monitoring and alerting infrastructure.

Supabase provides over 200 database performance metrics:

```mermaid
graph LR
    subgraph "Database Metrics"
        CONN[Connection Pool<br/>Active/Idle Connections]
        QUERY[Query Performance<br/>Duration, Frequency]
        STORAGE[Storage Metrics<br/>Size, Growth Rate]
        CACHE[Cache Performance<br/>Hit Rate, Memory Usage]
    end
    
    subgraph "Real-time Metrics"
        RT_CONN[Realtime Connections<br/>Active Subscriptions]
        RT_MSG[Message Throughput<br/>Broadcasts/Second]
        RT_LAT[Latency Metrics<br/>Message Delivery Time]
    end
    
    subgraph "Auth Metrics"
        AUTH_REQ[Auth Requests<br/>Sign-ins, Sign-ups]
        AUTH_ERR[Auth Errors<br/>Failed Attempts]
        JWT[JWT Operations<br/>Token Generation]
    end
    
    CONN --> PROMETHEUS[Prometheus Endpoint<br/>Updated Every Minute]
    QUERY --> PROMETHEUS
    STORAGE --> PROMETHEUS
    CACHE --> PROMETHEUS
    RT_CONN --> PROMETHEUS
    RT_MSG --> PROMETHEUS
    RT_LAT --> PROMETHEUS
    AUTH_REQ --> PROMETHEUS
    AUTH_ERR --> PROMETHEUS
    JWT --> PROMETHEUS
```

#### Application-Specific Metrics

**Business Intelligence Metrics**

CASCADIAN tracks custom business metrics that align with platform objectives:

| Metric Type | Specific Metrics | Collection Method | Business Value |
|---|---|---|---|
| **User Engagement** | DAU, session duration, feature adoption | Custom events via Vercel Analytics | Product optimization |
| **Trading Performance** | Workflow executions, strategy win rates | Database aggregation queries | Platform effectiveness |
| **Data Quality** | Sync success rates, API response times | API route instrumentation | System reliability |
| **Market Intelligence** | Markets tracked, whale signals accuracy | Background job monitoring | Intelligence quality |

**Custom Metrics Implementation**

```typescript
// Custom metrics collection service
class MetricsCollector {
  private static instance: MetricsCollector
  
  // Track workflow execution metrics
  async trackWorkflowExecution(workflowId: string, duration: number, success: boolean) {
    const metric = {
      type: 'workflow_execution',
      workflowId,
      duration,
      success,
      timestamp: new Date().toISOString()
    }
    
    // Store in database for aggregation
    await supabase
      .from('metrics_events')
      .insert(metric)
    
    // Send to Vercel Analytics (if configured)
    if (typeof window !== 'undefined') {
      window.va?.track('workflow_execution', {
        duration,
        success: success.toString()
      })
    }
  }
  
  // Track API performance
  async trackAPICall(endpoint: string, duration: number, statusCode: number) {
    const metric = {
      type: 'api_call',
      endpoint,
      duration,
      statusCode,
      timestamp: new Date().toISOString()
    }
    
    await supabase
      .from('metrics_events')
      .insert(metric)
  }
  
  // Track business metrics
  async trackBusinessEvent(event: string, properties: Record<string, any>) {
    const metric = {
      type: 'business_event',
      event,
      properties,
      timestamp: new Date().toISOString()
    }
    
    await supabase
      .from('metrics_events')
      .insert(metric)
  }
}
```

### 6.5.3 Log Aggregation

#### Structured Logging Architecture

**Vercel Function Logs**

Vercel gives you some observability out of the box for your NextJS application: function logs, perf insights, basic metrics.

All API routes and serverless functions automatically log to Vercel's logging infrastructure:

```typescript
// Structured logging implementation
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  service: string
  operation: string
  userId?: string
  requestId?: string
  metadata: Record<string, any>
  duration?: number
  error?: {
    message: string
    stack?: string
    code?: string
  }
}

class Logger {
  private static createEntry(
    level: LogEntry['level'],
    message: string,
    metadata: Record<string, any> = {}
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      service: 'cascadian-api',
      operation: metadata.operation || 'unknown',
      userId: metadata.userId,
      requestId: metadata.requestId,
      metadata,
      duration: metadata.duration
    }
  }
  
  static info(message: string, metadata?: Record<string, any>) {
    const entry = this.createEntry('info', message, metadata)
    console.log(JSON.stringify(entry))
  }
  
  static error(message: string, error?: Error, metadata?: Record<string, any>) {
    const entry = this.createEntry('error', message, {
      ...metadata,
      error: error ? {
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      } : undefined
    })
    console.error(JSON.stringify(entry))
  }
  
  static warn(message: string, metadata?: Record<string, any>) {
    const entry = this.createEntry('warn', message, metadata)
    console.warn(JSON.stringify(entry))
  }
}

// Usage in API routes
export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()
  
  Logger.info('Market sync started', {
    operation: 'polymarket_sync',
    requestId
  })
  
  try {
    const markets = await syncMarkets()
    
    Logger.info('Market sync completed', {
      operation: 'polymarket_sync',
      requestId,
      duration: Date.now() - startTime,
      marketsProcessed: markets.length
    })
    
    return Response.json({ success: true, count: markets.length })
  } catch (error) {
    Logger.error('Market sync failed', error as Error, {
      operation: 'polymarket_sync',
      requestId,
      duration: Date.now() - startTime
    })
    
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}
```

**Supabase Database Logs**

Starting today, there is one interleaved stream of logs across all services. You can trace a single request across the entire Supabase stack. No more jumping between tabs to diagnose errors.

Supabase provides unified logging across all services:

- **Database Query Logs** - Slow queries, connection events, errors
- **Auth Logs** - Authentication attempts, JWT operations, security events  
- **Real-time Logs** - WebSocket connections, subscription events, message delivery
- **Storage Logs** - File operations, access patterns, errors

#### Log Retention and Analysis

| Log Source | Retention Period | Analysis Method | Alert Triggers |
|---|---|---|---|
| **Vercel Function Logs** | 30 days (Hobby), 90 days (Pro) | Vercel dashboard search | Error rate > 5% |
| **Supabase Logs** | 7 days (Free), 30 days (Pro) | Dashboard filtering | Connection failures |
| **Application Logs** | 90 days (custom storage) | Database queries | Critical errors |
| **Audit Logs** | 1 year (compliance) | Structured queries | Security events |

### 6.5.4 Distributed Tracing

#### OpenTelemetry Integration (Planned)

We recommend using OpenTelemetry for instrumenting your apps. It's a platform-agnostic way to instrument apps that allows you to change your observability provider without changing your code.

**Future Implementation Roadmap**

Phase 3 will introduce comprehensive distributed tracing using OpenTelemetry:

```typescript
// Future OpenTelemetry instrumentation
import { registerOTel } from '@vercel/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

export function register() {
  registerOTel({
    serviceName: 'cascadian-api',
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    })
  })
}

// Custom span creation for workflow execution
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('cascadian-workflow')

export async function executeWorkflow(workflowId: string) {
  return tracer.startActiveSpan('workflow.execute', async (span) => {
    span.setAttributes({
      'workflow.id': workflowId,
      'workflow.version': '1.0'
    })
    
    try {
      const result = await processWorkflow(workflowId)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: (error as Error).message 
      })
      throw error
    } finally {
      span.end()
    }
  })
}
```

**Trace Correlation Strategy**

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Database
    participant External
    
    User->>Frontend: Execute Workflow
    Note over Frontend: Generate Trace ID
    
    Frontend->>API: POST /api/execute-workflow
    Note over API: Propagate Trace Context
    
    API->>Database: Query Workflow Definition
    Note over Database: Add DB Span
    
    API->>External: Call Polymarket API
    Note over External: Add External Span
    
    External-->>API: Return Data
    API-->>Frontend: Stream Results
    Frontend-->>User: Display Output
    
    Note over User,External: Complete trace spans linked by Trace ID
```

### 6.5.5 Health Checks and Uptime Monitoring

#### Application Health Endpoints

**System Health Check**

```typescript
// Health check endpoint
export async function GET() {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    checks: {
      database: 'unknown',
      external_apis: 'unknown',
      cache: 'unknown'
    }
  }
  
  try {
    // Database connectivity check
    const { error: dbError } = await supabase
      .from('markets')
      .select('count')
      .limit(1)
    
    healthCheck.checks.database = dbError ? 'unhealthy' : 'healthy'
    
    // External API check (Polymarket)
    try {
      const response = await fetch('https://gamma-api.polymarket.com/events?limit=1', {
        signal: AbortSignal.timeout(5000)
      })
      healthCheck.checks.external_apis = response.ok ? 'healthy' : 'degraded'
    } catch {
      healthCheck.checks.external_apis = 'unhealthy'
    }
    
    // Cache check (React Query would be client-side)
    healthCheck.checks.cache = 'healthy'
    
    // Overall status
    const hasUnhealthy = Object.values(healthCheck.checks).includes('unhealthy')
    healthCheck.status = hasUnhealthy ? 'unhealthy' : 'healthy'
    
    return Response.json(healthCheck, {
      status: hasUnhealthy ? 503 : 200
    })
  } catch (error) {
    return Response.json({
      ...healthCheck,
      status: 'unhealthy',
      error: (error as Error).message
    }, { status: 503 })
  }
}
```

#### External Monitoring Services

**Uptime Monitoring Strategy**

| Service | Monitoring Method | Check Frequency | Alert Threshold |
|---|---|---|---|
| **Frontend** | HTTP GET to homepage | 1 minute | 2 consecutive failures |
| **API Health** | GET /api/health | 1 minute | 3 consecutive failures |
| **Database** | Connection test via health endpoint | 5 minutes | 1 failure |
| **External APIs** | Polymarket API availability | 5 minutes | 5 consecutive failures |

**Future Integration: Checkly**

New native integrations from Sentry, Checkly, and Dash0 are now available on the Vercel Marketplace. You can now use the tools you already trust to monitor, measure, and debug your apps. Whether you're debugging a Vercel Function, tracking frontend performance, or running synthetic checks on your production site, you can now do it all from the same place where you deploy your code.

Phase 4 will integrate Checkly for comprehensive synthetic monitoring:

- **API Monitoring** - Automated testing of critical API endpoints
- **Browser Checks** - End-to-end user journey testing
- **Performance Monitoring** - Page load time and Core Web Vitals tracking
- **Global Monitoring** - Multi-region availability checks

### 6.5.6 Performance Metrics and SLA Monitoring

#### Service Level Objectives (SLOs)

**Application Performance SLOs**

| Service Component | SLO Target | Measurement Window | Tolerance |
|---|---|---|---|
| **API Response Time** | 95% < 200ms | 7 days | 99.5% availability |
| **Database Queries** | 95% < 100ms | 24 hours | 99.9% success rate |
| **Workflow Execution** | 90% complete < 30s | 24 hours | 95% success rate |
| **Market Data Sync** | 95% complete < 15s | 1 hour | 98% success rate |

**User Experience SLOs**

| Metric | Target | Measurement | Business Impact |
|---|---|---|---|
| **Largest Contentful Paint (LCP)** | < 2.5s | 75th percentile | User engagement |
| **First Input Delay (FID)** | < 100ms | 75th percentile | Interactivity |
| **Cumulative Layout Shift (CLS)** | < 0.1 | 75th percentile | Visual stability |
| **Time to First Byte (TTFB)** | < 600ms | 75th percentile | Perceived performance |

#### Performance Dashboard Design

```mermaid
graph TB
    subgraph "Executive Dashboard"
        KPI[Key Performance Indicators<br/>SLO Compliance, Error Budget]
        BUSINESS[Business Metrics<br/>DAU, Workflow Executions]
        ALERTS[Active Alerts<br/>Critical Issues]
    end
    
    subgraph "Technical Dashboard"
        PERF[Performance Metrics<br/>Response Times, Throughput]
        ERRORS[Error Tracking<br/>Error Rates, Failed Requests]
        INFRA[Infrastructure Health<br/>Database, External APIs]
    end
    
    subgraph "User Experience Dashboard"
        VITALS[Core Web Vitals<br/>LCP, FID, CLS]
        JOURNEY[User Journeys<br/>Conversion Funnels]
        SATISFACTION[User Satisfaction<br/>Error Rates by Feature]
    end
    
    KPI --> PERF
    BUSINESS --> JOURNEY
    ALERTS --> ERRORS
    PERF --> VITALS
    ERRORS --> SATISFACTION
    INFRA --> PERF
```

### 6.5.7 Alert Management and Incident Response

#### Alert Configuration Matrix

**Critical Alerts (Immediate Response)**

| Alert Type | Condition | Threshold | Response Time | Escalation |
|---|---|---|---|---|
| **API Downtime** | Health check failures | 3 consecutive failures | 5 minutes | Engineering team |
| **Database Connectivity** | Connection failures | 1 failure | 2 minutes | Database admin |
| **High Error Rate** | API error rate | > 10% over 5 minutes | 10 minutes | On-call engineer |
| **Workflow Failures** | Execution failures | > 50% failure rate | 15 minutes | Product team |

**Warning Alerts (Monitoring Required)**

| Alert Type | Condition | Threshold | Response Time | Action |
|---|---|---|---|---|
| **Slow Response Times** | API latency | p95 > 500ms for 10 min | 30 minutes | Performance review |
| **High Memory Usage** | Function memory | > 80% for 15 minutes | 1 hour | Resource optimization |
| **External API Degradation** | Polymarket API errors | > 20% error rate | 1 hour | Fallback activation |
| **Low Cache Hit Rate** | React Query cache | < 70% hit rate | 4 hours | Cache optimization |

#### Incident Response Workflow

```mermaid
flowchart TD
    ALERT[Alert Triggered] --> SEVERITY{Assess Severity}
    
    SEVERITY -->|Critical| IMMEDIATE[Immediate Response<br/>< 5 minutes]
    SEVERITY -->|High| URGENT[Urgent Response<br/>< 30 minutes]
    SEVERITY -->|Medium| STANDARD[Standard Response<br/>< 4 hours]
    SEVERITY -->|Low| SCHEDULED[Scheduled Response<br/>Next business day]
    
    IMMEDIATE --> INCIDENT[Create Incident<br/>Slack Channel]
    URGENT --> INCIDENT
    STANDARD --> TICKET[Create Support Ticket]
    SCHEDULED --> BACKLOG[Add to Backlog]
    
    INCIDENT --> INVESTIGATE[Investigate Root Cause]
    INVESTIGATE --> MITIGATE[Implement Mitigation]
    MITIGATE --> RESOLVE[Resolve Issue]
    RESOLVE --> POSTMORTEM[Post-Incident Review]
    
    TICKET --> INVESTIGATE
    BACKLOG --> INVESTIGATE
    
    POSTMORTEM --> IMPROVE[Process Improvement]
    IMPROVE --> PREVENT[Prevention Measures]
```

#### Runbook Documentation

**Critical Incident Runbooks**

| Incident Type | Detection Method | Investigation Steps | Mitigation Actions |
|---|---|---|---|
| **API Downtime** | Health check failure | Check Vercel status, review logs | Restart functions, failover |
| **Database Issues** | Connection timeouts | Check Supabase dashboard | Scale resources, optimize queries |
| **External API Failure** | Polymarket API errors | Verify API status | Enable cached data fallback |
| **High Error Rate** | Error monitoring | Analyze error patterns | Rollback deployment, fix bugs |

**Standard Operating Procedures**

```typescript
// Incident response automation
class IncidentManager {
  async handleCriticalAlert(alert: Alert) {
    // 1. Create incident channel
    await this.createSlackChannel(`incident-${alert.id}`)
    
    // 2. Notify on-call engineer
    await this.notifyOnCall(alert)
    
    // 3. Start incident timeline
    await this.logIncidentEvent(alert.id, 'incident_started', {
      severity: alert.severity,
      component: alert.component
    })
    
    // 4. Execute automated mitigation if available
    if (alert.autoMitigation) {
      await this.executeAutoMitigation(alert)
    }
  }
  
  async resolveIncident(incidentId: string, resolution: string) {
    // 1. Update incident status
    await this.updateIncidentStatus(incidentId, 'resolved')
    
    // 2. Schedule post-mortem
    await this.schedulePostMortem(incidentId)
    
    // 3. Update stakeholders
    await this.notifyResolution(incidentId, resolution)
  }
}
```

### 6.5.8 Capacity Planning and Scaling Metrics

#### Resource Utilization Tracking

**Current Capacity Metrics**

| Resource Type | Current Usage | Capacity Limit | Utilization | Scale Trigger |
|---|---|---|---|---|
| **Vercel Functions** | ~100 executions/day | 100K/month (Hobby) | < 1% | > 80% |
| **Supabase Database** | 50MB storage | 500MB (Free) | 10% | > 70% |
| **API Requests** | ~1K requests/day | Unlimited | N/A | Response time degradation |
| **Bandwidth** | 5GB/month | 100GB (Hobby) | 5% | > 80% |

**Growth Projection Monitoring**

```mermaid
graph LR
    subgraph "Usage Trends"
        USERS[Daily Active Users<br/>Current: 50, Target: 500]
        WORKFLOWS[Workflow Executions<br/>Current: 100/week, Target: 10K/week]
        DATA[Data Storage<br/>Current: 50MB, Target: 8GB]
    end
    
    subgraph "Scaling Triggers"
        USER_SCALE[User Growth > 80% of limit<br/>Upgrade to Pro plan]
        EXEC_SCALE[Execution Growth > 1K/day<br/>Optimize performance]
        STORAGE_SCALE[Storage > 400MB<br/>Upgrade database tier]
    end
    
    USERS --> USER_SCALE
    WORKFLOWS --> EXEC_SCALE
    DATA --> STORAGE_SCALE
```

#### Predictive Scaling Metrics

**Forecasting Models**

| Metric | Current Trend | 30-Day Projection | Scaling Action Required |
|---|---|---|---|
| **User Growth** | +15% weekly | 200 DAU | Monitor, no action needed |
| **API Calls** | +25% weekly | 5K requests/day | Optimize caching |
| **Database Size** | +10MB weekly | 180MB | Plan Pro upgrade |
| **Workflow Executions** | +50% weekly | 800/week | Performance optimization |

### 6.5.9 Business Intelligence Monitoring

#### Product Analytics Integration

**User Behavior Tracking**

CASCADIAN tracks key user interactions to understand product usage and optimize features:

| Event Category | Specific Events | Collection Method | Analysis Purpose |
|---|---|---|---|
| **Feature Adoption** | Market screener usage, workflow creation | Custom events | Product optimization |
| **User Journey** | Sign-up to first workflow execution | Funnel analysis | Conversion optimization |
| **Performance Impact** | Slow page loads affecting user actions | Correlation analysis | UX improvement |
| **Error Impact** | Errors leading to user abandonment | Error tracking | Quality improvement |

**Business Metrics Dashboard**

```mermaid
graph TB
    subgraph "User Metrics"
        DAU[Daily Active Users<br/>Target: 500 by Month 3]
        RETENTION[30-Day Retention<br/>Target: 60%]
        SESSION[Avg Session Duration<br/>Target: 15+ minutes]
    end
    
    subgraph "Product Metrics"
        WORKFLOWS[Workflow Executions<br/>Target: 10K/week]
        WIN_RATE[Strategy Win Rate<br/>Target: 55%+]
        FEATURES[Feature Adoption<br/>Target: 70% use 3+ features]
    end
    
    subgraph "Technical Metrics"
        UPTIME[System Uptime<br/>Target: 99.5%]
        PERFORMANCE[API Performance<br/>Target: 95% < 200ms]
        SYNC[Data Sync Success<br/>Target: 98%+]
    end
    
    DAU --> WORKFLOWS
    RETENTION --> WIN_RATE
    SESSION --> FEATURES
    WORKFLOWS --> UPTIME
    WIN_RATE --> PERFORMANCE
    FEATURES --> SYNC
```

#### Revenue and Growth Tracking

**Future Monetization Metrics** (Phase 4+)

| Metric Category | Key Indicators | Measurement Method | Business Impact |
|---|---|---|---|
| **Subscription Growth** | MRR, churn rate, upgrades | Billing system integration | Revenue forecasting |
| **API Usage** | API calls per tier, overage charges | Usage-based billing | Pricing optimization |
| **Marketplace Revenue** | Strategy sales, commission earned | Transaction tracking | Platform monetization |
| **Customer Success** | NPS, support tickets, feature requests | Customer feedback systems | Product roadmap |

### 6.5.10 Future Observability Enhancements

#### Planned Integrations (Phase 3-4)

**Advanced Monitoring Stack**

Drains give you a single way to stream observability data out of Vercel and into the systems your team already rely on. Most teams already have an observability stack they trust like Datadog, Honeycomb, Grafana, Elastic, or their own warehouses. Since traces follow the OpenTelemetry protocol, they plug directly into Datadog APM, Honeycomb, Grafana Tempo, New Relic, or any vendor that supports OTel, with no custom instrumentation needed.

**Vercel Drains Integration**

Phase 3 will implement Vercel Drains for unified observability data export:

```typescript
// Future Vercel Drains configuration
const drainsConfig = {
  // Export traces to external observability platform
  traces: {
    destination: 'https://api.honeycomb.io/1/batch',
    format: 'otlp',
    sampling: {
      rate: 0.1, // 10% sampling for high-volume endpoints
      rules: [
        { path: '/api/execute-workflow', rate: 1.0 }, // 100% for workflows
        { path: '/api/polymarket/sync', rate: 1.0 }   // 100% for sync
      ]
    }
  },
  
  // Export logs to centralized logging
  logs: {
    destination: 'https://logs.datadoghq.com/v1/input',
    format: 'json',
    filters: ['error', 'warn'] // Only export warnings and errors
  },
  
  // Export analytics to data warehouse
  analytics: {
    destination: 'https://api.segment.com/v1/batch',
    format: 'segment'
  }
}
```

**Machine Learning-Powered Monitoring**

Phase 4+ will introduce AI-powered observability:

- **Anomaly Detection** - ML models to identify unusual patterns in metrics
- **Predictive Alerting** - Forecast potential issues before they occur
- **Root Cause Analysis** - Automated correlation of symptoms to causes
- **Performance Optimization** - AI-driven recommendations for improvements

#### Observability Maturity Roadmap

| Phase | Timeline | Capabilities | Tools |
|---|---|---|---|
| **Phase 1** (Current) | Months 1-3 | Basic monitoring, manual analysis | Vercel Analytics, Supabase Dashboard |
| **Phase 2** | Months 4-6 | Structured logging, custom metrics | OpenTelemetry, custom instrumentation |
| **Phase 3** | Months 7-9 | Distributed tracing, external integration | Vercel Drains, Grafana/DataDog |
| **Phase 4** | Months 10-12 | AI-powered insights, predictive monitoring | ML models, automated optimization |

This comprehensive monitoring and observability architecture ensures CASCADIAN maintains high availability, optimal performance, and excellent user experience while providing the insights needed for continuous improvement and scaling.

## 6.6 Testing Strategy

### 6.6.1 Testing Strategy Overview

CASCADIAN implements a **comprehensive multi-layer testing strategy** designed specifically for modern Next.js 15 applications with React Server Components, serverless API routes, and complex workflow automation systems. The testing approach follows industry best practices while addressing the unique challenges of prediction market intelligence platforms.

#### Testing Philosophy

The testing strategy targets 80% or higher code coverage and emphasizes that testing is an investment in application quality and maintainability - the time spent writing good tests will pay off many times over in reduced bugs and easier maintenance.

**Core Testing Principles**:

1. **User-Centric Testing** - Test behavior, not implementation: Focus on what the user sees and does, not internal component methods
2. **Reliability First** - Mock external dependencies: Always mock API calls, browser APIs, and third-party libraries to ensure test reliability
3. **Descriptive Testing** - Use descriptive test names that tell a story about functionality being verified, and structure tests clearly with Arrange, Act, Assert pattern
4. **Edge Case Coverage** - Test edge cases: Don't just test the happy path. Test error states, network failures, and edge conditions

#### Testing Pyramid Architecture

```mermaid
graph TB
    subgraph "Testing Pyramid"
        E2E[End-to-End Tests<br/>Playwright<br/>~10% of tests]
        INTEGRATION[Integration Tests<br/>Vitest + MSW<br/>~20% of tests]
        UNIT[Unit Tests<br/>Vitest + React Testing Library<br/>~70% of tests]
    end
    
    subgraph "Test Types by Layer"
        E2E --> E2E_TESTS[User Workflows<br/>Cross-browser Testing<br/>API Integration]
        INTEGRATION --> INT_TESTS[Component Integration<br/>API Route Testing<br/>Database Operations]
        UNIT --> UNIT_TESTS[Component Logic<br/>Utility Functions<br/>Business Logic]
    end
    
    style E2E fill:#ff6b6b,color:#fff
    style INTEGRATION fill:#4ecdc4,color:#fff
    style UNIT fill:#45b7d1,color:#fff
```

### 6.6.2 Testing Framework Selection

#### Primary Testing Stack

Based on current industry trends and Next.js 15 compatibility, CASCADIAN adopts the following testing stack:

| Test Type | Framework | Justification | Version |
|---|---|---|---|
| **Unit Testing** | Vitest + React Testing Library | Vitest shows 4x faster execution times compared to Jest and has become the preferred choice for Next.js due to its lightweight, blazing-fast, performant, and dev-first experience | Vitest 2.1.6+ |
| **Component Testing** | React Testing Library | Provides utility functions to test React components in a way that resembles how software is used by users, with virtual DOMs and utilities for querying the DOM | @testing-library/react 16.0.1+ |
| **E2E Testing** | Playwright | Playwright offers advanced features like multi-user simulation and runs tests outside the browser with better scalability compared to Cypress | Playwright 1.40+ |
| **API Testing** | Vitest + MSW | Mock Service Worker for API mocking | MSW 2.0+ |

#### Framework Comparison Analysis

**Vitest vs Jest**:

According to user experiences and benchmarks, Vitest shows significant performance improvements with test execution times of 3.8s compared to Jest's 15.5s for the same test suite

| Aspect | Vitest | Jest | Decision |
|---|---|---|---|
| **Performance** | 3.8s (100 tests) | 15.5s (100 tests) | ✅ Vitest |
| **Next.js 15 Support** | Native ES modules | Configuration required | ✅ Vitest |
| **Setup Complexity** | Minimal configuration | Complex setup | ✅ Vitest |
| **Migration Effort** | Almost trivial transition from Jest | N/A | ✅ Vitest |

**Playwright vs Cypress**:

Playwright outperformed Cypress with +1.7M weekly npm downloads vs +100K for Cypress, and has 62K+ GitHub stars compared to Cypress's 45K+

| Aspect | Playwright | Cypress | Decision |
|---|---|---|---|
| **Cross-browser Support** | Chromium, Firefox, WebKit | Primarily Chromium | ✅ Playwright |
| **Parallel Execution** | Built-in support for running tests in parallel on multiple browsers and workers | Parallel execution only with paid Cypress Cloud subscription | ✅ Playwright |
| **Performance** | 20 seconds for 103 tests vs Cypress's 2:15 | Slower for large suites | ✅ Playwright |
| **Mobile Testing** | Native mobile emulation | Limited mobile support | ✅ Playwright |

### 6.6.3 Unit Testing Strategy

#### Testing Framework Configuration

**Vitest Configuration** (`vitest.config.ts`):

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        'coverage/**'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
})
```

**Test Setup Configuration** (`test/setup.ts`):

```typescript
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/'
  })
}))

// Mock Supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
      insert: vi.fn(() => Promise.resolve({ data: [], error: null })),
      update: vi.fn(() => Promise.resolve({ data: [], error: null })),
      delete: vi.fn(() => Promise.resolve({ data: [], error: null }))
    }))
  }
}))
```

#### Component Testing Patterns

**React Server Component Testing**:

Since async Server Components are new to the React ecosystem, Vitest currently does not support them. While you can still run unit tests for synchronous Server and Client Components, we recommend using E2E tests for async components

```typescript
// __tests__/components/MarketCard.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarketCard } from '@/components/market-screener-tanstack/MarketCard'

describe('MarketCard Component', () => {
  const mockMarket = {
    market_id: '0x123',
    title: 'Will Bitcoin reach $100k by 2025?',
    category: 'Crypto',
    volume_24h: 50000,
    current_price: 0.65,
    active: true
  }

  it('renders market information correctly', () => {
    render(<MarketCard market={mockMarket} />)
    
    expect(screen.getByText('Will Bitcoin reach $100k by 2025?')).toBeInTheDocument()
    expect(screen.getByText('Crypto')).toBeInTheDocument()
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('65%')).toBeInTheDocument()
  })

  it('handles click events correctly', async () => {
    const user = userEvent.setup()
    const onClickMock = vi.fn()
    
    render(<MarketCard market={mockMarket} onClick={onClickMock} />)
    
    await user.click(screen.getByRole('button'))
    expect(onClickMock).toHaveBeenCalledWith(mockMarket.market_id)
  })
})
```

**Client Component Testing**:

```typescript
// __tests__/components/WorkflowCanvas.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkflowCanvas } from '@/components/workflow-editor/WorkflowCanvas'

// Mock ReactFlow
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, edges, onNodesChange }: any) => (
    <div data-testid="react-flow">
      <div data-testid="nodes-count">{nodes.length}</div>
      <div data-testid="edges-count">{edges.length}</div>
      {children}
    </div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />
}))

describe('WorkflowCanvas Component', () => {
  const mockWorkflow = {
    nodes: [
      { id: '1', type: 'start', position: { x: 0, y: 0 } },
      { id: '2', type: 'end', position: { x: 200, y: 0 } }
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' }
    ]
  }

  it('renders workflow nodes and edges', () => {
    render(<WorkflowCanvas workflow={mockWorkflow} />)
    
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByTestId('nodes-count')).toHaveTextContent('2')
    expect(screen.getByTestId('edges-count')).toHaveTextContent('1')
  })

  it('renders canvas controls', () => {
    render(<WorkflowCanvas workflow={mockWorkflow} />)
    
    expect(screen.getByTestId('background')).toBeInTheDocument()
    expect(screen.getByTestId('controls')).toBeInTheDocument()
    expect(screen.getByTestId('minimap')).toBeInTheDocument()
  })
})
```

#### Business Logic Testing

**Utility Function Testing**:

```typescript
// __tests__/lib/polymarket/utils.test.ts
import { describe, it, expect } from 'vitest'
import { 
  calculateWhaleScore, 
  formatCurrency, 
  extractMarketCategory 
} from '@/lib/polymarket/utils'

describe('Polymarket Utils', () => {
  describe('calculateWhaleScore', () => {
    it('calculates whale score correctly for large positions', () => {
      const walletData = {
        totalVolume: 100000,
        winRate: 0.75,
        sharpeRatio: 1.5,
        positionCount: 25
      }
      
      const score = calculateWhaleScore(walletData)
      expect(score).toBeGreaterThan(0.8)
    })

    it('returns low score for small positions', () => {
      const walletData = {
        totalVolume: 1000,
        winRate: 0.45,
        sharpeRatio: 0.2,
        positionCount: 3
      }
      
      const score = calculateWhaleScore(walletData)
      expect(score).toBeLessThan(0.3)
    })
  })

  describe('formatCurrency', () => {
    it('formats large numbers with K suffix', () => {
      expect(formatCurrency(15000)).toBe('$15.0K')
      expect(formatCurrency(1500000)).toBe('$1.5M')
    })

    it('formats small numbers without suffix', () => {
      expect(formatCurrency(500)).toBe('$500')
      expect(formatCurrency(0)).toBe('$0')
    })
  })
})
```

#### Test Organization Structure

**Directory Structure**:

```plaintext
/
├── __tests__/                    # Test files
│   ├── components/               # Component tests
│   │   ├── ui/                  # UI component tests
│   │   ├── market-screener/     # Market screener tests
│   │   ├── workflow-editor/     # Workflow editor tests
│   │   └── whale-activity/      # Whale tracking tests
│   ├── lib/                     # Business logic tests
│   │   ├── polymarket/          # Polymarket integration tests
│   │   ├── workflow/            # Workflow engine tests
│   │   └── utils/               # Utility function tests
│   ├── hooks/                   # Custom hook tests
│   └── pages/                   # Page component tests (E2E preferred)
├── test/                        # Test configuration
│   ├── setup.ts                 # Global test setup
│   ├── mocks/                   # Mock data and functions
│   └── utils/                   # Test utilities
└── vitest.config.ts             # Vitest configuration
```

#### Mocking Strategy

**External API Mocking**:

```typescript
// test/mocks/polymarket.ts
export const mockMarkets = [
  {
    market_id: '0x123',
    title: 'Test Market 1',
    category: 'Politics',
    volume_24h: 10000,
    current_price: 0.55,
    active: true
  }
]

export const mockPolymarketClient = {
  getMarkets: vi.fn(() => Promise.resolve(mockMarkets)),
  getMarket: vi.fn((id: string) => 
    Promise.resolve(mockMarkets.find(m => m.market_id === id))
  ),
  getWalletPositions: vi.fn(() => Promise.resolve([])),
  getOrderBook: vi.fn(() => Promise.resolve({ bids: [], asks: [] }))
}
```

**React Query Mocking**:

```typescript
// test/utils/query-wrapper.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'

export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}
```

#### Code Coverage Requirements

**Coverage Targets**:

| Component Type | Coverage Target | Rationale |
|---|---|---|---|
| **Business Logic** | 90%+ | Critical for platform reliability |
| **UI Components** | 80%+ | Focus on user interactions |
| **Utility Functions** | 95%+ | Pure functions, easy to test |
| **API Routes** | 85%+ | Integration tests preferred |

**Coverage Exclusions**:
- Configuration files (`*.config.*`)
- Type definitions (`*.d.ts`)
- Test files themselves
- Generated code
- Third-party library wrappers

### 6.6.4 Integration Testing Strategy

#### API Route Testing

**Next.js API Route Testing Pattern**:

```typescript
// __tests__/api/polymarket/markets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMocks } from 'node-mocks-http'
import handler from '@/app/api/polymarket/markets/route'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(() => Promise.resolve({
              data: mockMarkets,
              error: null,
              count: 100
            }))
          }))
        }))
      }))
    }))
  }
}))

describe('/api/polymarket/markets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns markets with default filters', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {}
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    const data = JSON.parse(res._getData())
    expect(data.success).toBe(true)
    expect(data.data).toHaveLength(2)
    expect(data.metadata.total).toBe(100)
  })

  it('applies category filter correctly', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { category: 'Politics' }
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    const data = JSON.parse(res._getData())
    expect(data.data.every(m => m.category === 'Politics')).toBe(true)
  })

  it('handles database errors gracefully', async () => {
    // Mock database error
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => Promise.resolve({
        data: null,
        error: { message: 'Database connection failed' }
      }))
    } as any)

    const { req, res } = createMocks({
      method: 'GET',
      query: {}
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(500)
    const data = JSON.parse(res._getData())
    expect(data.success).toBe(false)
    expect(data.error.message).toContain('Database connection failed')
  })
})
```

#### Database Integration Testing

**Supabase Integration Testing**:

```typescript
// __tests__/integration/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Use test database
const supabaseTest = createClient(
  process.env.SUPABASE_TEST_URL!,
  process.env.SUPABASE_TEST_ANON_KEY!
)

describe('Database Integration', () => {
  beforeEach(async () => {
    // Clean test data
    await supabaseTest.from('markets').delete().neq('market_id', '')
    await supabaseTest.from('wallets').delete().neq('address', '')
  })

  afterEach(async () => {
    // Cleanup after tests
    await supabaseTest.from('markets').delete().neq('market_id', '')
  })

  it('inserts and retrieves market data correctly', async () => {
    const testMarket = {
      market_id: '0x123',
      title: 'Test Market',
      category: 'Politics',
      volume_24h: 10000,
      active: true
    }

    // Insert market
    const { error: insertError } = await supabaseTest
      .from('markets')
      .insert(testMarket)

    expect(insertError).toBeNull()

    // Retrieve market
    const { data, error } = await supabaseTest
      .from('markets')
      .select('*')
      .eq('market_id', '0x123')
      .single()

    expect(error).toBeNull()
    expect(data.title).toBe('Test Market')
    expect(data.category).toBe('Politics')
  })

  it('enforces RLS policies correctly', async () => {
    // Test that anonymous users can read markets
    const { data, error } = await supabaseTest
      .from('markets')
      .select('*')
      .limit(1)

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
```

#### Component Integration Testing

**Multi-Component Integration**:

```typescript
// __tests__/integration/market-screener.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MarketScreener } from '@/components/market-screener-tanstack'

// Mock API responses
vi.mock('@/hooks/use-polymarket-markets', () => ({
  usePolymarketMarkets: vi.fn(() => ({
    data: mockMarkets,
    isLoading: false,
    error: null
  }))
}))

describe('Market Screener Integration', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    )
  }

  it('filters markets by category', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MarketScreener />)

    // Wait for markets to load
    await waitFor(() => {
      expect(screen.getByText('Test Market 1')).toBeInTheDocument()
    })

    // Apply category filter
    const categorySelect = screen.getByLabelText('Category')
    await user.selectOptions(categorySelect, 'Politics')

    // Verify filtered results
    await waitFor(() => {
      expect(screen.getByText('Politics Market')).toBeInTheDocument()
      expect(screen.queryByText('Crypto Market')).not.toBeInTheDocument()
    })
  })

  it('sorts markets by volume', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MarketScreener />)

    await waitFor(() => {
      expect(screen.getByText('Test Market 1')).toBeInTheDocument()
    })

    // Click volume header to sort
    const volumeHeader = screen.getByText('Volume (24h)')
    await user.click(volumeHeader)

    // Verify sorting order
    const marketRows = screen.getAllByTestId('market-row')
    expect(marketRows[0]).toHaveTextContent('$50,000')
    expect(marketRows[1]).toHaveTextContent('$10,000')
  })
})
```

#### External Service Mocking

**Mock Service Worker (MSW) Setup**:

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  // Polymarket Gamma API
  http.get('https://gamma-api.polymarket.com/events', () => {
    return HttpResponse.json({
      data: mockEvents,
      next_cursor: null
    })
  }),

  // Polymarket CLOB API
  http.get('https://clob.polymarket.com/order-book', () => {
    return HttpResponse.json({
      bids: [{ price: '0.55', size: '1000' }],
      asks: [{ price: '0.56', size: '800' }]
    })
  }),

  // OpenAI API
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{
        message: {
          content: 'This market shows bullish sentiment based on recent trading activity.'
        }
      }]
    })
  })
]
```

**MSW Server Setup**:

```typescript
// test/setup.ts (addition)
import { beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers'

const server = setupServer(...handlers)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

### 6.6.5 End-to-End Testing Strategy

#### Playwright Configuration

**Playwright Setup** (`playwright.config.ts`):

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }]
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] }
    }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI
  }
})
```

#### E2E Test Scenarios

**Critical User Workflows**:

```typescript
// e2e/market-discovery.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Market Discovery Workflow', () => {
  test('user can discover and filter markets', async ({ page }) => {
    await page.goto('/discovery/screener')

    // Wait for markets to load
    await expect(page.getByTestId('market-table')).toBeVisible()
    await expect(page.getByTestId('market-row')).toHaveCount(10, { timeout: 10000 })

    // Apply category filter
    await page.getByLabel('Category').selectOption('Politics')
    await page.getByRole('button', { name: 'Apply Filters' }).click()

    // Verify filtered results
    await expect(page.getByText('Politics')).toHaveCount(5)
    await expect(page.getByText('Crypto')).toHaveCount(0)

    // Test search functionality
    await page.getByPlaceholder('Search markets...').fill('Bitcoin')
    await page.keyboard.press('Enter')

    await expect(page.getByText('Bitcoin')).toBeVisible()
  })

  test('user can view market details', async ({ page }) => {
    await page.goto('/discovery/screener')
    
    // Click on first market
    await page.getByTestId('market-row').first().click()

    // Verify market detail page
    await expect(page).toHaveURL(/\/analysis\/market\//)
    await expect(page.getByTestId('market-title')).toBeVisible()
    await expect(page.getByTestId('price-chart')).toBeVisible()
    await expect(page.getByTestId('order-book')).toBeVisible()
    await expect(page.getByTestId('holder-rankings')).toBeVisible()
  })
})
```

**Workflow Automation E2E Tests**:

```typescript
// e2e/workflow-automation.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Workflow Automation', () => {
  test('user can create and execute a workflow', async ({ page }) => {
    await page.goto('/strategy-builder')

    // Create new workflow
    await page.getByRole('button', { name: 'New Workflow' }).click()
    await page.getByPlaceholder('Workflow name').fill('Test Strategy')

    // Add nodes to workflow
    await page.getByTestId('node-palette').getByText('Start').dragTo(
      page.getByTestId('workflow-canvas')
    )
    
    await page.getByTestId('node-palette').getByText('Stream Markets').dragTo(
      page.getByTestId('workflow-canvas')
    )

    await page.getByTestId('node-palette').getByText('End').dragTo(
      page.getByTestId('workflow-canvas')
    )

    // Connect nodes
    await page.getByTestId('start-node').hover()
    await page.getByTestId('node-handle-source').dragTo(
      page.getByTestId('stream-markets-node').getByTestId('node-handle-target')
    )

    // Configure Stream Markets node
    await page.getByTestId('stream-markets-node').click()
    await page.getByLabel('Category').selectOption('Politics')
    await page.getByLabel('Limit').fill('5')
    await page.getByRole('button', { name: 'Save Configuration' }).click()

    // Save workflow
    await page.getByRole('button', { name: 'Save Workflow' }).click()
    await expect(page.getByText('Workflow saved successfully')).toBeVisible()

    // Execute workflow
    await page.getByRole('button', { name: 'Run Workflow' }).click()

    // Verify execution
    await expect(page.getByTestId('execution-status')).toHaveText('Running')
    await expect(page.getByTestId('execution-logs')).toBeVisible()

    // Wait for completion
    await expect(page.getByTestId('execution-status')).toHaveText('Completed', {
      timeout: 30000
    })

    // Verify results
    await expect(page.getByTestId('node-output')).toContainText('markets')
  })

  test('workflow handles errors gracefully', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/polymarket/markets', route => {
      route.fulfill({ status: 500, body: 'Server Error' })
    })

    await page.goto('/strategy-builder')
    
    // Load existing workflow
    await page.getByTestId('workflow-library').getByText('Test Strategy').click()
    await page.getByRole('button', { name: 'Run Workflow' }).click()

    // Verify error handling
    await expect(page.getByTestId('execution-status')).toHaveText('Failed', {
      timeout: 10000
    })
    await expect(page.getByTestId('error-message')).toContainText('Server Error')
  })
})
```

**Authentication and Authorization E2E**:

```typescript
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test('user can sign up and sign in', async ({ page }) => {
    // Sign up
    await page.goto('/signup')
    await page.getByLabel('Email').fill('test@example.com')
    await page.getByLabel('Password').fill('TestPassword123!')
    await page.getByLabel('Confirm Password').fill('TestPassword123!')
    await page.getByRole('button', { name: 'Sign Up' }).click()

    // Verify email confirmation message
    await expect(page.getByText('Check your email')).toBeVisible()

    // Sign in (skip email confirmation for test)
    await page.goto('/signin')
    await page.getByLabel('Email').fill('test@example.com')
    await page.getByLabel('Password').fill('TestPassword123!')
    await page.getByRole('button', { name: 'Sign In' }).click()

    // Verify successful login
    await expect(page).toHaveURL('/discovery/screener')
    await expect(page.getByTestId('user-menu')).toBeVisible()
  })

  test('protected routes redirect to signin', async ({ page }) => {
    await page.goto('/strategy-builder')
    await expect(page).toHaveURL('/signin')
    await expect(page.getByText('Sign in to continue')).toBeVisible()
  })
})
```

#### Cross-Browser Testing Strategy

**Browser Coverage Matrix**:

| Browser | Desktop | Mobile | Priority | Coverage |
|---|---|---|---|---|
| **Chrome** | ✅ | ✅ | High | Full test suite |
| **Firefox** | ✅ | ❌ | Medium | Core workflows |
| **Safari** | ✅ | ✅ | Medium | Core workflows |
| **Edge** | ✅ | ❌ | Low | Smoke tests |

**Mobile Testing Approach**:

```typescript
// e2e/mobile.spec.ts
import { test, expect, devices } from '@playwright/test'

test.use({ ...devices['iPhone 13'] })

test.describe('Mobile Experience', () => {
  test('mobile navigation works correctly', async ({ page }) => {
    await page.goto('/discovery/screener')

    // Test mobile menu
    await page.getByTestId('mobile-menu-button').click()
    await expect(page.getByTestId('mobile-menu')).toBeVisible()

    // Navigate to different section
    await page.getByText('Whale Activity').click()
    await expect(page).toHaveURL('/discovery/whale-activity')
  })

  test('responsive table works on mobile', async ({ page }) => {
    await page.goto('/discovery/screener')

    // Verify table is responsive
    await expect(page.getByTestId('market-table')).toBeVisible()
    
    // Test horizontal scrolling
    await page.getByTestId('market-table').scroll({ left: 200 })
    await expect(page.getByText('Volume')).toBeVisible()
  })
})
```

#### Performance Testing Requirements

**Core Web Vitals Testing**:

```typescript
// e2e/performance.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Performance Tests', () => {
  test('page load performance meets targets', async ({ page }) => {
    // Start performance measurement
    await page.goto('/discovery/screener', { waitUntil: 'networkidle' })

    // Measure Core Web Vitals
    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const vitals = {}
          
          entries.forEach((entry) => {
            if (entry.name === 'largest-contentful-paint') {
              vitals.lcp = entry.value
            }
            if (entry.name === 'first-input-delay') {
              vitals.fid = entry.value
            }
            if (entry.name === 'cumulative-layout-shift') {
              vitals.cls = entry.value
            }
          })
          
          resolve(vitals)
        }).observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] })
      })
    })

    // Assert performance targets
    expect(vitals.lcp).toBeLessThan(2500) // LCP < 2.5s
    expect(vitals.fid).toBeLessThan(100)  // FID < 100ms
    expect(vitals.cls).toBeLessThan(0.1)  // CLS < 0.1
  })

  test('API response times are acceptable', async ({ page }) => {
    // Monitor network requests
    const responses = []
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        responses.push({
          url: response.url(),
          status: response.status(),
          timing: response.timing()
        })
      }
    })

    await page.goto('/discovery/screener')
    await page.waitForLoadState('networkidle')

    // Verify API response times
    const apiResponses = responses.filter(r => r.url.includes('/api/polymarket/markets'))
    expect(apiResponses.length).toBeGreaterThan(0)
    
    apiResponses.forEach(response => {
      expect(response.status).toBe(200)
      expect(response.timing.responseEnd - response.timing.requestStart).toBeLessThan(1000)
    })
  })
})
```

### 6.6.6 Test Automation and CI/CD Integration

#### GitHub Actions Workflow

**Comprehensive Testing Pipeline** (`.github/workflows/test.yml`):

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run unit tests
        run: pnpm test:unit --coverage
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/coverage-final.json
          flags: unit-tests

  integration-tests:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: cascadian_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run database migrations
        run: pnpm supabase:migrate
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/cascadian_test
      
      - name: Run integration tests
        run: pnpm test:integration
        env:
          SUPABASE_TEST_URL: http://localhost:54321
          SUPABASE_TEST_ANON_KEY: ${{ secrets.SUPABASE_TEST_ANON_KEY }}

  e2e-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Install Playwright browsers
        run: pnpm playwright install --with-deps
      
      - name: Build application
        run: pnpm build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      
      - name: Run E2E tests
        run: pnpm test:e2e
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      
      - name: Upload Playwright report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

  security-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run security audit
        run: pnpm audit --audit-level moderate
      
      - name: Run dependency check
        uses: securecodewarrior/github-action-add-sarif@v1
        with:
          sarif-file: 'security-report.sarif'
```

#### Test Execution Flow

```mermaid
flowchart TD
    START[Code Push/PR] --> LINT[ESLint & Prettier]
    LINT --> TYPE[TypeScript Check]
    TYPE --> UNIT[Unit Tests<br/>Vitest + RTL]
    
    UNIT --> UNIT_PASS{Unit Tests Pass?}
    UNIT_PASS -->|No| FAIL[❌ Pipeline Fails]
    UNIT_PASS -->|Yes| INTEGRATION[Integration Tests<br/>API + Database]
    
    INTEGRATION --> INT_PASS{Integration Pass?}
    INT_PASS -->|No| FAIL
    INT_PASS -->|Yes| BUILD[Build Application]
    
    BUILD --> BUILD_PASS{Build Success?}
    BUILD_PASS -->|No| FAIL
    BUILD_PASS -->|Yes| E2E[E2E Tests<br/>Playwright]
    
    E2E --> E2E_PASS{E2E Tests Pass?}
    E2E_PASS -->|No| FAIL
    E2E_PASS -->|Yes| SECURITY[Security Audit]
    
    SECURITY --> SEC_PASS{Security Pass?}
    SEC_PASS -->|No| FAIL
    SEC_PASS -->|Yes| SUCCESS[✅ Pipeline Success]
    
    SUCCESS --> DEPLOY[Deploy to Staging]
    
    style FAIL fill:#ff6b6b,color:#fff
    style SUCCESS fill:#51cf66,color:#fff
    style DEPLOY fill:#339af0,color:#fff
```

#### Parallel Test Execution

**Test Parallelization Strategy**:

```typescript
// vitest.config.ts (parallel configuration)
export default defineConfig({
  test: {
    // Run tests in parallel
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
        useAtomics: true
      }
    },
    // Separate test files by type for better parallelization
    include: [
      'src/**/*.{test,spec}.{js,ts,tsx}',
      '__tests__/**/*.{test,spec}.{js,ts,tsx}'
    ],
    // Configure test timeouts
    testTimeout: 10000,
    hookTimeout: 10000
  }
})
```

**Playwright Parallel Configuration**:

```typescript
// playwright.config.ts (parallel settings)
export default defineConfig({
  // Run tests in parallel
  fullyParallel: true,
  
  // Configure workers based on environment
  workers: process.env.CI ? 2 : undefined,
  
  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,
  
  // Shard tests across multiple machines in CI
  shard: process.env.CI ? { current: 1, total: 4 } : undefined
})
```

#### Test Reporting and Metrics

**Coverage Reporting**:

```typescript
// vitest.config.ts (coverage configuration)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        'coverage/**',
        'e2e/**'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        },
        // Stricter thresholds for critical components
        'src/lib/polymarket/': {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90
        }
      }
    }
  }
})
```

**Test Results Dashboard**:

| Metric | Target | Current | Status |
|---|---|---|---|
| **Unit Test Coverage** | 80% | 85% | ✅ |
| **Integration Coverage** | 70% | 75% | ✅ |
| **E2E Test Success Rate** | 95% | 97% | ✅ |
| **Test Execution Time** | < 5 minutes | 3.2 minutes | ✅ |
| **Flaky Test Rate** | < 2% | 1.1% | ✅ |

#### Failed Test Handling

**Automatic Retry Strategy**:

```typescript
// playwright.config.ts (retry configuration)
export default defineConfig({
  // Retry failed tests
  retries: process.env.CI ? 2 : 0,
  
  // Configure retry behavior
  use: {
    // Take screenshot on failure
    screenshot: 'only-on-failure',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Capture trace on retry
    trace: 'on-first-retry'
  }
})
```

**Flaky Test Management**:

```typescript
// e2e/utils/test-helpers.ts
export async function retryOnFlaky<T>(
  testFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await testFn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt === maxRetries) {
        throw lastError
      }
      
      // Wait before retry with exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      )
    }
  }
  
  throw lastError!
}
```

### 6.6.7 Quality Metrics and Gates

#### Code Coverage Targets

**Coverage Requirements by Component Type**:

| Component Category | Line Coverage | Branch Coverage | Function Coverage | Rationale |
|---|---|---|---|---|
| **Business Logic** | 90% | 85% | 95% | Critical for platform reliability |
| **API Routes** | 85% | 80% | 90% | Core functionality |
| **UI Components** | 80% | 75% | 85% | User-facing features |
| **Utility Functions** | 95% | 90% | 100% | Pure functions, easy to test |

#### Test Success Rate Requirements

**Quality Gates**:

| Test Type | Success Rate Target | Blocking Threshold | Action on Failure |
|---|---|---|---|
| **Unit Tests** | 100% | 99% | Block deployment |
| **Integration Tests** | 98% | 95% | Block deployment |
| **E2E Tests** | 95% | 90% | Block deployment |
| **Security Tests** | 100% | 100% | Block deployment |

#### Performance Test Thresholds

**Performance Quality Gates**:

| Metric | Target | Warning Threshold | Blocking Threshold |
|---|---|---|---|
| **Page Load Time** | < 2s | 3s | 5s |
| **API Response Time** | < 200ms | 500ms | 1s |
| **Test Execution Time** | < 5 minutes | 7 minutes | 10 minutes |
| **Bundle Size** | < 500KB | 750KB | 1MB |

#### Documentation Requirements

**Test Documentation Standards**:

1. **Test Case Documentation**:
   - Clear test descriptions following Given-When-Then pattern
   - Business value explanation for each test scenario
   - Expected behavior documentation

2. **Test Data Management**:
   - Documented test data setup and teardown procedures
   - Mock data that represents realistic scenarios
   - Clear separation between test and production data

3. **Test Environment Documentation**:
   - Environment setup instructions
   - Dependency requirements and versions
   - Configuration management procedures

#### Test Environment Architecture

```mermaid
graph TB
    subgraph "Development Environment"
        DEV_LOCAL[Local Development<br/>localhost:3000]
        DEV_DB[Local Supabase<br/>Docker Container]
        DEV_MOCKS[MSW Mocks<br/>API Responses]
    end
    
    subgraph "Test Environment"
        TEST_DB[Test Database<br/>Isolated Schema]
        TEST_API[Test API Routes<br/>Mocked External APIs]
        TEST_BROWSER[Playwright Browsers<br/>Chromium, Firefox, WebKit]
    end
    
    subgraph "CI/CD Environment"
        CI_RUNNER[GitHub Actions<br/>Ubuntu Latest]
        CI_DB[PostgreSQL Service<br/>Docker Container]
        CI_CACHE[Dependency Cache<br/>pnpm + Playwright]
    end
    
    DEV_LOCAL --> TEST_API
    DEV_DB --> TEST_DB
    DEV_MOCKS --> TEST_API
    
    TEST_DB --> CI_DB
    TEST_API --> CI_RUNNER
    TEST_BROWSER --> CI_RUNNER
    
    CI_RUNNER --> CI_CACHE
```

#### Test Data Flow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Local as Local Environment
    participant CI as CI Pipeline
    participant Test as Test Database
    participant Prod as Production
    
    Dev->>Local: Write tests with mock data
    Dev->>Local: Run unit tests locally
    Local-->>Dev: Test results
    
    Dev->>CI: Push code changes
    CI->>Test: Setup test database
    CI->>Test: Run migrations
    CI->>CI: Execute test suite
    
    alt Tests Pass
        CI->>Prod: Deploy to staging
        CI-->>Dev: Success notification
    else Tests Fail
        CI-->>Dev: Failure notification
        CI->>CI: Generate test reports
    end
    
    CI->>Test: Cleanup test data
```

This comprehensive testing strategy ensures CASCADIAN maintains high quality, reliability, and performance while supporting rapid development and deployment cycles. The multi-layer approach provides confidence in both individual components and the integrated system as a whole.

# 7. User Interface Design

## 7.1 Core UI Technologies

CASCADIAN employs a **modern React-based UI architecture** built on Next.js 15 App Router with a sophisticated design system that prioritizes accessibility, performance, and developer experience.

### 7.1.1 Primary UI Technology Stack

| Technology | Version | Purpose | Justification |
|---|---|---|---|
| **Next.js App Router** | 15.5 | Server-first rendering with React Server Components by default, fine-grained caching, and streaming | Treat the server as your primary rendering surface, ship minimal client JS, and control freshness explicitly |
| **React** | 19.2.0 | Component-based UI library | Latest stable version with improved hydration and performance |
| **TypeScript** | 5.8.3 | Type safety and developer experience | Strong typing for large-scale application development |
| **TailwindCSS** | 4.1 | Utility-first CSS framework | Tailwind gives you the basic styles you need, like utility classes and layout tokens |
| **shadcn/ui + Radix UI** | Latest | Accessible component primitives | Built on top of Radix UI's accessible primitives and styled with Tailwind CSS, shadcn/ui represents the perfect balance between developer experience and design flexibility |
| **ReactFlow** | 12.x | Visual workflow editor | Built with React Flow UI and styled using Tailwind CSS and shadcn/ui, this project provides a highly customizable foundation for building and extending workflow editors |

### 7.1.2 Component Architecture Strategy

Pattern: Keep most UI as server components; isolate interactivity in small client islands imported inside server components

**Server Components (Default)**:
- Render on the server, ship no client JS, can read secrets, talk to DB/APIs directly, and await in JSX
- Not allowed: useState, useEffect, DOM APIs (window, document), event handlers
- Used for: Market data display, whale intelligence dashboards, portfolio analytics

**Client Components**:
- Add "use client" at the top of the file; render on server then hydrate on the client; you can use state/effects/events and browser APIs
- Used for: Interactive forms, workflow canvas, real-time updates, user interactions

### 7.1.3 Design System Foundation

ShadCN UI (often written simply as shadcn/ui) is a set of open-source React component templates that sit on top of Radix UI primitives and Tailwind CSS utilities

**Design System Layers**:

```mermaid
graph TB
    subgraph "Design System Architecture"
        TOKENS[Design Tokens<br/>Colors, Typography, Spacing]
        PRIMITIVES[Radix UI Primitives<br/>Accessible, Unstyled Components]
        SHADCN[shadcn/ui Components<br/>Styled, Production-Ready]
        CUSTOM[Custom Components<br/>Feature-Specific UI]
    end
    
    TOKENS --> PRIMITIVES
    PRIMITIVES --> SHADCN
    SHADCN --> CUSTOM
    
    style TOKENS fill:#4caf50,color:#fff
    style PRIMITIVES fill:#2196f3,color:#fff
    style SHADCN fill:#ff9800,color:#fff
    style CUSTOM fill:#9c27b0,color:#fff
```

**Key Benefits**:
- Instead of installing a package, you copy and paste components directly into your codebase. This means you own the code, you control the styling, and you can customize everything to match your exact needs
- Radix first - behaviour comes from Radix primitives (Dialog, Popover, ScrollArea) which have battle-tested accessibility
- Total control, no runtime dependency surprises, and a small bundle surface (just the components you need are in your source)

## 7.2 UI Use Cases

### 7.2.1 Primary User Workflows

CASCADIAN's UI supports four core user workflows, each with distinct interface requirements:

#### Market Discovery & Intelligence
**User Goal**: Find profitable prediction markets through advanced filtering and whale intelligence

**UI Components**:
- **Market Screener**: TanStack Table with virtual scrolling for 1000+ markets
- **Advanced Filters**: Multi-select dropdowns, range sliders, date pickers
- **Market Detail View**: OHLC charts, order book visualization, holder rankings
- **Real-time Updates**: Live price feeds, volume changes, new market alerts

#### Whale Intelligence Tracking
**User Goal**: Follow smart money flows and insider activity

**UI Components**:
- **Whale Dashboard**: Real-time position tracking, concentration metrics
- **Leaderboard**: Sortable rankings by Sharpe ratio, ROI, win rate
- **Position Flow Visualization**: Sankey diagrams showing money flows
- **Alert System**: Toast notifications for large position changes

#### Visual Workflow Automation
**User Goal**: Build and execute trading strategies without coding

**UI Components**:
- **ReactFlow Canvas**: Customizable Components: Uses React Flow UI and the shadcn library to create highly-customizable nodes and edges. Dark Mode: Toggles between light and dark themes, managed through the Zustand store. Runner Functionality: Executes and monitors nodes sequentially with a workflow runner
- **Node Palette**: Drag-and-drop node library with categories
- **Configuration Panels**: Dynamic forms based on node type
- **Execution Monitor**: Real-time streaming logs and status indicators

#### Portfolio Analytics
**User Goal**: Track performance and optimize trading strategies

**UI Components**:
- **Portfolio Dashboard**: P&L charts, performance metrics, risk analysis
- **Position Table**: Sortable, filterable position list with real-time updates
- **Performance Charts**: Time-series visualizations using ECharts
- **Activity Timeline**: Chronological trade and position history

### 7.2.2 Responsive Design Strategy

**Breakpoint System** (TailwindCSS):

| Breakpoint | Width | Primary Use Case | UI Adaptations |
|---|---|---|---|
| `sm` | 640px+ | Mobile landscape | Single column, collapsed sidebar |
| `md` | 768px+ | Tablet portrait | Two columns, drawer navigation |
| `lg` | 1024px+ | Tablet landscape | Three columns, persistent sidebar |
| `xl` | 1280px+ | Desktop | Full layout, all panels visible |
| `2xl` | 1536px+ | Large desktop | Expanded charts, additional data |

**Mobile-First Approach**:
- Base styles target mobile devices
- Progressive enhancement for larger screens
- Touch-friendly interactions (44px minimum touch targets)
- Swipe gestures for navigation and actions

## 7.3 UI/Backend Interaction Boundaries

### 7.3.1 Data Flow Architecture

CASCADIAN implements a **hybrid server-client data flow** that optimizes for both performance and user experience:

```mermaid
sequenceDiagram
    participant User
    participant Client as Client Components
    participant Server as Server Components
    participant API as API Routes
    participant DB as Database
    participant External as External APIs
    
    Note over User,External: Initial Page Load (SSR)
    User->>Server: Navigate to /discovery/screener
    Server->>API: Fetch market data
    API->>DB: Query markets table
    DB-->>API: Market data
    API-->>Server: JSON response
    Server-->>User: Rendered HTML + hydration data
    
    Note over User,External: Client Interactions
    User->>Client: Apply filters
    Client->>API: GET /api/polymarket/markets?filters
    API->>DB: Filtered query
    DB-->>API: Results
    API-->>Client: JSON response
    Client-->>User: Updated UI
    
    Note over User,External: Real-time Updates
    API->>External: Background sync
    External-->>API: Fresh data
    API->>DB: UPSERT operations
    DB->>Client: Real-time subscription
    Client-->>User: Live updates
```

### 7.3.2 State Management Boundaries

**Server State** (TanStack Query):
- Market data, whale intelligence, portfolio analytics
- 5-minute stale time for markets, 30-second for wallets
- Automatic background refetching and cache invalidation
- Optimistic updates for immediate user feedback

**Client State** (React Context + useState):
- UI state: theme, modals, notifications, loading states
- Form state: filters, search queries, user inputs
- Navigation state: active tabs, sidebar collapse, breadcrumbs

**URL State** (Next.js Router):
- Filter parameters, pagination, sorting preferences
- Shareable URLs for specific market views or strategies
- Browser history integration for back/forward navigation

### 7.3.3 API Integration Patterns

**RESTful API Design**:

```typescript
// Standardized API response format
interface APIResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  metadata?: {
    total?: number
    page?: number
    limit?: number
    stale?: boolean
    last_synced?: string
  }
}

// Example: Market screener API call
const { data: markets, isLoading, error } = useQuery({
  queryKey: ['markets', filters],
  queryFn: () => fetchMarkets(filters),
  staleTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true
})
```

**Streaming API Integration** (Server-Sent Events):

```typescript
// Workflow execution streaming
const useWorkflowExecution = (workflowId: string) => {
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    currentNode: null,
    logs: [],
    outputs: {}
  })

  useEffect(() => {
    const eventSource = new EventSource(`/api/execute-workflow/${workflowId}/stream`)
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setExecutionState(prev => ({
        ...prev,
        ...data
      }))
    }

    return () => eventSource.close()
  }, [workflowId])

  return executionState
}
```

## 7.4 UI Schemas

### 7.4.1 Component Schema Definitions

CASCADIAN uses **Zod schemas** for type-safe UI component props and form validation:

```typescript
// Market screener filter schema
const MarketFiltersSchema = z.object({
  category: z.enum(['Politics', 'Sports', 'Crypto', 'Finance', 'Science', 'Culture']).optional(),
  active: z.boolean().default(true),
  volumeMin: z.number().min(0).default(0),
  volumeMax: z.number().min(0).optional(),
  liquidityMin: z.number().min(0).default(0),
  priceMin: z.number().min(0).max(1).optional(),
  priceMax: z.number().min(0).max(1).optional(),
  endDateFrom: z.date().optional(),
  endDateTo: z.date().optional(),
  search: z.string().max(100).optional(),
  sortBy: z.enum(['volume_24h', 'liquidity', 'current_price', 'end_date']).default('volume_24h'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0)
})

type MarketFilters = z.infer<typeof MarketFiltersSchema>
```

```typescript
// Workflow node configuration schema
const WorkflowNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['start', 'end', 'javascript', 'http-request', 'conditional', 'polymarket-stream', 'polymarket-filter', 'llm-analysis']),
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  data: z.object({
    label: z.string(),
    config: z.record(z.any()).optional()
  }),
  style: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional()
  }).optional()
})

const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional()
  })),
  variables: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
  isTemplate: z.boolean().default(false),
  isPublic: z.boolean().default(false)
})
```

### 7.4.2 Form Validation Schemas

**React Hook Form Integration**:

```typescript
// User settings form schema
const UserSettingsSchema = z.object({
  profile: z.object({
    displayName: z.string().min(2).max(50),
    email: z.string().email(),
    avatar: z.string().url().optional()
  }),
  preferences: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    notifications: z.object({
      whaleAlerts: z.boolean().default(true),
      marketUpdates: z.boolean().default(false),
      workflowResults: z.boolean().default(true),
      weeklyDigest: z.boolean().default(true)
    }),
    defaultFilters: MarketFiltersSchema.partial(),
    timezone: z.string().default('UTC')
  }),
  apiKeys: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(50),
    service: z.enum(['polymarket', 'openai', 'anthropic']),
    keyPreview: z.string(),
    createdAt: z.date(),
    lastUsed: z.date().optional()
  })).optional()
})

// Usage in form component
const SettingsForm = () => {
  const form = useForm<z.infer<typeof UserSettingsSchema>>({
    resolver: zodResolver(UserSettingsSchema),
    defaultValues: {
      preferences: {
        theme: 'system',
        notifications: {
          whaleAlerts: true,
          marketUpdates: false,
          workflowResults: true,
          weeklyDigest: true
        }
      }
    }
  })

  const onSubmit = (data: z.infer<typeof UserSettingsSchema>) => {
    // Type-safe form submission
    updateUserSettings(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Form fields */}
      </form>
    </Form>
  )
}
```

## 7.5 Screens Required

### 7.5.1 Core Application Screens

Based on the repository structure and product specification, CASCADIAN implements the following screen hierarchy:

#### Authentication Screens
- **Sign In** (`/signin`) - Email/password authentication with Supabase Auth
- **Sign Up** (`/signup`) - User registration with email verification
- **Password Reset** - Forgot password flow with email recovery

#### Dashboard Layout (`/(dashboard)`)
All protected routes use a consistent dashboard layout with:
- **Persistent Sidebar** - Navigation menu with feature categories
- **Top Bar** - User menu, search, notifications, theme toggle
- **Main Content Area** - Dynamic content based on route
- **Breadcrumb Navigation** - Contextual navigation path

#### Market Discovery Screens
- **Market Screener** (`/discovery/screener`) - Primary market filtering and discovery interface
- **Market Detail** (`/analysis/market/[id]`) - Individual market deep-dive with charts and analytics
- **Events Overview** (`/events`) - Browse Polymarket events with nested markets
- **Event Detail** (`/events/[slug]`) - Specific event with related markets
- **Market Category Map** (`/discovery/map`) - Visual categorization of markets

#### Whale Intelligence Screens
- **Whale Activity Dashboard** (`/discovery/whale-activity`) - Real-time whale position tracking
- **Whale Discovery** (`/discovery/whales`) - Browse and filter whale wallets
- **PnL Leaderboard** (`/discovery/leaderboard`) - Rankings by performance metrics
- **Insider Signals** (`/insiders`) - Detected insider trading activity

#### Portfolio & Analytics Screens
- **My Analytics** (`/my-analytics`) - Personal trading performance dashboard
- **My Assets** (`/my-assets`) - Portfolio positions and P&L tracking
- **Wallet Analysis** (`/analysis/wallet/[address]`) - Detailed wallet intelligence view

#### Strategy & Automation Screens
- **Strategy Builder** (`/strategy-builder`) - Visual workflow editor with ReactFlow canvas
- **Strategy Library** (`/strategies`) - Browse saved and template strategies
- **Strategy Detail** (`/strategies/[id]`) - Individual strategy configuration and performance
- **Strategy Marketplace** (`/strategies-marketplace`) - Community strategy sharing

#### Intelligence & Signals Screens
- **Intelligence Signals** (`/intelligence-signals`) - AI-powered market signals dashboard
- **Trading Interface** (`/trading`) - Manual order placement and execution

#### User Management Screens
- **Settings** (`/settings`) - User preferences, API keys, notifications
- **Subscription** (`/subscription`) - Billing and plan management
- **Help Center** (`/help-center`) - Documentation and support
- **Invite Friends** (`/invite-friends`) - Referral program

### 7.5.2 Screen Component Architecture

Each screen follows a consistent component structure:

```typescript
// Example: Market Screener Screen
export default function MarketScreenerPage() {
  return (
    <DashboardLayout>
      <PageHeader 
        title="Market Screener"
        description="Discover and analyze 1000+ prediction markets"
        actions={<SyncButton />}
      />
      
      <div className="space-y-6">
        <MarketFilters />
        <MarketTable />
        <Pagination />
      </div>
    </DashboardLayout>
  )
}

// Example: Strategy Builder Screen
export default function StrategyBuilderPage() {
  return (
    <DashboardLayout>
      <div className="h-full flex">
        <NodePalette className="w-64 border-r" />
        <div className="flex-1 flex flex-col">
          <StrategyToolbar />
          <WorkflowCanvas className="flex-1" />
        </div>
        <ExecutionPanel className="w-80 border-l" />
      </div>
    </DashboardLayout>
  )
}
```

## 7.6 User Interactions

### 7.6.1 Primary Interaction Patterns

#### Market Discovery Interactions
**Filter Application**:
- **Multi-select dropdowns** for categories with search functionality
- **Range sliders** for volume and liquidity thresholds
- **Date pickers** for market end dates with preset ranges
- **Real-time search** with debounced input (300ms delay)
- **Filter persistence** in URL parameters for shareable links

**Market Selection**:
- **Click to view details** - Navigate to market detail page
- **Hover for quick preview** - Tooltip with key metrics
- **Bulk selection** - Checkbox selection for batch operations
- **Keyboard navigation** - Arrow keys and Enter for accessibility

#### Workflow Builder Interactions
**Node Manipulation**:
- **Drag from palette** - Add new nodes to canvas
- **Drag to reposition** - Move nodes within canvas bounds
- **Click to configure** - Open configuration panel
- **Double-click to rename** - Inline editing of node labels
- **Delete key** - Remove selected nodes and edges

**Connection Creation**:
- **Drag from handle** - Create connections between nodes
- **Hover validation** - Visual feedback for valid connections
- **Auto-routing** - Intelligent edge routing around nodes
- **Connection rules** - Enforce node type compatibility

**Canvas Navigation**:
- **Pan and zoom** - Mouse wheel and drag interactions
- **Minimap navigation** - Overview with viewport indicator
- **Fit to view** - Auto-zoom to show all nodes
- **Keyboard shortcuts** - Ctrl+Z (undo), Ctrl+Y (redo), Delete

#### Real-time Data Interactions
**Live Updates**:
- **Automatic refresh** - Background data fetching every 5 minutes
- **Manual refresh** - Pull-to-refresh gesture on mobile
- **Real-time indicators** - Pulse animations for live data
- **Stale data warnings** - Visual indicators when data is outdated

**Notification System**:
- **Toast notifications** - Non-intrusive alerts for important events
- **Whale alerts** - Immediate notifications for large position changes
- **Execution updates** - Real-time workflow execution status
- **Error handling** - User-friendly error messages with retry options

### 7.6.2 Advanced Interaction Patterns

#### Keyboard Shortcuts
Global shortcuts available throughout the application:

| Shortcut | Action | Context |
|---|---|---|
| `Ctrl/Cmd + K` | Open command palette | Global |
| `Ctrl/Cmd + /` | Toggle help overlay | Global |
| `Ctrl/Cmd + D` | Toggle dark mode | Global |
| `Escape` | Close modals/panels | Global |
| `Tab` | Navigate form fields | Forms |
| `Enter` | Submit forms/confirm actions | Forms |
| `Space` | Toggle checkboxes/buttons | Interactive elements |
| `Arrow keys` | Navigate tables/lists | Data tables |

#### Gesture Support (Mobile)
- **Swipe left/right** - Navigate between tabs
- **Pull to refresh** - Refresh data in lists
- **Pinch to zoom** - Zoom workflow canvas
- **Long press** - Context menu activation
- **Double tap** - Quick actions (favorite, select)

#### Accessibility Interactions
- **Screen reader support** - ARIA labels and descriptions
- **High contrast mode** - Enhanced visual contrast
- **Reduced motion** - Respect user motion preferences
- **Focus management** - Logical tab order and focus trapping
- **Keyboard navigation** - Full functionality without mouse

### 7.6.3 Context-Aware Interactions

#### Smart Defaults
- **Filter memory** - Remember user's preferred filters
- **Layout preferences** - Persist sidebar state and panel sizes
- **Theme selection** - System theme detection with manual override
- **Timezone handling** - Automatic timezone detection and conversion

#### Progressive Disclosure
- **Collapsed panels** - Show/hide advanced options
- **Expandable rows** - Detailed information on demand
- **Lazy loading** - Load content as user scrolls
- **Conditional fields** - Show relevant options based on selections

## 7.7 Visual Design Considerations

### 7.7.1 Design System Principles

#### Color Palette Strategy
CASCADIAN implements a **semantic color system** optimized for financial data visualization:

**Primary Colors**:
- **Brand Blue** (`#2563eb`) - Primary actions, links, focus states
- **Success Green** (`#16a34a`) - Positive values, profit indicators, success states
- **Danger Red** (`#dc2626`) - Negative values, loss indicators, error states
- **Warning Orange** (`#ea580c`) - Alerts, pending states, caution indicators

**Neutral Palette**:
- **Gray Scale** (`#f8fafc` to `#0f172a`) - Text, backgrounds, borders
- **Semantic Grays** - Optimized for readability and hierarchy

**Data Visualization Colors**:
- **Whale Activity** - Purple gradient (`#7c3aed` to `#a855f7`)
- **Market Categories** - Distinct hues for Politics, Sports, Crypto, Finance
- **Performance Metrics** - Green-red spectrum for P&L visualization

#### Typography System
**Font Stack**: Inter (Google Fonts) for optimal readability across devices

**Type Scale**:
- **Display** (`text-4xl`, 36px) - Page titles, hero sections
- **Heading 1** (`text-3xl`, 30px) - Section headers
- **Heading 2** (`text-2xl`, 24px) - Subsection headers
- **Heading 3** (`text-xl`, 20px) - Component titles
- **Body** (`text-base`, 16px) - Primary content
- **Small** (`text-sm`, 14px) - Secondary content, captions
- **Tiny** (`text-xs`, 12px) - Labels, metadata

#### Spacing and Layout
**Spacing Scale** (TailwindCSS):
- **Micro** (`space-1`, 4px) - Icon spacing, fine adjustments
- **Small** (`space-2`, 8px) - Component padding, tight layouts
- **Medium** (`space-4`, 16px) - Standard component spacing
- **Large** (`space-6`, 24px) - Section spacing, card padding
- **Extra Large** (`space-8`, 32px) - Page sections, major divisions

**Layout Grid**:
- **12-column grid** for desktop layouts
- **Responsive breakpoints** with mobile-first approach
- **Container max-widths** for optimal reading lengths
- **Aspect ratios** for consistent media display

### 7.7.2 Component Visual Patterns

#### Card-Based Design
**Information Architecture**:
- **Market Cards** - Consistent layout for market information
- **Whale Profile Cards** - Standardized whale intelligence display
- **Strategy Cards** - Uniform strategy presentation
- **Metric Cards** - Dashboard KPI visualization

**Card Anatomy**:
```typescript
interface CardProps {
  title: string
  subtitle?: string
  value?: string | number
  change?: number
  trend?: 'up' | 'down' | 'neutral'
  actions?: React.ReactNode
  children?: React.ReactNode
}
```

#### Data Visualization Patterns
**Chart Consistency**:
- **Color coding** - Consistent colors across all charts
- **Axis formatting** - Standardized number and date formatting
- **Interaction patterns** - Hover states, tooltips, zoom controls
- **Loading states** - Skeleton screens during data fetching

**Table Design**:
- **Sortable headers** - Clear sort indicators and interactions
- **Row selection** - Checkbox selection with bulk actions
- **Pagination** - Consistent pagination controls
- **Empty states** - Helpful messaging when no data available

#### Interactive Element Patterns
**Button Hierarchy**:
- **Primary** - Main actions (blue background)
- **Secondary** - Alternative actions (outline style)
- **Ghost** - Subtle actions (transparent background)
- **Destructive** - Dangerous actions (red styling)

**Form Elements**:
- **Input fields** - Consistent styling with focus states
- **Select dropdowns** - Custom styled with search functionality
- **Checkboxes/Radio** - Custom designs matching brand
- **Sliders** - Range inputs for numerical filters

### 7.7.3 Responsive Design Patterns

#### Mobile-First Approach
**Progressive Enhancement**:
- **Base styles** target mobile devices (320px+)
- **Enhanced layouts** for tablet (768px+) and desktop (1024px+)
- **Touch-friendly** interactions with 44px minimum touch targets
- **Readable text** with appropriate line heights and spacing

#### Adaptive Layouts
**Sidebar Behavior**:
- **Mobile** - Overlay drawer that slides in from left
- **Tablet** - Collapsible sidebar with icon-only mode
- **Desktop** - Persistent sidebar with full navigation

**Data Table Responsiveness**:
- **Mobile** - Horizontal scroll with sticky first column
- **Tablet** - Responsive columns with priority-based hiding
- **Desktop** - Full table with all columns visible

#### Dark Mode Implementation
**Theme Strategy**:
- **System preference detection** - Automatic theme based on OS setting
- **Manual override** - User can explicitly choose light/dark
- **Persistent preference** - Theme choice saved in localStorage
- **Smooth transitions** - Animated theme switching

**Color Adaptation**:
- **Background colors** - Deep grays for dark mode
- **Text contrast** - Ensure WCAG AA compliance in both modes
- **Chart colors** - Adjusted for visibility in dark backgrounds
- **Border colors** - Subtle borders that work in both themes

### 7.7.4 Performance-Oriented Design

#### Optimized Asset Loading
**Image Strategy**:
- **Next.js Image component** - Automatic optimization and lazy loading
- **WebP format** - Modern image format with fallbacks
- **Responsive images** - Multiple sizes for different screen densities
- **Placeholder blur** - Smooth loading experience

**Icon System**:
- **Lucide React** - Lightweight SVG icon library
- **Tree shaking** - Only load icons that are used
- **Consistent sizing** - Standardized icon sizes (16px, 20px, 24px)
- **Semantic usage** - Icons support meaning, not just decoration

#### Animation and Micro-interactions
**Performance-First Animations**:
- **CSS transforms** - Hardware-accelerated animations
- **Reduced motion** - Respect user preferences for motion
- **Purposeful animations** - Enhance UX without being distracting
- **Loading animations** - Skeleton screens and progress indicators

**Micro-interaction Examples**:
- **Button hover states** - Subtle color and shadow changes
- **Form validation** - Inline error states with smooth transitions
- **Data updates** - Pulse animations for real-time changes
- **Navigation feedback** - Active states and breadcrumb updates

This comprehensive UI design ensures CASCADIAN provides a professional, accessible, and performant user experience that scales from mobile devices to large desktop displays while maintaining consistency across all interaction patterns and visual elements.

# 8. Infrastructure

## 8.1 Deployment Environment

### 8.1.1 Target Environment Assessment

CASCADIAN employs a **modern serverless-first cloud architecture** leveraging Vercel's edge infrastructure and Supabase's managed PostgreSQL platform. This approach eliminates traditional infrastructure management while providing enterprise-grade scalability and reliability.

**Environment Type**: Hybrid Cloud (Serverless + Managed Services)

| Environment Aspect | Implementation | Justification |
|---|---|---|
| **Compute Platform** | Vercel Serverless Functions with Fluid Compute (45B+ weekly requests, 95% cost savings) | Auto-scaling, zero infrastructure management |
| **Database Platform** | Supabase PostgreSQL ($5B valuation, 4M+ developers) | Managed PostgreSQL with real-time capabilities |
| **Geographic Distribution** | Global edge network - instantly available across the globe | Low latency worldwide, automatic geo-routing |
| **Compliance Framework** | SOC 2, HIPAA, GDPR compliance with encryption at rest and in transit | Enterprise security standards |

**Resource Requirements**:

| Resource Type | Current Allocation | Scaling Threshold | Auto-scaling Capability |
|---|---|---|---|
| **Compute** | 300s execution time (up from 60-90s) | Traffic-based | Fluid compute with multiplexing |
| **Memory** | Enhanced memory allocation with Fluid compute | Usage-based | Automatic provisioning |
| **Storage** | 500MB (Free) → 8GB+ (Pro) | Data growth | Managed scaling |
| **Network** | Highly optimized CDN reducing bounce rates | Global distribution | Edge caching |

### 8.1.2 Environment Management

**Infrastructure as Code (IaC) Approach**: Framework-defined Infrastructure (FdI) - automates frontend deployment by reading framework build outputs with no YAML files

```mermaid
graph TB
    subgraph "Development Environment"
        DEV_LOCAL[Local Development<br/>localhost:3000]
        DEV_SUPABASE[Local Supabase<br/>Docker Container]
        DEV_VERCEL[Vercel CLI<br/>Development Server]
    end
    
    subgraph "Staging Environment"
        STAGING_VERCEL[Vercel Preview<br/>staging.cascadian.app]
        STAGING_SUPABASE[Supabase Staging<br/>Dedicated Instance]
        STAGING_AI[AI Services<br/>Development Keys]
    end
    
    subgraph "Production Environment"
        PROD_VERCEL[Vercel Production<br/>cascadian.app]
        PROD_SUPABASE[Supabase Production<br/>High Availability]
        PROD_AI[AI Services<br/>Production Keys]
    end
    
    DEV_LOCAL --> STAGING_VERCEL
    STAGING_VERCEL --> PROD_VERCEL
    DEV_SUPABASE --> STAGING_SUPABASE
    STAGING_SUPABASE --> PROD_SUPABASE
    DEV_VERCEL --> STAGING_VERCEL
```

**Configuration Management Strategy**:

| Environment | Configuration Method | Secrets Management | Deployment Trigger |
|---|---|---|---|
| **Development** | `.env.local` file | Local environment variables | Manual (`npm run dev`) |
| **Staging** | Vercel environment variables | Encrypted Vercel secrets | Git push to `staging` branch |
| **Production** | Vercel environment variables | Encrypted Vercel secrets | Git push to `main` branch |

**Environment Promotion Strategy**:

```mermaid
flowchart LR
    DEV[Development<br/>Feature Branch] --> PR[Pull Request<br/>Code Review]
    PR --> STAGING[Staging Deploy<br/>Preview URL]
    STAGING --> TEST[Integration Testing<br/>QA Validation]
    TEST --> PROD[Production Deploy<br/>Main Branch]
    
    STAGING --> ROLLBACK[Rollback Available<br/>Previous Version]
    PROD --> ROLLBACK
```

**Backup and Disaster Recovery Plans**:

Supabase provides Point-in-Time Recovery (PITR) and daily backups with retention policies

| Backup Type | Frequency | Retention | Recovery Time Objective |
|---|---|---|---|
| **Database Snapshots** | Daily | 30 days | < 15 minutes |
| **Point-in-Time Recovery** | Continuous | 7 days | < 5 minutes |
| **Application Code** | Git-based | Indefinite | < 2 minutes |
| **Environment Configuration** | Version controlled | Indefinite | < 5 minutes |

## 8.2 Cloud Services

### 8.2.1 Cloud Provider Selection and Justification

**Primary Cloud Provider**: Vercel (Frontend Cloud + Serverless Functions)

Vercel provides developer tools and cloud infrastructure to build, scale, and secure a faster, more personalized web

**Selection Rationale**:

| Evaluation Criteria | Vercel Advantage | Alternative Limitations |
|---|---|---|
| **Next.js Integration** | Native Next.js optimization - provisions right resources automatically | Manual configuration required |
| **Developer Experience** | Automatic builds and deployment on git push | Complex CI/CD setup |
| **Global Performance** | Highly optimized CDN reducing bounce rates and improving SEO | Additional CDN configuration |
| **AI Workload Optimization** | Fluid compute designed for I/O bound AI workloads with intelligent orchestration | Traditional serverless limitations |

**Secondary Cloud Provider**: Supabase (Database + Backend Services)

Build production-grade applications with Postgres database, Authentication, instant APIs, Realtime, Functions, Storage and Vector embeddings

### 8.2.2 Core Services Required with Versions

**Vercel Services**:

| Service | Version/Tier | Purpose | Configuration |
|---|---|---|---|
| **Vercel Functions** | 300s execution time, enhanced memory | API routes, serverless logic | Node.js 20.x runtime |
| **Vercel Edge Network** | Global CDN | Static asset delivery | Automatic optimization |
| **Vercel Analytics** | Built-in | Performance monitoring | Core Web Vitals tracking |
| **Vercel Domains** | Custom domain | Production hosting | SSL/TLS automatic |

**Supabase Services**:

| Service | Version/Configuration | Purpose | Integration |
|---|---|---|---|
| **PostgreSQL** | Version 15/17 with production-ready configuration | Primary database | Row Level Security integration |
| **Supabase Auth** | JWT-based authentication API | User management | Next.js middleware |
| **Supabase Realtime** | Scalable WebSocket engine | Live data updates | React Query integration |
| **Supabase Storage** | S3-compatible object storage | File management | Postgres metadata |

### 8.2.3 High Availability Design

**Multi-Region Architecture**:

```mermaid
graph TB
    subgraph "Global Edge Network (Vercel)"
        EDGE_US[US East Edge<br/>Primary Region]
        EDGE_EU[EU West Edge<br/>Secondary Region]
        EDGE_ASIA[Asia Pacific Edge<br/>Tertiary Region]
    end
    
    subgraph "Compute Layer"
        FUNCTIONS[Serverless Functions<br/>Auto-scaling]
        FLUID[Fluid Compute<br/>Resource Optimization]
    end
    
    subgraph "Database Layer (Supabase)"
        PRIMARY_DB[Primary Database<br/>US East]
        READ_REPLICA[Read Replicas<br/>Multi-region]
        BACKUP[Automated Backups<br/>Point-in-Time Recovery]
    end
    
    EDGE_US --> FUNCTIONS
    EDGE_EU --> FUNCTIONS
    EDGE_ASIA --> FUNCTIONS
    
    FUNCTIONS --> FLUID
    FLUID --> PRIMARY_DB
    PRIMARY_DB --> READ_REPLICA
    PRIMARY_DB --> BACKUP
```

**Availability Targets**:

| Component | Availability SLA | Failover Time | Monitoring |
|---|---|---|---|
| **Vercel Edge** | 99.99% | < 1 second | Built-in monitoring |
| **Serverless Functions** | Auto-scaling for traffic spikes | Instant | Function logs |
| **Supabase Database** | Enterprise automatic failover | < 30 seconds | Database metrics |
| **Overall System** | 99.9% | < 60 seconds | End-to-end monitoring |

### 8.2.4 Cost Optimization Strategy

**Vercel Cost Management**:

Active CPU pricing - pay only for compute time used (e.g., 300ms of 30s AI call), with Fluid memory reuse

| Cost Component | Optimization Strategy | Expected Savings |
|---|---|---|
| **Function Execution** | Up to 85% cost savings through in-function concurrency | 85% reduction |
| **Bandwidth** | CDN caching, image optimization | 60% reduction |
| **Build Time** | Incremental builds, caching | 40% reduction |

**Supabase Cost Management**:

| Tier | Monthly Cost | Included Resources | Scaling Trigger |
|---|---|---|---|
| **Free Tier** | $0 | 500MB DB, 2GB bandwidth | > 400MB usage |
| **Pro Tier** | $25 | 8GB DB, 50GB bandwidth | > 6GB usage |
| **Team Tier** | $599 | 500GB DB, 500GB bandwidth | Enterprise needs |

### 8.2.5 Security and Compliance Considerations

**Data Security**:

SOC 2, HIPAA, and GDPR compliance with data encrypted at rest and in transit, plus built-in security threat monitoring

| Security Layer | Implementation | Compliance Standard |
|---|---|---|
| **Transport Security** | TLS 1.3, HTTPS enforcement | SOC 2 Type II |
| **Data Encryption** | AES-256 at rest, TLS in transit | GDPR, HIPAA |
| **Access Control** | Row-level security policies | SOC 2 |
| **Authentication** | Multi-factor auth, OAuth, SAML, SSO | Enterprise standards |

## 8.3 Containerization

### 8.3.1 Containerization Strategy Assessment

**Containerization is not applicable for CASCADIAN's serverless architecture**. Here's why:

Serverless deployment model where cloud vendor handles infrastructure complexities, allowing focus on business logic with automatic scaling, configuring, patching, and high availability

**Architectural Decision Rationale**:

| Aspect | Serverless Approach | Container Alternative | Decision |
|---|---|---|
| **Deployment Model** | Serverless functions run on-demand without backend management | Container orchestration required | ✅ Serverless |
| **Scaling** | Automatic scaling across 45B+ weekly requests | Manual scaling configuration | ✅ Serverless |
| **Maintenance** | Zero infrastructure management | Container updates, security patches | ✅ Serverless |
| **Cost Model** | Pay only for active CPU time | Always-on container costs | ✅ Serverless |

**Framework-Defined Infrastructure**:

Vercel uses Framework-defined Infrastructure (FdI) - automates all frontend primitive deployment by reading standardized build outputs with no YAML files or additional configuration

Instead of containers, CASCADIAN leverages:

- **Next.js Build System**: Automatic optimization and deployment
- **Vercel Functions**: Node.js serverless functions in supported frameworks
- **Edge Runtime**: Global distribution without container management

## 8.4 Orchestration

### 8.4.1 Orchestration Strategy Assessment

**Container orchestration is not applicable for CASCADIAN's serverless architecture**. Here's why:

Serverless shifts the burden - accept provider constraints but developers benefit from standardization, focusing on core application logic while platform handles scaling and operational complexity

**Orchestration Handled by Platform**:

| Orchestration Aspect | Vercel Implementation | Traditional K8s Alternative |
|---|---|---|
| **Service Discovery** | Secure TCP-based protocol with tunnels between Lambda and infrastructure | Manual service mesh |
| **Load Balancing** | Multiplexing multiple concurrent requests to same instance | Manual load balancer config |
| **Auto-scaling** | Intelligent orchestration across invocations | HPA/VPA configuration |
| **Health Checks** | Built-in function monitoring | Manual health check setup |

**Fluid Compute Orchestration**:

```mermaid
graph TB
    subgraph "Vercel Orchestration Layer"
        ROUTER[Function Router<br/>Request Distribution]
        FLUID[Fluid Compute<br/>Resource Optimization]
        TUNNEL[TCP Tunnels<br/>Secure Communication]
    end
    
    subgraph "Execution Environment"
        LAMBDA1[Lambda Instance 1<br/>Multi-request Handling]
        LAMBDA2[Lambda Instance 2<br/>Multi-request Handling]
        LAMBDA3[Lambda Instance N<br/>Auto-scaling]
    end
    
    ROUTER --> FLUID
    FLUID --> TUNNEL
    TUNNEL --> LAMBDA1
    TUNNEL --> LAMBDA2
    TUNNEL --> LAMBDA3
```

Fluid compute breaks away from one-to-one serverless model, intelligently orchestrating compute across invocations with multiple concurrent requests sharing underlying resources

## 8.5 CI/CD Pipeline

### 8.5.1 Build Pipeline

**Source Control Integration**:

Connect git repository to Vercel account - automatically pulls latest code, builds and serves on infrastructure

```mermaid
flowchart LR
    DEV[Developer<br/>Local Changes] --> COMMIT[Git Commit<br/>Feature Branch]
    COMMIT --> PUSH[Git Push<br/>GitHub Repository]
    PUSH --> TRIGGER[Vercel Trigger<br/>Automatic Detection]
    
    TRIGGER --> BUILD[Build Process<br/>Next.js Compilation]
    BUILD --> TEST[Quality Gates<br/>ESLint, TypeScript]
    TEST --> DEPLOY[Deploy Preview<br/>Unique URL]
    
    DEPLOY --> REVIEW[Code Review<br/>Pull Request]
    REVIEW --> MERGE[Merge to Main<br/>Production Deploy]
```

**Build Environment Requirements**:

| Build Component | Version | Configuration | Optimization |
|---|---|---|---|
| **Node.js Runtime** | 20.19.3 LTS | Vercel managed | Automatic updates |
| **Package Manager** | pnpm 10.18.1 | Workspace support | Dependency caching |
| **TypeScript** | 5.8.3 | Strict mode | Type checking |
| **Next.js** | 15.5 | App Router | Turbopack builds in beta |

**Dependency Management**:

```yaml
# .github/workflows/ci.yml
name: Continuous Integration

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20.19.3'
          cache: 'pnpm'
          
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        
      - name: Type check
        run: pnpm typecheck
        
      - name: Lint code
        run: pnpm lint
        
      - name: Build application
        run: pnpm build
        
      - name: Run tests
        run: pnpm test # (Future implementation)
```

**Artifact Generation and Storage**:

| Artifact Type | Storage Location | Retention | Purpose |
|---|---|---|---|
| **Build Output** | Vercel Edge Cache | 30 days | Deployment artifacts |
| **Source Maps** | Vercel Internal | 90 days | Error debugging |
| **Type Definitions** | Build cache | 7 days | Development support |
| **Test Reports** | GitHub Actions | 90 days | Quality metrics |

### 8.5.2 Deployment Pipeline

**Deployment Strategy**: Git push to infrastructure - Vercel understands app to provision right resources and optimize for high-performance

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GitHub as GitHub Repository
    participant Vercel as Vercel Platform
    participant Supabase as Supabase Database
    participant CDN as Global CDN
    
    Dev->>GitHub: Push to main branch
    GitHub->>Vercel: Webhook trigger
    Vercel->>Vercel: Build Next.js app
    Vercel->>Vercel: Run quality gates
    Vercel->>CDN: Deploy to edge network
    Vercel->>Supabase: Database migrations (if any)
    Vercel-->>Dev: Deployment notification
    
    Note over Vercel,CDN: Zero-downtime deployment
    Note over CDN: Global distribution < 30 seconds
```

**Environment Promotion Workflow**:

| Environment | Trigger | Deployment Method | Validation |
|---|---|---|---|
| **Development** | Local changes | `vercel dev` | Manual testing |
| **Preview** | Pull request | Automatic preview URL | Automated testing |
| **Staging** | Push to `staging` | Automatic deployment | Integration testing |
| **Production** | Push to `main` | Automatic deployment | Health checks |

**Rollback Procedures**:

Vercel provides Instant Rollback and Skew Protection to ensure site is always online

```mermaid
flowchart TD
    DEPLOY[New Deployment] --> HEALTH[Health Check]
    HEALTH --> SUCCESS{Health Check<br/>Passes?}
    
    SUCCESS -->|Yes| LIVE[Go Live<br/>Update DNS]
    SUCCESS -->|No| ROLLBACK[Automatic Rollback<br/>Previous Version]
    
    LIVE --> MONITOR[Monitor Metrics<br/>Error Rates, Performance]
    MONITOR --> ALERT{Issues<br/>Detected?}
    
    ALERT -->|Yes| MANUAL_ROLLBACK[Manual Rollback<br/>One-click Revert]
    ALERT -->|No| STABLE[Stable Deployment]
    
    ROLLBACK --> INVESTIGATE[Investigate Issues<br/>Fix and Redeploy]
    MANUAL_ROLLBACK --> INVESTIGATE
```

**Post-Deployment Validation**:

| Validation Type | Method | Success Criteria | Failure Action |
|---|---|---|---|
| **Health Checks** | `/api/health` endpoint | 200 response | Automatic rollback |
| **Database Connectivity** | Connection test | < 100ms response | Alert + rollback |
| **Core Web Vitals** | Vercel Analytics | LCP < 2.5s | Performance alert |
| **Error Rates** | Function logs | < 1% error rate | Investigation |

### 8.5.3 Release Management Process

**Release Versioning Strategy**:

| Release Type | Version Pattern | Deployment Target | Approval Required |
|---|---|---|---|
| **Feature Release** | `v1.2.0` | Production | Code review |
| **Bug Fix** | `v1.2.1` | Production | Code review |
| **Hotfix** | `v1.2.1-hotfix.1` | Production | Emergency approval |
| **Preview** | `preview-{branch}` | Preview URL | Automatic |

**Release Notes Automation**:

```yaml
# .github/workflows/release.yml
name: Release Management

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Generate Release Notes
        uses: actions/github-script@v7
        with:
          script: |
            const { data: release } = await github.rest.repos.createRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              tag_name: context.ref.replace('refs/tags/', ''),
              generate_release_notes: true
            })
```

## 8.6 Infrastructure Monitoring

### 8.6.1 Resource Monitoring Approach

**Multi-Layer Monitoring Strategy**:

Vercel provides built-in observability suite designed for serverless, offering best of both worlds: reduced setup and minimal maintenance

```mermaid
graph TB
    subgraph "Application Monitoring"
        VERCEL_ANALYTICS[Vercel Analytics<br/>Core Web Vitals]
        FUNCTION_LOGS[Function Logs<br/>Execution Metrics]
        ERROR_TRACKING[Error Tracking<br/>Exception Monitoring]
    end
    
    subgraph "Database Monitoring"
        SUPABASE_METRICS[Supabase Metrics<br/>Query Performance]
        CONNECTION_POOL[Connection Pool<br/>Usage Monitoring]
        SLOW_QUERIES[Slow Query Log<br/>Performance Analysis]
    end
    
    subgraph "Infrastructure Monitoring"
        CDN_METRICS[CDN Performance<br/>Cache Hit Rates]
        EDGE_METRICS[Edge Function<br/>Cold Start Tracking]
        BANDWIDTH[Bandwidth Usage<br/>Cost Monitoring]
    end
    
    VERCEL_ANALYTICS --> DASHBOARD[Unified Dashboard<br/>Real-time Metrics]
    FUNCTION_LOGS --> DASHBOARD
    SUPABASE_METRICS --> DASHBOARD
    CDN_METRICS --> DASHBOARD
```

**Performance Metrics Collection**:

| Metric Category | Specific Metrics | Collection Method | Alert Threshold |
|---|---|---|---|
| **Frontend Performance** | Core Web Vitals, bounce rates, SEO metrics | Vercel Analytics | LCP > 2.5s |
| **API Performance** | Response time, error rate, throughput | Function logs | p95 > 500ms |
| **Database Performance** | Query time, connection count, cache hit rate | Supabase dashboard | Query > 1s |
| **Infrastructure** | Cold start delays, function duration | Built-in monitoring | Cold start > 1s |

### 8.6.2 Cost Monitoring and Optimization

**Cost Tracking Strategy**:

Usage-based billing makes costs fluctuate with traffic patterns - internet decides your bill

| Cost Component | Monitoring Method | Budget Alert | Optimization Action |
|---|---|---|---|
| **Vercel Functions** | Active CPU pricing - pay only for compute time | $100/month | Function optimization |
| **Supabase Database** | Usage dashboard | $50/month | Query optimization |
| **Bandwidth** | CDN metrics | 80% of limit | Cache optimization |
| **AI Services** | API usage tracking | $200/month | Request batching |

**Cost Optimization Techniques**:

```mermaid
flowchart TD
    MONITOR[Cost Monitoring<br/>Real-time Tracking] --> ANALYZE[Usage Analysis<br/>Identify Patterns]
    
    ANALYZE --> OPTIMIZE_FUNCTIONS[Function Optimization<br/>Reduce Execution Time]
    ANALYZE --> OPTIMIZE_CACHE[Cache Optimization<br/>Reduce API Calls]
    ANALYZE --> OPTIMIZE_DB[Database Optimization<br/>Query Performance]
    
    OPTIMIZE_FUNCTIONS --> MEASURE[Measure Impact<br/>Cost Reduction]
    OPTIMIZE_CACHE --> MEASURE
    OPTIMIZE_DB --> MEASURE
    
    MEASURE --> ALERT{Cost Threshold<br/>Exceeded?}
    ALERT -->|Yes| SCALE_DOWN[Scale Down Resources<br/>Temporary Limits]
    ALERT -->|No| CONTINUE[Continue Monitoring]
```

### 8.6.3 Security Monitoring

**Security Event Monitoring**:

Built-in tools for monitoring and managing security threats with encrypted data

| Security Layer | Monitoring Approach | Detection Method | Response Action |
|---|---|---|---|
| **Authentication** | Failed login attempts | Supabase Auth logs | Account lockout |
| **API Security** | Rate limit violations | Function logs | IP blocking |
| **Database Security** | Unusual query patterns | Supabase monitoring | Query analysis |
| **Infrastructure** | Bot management against automated abuse, sophisticated bots | Vercel security | Automatic blocking |

### 8.6.4 Compliance Auditing

**Compliance Monitoring Framework**:

| Compliance Standard | Monitoring Requirement | Audit Frequency | Evidence Collection |
|---|---|---|---|
| **SOC 2 Type II** | Security controls monitoring | Quarterly | Automated reports |
| **GDPR** | Data processing logs | Monthly | Access logs |
| **HIPAA** | Healthcare data protection | Continuous | Encryption verification |

## 8.7 Infrastructure Architecture Diagrams

### 8.7.1 Overall Infrastructure Architecture

```mermaid
graph TB
    subgraph "Global Edge Network (Vercel)"
        EDGE[Edge Locations<br/>Global CDN]
        WAF[Web Application Firewall<br/>DDoS Protection]
        SSL[SSL/TLS Termination<br/>Certificate Management]
    end
    
    subgraph "Compute Layer"
        FUNCTIONS[Serverless Functions<br/>Node.js 20.x Runtime]
        FLUID[Fluid Compute<br/>Resource Optimization]
        EDGE_FUNCTIONS[Edge Functions<br/>Global Distribution]
    end
    
    subgraph "Application Layer"
        NEXTJS[Next.js Application<br/>SSR/CSR Hybrid]
        API_ROUTES[API Routes<br/>Business Logic]
        STREAMING[Server-Sent Events<br/>Real-time Updates]
    end
    
    subgraph "Data Layer (Supabase)"
        POSTGRES[PostgreSQL 15+<br/>Primary Database]
        AUTH[Supabase Auth<br/>JWT Management]
        REALTIME[Realtime Engine<br/>WebSocket Subscriptions]
        STORAGE[Object Storage<br/>S3-Compatible]
    end
    
    subgraph "External Services"
        POLYMARKET[Polymarket APIs<br/>Market Data]
        OPENAI[OpenAI GPT-4<br/>AI Analysis]
        CLAUDE[Anthropic Claude<br/>Strategy Copilot]
    end
    
    EDGE --> FUNCTIONS
    WAF --> FUNCTIONS
    SSL --> FUNCTIONS
    
    FUNCTIONS --> FLUID
    FLUID --> NEXTJS
    NEXTJS --> API_ROUTES
    API_ROUTES --> STREAMING
    
    API_ROUTES --> POSTGRES
    API_ROUTES --> AUTH
    API_ROUTES --> REALTIME
    API_ROUTES --> STORAGE
    
    API_ROUTES --> POLYMARKET
    API_ROUTES --> OPENAI
    API_ROUTES --> CLAUDE
```

### 8.7.2 Deployment Workflow Diagram

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Git as GitHub
    participant Vercel as Vercel Platform
    participant Build as Build System
    participant Edge as Edge Network
    participant DB as Supabase
    participant Monitor as Monitoring
    
    Dev->>Git: Push code changes
    Git->>Vercel: Webhook trigger
    Vercel->>Build: Start build process
    
    Build->>Build: Install dependencies (pnpm)
    Build->>Build: TypeScript compilation
    Build->>Build: Next.js build (Turbopack)
    Build->>Build: Run quality gates
    
    alt Build Success
        Build->>Edge: Deploy to edge locations
        Edge->>Edge: Update global CDN
        Vercel->>DB: Run migrations (if any)
        Vercel->>Monitor: Update deployment status
        Monitor-->>Dev: Success notification
    else Build Failure
        Build-->>Dev: Failure notification
        Build-->>Dev: Error logs
    end
    
    Note over Edge: Zero-downtime deployment
    Note over Monitor: Health checks & monitoring
```

### 8.7.3 Environment Promotion Flow

```mermaid
flowchart TD
    DEV_ENV[Development Environment<br/>Local Machine] --> FEATURE[Feature Branch<br/>Development Work]
    
    FEATURE --> PR[Pull Request<br/>Code Review Process]
    PR --> PREVIEW[Preview Deployment<br/>Unique Vercel URL]
    
    PREVIEW --> TESTS[Automated Tests<br/>Quality Gates]
    TESTS --> REVIEW[Manual Review<br/>QA Validation]
    
    REVIEW --> STAGING[Staging Environment<br/>staging.cascadian.app]
    STAGING --> INTEGRATION[Integration Testing<br/>End-to-End Validation]
    
    INTEGRATION --> APPROVAL[Production Approval<br/>Release Manager]
    APPROVAL --> PRODUCTION[Production Deployment<br/>cascadian.app]
    
    PRODUCTION --> MONITOR[Production Monitoring<br/>Health Checks]
    MONITOR --> SUCCESS[Deployment Success]
    
    TESTS -->|Failure| FEATURE
    REVIEW -->|Issues| FEATURE
    INTEGRATION -->|Failure| STAGING
    MONITOR -->|Issues| ROLLBACK[Automatic Rollback<br/>Previous Version]
    
    ROLLBACK --> INVESTIGATE[Investigate & Fix<br/>Return to Development]
    INVESTIGATE --> FEATURE
```

## 8.8 Infrastructure Cost Estimates

### 8.8.1 Monthly Cost Breakdown

**Current Costs (Development Phase)**:

| Service | Tier | Monthly Cost | Included Resources | Usage |
|---|---|---|---|---|
| **Vercel** | Hobby | $0 | 100GB bandwidth, serverless functions | 5% utilization |
| **Supabase** | Free | $0 | 500MB DB, 2GB bandwidth | 10% utilization |
| **OpenAI API** | Pay-per-use | $50 | GPT-4 API calls | Development testing |
| **Domain** | Custom | $12 | cascadian.app | Annual fee |
| **Total** | | **$62/month** | | |

**Projected Costs (Production Scale - 500 DAU)**:

| Service | Tier | Monthly Cost | Scaling Factor | Justification |
|---|---|---|---|---|
| **Vercel** | Pro | $20 + usage | 85% cost savings with Fluid compute | $150 estimated |
| **Supabase** | Pro | $25 + usage | 8GB DB, 50GB bandwidth | $75 estimated |
| **OpenAI API** | Pay-per-use | $300 | AI analysis scaling | Production workloads |
| **Anthropic Claude** | Pay-per-use | $200 | Strategy copilot usage | User interactions |
| **Monitoring** | Built-in | $0 | Vercel + Supabase included | No additional cost |
| **Total** | | **$750/month** | | |

### 8.8.2 Cost Scaling Projections

**Growth-Based Cost Modeling**:

| User Scale | Monthly Cost | Cost per User | Key Scaling Factors |
|---|---|---|---|
| **100 DAU** | $200 | $2.00 | Basic usage patterns |
| **500 DAU** | $750 | $1.50 | Efficiency gains from scale |
| **2,000 DAU** | $2,500 | $1.25 | Enterprise tier benefits |
| **10,000 DAU** | $8,000 | $0.80 | Volume discounts |

**Cost Optimization Strategies**:

1. **Serverless Efficiency**: Pay only for active CPU time with Fluid memory reuse
2. **Database Optimization**: Query optimization and connection pooling
3. **CDN Utilization**: Aggressive caching to reduce origin requests
4. **AI Cost Management**: Request batching and response caching

### 8.8.3 Resource Sizing Guidelines

**Compute Resources**:

| Component | Current Allocation | Scaling Trigger | Maximum Allocation |
|---|---|---|---|
| **Function Memory** | Enhanced memory with Fluid compute | CPU utilization > 80% | Auto-scaling |
| **Function Timeout** | 300s execution time | Long-running workflows | Platform maximum |
| **Concurrent Executions** | 45B+ weekly requests supported | Traffic spikes | Unlimited |

**Database Resources**:

| Resource Type | Current | Scaling Threshold | Next Tier |
|---|---|---|---|
| **Storage** | 500MB | > 400MB usage | 8GB (Pro tier) |
| **Connections** | 60 concurrent | > 50 connections | 200 (Pro tier) |
| **Bandwidth** | 2GB/month | > 1.5GB usage | 50GB (Pro tier) |

This comprehensive infrastructure design ensures CASCADIAN can scale efficiently from development through enterprise deployment while maintaining cost-effectiveness and operational simplicity through modern serverless architecture patterns.

# 9. Appendices

## 9.1 Additional Technical Information

### 9.1.1 Next.js 15 Advanced Features

Next.js 15 includes support for the React Compiler, which reduces the amount of manual memoization developers have to do through APIs such as useMemo and useCallback. This experimental compiler created by the React team at Meta understands code at a deep level through its understanding of plain JavaScript semantics and the Rules of React.

**Turbopack Production Builds**:
Turbopack is no longer experimental — it's the default bundler in Next.js 15. When compared with Webpack, production metrics monitoring shows that sites built with Turbopack serve similar or smaller amounts of JavaScript and CSS across fewer requests, leading to comparable or better FCP, LCP and TTFB metrics.

**Typed Routes (Stable)**:
Typed routes provide compile-time type safety for your application's routes, catching invalid links before they reach production. This feature automatically generates types based on your file structure.

**Caching Model Evolution**:
Next.js is working on a simple and powerful caching model with the 'use cache' directive. With Next.js 15, caching defaults for fetch requests, GET Route Handlers, and Client Router Cache changed from cached by default to uncached by default.

### 9.1.2 Vercel Fluid Compute Architecture

**Revolutionary Compute Model**:
Vercel introduced Fluid compute, an approach to serverless computing that uses resources more efficiently, minimizes cold starts, and significantly reduces costs. Fluid compute with Active CPU pricing powers over 45 billion weekly requests, saving customers up to 95%.

**Technical Implementation**:
Vercel introduced a new secure transport outside of Lambda's simple event-response model, that securely connects each instance back to infrastructure. They create a tunnel between Vercel and AWS Lambda functions using a secure TCP-based protocol.

**Performance Benefits**:
This allows shifting to a many-to-one model that can handle tens of thousands of concurrent invocations on a single function. Benefits include cold start prevention, efficient auto-scaling, horizontal & vertical concurrency, and optimized I/O efficiency.

### 9.1.3 Supabase AI and Vector Capabilities

**Recent Funding and AI Focus**:
Supabase secured $100M Series E funding, now valued at $5B. Fueling its PostgreSQL AI database, Multigres, and developer-centric AI features like pgvector and Edge Functions.

**pgvector Integration**:
By default, PostgreSQL can't efficiently hold embeddings, the mathematical structures in which AI models keep their knowledge. Supabase's implementation uses an open-source tool called pgvector to add support for embeddings.

**Edge Functions Enhancement**:
The Edge Functions team has reduced function sizes by half and boot times by 300% in most cases when importing npm modules by lazy evaluating dependencies and reducing package section sizes.

**Enterprise Features**:
Project scoped roles are now available for all Supabase Team plans. Each member in the organization can be assigned a role scoped to the organization or to specific projects.

### 9.1.4 Advanced Database Features

**Supabase Postgres Distribution**:
Supabase Postgres is a batteries-included PostgreSQL distribution that provides unmodified PostgreSQL with a curated set of the most useful extensions pre-installed. The goal is simple: make it fast and easy to get started with a production-ready PostgreSQL setup.

**Multi-Version Support**:
Currently supporting PostgreSQL 15, 17, and OrioleDB-17. Ready for Production - Configured with sensible defaults for replication, security, and performance.

**Security Enhancements**:
Supabase is deprecating md5 in favor of scram-sha-256, which is the default and most secure authentication method used in the latest Postgres versions. They automatically migrate Supabase-managed roles' passwords to scram-sha-256 during the upgrade process.

### 9.1.5 Performance Optimization Patterns

**React Server Components Benefits**:
Next.js has fully embraced React Server Components. You no longer have to bundle everything into the client. Heavy logic and data fetching can happen on the server, drastically reducing bundle sizes.

**Streaming and Performance**:
With React 19 fully integrated, Next.js 15 lets you stream parts of your UI as soon as they're ready — no need to wait for the entire page to render.

## 9.2 Glossary

| Term | Definition |
|------|------------|
| **Active CPU Pricing** | Vercel's billing model where customers only pay for actual CPU time used, not idle time |
| **App Router** | Next.js 15's file-system based router using React Server Components and modern React features |
| **CLOB API** | Central Limit Order Book API from Polymarket for accessing order books and trade data |
| **Fluid Compute** | Vercel's compute model allowing single workers to handle multiple concurrent requests |
| **Gamma API** | Polymarket's API for accessing market metadata, events, and categorical information |
| **Insider Signals** | Algorithmic detection of unusual trading patterns that may indicate insider activity |
| **Market Analytics** | Derived metrics and intelligence calculated from raw market data |
| **pgvector** | PostgreSQL extension enabling efficient storage and querying of vector embeddings |
| **Polymarket** | World's largest prediction market platform for trading on real-world events |
| **Probability Stacking** | CASCADIAN's methodology of layering multiple intelligence signals to minimize risk |
| **React Server Components** | React components that render on the server, reducing client-side JavaScript |
| **Row-Level Security (RLS)** | PostgreSQL security feature enforcing data access policies at the database level |
| **Server-Sent Events (SSE)** | Web standard for streaming real-time updates from server to client |
| **Smart Imbalance Index (SII)** | Proprietary metric measuring buy/sell pressure imbalances in prediction markets |
| **Smart Money Score** | Algorithmic rating of wallet performance based on win rate and risk-adjusted returns |
| **Supabase** | Open-source Firebase alternative providing managed PostgreSQL with real-time features |
| **TanStack Query** | Powerful data synchronization library for React applications (formerly React Query) |
| **Turbopack** | Next.js's Rust-based bundler providing faster build times than Webpack |
| **Whale Intelligence** | System for tracking and analyzing large position holders in prediction markets |
| **Workflow Automation** | Visual drag-and-drop system for creating automated trading strategies |

## 9.3 Acronyms

| Acronym | Expanded Form |
|---------|---------------|
| **AI** | Artificial Intelligence |
| **API** | Application Programming Interface |
| **CDN** | Content Delivery Network |
| **CLOB** | Central Limit Order Book |
| **CLS** | Cumulative Layout Shift |
| **CORS** | Cross-Origin Resource Sharing |
| **CSR** | Client-Side Rendering |
| **CTF** | Conditional Token Framework |
| **DAU** | Daily Active Users |
| **DDoS** | Distributed Denial of Service |
| **DOM** | Document Object Model |
| **E2E** | End-to-End |
| **FCP** | First Contentful Paint |
| **FID** | First Input Delay |
| **GDPR** | General Data Protection Regulation |
| **GIN** | Generalized Inverted Index |
| **HTTPS** | HyperText Transfer Protocol Secure |
| **ISR** | Incremental Static Regeneration |
| **JWT** | JSON Web Token |
| **KPI** | Key Performance Indicator |
| **LCP** | Largest Contentful Paint |
| **LLM** | Large Language Model |
| **MVP** | Minimum Viable Product |
| **OHLC** | Open, High, Low, Close |
| **P&L** | Profit and Loss |
| **PITR** | Point-in-Time Recovery |
| **PPR** | Partial Prerendering |
| **REST** | Representational State Transfer |
| **RLS** | Row-Level Security |
| **ROI** | Return on Investment |
| **RSC** | React Server Components |
| **SDK** | Software Development Kit |
| **SEO** | Search Engine Optimization |
| **SII** | Smart Imbalance Index |
| **SLA** | Service Level Agreement |
| **SLO** | Service Level Objective |
| **SOC** | Service Organization Control |
| **SSE** | Server-Sent Events |
| **SSG** | Static Site Generation |
| **SSR** | Server-Side Rendering |
| **TCP** | Transmission Control Protocol |
| **TLS** | Transport Layer Security |
| **TTFB** | Time to First Byte |
| **TTL** | Time to Live |
| **UI** | User Interface |
| **USDC** | USD Coin (stablecoin) |
| **UX** | User Experience |
| **WAF** | Web Application Firewall |
| **WCAG** | Web Content Accessibility Guidelines |

---

**Document Section**: Appendices  
**Version**: 2.0  
**Last Updated**: 2025-10-23  
**Next Review**: 2025-11-23  
**Maintained By**: Engineering Team