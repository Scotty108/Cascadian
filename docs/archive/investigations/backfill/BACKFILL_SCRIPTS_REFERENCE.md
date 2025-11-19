# CLOB Backfill Scripts - Quick Reference

**Last Updated**: 2025-11-07

## Script Inventory

### Active Backfill Scripts

#### 1. CLOB API Wallet Fills (Real-time)
**Path**: `/scripts/ingest-clob-fills.ts`
**Lines**: 313
**Purpose**: Fetch fills from CLOB API for active proxy wallets
**Data Source**: `https://clob.polymarket.com/api/v1/trades?trader={wallet}&limit={limit}`
**Execution**: Interactive - fetches top 10K proxy wallets, batches inserts (5K rows)
**Output**: `pm_trades` table
**Status**: Works but redundant - trades_raw already exists

**Key Code**:
```typescript
const CLOB_API = "https://clob.polymarket.com";
const url = `${CLOB_API}/api/v1/trades?trader=${wallet}&limit=${limit}`;
```

---

#### 2. Data API Historical Backfill (Paginated)
**Path**: `/scripts/ingest-clob-fills-backfill.ts`
**Lines**: 347
**Purpose**: Historical backfill with checkpoint resume capability
**Data Source**: `https://data-api.polymarket.com/trades`
**Execution**: Paginated backward pagination using `before=min(timestamp_ms)-1`
**Checkpoints**: `.clob_checkpoints/{wallet}.json` - stored locally
**Features**:
- Pagination loop protection (95% duplication detection)
- 100ms rate limiting
- Checkpoint saves after each page
- Deduplication by trade id

**Key Parameters**:
```typescript
const CLOB_API = "https://data-api.polymarket.com";
const params = {
  taker: proxy,
  limit: "1000",
  before: String(beforeMs)  // For pagination backwards
};
```

**Status**: Has checkpoints (6 wallets with <1K fills each) but incomplete

---

#### 3. Blockchain Event Streaming (Parallel 8-Worker)
**Path**: `/scripts/step3-streaming-backfill-parallel.ts`
**Lines**: 1000+
**Purpose**: Ingest blockchain events from Polygon RPC
**Data Source**: Polygon RPC (Alchemy by default)
**Handles**:
- ERC20 Transfer events (USDC)
- ERC1155 TransferSingle events
- ERC1155 TransferBatch events

**Configuration**:
```typescript
const TOTAL_DAYS = 1048;
const EARLIEST_TRADE_DATE = new Date('2022-12-18T10:45:22Z');
const LATEST_TRADE_DATE = new Date('2025-10-31T17:00:38Z');
const SHARDS = 8;  // Parallel workers
```

**Addresses Tracked**:
- CTF: `0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`
- USDC: `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`

**Status**: Functional, handles ERC1155 but not CLOB fills directly

---

#### 4. Goldsky GraphQL Historical Load
**Path**: `/scripts/goldsky-full-historical-load.ts`
**Lines**: 500+
**Purpose**: Load historical trades from Goldsky public subgraphs
**Data Source**: Goldsky public GraphQL endpoints (no auth required)
**Subgraphs**:
- activity-subgraph - Order fills
- positions-subgraph - User balances
- pnl-subgraph - PnL data
- orderbook-subgraph - Order book
- oi-subgraph - Open interest

**Endpoints**:
```typescript
const GOLDSKY_ENDPOINTS = {
  activity: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
  positions: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
};
```

**Features**:
- De-duplicates against existing trades_raw
- Shadow mode (--mode=shadow) for testing
- Checkpoint resume capability
- **Known Issue**: 128x shares inflation (SHARES_CORRECTION_FACTOR = 128)

**Status**: Functional for wallet discovery

---

### Helper/Validation Scripts

#### 5. Data Validation & Verification
**Path**: `/scripts/execute-complete-pipeline.ts`
**Purpose**: 7-phase pipeline orchestration with validation gates
**Phases**:
1. Proxy mapping validation (ERC1155 ApprovalForAll events)
2. ERC1155 flatten validation
3. Token ID mapping validation
4. Position flow validation
5. CLOB fills validation
6. USDC cashflow validation
7. Known wallet acceptance gates

**Target Wallets**:
- HolyMoses7: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 (expected 2,182 fills, actual: 8,484)
- niggemon: 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 (expected 1,087 fills, actual: 16,472)

---

#### 6. Market Candle Builder
**Path**: `/scripts/build-market-candles.ts`
**Purpose**: Build 5-minute OHLC candles from trades_raw
**Output**: `market_candles_5m` table (8.05M rows, 151.8k markets)
**Engine**: ReplacingMergeTree (no PARTITION BY due to date range)

---

