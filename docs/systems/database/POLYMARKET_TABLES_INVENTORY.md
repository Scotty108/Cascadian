# Polymarket ClickHouse Tables Inventory

**Generated:** 2025-11-24T04:18:56.232Z
**Database:** default
**Total Tables:** 61

---

## Summary

| Table | Engine | Rows | Size | Source |
|-------|--------|------|------|--------|
| pm_condition_resolutions | SharedReplacingMergeTree | 183,652 | 19.71 MB | Blockchain events (ConditionResolution) |
| pm_condition_resolutions_backup_20251121 | SharedReplacingMergeTree | 357,142 | 38.60 MB | Unknown |
| pm_market_metadata | SharedReplacingMergeTree | 179,330 | 51.91 MB | Unknown |
| pm_market_metadata_backup_20251121 | SharedReplacingMergeTree | 179,330 | 56.03 MB | Unknown |
| pm_market_pnl | View | 0 | 0.00 MB | Unknown |
| pm_market_pnl_with_resolution | View | 0 | 0.00 MB | Unknown |
| pm_token_to_condition_map | SharedMergeTree | 358,617 | 36.06 MB | Unknown |
| pm_token_to_condition_map_v2 | SharedMergeTree | 358,617 | 36.16 MB | Unknown |
| pm_token_to_condition_map_v3 | SharedMergeTree | 358,617 | 25.78 MB | Derived from blockchain events |
| pm_trader_events | SharedReplacingMergeTree | 426,168,274 | 44677.70 MB | Unknown |
| pm_trader_events_backup_20251121 | SharedReplacingMergeTree | 205,547,395 | 21557.12 MB | Unknown |
| pm_trader_events_clean | View | 0 | 0.00 MB | Unknown |
| pm_trader_events_v2 | SharedMergeTree | 268,907,384 | 25517.23 MB | Goldsky / CLOB API |
| pm_ui_positions | SharedMergeTree | 285 | 0.03 MB | Unknown |
| pm_ui_positions_new | SharedReplacingMergeTree | 92,907 | 7.27 MB | Polymarket Data API |
| pm_user_positions | SharedReplacingMergeTree | 54,324,344 | 3886.91 MB | Goldsky (blockchain indexer) |
| pm_user_positions_backup_20251121 | SharedReplacingMergeTree | 84,439,148 | 6333.86 MB | Unknown |
| pm_user_positions_clean | View | 0 | 0.00 MB | Unknown |
| pm_wallet_condition_pnl_v4 | SharedMergeTree | 20,895,555 | 1148.51 MB | Unknown |
| pm_wallet_market_pnl_v2 | SharedMergeTree | 35,205,632 | 2017.31 MB | Unknown |
| pm_wallet_market_pnl_v3 | SharedMergeTree | 35,211,201 | 2337.24 MB | Unknown |
| pm_wallet_market_pnl_v4 | SharedMergeTree | 35,223,748 | 2543.06 MB | Unknown |
| pm_wallet_market_positions_raw | SharedMergeTree | 35,186,298 | 1842.18 MB | Unknown |
| pm_wallet_metrics_PROVISIONAL | View | 0 | 0.00 MB | Unknown |
| pm_wallet_pnl_PROVISIONAL | View | 0 | 0.00 MB | Derived view |
| pm_wallet_pnl_by_category_PROVISIONAL | View | 0 | 0.00 MB | Unknown |
| pm_wallet_pnl_by_tag_PROVISIONAL | View | 0 | 0.00 MB | Unknown |
| vw_category_pnl_totals | View | 0 | 0.00 MB | Unknown |
| vw_condition_winners | View | 0 | 0.00 MB | Unknown |
| vw_fills_deduped | View | 0 | 0.00 MB | Unknown |
| vw_fills_normalized | View | 0 | 0.00 MB | Unknown |
| vw_pm_ledger | View | 0 | 0.00 MB | Unknown |
| vw_pm_ledger_by_condition | View | 0 | 0.00 MB | Unknown |
| vw_pm_ledger_test | View | 0 | 0.00 MB | Unknown |
| vw_pm_mark_to_market_prices | View | 0 | 0.00 MB | Unknown |
| vw_pm_positions_ui | View | 0 | 0.00 MB | Unknown |
| vw_pm_resolution_payouts | View | 0 | 0.00 MB | Unknown |
| vw_pm_wallet_condition_pnl_v4 | View | 0 | 0.00 MB | Unknown |
| vw_pnl_leaderboard | View | 0 | 0.00 MB | Unknown |
| vw_trader_events_dedup | View | 0 | 0.00 MB | Unknown |
| vw_trader_events_v2_dedup | View | 0 | 0.00 MB | Unknown |
| vw_trades_enriched | View | 0 | 0.00 MB | Unknown |
| vw_wallet_category_pnl | View | 0 | 0.00 MB | Unknown |
| vw_wallet_condition_ledger_v1 | View | 0 | 0.00 MB | Unknown |
| vw_wallet_condition_pnl_v1 | View | 0 | 0.00 MB | Unknown |
| vw_wallet_gain_loss | View | 0 | 0.00 MB | Unknown |
| vw_wallet_market_fills | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_base | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_by_category | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_canonical | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_computed | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_goldsky | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_materialized | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_totals | View | 0 | 0.00 MB | Unknown |
| vw_wallet_pnl_totals_v1 | View | 0 | 0.00 MB | Unknown |
| vw_wallet_trading_pnl | View | 0 | 0.00 MB | Unknown |
| vw_wallet_ui_pnl_goldsky | View | 0 | 0.00 MB | Unknown |
| vw_wallet_ui_pnl_hybrid | View | 0 | 0.00 MB | Unknown |
| vw_wallet_ui_pnl_polymarket | View | 0 | 0.00 MB | Unknown |
| vw_wallet_ui_pnl_v1 | View | 0 | 0.00 MB | Unknown |
| vw_wallet_win_rate | View | 0 | 0.00 MB | Unknown |

---

## Detailed Table Documentation

### pm_condition_resolutions

