# Cascadian App - Quick Reference Guide
## Major Narratives at a Glance

---

## 1. POLYMARKET DATA PIPELINE RECONSTRUCTION
**Status**: Mostly complete, needs critical fixes
**Impact**: Core feature - enables smart money tracking and copy-trading

### Problem Solved
- Initial pipeline captured only 0.3% of trades
- Wrong data source: Used USDC transfers instead of ERC1155 conditional token swaps
- Wallet mapping failed: Sampled contract addresses instead of EOA traders

### Solution
7-step pipeline: ApprovalForAll → Flattened ERC1155 → Token Mapping → CLOB Fills → Positions → Funding → Validation

### Files
- `scripts/build-approval-proxies.ts` - Proxy mapping
- `scripts/flatten-erc1155.ts` - Transfer decoding  
- `scripts/map-tokenid-to-market.ts` - Token ID mapping
- `scripts/ingest-clob-fills.ts` - CLOB API fills
- `scripts/validate-three.ts` - Validation against known wallets

### Critical Blockers
1. **TransferBatch Decoding**: Currently stores "0x" placeholders, losing multi-token transfers
2. **CLOB Pagination**: Only fetches first 1000 fills, misses wallets with larger histories
3. **Fill Deduplication**: Missing fill_id primary key, creates duplicates on re-runs

---

## 2. DATA PIPELINE & ORCHESTRATION
**Status**: Implemented and running
**Impact**: Enables autonomous overnight data backfill and real-time updates

### Problem Solved
- Manual data ingestion doesn't scale
- Need parallel processing for 1,048 days of blockchain data
- Automatic recovery from RPC failures and stalls

### Solution
8 parallel workers with day-based sharding, auto-restart monitor, safety gates, checkpoint system

### Key Metrics
- Speed: 2-5 hours for full backfill
- Throughput: 8 workers × 131 days each (day_idx % 8 sharding)
- Recovery: Auto-restart on 5-min stall detection
- Validation: Every 30 min with confidence thresholds

### Files
- `scripts/step3-streaming-backfill-parallel.ts` - Worker orchestration
- `scripts/parallel-backfill-monitor.ts` - Health monitoring
- `scripts/launch-workers.sh` - Deployment script

---

## 3. TRADING STRATEGY SYSTEM
**Status**: 18/18 task groups complete
**Impact**: Core product - enables autonomous copy-trading and execution

### Features Built
1. Strategy Builder - Visual node-based workflow editor
2. Execution Engine - Cron job orchestrator
3. Control API - Create/enable/disable/archive strategies
4. Dashboard - Real-time PnL monitoring
5. Approval Workflow - Risk gates + user confirmation
6. Filter System - Multi-condition flexible filtering

### Strategy Types
- Copy Trading - Rank smart wallets, copy top N
- Consensus - Execute when multiple smart wallets trade
- Smart Money - Track specific high-performer wallets
- Predefined - Manual rule sets

### Files
- `lib/strategy/builder.ts` - Core builder
- `lib/strategy/execution.ts` - Execution engine
- `scripts/cron-strategy-executor.ts` - Scheduler
- Dashboard components (strategy, filters, orchestrator)

---

## 4. CLICKHOUSE DATABASE ARCHITECTURE
**Status**: Designed and documented
**Impact**: Foundation for all data storage and analytics

### Key Design Patterns
- **ReplacingMergeTree**: Deduplication of replayed data
- **Decimal128**: Precise financial calculations
- **LowCardinality**: High-repeat strings
- **Partitioning**: Monthly by block_time

### Tables
- erc20_transfers (388M rows - USDC)
- erc1155_transfers (50M rows - Conditional tokens)
- pm_user_proxy_wallets (100K rows - Wallet mapping)
- pm_trades (10M rows - CLOB fills)
- pm_wallet_positions (1M rows - Computed positions)
- pm_wallet_funding (100K rows - Funding flows)

### Key Decisions
- No UPDATE operations; use ReplacingMergeTree instead
- Pre-compute positions rather than real-time aggregation
- Partitioning for query efficiency

### Files
- `lib/clickhouse/client.ts` - Connection utilities
- Multiple migration files for schema evolution

---

## 5. SMART MONEY WALLET TRACKING
**Status**: Fully implemented
**Impact**: Enables identification of top traders for copy-trading

### Metrics Tracked
- Win rate (profitable trades / total)
- ROI (realized PnL / net funding)
- Trade frequency & consistency
- Average trade size
- Market concentration

### Data Sources
1. ApprovalForAll events → EOA/proxy mapping
2. ERC1155 transfers → Position tracking
3. CLOB fills → Execution prices
4. Polymarket profiles → Validation

### Files
- `scripts/validate-three.ts` - Known wallet validation
- Copy-trading ranking system

---

## 6. DASHBOARD & FRONTEND
**Status**: Mostly complete (18 task groups done)
**Impact**: User-facing product interface