#### 7. Market Mapping
**Path**: `/scripts/map-tokenid-to-market.ts`
**Purpose**: Build token_id → market_id + outcome label mappings
**Data Source**: Gamma API (`polymarket.com` markets)
**Output**: `pm_tokenid_market_map` table

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Sources                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Polymarket APIs          Blockchain        Goldsky APIs     │
│  ├─ data-api             ├─ ERC20           ├─ Activity      │
│  │  └─ /trades           │  └─ Transfers    ├─ Positions     │
│  ├─ clob.polymarket.com  └─ ERC1155         └─ PnL           │
│  └─ gamma-api               └─ Transfers                     │
│                                                              │
└───────────┬───────────────┬──────────────────┬──────────────┘
            │               │                  │
            v               v                  v
      ┌──────────────────────────────────────────────┐
      │  Ingest Scripts                              │
      ├──────────────────────────────────────────────┤
      │                                              │
      │ ingest-clob-fills.ts                        │
      │ ingest-clob-fills-backfill.ts               │
      │ step3-streaming-backfill-parallel.ts        │
      │ goldsky-full-historical-load.ts             │
      │                                              │
      └──────────┬──────────────────────────────────┘
                 │
                 v
      ┌──────────────────────────────────────────────┐
      │  ClickHouse Tables                           │
      ├──────────────────────────────────────────────┤
      │                                              │
      │ ✅ trades_raw (159.6M rows)                 │
      │    └─ SOURCE OF TRUTH (Nov 6, 2025)         │
      │                                              │
      │ pm_erc1155_flats (206k rows)                │
      │ pm_user_proxy_wallets                       │
      │ pm_tokenid_market_map                       │
      │ market_candles_5m (8.05M rows)              │
      │                                              │
      └──────────┬──────────────────────────────────┘
                 │
                 v
      ┌──────────────────────────────────────────────┐
      │  Analytics Views & API                       │
      ├──────────────────────────────────────────────┤
      │                                              │
      │ wallet_positions                            │
      │ market_last_price                           │
      │ unrealized_pnl                              │
      │                                              │
      └──────────────────────────────────────────────┘
```

---

## Checkpoint System

**Location**: `.clob_checkpoints/` directory

**Checkpoint File Format** (`.clob_checkpoints/{wallet}.json`):
```json
{
  "lastMinTimestampMs": 1762460127000,
  "pagesProcessed": 2,
  "totalNewFills": 1000,
  "lastPageSize": 500,
  "lastPageUniqueIdCount": 500
}
```

**Wallets with checkpoints**:
- 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e (1,000 fills)
- 0x4d97dcd97ec945f40cf65f87097ace5ea0476045 (1,000 fills)
- 0x56c79347e95530c01a2fc76e732f9566da16e113 (1,000 fills)
- 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 (1,000 fills)
- 0xd91e80cf2e7be2e162c6513ced06f1dd0da35296 (1,000 fills)
- 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 (1,000 fills)

**Inference**: Recent, incomplete backfill attempt. The 159.6M rows came from a different process.

---

## Database Configuration

**ClickHouse Connection** (from `.env.local`):
- Host: (e.g., `https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443`)
- User: `default`
- Password: (git-ignored)
- Database: `default`
- Request timeout: 300,000ms (5 minutes)

**Key Tables**:
```
trades_raw              159,574,259 rows  ✅ VERIFIED SOURCE OF TRUTH
pm_erc1155_flats       206,112 rows      ERC1155 token transfers
pm_user_proxy_wallets  ~500K rows        EOA → Proxy mappings
market_candles_5m      8,051,265 rows    OHLC price history
```

---

## Migration Files

**Schema Definitions**:
- `migrations/clickhouse/001_create_trades_table.sql` - Initial trades_raw
- `migrations/clickhouse/003_add_condition_id.sql` - Added condition_id field
- `migrations/clickhouse/016_enhance_polymarket_tables.sql` - Enhanced schema

---

## Known Issues & Workarounds

| Issue | Root Cause | Script | Workaround |
|-------|-----------|--------|-----------|
| CLOB API auth | Requires L2 header for full market history | ingest-clob-fills.ts | Use wallet-scoped /trades endpoint |
| Goldsky inflation | Shares 128x too high in some queries | goldsky-full-historical-load.ts | SHARES_CORRECTION_FACTOR = 128 |
| Subgraph deprecated | Graph endpoints 404 | All backfill scripts | Not needed - trades_raw complete |
| Missing condition_id | Earlier data loads had nulls | trades_raw | Already fixed as of Nov 6 |

---

## Runtime Execution

**Quick Start**:
```bash
# Set credentials
export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="..."
export CLICKHOUSE_DATABASE="default"

# Run complete pipeline
npx tsx scripts/execute-complete-pipeline.ts

# Or individual steps
npx tsx scripts/ingest-clob-fills-backfill.ts
npx tsx scripts/build-market-candles.ts
```

**Expected Runtime**:
- ingest-clob-fills.ts: 10-30 minutes (proxy wallet count dependent)
- step3-streaming-backfill-parallel.ts: 2-5 hours (8-worker parallel)
- build-market-candles.ts: 15-30 minutes (8.05M rows)
- goldsky-full-historical-load.ts: 6-12 hours (full history)

---

## Conclusion

The 159.6M trades in `trades_raw` cannot be recreated from current backfill scripts. The data source is unknown but the data is complete, verified, and marked as source of truth (Nov 6, 2025).

**For missing_condition_id issue**: No backfill needed - condition_id already populated across all 159.6M rows. Focus on formula debugging instead.