**Engine:** SharedReplacingMergeTree
**Rows:** 183,652
**Size:** 19.71 MB
**Source:** Blockchain events (ConditionResolution)
**Purpose:** Resolution outcomes - which outcome won for each condition

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| resolved_at | `DateTime` |
| block_number | `UInt64` |
| tx_hash | `String` |
| id | `String` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "condition_id": "0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed",
  "payout_numerators": "[1,0]",
  "payout_denominator": "2",
  "resolved_at": "2025-08-01 07:38:54",
  "block_number": 74659787,
  "tx_hash": "0x6f815b8fdefc65d74863fecc16f6db56cb6cac097d7e21e46cbe7a1fe06bd3a8",
  "id": "log_0x304e1d46a34f2c73237ec5d153cca66023b5a3c56a06a3bcc1637a9033070c17_9",
  "insert_time": "2025-11-21 09:15:29",
  "is_deleted": 0
}
```

---

### pm_condition_resolutions_backup_20251121

**Engine:** SharedReplacingMergeTree
**Rows:** 357,142
**Size:** 38.60 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| resolved_at | `DateTime` |
| block_number | `UInt64` |
| tx_hash | `String` |
| id | `String` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "condition_id": "0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed",
  "payout_numerators": "[1,0]",
  "payout_denominator": "2",
  "resolved_at": "2025-08-01 07:38:54",
  "block_number": 74659787,
  "tx_hash": "0x6f815b8fdefc65d74863fecc16f6db56cb6cac097d7e21e46cbe7a1fe06bd3a8",
  "id": "log_0x304e1d46a34f2c73237ec5d153cca66023b5a3c56a06a3bcc1637a9033070c17_9",
  "insert_time": "2025-11-21 09:15:29",
  "is_deleted": 0
}
```

---

### pm_market_metadata

**Engine:** SharedReplacingMergeTree
**Rows:** 179,330
**Size:** 51.91 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| market_id | `String` |
| slug | `String` |
| question | `String` |
| outcome_label | `String` |
| description | `String` |
| image_url | `String` |
| tags | `Array(String)` |
| category | `String` |
| volume_usdc | `Float64` |
| is_active | `UInt8` |
| is_closed | `UInt8` |
| end_date | `Nullable(DateTime64(3))` |
| ingested_at | `UInt64` |
| liquidity_usdc | `Float64` |
| outcomes | `Array(String)` |
| outcome_prices | `String` |
| token_ids | `Array(String)` |
| winning_outcome | `String` |
| resolution_source | `String` |
| enable_order_book | `UInt8` |
| order_price_min_tick_size | `Float64` |
| notifications_enabled | `UInt8` |
| event_id | `String` |
| group_slug | `String` |
| rewards_min_size | `Float64` |
| rewards_max_spread | `Float64` |
| spread | `Float64` |
| best_bid | `Float64` |
| best_ask | `Float64` |
| start_date | `Nullable(DateTime64(3))` |
| created_at | `Nullable(DateTime64(3))` |
| updated_at | `Nullable(DateTime64(3))` |
| market_type | `String` |
| format_type | `String` |
| lower_bound | `String` |
| upper_bound | `String` |
| volume_24hr | `Float64` |
| volume_1wk | `Float64` |
| volume_1mo | `Float64` |
| price_change_1d | `Float64` |
| price_change_1w | `Float64` |
| series_slug | `String` |
| series_data | `String` |
| comment_count | `UInt32` |
| is_restricted | `UInt8` |
| is_archived | `UInt8` |
| wide_format | `UInt8` |

#### Sample Values

```json
{
  "condition_id": "0002a45f7736686e98f5e6476a3d51dd48db232f49115312a07b047c5272eff6",
  "market_id": "517991",
  "slug": "will-the-palisades-fire-burn-less-than-20k-acres-in-total",
  "question": "Will the Palisades fire burn less than 20k acres in total?",
  "outcome_label": "<20,000",
  "description": "This market will resolve to “Yes” if the Palisades fire in California burns less than 20,000 acres i...",
  "image_url": "https://polymarket-upload.s3.us-east-2.amazonaws.com/how-many-acres-will-palisades-wildfire-burn-in-...",
  "tags": [],
  "category": "Other",
  "volume_usdc": 24203.844123,
  "is_active": 0,
  "is_closed": 1,
  "end_date": "2025-12-31 12:00:00.000",
  "ingested_at": 1763690248053,
  "liquidity_usdc": 0,
  "outcomes": [],
  "outcome_prices": "\"[\"0\", \"1\"]\"",
  "token_ids": [
    "25025646619520528368956414960932415270214002600335105407720414855152573043376",
    "23730767560780769504439203266635963984946402417129664205405764774491860662719"
  ],
  "winning_outcome": "",
  "resolution_source": "",
  "enable_order_book": 1,
  "order_price_min_tick_size": 0.001,
  "notifications_enabled": 0,
  "event_id": "16537",
  "group_slug": "how-many-acres-will-palisades-wildfire-burn-in-total",
  "rewards_min_size": 20,
  "rewards_max_spread": 3.5,
  "spread": 0.001,
  "best_bid": 0,
  "best_ask": 0.001,
  "start_date": "2025-01-09 17:18:52.530",
  "created_at": "2025-01-09 15:39:40.462",
  "updated_at": "2025-01-11 15:14:42.110",
  "market_type": "normal",
  "format_type": "",
  "lower_bound": "",
  "upper_bound": "",
  "volume_24hr": 0,
  "volume_1wk": 0,
  "volume_1mo": 0,
  "price_change_1d": -0.0145,
  "price_change_1w": 0,
  "series_slug": "",
  "series_data": "",
  "comment_count": 10,
  "is_restricted": 1,
  "is_archived": 0,
  "wide_format": 0
}
```

---

### pm_market_metadata_backup_20251121

**Engine:** SharedReplacingMergeTree
**Rows:** 179,330
**Size:** 56.03 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| market_id | `String` |
| slug | `String` |
| question | `String` |
| outcome_label | `String` |
| description | `String` |
| image_url | `String` |
| tags | `Array(String)` |
| category | `String` |
| volume_usdc | `Float64` |
| is_active | `UInt8` |
| is_closed | `UInt8` |
| end_date | `Nullable(DateTime64(3))` |
| ingested_at | `UInt64` |
| liquidity_usdc | `Float64` |
| outcomes | `Array(String)` |
| outcome_prices | `String` |
| token_ids | `Array(String)` |
| winning_outcome | `String` |
| resolution_source | `String` |
| enable_order_book | `UInt8` |
| order_price_min_tick_size | `Float64` |
| notifications_enabled | `UInt8` |
| event_id | `String` |
| group_slug | `String` |
| rewards_min_size | `Float64` |
| rewards_max_spread | `Float64` |
| spread | `Float64` |
| best_bid | `Float64` |
| best_ask | `Float64` |
| start_date | `Nullable(DateTime64(3))` |
| created_at | `Nullable(DateTime64(3))` |
| updated_at | `Nullable(DateTime64(3))` |
| market_type | `String` |
| format_type | `String` |
| lower_bound | `String` |
| upper_bound | `String` |
| volume_24hr | `Float64` |
| volume_1wk | `Float64` |
| volume_1mo | `Float64` |
| price_change_1d | `Float64` |
| price_change_1w | `Float64` |
| series_slug | `String` |
| series_data | `String` |
| comment_count | `UInt32` |
| is_restricted | `UInt8` |
| is_archived | `UInt8` |
| wide_format | `UInt8` |

#### Sample Values

