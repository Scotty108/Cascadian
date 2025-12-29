# Cascadian App - Complete Database Documentation

## Overview

This directory contains comprehensive documentation of the Cascadian app's database structure and data flow. Cascadian is a sophisticated Polymarket analytics platform for identifying smart money traders and generating trading signals.

---

## 🆕 ClickHouse Database Audit (November 2025)

**Complete ClickHouse database inventory with 18 production tables.**

### Quick Start - ClickHouse

| Document | Purpose | Use When |
|----------|---------|----------|
| [DATABASE_AUDIT_SUMMARY.md](./DATABASE_AUDIT_SUMMARY.md) | Executive summary of all tables | You need a table overview |
| [QUICK_QUERY_REFERENCE.md](./QUICK_QUERY_REFERENCE.md) | Copy-paste query library | You need to write a query |
| [TABLE_RELATIONSHIPS_VISUAL.md](./TABLE_RELATIONSHIPS_VISUAL.md) | Visual architecture diagrams | You need to understand joins |
| [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt) | Full detailed inventory (1,279 lines) | You need complete table details |

**Database Stats:**
- **18 tables** | **1.02 billion rows** | **75.38 GB storage**
- Categories: TRADING/CLOB (63 GB), ERC1155 (10 GB), PNL (1 GB), MARKETS (112 MB)
- Last Audit: 2025-11-29

**Critical Patterns:**
```sql
-- ALWAYS deduplicate pm_trader_events_v2
SELECT ... FROM (
  SELECT event_id, any(trader_wallet) as wallet, ...
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) deduped
```

---

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

### 4. **DATABASE_AUDIT_SUMMARY.md** (NEW) - CLICKHOUSE TABLES
**Best for**: ClickHouse table reference, schema lookup

Contains:
- Executive summary of 18 production tables
- Table metadata (size, rows, engine type)
- Complete schema summaries
- Key columns and purposes
- Data quality notes
- Common query patterns
- Unit conversion formulas

### 5. **QUICK_QUERY_REFERENCE.md** (NEW) - CLICKHOUSE QUERIES
**Best for**: Copy-paste ClickHouse queries

Contains:
- 15+ pre-written query patterns
- Deduplication patterns (critical for pm_trader_events_v2)
- Table quick reference (what table has what data)
- Unit conversions (raw → USDC)
- Array access patterns (ClickHouse 1-indexed arrays)
- Performance optimization tips

### 6. **TABLE_RELATIONSHIPS_VISUAL.md** (NEW) - CLICKHOUSE ARCHITECTURE
**Best for**: Understanding ClickHouse table relationships

Contains:
- ASCII architecture diagrams
- Data flow visualizations
- Join pattern reference
- Foreign key relationships (logical)
- Sort key optimizations
- Performance considerations

### 7. **COMPLETE_DATABASE_AUDIT.txt** (NEW) - FULL INVENTORY
**Best for**: Complete ClickHouse table details

Contains:
- Full schema for all 18 tables
- Sample data (first 3 rows per table)
- Sort keys, primary keys, partition keys
- Complete column lists with types
- Data quality notes per table
- 1,279 lines of detailed inventory

---

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

---

## Database Systems

| System | Type | Purpose |
|--------|------|---------|
| **Supabase** | PostgreSQL OLTP | Operational data, strategies, workflows |
| **ClickHouse** | Columnar OLAP | Analytics, 102 metrics per wallet |
| **Goldsky** | GraphQL API | Blockchain data (positions, PnL) |
| **Polymarket** | REST API | Market data and trades |

---

## Quick Start Guide

### For Supabase/General System
1. **New to the codebase?** → Read `DATABASE_SUMMARY.txt`
2. **Need a specific table?** → Check `DATABASE_QUICK_REFERENCE.md`
3. **Building a query?** → Reference `CASCADIAN_DATABASE_STRUCTURE.md`
4. **Exploring API endpoints?** → Use `DATABASE_QUICK_REFERENCE.md` section

### For ClickHouse Queries
1. **Need a query?** → [QUICK_QUERY_REFERENCE.md](./QUICK_QUERY_REFERENCE.md)
2. **Need table details?** → [DATABASE_AUDIT_SUMMARY.md](./DATABASE_AUDIT_SUMMARY.md)
3. **Need architecture?** → [TABLE_RELATIONSHIPS_VISUAL.md](./TABLE_RELATIONSHIPS_VISUAL.md)
4. **Need full inventory?** → [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt)

---

