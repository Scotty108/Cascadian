# Data Pipeline Architecture: Goldsky to ClickHouse to Signals

**Version:** 1.0
**Last Updated:** 2025-10-24
**Status:** Design Phase

---

## Overview

This document describes the complete data pipeline for ingesting Polymarket trade history, calculating wallet smart scores, and generating market signals (SII).

### Pipeline Stages

```
Blockchain (Polygon)
  → Goldsky Indexer
  → ETL Workers
  → ClickHouse (Analytics DB)
  → Calculation Jobs
  → Postgres (Current State)
  → Redis (Cache)
  → API
  → Frontend
```

---

## Data Sources

### 1. Goldsky Subgraphs (Primary Historical Data)

Goldsky hosts **5 public subgraphs** for Polymarket data:

| Subgraph | Endpoint | Data Available |
|----------|----------|----------------|
| **Activity** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn` | Trade history (all time) |
| **Positions** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn` | Current wallet positions per market |
| **PNL** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn` | Profit/loss per wallet |
| **Orders** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn` | Order book data |
| **Open Interest** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/oi-subgraph/0.0.6/gn` | Market open interest |

**Key Features:**
- ✅ **Public & Free** - No auth required
- ✅ **Historical Data** - From blockchain genesis
- ✅ **Real-time** - Updates as blocks are mined
- ✅ **GraphQL** - Flexible querying
- ✅ **Hosted by Goldsky** - Reliable infrastructure

### 2. Polymarket CLOB API (Current Positions)

**Base URL:** `https://clob.polymarket.com`

**Endpoints Used:**
```
GET /markets                    # List all markets
GET /markets/{id}               # Market details
GET /markets/{id}/positions     # Current positions (if available)
GET /prices-history             # Historical prices
```

**Rate Limits:**
- Free tier: 100 req/min
- Premium: Higher limits, WebSocket access

**Use Cases:**
- Current market data (prices, volume, liquidity)
- Supplement Goldsky data
- Real-time position updates

---

## ETL Pipeline

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                Orchestrator                          │
│  (Cron job: runs hourly)                             │
│                                                       │
│  1. Identify active markets                          │
│  2. Get top N positions per market                   │
│  3. Extract unique wallet addresses                  │
│  4. Trigger wallet sync jobs (queue)                 │
│  5. Monitor progress                                 │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│           Worker Pool (10 workers)                   │
│  Each worker:                                        │
│  1. Pop wallet from queue                            │
│  2. Fetch trade history from Goldsky                 │
│  3. Transform to internal schema                     │
│  4. Insert to ClickHouse                             │
│  5. Emit success/failure event                       │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│              ClickHouse Database                     │
│  trades_raw table: Stores all trades                 │
│  wallet_metrics_daily: Materialized view             │
└─────────────────────────────────────────────────────┘
```

### Worker Implementation

```typescript
// lib/etl/wallet-sync-worker.ts

interface WalletSyncJob {
  wallet_address: string
  market_id?: string
  sync_type: 'full' | 'incremental'
}

export async function syncWalletTrades(job: WalletSyncJob) {
  const logger = getLogger('wallet-sync')

  try {
    // Step 1: Determine sync range
    const lastSync = await getLastSyncTimestamp(job.wallet_address)
    const sinceTimestamp = job.sync_type === 'full' ? 0 : lastSync

    // Step 2: Query Goldsky Activity subgraph
    const trades = await fetchWalletTradesFromGoldsky({
      wallet: job.wallet_address,
      since: sinceTimestamp,
      limit: 1000  // Paginate if needed
    })

    if (trades.length === 0) {
      logger.info(`No new trades for ${job.wallet_address}`)
      return { success: true, trades: 0 }
    }

    // Step 3: Transform to internal schema
    const transformedTrades = trades.map(transformGoldskyTrade)

    // Step 4: Batch insert to ClickHouse
    await clickhouse.insert({
      table: 'trades_raw',
      values: transformedTrades,
      format: 'JSONEachRow'
    })

    logger.info(`Synced ${trades.length} trades for ${job.wallet_address}`)

    // Step 5: Update sync metadata
    await updateSyncMetadata(job.wallet_address, {
      last_sync_at: new Date(),
      trades_synced: trades.length
    })

    return { success: true, trades: trades.length }

  } catch (error) {
    logger.error(`Failed to sync ${job.wallet_address}:`, error)

    // Retry logic
    if (isRetryable(error)) {
      throw error  // Will be retried by queue
    }

    return { success: false, error: error.message }
  }
}
```

### Goldsky GraphQL Queries

#### Fetch Wallet Trade History

```graphql
query GetWalletTrades($wallet: String!, $since: Int!, $limit: Int!) {
  trades(
    where: {
      user: $wallet,
      timestamp_gte: $since
    }
    first: $limit
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    user
    market
    side
    shares
    price
    timestamp
    value
    transactionHash
  }
}
```

**Response Example:**
```json
{
  "data": {
    "trades": [
      {
        "id": "0x123...-0",
        "user": "0xabc...",
        "market": "0xdef...",
        "side": "YES",
        "shares": "1000.5",
        "price": "0.65",
        "timestamp": "1698345600",
        "value": "650.32",
        "transactionHash": "0x789..."
      }
    ]
  }
}
```

#### Fetch Market Positions (Top N)

```graphql
query GetMarketPositions($market: String!, $limit: Int!) {
  positions(
    where: { market: $market }
    first: $limit
    orderBy: value
    orderDirection: desc
  ) {
    id
    user
    market
    side
    shares
    avgPrice
    value
    unrealizedPnl
  }
}
```

**Use Case**: Identify top N wallets per market for SII calculation

### Data Transformation

```typescript
// lib/etl/transformers.ts

