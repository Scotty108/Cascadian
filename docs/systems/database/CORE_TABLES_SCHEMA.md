# Polymarket Core Tables Schema

**Generated:** 2025-11-24T16:10:09.462Z
**Database:** default
**Status:** Clean slate for new PnL engine

---

## Overview

These 5 core tables are the foundation for all Polymarket PnL calculations. All legacy tables and views have been archived to `pm_archive`.

| Table | Engine | Rows | Size | Purpose |
|-------|--------|------|------|---------|
| pm_condition_resolutions | SharedReplacingMergeTree | 184,165 | 19.77 MB | Resolution outcomes - which outcome won for each condition |
| pm_ctf_events | SharedReplacingMergeTree | 384,312 | 19.49 MB | Conditional Token Framework events (splits, merges, redemptions) |
| pm_market_metadata | SharedReplacingMergeTree | 179,330 | 51.91 MB | Market info - questions, descriptions, outcomes, categories |
| pm_token_to_condition_map_v3 | SharedMergeTree | 358,617 | 25.78 MB | Maps token_id to condition_id and outcome_index (YES=0/NO=1) |
| pm_trader_events_v2 | SharedMergeTree | 273,762,308 | 25.33 GB | Raw trade events - buys/sells with USDC amounts and fees |

---

## pm_condition_resolutions

**Engine:** `SharedReplacingMergeTree`
**Rows:** 184,165
**Size:** 19.77 MB
**Purpose:** Resolution outcomes - which outcome won for each condition

### Columns

| Column | Type | Default |
|--------|------|---------|
| condition_id | `String` | — |
| payout_numerators | `String` | — |
| payout_denominator | `String` | — |
| resolved_at | `DateTime` | — |
| block_number | `UInt64` | — |
| tx_hash | `String` | — |
| id | `String` | — |
| insert_time | `DateTime` | `now()` |
| is_deleted | `UInt8` | `0` |

### Sample Row

| Column | Sample Value |
|--------|-------------|
| condition_id | `0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed` |
| payout_numerators | `[1,0]` |
| payout_denominator | `2` |
| resolved_at | `2025-08-01 07:38:54` |
| block_number | `74659787` |
| tx_hash | `0x6f815b8fdefc65d74863fecc16f6db56cb6cac097d7e21e46cbe7a1fe06bd3a8` |
| id | `log_0x304e1d46a34f2c73237ec5d153cca66023b5a3c56a06a3bcc1637a9033070c17_9` |
| insert_time | `2025-11-21 09:15:29` |
| is_deleted | `0` |

---

## pm_ctf_events

**Engine:** `SharedReplacingMergeTree`
**Rows:** 384,312
**Size:** 19.49 MB
**Purpose:** Conditional Token Framework events (splits, merges, redemptions)

### Columns

| Column | Type | Default |
|--------|------|---------|
| event_type | `String` | — |
| user_address | `String` | — |
| collateral_token | `String` | — |
| parent_collection_id | `String` | — |
| condition_id | `String` | — |
| partition_index_sets | `String` | — |
| amount_or_payout | `String` | — |
| event_timestamp | `DateTime` | — |
| block_number | `Int64` | — |
| tx_hash | `String` | — |
| id | `String` | — |
| insert_time | `DateTime` | — |
| is_deleted | `UInt8` | — |

### Sample Row

