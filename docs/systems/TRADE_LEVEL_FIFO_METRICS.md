# Trade-Level FIFO Metrics for Copy Trading

> **Purpose:** Build accurate per-trade (tx_hash) ROI metrics using FIFO matching for equal-weight copy trading evaluation.
>
> **Status:** Planned, not yet implemented
> **Last Updated:** January 2026

---

## Table of Contents

1. [Goal & Business Context](#goal--business-context)
2. [Key Concepts](#key-concepts)
3. [Data Model](#data-model)
4. [Why Simpler Approaches Don't Work](#why-simpler-approaches-dont-work)
5. [Recommended Architecture](#recommended-architecture)
6. [Implementation Guide](#implementation-guide)
7. [Time Estimates](#time-estimates)
8. [Validation](#validation)
9. [Pitfalls & Lessons Learned](#pitfalls--lessons-learned)
10. [UI Integration & Data Persistence](#ui-integration--data-persistence)

---

## Goal & Business Context

### The Problem We're Solving

We want to find wallets that are profitable to **copy trade with equal weighting** - meaning if a wallet makes 100 trades, we copy each trade with $1.

**Why trade-level (tx_hash) matters:**
- A wallet might have great position-level PnL but terrible trade-level PnL
- Example: Wallet buys 10 trades into same position, 9 lose money, 1 wins big
- Position-level: Looks profitable
- Trade-level: 90% of copied trades lose money

**Why FIFO matters:**
- Traders often sell before resolution
- FIFO (First-In-First-Out) determines which buy trades get matched to which sells
- Without FIFO, we can't know which specific trades were winners vs losers

### Success Criteria

1. Per-trade (tx_hash) ROI calculated using proper FIFO matching
2. Covers all wallets active in chosen time window
3. Accurate enough to validate against known profitable wallets
4. Completes in reasonable time (<12 hours for 90-day scope)

---

## Key Concepts

### Terminology

| Term | Definition |
|------|------------|
| **tx_hash** | Transaction hash = one trade decision. A tx can have multiple fills. |
| **Fill** | Individual order execution. One trade can have 1-N fills. |
| **Position** | Wallet + condition_id + outcome_index. Aggregate of all trades in one market side. |
| **FIFO** | First-In-First-Out. Sells consume oldest buys first. |
| **Trade-level ROI** | (exit_value - cost) / cost for a single tx_hash |

### FIFO Matching Explained

```
Position timeline:
  T1: Buy 100 tokens @ $0.50 (Trade A, cost $50)
  T2: Buy 50 tokens @ $0.80 (Trade B, cost $40)
  T3: Sell 80 tokens @ $0.70 (proceeds $56)
  T4: Resolution → remaining 70 tokens worth $0

FIFO matching:
  - Sell at T3 consumes from oldest buy first (Trade A)
  - Trade A: 80 of 100 tokens sold for $56, 20 tokens held → worth $0
  - Trade B: 0 tokens sold, all 50 held → worth $0

Trade-level results:
  - Trade A: exit = $56 + $0 = $56, cost = $50 → ROI = +12%
  - Trade B: exit = $0, cost = $40 → ROI = -100%

Position-level result:
  - Total exit = $56, Total cost = $90 → ROI = -38%

Key insight: Trade A was profitable (+12%), Trade B was a total loss (-100%)
Position-level averaging hides this completely.
```

### Data Scale

| Scope | Wallets | Conditions | Fills | Est. Trades |
|-------|---------|------------|-------|-------------|
| 7d active + 30d history | 186K | 54K | 118M | ~31M |
| 30d active + 30d history | 415K | 54K | 134M | ~31M |
| 30d active + 90d history | 462K | 142K | 255M | ~70M |
| 90d active + 90d history | 839K | 142K | 281M | ~80M |
| All-time | ~1.5M | ~200K | 556M | ~150M |

---

## Data Model

### Source Tables

**pm_canonical_fills_v4** - Individual fill records
```sql
- tx_hash: String (trade identifier)
- wallet: String
- condition_id: String
- outcome_index: UInt8 (0 or 1)
- event_time: DateTime
- tokens_delta: Float64 (positive = buy, negative = sell)
- usdc_delta: Float64 (negative = spent, positive = received)
- is_maker: UInt8
- source: String (filter for 'clob')
- is_self_fill: UInt8
```

**pm_condition_resolutions** - Resolution outcomes
```sql
- condition_id: String
- payout_numerators: String ('[1,0]', '[0,1]', or '[1,1]')
- resolved_at: DateTime
- is_deleted: UInt8
```

### Target Table

**pm_trade_fifo_roi_v1** - Per-trade FIFO ROI (to be populated)
```sql
CREATE TABLE pm_trade_fifo_roi_v1 (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  tokens Float64,           -- tokens bought in this trade
  cost_usd Float64,         -- USD spent
  exit_value Float64,       -- USD from sells + resolution
  pnl_usd Float64,          -- exit_value - cost_usd
  roi Float64,              -- pnl_usd / cost_usd
  pct_sold_early Float32,   -- % of position sold before resolution
  is_maker UInt8,
  resolved_at DateTime,
  computed_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (wallet, tx_hash)
```

### Aggregated Wallet Metrics Table

**pm_wallet_copy_trading_metrics_v1** - Wallet-level aggregates
```sql
- wallet
- total_trades, wins, losses, win_rate_pct
- avg_roi_pct, avg_win_roi_pct, avg_loss_roi_pct
- pct_wins_over_50, pct_wins_over_100, pct_wins_over_500
- expectancy_pct, asinh_score
- total_volume_usd, total_pnl_usd
- maker_pct, taker_pct, sold_early_pct
- first_trade_time, last_trade_time, days_active
```

---

## Why Simpler Approaches Don't Work

### Approach 1: Hold-to-Resolution Assumption

**What it does:** Assumes all tokens are held until resolution.

**Why it fails:**
- 92% of profitable wallets actively trade (sell before resolution)
- Metrics are completely wrong for active traders
- Only accurate for the worst performers (lottery ticket buyers)

**Evidence:** Top wallets by hold-to-resolution expectancy were buying 1-2 cent longshots. The wallets with best actual PnL had `sold_early_pct` of 81-698%.

### Approach 2: Position-Level Proportional Allocation

**What it does:**
```
Trade PnL = (trade_cost / position_cost) × position_pnl
```

**Why it fails:**
- Destroys FIFO information completely
- Example: Trade A wins +40%, Trade B loses -100%
- Proportional shows both at -22%
- For copy trading, you NEED to know Trade A was good and Trade B was bad

### Approach 3: Wallet-Based Processing in TypeScript

**What it does:** Process 50-300 wallets at a time, query all their fills, do FIFO in TypeScript.

**Why it fails:**
- Stack overflow: `Math.min(...largeArray)` crashes
- Memory limits: ClickHouse returns 10GB+ for large wallet batches
- Too slow: 6,446 chunks × 2 min = 10+ hours
- String escaping: tx_hash values with binary chars break SQL

### Approach 4: Condition-Based Processing (Better, But Still Issues)

**What it does:** Process by condition_id instead of wallet.

**Improvements:**
- 25K conditions vs 227K wallets = fewer iterations
- More cache-friendly for ClickHouse

**Remaining issues:**
- Some conditions have 200K+ fills
- Still hits memory limits on large batches
- ETA: ~3 hours, but unreliable

---

## Recommended Architecture

### Overview: 8-Worker Parallel Processing

```
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 1: PREPARATION                      │
│  1. Get list of all condition_ids to process                │
│  2. Split into 8 roughly equal ranges                       │
│  3. Create pm_trade_fifo_roi_v1 table (if not exists)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 PHASE 2: PARALLEL FIFO                       │
│                                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     ┌─────────┐       │
│  │Worker 1 │ │Worker 2 │ │Worker 3 │ ... │Worker 8 │       │
│  │Cond 1-7K│ │Cond 7-14K│ │Cond 14-21K│   │Cond 49-54K│     │
│  └────┬────┘ └────┬────┘ └────┬────┘     └────┬────┘       │
│       │           │           │               │             │
│       ▼           ▼           ▼               ▼             │
│  ┌─────────────────────────────────────────────────┐       │
│  │         pm_trade_fifo_roi_v1 (inserts)          │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 PHASE 3: AGGREGATION                         │
│  Single SQL query to aggregate trade ROIs to wallet metrics │
│  INSERT INTO pm_wallet_copy_trading_metrics_v1              │
│  SELECT wallet, count(), avg(roi), ... FROM pm_trade_fifo_roi_v1 │
└─────────────────────────────────────────────────────────────┘
```

### Per-Worker Algorithm

```typescript
for each condition_id in my_range:
  // 1. Query all fills for this condition
  fills = query(`
    SELECT tx_hash, wallet, outcome_index, event_time, tokens_delta, usdc_delta, is_maker
    FROM pm_canonical_fills_v4
    WHERE condition_id = '${condition_id}'
      AND source = 'clob'
      AND NOT (is_self_fill = 1 AND is_maker = 1)
    ORDER BY wallet, outcome_index, event_time
  `)

  // 2. Get resolution info
  resolution = query(`SELECT payout_numerators, resolved_at FROM pm_condition_resolutions WHERE condition_id = '${condition_id}'`)

  // 3. Group fills by wallet/outcome (position)
  positions = groupBy(fills, f => `${f.wallet}|${f.outcome_index}`)

  // 4. For each position, do FIFO matching
  for each position in positions:
    trades = doFifoMatching(position.fills, resolution)
    results.push(...trades)

  // 5. Insert results in batches of 10K
  for chunk in results.chunk(10000):
    insert(chunk)
```

### FIFO Matching Function

```typescript
function doFifoMatching(fills: Fill[], resolution: Resolution): TradeROI[] {
  const payoutRate = parsePayoutRate(resolution.payout_numerators, outcome_index)

  // Separate and aggregate buys by tx_hash
  const buyTrades = new Map<string, {tokens: number, cost: number, time: Date, is_maker: number}>()
  const sells: {time: Date, tokens: number, proceeds: number}[] = []

  for (const fill of fills) {
    if (fill.tokens_delta > 0) {
      // Buy - aggregate by tx_hash
      const existing = buyTrades.get(fill.tx_hash)
      if (existing) {
        existing.tokens += fill.tokens_delta
        existing.cost += Math.abs(fill.usdc_delta)
      } else {
        buyTrades.set(fill.tx_hash, {
          tokens: fill.tokens_delta,
          cost: Math.abs(fill.usdc_delta),
          time: fill.event_time,
          is_maker: fill.is_maker
        })
      }
    } else if (fill.tokens_delta < 0 && fill.event_time < resolution.resolved_at) {
      // Sell before resolution
      sells.push({
        time: fill.event_time,
        tokens: Math.abs(fill.tokens_delta),
        proceeds: Math.abs(fill.usdc_delta)
      })
    }
  }

  // Sort buys by time (FIFO order)
  const sortedBuys = Array.from(buyTrades.entries())
    .map(([tx_hash, data]) => ({tx_hash, ...data, remaining: data.tokens}))
    .sort((a, b) => a.time.getTime() - b.time.getTime())

  // Sort sells by time
  sells.sort((a, b) => a.time.getTime() - b.time.getTime())

  // FIFO matching: sells consume oldest buys
  let totalSellProceeds = 0
  let totalTokensSold = 0

  for (const sell of sells) {
    let tokensToMatch = sell.tokens
    totalTokensSold += sell.tokens
    totalSellProceeds += sell.proceeds

    for (const buy of sortedBuys) {
      if (tokensToMatch <= 0) break
      if (buy.remaining <= 0) continue

      const matched = Math.min(buy.remaining, tokensToMatch)
      buy.remaining -= matched
      tokensToMatch -= matched
    }
  }

  // Calculate per-trade ROI
  const results: TradeROI[] = []
  const totalBuyTokens = sortedBuys.reduce((sum, b) => sum + b.tokens, 0)
  const pctSoldEarly = totalBuyTokens > 0 ? (totalTokensSold / totalBuyTokens) * 100 : 0

  for (const buy of sortedBuys) {
    if (buy.cost < 0.01) continue // Skip dust

    const tokensSoldEarly = buy.tokens - buy.remaining
    const tokensHeld = buy.remaining

    // Exit value calculation
    let exitValue = 0
    if (tokensSoldEarly > 0 && totalTokensSold > 0) {
      exitValue += (tokensSoldEarly / totalTokensSold) * totalSellProceeds
    }
    if (tokensHeld > 0) {
      exitValue += tokensHeld * payoutRate
    }

    const pnl = exitValue - buy.cost
    const roi = buy.cost > 0 ? pnl / buy.cost : 0

    results.push({
      tx_hash: buy.tx_hash,
      tokens: buy.tokens,
      cost_usd: buy.cost,
      exit_value: exitValue,
      pnl_usd: pnl,
      roi: roi,
      pct_sold_early: pctSoldEarly,
      is_maker: buy.is_maker,
      entry_time: buy.time
    })
  }

  return results
}
```

---

## Implementation Guide

### Step 1: Create the Target Table

```sql
DROP TABLE IF EXISTS pm_trade_fifo_roi_v1;

CREATE TABLE pm_trade_fifo_roi_v1 (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  tokens Float64,
  cost_usd Float64,
  exit_value Float64,
  pnl_usd Float64,
  roi Float64,
  pct_sold_early Float32,
  is_maker UInt8,
  resolved_at DateTime,
  computed_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (wallet, tx_hash);
```

### Step 2: Get Condition Ranges for Workers

```sql
-- Get all conditions to process
SELECT condition_id
FROM pm_condition_resolutions
WHERE is_deleted = 0
  AND payout_numerators != ''
  AND resolved_at >= now() - INTERVAL 90 DAY  -- adjust based on scope
ORDER BY condition_id;

-- Split into 8 ranges based on row count
-- Worker 1: conditions 1 to N/8
-- Worker 2: conditions N/8+1 to 2N/8
-- etc.
```

### Step 3: Create Worker Script

File: `scripts/fifo-worker.ts`

```typescript
#!/usr/bin/env npx tsx
/**
 * FIFO Worker - processes a range of conditions
 * Usage: npx tsx scripts/fifo-worker.ts <worker_id> <total_workers>
 * Example: npx tsx scripts/fifo-worker.ts 1 8
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

const DAYS_BACK = 90  // Adjust based on scope

// Safe array helpers (avoid stack overflow)
function arrayMin(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((min, val) => val < min ? val : min, arr[0])
}

function arrayMax(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((max, val) => val > max ? val : max, arr[0])
}

async function main() {
  const workerId = parseInt(process.argv[2]) || 1
  const totalWorkers = parseInt(process.argv[3]) || 8

  console.log(`🔧 FIFO Worker ${workerId}/${totalWorkers}`)
  console.log(`   Processing ${DAYS_BACK}-day scope`)

  // Get all conditions
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0 AND payout_numerators != ''
        AND resolved_at >= now() - INTERVAL ${DAYS_BACK} DAY
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  })
  const allConditions = await conditionsResult.json() as any[]

  // Calculate this worker's range
  const totalConditions = allConditions.length
  const chunkSize = Math.ceil(totalConditions / totalWorkers)
  const startIdx = (workerId - 1) * chunkSize
  const endIdx = Math.min(startIdx + chunkSize, totalConditions)
  const myConditions = allConditions.slice(startIdx, endIdx)

  console.log(`   Assigned conditions ${startIdx + 1} to ${endIdx} (${myConditions.length} total)`)

  let processed = 0
  let totalTrades = 0
  const startTime = Date.now()

  for (const cond of myConditions) {
    try {
      const trades = await processCondition(cond)
      totalTrades += trades.length

      if (trades.length > 0) {
        await insertTrades(trades, cond.condition_id, cond.resolved_at)
      }

      processed++
      if (processed % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = processed / elapsed
        const remaining = myConditions.length - processed
        const eta = Math.round(remaining / rate / 60)
        console.log(`   [Worker ${workerId}] ${processed}/${myConditions.length} conditions | ${totalTrades.toLocaleString()} trades | ETA: ${eta}m`)
      }
    } catch (err: any) {
      console.error(`   [Worker ${workerId}] Error on ${cond.condition_id}: ${err.message.slice(0, 100)}`)
    }
  }

  console.log(`✅ Worker ${workerId} complete: ${totalTrades.toLocaleString()} trades`)
}

async function processCondition(cond: any): Promise<any[]> {
  // Implementation of FIFO matching (see algorithm above)
  // ... full implementation here ...
}

async function insertTrades(trades: any[], condition_id: string, resolved_at: string) {
  const batchSize = 10000
  for (let i = 0; i < trades.length; i += batchSize) {
    const batch = trades.slice(i, i + batchSize)
    await clickhouse.insert({
      table: 'pm_trade_fifo_roi_v1',
      values: batch.map(t => ({
        tx_hash: t.tx_hash,
        wallet: t.wallet,
        condition_id: condition_id,
        outcome_index: t.outcome_index,
        entry_time: t.entry_time,
        tokens: t.tokens,
        cost_usd: t.cost_usd,
        exit_value: t.exit_value,
        pnl_usd: t.pnl_usd,
        roi: t.roi,
        pct_sold_early: t.pct_sold_early,
        is_maker: t.is_maker,
        resolved_at: resolved_at
      })),
      format: 'JSONEachRow'
    })
  }
}

main().catch(console.error)
```

### Step 4: Create Parallel Runner Script

File: `scripts/run-fifo-parallel.sh`

```bash
#!/bin/bash
# Run 8 FIFO workers in parallel

echo "Starting 8 FIFO workers..."

npx tsx scripts/fifo-worker.ts 1 8 > logs/fifo-worker-1.log 2>&1 &
npx tsx scripts/fifo-worker.ts 2 8 > logs/fifo-worker-2.log 2>&1 &
npx tsx scripts/fifo-worker.ts 3 8 > logs/fifo-worker-3.log 2>&1 &
npx tsx scripts/fifo-worker.ts 4 8 > logs/fifo-worker-4.log 2>&1 &
npx tsx scripts/fifo-worker.ts 5 8 > logs/fifo-worker-5.log 2>&1 &
npx tsx scripts/fifo-worker.ts 6 8 > logs/fifo-worker-6.log 2>&1 &
npx tsx scripts/fifo-worker.ts 7 8 > logs/fifo-worker-7.log 2>&1 &
npx tsx scripts/fifo-worker.ts 8 8 > logs/fifo-worker-8.log 2>&1 &

echo "All workers started. Monitor with: tail -f logs/fifo-worker-*.log"
wait
echo "All workers complete!"
```

### Step 5: Aggregate to Wallet Metrics

After all workers complete:

```sql
-- Clear existing metrics
TRUNCATE TABLE pm_wallet_copy_trading_metrics_v1;

-- Aggregate from trade-level to wallet-level
INSERT INTO pm_wallet_copy_trading_metrics_v1
SELECT
  wallet,

  -- Trade counts
  toUInt32(count()) as total_trades,
  toUInt32(countIf(roi > 0)) as wins,
  toUInt32(countIf(roi <= 0)) as losses,
  toFloat32(round(countIf(roi > 0) * 100.0 / count(), 2)) as win_rate_pct,

  -- ROI metrics
  toFloat32(round(avg(roi) * 100, 2)) as avg_roi_pct,
  toFloat32(round(avgIf(roi, roi > 0) * 100, 2)) as avg_win_roi_pct,
  toFloat32(round(abs(avgIf(roi, roi <= 0)) * 100, 2)) as avg_loss_roi_pct,
  toFloat32(round(medianIf(roi, roi > 0) * 100, 2)) as median_win_roi_pct,
  toFloat32(round(stddevPop(roi) * 100, 2)) as roi_stddev_pct,

  -- Win distribution
  toFloat32(round(countIf(roi > 0.5 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_50,
  toFloat32(round(countIf(roi > 1.0 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_100,
  toFloat32(round(countIf(roi > 5.0 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_500,
  toFloat32(round(max(roi) * 100, 2)) as max_win_roi_pct,

  -- Loss distribution
  toFloat32(round(countIf(roi < -0.5 AND roi <= 0) * 100.0 / nullIf(countIf(roi <= 0), 0), 1)) as pct_losses_over_50,
  toFloat32(round(countIf(roi < -0.9 AND roi <= 0) * 100.0 / nullIf(countIf(roi <= 0), 0), 1)) as pct_losses_over_90,
  toFloat32(round(min(roi) * 100, 2)) as max_loss_roi_pct,

  -- Key metrics
  toFloat32(round((countIf(roi > 0) / count() * avgIf(roi, roi > 0) -
           countIf(roi <= 0) / count() * abs(avgIf(roi, roi <= 0))) * 100, 2)) as expectancy_pct,
  toFloat32(round(avg(asinh(roi)), 4)) as asinh_score,
  toFloat32(round(avgIf(roi, roi > 0) / nullIf(abs(avgIf(roi, roi <= 0)), 0), 2)) as win_loss_ratio,

  -- Volume
  round(sum(cost_usd), 2) as total_volume_usd,
  round(sum(pnl_usd), 2) as total_pnl_usd,
  toFloat32(round(avg(cost_usd), 2)) as avg_trade_usd,

  -- Activity
  toUInt32(count(DISTINCT condition_id)) as positions_traded,
  min(entry_time) as first_trade_time,
  max(entry_time) as last_trade_time,
  toUInt16(dateDiff('day', min(entry_time), max(entry_time)) + 1) as days_active,
  toFloat32(round(count() / (dateDiff('day', min(entry_time), max(entry_time)) + 1), 2)) as trades_per_day,

  -- Behavior
  toFloat32(round(countIf(is_maker = 1) * 100.0 / count(), 1)) as maker_pct,
  toFloat32(round(countIf(is_maker = 0) * 100.0 / count(), 1)) as taker_pct,
  toFloat32(round(avg(pct_sold_early), 1)) as sold_early_pct,

  now() as computed_at

FROM pm_trade_fifo_roi_v1 FINAL
GROUP BY wallet
HAVING count() >= 5  -- Minimum 5 trades
SETTINGS max_execution_time = 600;
```

---

## Time Estimates

### 8-Worker Parallel Processing

| Scope | Wallets | Fills | Conditions | Time |
|-------|---------|-------|------------|------|
| 7d active + 30d history | 186K | 118M | 54K | **3-3.5 hours** |
| 14d active + 30d history | 267K | 128M | 54K | **3.5-4 hours** |
| 30d active + 30d history | 415K | 134M | 54K | **4 hours** |
| 30d active + 60d history | 451K | 211M | 100K | **6 hours** |
| 30d active + 90d history | 462K | 255M | 142K | **7-8 hours** |
| 90d active + 90d history | 839K | 281M | 142K | **8-9 hours** |
| 30d active + all-time | ~462K | ~400M | ~200K | **12-14 hours** |

### Single-Thread (Not Recommended)

Multiply above times by 6-8x for single-threaded processing.

---

## Validation

### Step 1: Row Count Check

```sql
-- Should match expected trade count
SELECT count() as total_trades, count(DISTINCT wallet) as wallets
FROM pm_trade_fifo_roi_v1 FINAL;
```

### Step 2: Sanity Checks

```sql
-- ROI distribution should be roughly centered around 0
SELECT
  round(avg(roi) * 100, 2) as avg_roi,
  round(median(roi) * 100, 2) as median_roi,
  countIf(roi > 0) as winners,
  countIf(roi <= 0) as losers
FROM pm_trade_fifo_roi_v1 FINAL;

-- Win rate should be 40-60% range typically
SELECT round(countIf(roi > 0) * 100.0 / count(), 1) as overall_win_rate
FROM pm_trade_fifo_roi_v1 FINAL;
```

### Step 3: Spot Check Known Wallets

Compare top wallets' total_pnl_usd against PnL engine:

```typescript
// For top 10 wallets by expectancy
const wallets = await getTopWalletsByExpectancy(10)
for (const w of wallets) {
  const pnlEngine = await getWalletPnLV1(w.wallet)
  const tradeTable = w.total_pnl_usd
  console.log(`${w.wallet}: Table=${tradeTable}, Engine=${pnlEngine.realized}`)
  // Should be within 20%
}
```

### Step 4: Copy Trading Candidate Query

```sql
-- Should return sensible results
SELECT
  wallet,
  total_trades,
  win_rate_pct,
  avg_roi_pct,
  expectancy_pct,
  total_pnl_usd,
  sold_early_pct
FROM pm_wallet_copy_trading_metrics_v1
WHERE taker_pct >= 70  -- Copyable (not market makers)
  AND toDate(last_trade_time) >= today() - 7  -- Active
  AND expectancy_pct > 5  -- Profitable
  AND total_trades >= 20  -- Enough sample size
ORDER BY expectancy_pct DESC
LIMIT 50;
```

---

## Pitfalls & Lessons Learned

### 1. Stack Overflow with Spread Operator

**Problem:** `Math.min(...largeArray)` crashes on arrays > ~100K elements.

**Solution:** Use reduce instead:
```typescript
function arrayMin(arr: number[]): number {
  return arr.reduce((min, val) => val < min ? val : min, arr[0])
}
```

### 2. ClickHouse Memory Limits

**Problem:** Queries returning > 10GB hit memory limits.

**Solution:**
- Process by condition (smaller units)
- Use LIMIT in subqueries
- Avoid large JOINs

### 3. String Escaping in SQL VALUES

**Problem:** tx_hash values can contain binary characters that break SQL.

**Solution:** Use JSONEachRow format for inserts:
```typescript
await clickhouse.insert({
  table: 'pm_trade_fifo_roi_v1',
  values: trades,
  format: 'JSONEachRow'
})
```

### 4. Insert Batch Size

**Problem:** Inserting 1M+ rows at once hits string length limits.

**Solution:** Batch inserts into 10K row chunks.

### 5. Position-Level Approximation Is Wrong

**Problem:** Proportional allocation destroys FIFO information.

**Example:**
- FIFO: Trade A = +40%, Trade B = -100%
- Proportional: Both = -22%

**Solution:** Must do true FIFO matching. No shortcuts.

### 6. Most Volume Comes from Whales

**Problem:** Filtering by "7d active" vs "30d active" barely changes fill count.

**Reason:** The most active traders trade every day and dominate volume.

**Implication:** Time estimates don't vary much between activity filters.

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/fifo-worker.ts` | Single worker script (to be created) |
| `scripts/run-fifo-parallel.sh` | Parallel runner (to be created) |
| `scripts/build-trade-fifo-roi.ts` | Earlier attempt (has issues) |
| `scripts/build-wallet-metrics-fifo-v2.ts` | Wallet-based approach (too slow) |
| `scripts/build-wallet-metrics-fast.ts` | Hold-to-resolution (inaccurate) |

---

## Quick Start Checklist

1. [ ] Create `pm_trade_fifo_roi_v1` table
2. [ ] Create `scripts/fifo-worker.ts` with full FIFO implementation
3. [ ] Create `scripts/run-fifo-parallel.sh`
4. [ ] Create `logs/` directory
5. [ ] Run: `chmod +x scripts/run-fifo-parallel.sh && ./scripts/run-fifo-parallel.sh`
6. [ ] Monitor: `tail -f logs/fifo-worker-*.log`
7. [ ] After completion: Run aggregation SQL
8. [ ] Validate results

---

## UI Integration & Data Persistence

### UI Requirements

The wallet activity view needs to show **trade-level (tx_hash) activity**, not raw fills:

1. **Position Dropdown** - Each position in a wallet's activity should expand to show individual trades
2. **Activity Tab** - Show trades (tx_hash) as discrete events, not individual fills
3. **Trade Display** - Each trade shows:
   - Entry time
   - Side (maker/taker)
   - Tokens bought/sold
   - Cost/proceeds USD
   - ROI (if resolved)
   - FIFO status (sold early vs held)

### Why Not Show Raw Fills?

| View | User Experience | Data Volume |
|------|-----------------|-------------|
| **Raw Fills** | Confusing (multiple rows per trade) | ~4 fills per trade average |
| **Trades (tx_hash)** | Clear (one row = one decision) | Manageable |

A single trade can have 1-10+ fills due to partial order execution. Showing fills is noisy and confusing.

### Data Architecture Options

#### Option A: Full Precompute (Batch Only)

```
┌─────────────────────────────────────────────────────┐
│    pm_trade_fifo_roi_v1 (precomputed table)        │
│    - All wallets, all trades, FIFO calculated      │
│    - Rebuilt periodically (daily/weekly)           │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
                    API Query
                         │
                         ▼
                       UI
```

**Pros:**
- Fast queries (indexed)
- Consistent data
- Simple API

**Cons:**
- Stale data between rebuilds
- Must rebuild for new wallets
- Large storage (30M+ trades)
- 4-8 hour rebuild time

**Best for:** Leaderboard, analytics, bulk queries

#### Option B: On-Demand Calculation (Real-Time)

```
┌─────────────────────────────────────────────────────┐
│          pm_canonical_fills_v4 (raw)               │
│          pm_condition_resolutions                  │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
              API (calculates FIFO live)
                         │
                         ▼
                       UI
```

**Pros:**
- Always fresh
- No precompute needed
- Works for any wallet instantly

**Cons:**
- Slower (100ms-2s per wallet)
- CPU intensive
- Can't do bulk queries efficiently

**Best for:** Single wallet view, real-time activity

#### Option C: Hybrid (Recommended)

```
┌─────────────────────────────────────────────────────┐
│  pm_wallet_trades_v1 (trade aggregation only)      │
│  - tx_hash, wallet, condition_id, tokens, cost     │
│  - NO FIFO ROI (that's calculated on-demand)       │
│  - Fast to build/maintain                          │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
          API (joins with resolutions, calculates ROI)
                         │
                         ▼
                       UI
```

**Pros:**
- Trade aggregation is simple (just GROUP BY tx_hash)
- FIFO ROI calculated per-wallet on demand (fast for single wallet)
- Always fresh
- Reasonable storage

**Cons:**
- Can't do bulk ROI queries (use Option A table for that)
- Slightly slower than pure precompute

**Best for:** UI activity feed, single wallet views

#### Option D: Streaming with Incremental Updates

```
┌─────────────────────────────────────────────────────┐
│    pm_canonical_fills_v4 (incoming data)           │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
           Materialized View / Cron Job
           (incrementally updates trades)
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│    pm_trade_fifo_roi_v1 (kept up-to-date)          │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
                    API Query
                         │
                         ▼
                       UI
```

**Pros:**
- Always fresh after initial build
- Fast queries
- Best of both worlds

**Cons:**
- Complex to implement correctly
- FIFO recalculation on new fills is tricky
- ClickHouse MV limitations

**Best for:** Production system with high query volume

### Recommended Architecture

**Use a two-table approach:**

| Table | Purpose | Update Frequency |
|-------|---------|------------------|
| `pm_wallet_trades_v1` | Trade aggregation (no ROI) | Real-time via MV or hourly cron |
| `pm_trade_fifo_roi_v1` | Full FIFO ROI (for leaderboard) | Daily or weekly batch |

**API Strategy:**

```typescript
// For single wallet activity view (UI)
async function getWalletTradesWithROI(wallet: string) {
  // 1. Get trades from fast aggregation table
  const trades = await getTradesForWallet(wallet)  // Fast, always fresh

  // 2. Get resolutions for those conditions
  const resolutions = await getResolutionsForConditions(trades.map(t => t.condition_id))

  // 3. Calculate FIFO ROI on-demand (fast for single wallet)
  return calculateFifoForWallet(trades, resolutions)  // 50-200ms
}

// For leaderboard / bulk queries
async function getTopWalletsByExpectancy(limit: number) {
  // Use precomputed table (must be rebuilt periodically)
  return query(`SELECT * FROM pm_wallet_copy_trading_metrics_v1 ORDER BY expectancy_pct DESC LIMIT ${limit}`)
}
```

### Trade Aggregation Table (Simple, Fast)

This table can be maintained in real-time or near-real-time:

```sql
CREATE TABLE pm_wallet_trades_v1 (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  trade_time DateTime,      -- min(event_time) of fills
  side String,              -- 'buy' or 'sell'
  tokens Float64,           -- sum of tokens
  usdc Float64,             -- sum of usdc
  is_maker UInt8,           -- max(is_maker)
  fill_count UInt16,        -- count of fills
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet, condition_id, tx_hash);

-- Populate from fills (fast, can run hourly)
INSERT INTO pm_wallet_trades_v1
SELECT
  tx_hash,
  wallet,
  condition_id,
  outcome_index,
  min(event_time) as trade_time,
  if(sum(tokens_delta) > 0, 'buy', 'sell') as side,
  abs(sum(tokens_delta)) as tokens,
  abs(sum(usdc_delta)) as usdc,
  max(is_maker) as is_maker,
  count() as fill_count,
  now() as updated_at
FROM pm_canonical_fills_v4
WHERE source = 'clob'
  AND wallet != '0x0000000000000000000000000000000000000000'
  AND NOT (is_self_fill = 1 AND is_maker = 1)
GROUP BY tx_hash, wallet, condition_id, outcome_index;
```

**Build time:** ~10-20 minutes for all-time data (just aggregation, no FIFO)

### API Endpoint Design

```typescript
// GET /api/wallet/[address]/trades
// Returns trade-level activity with FIFO ROI

interface WalletTradeResponse {
  tx_hash: string
  condition_id: string
  outcome_index: number
  market_name: string         // joined from conditions
  trade_time: string
  side: 'buy' | 'sell'
  tokens: number
  cost_usd: number
  is_maker: boolean
  fill_count: number

  // FIFO-calculated fields (for resolved positions)
  is_resolved: boolean
  exit_value?: number
  pnl_usd?: number
  roi_pct?: number
  pct_sold_early?: number
}

// GET /api/wallet/[address]/positions/[condition_id]/trades
// Returns trades for a specific position (for dropdown expansion)
```

### Do We Need to Precompute for ALL Wallets?

**Short answer: No, not for UI activity.**

| Use Case | Precompute Needed? | Reason |
|----------|-------------------|--------|
| **Single wallet activity view** | No | Calculate on-demand (50-200ms) |
| **Wallet leaderboard** | Yes | Need to compare all wallets |
| **Copy trading candidates** | Yes | Need bulk filtering/sorting |
| **Position dropdown** | No | Just filter trades table |

**Strategy:**
1. Build `pm_wallet_trades_v1` (aggregation only) - keep always fresh
2. Calculate FIFO on-demand for individual wallet views
3. Rebuild `pm_trade_fifo_roi_v1` weekly for leaderboard/analytics

### Incremental Update Strategy

For keeping trade aggregation fresh:

```sql
-- Option 1: Hourly cron job (simple)
-- Run every hour to catch new trades

INSERT INTO pm_wallet_trades_v1
SELECT ... FROM pm_canonical_fills_v4
WHERE event_time >= now() - INTERVAL 2 HOUR  -- overlap for safety
...
-- ReplacingMergeTree handles duplicates

-- Option 2: Materialized View (real-time, more complex)
CREATE MATERIALIZED VIEW pm_wallet_trades_mv
TO pm_wallet_trades_v1
AS SELECT ... FROM pm_canonical_fills_v4
...
-- Note: MVs aggregate per-batch, so may need periodic OPTIMIZE
```

### Summary

| Question | Answer |
|----------|--------|
| Do we precompute for all wallets? | Only for leaderboard/analytics |
| Can this be streamed to UI? | Yes, via on-demand FIFO calculation |
| What table do we need always-fresh? | `pm_wallet_trades_v1` (aggregation only) |
| What table can be batch-updated? | `pm_trade_fifo_roi_v1` (full FIFO ROI) |
| API response time for single wallet? | 50-200ms |
| API response time for leaderboard? | <50ms (precomputed) |

---

## Contact / Questions

This document was created based on extensive experimentation in January 2026. If you encounter issues not covered here, check the conversation history in claude-self-reflect for additional context.
