# Universal PnL Solution Design

**Date:** 2025-11-26
**Author:** Claude 1
**Status:** Design Document

## Objective

Design a universal PnL solution that accurately computes realized and unrealized PnL for ALL wallets in the Polymarket ecosystem, not just a subset.

## Scope

- **1.6M+ wallets** in our CLOB data
- **775K+ wallets** with CTF events
- Must match Polymarket UI values where possible
- Must be scalable and maintainable

## Architecture Decision

### Chosen Approach: Hybrid DB + API Pipeline

After investigation, a pure DB-only approach is not feasible without additional blockchain data (PositionSplit events from exchange contract). Therefore, we will use a **hybrid approach**:

1. **Primary Source:** Polymarket Data API for UI-matching PnL
2. **Fallback/Supplement:** Database calculations for:
   - Historical analysis
   - Wallets not in API
   - Cross-validation

## Data Sources

### 1. Polymarket Data API

| Endpoint | Data | Use Case |
|----------|------|----------|
| `/positions?user={wallet}` | Open positions with cashPnl | Current unrealized P&L |
| `/closed-positions?user={wallet}` | Recently closed positions | Realized P&L |

**Limitations:**
- `/closed-positions` returns only ~50 most recent positions
- Rate limited (need to respect limits)
- Only works for known wallets

### 2. Database (Supplementary)

| Table | Use |
|-------|-----|
| `pm_trader_events_v2` | CLOB trades for volume/activity |
| `pm_condition_resolutions` | Market outcomes |
| `pm_ctf_events` | PayoutRedemption for actual redemptions |

## Database Schema

### Core Table: `pm_api_positions`

```sql
CREATE TABLE pm_api_positions (
  -- Identity
  wallet String,
  condition_id String,
  outcome String,  -- 'Yes' or 'No'

  -- Position Data
  size Float64,
  avg_price Float64,
  initial_value Float64,
  current_value Float64,

  -- PnL Fields
  cash_pnl Float64,
  realized_pnl Float64,

  -- Status
  is_closed UInt8,
  closed_at Nullable(DateTime),

  -- Metadata
  market_slug String,
  question String,

  -- Audit
  fetched_at DateTime,
  insert_time DateTime DEFAULT now(),
  is_deleted UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(insert_time)
ORDER BY (wallet, condition_id, outcome)
```

### Summary View: `vw_wallet_pnl_api`

```sql
CREATE OR REPLACE VIEW vw_wallet_pnl_api AS
SELECT
  wallet,
  -- Realized PnL from closed positions
  SUM(CASE WHEN is_closed = 1 THEN realized_pnl ELSE 0 END) AS realized_pnl,
  -- Unrealized PnL from open positions
  SUM(CASE WHEN is_closed = 0 THEN cash_pnl ELSE 0 END) AS unrealized_pnl,
  -- Total
  SUM(CASE WHEN is_closed = 1 THEN realized_pnl ELSE cash_pnl END) AS total_pnl,
  -- Position counts
  COUNT(DISTINCT CASE WHEN is_closed = 0 THEN condition_id END) AS open_positions,
  COUNT(DISTINCT CASE WHEN is_closed = 1 THEN condition_id END) AS closed_positions,
  -- Last update
  MAX(fetched_at) AS last_updated
FROM pm_api_positions
WHERE is_deleted = 0
GROUP BY wallet
```

## Backfill Pipeline Design

### Worker Architecture

```
┌─────────────────┐
│  Wallet Queue   │ ← All 1.6M wallets from pm_trader_events_v2
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│Worker 1│ │Worker N│  ← Parallel workers (8-16)
└────┬───┘ └───┬────┘
     │         │
     ▼         ▼
┌─────────────────────┐
│ Polymarket Data API │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ pm_api_positions    │
└─────────────────────┘
```

### Rate Limiting Strategy