| Column | Sample Value |
|--------|-------------|
| event_type | `PayoutRedemption` |
| user_address | `0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba` |
| collateral_token | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174` |
| parent_collection_id | `0000000000000000000000000000000000000000000000000000000000000000` |
| condition_id | `4e0d4072ce8054c4d85c0bc19971093478c3cba711550c069afc50f07453b3e2` |
| partition_index_sets | `[1,2]` |
| amount_or_payout | `28403578548` |
| event_timestamp | `1970-01-01 00:00:00` |
| block_number | `12745125` |
| tx_hash | `0xed8c865ca6aab15a84769821db1b6e8adc2c677a4de9ad7c213c72efda76aaf7` |
| id | `log_0x0000c6000cdfcccf94b5334b214034103b134db98c6cdb7dc53c3585c8e8a3fc_17` |
| insert_time | `2025-11-24 15:52:17` |
| is_deleted | `0` |

---

## pm_market_metadata

**Engine:** `SharedReplacingMergeTree`
**Rows:** 179,330
**Size:** 51.91 MB
**Purpose:** Market info - questions, descriptions, outcomes, categories

### Columns

| Column | Type | Default |
|--------|------|---------|
| condition_id | `String` | — |
| market_id | `String` | — |
| slug | `String` | — |
| question | `String` | — |
| outcome_label | `String` | — |
| description | `String` | — |
| image_url | `String` | — |
| tags | `Array(String)` | — |
| category | `String` | — |
| volume_usdc | `Float64` | — |
| is_active | `UInt8` | — |
| is_closed | `UInt8` | — |
| end_date | `Nullable(DateTime64(3))` | — |
| ingested_at | `UInt64` | — |
| liquidity_usdc | `Float64` | — |
| outcomes | `Array(String)` | — |
| outcome_prices | `String` | — |
| token_ids | `Array(String)` | — |
| winning_outcome | `String` | — |
| resolution_source | `String` | — |
| enable_order_book | `UInt8` | — |
| order_price_min_tick_size | `Float64` | — |
| notifications_enabled | `UInt8` | — |
| event_id | `String` | — |
| group_slug | `String` | — |
| rewards_min_size | `Float64` | — |
| rewards_max_spread | `Float64` | — |
| spread | `Float64` | — |
| best_bid | `Float64` | — |
| best_ask | `Float64` | — |
| start_date | `Nullable(DateTime64(3))` | — |
| created_at | `Nullable(DateTime64(3))` | — |
| updated_at | `Nullable(DateTime64(3))` | — |
| market_type | `String` | — |
| format_type | `String` | — |
| lower_bound | `String` | — |
| upper_bound | `String` | — |
| volume_24hr | `Float64` | — |
| volume_1wk | `Float64` | — |
| volume_1mo | `Float64` | — |
| price_change_1d | `Float64` | — |
| price_change_1w | `Float64` | — |
| series_slug | `String` | — |
| series_data | `String` | — |
| comment_count | `UInt32` | — |
| is_restricted | `UInt8` | — |
| is_archived | `UInt8` | — |
| wide_format | `UInt8` | — |

### Sample Row

| Column | Sample Value |
|--------|-------------|
| condition_id | `0002a45f7736686e98f5e6476a3d51dd48db232f49115312a07b047c5272eff6` |
| market_id | `517991` |
| slug | `will-the-palisades-fire-burn-less-than-20k-acres-in-total` |
| question | `Will the Palisades fire burn less than 20k acres in total?` |
| outcome_label | `<20,000` |
| description | `This market will resolve to “Yes” if the Palisades fire in California burns less...` |
| image_url | `https://polymarket-upload.s3.us-east-2.amazonaws.com/how-many-acres-will-palisad...` |
| tags | `[]` |
| category | `Other` |
| volume_usdc | `24203.844123` |
| is_active | `0` |
| is_closed | `1` |
| end_date | `2025-12-31 12:00:00.000` |
| ingested_at | `1763690248053` |
| liquidity_usdc | `0` |
| outcomes | `[]` |
| outcome_prices | `"["0", "1"]"` |
| token_ids | `["25025646619520528368956414960932415270214002600335105407720414855152573043376"...` |
| winning_outcome | `` |
| resolution_source | `` |
| enable_order_book | `1` |
| order_price_min_tick_size | `0.001` |
| notifications_enabled | `0` |
| event_id | `16537` |
| group_slug | `how-many-acres-will-palisades-wildfire-burn-in-total` |
| rewards_min_size | `20` |
| rewards_max_spread | `3.5` |
| spread | `0.001` |
| best_bid | `0` |
| best_ask | `0.001` |
| start_date | `2025-01-09 17:18:52.530` |
| created_at | `2025-01-09 15:39:40.462` |
| updated_at | `2025-01-11 15:14:42.110` |
| market_type | `normal` |
| format_type | `` |
| lower_bound | `` |
| upper_bound | `` |
| volume_24hr | `0` |
| volume_1wk | `0` |
| volume_1mo | `0` |
| price_change_1d | `-0.0145` |
| price_change_1w | `0` |
| series_slug | `` |
| series_data | `` |
| comment_count | `10` |
| is_restricted | `1` |
| is_archived | `0` |
| wide_format | `0` |

---

## pm_token_to_condition_map_v3

**Engine:** `SharedMergeTree`
**Rows:** 358,617
**Size:** 25.78 MB
**Purpose:** Maps token_id to condition_id and outcome_index (YES=0/NO=1)

### Columns

| Column | Type | Default |
|--------|------|---------|
| condition_id | `String` | — |
| token_id_dec | `String` | — |
| slug | `String` | — |
| question | `String` | — |
| category | `String` | — |
| tags | `Array(String)` | — |
| outcome_index | `Int64` | — |

### Sample Row