interface GoldskyTrade {
  id: string
  user: string
  market: string
  side: 'YES' | 'NO'
  shares: string  // BigNumber as string
  price: string   // Decimal as string
  timestamp: string  // Unix timestamp as string
  value: string
  transactionHash: string
}

interface ClickHouseTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  timestamp: Date
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
  exit_price?: number
  pnl?: number
  created_at: Date
}

export function transformGoldskyTrade(raw: GoldskyTrade): ClickHouseTrade {
  return {
    trade_id: raw.id,
    wallet_address: raw.user.toLowerCase(),
    market_id: raw.market.toLowerCase(),
    timestamp: new Date(parseInt(raw.timestamp) * 1000),
    side: raw.side,
    entry_price: parseFloat(raw.price),
    shares: parseFloat(raw.shares),
    usd_value: parseFloat(raw.value),
    transaction_hash: raw.transactionHash.toLowerCase(),
    is_closed: false,  // Will be updated when we detect exit
    exit_price: null,
    pnl: null,
    created_at: new Date()
  }
}
```

---

## ClickHouse Schema

### Table: trades_raw

```sql
CREATE TABLE trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192;
```

**Partitioning Strategy:**
- Partition by month (`YYYYMM`)
- Allows efficient deletion of old data
- Optimizes queries with time ranges

**Ordering Key:**
- `(wallet_address, timestamp)`
- Optimizes queries like "get all trades for wallet X in date range Y"

**Expected Size:**
- 20,000 wallets × 20 trades/day × 365 days = 146M rows/year
- ~2-3 KB per row uncompressed
- ~300-500 GB uncompressed/year
- ClickHouse compression ratio: ~10x
- **Actual size: 30-50 GB/year**

### Materialized View: wallet_metrics_daily

Pre-aggregate metrics daily for fast queries:

```sql
CREATE MATERIALIZED VIEW wallet_metrics_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, date)
AS SELECT
  wallet_address,
  toDate(timestamp) AS date,

  -- Trade counts
  count() AS total_trades,
  countIf(is_closed = true AND pnl > 0) AS wins,
  countIf(is_closed = true AND pnl <= 0) AS losses,

  -- PnL metrics
  sumIf(pnl, is_closed = true) AS total_pnl,
  avgIf(pnl, is_closed = true AND pnl > 0) AS avg_win,
  avgIf(pnl, is_closed = true AND pnl <= 0) AS avg_loss,
  stddevPopIf(pnl, is_closed = true) AS pnl_stddev,

  -- Volume
  sum(usd_value) AS total_volume,

  -- Time-based
  min(timestamp) AS first_trade_time,
  max(timestamp) AS last_trade_time

FROM trades_raw
GROUP BY wallet_address, toDate(timestamp);
```

**Benefits:**
- Calculate omega ratio, sharpe ratio from daily aggregates (not raw trades)
- 100x faster queries
- Auto-updates as new trades inserted

---

## Calculation Jobs

### Job 1: Calculate Wallet Smart Scores (Hourly)

```typescript
// lib/jobs/calculate-wallet-scores.ts