```typescript
const RATE_LIMITS = {
  requestsPerSecond: 5,     // Conservative estimate
  requestsPerMinute: 100,   // Burst limit
  workersCount: 8,          // Parallel workers
  batchSize: 100,           // Wallets per batch
  retryDelay: 1000,         // 1 second on 429
  maxRetries: 3,
};
```

### Crash Recovery

```typescript
interface CheckpointState {
  lastProcessedWallet: string;
  processedCount: number;
  errorCount: number;
  lastCheckpoint: Date;
  failedWallets: string[];  // Retry queue
}

// Checkpoint saved every 100 wallets
// On crash: Resume from lastProcessedWallet
// Failed wallets retried at end
```

### Stall Protection

```typescript
const STALL_THRESHOLDS = {
  maxIdleSeconds: 60,         // No progress for 1 min = stall
  healthCheckInterval: 10000, // Check every 10 sec
  autoRestartOnStall: true,
};
```

## Implementation Plan

### Phase 1: Table Creation (Day 1)

1. Create `pm_api_positions` table
2. Create `vw_wallet_pnl_api` view
3. Test with 10 wallets manually

### Phase 2: Backfill Script (Day 1-2)

```typescript
// scripts/pnl/backfill-api-positions.ts

interface BackfillConfig {
  workers: number;           // 8
  batchSize: number;         // 100
  checkpoint: boolean;       // true
  startFrom?: string;        // Resume wallet
  onlyActive?: boolean;      // Only wallets with recent trades
}

async function backfillApiPositions(config: BackfillConfig) {
  // 1. Get wallet list from DB
  // 2. Split into worker queues
  // 3. Each worker:
  //    - Fetch /positions + /closed-positions
  //    - Insert to ClickHouse
  //    - Update checkpoint
  // 4. Handle rate limits with exponential backoff
  // 5. Log progress and errors
}
```

### Phase 3: Incremental Updates (Day 2-3)

- Cron job to update active wallets daily
- Webhook listener for real-time updates (if available)
- Priority queue for recently active wallets

### Phase 4: Validation (Day 3)

- Compare API values to DB calculations
- Identify systematic differences
- Document edge cases

## Estimated Timeline

| Phase | Duration | Wallets/Hour | Total Time |
|-------|----------|--------------|------------|
| Initial backfill | 1.6M wallets | ~10,000/hr | ~160 hours |
| With 8 workers | 1.6M wallets | ~50,000/hr | ~32 hours |
| Daily incremental | ~10K active | ~50,000/hr | ~12 min |

## Fallback: DB-Only Formula

For wallets not in API or for historical analysis:

```sql
-- Simplified CLOB formula (approximate, may have double-counting)
WITH trades AS (
  SELECT
    condition_id,
    outcome_index,
    SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
    SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
  FROM deduped_clob_trades
  WHERE trader_wallet = {wallet}
  GROUP BY condition_id, outcome_index
)
SELECT
  SUM(cash_flow + final_shares * resolution_price) as db_pnl
FROM trades t
LEFT JOIN pm_condition_resolutions r ON t.condition_id = r.condition_id
WHERE resolution_price IS NOT NULL
```

**Note:** This formula has known issues with mint+sell patterns. Use API values when available.

## Success Criteria

1. **Accuracy:** 95%+ of wallets within 5% of API values
2. **Coverage:** All 1.6M wallets with CLOB activity processed
3. **Performance:** Single wallet PnL query < 100ms
4. **Freshness:** Active wallets updated within 24 hours

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| API rate limits | Conservative limits, exponential backoff |
| API downtime | Graceful degradation to DB formula |
| Missing historical data | Accept limitation, document scope |
| Schema changes | Version API responses, handle gracefully |

## Next Steps

1. Review and approve this design
2. Create database table and view
3. Implement backfill script with all safety features
4. Run initial test batch (1000 wallets)
5. Scale to full backfill

---

*Claude 1 - Universal PnL Design*
