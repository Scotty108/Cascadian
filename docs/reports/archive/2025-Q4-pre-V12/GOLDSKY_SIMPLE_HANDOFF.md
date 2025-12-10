# Cascadian Data Summary for GoldSky

**Date:** December 1, 2025
**Contact:** Roddick support thread

---

## What We're Building

We want to calculate Profit & Loss (PnL) for all Polymarket wallets. The goal is to build an analytics engine that can calculate per wallet metrics by category.

---

## Data We Pull From GoldSky

### 1. Order Book Trades
- **Source:** `polymarket.order_filled` dataset
- **Events:** 787 million
- **What it gives us:** Every buy/sell on the order book

### 2. CTF Contract Events
- **Source:** `matic.raw_logs`
- **Contract:** `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`
- **Events we capture:**
  - `PositionSplit` (78M) - users creating positions
  - `PositionsMerge` (20M) - users closing positions
  - `PayoutRedemption` (20M) - users cashing out winnings
  - `ConditionResolution` (198K) - markets resolving

### 3. AMM Trades (older markets)
- **Source:** `matic.raw_logs`
- **Events:** `FPMMBuy` and `FPMMSell` (4.4M total)

### 4. Token Mapping
- **Source:** Gamma API (`https://gamma-api.polymarket.com`)
- **Purpose:** Maps token IDs to market condition IDs

---

## Our Database Tables

| Table | Rows | Source |
|-------|------|--------|
| `pm_trader_events_v2` | 787M | GoldSky: polymarket.order_filled |
| `pm_ctf_events` | 118M | GoldSky: matic.raw_logs |
| `pm_fpmm_trades` | 4.4M | GoldSky: matic.raw_logs |
| `pm_condition_resolutions` | 198K | GoldSky: matic.raw_logs |
| `pm_token_to_condition_map_v3` | 358K | Gamma API |

---

## GoldSky Pipeline Configurations

### Pipeline 1: CLOB Fills (`cascadian-hard-pipe-v3`)

**Source:** `polymarket.order_filled` v1.1.0
**Target:** `pm_trader_events_v2`

```yaml
sources:
  polymarket_orders:
    dataset_name: polymarket.order_filled
    version: 1.1.0
    type: dataset

transforms:
  fills_enriched:
    sql: |-
      -- Maker side
      SELECT
        `id` || '-m' AS event_id,
        `maker` AS trader_wallet,
        CASE WHEN `maker_asset_id` = '0' THEN 'buy' ELSE 'sell' END AS side,
        CASE WHEN `maker_asset_id` = '0' THEN `taker_asset_id` ELSE `maker_asset_id` END AS token_id,
        CASE WHEN `maker_asset_id` = '0' THEN `maker_amount_filled` ELSE `taker_amount_filled` END AS usdc_amount,
        CASE WHEN `maker_asset_id` = '0' THEN `taker_amount_filled` ELSE `maker_amount_filled` END AS token_amount,
        TO_TIMESTAMP(FROM_UNIXTIME(`timestamp`)) AS trade_time
      FROM polymarket_orders

      UNION ALL

      -- Taker side (same logic, swapped)
      ...

sinks:
  clickhouse_fills_v2:
    type: clickhouse
    table: pm_trader_events_v2
```

### Pipeline 2: CTF Events + Resolutions (`conditionresolutions-final2`)

**Source:** `matic.raw_logs` filtered for CTF contract
**Target:** `pm_ctf_events` AND `pm_condition_resolutions`

```yaml
sources:
  matic_raw_logs:
    dataset_name: matic.raw_logs
    version: 1.0.0
    filter: >-
      address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045' and (
        topics like '0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177%' or
        topics like '0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894%' or
        topics like '0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d%'
      )
```

### All Topic Signatures We Capture

| Event | Topic Signature |
|-------|-----------------|
| PositionSplit | `0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298` |
| PositionsMerge | `0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca` |
| PayoutRedemption | `0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d` |
| ConditionResolution | `0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894` |
| FPMMBuy | `0x4f62630f51608fc8a7603a9391a5101e58bd7c276139366fc107dc3b67c3dcf8` |
| FPMMSell | `0xadcf2a240ed9300d681d9a3f5382b6c1beed1b7e46643e0c7b42cbe6e2d766b4` |

---

## How We Calculate PnL

We use **Average Cost Basis** accounting:

**On BUY:**
```
position_cost += usdc_spent
position_qty += tokens_received
```

**On SELL:**
```
avg_cost = position_cost / position_qty
realized_pnl += (sale_price - avg_cost) * qty_sold
```

**On REDEMPTION (cashing out winners):**
```
avg_cost = position_cost / position_qty
realized_pnl += (payout_price - avg_cost) * qty_redeemed
```

**On MARKET RESOLUTION (for remaining positions):**
```
If payout = 0 (loser): realized_pnl += (0 - avg_cost) * position_qty
If payout > 0 (winner): realized_pnl += (payout - avg_cost) * position_qty
```

**Total PnL = sum of realized_pnl across all market outcomes**

---

## Table Schemas

### pm_trader_events_v2
```sql
CREATE TABLE pm_trader_events_v2 (
  event_id String,
  trader_wallet String,
  side String,              -- 'buy' or 'sell'
  token_id String,          -- Outcome token ID (decimal)
  usdc_amount Int64,        -- Raw units (÷1e6 for dollars)
  token_amount Int64,       -- Raw units (÷1e6 for shares)
  trade_time DateTime,
  is_deleted UInt8
)
```

### pm_ctf_events
```sql
CREATE TABLE pm_ctf_events (
  event_type String,        -- 'PositionSplit', 'PositionsMerge', 'PayoutRedemption'
  user_address String,
  condition_id String,
  amount_or_payout String,  -- Raw amount (÷1e6 for USDC)
  event_timestamp DateTime,
  is_deleted UInt8
)
```

### pm_condition_resolutions
```sql
CREATE TABLE pm_condition_resolutions (
  condition_id String,
  payout_numerators String,  -- JSON array: [1, 0] for Yes wins, [0, 1] for No wins
  resolved_at DateTime
)
```

---

## The Problem

**Our calculation doesn't match Polymarket UI.**

### Example

Wallet buys 100 Trump tokens for $50 (avg cost = $0.50)

**Scenario: Trump wins, wallet does NOT redeem**
- Market resolved, payout = $1.00, but no redemption event
- **Our calculation:** ($1.00 - $0.50) × 100 = **+$50 profit**
- **Polymarket UI:** **$0 profit**

### The Pattern
- Wallets that cash out everything = we match
- Wallets with unclaimed winnings = we show higher profit

---

## Questions for GoldSky

1. **Are we missing any events?**
   - NegRisk adapter events?
   - Direct token transfers between wallets?
   - Any other contract interactions?

2. **How does Polymarket.com calculate the PnL shown on wallet pages?**
   - The subgraph `realized_pnl` field only returns positive numbers
   - The UI shows different values than the subgraph
   - What data source does the UI use?

---

## What We Need

1. Confirmation we're not missing any data sources
2. Understanding of how Polymarket UI calculates the number it shows

---

*Cascadian Team*