export async function calculateWalletScoresJob() {
  const logger = getLogger('calc-scores')

  try {
    // Step 1: Get list of active wallets (top N per market)
    const activeWallets = await getActiveWallets()
    logger.info(`Calculating scores for ${activeWallets.length} wallets`)

    // Step 2: Process in batches of 100
    for (const batch of chunk(activeWallets, 100)) {
      await Promise.all(
        batch.map(wallet => calculateWalletScore(wallet))
      )
    }

    logger.info('Wallet score calculation complete')

  } catch (error) {
    logger.error('Wallet score calculation failed:', error)
    throw error
  }
}

async function calculateWalletScore(wallet: string) {
  // Step 1: Query ClickHouse for rolling metrics
  const metrics = await clickhouse.query(`
    SELECT
      wallet_address,

      -- 30-day window
      sumIf(total_pnl, date >= today() - 30) AS pnl_30d,
      sumIf(wins, date >= today() - 30) AS wins_30d,
      sumIf(losses, date >= today() - 30) AS losses_30d,
      avgIf(pnl_stddev, date >= today() - 30) AS stddev_30d,

      -- 60-day window
      sumIf(total_pnl, date >= today() - 60 AND date < today() - 30) AS pnl_60d,

      -- All time
      sum(total_trades) AS total_trades,
      sum(total_volume) AS total_volume

    FROM wallet_metrics_daily
    WHERE wallet_address = '${wallet}'
    GROUP BY wallet_address
  `)

  if (!metrics.rows || metrics.rows.length === 0) {
    return null  // No data
  }

  const row = metrics.rows[0]

  // Step 2: Calculate component scores
  const omega_30d = calculateOmegaRatio(row.wins_30d, row.losses_30d, row.pnl_30d)
  const omega_60d = calculateOmegaRatio(row.wins_60d, row.losses_60d, row.pnl_60d)
  const omega_momentum = (omega_30d - omega_60d) / omega_60d

  const sharpe_30d = row.pnl_30d / (row.stddev_30d || 1)
  const win_rate = row.wins_30d / (row.wins_30d + row.losses_30d)

  // Step 3: Apply formula (configurable)
  const formula = getActiveFormula('smart_score_v1')
  const smart_score = applyFormula(formula, {
    omega_ratio_30d,
    omega_momentum,
    sharpe_ratio_30d,
    win_rate,
    total_trades: row.total_trades
  })

  const grade = scoreToGrade(smart_score)

  // Step 4: Upsert to Postgres
  await supabase.from('wallet_scores').upsert({
    wallet_address: wallet,
    smart_score,
    grade,
    omega_ratio_30d,
    omega_momentum,
    sharpe_ratio_30d,
    win_rate,
    total_trades: row.total_trades,
    last_calculated_at: new Date()
  })

  // Step 5: Cache in Redis (1 hour TTL)
  await redis.setex(
    `wallet:score:${wallet}`,
    3600,
    JSON.stringify({ smart_score, grade, updated_at: new Date() })
  )

  return { wallet, smart_score, grade }
}
```

### Job 2: Calculate Market SII (Hourly)

```typescript
// lib/jobs/calculate-market-sii.ts

export async function calculateMarketSIIJob() {
  const logger = getLogger('calc-sii')

  try {
    // Step 1: Get all active markets
    const activeMarkets = await supabase
      .from('markets')
      .select('market_id')
      .eq('active', true)
      .eq('closed', false)

    logger.info(`Calculating SII for ${activeMarkets.data.length} markets`)

    // Step 2: Process in batches
    for (const batch of chunk(activeMarkets.data, 50)) {
      await Promise.all(
        batch.map(market => calculateMarketSII(market.market_id))
      )
    }

    logger.info('Market SII calculation complete')

  } catch (error) {
    logger.error('Market SII calculation failed:', error)
    throw error
  }
}

