# ClickHouse Production Table Reference

Complete reference for Cascadian ClickHouse tables. Last updated: Feb 2026.

---

## Core Transaction Tables

### pm_canonical_fills_v4 (~1.19B rows)
**Purpose**: Master canonical fill records - all CLOB, CTF, and NegRisk fills unified
**Engine**: MergeTree
**Status**: PRIMARY - This is the source of truth for all trade data

**Key Columns**:
- `fill_id` - Unique fill identifier
- `wallet` - Trader wallet address (lowercase)
- `condition_id` - Market condition (64 hex chars, lowercase)
- `token_id` - Token identifier
- `side` - BUY or SELL
- `usdc_amount` - Amount in USDC (raw, divide by 1e6)
- `token_amount` - Token amount (raw, divide by 1e6)
- `fill_timestamp` - When the fill occurred
- `source` - Origin: 'clob', 'ctf', 'negrisk'
- `maker_address`, `taker_address` - For self-fill detection

**Critical Notes**:
- ALWAYS filter `source != 'negrisk'` for PnL calculations
- For self-fill dedup: exclude MAKER side when wallet is both maker AND taker
- Amounts are in raw units (divide by 1e6 for USDC/tokens)

**Common Queries**:
```sql
-- Wallet fills (with negrisk exclusion)
SELECT * FROM pm_canonical_fills_v4
WHERE wallet = lower('0x...') AND source != 'negrisk'
ORDER BY fill_timestamp DESC LIMIT 100

-- Daily volume
SELECT toDate(fill_timestamp) as dt, count() as fills, round(sum(usdc_amount)/1e6, 0) as volume_usd
FROM pm_canonical_fills_v4
WHERE fill_timestamp > now() - INTERVAL 7 DAY AND source != 'negrisk'
GROUP BY dt ORDER BY dt DESC
```

---

### pm_trade_fifo_roi_v3 (~283M rows)
**Purpose**: FIFO-calculated trades with PnL and ROI per position
**Engine**: SharedReplacingMergeTree
**Status**: ACTIVE - Primary source for PnL, ROI, win rates

**Key Columns**:
- `wallet` - Trader wallet address
- `condition_id` - Market condition
- `side` - LONG or SHORT
- `cost_basis_usd` - Total cost of position in USD
- `pnl_usd` - Realized P&L in USD
- `roi_pct` - Return on investment percentage
- `is_closed` - Whether position is closed (1) or open (0)
- `trade_time` - When trade occurred
- `order_id` - Order identifier

**IMPORTANT**: There is NO pm_trade_fifo_roi_v4 - v3 is current!

**Common Queries**:
```sql
-- Wallet performance summary
SELECT
  wallet,
  count() as positions,
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd < 0) as losses,
  round(wins / nullIf(wins + losses, 0) * 100, 1) as win_rate,
  round(sum(pnl_usd), 2) as total_pnl,
  round(sum(cost_basis_usd), 2) as total_invested
FROM pm_trade_fifo_roi_v3
WHERE wallet = lower('0x...')
GROUP BY wallet

-- Top wallets by PnL (last 30 days)
SELECT wallet, round(sum(pnl_usd), 0) as pnl, count() as trades
FROM pm_trade_fifo_roi_v3
WHERE trade_time > now() - INTERVAL 30 DAY AND cost_basis_usd >= 10
GROUP BY wallet
HAVING trades >= 20
ORDER BY pnl DESC LIMIT 50
```

---

### pm_condition_resolutions (~411k+ rows)
**Purpose**: Market resolution outcomes and payouts
**Engine**: MergeTree

**Key Columns**:
- `condition_id` - Market condition (normalize with IDN!)
- `winning_index` - Which outcome won (0-based, but array access needs +1)
- `payout_numerators` - Array of payout amounts per outcome
- `payout_denominator` - Denominator for payout calculation
- `resolved_at` - When market was resolved

**Critical**: Always use IDN normalization for joins:
```sql
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('INPUT', '0x', ''))
```

**Array access**: `arrayElement(payout_numerators, winning_index + 1)` (1-indexed!)

---

