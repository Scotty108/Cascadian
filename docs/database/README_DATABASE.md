# Cascadian App - Complete Database Documentation

## Overview

This directory contains comprehensive documentation of the Cascadian app's database structure and data flow. Cascadian is a sophisticated Polymarket analytics platform for identifying smart money traders and generating trading signals.

## Documentation Files

### 1. **DATABASE_SUMMARY.txt** (14 KB) - START HERE
**Best for**: High-level overview, quick reference, deployment setup

Contains:
- Database systems overview (Supabase, ClickHouse, Goldsky, Polymarket)
- Top 20 key tables with brief descriptions
- Core metrics and calculations (Omega, SII, etc.)
- API endpoints by category (60+ routes)
- Key data flows (5 major pipelines)
- Important notes and design insights
- Environment variables and deployment setup

**Read this first** if you're new to the system.

### 2. **DATABASE_QUICK_REFERENCE.md** (11 KB) - QUICK LOOKUP
**Best for**: Fast lookup, finding tables/APIs, common patterns

Contains:
- Database systems summary table
- Key tables by category (markets, wallets, strategies)
- ClickHouse analytics tables
- TIER 1 critical metrics (11 most important)
- Core data flows (visual format)
- Key calculations with examples
- API endpoints by category
- Update frequencies
- Common SQL queries
- Design patterns
- Important notes

**Use this when you need to quickly find something**.

### 3. **CASCADIAN_DATABASE_STRUCTURE.md** (56 KB) - COMPLETE REFERENCE
**Best for**: Deep dive, detailed schema, all columns, calculations

Contains:
- **Database Architecture**: Systems, principles, separation of concerns
- **Supabase PostgreSQL Schema** (25+ tables):
  - Complete column definitions for every table
  - Data sources and update frequencies
  - Purpose and use cases
  - Key indexes explained
  - All 20+ wallet performance tables
  - Strategy and workflow tables
  - Discovery and tracking tables
  - Notifications system
- **ClickHouse Analytics Schema** (13 tables):
  - All 102 metrics explained across 5 tiers
  - Time window definitions
  - Storage engines and optimization
  - Materialized views
  - Category analytics
  - Price history and signals
- **External Data Sources**: Goldsky, Polymarket APIs
- **API Endpoints**: All 60+ routes documented
- **Data Flow Patterns**: 10 detailed flows with ASCII diagrams
- **Key Metrics**: Detailed calculations with examples
  - Omega ratio (primary metric)
  - Smart Investor Index
  - Omega momentum
  - Omega lag (copyability)
  - Tail ratio (asymmetric upside)
  - EV per hour capital
  - And more

**This is the complete reference - bookmark it for detailed lookups**.

## Key Concepts

### Smart Money Identification
Cascadian identifies traders with high Omega scores (>= 2.0) who consistently beat the market. These "smart money" traders are tracked across all 20,000+ Polymarket markets.

### Smart Investor Index (SII)
For each market, SII compares the average Omega of the top 20 YES holders vs top 20 NO holders. If smart money favors YES, the signal is positive; if they favor NO, the signal is negative. The signal_strength (0-1) indicates conviction.

### 102 Metrics Per Wallet
ClickHouse calculates 102 performance metrics for each wallet across 4 time windows (30d, 90d, 180d, lifetime):
- **TIER 1 CRITICAL** (11): Omega, track record, copyability (omega lag), tail ratio, capital efficiency
- **TIER 2 ADVANCED** (20+): Forecasting skill, risk metrics, diversification
- **TIER 3+ SPECIALIZED** (70+): Behavioral patterns, edge analysis, market microstructure

### Node-Based Strategy Builder
Users can create custom strategies using a visual node graph system (React Flow) with:
- DATA_SOURCE nodes (fetch wallets, markets)
- FILTER nodes (apply criteria)
- LOGIC nodes (AND/OR operations)
- SIGNAL nodes (generate trading signals)
- ACTION nodes (create positions, notifications)

11 predefined strategies are included (Omega Screener, Balanced Hybrid, Category Specialists, etc.).

## Database Systems

| System | Type | Purpose |
|--------|------|---------|
| **Supabase** | PostgreSQL OLTP | Operational data, strategies, workflows |
| **ClickHouse** | Columnar OLAP | Analytics, 102 metrics per wallet |
| **Goldsky** | GraphQL API | Blockchain data (positions, PnL) |
| **Polymarket** | REST API | Market data and trades |

## Quick Start

1. **New to the codebase?** → Read `DATABASE_SUMMARY.txt`
2. **Need a specific table?** → Check `DATABASE_QUICK_REFERENCE.md`
3. **Building a query?** → Reference `CASCADIAN_DATABASE_STRUCTURE.md`
4. **Exploring API endpoints?** → Use `DATABASE_QUICK_REFERENCE.md` section

## Key Files in the Codebase