async function calculateMarketSII(
  marketId: string,
  topN: number = 20
) {
  // Step 1: Get top N positions on each side
  const yesPositions = await getTopPositions(marketId, 'YES', topN)
  const noPositions = await getTopPositions(marketId, 'NO', topN)

  if (yesPositions.length === 0 || noPositions.length === 0) {
    return null  // Not enough data
  }

  // Step 2: Fetch wallet scores (from Redis cache first, then Postgres)
  const yesScores = await fetchWalletScores(
    yesPositions.map(p => p.wallet_address)
  )
  const noScores = await fetchWalletScores(
    noPositions.map(p => p.wallet_address)
  )

  // Step 3: Calculate weighted averages
  const yesAvg = liquidityWeightedAverage(
    yesScores,
    yesPositions.map(p => p.usd_value)
  )
  const noAvg = liquidityWeightedAverage(
    noScores,
    noPositions.map(p => p.usd_value)
  )

  // Step 4: Calculate SII metrics
  const siiSignal = yesAvg - noAvg  // -100 to +100

  const yesLiquidity = sum(yesPositions.map(p => p.usd_value))
  const noLiquidity = sum(noPositions.map(p => p.usd_value))
  const totalLiquidity = yesLiquidity + noLiquidity

  const siiConfidence = (
    (yesLiquidity + noLiquidity) / totalLiquidity
  ) * 100

  // Step 5: Upsert to Postgres
  await supabase.from('market_sii').upsert({
    market_id: marketId,
    sii_signal: siiSignal,
    sii_confidence: siiConfidence,
    yes_avg_score: yesAvg,
    yes_total_liquidity: yesLiquidity,
    no_avg_score: noAvg,
    no_total_liquidity: noLiquidity,
    top_n_used: topN,
    calculated_at: new Date()
  })

  return { marketId, siiSignal, siiConfidence }
}
```

---

## Cron Schedule

```typescript
// lib/cron/index.ts

export const cronJobs = [
  {
    name: 'sync-wallet-trades',
    schedule: '0 * * * *',  // Every hour
    handler: syncWalletTradesJob
  },
  {
    name: 'calculate-wallet-scores',
    schedule: '15 * * * *',  // 15 min past every hour
    handler: calculateWalletScoresJob
  },
  {
    name: 'calculate-market-sii',
    schedule: '30 * * * *',  // 30 min past every hour
    handler: calculateMarketSIIJob
  },
  {
    name: 'cleanup-old-trades',
    schedule: '0 2 * * *',  // 2 AM daily
    handler: cleanupOldTradesJob  // Delete trades >2 years old
  }
]
```

**Sequence:**
```
00:00 - Sync new trades from Goldsky
00:15 - Calculate wallet scores (uses new trades)
00:30 - Calculate market SII (uses new scores)
00:45 - (idle)
01:00 - Repeat
```

---

## Error Handling & Retry

### Retry Strategy

```typescript
// lib/utils/retry.ts

interface RetryConfig {
  maxAttempts: number
  baseDelay: number  // ms
  maxDelay: number   // ms
  backoffMultiplier: number
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {
    maxAttempts: 4,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  }
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === config.maxAttempts) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      )

      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`, error)
      await sleep(delay)
    }
  }

  throw lastError
}
```

### Circuit Breaker

```typescript
// lib/utils/circuit-breaker.ts

class CircuitBreaker {
  private failures = 0
  private lastFailureTime?: Date
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000  // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime.getTime() > this.timeout) {
        this.state = 'half-open'
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await fn()

      if (this.state === 'half-open') {
        this.reset()
      }

      return result

    } catch (error) {
      this.failures++
      this.lastFailureTime = new Date()

      if (this.failures >= this.threshold) {
        this.state = 'open'
        console.error('Circuit breaker opened after', this.failures, 'failures')
      }

      throw error
    }
  }

  reset() {
    this.failures = 0
    this.state = 'closed'
    this.lastFailureTime = undefined
  }
}

export const goldskyCircuitBreaker = new CircuitBreaker(5, 60000)
```

### Dead Letter Queue

```typescript
// lib/queue/dlq.ts

interface FailedJob {
  job: WalletSyncJob
  error: string
  attempts: number
  failed_at: Date
}

export async function sendToDeadLetterQueue(job: WalletSyncJob, error: Error) {
  await supabase.from('failed_jobs').insert({
    job_type: 'wallet_sync',
    job_data: job,
    error_message: error.message,
    error_stack: error.stack,
    failed_at: new Date()
  })
}

// Manual retry from DLQ
export async function retryFailedJobs(limit: number = 100) {
  const { data: failedJobs } = await supabase
    .from('failed_jobs')
    .select('*')
    .eq('job_type', 'wallet_sync')
    .limit(limit)

  for (const job of failedJobs) {
    try {
      await syncWalletTrades(job.job_data)

      // Success - delete from DLQ
      await supabase
        .from('failed_jobs')
        .delete()
        .eq('id', job.id)

    } catch (error) {
      console.error(`Failed to retry job ${job.id}:`, error)
    }
  }
}
```

---

## Monitoring & Observability

### Metrics to Track

