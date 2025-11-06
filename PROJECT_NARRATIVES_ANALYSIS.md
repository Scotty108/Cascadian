# Cascadian App - Major Narratives & Architectural Decisions
## Comprehensive Project Development History

---

## NARRATIVE #1: Polymarket Data Pipeline Reconstruction

### The Problem
The initial approach attempted to track Polymarket trades using USDC transfer data (387.7M records), but this fundamentally failed to capture actual trading activity. The system could only identify ~0.3% of trades:
- **HolyMoses7**: Expected 2,182 trades → Detected 0
- **niggemon**: Expected 1,087 trades → Detected 21 (1.9%)
- **Wallet3**: Expected 0 trades → Detected 0

### Root Cause
The critical architectural misunderstanding: Polymarket doesn't settle trades in USDC. Instead:
- **Trade Mechanism**: Polymarket uses ERC1155 conditional token swaps
- **Wallet Pattern**: EOAs approve proxy contracts via ApprovalForAll events to manage their positions
- **Settlement**: USDC only moves for deposits/withdrawals, not per-trade
- **Pricing**: CLOB API provides actual execution prices and fill history

### Solution Implemented
Complete pipeline reconstruction with 7 sequential steps:

1. **ApprovalForAll Events** → `pm_user_proxy_wallets` (EOA → Proxy mapping)
2. **ERC1155 Transfers** → `pm_erc1155_flats` (Decoded conditional token transfers)
3. **Token ID Mapping** → `pm_tokenid_market_map` (Gamma API integration)
4. **CLOB Fills Ingestion** → `pm_trades` (Execution prices from API)
5. **Position Aggregation** → `pm_wallet_positions` (PnL calculation)
6. **Funding Flow Tracking** → `pm_wallet_funding` (USDC in/out separation)
7. **Validation** → Against known Polymarket profiles

### Key Files & Code
- `scripts/build-approval-proxies.ts` - On-chain proxy mapping
- `scripts/flatten-erc1155.ts` - ERC1155 transfer decoding
- `scripts/map-tokenid-to-market.ts` - Gamma API integration
- `scripts/ingest-clob-fills.ts` - CLOB API fills ingestion
- `scripts/build-positions-from-erc1155.ts` - Position aggregation
- `scripts/validate-three.ts` - Known wallet validation
- **Documentation**: `POLYMARKET_TECHNICAL_ANALYSIS.md` (840+ lines)
- **Documentation**: `POLYMARKET_10_POINT_IMPLEMENTATION_ROADMAP.md`

### Critical Technical Decisions
- **TransferBatch Decoding**: Must use ethers.js Interface to decode multi-token transfers (currently stored with placeholder "0x" values - data loss issue)
- **Primary Keys**: Use ReplacingMergeTree for deduplication in ClickHouse
- **API Pagination**: CLOB API requires exponential backoff and cursor-based pagination (currently only fetches first 1000 fills)
- **Wallet Resolution**: Fallback from on-chain ApprovalForAll to operator→EOA inference

### Success Metrics
- P0: HolyMoses7 >= 1,527 trades (70%), niggemon >= 761 (70%), Wallet3 = 0
- P1: HolyMoses7 >= 1,964 (90%), niggemon >= 978 (90%), PnL within 5%
- P2: 100% accuracy with all features working

### Data Architecture
```
erc1155_transfers:        ~50M rows
erc20_transfers:          388M rows (USDC)
pm_user_proxy_wallets:    ~100K rows
pm_tokenid_market_map:    ~20K rows
pm_trades:                ~10M rows
pm_erc1155_flats:         ~50M rows
pm_wallet_positions:      ~1M rows
pm_wallet_funding:        ~100K rows
```

---

## NARRATIVE #2: Data Pipeline & Orchestration

### The Problem
Manual data ingestion processes were inefficient and didn't scale. The system needed:
- Parallel backfill of 1,048 historical days
- Real-time streaming ingestion
- Automatic recovery from failures
- Quality gates and validation

### Solution Implemented
Built a sophisticated multi-stage data orchestration system:

**Workers**: 8 parallel workers with day-based sharding (day_idx % 8 == SHARD_ID)
**Monitoring**: Auto-restart on 5-minute stall threshold with 30-second polling
**Safety Gates**: Validation every 30 minutes with 60%/80% thresholds
**Checkpoints**: Atomic day-claiming prevents race conditions
**Auto-Rebuild**: 4-step rebuild triggers automatically on completion:
  1. `step3-compute-net-flows.ts` (direction on full data)
  2. `hard-gate-validator.ts` (strict validation - MUST PASS)
  3. `step5-rebuild-pnl.ts` (PnL rebuild)
  4. `coverage-final.ts` (final metrics)

