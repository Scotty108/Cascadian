# PnL Jobs Documentation

## Overview

This document describes all scheduled jobs related to PnL computation and wallet analytics in the Cascadian system.

## Scheduled Jobs (Vercel Crons)

### Data Pipeline Jobs

| Job | Path | Schedule | Purpose | Writes To |
|-----|------|----------|---------|-----------|
| **sync-clob-dedup** | `/api/cron/sync-clob-dedup` | Every 30 min | Sync new CLOB trades from Goldsky | `pm_trader_events_v2` |
| **heal-clob-dedup** | `/api/cron/heal-clob-dedup` | Every 6 hours | Fix duplicate CLOB entries | `pm_trader_events_v2` |
| **backfill-clob-dedup** | `/api/cron/backfill-clob-dedup` | Every 12 hours | Backfill missing historical data | `pm_trader_events_v2` |
| **sync-metadata** | `/api/cron/sync-metadata` | Every 10 min | Sync market metadata from Polymarket | `pm_markets_metadata` |
| **rebuild-token-map** | `/api/cron/rebuild-token-map` | Every 6 hours | Rebuild token_id -> condition_id mapping | `pm_token_map_v5` |

### Analytics Jobs

| Job | Path | Schedule | Purpose | Writes To |
|-----|------|----------|---------|-----------|
| **refresh-wallets** | `/api/cron/refresh-wallets` | Every 30 min | Update wallet activity stats | `pm_wallet_stats` |
| **refresh-category-analytics** | `/api/cron/refresh-category-analytics` | Every 15 min | Category leaderboard stats | `pm_category_analytics` |
| **sync-wallet-stats** | `/api/cron/sync-wallet-stats` | Every 30 min | Wallet-level statistics | `pm_wallet_stats_v2` |
| **sync-position-fact** | `/api/cron/sync-position-fact` | Every 15 min | Position tracking | `pm_position_fact` |

### Strategy Execution Jobs

| Job | Path | Schedule | Purpose | Writes To |
|-----|------|----------|---------|-----------|
| **strategy-executor** | `/api/cron/strategy-executor` | Every 10 min | Execute active strategies | `strategy_executions` |
| **wallet-monitor** | `/api/cron/wallet-monitor` | Every 5 min | Monitor copied wallets | `wallet_alerts` |

## SCHEDULED (Vercel Crons)

### PnL Engine Batch Computation

**API Route:** `/api/cron/refresh-pnl-cache`
**Script:** `scripts/pnl/batch-compute-engine-pnl.ts` (manual equivalent)

**Status:** SCHEDULED - Daily at 3am UTC
**Vercel config:** `vercel.json` line 3-6

**Purpose:** Compute cost-basis PnL for all active wallets using the V17 engine formula.

**Run with:**
```bash
# Full run (all wallets with <=50k trades)
npx tsx scripts/pnl/batch-compute-engine-pnl.ts

# Sample run for testing
npx tsx scripts/pnl/batch-compute-engine-pnl.ts --sample=1000

# Skip whale wallets with more than 30k trades
npx tsx scripts/pnl/batch-compute-engine-pnl.ts --maxTrades=30000
```

**Writes to:** `pm_wallet_engine_pnl_cache`

**Columns written:**
- `wallet` - Wallet address
- `engine_pnl` - Total PnL (realized + unrealized)
- `realized_pnl` - Closed position PnL
- `unrealized_pnl` - Open position PnL (resolved markets only)
- `trade_count` - Number of maker trades (engine only processes maker)
- `position_count` - Number of positions
- `external_sells` - USDC from selling externally-acquired tokens
- `external_sells_ratio` - external_sells / total_sells (0-1)
- `open_exposure_ratio` - unresolved_cost / abs(engine_pnl)
- `taker_ratio` - taker_trades / total_trades (0-1) - detects non-replicable PnL
- `profit_factor` - sum(wins) / sum(losses)
- `computed_at` - Timestamp

**Recommended scheduling:** Run nightly during low-traffic hours (e.g., 3am UTC)

### Export Generation

**API Route:** `/api/cron/generate-export`
**Script:** `scripts/pnl/export-high-confidence-winners.ts` (manual equivalent)

**Status:** SCHEDULED - Daily at 4am UTC (runs after cache refresh)
**Vercel config:** `vercel.json` line 7-10

**Purpose:** Generate CSV export of high-confidence realized winners.

**Writes to:** `exports/high_confidence_realized_winners_YYYYMMDD.csv`

### PnL Validation Harness

**Script:** `scripts/pnl/spotcheck-cache-vs-ui.ts`

**Status:** NOT SCHEDULED - Run manually for validation

**Purpose:** Compare engine PnL with UI values using stratified sampling.

**Run with:**
```bash
npx tsx scripts/pnl/spotcheck-cache-vs-ui.ts
```

**Writes to:**
- `tmp/spotcheck_cache_vs_ui_YYYYMMDD.json` - Raw validation data
- `tmp/spotcheck_cache_vs_ui_YYYYMMDD.summary.md` - Analysis report

## Export Criteria

### High-Confidence Realized Winners

Wallets suitable for copy-trading export must satisfy ALL:

1. `external_sells_ratio <= 0.05` - Minimal external token activity
2. `open_exposure_ratio <= 0.25` - Mostly resolved positions
3. `taker_ratio <= 0.15` - Primarily maker trades (replicable via copy-trading)
4. `trade_count >= 50` - Sufficient trading history
5. `realized_pnl > 0` - Actually profitable on closed positions

**Why taker_ratio matters:** Wallets with high taker activity (>15%) have PnL from trades that can't be replicated via copy-trading. Our engine only processes maker trades, so high-taker wallets will show systematic engine underestimation vs UI (e.g., 0x006cc has 25% taker ratio → 32% gap).

Query to get export-ready wallets:
```sql
SELECT
  wallet,
  realized_pnl,
  external_sells_ratio,
  open_exposure_ratio,
  taker_ratio,
  trade_count,
  profit_factor
FROM pm_wallet_engine_pnl_cache FINAL
WHERE external_sells_ratio <= 0.05
  AND open_exposure_ratio <= 0.25
  AND taker_ratio <= 0.15
  AND trade_count >= 50
  AND realized_pnl > 0
ORDER BY realized_pnl DESC
LIMIT 100
```

## Recommended Schedule Implementation

To add the PnL batch job to Vercel crons, add to `vercel.json`:

```json
{
  "path": "/api/cron/refresh-pnl-cache",
  "schedule": "0 3 * * *"
}
```

Then create the API route at `app/api/cron/refresh-pnl-cache/route.ts` that:
1. Calls the batch computation logic
2. Uses --maxTrades=50000 to skip whales
3. Logs completion/errors to monitoring

## Monitoring

### Cache Freshness Check
```sql
SELECT
  count() as cached_wallets,
  max(computed_at) as latest_computation,
  dateDiff('hour', max(computed_at), now()) as hours_stale
FROM pm_wallet_engine_pnl_cache FINAL
```

### High-Confidence Pool Size
```sql
SELECT count() as export_ready_wallets
FROM pm_wallet_engine_pnl_cache FINAL
WHERE external_sells_ratio <= 0.05
  AND open_exposure_ratio <= 0.25
  AND trade_count >= 50
  AND realized_pnl > 0
```