### Schema Definitions
- `supabase/migrations/` - PostgreSQL migrations (25+ files, 2025-10 dated)
- `migrations/clickhouse/` - ClickHouse schema (13 files)

### Core Implementations
- `lib/metrics/omega-from-goldsky.ts` - Omega calculation (with 13.2399x correction)
- `lib/metrics/market-sii.ts` - Smart Investor Index calculation
- `lib/polymarket/client.ts` - Polymarket API client
- `lib/goldsky/client.ts` - Goldsky GraphQL client
- `lib/clickhouse/client.ts` - ClickHouse client
- `lib/strategy-builder/types.ts` - TypeScript types for 102 metrics

### API Routes
- `app/api/wallets/[address]/score` - Omega score endpoint
- `app/api/markets/[id]/sii` - Smart Investor Index endpoint
- `app/api/strategies/execute` - Strategy execution endpoint
- `app/api/omega/leaderboard` - Ranking leaderboard endpoint

### Data Sync Scripts
- `scripts/calculate-omega-scores.ts` - Omega calculation
- `scripts/sync-wallet-trades.ts` - Trade history sync
- `scripts/setup-clickhouse-schema.ts` - ClickHouse setup

## Important Notes

### Goldsky PnL Correction Factor
Goldsky PnL values are 13.2399x higher than actual (multi-outcome token aggregation issue). A correction factor is applied in `lib/metrics/omega-from-goldsky.ts`. This has been empirically verified with 0.00% error against Polymarket profiles.

### Minimum Trade Requirement
Omega scores are only valid for wallets with >= 5 closed trades. This is Austin's requirement for credibility. The `meets_minimum_trades` boolean in `wallet_scores` indicates this.

### SII Signal Interpretation
- `omega_differential = YES_avg_omega - NO_avg_omega`
- Positive = smart money on YES
- Negative = smart money on NO
- Magnitude indicates conviction level

### Caching Strategy
- Omega scores: 1 hour (customizable with `?ttl=seconds`)
- Market data: 5-30 minutes
- Wallets: 5-10 minutes
- Bypass with `?fresh=true`

## Data Freshness

| Data | Frequency | Latency |
|------|-----------|---------|
| Markets (prices) | Real-time | 1-2 sec |
| Trade volume | 1-5 minutes | 5-10 sec |
| Wallet positions | On-demand | Real-time |
| Wallet scores | 1 hour cache | Fresh on demand |
| ClickHouse metrics | Nightly | 1-24 hrs |
| Whale activity | Real-time | 1-2 sec |

## Tables at a Glance

### Market Data (3 tables)
- `markets` - All ~20k Polymarket markets
- `market_analytics` - Trade volume, momentum, sentiment
- `market_sii` - Smart money side (YES vs NO)

### Wallet Performance (9 tables)
- `wallets` - Master metadata
- `wallet_scores` - Omega, grade, momentum
- `wallet_scores_by_category` - Performance per category
- `wallet_positions` - Current open positions
- `wallet_trades` - Trade history
- `wallet_closed_positions` - Closed positions with PnL
- `wallet_pnl_snapshots` - Historical portfolio value
- `market_holders` - Top holders per market
- `whale_activity_log` - Real-time whale activity

### Strategies (4 tables)
- `strategy_definitions` - Strategy definitions
- `strategy_executions` - Execution history
- `strategy_watchlist_items` - Flagged items
- `strategy_positions` - Created positions

### Workflows (2 tables)
- `workflow_sessions` - User workflows
- `workflow_executions` - Execution history

### Discovery (3 tables)
- `discovered_wallets` - All known wallets
- `watchlist_markets` - User-selected markets
- `watchlist_wallets` - Elite wallets to monitor

### Other (3+ tables)
- `notifications` - User alerts
- `events` - Polymarket events
- Plus system tables

## API Endpoints Summary

**60+ routes** organized by category:
- Market Data (5 endpoints)
- Wallet Metrics (7 endpoints)
- Smart Money Signals (5 endpoints)
- Strategies (6 endpoints)
- Category Analysis (3 endpoints)
- Data Sync & Admin (4 endpoints)
- Notifications (3 endpoints)
- Whale Activity (6 endpoints)
- And more...

See `DATABASE_QUICK_REFERENCE.md` for the complete list.

## Contact & Questions

For questions about specific tables, metrics, or data flows, refer to the appropriate documentation file:
- Overview questions? → `DATABASE_SUMMARY.txt`
- Specific table? → `DATABASE_QUICK_REFERENCE.md`
- Detailed schema? → `CASCADIAN_DATABASE_STRUCTURE.md`
- Code implementation? → Check `lib/` and `app/api/` directories

---

**Generated**: 2025-10-26  
**Documentation Version**: 1.0  
**Status**: Complete

These documents provide a comprehensive understanding of the Cascadian database architecture, data flows, and analytics capabilities. They are meant to be used together as a reference system.
