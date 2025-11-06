# Cascadian App - System Architecture Overview

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CASCADIAN TRADING PLATFORM                          │
└─────────────────────────────────────────────────────────────────────────────┘

                                   USER INTERFACE
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
            ┌───────▼────────┐  ┌──────▼──────┐  ┌──────▼──────┐
            │  Strategy      │  │  Dashboard  │  │  Watchlist  │
            │  Builder       │  │  & Metrics  │  │  & Alerts   │
            │  (18 Groups)   │  │  (Real-time)│  │  (Live)     │
            └────────┬────────┘  └──────┬──────┘  └──────┬──────┘
                     │                  │                │
                     └──────────────────┼────────────────┘
                                        │
                     ┌──────────────────▼──────────────────┐
                     │    STRATEGY EXECUTION ENGINE        │
                     │  ┌─────────────────────────────┐    │
                     │  │ Cron Orchestrator           │    │
                     │  │ + Risk Analysis             │    │
                     │  │ + Approval Workflow         │    │
                     │  └─────────────────────────────┘    │
                     └──────────────────┬──────────────────┘
                                        │
                     ┌──────────────────▼──────────────────┐
                     │    DATA & ANALYTICS LAYER           │
                     └─────────┬──────────────┬────────────┘
                               │              │
                ┌──────────────▼─┐   ┌────────▼────────────┐
                │  ClickHouse    │   │  Smart Money       │
                │  Data Warehouse│   │  Wallet Ranking    │
                │  (388M rows)   │   │  System            │
                └────────┬───────┘   └────────┬───────────┘
                         │                    │
        ┌────────────────┼────────────────────┼──────────────┐
        │                │                    │              │
    ┌───▼──┐        ┌────▼────┐      ┌───────▼──────┐  ┌────▼────┐
    │ ERC20│        │ ERC1155 │      │ PM_Trades    │  │ PM_Proxy│
    │Trans │        │ Transfers│      │ (CLOB fills) │  │ Wallets │
    │388M  │        │  50M    │      │  10M rows    │  │ 100K    │
    └───┬──┘        └────┬────┘      └───────┬──────┘  └────┬────┘
        │                │                    │             │
        └────────────────┴────────────────────┴─────────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │    DATA INGESTION & ORCHESTRATION      │
        │  ┌─────────────────────────────────┐   │
        │  │ 8 Parallel Workers              │   │
        │  │ Day-based Sharding (day % 8)    │   │
        │  │ Checkpoint Recovery             │   │
        │  │ Auto-restart Monitor            │   │
        │  │ Quality Gates (60/80%)          │   │
        │  └─────────────────────────────────┘   │
        └────────────────┬───────────────────────┘
                         │
        ┌────────────────▼──────────────────┐
        │   BLOCKCHAIN DATA SOURCES         │
        │  ┌───────────────────────────┐   │
        │  │ Polygon RPC (Alchemy)     │   │
        │  │ - eth_getLogs             │   │
        │  │ - Event extraction        │   │
        │  │ - 3-retry with backoff    │   │
        │  └───────────────────────────┘   │
        └────────────────┬──────────────────┘
                         │
        ┌────────────────▼──────────────────┐
        │   EXTERNAL APIs                   │
        │  ┌─────────────────────────────┐  │
        │  │ Gamma API (Markets)         │  │
        │  │ CLOB API (Fills/Trades)     │  │
        │  │ Polymarket Strapi (Profiles)│  │
        │  └─────────────────────────────┘  │
        └──────────────────────────────────┘
```

---

## Data Flow: End-to-End

```
BLOCKCHAIN DATA
     │
     ├─────────────────────────────────────────┐
     │                                         │
     ▼                                         ▼
ApprovalForAll                        ERC1155 Transfers
(Wallet Mapping)                      (Position Changes)
     │                                         │
     ▼                                         ▼
build-approval-proxies.ts           flatten-erc1155.ts
     │                                         │
     ▼                                         ▼
pm_user_proxy_wallets                pm_erc1155_flats
(EOA → Proxy)                        (Decoded Transfers)
     │                                         │
     └─────────────────┬───────────────────────┘
                       │
                       ▼
             map-tokenid-to-market.ts
                       │
             ┌─────────▼──────────┐
             │ Gamma API          │
             │ CLOB Markets API   │
             └─────────┬──────────┘
                       │
                       ▼
             pm_tokenid_market_map
             (Token ID → Market Mapping)
                       │
                       ├─────────────────────────────┐
                       │                             │
                       ▼                             ▼
          build-positions-from-erc1155.ts   ingest-clob-fills.ts
                       │                             │
                       ▼                             ▼
          pm_wallet_positions                pm_trades
          (Aggregated Positions)             (CLOB Fills)
                       │                             │
                       └─────────────┬───────────────┘
                                     │
                                     ▼
                         validate-three.ts
                                     │
                                     ▼
                         Known Wallet Validation
                    (HolyMoses7, niggemon, Wallet3)
                                     │
                                     ▼
                         PnL Metrics & Ranking
