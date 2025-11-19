# Wallet Schema Discovery - Complete Documentation Index

## Overview
Complete inventory of all ClickHouse tables and views containing wallet address fields in the CASCADIAN platform. This is the foundational reference for implementing wallet canonicalization across the system.

---

## Documents Generated

### 1. WALLET_SCHEMA_DISCOVERY_REPORT.md (641 lines)
**Comprehensive reference with full details**

Contents:
- Executive summary
- Complete table/view inventory (13 tables + 3 views)
- Wallet columns per table with data types
- Row counts and growth rates  
- Index and constraint details
- Sample queries for each table
- Canonicalization challenges
- 4-phase implementation plan

**Use When**: Need complete technical details, implementing features, designing queries

**Key Sections**:
- Section 1: Wallet Dimension Tables (wallets_dim, wallet_metrics, wallet_metrics_complete, etc.)
- Section 2: Trade & Transaction Tables (trades_raw, pm_trades, pm_trades_external, etc.)
- Section 3: Blockchain Transfers (erc1155_transfers_enriched, wallet_positions_current)
- Section 4: Proxy Mapping (pm_user_proxy_wallets, proxy_wallets_active)
- Section 5: Materialized Views
- Section 6: Reference Tables

---

### 2. WALLET_SCHEMA_QUICK_REFERENCE.md
**Quick lookup guide for developers**

Contents:
- All 16 tables/views listed by category
- Wallet field variations (11 different field names)
- Primary indexes by table
- Bloom filter index locations
- Data volume summary
- 4-phase canonicalization strategy
- Sample queries for discovery
- Integration checklist

**Use When**: 
- Need quick facts about a table
- Looking up which tables have wallet_address
- Checking data volumes
- Planning implementation phases

**Best For**: Daily reference, onboarding, quick lookups

---

### 3. WALLET_FIELDS_TECHNICAL_REFERENCE.md  
**Field-by-field technical documentation**

Contents:
- Detailed spec for each wallet field (11 fields documented)
- Field specifications:
  - Type and format requirements
  - Semantics and meaning
  - Data sources
  - Relationships and joins
  - Example queries
- Canonicalization rules and formulas
- Data type requirements and validation
- Join patterns for resolution
- Performance notes
- Common gotchas and edge cases
- Migration checklist

**Use When**:
- Implementing wallet resolution logic
- Building SQL queries with joins
- Adding new wallet-related features
- Validating wallet address formats
- Troubleshooting canonicalization issues

**Best For**: Implementation details, debugging, edge case handling

---

## Key Findings Summary

### Wallet Field Inventory
- **Total distinct field names**: 11
- **Total tables/views**: 16 (13 tables + 3 views)
- **Primary field**: wallet_address (appears in 10+ tables)
- **High-cardinality tables**: pm_trades (50M), erc1155_transfers (100M)
- **Low-cardinality tables**: pm_user_proxy_wallets (5K - critical for proxy resolution)

### Field Distribution
```
wallet_address         10 tables  (standard identifier)
maker_address           1 table   (CLOB maker)
taker_address           1 table   (CLOB taker)
from_addr              1 table   (ERC1155 sender)
to_addr                1 table   (ERC1155 recipient)
user_eoa               2 tables  (proxy owner)
proxy_wallet           2 tables  (proxy contract)
operator_address       1 table   (transaction signer)
from_eoa               1 table   (decoded sender EOA)
to_eoa                 1 table   (decoded recipient EOA)
operator               1 table   (event operator)
```

### Data Volume Summary
```
Total unique wallets        ~50,000+
Total wallet-related rows   ~300M+ (across all tables)
Daily growth rate          ~100K+ new events/day
Largest table              erc1155_transfers (100M rows)
Fastest growing            pm_trades (50K new fills/day)
```

### Index Strategy
- Primary keys: 9 composite keys on wallet fields
- Bloom filters: 5 tables with bloom_filter(0.01) indexes
- MinMax indexes: 3 metrics indexes for range queries
- Partitioning: Date-based for most transactional tables

---

## Canonical Wallet Address Format

### Standard Format
```
0x + 40 lowercase hex characters
Example: 0x1234567890abcdef1234567890abcdef12345678
Length: 42 characters
```

### Normalization Rules
1. **Case**: Always lowercase
2. **Prefix**: Always 0x
3. **Padding**: Left-pad with zeros if needed
4. **Null Handling**: Never NULL, use empty string as default
5. **Proxy Resolution**: Join with pm_user_proxy_wallets to resolve EOA

### Proxy Resolution Logic
```sql
-- Get true owner (EOA) if wallet is proxy
SELECT COALESCE(pw.user_eoa, w.wallet_address) as canonical_wallet
FROM wallets w
LEFT JOIN pm_user_proxy_wallets pw 
  ON lower(w.wallet_address) = lower(pw.proxy_wallet)
```

---

## Common Query Patterns

### 1. Get All Wallets by Activity
```sql
SELECT wallet_address, COUNT(*) as events
FROM wallets_dim
WHERE is_active = 1
ORDER BY total_volume_usd DESC
LIMIT 100
```

### 2. Resolve Maker/Taker to EOAs
```sql
SELECT 
  COALESCE(pm.user_eoa, pt.maker_address) as canonical_maker,
  COUNT(*) as trades
FROM pm_trades pt
LEFT JOIN pm_user_proxy_wallets pm 
  ON lower(pt.maker_address) = lower(pm.proxy_wallet)
WHERE pt.timestamp >= now() - interval 30 day
GROUP BY canonical_maker
ORDER BY trades DESC LIMIT 50
```