```json
{
  "condition_id": "b267c19e813633277575ecd2194eac080f684f3480b4268741e98ae166e22260",
  "market_id": "617980",
  "slug": "will-the-highest-temperature-in-london-be-between-66-67f-on-october-2",
  "question": "Will the highest temperature in London be between 66-67°F on October 2?",
  "outcome_label": "66-67°F",
  "description": "This market will resolve to the temperature range that contains the highest temperature recorded at ...",
  "image_url": "https://polymarket-upload.s3.us-east-2.amazonaws.com/highest-temperature-in-london-on-jan-22-eouu0bk...",
  "tags": [
    "London Daily Weather"
  ],
  "category": "Other",
  "volume_usdc": 4744.229056,
  "is_active": 0,
  "is_closed": 1,
  "end_date": "2025-10-02 12:00:00.000",
  "ingested_at": 1763691066256,
  "liquidity_usdc": 0,
  "outcomes": [],
  "outcome_prices": "\"[\"1\", \"0\"]\"",
  "token_ids": [
    "62689890328309417332620628190498769626054276966780327662734895411328782749903",
    "48777516835976464385305627478225923431683156367537627224966255144635579303409"
  ],
  "winning_outcome": "",
  "resolution_source": "",
  "enable_order_book": 1,
  "order_price_min_tick_size": 0.001,
  "notifications_enabled": 0,
  "event_id": "52003",
  "group_slug": "highest-temperature-in-london-on-october-2",
  "rewards_min_size": 50,
  "rewards_max_spread": 3.5,
  "spread": 0.001,
  "best_bid": 0.999,
  "best_ask": 1,
  "start_date": "2025-09-30 11:39:19.477",
  "created_at": "2025-09-30 11:35:35.206",
  "updated_at": "2025-10-04 00:39:44.219",
  "market_type": "normal",
  "format_type": "",
  "lower_bound": "",
  "upper_bound": "",
  "volume_24hr": 0,
  "volume_1wk": 4744.229056,
  "volume_1mo": 4744.229056,
  "price_change_1d": 0.5995,
  "price_change_1w": 0,
  "series_slug": "london-daily-weather",
  "series_data": "{\"id\":\"10006\",\"ticker\":\"london-daily-weather\",\"slug\":\"london-daily-weather\",\"title\":\"London Daily We...",
  "comment_count": 244,
  "is_restricted": 1,
  "is_archived": 0,
  "wide_format": 0
}
```

---

### pm_market_pnl

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| token_id_dec | `String` |
| slug | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |

---

### pm_market_pnl_with_resolution

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| token_id_dec | `String` |
| slug | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| resolved_at | `Nullable(DateTime)` |
| resolution_block | `Nullable(UInt64)` |

---

### pm_token_to_condition_map

**Engine:** SharedMergeTree
**Rows:** 358,617
**Size:** 36.06 MB

#### Columns

| Column | Type |
|--------|------|
| token_id_dec | `String` |
| condition_id | `String` |
| slug | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |

#### Sample Values

```json
{
  "token_id_dec": "100000293804690815023609597660894660801582658691499546225810764430851148723524",
  "condition_id": "2c0b5356580361d997ce3d29d38d5eceeb7a90650186f9c0f6f2844bebf1ff71",
  "slug": "cfb-tcu-wvir-2025-10-25-spread-away-16pt5",
  "question": "Spread: TCU (-16.5)",
  "category": "Other",
  "tags": [
    "CFB 2025"
  ]
}
```

---

### pm_token_to_condition_map_v2

**Engine:** SharedMergeTree
**Rows:** 358,617
**Size:** 36.16 MB

#### Columns

| Column | Type |
|--------|------|
| token_id_dec | `String` |
| condition_id | `String` |
| slug | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| outcome_index | `Int64` |

#### Sample Values

```json
{
  "token_id_dec": "100000293804690815023609597660894660801582658691499546225810764430851148723524",
  "condition_id": "2c0b5356580361d997ce3d29d38d5eceeb7a90650186f9c0f6f2844bebf1ff71",
  "slug": "cfb-tcu-wvir-2025-10-25-spread-away-16pt5",
  "question": "Spread: TCU (-16.5)",
  "category": "Other",
  "tags": [
    "CFB 2025"
  ],
  "outcome_index": 0
}
```

---

### pm_token_to_condition_map_v3

**Engine:** SharedMergeTree
**Rows:** 358,617
**Size:** 25.78 MB
**Source:** Derived from blockchain events
**Purpose:** Maps token_id to condition_id and outcome_index (YES/NO)

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| token_id_dec | `String` |
| slug | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| outcome_index | `Int64` |

#### Sample Values

```json
{
  "condition_id": "00000977017fa72fb6b1908ae694000d3b51f442c2552656b10bdbbfd16ff707",
  "token_id_dec": "44554681108074793313893626424278471150091658237406724818592366780413111952248",
  "slug": "will-zelenskyy-and-putin-meet-next-in-saudi-arabia",
  "question": "Will Zelenskyy and Putin meet next in Saudi Arabia before 2027?",
  "category": "Other",
  "tags": [
    "Putin x Zelenskyy Where Next"
  ],
  "outcome_index": 0
}
```

---

### pm_trader_events

**Engine:** SharedReplacingMergeTree
**Rows:** 426,168,274
**Size:** 44677.70 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| token_id | `String` |
| amount_usdc | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "event_id": "0xec8f967bac5878b62ddc23b9d03cd51218fa6eb74c7c6e119a4badfbcfa38e55_0x7f60f105076e250a3adf7f7eb8eb7aa...",
  "trader_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "token_id": "0",
  "amount_usdc": 2500000,
  "trade_time": "2024-03-09 18:44:45",
  "transaction_hash": "쏖{�Xx�-�#��<�\u0012\u0018�n�L|n\u0011�K��ϣ�U",
  "block_number": 612033,
  "insert_time": "2025-11-19 20:45:52",
  "is_deleted": 0
}
```

---

### pm_trader_events_backup_20251121

**Engine:** SharedReplacingMergeTree
**Rows:** 205,547,395
**Size:** 21557.12 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| token_id | `String` |
| amount_usdc | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "event_id": "0xec8f967bac5878b62ddc23b9d03cd51218fa6eb74c7c6e119a4badfbcfa38e55_0x7f60f105076e250a3adf7f7eb8eb7aa...",
  "trader_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "token_id": "0",
  "amount_usdc": 2500000,
  "trade_time": "2024-03-09 18:44:45",
  "transaction_hash": "쏖{�Xx�-�#��<�\u0012\u0018�n�L|n\u0011�K��ϣ�U",
  "block_number": 612033,
  "insert_time": "2025-11-19 20:45:52",
  "is_deleted": 0
}
```

---

### pm_trader_events_clean

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| token_id | `String` |
| amount_usdc | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

---

### pm_trader_events_v2

