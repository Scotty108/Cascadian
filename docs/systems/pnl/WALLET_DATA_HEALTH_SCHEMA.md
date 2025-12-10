# WALLET DATA HEALTH SCHEMA
**Date:** 2025-12-06
**Terminal:** Claude Terminal 2 (Data Health & Engine Safety)
**Status:** Specification - Not Yet Implemented

## Overview

Defines a compact schema for capturing wallet-level data quality metrics. This schema supports:
- Pre-flight data quality checks before PnL calculations
- Automated detection of DATA_SUSPECT wallets
- Debugging discrepancies between engines
- Benchmark tagging and filtering

---

## Schema Definition

### Table: `pm_wallet_data_health` (Proposed)

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_data_health (
  wallet_address FixedString(42),
  snapshot_date Date,

  -- CLOB Event Metrics
  clob_raw_rows UInt64,             -- Total rows in pm_trader_events_v2 (with duplicates)
  clob_unique_events UInt64,        -- Unique event_ids after GROUP BY dedup
  clob_duplication_factor Float32,  -- raw_rows / unique_events (ideal: 1.0)

  -- Unified Ledger Metrics
  unified_v8_view_rows UInt64,      -- pm_unified_ledger_v8 row count
  unified_v8_tbl_rows UInt64,       -- pm_unified_ledger_v8_tbl row count
  v8_row_gap Int64,                 -- view_rows - tbl_rows (ideal: 0)
  v8_gap_pct Float32,               -- (row_gap / tbl_rows) * 100

  -- ERC1155 Transfer Metrics
  erc1155_transfer_count UInt64,    -- Total on-chain transfers for wallet
  erc1155_unique_tokens UInt64,     -- Distinct token_ids in transfers

  -- Position Anomaly Detection
  negative_position_count UInt64,   -- Positions with negative inventory
  negative_position_value Float64,  -- Sum of |negative_inventory| * price

  -- Activity Profile
  first_trade_time DateTime64(3),   -- Earliest trade timestamp
  last_trade_time DateTime64(3),    -- Most recent trade timestamp
  active_days UInt32,               -- Days between first and last trade

  -- Data Quality Tags
  tag_hint String,                  -- TRADER_STRICT | MIXED | MAKER_HEAVY | DATA_SUSPECT

  -- Metadata
  computed_at DateTime64(3)
) ENGINE = ReplacingMergeTree(computed_at)
PRIMARY KEY (wallet_address, snapshot_date)
ORDER BY (wallet_address, snapshot_date);
```

---

## Field Definitions

### CLOB Event Metrics

#### `clob_raw_rows`
**Definition:** Total row count in `pm_trader_events_v2` for this wallet (includes duplicates).

**Query:**
```sql
SELECT COUNT(*) FROM pm_trader_events_v2
WHERE trader_wallet = {wallet} AND is_deleted = 0;
```

**Interpretation:**
- High count (>10k) suggests active trader
- Compare to `clob_unique_events` to detect duplication

#### `clob_unique_events`
**Definition:** Count of unique `event_id` values after deduplication.

**Query:**
```sql
SELECT COUNT(DISTINCT event_id) FROM pm_trader_events_v2
WHERE trader_wallet = {wallet} AND is_deleted = 0;
```

**Interpretation:**
- True trade count (after dedup)
- Should match or exceed `unified_v8_view_rows` (which includes CLOB + ERC1155)

#### `clob_duplication_factor`
**Definition:** Ratio of raw rows to unique events.

**Formula:**
```
clob_duplication_factor = clob_raw_rows / clob_unique_events
```

**Interpretation:**
- `1.0` = No duplication (ideal, rare)
- `2.0 - 3.0` = Expected range due to historical backfill overlaps
- `> 3.0` = Abnormal, investigate for data corruption

**Alert Threshold:** `> 3.5`

---

### Unified Ledger Metrics

#### `unified_v8_view_rows`
**Definition:** Row count from `pm_unified_ledger_v8` view (computed on demand).

**Query:**
```sql
SELECT COUNT(*) FROM pm_unified_ledger_v8
WHERE wallet_address = {wallet};
```

#### `unified_v8_tbl_rows`
**Definition:** Row count from `pm_unified_ledger_v8_tbl` materialized table (snapshot).

**Query:**
```sql
SELECT COUNT(*) FROM pm_unified_ledger_v8_tbl
WHERE wallet_address = {wallet};
```

#### `v8_row_gap`
**Definition:** Difference between view and table row counts.

**Formula:**
```
v8_row_gap = unified_v8_view_rows - unified_v8_tbl_rows
```

**Interpretation:**
- `0` = Table is current (ideal)
- `> 0` = Table is stale, missing recent events
- `< 0` = Table has extra rows, possible corruption (rare)

**Alert Thresholds:**
- `|gap| > 100` rows = Warning
- `|gap| > 500` rows = Critical

#### `v8_gap_pct`
**Definition:** Gap as percentage of table rows.

**Formula:**
```
v8_gap_pct = (v8_row_gap / unified_v8_tbl_rows) * 100
```

**Alert Thresholds:**
- `> 1.0%` = Warning (table may be stale)
- `> 5.0%` = Critical (tag as DATA_SUSPECT)

---

### ERC1155 Transfer Metrics

#### `erc1155_transfer_count`
**Definition:** Total on-chain ERC1155 transfer events for this wallet.

**Query:**
```sql
SELECT COUNT(*) FROM pm_erc1155_transfers
WHERE from_address = {wallet} OR to_address = {wallet};
```

**Interpretation:**
- High count suggests on-chain activity (minting, burning, P2P transfers)
- Low count (<100) suggests CLOB-only trader
- Zero count + high CLOB activity = TRADER_STRICT candidate

#### `erc1155_unique_tokens`
**Definition:** Distinct token_ids in ERC1155 transfers.

**Query:**
```sql
SELECT COUNT(DISTINCT token_id) FROM pm_erc1155_transfers
WHERE from_address = {wallet} OR to_address = {wallet};
```

**Interpretation:**
- Proxy for "number of markets traded" (2 tokens per binary market)
- High diversity (>1000) suggests broad market coverage

---

### Position Anomaly Detection

#### `negative_position_count`
**Definition:** Number of positions with negative inventory (sell before buy).

**Query:**
```sql
SELECT COUNT(*) FROM pm_wallet_positions
WHERE wallet_address = {wallet}
  AND current_shares < 0;