### Key Implementation Details
- **Goldsky Integration**: Historical trade data loader with PnL correction factors
- **RPC Optimization**: Handles "Log response size exceeded" errors gracefully with 3-attempt retry
- **Idempotency**: ReplacingMergeTree with (tx_hash, log_index) prevents duplicates
- **Durability**: Checkpoint system with heartbeats and auto-restart
- **Observability**: Real-time log monitoring with `data/backfill/worker-*.log`

### Key Files
- `scripts/step3-streaming-backfill-parallel.ts` - Parallel backfill orchestrator
- `scripts/parallel-backfill-monitor.ts` - Health monitoring
- `scripts/create-transfer-staging-tables.ts` - Schema setup
- Deployment: `scripts/launch-workers.sh`, `restart-workers-*.sh`
- **Documentation**: `EXECUTION_COMPLETE.md` (212 lines)
- **Documentation**: `PIPELINE_REBUILD_SUMMARY.md`

### Performance Characteristics
- **Backfill Speed**: 2-5 hours for 1,048 days with 8 workers
- **Query Times**: 
  - Proxy lookup: <10ms
  - Trade count: <100ms
  - Position aggregation: <500ms
  - Full validation run: ~30s

### Technical Decisions
- **Partitioning**: `toYYYYMM(block_time)` for efficient pruning
- **Worker Protocol**: Checkpoint-based claiming with atomic operations
- **Rate Limiting**: Graceful handling with exponential backoff
- **Failure Recovery**: Monitor auto-restarts stalled workers

---

## NARRATIVE #3: Trading Strategy System

### The Problem
Needed a comprehensive system for:
- Multiple trading strategy types (copy-trading, consensus, smart-money, predefined)
- Autonomous execution with user approval workflows
- Strategy builder with flexible filter conditions
- Real-time execution monitoring and PnL tracking

### Solution Implemented
Built a complete strategy execution platform with:

**Architecture Layers**:
1. **Strategy Builder** - Visual node-based workflow editor
2. **Execution Engine** - Cron job orchestrator + autonomous execution
3. **Control API** - Strategy management (create, enable, disable, archive)
4. **Dashboard** - Real-time PnL monitoring and metrics
5. **Approval Workflow** - Risk analysis + user confirmation gates

**Strategy Types**:
- **Copy Trading**: Rank wallets by metrics, copy top N trades
- **Consensus**: Execute when multiple smart wallets trade
- **Smart Money**: Track specific high-performer wallets
- **Predefined**: Manually configured rule sets

### Key Implementations
- **Autonomous Execution**: Overnight orchestrator that runs strategies on schedule
- **Filter System**: Multi-condition filters with smart operators
- **Field Discovery**: Dynamic field detection for filter building
- **PnL Calculation**: Connected to real strategy performance data
- **Node Graph Visualization**: Dagre-based auto-layout for workflows

### Key Files
- `lib/strategy/builder.ts` - Strategy builder core
- `lib/strategy/execution.ts` - Execution engine
- `scripts/cron-strategy-executor.ts` - Cron job handler
- **Dashboard Components**: Strategy builder UI with 18 task groups
- **Database**: Strategy archiving with migrations

### Technical Decisions
- **Database Engine**: ReplacingMergeTree for strategy versioning
- **Execution Model**: Cron-based with manual approval gates
- **Filter Architecture**: Modular operator system supporting AND/OR logic
- **UI Framework**: React with node-based diagram (Dagre layout)

### Status: 18 Task Groups Completed
1. Strategy Builder Architecture
2. Autonomous Execution System
3. Cron Job Strategy Execution
4. Control API
5. Dashboard Implementation
6. Multi-Condition Filters
7. Field Discovery
8. Smart Operators
9. Category & Tag Filters
10. Text Search Filters
11. Filter Executor Logic
12. Enhanced Filter UI
13. Portfolio Orchestrator API
14. AI Risk Analysis Engine
15. Orchestrator Node UI
16. Approval Workflow
17. Dagre Layout Integration
18. Auto-layout for AI workflows

---

## NARRATIVE #4: ClickHouse Database Architecture

### The Problem
Needed a robust, high-performance database for:
- Storing hundreds of millions of blockchain records
- Complex queries across multiple data sources
- Real-time and historical analytics
- Efficient deduplication and mutations

### Solution Implemented
ClickHouse chosen as the core data warehouse with careful schema design:

**Key Design Patterns**:
- **ReplacingMergeTree**: For deduplication of replayed data
- **MergeTree with Partitioning**: For time-series optimization
- **LowCardinality**: For high-repeat columns (strings)
- **Decimal128**: For precise financial calculations

**Major Issues & Fixes**:

1. **Mutation Limit Issue**
   - Problem: ClickHouse has default mutation limits
   - Solution: Understood limits and designed for idempotency instead
   - Approach: Use ReplacingMergeTree primary keys rather than UPDATE