## ClickHouse Table Categories

### TRADING/CLOB (785M rows, 63.1 GB)
- `pm_trader_events_v2` - All CLOB fills (⚠️ requires deduplication)
- `pm_fpmm_trades` - AMM pool trades

### ERC1155/BLOCKCHAIN (201M rows, 10.2 GB)
- `pm_ctf_events` - CTF split/merge/payout events
- `pm_ctf_split_merge_expanded` - Expanded CTF events by outcome
- `pm_erc1155_transfers` - Raw ERC1155 transfers
- `pm_ctf_flows_inferred` - Inferred cash/share flows

### PNL (24.7M rows, 1.01 GB)
- `pm_cascadian_pnl_v1_new` - Primary PnL table
- `pm_wallet_pnl_ui_activity_v1` - UI activity PnL (experimental)

### MARKETS (732K rows, 112 MB)
- `pm_market_metadata` - Complete market information (48 columns)
- `pm_token_to_condition_map_v3` - Token→Condition mapping
- `pm_condition_resolutions` - On-chain resolutions
- `pm_wallet_condition_ledger_v9` - Transaction ledger
- `pm_market_data_quality` - Data quality flags

### OTHER
- `pm_erc20_usdc_flows` - USDC transfer events
- `pm_fpmm_pool_map` - FPMM pool mappings
- `pm_wallet_classification` - Wallet types
- `pm_ui_positions_new` / `pm_api_positions` - Position snapshots

---

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
- `scripts/comprehensive-database-audit.ts` - Database audit (NEW)

---

## Important Notes

### ClickHouse Critical Patterns

**⚠️ ALWAYS deduplicate pm_trader_events_v2:**
```sql
SELECT ... FROM (
  SELECT event_id, any(trader_wallet) as wallet, ...
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) deduped
```

**Why:** Table uses SharedMergeTree with historical duplicates (2-3x per wallet).

**Other ClickHouse conventions:**
- Arrays are 1-indexed: `arrayElement(outcomes, outcome_index + 1)`
- Amounts in raw units: divide by 1,000,000 for USDC
- Always filter `is_deleted = 0`
- Filter on sort keys first for performance

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

---

## Data Freshness

| Data | Frequency | Latency |
|------|-----------|---------|
| Markets (prices) | Real-time | 1-2 sec |
| Trade volume | 1-5 minutes | 5-10 sec |
| Wallet positions | On-demand | Real-time |
| Wallet scores | 1 hour cache | Fresh on demand |
| ClickHouse metrics | Nightly | 1-24 hrs |
| Whale activity | Real-time | 1-2 sec |

---

## Supabase Tables at a Glance

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

---

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

---

## Contact & Questions

For questions about specific tables, metrics, or data flows, refer to the appropriate documentation file:

### Supabase/General
- Overview questions? → `DATABASE_SUMMARY.txt`
- Specific table? → `DATABASE_QUICK_REFERENCE.md`
- Detailed schema? → `CASCADIAN_DATABASE_STRUCTURE.md`

### ClickHouse
- Need a query? → [QUICK_QUERY_REFERENCE.md](./QUICK_QUERY_REFERENCE.md)
- Table details? → [DATABASE_AUDIT_SUMMARY.md](./DATABASE_AUDIT_SUMMARY.md)
- Architecture? → [TABLE_RELATIONSHIPS_VISUAL.md](./TABLE_RELATIONSHIPS_VISUAL.md)
- Full inventory? → [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt)

### Code Implementation
- Check `lib/` and `app/api/` directories

---

## Changelog

### 2025-11-29 - ClickHouse Database Audit
- Comprehensive audit of 18 ClickHouse tables
- Created DATABASE_AUDIT_SUMMARY.md
- Created QUICK_QUERY_REFERENCE.md
- Created TABLE_RELATIONSHIPS_VISUAL.md
- Created COMPLETE_DATABASE_AUDIT.txt (1,279 lines)
- Updated this README with ClickHouse documentation

### 2025-10-26 - Initial Documentation
- Created DATABASE_SUMMARY.txt
- Created DATABASE_QUICK_REFERENCE.md
- Created CASCADIAN_DATABASE_STRUCTURE.md
- Initial README.md

---

**Documentation Version**: 2.0 (November 2025 ClickHouse Audit)
**Status**: Complete
**Last Updated**: 2025-11-29

These documents provide a comprehensive understanding of the Cascadian database architecture, data flows, and analytics capabilities. They are meant to be used together as a reference system.