### Components
1. Strategy Builder - Node-based workflow editor
2. Real Node Graphs - D3/Dagre visualization
3. Filter UI - Drag-and-drop filter building
4. Dashboard Metrics - Live PnL display
5. Notification Center - Event triggers
6. Watchlist API - Custom user lists
7. Portfolio View - Position aggregation

### Tech Stack
- React + TypeScript
- Dagre for auto-layout
- Redux-style state management
- Connected to ClickHouse queries

---

## 7. BLOCKCHAIN DATA INTEGRATION
**Status**: Partially working, critical issues identified
**Impact**: Foundation for all on-chain data

### Processing Stages
1. **Event Decoding**: Extract TransferSingle/TransferBatch/ApprovalForAll
2. **Enrichment**: Map token IDs to markets, add metadata
3. **Aggregation**: Flatten nested transfers, compute net flows

### Critical Issues
1. **TransferBatch**: Stores "0x" placeholders for id/value arrays
   - Fix: Use ethers.Interface to decode
   - Impact: Unknown % of transfers lost
   - Effort: ~1 hour

2. **CLOB Pagination**: Only fetches first 1000 fills
   - Fix: Implement cursor-based pagination
   - Impact: Large wallets have incomplete data
   - Effort: ~1 hour

3. **Fill Deduplication**: No unique constraint
   - Fix: Use ReplacingMergeTree with fill_id
   - Impact: Re-runs create duplicates
   - Effort: ~30 min

### Files
- `scripts/flatten-erc1155.ts` - ERC1155 decoding
- `scripts/build-approval-proxies.ts` - ApprovalForAll extraction
- `scripts/map-tokenid-to-market.ts` - Token mapping
- `scripts/ingest-clob-fills.ts` - CLOB API fills

---

## SUCCESS METRICS & VALIDATION

### Known Wallet Test Matrix
| Wallet | Trades | Target 70% | Target 90% |
|--------|--------|-----------|-----------|
| HolyMoses7 | 2,182 | 1,527 | 1,964 |
| niggemon | 1,087 | 761 | 978 |
| Wallet3 | 0 | 0 | 0 |

### Data Quality Gates
- Backfill: 60% confidence during loading, 80% after
- Trade count: >= 70% of expected (P0), >= 90% (P1)
- PnL accuracy: Within 5% of Polymarket profiles (P1)
- Token mapping: >= 80% coverage (P1)

---

## CRITICAL PATH - REMAINING WORK

### MUST FIX (P0 - Blocking)
- [ ] TransferBatch ABI decoding - Fix "0x" placeholders
- [ ] CLOB pagination - Add cursor/backoff support
- [ ] Fill deduplication - Use ReplacingMergeTree
- [ ] Validate known wallets reach 70% accuracy

### Should Have (P1)
- [ ] Funding flow separation table
- [ ] Complete PnL calculation (realized + unrealized)
- [ ] Auto-detect conditional token address
- [ ] Proxy resolution fallback (operator→EOA)

### Nice to Have (P2)
- [ ] Current price feeds for unrealized PnL
- [ ] Historical snapshots for trends
- [ ] Performance optimization for large wallets

---

## TECHNOLOGY STACK

| Layer | Technology |
|-------|-----------|
| Data Warehouse | ClickHouse (OLAP, 388M+ rows) |
| Blockchain RPC | Polygon Alchemy (eth_getLogs) |
| External APIs | Gamma, CLOB, Polymarket Strapi |
| Backend | TypeScript/Node.js |
| Frontend | React + TypeScript |
| Graph Viz | Dagre |
| Dev Tools | Claude Code CLI |

---

## KEY INSIGHTS

1. **Different protocols, different settlement**: Polymarket uses ERC1155, not ERC20
2. **Data quality first**: Validation at every stage is non-negotiable
3. **Distributed processing needs checkpoints**: Recovery is essential
4. **Always paginate APIs**: Never assume you got all results
5. **Use Decimal128 for money**: Floats lose precision
6. **Know your data**: On-chain data alone isn't enough; need multiple sources
7. **Test with real data**: Known wallet validation beats synthetic tests

---

## DOCUMENTATION FILES

- `PROJECT_NARRATIVES_ANALYSIS.md` - Full narrative breakdown (478 lines)
- `POLYMARKET_TECHNICAL_ANALYSIS.md` - Detailed Polymarket spec (840+ lines)
- `POLYMARKET_10_POINT_IMPLEMENTATION_ROADMAP.md` - Implementation guide
- `PIPELINE_REBUILD_SUMMARY.md` - Pipeline architecture
- `EXECUTION_COMPLETE.md` - Backfill system status
- `OPERATIONAL_GUIDE.md` - Running the system
- `PIPELINE_QUICK_START.md` - Quick start guide

---

**Quick Reference** | **Version 1.0** | **Updated 2025-11-06**