| Column | Sample Value |
|--------|-------------|
| condition_id | `00000977017fa72fb6b1908ae694000d3b51f442c2552656b10bdbbfd16ff707` |
| token_id_dec | `44554681108074793313893626424278471150091658237406724818592366780413111952248` |
| slug | `will-zelenskyy-and-putin-meet-next-in-saudi-arabia` |
| question | `Will Zelenskyy and Putin meet next in Saudi Arabia before 2027?` |
| category | `Other` |
| tags | `["Putin x Zelenskyy Where Next"]` |
| outcome_index | `0` |

---

## pm_trader_events_v2

**Engine:** `SharedMergeTree`
**Rows:** 273,762,308
**Size:** 25.33 GB
**Purpose:** Raw trade events - buys/sells with USDC amounts and fees

### Columns

| Column | Type | Default |
|--------|------|---------|
| event_id | `String` | — |
| trader_wallet | `String` | — |
| role | `String` | — |
| side | `String` | — |
| token_id | `String` | — |
| usdc_amount | `Float64` | — |
| token_amount | `Float64` | — |
| fee_amount | `Float64` | — |
| trade_time | `DateTime` | — |
| transaction_hash | `String` | — |
| block_number | `UInt64` | — |
| insert_time | `DateTime` | `now()` |
| is_deleted | `UInt8` | `0` |

### Sample Row

| Column | Sample Value |
|--------|-------------|
| event_id | `0xf2cb54be3b9939fc8afb9e9866ce78ca7f08b86d8edba2e321ef11439667fe05_0x837ae6fa1a2...` |
| trader_wallet | `0x00000f27e5cc48331f6992ac339c149fef9b324f` |
| role | `maker` |
| side | `buy` |
| token_id | `113603961041744681071530022120600715374544677178421995470843843849385766716158` |
| usdc_amount | `84309992` |
| token_amount | `85334000` |
| fee_amount | `0` |
| trade_time | `2025-07-09 03:47:44` |
| transaction_hash | `��T�;�9�����f�x��m�ۢ�!�C�g�` |
| block_number | `114886331` |
| insert_time | `2025-11-22 03:22:58` |
| is_deleted | `0` |

---

## Table Relationships

```
                    pm_trader_events_v2
                    (269M raw trades)
                           │
                           │ token_id (decimal string)
                           ▼
              pm_token_to_condition_map_v3
              (maps token → condition + outcome)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
pm_condition_resolutions  pm_market_metadata  pm_ctf_events
   (winning outcomes)      (market info)     (CTF operations)
```

### Key Join Patterns

**1. Trade → Condition (most common)**
```sql
SELECT t.*, m.condition_id, m.outcome_index
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m
  ON t.token_id = m.token_id_dec
```

**2. Condition → Resolution**
```sql
SELECT m.condition_id, r.payout_numerators
FROM pm_token_to_condition_map_v3 m
JOIN pm_condition_resolutions r
  ON m.condition_id = r.condition_id
```

**3. Full Trade Context**
```sql
SELECT
  t.trader_wallet,
  t.token_id,
  t.side,
  t.usdc_amount,
  m.condition_id,
  m.outcome_index,
  meta.question,
  r.payout_numerators
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
LEFT JOIN pm_market_metadata meta ON m.condition_id = meta.condition_id
LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
```

---

## Key Field Formats

### Identifiers
- **condition_id:** 64-char hex (no 0x prefix), lowercase
- **token_id:** Decimal string in pm_trader_events_v2, maps via token_id_dec
- **trader_wallet:** 42-char hex with 0x prefix, lowercase

### Units
- **usdc_amount:** In micro-USDC (divide by 1e6 for dollars)
- **fee_amount:** In micro-USDC
- **shares:** In base units (divide by 1e6 for display)

### Side Convention
- **side = 'BUY':** Trader bought outcome tokens (spent USDC)
- **side = 'SELL':** Trader sold outcome tokens (received USDC)

### Outcome Index
- **outcome_index = 0:** YES outcome
- **outcome_index = 1:** NO outcome

### Resolution Payouts
- **payout_numerators = '[1, 0]':** YES won
- **payout_numerators = '[0, 1]':** NO won
- **Empty/NULL:** Not yet resolved

---

## PnL Calculation Formula

For any wallet's PnL on a resolved condition:

```sql
Net PnL =
  -- Money spent buying
  - SUM(CASE WHEN side = 'BUY' THEN (usdc_amount + fee_amount) / 1e6 ELSE 0 END)
  -- Money received selling
  + SUM(CASE WHEN side = 'SELL' THEN (usdc_amount - fee_amount) / 1e6 ELSE 0 END)
  -- Resolution payout (if won)
  + CASE WHEN won THEN final_shares * 1.0 ELSE 0 END
```

Where:
- `final_shares` = shares bought - shares sold
- `won` = outcome_index matches winning payout index

---

*Generated by generate-core-tables-schema.ts*