```

---

## Module Dependencies

```
PRESENTATION LAYER
├── Dashboard
│   ├── Strategy Monitoring
│   ├── PnL Charts
│   └── Wallet Rankings
├── Strategy Builder
│   ├── Node Graph Editor
│   ├── Filter UI
│   └── Operator Library
└── Notifications
    └── Alert System

APPLICATION LAYER
├── Strategy Execution
│   ├── Cron Orchestrator
│   ├── Risk Engine
│   └── Approval Gates
├── Wallet Ranking
│   ├── Performance Metrics
│   ├── Scoring Algorithm
│   └── Update Cache
└── Query API
    ├── Position Aggregation
    ├── PnL Calculation
    └── Real-time Updates

DATA LAYER
├── ClickHouse
│   ├── erc20_transfers
│   ├── erc1155_transfers
│   ├── pm_*_tables
│   └── strategy_*_tables
├── Caching Layer
│   ├── Wallet Rankings
│   └── Market Metadata
└── Snapshot Storage
    └── Backup/Recovery

INGESTION LAYER
├── Event Extraction
│   ├── ERC20/ERC1155 Decoders
│   └── Approval Extractors
├── API Integration
│   ├── Gamma Client
│   ├── CLOB Client
│   └── Polymarket Client
└── Pipeline Orchestration
    ├── Worker Pool
    ├── Checkpoint Manager
    └── Quality Gates
```

---

## Critical Data Flows

### 1. Polymarket Trade Capture
```
User makes a trade on Polymarket
        │
        ▼
User's proxy executes ERC1155 swap
        │
        ├─ Conditional token transfers (ERC1155 events)
        └─ USDC deposit/withdrawal if needed
        │
        ▼
Workers extract via eth_getLogs
        │
        ├─ ApprovalForAll → pm_user_proxy_wallets
        ├─ ERC1155 → pm_erc1155_flats
        └─ CLOB API → pm_trades (fills with prices)
        │
        ▼
Aggregated in pm_wallet_positions
        │
        ├─ Net position = bought - sold
        ├─ Realized PnL = (sell_price - avg_buy_price) × shares_sold
        └─ Fees = sum of execution fees
        │
        ▼
Validated against Polymarket profile
        │
        ▼
Ranked in smart money leaderboard
        │
        ▼
Copy-trading strategies triggered
```

### 2. Strategy Execution
```
User creates copy-trading strategy
        │
        ├─ Define wallets to track (smart money list)
        ├─ Set copy ratio (0-100%)
        ├─ Set approval gates
        └─ Schedule (immediate or cron)
        │
        ▼
Stored in strategy_* tables
        │
        ▼
Cron job runs at scheduled time
        │
        ├─ Query pm_trades for new fills from tracked wallets
        ├─ Adjust sizes by copy ratio
        ├─ Check approval requirements
        └─ Run risk analysis
        │
        ▼
If risk acceptable + approved
        │
        ├─ Build trade transaction
        ├─ Submit to network
        ├─ Log in strategy_execution_log
        └─ Update user positions
        │
        ▼