**Engine:** SharedMergeTree
**Rows:** 268,907,384
**Size:** 25517.23 MB
**Source:** Goldsky / CLOB API
**Purpose:** Raw trade events - buys and sells with USDC amounts and fees

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| role | `String` |
| side | `String` |
| token_id | `String` |
| usdc_amount | `Float64` |
| token_amount | `Float64` |
| fee_amount | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "event_id": "0xf2cb54be3b9939fc8afb9e9866ce78ca7f08b86d8edba2e321ef11439667fe05_0x837ae6fa1a293ab6a180a2a230368c8...",
  "trader_wallet": "0x00000f27e5cc48331f6992ac339c149fef9b324f",
  "role": "maker",
  "side": "buy",
  "token_id": "113603961041744681071530022120600715374544677178421995470843843849385766716158",
  "usdc_amount": 84309992,
  "token_amount": 85334000,
  "fee_amount": 0,
  "trade_time": "2025-07-09 03:47:44",
  "transaction_hash": "��T�;�9�����f�x�\b�m�ۢ�!�\u0011C�g�\u0005",
  "block_number": 114886331,
  "insert_time": "2025-11-22 03:22:58",
  "is_deleted": 0
}
```

---

### pm_ui_positions

**Engine:** SharedMergeTree
**Rows:** 285
**Size:** 0.03 MB

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| condition_id | `String` |
| asset | `String` |
| cash_pnl | `Float64` |
| total_bought | `Float64` |
| realized_pnl | `Float64` |
| current_value | `Float64` |

#### Sample Values

```json
{
  "proxy_wallet": "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
  "condition_id": "0x02bc0bbff054877a08cdc4f9ccf4e7606804bc05c27f5faccf26c6e1666a5558",
  "asset": "67089287271692871221799799486468743524636060540186332703509386944410510992981",
  "cash_pnl": 84342.088102,
  "total_bought": 213746.678448,
  "realized_pnl": 84342.088102,
  "current_value": 0
}
```

---

### pm_ui_positions_new

**Engine:** SharedReplacingMergeTree
**Rows:** 92,907
**Size:** 7.27 MB
**Source:** Polymarket Data API
**Purpose:** UI-style positions with cash_pnl - EMPTY for many wallets

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| condition_id | `String` |
| asset | `String` |
| outcome_index | `Int32` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| net_shares | `Float64` |
| cash_pnl | `Float64` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| current_value | `Float64` |
| last_updated_at | `DateTime` |
| as_of_date | `Date` |

#### Sample Values

```json
{
  "proxy_wallet": "0x00027c9ef773d5818bd9208fcd596c4b40235e91",
  "condition_id": "0x158bef7cf4b9990e61297fe952bc6359fef06361d56604ef467a48c2055fa8e0",
  "asset": "82119958237081758677918439470819050029950877296378968244354582356342459672280",
  "outcome_index": 0,
  "total_bought": 10000,
  "total_sold": 0,
  "net_shares": 0,
  "cash_pnl": -10,
  "realized_pnl": -10,
  "unrealized_pnl": 0,
  "current_value": 0,
  "last_updated_at": "2025-11-23 06:49:53",
  "as_of_date": "2025-11-23"
}
```

---

### pm_user_positions

**Engine:** SharedReplacingMergeTree
**Rows:** 54,324,344
**Size:** 3886.91 MB
**Source:** Goldsky (blockchain indexer)
**Purpose:** User position snapshots with realized_pnl (BROKEN - accumulates trade profits)

#### Columns

| Column | Type |
|--------|------|
| position_id | `String` |
| proxy_wallet | `String` |
| condition_id | `String` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| updated_at | `DateTime` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "position_id": "0x00000000000050ba7c429821e6d66429452ba168-251135563753328170759148188520793623034158902295063005731...",
  "proxy_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "25113556375332817075914818852079362303415890229506300573120790517467993888548.000000000000000000",
  "realized_pnl": -1351615890,
  "unrealized_pnl": 0,
  "total_bought": 8862662448,
  "total_sold": 0,
  "updated_at": "1970-01-01 00:00:00",
  "block_number": 7781637,
  "insert_time": "2025-11-19 20:43:10",
  "is_deleted": 0
}
```

---

### pm_user_positions_backup_20251121

**Engine:** SharedReplacingMergeTree
**Rows:** 84,439,148
**Size:** 6333.86 MB

#### Columns

| Column | Type |
|--------|------|
| position_id | `String` |
| proxy_wallet | `String` |
| condition_id | `String` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| updated_at | `DateTime` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

#### Sample Values

```json
{
  "position_id": "0x00000000000050ba7c429821e6d66429452ba168-251135563753328170759148188520793623034158902295063005731...",
  "proxy_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "25113556375332817075914818852079362303415890229506300573120790517467993888548.000000000000000000",
  "realized_pnl": -1351615890,
  "unrealized_pnl": 0,
  "total_bought": 8862662448,
  "total_sold": 0,
  "updated_at": "1970-01-01 00:00:00",
  "block_number": 7781637,
  "insert_time": "2025-11-19 20:43:10",
  "is_deleted": 0
}
```

---

### pm_user_positions_clean

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| position_id | `String` |
| proxy_wallet | `String` |
| condition_id | `String` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| updated_at | `DateTime` |
| block_number | `UInt64` |
| insert_time | `DateTime` |

---

### pm_wallet_condition_pnl_v4

**Engine:** SharedMergeTree
**Rows:** 20,895,555
**Size:** 1148.51 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| net_cash_flow_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| resolution_payout_usdc | `Float64` |
| total_pnl_usdc | `Float64` |
| computed_at | `DateTime` |

#### Sample Values

```json
{
  "wallet_address": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd",
  "net_cash_flow_usdc": -2348.354029,
  "total_fees_usdc": 0,
  "total_bought_usdc": 5145.398022000001,
  "total_sold_usdc": 2797.043993,
  "resolution_payout_usdc": 5596.657778999999,
  "total_pnl_usdc": 3248.303749999999,
  "computed_at": "2025-11-22 22:56:01"
}
```

---

### pm_wallet_market_pnl_v2

**Engine:** SharedMergeTree
**Rows:** 35,205,632
**Size:** 2017.31 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `UInt8` |
| question | `String` |
| category | `String` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| bought_shares | `Float64` |
| sold_shares | `Float64` |
| net_shares | `Float64` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| outcome_payout | `UInt8` |
| is_resolved | `UInt8` |
| resolved_at | `Nullable(DateTime)` |
| trading_pnl | `Float64` |
| resolution_payout | `Float64` |
| total_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| computed_at | `DateTime` |

#### Sample Values