2. **Schema Evolution**
   - Implemented migration system for schema changes
   - Strategy table migrations for archiving
   - Cross-version compatibility

3. **Data Type Precision**
   - Critical for financial data
   - Decimal128(10) for prices, fees, PnL
   - String for token IDs and addresses

### Key Tables
- `erc20_transfers` - USDC transfers (388M rows)
- `erc1155_transfers` - Conditional token transfers
- `pm_user_proxy_wallets` - EOA/Proxy mapping
- `pm_trades` - CLOB fills
- `pm_wallet_positions` - Computed positions
- `pm_wallet_funding` - Funding flows
- Strategy tables with archiving support

### Key Files
- `lib/clickhouse/client.ts` - Connection & utilities
- Multiple migration files for schema evolution
- **Documentation**: `CASCADIAN_DATABASE_COMPLETE_DOCUMENTATION`

### Technical Decisions
- **Aggregation Strategy**: Pre-compute positions rather than real-time
- **Partitioning Scheme**: Monthly for transfers, custom for tracking tables
- **Indexing**: Careful INDEX selection for join performance
- **Backup Strategy**: Consistent snapshots for recovery

---

## NARRATIVE #5: Smart Money Wallet Tracking System

### The Problem
Needed to identify and track high-performer wallets ("smart money") for copy-trading:
- How to identify successful traders
- How to map on-chain wallets to trader identities
- How to calculate meaningful ranking metrics
- How to keep lists current and accurate

### Solution Implemented
Built wallet ranking system based on:
- **PnL Performance**: Win rate and return metrics
- **Volume & Consistency**: Trade frequency and size
- **Smart Money Inference**: Using copy-trade patterns and consensus
- **Fallback Detection**: From operator→EOA patterns

**Ranking Metrics**:
- Win rate (profitable trades / total trades)
- ROI (total realized PnL / net funding)
- Trade frequency and consistency
- Average trade size
- Market concentration

**Data Sources**:
1. On-chain ApprovalForAll events (wallet mapping)
2. ERC1155 transfer analysis (position tracking)
3. CLOB fills (execution prices)
4. Manual Polymarket profile verification

### Key Implementation
- `scripts/validate-known-wallets.ts` - Validation against known traders
- Copy-trading wallet ranking fully implemented
- Integration with strategy system for automated copying

### Technical Decisions
- **Ranking Algorithm**: Weighted combination of metrics
- **Freshness**: Periodic recalculation from latest data
- **Validation**: Cross-check against Polymarket profiles
- **Privacy**: Aggregate metrics, no personal data

---

## NARRATIVE #6: Dashboard & Frontend Architecture

### The Problem
Needed a comprehensive, real-time dashboard showing:
- Trading performance metrics
- Strategy status and PnL
- Portfolio positions
- Smart money leader boards
- Event/notification feed

### Solution Implemented
React-based dashboard with:

**Major Components**:
1. **Strategy Builder UI** - Visual workflow editor with node graphs
2. **Real Node Graphs Display** - D3/Dagre-based visualization
3. **Filter UI System** - Drag-and-drop filter building
4. **Dashboard Metrics** - Live PnL and strategy performance
5. **Notification Center** - Event triggers and alerts
6. **Watchlist API** - Custom user watchlists
7. **Portfolio Orchestrator** - Position aggregation view

**UI Technologies**:
- React + TypeScript
- Dagre for graph layout
- Auto-layout for AI-generated workflows
- Filter executor logic for dynamic filtering

### Implementation Status
- Phase 1: Enhanced Filter Node UI complete
- 18 task groups for Strategy Builder completed
- Production node graph visualization working
- Real-time PnL connection to data

### Key Decisions
- **Architecture**: Component-based with Redux-style state
- **Real-time Updates**: Connected to ClickHouse queries
- **Visualization**: Dagre-based auto-layout for workflows
- **Responsiveness**: Mobile-friendly design

### Key Files
- Dashboard components with PnL display
- Node graph rendering with auto-layout
- Filter builder interface
- Strategy execution monitoring

---

## NARRATIVE #7: Blockchain Data Integration

### The Problem
Raw blockchain data needs sophisticated processing:
- Decode ERC1155 events (TransferSingle and TransferBatch)
- Extract on-chain wallet approvals
- Map token IDs to markets
- Distinguish trades from funding flows
- Handle edge cases (batch transfers, revocations)

### Solution Implemented
Multi-stage data normalization pipeline:

**Stage 1: Event Decoding**
- TransferSingle: Direct ABI decoding (implemented)
- TransferBatch: Requires array decoding (currently broken with "0x" placeholders)
- ApprovalForAll: Direct decoding for wallet mapping

**Stage 2: Enrichment**
- Token ID → Market ID mapping via Gamma API
- Add outcome labels and market metadata
- Compute transfer direction (buy/sell proxy perspective)