```

**Interpretation:**
- `0` = Normal (ideal)
- `> 0` = Possible data issues (missing buys, incorrect side attribution)
- High count = Tag as DATA_SUSPECT

**Note:** Negative positions can be legitimate (short selling via proxy contracts), but are rare in Polymarket.

#### `negative_position_value`
**Definition:** Total value of negative inventory at current prices.

**Query:**
```sql
SELECT SUM(ABS(current_shares) * current_price) FROM pm_wallet_positions
WHERE wallet_address = {wallet}
  AND current_shares < 0;
```

**Interpretation:**
- Magnitude of the anomaly
- Large values (>$1000) suggest significant data quality issue

---

### Activity Profile

#### `first_trade_time` / `last_trade_time`
**Definition:** Timestamp of earliest and most recent trade.

**Query:**
```sql
SELECT
  MIN(trade_time) as first_trade,
  MAX(trade_time) as last_trade
FROM pm_trader_events_v2
WHERE trader_wallet = {wallet} AND is_deleted = 0;
```

**Interpretation:**
- Defines wallet's active trading window
- Use for filtering stale wallets from benchmarks

#### `active_days`
**Definition:** Number of days between first and last trade.

**Formula:**
```
active_days = dateDiff('day', first_trade_time, last_trade_time)
```

**Interpretation:**
- Long-term traders: `> 365 days`
- Short-term traders: `< 30 days`
- Single-day traders: `= 0`

---

### Data Quality Tags

#### `tag_hint`
**Definition:** Pre-computed tag for wallet classification.

**Values:**
- `TRADER_STRICT` = CLOB-only, no/minimal ERC1155 activity
- `MIXED` = Balanced CLOB + ERC1155 activity
- `MAKER_HEAVY` = Mostly ERC1155 (liquidity provider, market maker)
- `DATA_SUSPECT` = Anomalies detected (high duplication, negative positions, large gaps)

**Derivation Logic:**
```typescript
function computeTagHint(health: WalletHealthRow): string {
  // Check for data quality issues first
  if (
    health.clob_duplication_factor > 3.5 ||
    health.v8_gap_pct > 5.0 ||
    health.negative_position_count > 10
  ) {
    return 'DATA_SUSPECT';
  }

  // Classify by activity type
  const clobRatio = health.clob_unique_events / (health.clob_unique_events + health.erc1155_transfer_count);

  if (clobRatio > 0.95) return 'TRADER_STRICT';
  if (clobRatio < 0.30) return 'MAKER_HEAVY';
  return 'MIXED';
}
```

---

## Usage Examples

### 1. Pre-Flight Check Before PnL Calculation

```typescript
async function runPnLWithHealthCheck(wallet: string) {
  const health = await getWalletHealth(wallet);

  if (health.tag_hint === 'DATA_SUSPECT') {
    console.warn(`⚠️ Wallet ${wallet} flagged as DATA_SUSPECT`);
    console.warn(`  - Duplication factor: ${health.clob_duplication_factor}`);
    console.warn(`  - V8 gap: ${health.v8_gap_pct}%`);
    console.warn(`  - Negative positions: ${health.negative_position_count}`);

    // Proceed with caution or skip
    return { error: 'DATA_SUSPECT', health };
  }

  // Run PnL calculation
  return await calculatePnL(wallet);
}
```

### 2. Filter Benchmarks by Health

```sql
-- Get only high-quality wallets for regression testing
SELECT wallet_address
FROM pm_wallet_data_health
WHERE snapshot_date = today()
  AND tag_hint IN ('TRADER_STRICT', 'MIXED')
  AND clob_duplication_factor < 3.0
  AND v8_gap_pct < 1.0
  AND negative_position_count = 0