```json
{
  "wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd",
  "outcome_index": 0,
  "question": "ETH above $4,000 next Friday?",
  "category": "Crypto",
  "total_bought_usdc": 0,
  "total_sold_usdc": 0,
  "total_fees_usdc": 0,
  "bought_shares": 0,
  "sold_shares": 0,
  "net_shares": 0,
  "payout_numerators": "[0,1]",
  "payout_denominator": "2",
  "outcome_payout": 0,
  "is_resolved": 1,
  "resolved_at": "2024-03-15 18:12:46",
  "trading_pnl": 0,
  "resolution_payout": 0,
  "total_pnl": 0,
  "total_trades": 10,
  "first_trade": "2024-03-09 23:13:22",
  "last_trade": "2024-03-14 22:31:46",
  "computed_at": "2025-11-22 20:34:21"
}
```

---

### pm_wallet_market_pnl_v3

**Engine:** SharedMergeTree
**Rows:** 35,211,201
**Size:** 2337.24 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `UInt8` |
| question | `String` |
| category | `String` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| bought_shares | `Float64` |
| sold_shares | `Float64` |
| net_shares | `Float64` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| outcome_payout | `UInt8` |
| is_resolved | `UInt8` |
| resolved_at | `Nullable(DateTime)` |
| trading_pnl | `Float64` |
| resolution_payout | `Float64` |
| total_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| computed_at | `DateTime` |

#### Sample Values

```json
{
  "wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd",
  "outcome_index": 0,
  "question": "ETH above $4,000 next Friday?",
  "category": "Crypto",
  "total_bought_usdc": 0,
  "total_sold_usdc": 1226.062,
  "total_fees_usdc": 0,
  "bought_shares": 0,
  "sold_shares": 2911.824586,
  "net_shares": -2911.824586,
  "payout_numerators": "[0,1]",
  "payout_denominator": "2",
  "outcome_payout": 0,
  "is_resolved": 1,
  "resolved_at": "2024-03-15 18:12:46",
  "trading_pnl": 1226.062,
  "resolution_payout": 0,
  "total_pnl": 1226.062,
  "total_trades": 10,
  "first_trade": "2024-03-09 23:13:22",
  "last_trade": "2024-03-14 22:31:46",
  "computed_at": "2025-11-22 21:05:21"
}
```

---

### pm_wallet_market_pnl_v4

**Engine:** SharedMergeTree
**Rows:** 35,223,748
**Size:** 2543.06 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `UInt8` |
| question | `String` |
| category | `String` |
| total_bought_shares | `Float64` |
| total_sold_shares | `Float64` |
| net_shares | `Float64` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| avg_cost_per_share | `Float64` |
| remaining_cost_basis | `Float64` |
| is_resolved | `UInt8` |
| outcome_won | `UInt8` |
| resolution_payout | `Float64` |
| trading_pnl | `Float64` |
| resolution_pnl | `Float64` |
| total_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| computed_at | `DateTime` |

#### Sample Values

```json
{
  "wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd",
  "outcome_index": 0,
  "question": "ETH above $4,000 next Friday?",
  "category": "Crypto",
  "total_bought_shares": 0,
  "total_sold_shares": 2911.8245859999997,
  "net_shares": -2911.8245859999997,
  "total_bought_usdc": 0,
  "total_sold_usdc": 1226.062,
  "total_fees_usdc": 0,
  "avg_cost_per_share": 0,
  "remaining_cost_basis": 0,
  "is_resolved": 1,
  "outcome_won": 0,
  "resolution_payout": 0,
  "trading_pnl": 1226.062,
  "resolution_pnl": 0,
  "total_pnl": 1226.062,
  "total_trades": 10,
  "first_trade": "2024-03-09 23:13:22",
  "last_trade": "2024-03-14 22:31:46",
  "computed_at": "2025-11-22 22:37:26"
}
```

---

### pm_wallet_market_positions_raw