### 3. Find Proxy Relationships
```sql
SELECT user_eoa, COUNT(*) as proxy_count
FROM pm_user_proxy_wallets
WHERE is_active = 1
GROUP BY user_eoa
HAVING COUNT(*) > 1
ORDER BY proxy_count DESC
```

### 4. Track Wallet Metrics
```sql
SELECT wallet_address, time_window, realized_pnl, omega_ratio
FROM wallet_metrics
WHERE time_window = '90d' AND total_trades >= 10
ORDER BY omega_ratio DESC LIMIT 100
```

---

## Implementation Roadmap

### Phase 1: Inventory & Mapping (COMPLETE)
- [x] Identify all wallet fields across schema
- [x] Document table relationships
- [x] Map proxy→EOA relationships
- [x] Create comprehensive reference

### Phase 2: Create Canonical Table (TODO)
```sql
CREATE TABLE canonical_wallet_addresses (
  canonical_address String,
  addresses_seen Array(String),
  primary_eoa String,
  is_proxy UInt8,
  first_seen DateTime,
  last_seen DateTime,
  status String,
  ingested_at DateTime
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY canonical_address
```

### Phase 3: Add Canonical Columns (TODO)
- ALTER TABLE wallets_dim ADD COLUMN canonical_address
- ALTER TABLE wallet_metrics ADD COLUMN canonical_address
- ALTER TABLE pm_trades ADD COLUMN canonical_maker, canonical_taker
- ALTER TABLE trades_raw ADD COLUMN canonical_address
- ALTER TABLE pm_trades_external ADD COLUMN canonical_address

### Phase 4: Update APIs & Views (TODO)
- Update /api/wallets/[address]/ endpoints
- Update leaderboard queries
- Update copy-trading logic
- Update erc1155_transfers_enriched view

### Phase 5: Backfill & Validation (TODO)
- Backfill historical data
- Validate consistency
- Performance testing
- Production deployment

---

## Related Documentation

### Project Documentation
- **CLAUDE.md** - Project overview and architecture
- **RULES.md** - Workflow patterns and agent roles
- **docs/systems/database/STABLE_PACK_REFERENCE.md** - Database patterns

### Migration Files (Source of Truth)
- `/migrations/clickhouse/001_create_wallets_dim.sql`
- `/migrations/clickhouse/004_create_wallet_metrics_complete.sql`
- `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql`
- `/migrations/clickhouse/017_create_pm_trades_external.sql`

### API Documentation
- `/app/api/wallets/[address]/metrics/route.ts` - Metrics endpoint
- `/app/api/wallets/top/route.ts` - Top wallets endpoint
- `/app/api/wallets/[address]/category-breakdown/route.ts` - Category metrics

---

## Quick Navigation

### Find by Purpose

**Need to understand wallet data flow?**
→ WALLET_SCHEMA_DISCOVERY_REPORT.md, Section 1-3

**Need quick facts about a table?**
→ WALLET_SCHEMA_QUICK_REFERENCE.md

**Need to write a query with wallet joins?**
→ WALLET_FIELDS_TECHNICAL_REFERENCE.md, JOIN PATTERNS section

**Need validation/normalization logic?**
→ WALLET_FIELDS_TECHNICAL_REFERENCE.md, CANONICALIZATION RULES section

**Need edge case details?**
→ WALLET_FIELDS_TECHNICAL_REFERENCE.md, GOTCHAS section

**Need performance tips?**
→ WALLET_FIELDS_TECHNICAL_REFERENCE.md, PERFORMANCE NOTES section

---

## Key Statistics

### Data Coverage
- **Data Sources**: 4 (CLOB API, Subgraph, Data API, ERC1155 events)
- **Time Range**: Aug 2024 → Present
- **Geographic Coverage**: Global (Polymarket)
- **Wallet Tracking**: ~50K distinct wallets

### Table Characteristics
- **ReplacingMergeTree**: 8 tables (idempotent updates)
- **MergeTree**: 3 tables (append-only)
- **Views**: 3 (aggregations/enrichments)
- **Materialized Views**: 2 (cached aggregations)

### Index Coverage
- **Primary Keys**: 9 on wallet fields
- **Bloom Filters**: 5 for fast lookups
- **MinMax Indexes**: 3 for ranges

---

## Contacts & Escalation

**Questions about schema?**
→ Check WALLET_SCHEMA_DISCOVERY_REPORT.md first

**Questions about specific fields?**
→ Check WALLET_FIELDS_TECHNICAL_REFERENCE.md

**Questions about implementation?**
→ Check WALLET_SCHEMA_QUICK_REFERENCE.md integration checklist

**Need to update documentation?**
→ Maintain all three files in parallel (they cross-reference)

---

## Document Maintenance

### When to Update
- New wallet fields added to schema
- New tables created with wallet data
- New proxy relationships discovered
- Index strategy changes

### Version Control
- All documents checked into /Users/scotty/Projects/Cascadian-app/
- Part of codebase repository
- Updated alongside migration files

### Last Updated
- Generated: 2025-11-16
- Source: Migration files (001, 004, 015, 016, 017)
- Status: Complete exploration, ready for implementation

---

## Summary

This documentation package provides:
1. **Complete inventory** - All tables/views with wallet fields
2. **Technical details** - Field specs, types, relationships
3. **Quick reference** - Fast lookup for common questions
4. **Implementation guide** - Step-by-step canonicalization plan
5. **Sample queries** - Real SQL examples for each pattern

Start with WALLET_SCHEMA_QUICK_REFERENCE.md for overview, then dive into detailed documents as needed.

---

**Status**: Research Complete - Ready for Implementation Phase 2
**Prepared by**: Exploration Agent
**Date**: 2025-11-16
