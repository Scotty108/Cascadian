# ClickHouse Database - Quick Reference Card

## Database Schema at a Glance

### Core Tables

| Table | Rows | Purpose | Key Fields |
|-------|------|---------|-----------|
| `pm_trades` | CLOB fills | Order book matches from API | maker_address, taker_address, market_id, side, price |
| `trades_raw` | All trades | Portfolio aggregation | wallet_address, market_id, side, shares, pnl |
| `pm_erc1155_flats` | ERC1155 events | Token transfers on-chain | from_address, to_address, token_id, amount |
| `pm_user_proxy_wallets` | Mappings | EOA to proxy wallets | user_eoa, proxy_wallet, is_active |
| `ctf_token_map` | Token metadata | token_id to market mapping | token_id, market_id, outcome_index, outcome |
| `condition_market_map` | Market cache | market_id to condition_id | market_id, condition_id, canonical_category |
| `wallet_resolution_outcomes` | Outcomes | Accuracy tracking per wallet | wallet_address, market_id, won |
| `wallet_metrics_complete` | 102 metrics | Performance analytics | metric_1...metric_102, window (30d/90d/180d/lifetime) |

### Views (P&L Chain)

| View | Input | Output | Purpose |
|------|-------|--------|---------|
| `trade_flows_v2` | trades_raw | cashflow, delta_shares per fill | Compute signed cashflows |
| `canonical_condition` | ctf_token_map + condition_market_map | market_id → condition_id | Bridge markets to conditions |
| `winning_index` | market_resolutions + market_outcomes | condition_id → win_idx | Identify winning outcomes |
| `realized_pnl_by_market_v2` | trade_flows_v2 + canonical_condition + winning_index | realized_pnl per wallet per market | Apply settlement rules |
| `wallet_realized_pnl_v2` | realized_pnl_by_market_v2 | total realized_pnl per wallet | Aggregate across markets |
| `wallet_pnl_summary_v2` | wallet_realized_pnl_v2 + wallet_unrealized_pnl_v2 | total_pnl (realized + unrealized) | Complete P&L picture |

### Enrichment Views

| View | Purpose | Joins |
|------|---------|-------|
| `markets_enriched` | Market + resolution data | gamma_markets + market_resolutions_final |
| `token_market_enriched` | Token + market + winner | ctf_token_map + markets_enriched |
| `proxy_wallets_active` | Active proxy mappings | pm_user_proxy_wallets WHERE is_active=1 |
| `erc1155_transfers_enriched` | Transfers + markets + proxy info | pm_erc1155_flats + token_market_enriched + proxy_wallets |
| `wallet_positions_current` | Current token holdings | erc1155_transfers_enriched grouped |

---

## Essential Queries

### Find proxy wallets for an EOA

```sql
SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets 
WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
  AND is_active = 1;
```

### Get P&L summary for a wallet

```sql
SELECT 
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');
```

### Get market-level P&L breakdown

```sql
SELECT
  wallet,
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
ORDER BY resolved_at DESC
LIMIT 50;
```

### Find all trades for a wallet (via proxy)

```sql
WITH proxy_list AS (
  SELECT proxy_wallet FROM pm_user_proxy_wallets 
  WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
)
SELECT *
FROM pm_trades
WHERE lower(maker_address) IN (SELECT proxy_wallet FROM proxy_list)
   OR lower(taker_address) IN (SELECT proxy_wallet FROM proxy_list)
ORDER BY timestamp DESC
LIMIT 100;
```

### Check data completeness

```sql
SELECT
  'Markets in trades_raw' as metric,
  COUNT(DISTINCT market_id) as value
FROM trades_raw
UNION ALL
SELECT 'Markets bridged (have condition_id)',
  COUNT(DISTINCT cc.market_id)
FROM trades_raw tr
LEFT JOIN canonical_condition cc ON tr.market_id = cc.market_id
WHERE cc.market_id IS NOT NULL
UNION ALL
SELECT 'Markets resolvable (have winner)',
  COUNT(DISTINCT wi.condition_id_norm)
FROM trades_raw tr
LEFT JOIN canonical_condition cc ON tr.market_id = cc.market_id
LEFT JOIN winning_index wi ON cc.condition_id_norm = wi.condition_id_norm
WHERE wi.win_idx IS NOT NULL;
```

### Get all metrics for a wallet

```sql
SELECT * FROM wallet_metrics_complete
WHERE lower(wallet_address) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
  AND window = 'lifetime'
ORDER BY calculated_at DESC
LIMIT 1;
```

### Find top wallets by P&L

```sql
SELECT 
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE total_pnl_usd IS NOT NULL
ORDER BY total_pnl_usd DESC
LIMIT 100;
```

---

## Data Type Reference

### Common Address Fields
- All stored **lowercase** (lowercase hex with 0x prefix)
- Use `lower()` function in WHERE clauses
- Some compare without prefix using `replaceAll(..., '0x', '')`

### Common Numeric Fields

**Prices (probability 0-1):**
- pm_trades: `Float64`
- trades_raw: `Decimal(18, 8)`

**Shares/Size:**
- trades_raw: `Decimal(18, 8)`
- pm_trades: `String` (parse to number when needed)

**P&L / USD Values:**
- `Decimal(18, 2)` for precise storage
- `Float64` for aggregations

**Timestamps:**
- `DateTime` for block_time, timestamps, created_at
- ISO string for end dates