**Engine:** SharedMergeTree
**Rows:** 35,186,298
**Size:** 1842.18 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `UInt8` |
| question | `String` |
| category | `String` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| bought_shares | `Float64` |
| sold_shares | `Float64` |
| net_shares | `Float64` |
| buy_count | `UInt64` |
| sell_count | `UInt64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| computed_at | `DateTime` |

#### Sample Values

```json
{
  "wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "condition_id": "096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd",
  "outcome_index": 0,
  "question": "ETH above $4,000 next Friday?",
  "category": "Crypto",
  "total_bought_usdc": 0,
  "total_sold_usdc": 1226.062,
  "total_fees_usdc": 0,
  "bought_shares": 0,
  "sold_shares": 2911.8245859999997,
  "net_shares": -2911.8245859999997,
  "buy_count": 0,
  "sell_count": 10,
  "total_trades": 10,
  "first_trade": "2024-03-09 23:13:22",
  "last_trade": "2024-03-14 22:31:46",
  "computed_at": "2025-11-22 18:58:05"
}
```

---

### pm_wallet_metrics_PROVISIONAL

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| total_positions | `UInt64` |
| winning_positions | `UInt64` |
| losing_positions | `UInt64` |
| pending_positions | `UInt64` |
| net_pnl_usd | `Float64` |
| unrealized_pnl_usd | `Float64` |
| total_gains_usd | `Float64` |
| total_losses_usd | `Float64` |
| volume_usd | `Float64` |
| win_rate_pct | `Float64` |
| omega_ratio | `Float64` |
| roi_pct | `Float64` |
| first_activity | `DateTime` |
| last_activity | `DateTime` |

---

### pm_wallet_pnl_PROVISIONAL

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB
**Source:** Derived view
**Purpose:** Aggregated wallet PnL from Goldsky (provisional)

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| realized_pnl | `Float64` |
| unrealized_pnl | `Float64` |
| markets_traded | `UInt64` |

---

### pm_wallet_pnl_by_category_PROVISIONAL

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| category | `String` |
| position_count | `UInt64` |
| total_pnl_usd | `Float64` |
| unrealized_pnl_usd | `Float64` |
| total_bought_usd | `Float64` |
| total_sold_usd | `Float64` |
| wins | `UInt64` |
| losses | `UInt64` |
| pending | `UInt64` |

---

### pm_wallet_pnl_by_tag_PROVISIONAL

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| proxy_wallet | `String` |
| category | `String` |
| tag | `String` |
| position_count | `UInt64` |
| total_pnl_usd | `Float64` |
| unrealized_pnl_usd | `Float64` |
| total_bought_usd | `Float64` |
| wins | `UInt64` |
| losses | `UInt64` |

---

### vw_category_pnl_totals

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| category | `String` |
| unique_wallets | `UInt64` |
| total_positions | `UInt64` |
| total_pnl | `Float64` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| winning_positions | `UInt64` |
| losing_positions | `UInt64` |
| win_rate | `Nullable(Float64)` |
| omega_ratio | `Nullable(Float64)` |

---

### vw_condition_winners

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| winning_outcome_index | `Int64` |

---

### vw_fills_deduped

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| token_id | `String` |
| side | `String` |
| usdc_amount | `Float64` |
| token_amount | `Float64` |
| fee_amount | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |

---

### vw_fills_normalized

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| token_id | `String` |
| side | `String` |
| usdc | `Float64` |
| shares | `Float64` |
| fee | `Float64` |
| trade_time | `DateTime` |
| condition_id | `String` |
| outcome_index | `Int64` |
| question | `String` |
| category | `String` |

---

### vw_pm_ledger

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| wallet_address | `String` |
| token_id | `String` |
| condition_id | `String` |
| outcome_index | `Int64` |
| role | `String` |
| side | `String` |
| shares_delta | `Float64` |
| cash_delta_usdc | `Float64` |
| fee_usdc | `Float64` |
| block_time | `DateTime` |
| tx_hash | `String` |

---

### vw_pm_ledger_by_condition

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| net_cash_flow_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |

---

### vw_pm_ledger_test

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| outcome_index | `Int32` |
| position_id | `String` |
| event_time | `DateTime` |
| event_type | `String` |
| share_delta | `Float64` |
| cash_delta | `Float64` |
| fee_usdc | `Float64` |
| tx_hash | `String` |

---

### vw_pm_mark_to_market_prices

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| condition_id | `String` |
| outcome_index | `UInt8` |
| current_price | `Float64` |
| best_bid | `Float64` |
| best_ask | `Float64` |
| last_updated_at | `DateTime` |

---

### vw_pm_positions_ui

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| position_id | `String` |
| token_id | `String` |
| condition_id | `String` |
| outcome_index | `Int64` |
| cost_basis_usd | `Float64` |
| realized_pnl_usd | `Float64` |
| unrealized_pnl_usd | `Float64` |
| total_sold_usd | `Float64` |
| is_resolved | `UInt8` |
| position_status | `String` |

---

### vw_pm_resolution_payouts

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| resolution_payout_usdc | `Float64` |

---

### vw_pm_wallet_condition_pnl_v4

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| net_cash_flow_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| resolution_payout_usdc | `Float64` |
| total_pnl_usdc | `Float64` |

---

### vw_pnl_leaderboard

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| total_pnl | `Float64` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| goldsky_positions | `UInt64` |
| total_bought | `Float64` |
| markets_traded | `UInt64` |
| total_trades | `UInt64` |
| win_rate_pct | `Float64` |
| resolved_positions | `UInt64` |
| w.winning_positions | `UInt64` |
| w.losing_positions | `UInt64` |
| avg_win | `Float64` |
| avg_loss | `Float64` |

---

### vw_trader_events_dedup

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| role | `String` |
| side | `String` |
| token_id | `String` |
| usdc_amount | `Float64` |
| token_amount | `Float64` |
| fee_amount | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| latest_insert_time | `DateTime` |

---

### vw_trader_events_v2_dedup

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| event_id | `String` |
| trader_wallet | `String` |
| role | `String` |
| side | `String` |
| token_id | `String` |
| usdc_amount | `Float64` |
| token_amount | `Float64` |
| fee_amount | `Float64` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |
| insert_time | `DateTime` |
| is_deleted | `UInt8` |

---

### vw_trades_enriched

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| t.event_id | `String` |
| trader_wallet | `String` |
| role | `String` |
| side | `String` |
| token_id | `String` |
| m.condition_id | `String` |
| usdc_amount | `Float64` |
| shares | `Float64` |
| fee_amount | `Float64` |
| price | `Float64` |
| md.question | `String` |
| md.slug | `String` |
| md.category | `String` |
| md.tags | `Array(String)` |
| outcomes | `Array(String)` |
| trade_time | `DateTime` |
| transaction_hash | `String` |
| block_number | `UInt64` |

---

### vw_wallet_category_pnl

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| category | `String` |
| positions | `UInt64` |
| markets | `UInt64` |
| total_trades | `UInt64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| trading_pnl | `Float64` |
| resolution_payouts | `Float64` |
| total_pnl | `Float64` |

---

### vw_wallet_condition_ledger_v1

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `Int64` |
| event_timestamp | `DateTime` |
| event_type | `String` |
| share_delta | `Float64` |
| usdc_delta | `Float64` |

---

### vw_wallet_condition_pnl_v1

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `Int64` |
| trade_count | `UInt64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| is_resolved | `UInt8` |
| gains | `Float64` |
| losses | `Float64` |
| net_pnl | `Float64` |
| final_shares | `Float64` |

---

### vw_wallet_gain_loss

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| net_pnl | `Float64` |
| winning_positions | `UInt64` |
| losing_positions | `UInt64` |

---

### vw_wallet_market_fills

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| outcomes | `Array(String)` |
| total_bought_usdc | `Float64` |
| total_bought_shares | `Float64` |
| buy_count | `UInt64` |
| avg_buy_price | `Float64` |
| total_sold_usdc | `Float64` |
| total_sold_shares | `Float64` |
| sell_count | `UInt64` |
| avg_sell_price | `Float64` |
| total_fees | `Float64` |
| net_shares | `Float64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| total_trades | `UInt64` |

---

### vw_wallet_pnl_base

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| m.condition_id | `String` |
| question | `String` |
| category | `String` |
| tags | `Array(String)` |
| outcomes | `Array(String)` |
| total_bought_usdc | `Float64` |
| total_bought_shares | `Float64` |
| total_sold_usdc | `Float64` |
| total_sold_shares | `Float64` |
| net_shares | `Float64` |
| total_fees | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |
| resolved_at | `DateTime` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| trading_pnl | `Float64` |
| is_resolved | `UInt8` |

---

### vw_wallet_pnl_by_category

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| category | `String` |
| condition_count | `UInt64` |
| total_pnl | `Float64` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| wins | `UInt64` |
| losses | `UInt64` |
| win_rate | `Nullable(Float64)` |
| roi | `Nullable(Float64)` |
| omega_ratio | `Nullable(Float64)` |

---

### vw_wallet_pnl_canonical

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| m.condition_id | `String` |
| outcome_index | `Int64` |
| question | `String` |
| category | `String` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| shares_bought | `Float64` |
| shares_sold | `Float64` |
| net_shares | `Float64` |
| payout_numerators | `String` |
| payout_denominator | `String` |
| is_resolved | `UInt8` |
| resolved_at | `DateTime` |
| outcome_won | `Int64` |
| trading_pnl | `Float64` |
| resolution_payout | `Float64` |
| total_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |

---

### vw_wallet_pnl_computed

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| position_count | `UInt64` |
| markets_traded | `UInt64` |
| total_trades | `UInt64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| total_fees | `Float64` |
| trading_pnl | `Float64` |
| resolution_payouts | `Float64` |
| computed_total_pnl | `Float64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |

---