**Stage 3: Aggregation**
- Flatten nested transfers into individual rows
- Join with proxy mappings
- Create position snapshots

### Critical Issues & Fixes
1. **TransferBatch Placeholder Problem** 🔥 CRITICAL
   - Current: Stores "0x" for both token_id and amount
   - Impact: Unknown % of multi-token transfers lost
   - Fix: Use ethers.Interface to decode arrays
   - Effort: ~1 hour

2. **CLOB Pagination Issue** 🔥 CRITICAL
   - Current: Only fetches first 1000 fills
   - Impact: Wallets with >1000 fills have incomplete data
   - Fix: Implement cursor-based pagination with backoff
   - Effort: ~1 hour

3. **Fill Deduplication** ⚠️ HIGH
   - Current: INSERT without unique constraint
   - Impact: Re-runs create duplicates
   - Fix: Use ReplacingMergeTree with fill_id as key

### Key Files
- `scripts/flatten-erc1155.ts` - ERC1155 decoding
- `scripts/build-approval-proxies.ts` - ApprovalForAll extraction
- `scripts/map-tokenid-to-market.ts` - Token mapping
- `scripts/ingest-clob-fills.ts` - CLOB API integration
- `scripts/debug-hex-parsing.ts` - Hex debugging utilities

### Technical Decisions
- **Decoding Library**: ethers.js for ABI parsing
- **Data Format**: Hex strings with 0x prefix for consistency
- **Partitioning**: By block time for historical queries
- **Deduplication**: Hash-based with atomic operations

---

## CROSS-CUTTING TECHNICAL PATTERNS

### 1. Data Architecture Pattern
All major subsystems follow: **Source → Transform → Normalize → Validate → Store**

### 2. Error Handling
- **Graceful Degradation**: RPC failures don't block entire pipeline
- **Exponential Backoff**: Rate limit handling with progressive delays
- **Checkpoint Recovery**: Resume from last known good state

### 3. Testing & Validation
- **Known Wallet Validation**: Test against 3 verified Polymarket profiles
- **Data Quality Gates**: Confidence thresholds (60%/80%) for promotion
- **Snapshot Validation**: Compare before/after metrics

### 4. Documentation
- Extensive inline comments in critical sections
- Architecture decision records (ADRs)
- API specifications and data flow diagrams
- Validation criteria and acceptance tests

### 5. Operational Observability
- Structured logging with timestamps
- Heartbeat monitoring for long-running processes
- Real-time progress tracking
- Log aggregation points

---

## CRITICAL REMAINING WORK

### P0 (Blocking)
1. ✅ Polymarket data pipeline reconstruction - COMPLETE
2. ✅ ClickHouse database redesign - COMPLETE
3. ❌ **TransferBatch ABI decoding** - Fix placeholder "0x" values
4. ❌ **CLOB pagination** - Add cursor-based pagination with backoff
5. ❌ **Fill deduplication** - Use ReplacingMergeTree

### P1 (Should Have)
6. Funding flow separation table
7. Complete PnL calculation from positions + fills
8. Auto-detection of conditional token address
9. Proxy resolution fallback logic

### P2 (Nice to Have)
10. Current price feeds for unrealized PnL
11. Historical snapshots for trend analysis
12. Performance optimization for large wallets
13. API rate limit adaptation

---

## TECHNOLOGY STACK SUMMARY

| Component | Technology | Notes |
|-----------|-----------|-------|
| Data Warehouse | ClickHouse | High-performance OLAP, 388M+ rows |
| Blockchain RPC | Polygon Alchemy | eth_getLogs for event extraction |
| External APIs | Gamma, CLOB, Polymarket Strapi | Market data and fill history |
| ETL Scripts | TypeScript/Node.js | Modular processing pipeline |
| Frontend | React + TypeScript | Dashboard and strategy builder |
| State Management | Redux-style | Centralized strategy state |
| Graph Visualization | Dagre | Auto-layout for workflows |
| CLI Tools | Claude Code | Development and debugging |

---

## KEY LEARNINGS

1. **Blockchain Trade Patterns**: Different protocols have different settlement mechanisms
2. **Data Quality**: Garbage in → Garbage out. Must validate at each stage
3. **Distributed Processing**: Checkpoint-based recovery is essential for fault tolerance
4. **API Pagination**: Always implement full pagination, never assume result counts
5. **Financial Data**: Precision matters; use Decimal128, never floats
6. **On-chain Inference**: Can't always rely on blockchain data; need multiple sources
7. **Testing Philosophy**: Known wallet validation is most reliable for correctness

---

**Document Generated**: Analysis of 150+ conversation records across 12 major files
**Total Development Scope**: 7 major narratives spanning database, pipeline, strategy, UI, and blockchain layers
**Lines of Documentation**: 2,000+ across technical specs and implementation guides
**Status**: Core architecture complete, critical fixes in progress