### Enums

**Side in trades_raw:**
- 1 = YES (long)
- 2 = NO (short)

**Side in pm_trades:**
- "BUY" / "SELL" (string, lowercase in data)

---

## Join Patterns

### Pattern 1: Wallet to Trades (Legacy)
```sql
trades_raw
  ├─ wallet_address (may be EOA or proxy)
  └─ market_id
```

### Pattern 2: Wallet to Trades (CLOB)
```sql
pm_trades
  ├─ maker_address → pm_user_proxy_wallets.proxy_wallet → user_eoa
  └─ taker_address → pm_user_proxy_wallets.proxy_wallet → user_eoa
```

### Pattern 3: Token to Market
```sql
pm_erc1155_flats
  └─ token_id → ctf_token_map.token_id
      └─ market_id → condition_market_map.market_id
          └─ condition_id → market_resolutions_final
```

### Pattern 4: Market to Resolution
```sql
trades_raw
  └─ market_id → canonical_condition.market_id
      └─ condition_id_norm → winning_index
          └─ win_idx (outcome index)
```

### Pattern 5: Proxy Attribution
```sql
pm_trades.maker_address → pm_user_proxy_wallets.proxy_wallet
  ├─ user_eoa (the actual user)
  ├─ first_seen_at (when this mapping was discovered)
  └─ source ('onchain', 'erc1155_transfers', etc.)
```

---

## Performance Tips

### Indexes Available
- `idx_pm_trades_maker` - bloom filter on maker_address
- `idx_pm_trades_taker` - bloom filter on taker_address
- `idx_ctf_token_map_condition` - bloom filter on condition_id_norm
- `idx_ctf_token_map_market` - bloom filter on market_id
- `idx_condition_market_map_condition` - bloom filter on condition_id
- `idx_condition_market_map_market` - bloom filter on market_id
- `idx_events_dim_category` - bloom filter on canonical_category

### Query Optimization
1. Use WHERE on primary key columns (wallet_address in trades_raw)
2. Bloom filters help with address lookups but aren't as fast as B-tree
3. Views cache joins - prefer views to manual joins
4. ReplacingMergeTree tables may need FINAL to get latest version (slow)
5. Partition pruning works with timestamp ranges

### Partition Keys
- trades_raw: PARTITION BY toYYYYMM(timestamp)
- pm_trades: PARTITION BY toYYYYMM(timestamp)
- pm_erc1155_flats: PARTITION BY toYYYYMM(block_time)

Use date ranges in WHERE to prune partitions.

---

## P&L Calculation Deep Dive

### Settlement Rule 1: Signed Cashflow

**Buy Trade:**
- User pays entry_price per share
- Formula: `-(entry_price * shares) - (fees)`
- Result: Negative value (outflow)

**Sell Trade:**
- User receives entry_price per share
- Formula: `+(entry_price * shares) - (fees)`
- Result: Positive value (inflow)

### Settlement Rule 2: Market Payout

**If buying YES (outcome wins):**
- Holds shares of winning token
- Gets $1 per share at settlement
- Payout: `1.0 * shares`

**If selling NO (outcome loses):**
- Shorted the losing outcome
- Gets $1 per share for losing outcome short
- Payout: `1.0 * shares`

**Losing position:**
- Gets $0 payout

### Settlement Rule 3: Realized P&L (Side-Dependent!)

**Long position:**
- Won: `realized_pnl = settlement - cashflow`
- Lost: `realized_pnl = cashflow` (negative)

**Short position:**
- Won: `realized_pnl = settlement + cashflow` (both positive)
- Lost: `realized_pnl = -cashflow` (negate the premium)

**Why different?**
- Long: Cashflow is cost (negative), so subtract from payout
- Short: Cashflow is premium (positive) received upfront
  - Win: Keep premium + get payout
  - Loss: Lose the premium (negate it)

---

## External Data Sources (Not Fully Ingested)

These tables are referenced but may come from external APIs:

| Table | Source | Used For |
|-------|--------|----------|
| `gamma_markets` | Polymarket API | Market metadata (questions, outcomes, tags) |
| `market_resolutions_final` | External API or manual feed | Market winners after resolution |
| `erc1155_transfers` | Blockchain (original events) | Raw ERC1155 logs (before flattening) |
| `market_outcomes` | Derived from gamma_markets | Outcome arrays and indices |

Views that depend on these may fail if external data isn't available.

---

## Database Snapshot Info

**Location:** ClickHouse Cloud (GCP)
**Host:** igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
**Client:** /Users/scotty/Projects/Cascadian-app/lib/clickhouse/client.ts

**Environment variables needed:**
- CLICKHOUSE_HOST
- CLICKHOUSE_USER (default: 'default')
- CLICKHOUSE_PASSWORD
- CLICKHOUSE_DATABASE (default: 'default')
- CLICKHOUSE_REQUEST_TIMEOUT_MS (default: 180000)

---

## Document References

- **Full Schema Details:** CLICKHOUSE_EXPLORATION.md
- **Settlement Rules:** scripts/settlement-rules.sql
- **P&L Views:** scripts/realized-pnl-corrected.sql
- **Migrations:** migrations/clickhouse/*.sql
- **Data Scripts:**
  - build-approval-proxies.ts - Creates pm_user_proxy_wallets
  - flatten-erc1155.ts - Creates pm_erc1155_flats
  - ingest-clob-fills.ts - Populates pm_trades