### vw_wallet_pnl_goldsky

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| position_count | `UInt64` |
| total_realized_pnl | `Float64` |
| total_unrealized_pnl | `Float64` |
| total_bought | `Float64` |
| total_sold | `Float64` |

---

### vw_wallet_pnl_materialized

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `UInt8` |
| question | `String` |
| category | `String` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| bought_shares | `Float64` |
| sold_shares | `Float64` |
| net_shares | `Float64` |
| is_resolved | `UInt8` |
| resolved_at | `Nullable(DateTime)` |
| trading_pnl | `Float64` |
| resolution_payout | `Float64` |
| total_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |

---

### vw_wallet_pnl_totals

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_count | `UInt64` |
| total_pnl | `Float64` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| net_cash_flow | `Float64` |
| resolution_payout | `Float64` |
| total_bought | `Float64` |
| total_sold | `Float64` |
| winning_conditions | `UInt64` |
| losing_conditions | `UInt64` |
| win_rate | `Nullable(Float64)` |
| roi | `Nullable(Float64)` |
| omega_ratio | `Nullable(Float64)` |

---

### vw_wallet_pnl_totals_v1

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| total_events | `UInt64` |
| total_trades | `UInt64` |
| resolved_positions | `UInt64` |
| unique_positions | `UInt64` |
| total_gains | `Float64` |
| total_losses | `Float64` |
| net_pnl | `Float64` |
| omega_ratio | `Float64` |

---

### vw_wallet_trading_pnl

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| condition_id | `String` |
| outcome_index | `Int64` |
| total_bought_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| total_fees_usdc | `Float64` |
| shares_bought | `Float64` |
| shares_sold | `Float64` |
| net_shares | `Float64` |
| trading_pnl | `Float64` |
| total_trades | `UInt64` |
| first_trade | `DateTime` |
| last_trade | `DateTime` |

---

### vw_wallet_ui_pnl_goldsky

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| ui_pnl_total_usd | `Float64` |
| ui_gains_usd | `Float64` |
| ui_losses_usd | `Float64` |
| position_count | `UInt64` |

---

### vw_wallet_ui_pnl_hybrid

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| open_positions | `UInt64` |
| closed_positions | `UInt64` |
| total_positions | `UInt64` |
| gains_pnl_usd | `Float64` |
| losses_cost_basis_usd | `Float64` |
| net_ui_pnl_usd | `Float64` |

---

### vw_wallet_ui_pnl_polymarket

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| positions | `UInt64` |
| gains_pnl_usd | `Float64` |
| losses_cost_basis_usd | `Float64` |
| net_ui_pnl_usd | `Float64` |

---

### vw_wallet_ui_pnl_v1

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet_address | `String` |
| condition_id | `String` |
| cost_basis_usdc | `Float64` |
| total_sold_usdc | `Float64` |
| net_cash_flow_usdc | `Float64` |
| resolution_payout_usdc | `Float64` |
| cash_pnl_usdc | `Float64` |
| ui_pnl_usdc | `Float64` |
| formula_delta | `Float64` |

---

### vw_wallet_win_rate

**Engine:** View
**Rows:** 0
**Size:** 0.00 MB

#### Columns

| Column | Type |
|--------|------|
| wallet | `String` |
| resolved_positions | `UInt64` |
| winning_positions | `UInt64` |
| losing_positions | `UInt64` |
| breakeven_positions | `UInt64` |
| win_rate_pct | `Float64` |
| total_wins | `Float64` |
| total_losses | `Float64` |
| avg_win | `Float64` |
| avg_loss | `Float64` |

---

## Table Relationships

### Core Data Flow

```
pm_trader_events_v2 (raw trades)
    │
    ├── token_id ──────────────────┐
    │                              ▼
    │                   pm_token_to_condition_map_v3
    │                              │
    │                              ├── condition_id
    │                              │       │
    │                              │       ▼
    │                              │   pm_condition_resolutions
    │                              │   (who won YES/NO)
    │                              │
    ▼                              ▼
pm_user_positions          pm_market_metadata_enriched
(Goldsky PnL - broken)     (market info, categories)
```

### Key Joins

1. **Trade to Condition:**
   ```sql
   pm_trader_events_v2 t
   JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
   ```

2. **Condition to Resolution:**
   ```sql
   pm_token_to_condition_map_v3 m
   JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
   ```

3. **Trade to Market Metadata:**
   ```sql
   pm_trader_events_v2 t
   JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
   JOIN pm_market_metadata_enriched meta ON m.condition_id = meta.condition_id
   ```

---

## Views (Computed)

### pm_market_pnl

**Columns:** condition_id, token_id_dec, slug, question, category, tags, realized_pnl, unrealized_pnl

### pm_market_pnl_with_resolution

**Columns:** condition_id, token_id_dec, slug, question, category, tags, realized_pnl, unrealized_pnl, resolved_at, resolution_block

### pm_trader_events_clean

**Columns:** event_id, trader_wallet, token_id, amount_usdc, trade_time, transaction_hash, block_number, insert_time, is_deleted

### pm_user_positions_clean

**Columns:** position_id, proxy_wallet, condition_id, realized_pnl, unrealized_pnl, total_bought, total_sold, updated_at, block_number, insert_time

### pm_wallet_metrics_PROVISIONAL

**Columns:** proxy_wallet, total_positions, winning_positions, losing_positions, pending_positions, net_pnl_usd, unrealized_pnl_usd, total_gains_usd, total_losses_usd, volume_usd, win_rate_pct, omega_ratio, roi_pct, first_activity, last_activity

### pm_wallet_pnl_PROVISIONAL

Aggregated wallet PnL from Goldsky (provisional)

**Columns:** proxy_wallet, realized_pnl, unrealized_pnl, markets_traded

### pm_wallet_pnl_by_category_PROVISIONAL

**Columns:** proxy_wallet, category, position_count, total_pnl_usd, unrealized_pnl_usd, total_bought_usd, total_sold_usd, wins, losses, pending

### pm_wallet_pnl_by_tag_PROVISIONAL

**Columns:** proxy_wallet, category, tag, position_count, total_pnl_usd, unrealized_pnl_usd, total_bought_usd, wins, losses

### vw_category_pnl_totals

**Columns:** category, unique_wallets, total_positions, total_pnl, total_gains, total_losses, winning_positions, losing_positions, win_rate, omega_ratio

### vw_condition_winners

**Columns:** condition_id, winning_outcome_index

### vw_fills_deduped

**Columns:** event_id, trader_wallet, token_id, side, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash

### vw_fills_normalized

**Columns:** event_id, trader_wallet, token_id, side, usdc, shares, fee, trade_time, condition_id, outcome_index, question, category

### vw_pm_ledger

**Columns:** event_id, wallet_address, token_id, condition_id, outcome_index, role, side, shares_delta, cash_delta_usdc, fee_usdc, block_time, tx_hash