ORDER BY clob_unique_events DESC
LIMIT 50;
```

### 3. Detect Stale Materialized Tables

```sql
-- Find wallets with significant V8 table staleness
SELECT
  wallet_address,
  unified_v8_view_rows,
  unified_v8_tbl_rows,
  v8_row_gap,
  v8_gap_pct
FROM pm_wallet_data_health
WHERE snapshot_date = today()
  AND v8_gap_pct > 1.0
ORDER BY v8_gap_pct DESC;
```

### 4. Anomaly Report

```sql
-- Daily anomaly report for data team
SELECT
  tag_hint,
  COUNT(*) as wallet_count,
  AVG(clob_duplication_factor) as avg_dup_factor,
  AVG(v8_gap_pct) as avg_gap_pct,
  SUM(negative_position_count) as total_neg_positions
FROM pm_wallet_data_health
WHERE snapshot_date = today()
GROUP BY tag_hint
ORDER BY tag_hint;
```

---

## Implementation Plan

### Phase 1: Core Metrics (Week 1)
1. Create script `scripts/pnl/compute-wallet-health.ts`
2. Implement field calculations for:
   - CLOB metrics (raw rows, unique events, duplication factor)
   - Unified ledger metrics (view/table rows, gaps)
3. Insert results into `pm_wallet_data_health` table

### Phase 2: Anomaly Detection (Week 2)
1. Add ERC1155 metrics
2. Implement negative position detection
3. Build `tag_hint` classification logic

### Phase 3: Automation (Week 3)
1. Create daily cron job to refresh health metrics
2. Add alerting for DATA_SUSPECT wallets
3. Integrate health checks into PnL calculation workflow

### Phase 4: UI Integration (Week 4)
1. Add health status badge to wallet dashboard
2. Create data quality report page
3. Filter benchmarks by health tags

---

## Performance Considerations

### Batch Processing
- Compute health for 1000s of wallets: ~5-10 minutes
- Use parallel queries (8 workers) for scalability
- Cache results in table, refresh daily

### Query Optimization
- Index `pm_trader_events_v2.trader_wallet` for fast filtering
- Pre-aggregate `pm_wallet_positions` for instant negative position checks
- Use materialized views for expensive joins

### Storage
- ~200 bytes per wallet per snapshot
- Daily snapshots for 10,000 wallets = ~2MB/day = ~730MB/year
- Negligible compared to raw event tables

---

## Related Documentation

**Data Quality:**
- [PM_TRADER_EVENTS_DEDUP_AUDIT_2025_12_06.md](../../reports/PM_TRADER_EVENTS_DEDUP_AUDIT_2025_12_06.md)
- [UNIFIED_LEDGER_V8_HEALTH_2025_12_06.md](../../reports/UNIFIED_LEDGER_V8_HEALTH_2025_12_06.md)

**PnL Engine:**
- [PNL_DISCREPANCY_RESEARCH_2025_12_06.md](../../reports/PNL_DISCREPANCY_RESEARCH_2025_12_06.md)
- [HEAD_TO_HEAD_V23C_V29_2025_12_06.md](../../reports/HEAD_TO_HEAD_V23C_V29_2025_12_06.md)

**Database:**
- [STABLE_PACK_REFERENCE.md](../database/STABLE_PACK_REFERENCE.md)
- [TABLE_RELATIONSHIPS.md](../database/TABLE_RELATIONSHIPS.md)

---

**Terminal:** Claude Terminal 2
**Status:** Specification complete. Ready for implementation by Main Terminal or Database Architect.