Dashboard shows execution + PnL
```

---

## Deployment Architecture

```
LOCAL/DEV
├── TypeScript Scripts (Node.js 18+)
│   ├── scripts/*.ts (Ingestion & Processing)
│   └── lib/*.ts (Core Libraries)
├── ClickHouse (Local Docker or Remote)
│   └── Connection: CLICKHOUSE_URL env var
└── External APIs
    ├── Polygon RPC (Alchemy)
    ├── Gamma API
    └── CLOB API

PRODUCTION
├── Worker Nodes (8× parallel)
│   ├── scripts/launch-workers.sh
│   ├── Checkpoint persistence
│   └── Logs: data/backfill/worker-*.log
├── Monitor Node
│   ├── scripts/parallel-backfill-monitor.ts
│   ├── Health checks every 30s
│   └── Log: data/backfill/monitor.log
├── Quality Gates
│   ├── Run every 30 min
│   └── Confidence thresholds: 60%/80%
├── ClickHouse Cluster
│   ├── Replicated tables
│   ├── Distributed queries
│   └── Backups enabled
└── Frontend Deployment
    ├── Next.js/React (Vercel?)
    └── Connected to ClickHouse

MONITORING & OBSERVABILITY
├── Worker Heartbeats
│   └── worker_heartbeats table
├── Structured Logs
│   ├── worker-*.log (per-worker)
│   ├── monitor.log (progress)
│   ├── gates.log (validation)
│   └── on-complete.log (rebuild)
├── Metrics
│   ├── Rows processed
│   ├── Errors & retries
│   ├── Query performance
│   └── API rate limits
└── Alerting
    └── Stall detection (5 min threshold)
```

---

## Table Schema Summary

### Source Tables
| Table | Rows | Purpose |
|-------|------|---------|
| erc20_transfers | 388M | USDC funding flows |
| erc1155_transfers | 50M | Conditional token transfers |

### Polymarket Tables
| Table | Rows | Purpose |
|-------|------|---------|
| pm_user_proxy_wallets | 100K | EOA → Proxy mapping (ReplacingMergeTree) |
| pm_erc1155_flats | 50M | Flattened transfers (MergeTree, monthly partition) |
| pm_tokenid_market_map | 20K | Token ID → Market mapping (ReplacingMergeTree) |
| pm_trades | 10M | CLOB fills with execution prices (MergeTree) |
| pm_wallet_positions | 1M | Computed positions & PnL (ReplacingMergeTree) |
| pm_wallet_funding | 100K | USDC deposit/withdrawal flows (ReplacingMergeTree) |

### Strategy Tables
| Table | Purpose |
|-------|---------|
| strategies | Strategy configurations (archivable) |
| strategy_execution_log | Execution history |
| strategy_performance | PnL per strategy |
| watchlist_* | Custom user watchlists |

---

## Performance Characteristics

### Query Performance Targets
| Query | Expected Time | Notes |
|-------|---------------|-------|
| Proxy lookup by EOA | <10ms | Indexed on proxy_wallet |
| Trade count for wallet | <100ms | Partitioned by ts |
| Position aggregation | <500ms | Join 3 tables |
| Full validation (3 wallets) | ~30s | Sequential validation |
| Strategy execution | <5s | Real-time execution |

### Data Processing Performance
| Operation | Speed | Scale |
|-----------|-------|-------|
| Full backfill | 2-5 hours | 1,048 days, 8 workers |
| Daily update | ~30 min | ~128 days worth of data |
| Worker throughput | ~131 days/worker | Day-based sharding |
| RPC calls/sec | ~10-50 (rate limited) | Depends on RPC provider |

---

## Error Handling & Recovery

```
WORKER FAILURE
        │
        ├─ RPC timeout
        │  └─ 3-attempt retry with backoff
        │     └─ Skip day if all fail (log & continue)
        │
        ├─ ClickHouse insert error
        │  └─ Log error, continue to next batch
        │
        └─ Stall (no progress for 5 min)
           └─ Monitor kills & relaunches worker
              └─ Resumes from checkpoint

MONITOR FAILURE
        │
        └─ Critical: Must manually restart
           └─ Restart script: scripts/launch-workers.sh

QUALITY GATE FAILURE
        │
        ├─ < 60% confidence during backfill
        │  └─ Log warning, continue
        │
        └─ < 80% confidence after backfill
           └─ BLOCKING: Must investigate
              └─ May indicate data quality issue
```

---

## Key Architecture Decisions

### 1. Why ClickHouse?
- Column-oriented OLAP database
- Handles 388M+ USDC transfers efficiently
- ReplacingMergeTree for deduplication
- Partition pruning for historical queries
- No UPDATE operations (design for idempotency instead)

### 2. Why 8 Parallel Workers?
- Day-based sharding (day_idx % 8)
- 1,048 days ÷ 8 workers = 131 days each
- 2-5 hour total backfill time
- Checkpoint-based recovery
- Proven pattern for distributed ETL

### 3. Why ERC1155 not ERC20?
- Polymarket trades via conditional token swaps
- USDC transfers are only deposits/withdrawals
- ERC1155 events represent actual positions
- CLOB API provides execution prices

### 4. Why Known Wallet Validation?
- Real data is ground truth
- Polymarket profiles are publicly verified
- More reliable than synthetic tests
- Catches data quality issues early

### 5. Why Decimal128 for Money?
- Prevents floating-point precision loss
- Standard for financial calculations
- ClickHouse native support
- No rounding errors

---

**Architecture Version**: 1.0
**Last Updated**: 2025-11-06
**Status**: Core complete, critical fixes in progress