### vw_pm_ledger_by_condition

**Columns:** wallet_address, condition_id, net_cash_flow_usdc, total_fees_usdc, total_bought_usdc, total_sold_usdc

### vw_pm_ledger_test

**Columns:** wallet_address, condition_id, outcome_index, position_id, event_time, event_type, share_delta, cash_delta, fee_usdc, tx_hash

### vw_pm_mark_to_market_prices

**Columns:** condition_id, outcome_index, current_price, best_bid, best_ask, last_updated_at

### vw_pm_positions_ui

**Columns:** wallet_address, position_id, token_id, condition_id, outcome_index, cost_basis_usd, realized_pnl_usd, unrealized_pnl_usd, total_sold_usd, is_resolved, position_status

### vw_pm_resolution_payouts

**Columns:** wallet_address, condition_id, resolution_payout_usdc

### vw_pm_wallet_condition_pnl_v4

**Columns:** wallet_address, condition_id, net_cash_flow_usdc, total_fees_usdc, total_bought_usdc, total_sold_usdc, resolution_payout_usdc, total_pnl_usdc

### vw_pnl_leaderboard

**Columns:** wallet, total_pnl, total_gains, total_losses, goldsky_positions, total_bought, markets_traded, total_trades, win_rate_pct, resolved_positions, w.winning_positions, w.losing_positions, avg_win, avg_loss

### vw_trader_events_dedup

**Columns:** event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash, block_number, latest_insert_time

### vw_trader_events_v2_dedup

**Columns:** event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash, block_number, insert_time, is_deleted

### vw_trades_enriched

**Columns:** t.event_id, trader_wallet, role, side, token_id, m.condition_id, usdc_amount, shares, fee_amount, price, md.question, md.slug, md.category, md.tags, outcomes, trade_time, transaction_hash, block_number

### vw_wallet_category_pnl

**Columns:** wallet, category, positions, markets, total_trades, total_bought, total_sold, trading_pnl, resolution_payouts, total_pnl

### vw_wallet_condition_ledger_v1

**Columns:** wallet, condition_id, outcome_index, event_timestamp, event_type, share_delta, usdc_delta

### vw_wallet_condition_pnl_v1

**Columns:** wallet, condition_id, outcome_index, trade_count, total_bought, total_sold, is_resolved, gains, losses, net_pnl, final_shares

### vw_wallet_gain_loss

**Columns:** wallet, total_gains, total_losses, net_pnl, winning_positions, losing_positions

### vw_wallet_market_fills

**Columns:** wallet, condition_id, question, category, tags, outcomes, total_bought_usdc, total_bought_shares, buy_count, avg_buy_price, total_sold_usdc, total_sold_shares, sell_count, avg_sell_price, total_fees, net_shares, first_trade, last_trade, total_trades

### vw_wallet_pnl_base

**Columns:** wallet, m.condition_id, question, category, tags, outcomes, total_bought_usdc, total_bought_shares, total_sold_usdc, total_sold_shares, net_shares, total_fees, total_trades, first_trade, last_trade, resolved_at, payout_numerators, payout_denominator, trading_pnl, is_resolved

### vw_wallet_pnl_by_category

**Columns:** wallet_address, category, condition_count, total_pnl, total_gains, total_losses, wins, losses, win_rate, roi, omega_ratio

### vw_wallet_pnl_canonical

**Columns:** wallet, m.condition_id, outcome_index, question, category, total_bought_usdc, total_sold_usdc, total_fees_usdc, shares_bought, shares_sold, net_shares, payout_numerators, payout_denominator, is_resolved, resolved_at, outcome_won, trading_pnl, resolution_payout, total_pnl, total_trades, first_trade, last_trade

### vw_wallet_pnl_computed

**Columns:** wallet, position_count, markets_traded, total_trades, total_bought, total_sold, total_fees, trading_pnl, resolution_payouts, computed_total_pnl, first_trade, last_trade

### vw_wallet_pnl_goldsky

**Columns:** wallet, position_count, total_realized_pnl, total_unrealized_pnl, total_bought, total_sold

### vw_wallet_pnl_materialized

**Columns:** wallet, condition_id, outcome_index, question, category, total_bought_usdc, total_sold_usdc, total_fees_usdc, bought_shares, sold_shares, net_shares, is_resolved, resolved_at, trading_pnl, resolution_payout, total_pnl, total_trades, first_trade, last_trade

### vw_wallet_pnl_totals

**Columns:** wallet_address, condition_count, total_pnl, total_gains, total_losses, net_cash_flow, resolution_payout, total_bought, total_sold, winning_conditions, losing_conditions, win_rate, roi, omega_ratio

### vw_wallet_pnl_totals_v1

**Columns:** wallet, total_events, total_trades, resolved_positions, unique_positions, total_gains, total_losses, net_pnl, omega_ratio

### vw_wallet_trading_pnl

**Columns:** wallet, condition_id, outcome_index, total_bought_usdc, total_sold_usdc, total_fees_usdc, shares_bought, shares_sold, net_shares, trading_pnl, total_trades, first_trade, last_trade

### vw_wallet_ui_pnl_goldsky

**Columns:** wallet_address, ui_pnl_total_usd, ui_gains_usd, ui_losses_usd, position_count

### vw_wallet_ui_pnl_hybrid

**Columns:** wallet, open_positions, closed_positions, total_positions, gains_pnl_usd, losses_cost_basis_usd, net_ui_pnl_usd

### vw_wallet_ui_pnl_polymarket

**Columns:** wallet, positions, gains_pnl_usd, losses_cost_basis_usd, net_ui_pnl_usd

### vw_wallet_ui_pnl_v1

**Columns:** wallet_address, condition_id, cost_basis_usdc, total_sold_usdc, net_cash_flow_usdc, resolution_payout_usdc, cash_pnl_usdc, ui_pnl_usdc, formula_delta

### vw_wallet_win_rate

**Columns:** wallet, resolved_positions, winning_positions, losing_positions, breakeven_positions, win_rate_pct, total_wins, total_losses, avg_win, avg_loss

---

## Data Quality Notes

### Known Issues

1. **pm_user_positions.realized_pnl** - Accumulates trade-level profits, causing 40x inflation for market makers
2. **pm_user_positions.unrealized_pnl** - Always 0 (not populated)
3. **pm_user_positions.total_sold** - Always 0 (not populated)
4. **pm_user_positions.condition_id** - Actually contains token_id in decimal format
5. **pm_ui_positions_new** - Empty for many wallets (backfill incomplete)

### Reliable Data Sources

1. **pm_trader_events_v2** - Most complete trade data
2. **pm_token_to_condition_map_v3** - Accurate token-to-condition mapping
3. **pm_condition_resolutions** - Accurate resolution outcomes

---

*Generated by generate-table-inventory.ts*