### pm_token_to_condition_map_v5 (~500k rows)
**Purpose**: Maps token IDs to condition IDs and outcome indices
**Refresh**: Rebuilt every 10 minutes by cron

**Key Columns**:
- `token_id` - ERC1155 token identifier
- `condition_id` - Market condition
- `outcome_index` - Which outcome this token represents
- `updated_at` - Last refresh timestamp

---

## Cache / Aggregation Tables

### pm_copy_trading_leaderboard (~20 rows)
**Purpose**: Cached top 20 robust traders
**Engine**: ReplacingMergeTree
**Refresh**: Every 3 hours

**Key Columns**: wallet, sim_roi_without_top3, win_rate, total_trades, total_pnl, updated_at

### pm_smart_money_cache (~100 rows)
**Purpose**: Top 100 wallets by category
**Engine**: ReplacingMergeTree
**Refresh**: Daily 8am UTC

**Categories**: TOP_PERFORMERS, COPY_WORTHY, SHORT_SPECIALISTS, DIRECTIONAL, MIXED, SPREAD_ARB

### pm_latest_mark_price_v1
**Purpose**: Current mark prices for unrealized PnL
**Refresh**: Every 15 minutes

### pm_wallet_position_fact_v1
**Purpose**: Current open positions per wallet
**Refresh**: Every 10+ minutes

### whale_leaderboard (~50 rows)
**Purpose**: Top 50 by lifetime PnL (legacy)

---

## Event / Source Tables

### pm_trader_events_v2 (LEGACY - HAS DUPLICATES!)
**WARNING**: Contains 2-3x duplicates per wallet. ALWAYS use GROUP BY event_id:
```sql
SELECT ... FROM (
  SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
         any(token_amount)/1e6 as tokens, any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE trader_wallet = '0x...' AND is_deleted = 0
  GROUP BY event_id
) ...
```

### pm_trader_events_v3
**Purpose**: Newer CLOB event stream (actively ingested)

### pm_ctf_split_merge_expanded
**Purpose**: CTF token split/merge operations (shares only, NOT cash)

### vw_negrisk_conversions
**Purpose**: NegRisk adapter transfers (excluded from PnL calculations)

---

## Support / System Tables

### pm_ingest_watermarks_v1
**Purpose**: Cron progress tracking (last_run_at, rows_processed, status)

### pm_sync_state_v1
**Purpose**: Data sync status monitoring

### pm_price_snapshots_15m
**Purpose**: 15-minute OHLC price data

---

## WIO System Tables (Partially Failing)

| Table | Purpose | Status |
|-------|---------|--------|
| wio_positions_v1 | Position tracking | Memory issues (#11) |
| wio_wallet_metrics_v1 | Wallet metrics | Missing column (#15) |
| wio_wallet_scores_v1 | Wallet scoring | Active |
| wio_dot_events_v1 | Dot event history | Active |

---

## Table Discovery

```sql
-- List all tables
SHOW TABLES FROM default

-- Search for table by name pattern
SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size
FROM system.tables WHERE database = 'default' AND name LIKE '%pattern%'

-- Get table schema
DESCRIBE TABLE table_name

-- Search for column across tables
SELECT table, name, type FROM system.columns
WHERE database = 'default' AND name LIKE '%condition%'

-- Table sizes
SELECT name, total_rows, formatReadableSize(total_bytes) as size
FROM system.tables WHERE database = 'default'
ORDER BY total_bytes DESC LIMIT 20
```

---

## DEPRECATED Table Names (DO NOT USE)

These table names appear in old code but DO NOT exist:

| Old Name | Use Instead |
|----------|-------------|
| trades_raw | pm_canonical_fills_v4 |
| wallet_metrics_daily | pm_trade_fifo_roi_v3 (aggregate) |
| market_resolutions | pm_condition_resolutions |
| wallet_positions | pm_wallet_position_fact_v1 |
| fact_pnl | pm_trade_fifo_roi_v3 (derive PnL) |
| pm_trade_fifo_roi_v4 | pm_trade_fifo_roi_v3 (v4 doesn't exist!) |