```typescript
// lib/metrics/index.ts

export const metrics = {
  // ETL metrics
  trades_synced_total: new Counter('trades_synced_total'),
  trades_sync_errors: new Counter('trades_sync_errors'),
  trades_sync_duration: new Histogram('trades_sync_duration_ms'),

  // Calculation metrics
  scores_calculated_total: new Counter('scores_calculated_total'),
  scores_calc_errors: new Counter('scores_calc_errors'),
  scores_calc_duration: new Histogram('scores_calc_duration_ms'),

  // Data quality
  wallets_with_insufficient_data: new Gauge('wallets_with_insufficient_data'),
  avg_trades_per_wallet: new Gauge('avg_trades_per_wallet'),

  // Infrastructure
  clickhouse_query_duration: new Histogram('clickhouse_query_duration_ms'),
  redis_cache_hit_rate: new Gauge('redis_cache_hit_rate'),
  postgres_connection_pool_usage: new Gauge('postgres_connection_pool_usage')
}
```

### Logging

```typescript
// lib/logging/logger.ts

import pino from 'pino'

export function getLogger(component: string) {
  return pino({
    name: component,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => {
        return { level: label }
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  })
}
```

**Log Levels:**
- `error`: Job failures, API errors
- `warn`: Retries, circuit breaker trips
- `info`: Job starts/completions, high-level flow
- `debug`: Detailed query info, data transformations

---

## Cost Estimation

### ClickHouse Cloud

**Tier:** Standard (Shared)

**Usage:**
- 50 GB storage (compressed)
- 1M queries/month
- 100k inserts/day

**Cost:** ~$200-300/month

### Redis (Upstash)

**Usage:**
- 500 MB storage
- 10M commands/month

**Cost:** ~$20/month

### Compute (ETL Workers)

**Platform:** Vercel Edge Functions or AWS Lambda

**Usage:**
- 100 hours/month runtime
- 2 GB memory per worker

**Cost:** ~$50-100/month

**Total Infrastructure Cost:** ~$300-450/month

---

## Performance Benchmarks

### Expected Performance

| Operation | P50 | P95 | P99 |
|-----------|-----|-----|-----|
| Sync 1 wallet (100 trades) | 500ms | 1.5s | 3s |
| Calculate 1 wallet score | 50ms | 150ms | 300ms |
| Calculate 1 market SII | 100ms | 300ms | 600ms |
| Fetch wallet score (Redis) | 5ms | 10ms | 20ms |
| ClickHouse rolling query | 20ms | 80ms | 200ms |

### Scalability

**Current capacity:**
- 5,000 wallets
- 100 trades/wallet/month
- = 500,000 trades/month
- = 6M trades/year

**Can scale to:**
- 50,000 wallets
- 100 trades/wallet/month
- = 5M trades/month
- = 60M trades/year

**Bottlenecks:**
- Goldsky API rate limits (mitigated by caching)
- ClickHouse write throughput (can handle 100k+ inserts/sec)
- Worker concurrency (scale horizontally)

---

## Implementation Checklist

### Phase 1: Infrastructure Setup
- [ ] Provision ClickHouse Cloud instance
- [ ] Create database schema (trades_raw, materialized views)
- [ ] Set up Redis (Upstash)
- [ ] Configure environment variables

### Phase 2: ETL Pipeline
- [ ] Implement Goldsky GraphQL client
- [ ] Build data transformers
- [ ] Create wallet sync worker
- [ ] Implement retry logic & circuit breaker
- [ ] Set up worker queue (BullMQ or similar)

### Phase 3: Calculation Jobs
- [ ] Implement metric calculation functions (Omega, Sharpe)
- [ ] Build wallet score calculation job
- [ ] Build market SII calculation job
- [ ] Set up cron scheduler

### Phase 4: Monitoring
- [ ] Set up logging (Pino)
- [ ] Implement metrics (Prometheus or similar)
- [ ] Create monitoring dashboard
- [ ] Set up alerts (errors, latency, data quality)

### Phase 5: Testing
- [ ] Unit tests for transformers
- [ ] Integration tests for Goldsky queries
- [ ] Load tests (1000+ wallets)
- [ ] End-to-end tests

---

## References

- [Goldsky Documentation](https://docs.goldsky.com)
- [ClickHouse Documentation](https://clickhouse.com/docs)
- [Polymarket Subgraphs (GitHub)](https://github.com/Polymarket/polymarket-subgraph)
- [GraphQL Best Practices](https://graphql.org/learn/best-practices/)

---

**Status:** Design Complete - Ready for Implementation
**Next Steps:** Begin Phase 1 infrastructure setup
