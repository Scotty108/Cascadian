# ClickHouse Views Inventory

**Generated:** 2025-11-29T22:57:07.370Z
**Total Views:** 35

---

## Table of Contents

- [Leaderboard](#leaderboard) (1 views)
- [Ledger](#ledger) (9 views)
- [PnL](#pnl) (22 views)
- [Resolutions](#resolutions) (1 views)
- [Wallets](#wallets) (2 views)

---

## Leaderboard

### cascadian_leaderboard_blended

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.cascadian_leaderboard_blended\n(\n    `proxy_wallet` String,\n    `net_pnl` Float64,\n    `trade_count` UInt64,\n    `omega_ratio` Float64,\n    `cascadian_score` Float64\n)\nAS SELECT\n    p.proxy_wallet,\n    round(sum(p.realized_pnl), 2) AS net_pnl,\n    count() AS trade_count,\n    round(abs(sumIf(p.realized_pnl, p.realized_pnl > 0)) / greatest(abs(sumIf(p.realized_pnl, p.realized_pnl < 0)), 1), 2) AS omega_ratio,\n    round(greatest(sum(p.realized_pnl), 0) * log10((abs(sumIf(p.realized_pnl, p.realized_pnl > 0)) / greatest(abs(sumIf(p.realized_pnl, p.realized_pnl < 0)), 1)) + 1), 2) AS cascadian_score\nFROM default.pm_user_positions AS p\nINNER JOIN default.pm_market_metadata AS m ON has(m.token_ids, splitByChar(\'.\', p.condition_id)[1])\nGROUP BY p.proxy_wallet\nHAVING trade_count > 10\nORDER BY cascadian_score DESC
```

**Columns:**

| Column | Type |
|--------|------|
| proxy_wallet | String |
| net_pnl | Float64 |
| trade_count | UInt64 |
| omega_ratio | Float64 |
| cascadian_score | Float64 |

---

## Ledger

### pm_unified_ledger_v4

**Engine:** View
**Dependencies:** default, arrayMap

**Definition:**
```sql
CREATE VIEW default.pm_unified_ledger_v4\n(\n    `source` String,\n    `event_id` String,\n    `wallet` String,\n    `role` String,\n    `side` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `usdc_amount` Float64,\n    `token_amount` Float64,\n    `fee_amount` Float64,\n    `trade_time` DateTime,\n    `block_number` UInt64,\n    `tx_hash` String\n)\nAS SELECT\n    \'CLOB\' AS source,\n    t.event_id AS event_id,\n    t.trader_wallet AS wallet,\n    t.role AS role,\n    t.side AS side,\n    m.condition_id AS condition_id,\n    m.outcome_index AS outcome_index,\n    t.usdc_amount / 1000000. AS usdc_amount,\n    t.token_amount / 1000000. AS token_amount,\n    t.fee_amount / 1000000. AS fee_amount,\n    t.trade_time AS trade_time,\n    t.block_number AS block_number,\n    t.transaction_hash AS tx_hash\nFROM default.pm_trader_events_v2 AS t\nLEFT JOIN default.pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec\nWHERE t.is_deleted = 0\nUNION ALL\nSELECT\n    \'CTF\' AS source,\n    concat(c.id, \'-\', toString(outcome_idx)) AS event_id,\n    c.user_address AS wallet,\n    \'holder\' AS role,\n    multiIf(c.event_type = \'PositionSplit\', \'buy\', c.event_type = \'PositionMerge\', \'sell\', \'other\') AS side,\n    c.condition_id AS condition_id,\n    outcome_idx AS outcome_index,\n    toFloat64OrZero(c.amount_or_payout) / 1000000. AS usdc_amount,\n    toFloat64OrZero(c.amount_or_payout) / 1000000. AS token_amount,\n    0. AS fee_amount,\n    c.event_timestamp AS trade_time,\n    toUInt64(c.block_number) AS block_number,\n    c.tx_hash AS tx_hash\nFROM default.pm_ctf_events AS c\nLEFT JOIN\n(\n    SELECT\n        condition_id,\n        toUInt8OrZero(payout_denominator) AS outcome_count\n    FROM default.pm_condition_resolutions\n    WHERE payout_denominator != \'\'\n) AS r ON c.condition_id = r.condition_id\nARRAY JOIN arrayMap(x -> x, range(if(r.outcome_count > 0, r.outcome_count, 2))) AS outcome_idx\nWHERE (c.is_deleted = 0) AND (c.event_type IN (\'PositionSplit\', \'PositionMerge\'))\nUNION ALL\nSELECT\n    \'FPMM\' AS source,\n    f.event_id AS event_id,\n    f.trader_wallet AS wallet,\n    \'amm\' AS role,\n    f.side AS side,\n    m.condition_id AS condition_id,\n    f.outcome_index AS outcome_index,\n    if(f.block_number >= 35000000, f.usdc_amount / 1000000000000, f.usdc_amount) AS usdc_amount,\n    if(f.block_number >= 35000000, f.token_amount / 1000000000000, f.token_amount) AS token_amount,\n    if(f.block_number >= 35000000, f.fee_amount / 1000000000000, f.fee_amount) AS fee_amount,\n    if(f.trade_time = toDateTime(\'1970-01-01 00:00:00\'), toDateTime(\'2020-05-30 00:00:00\') + toIntervalSecond(toUInt64(f.block_number * 2.1)), f.trade_time) AS trade_time,\n    f.block_number AS block_number,\n    f.transaction_hash AS tx_hash\nFROM default.pm_fpmm_trades AS f\nLEFT JOIN default.pm_fpmm_pool_map AS m ON lower(f.fpmm_pool_address) = lower(m.fpmm_pool_address)\nWHERE f.is_deleted = 0
```

**Columns:**

| Column | Type |
|--------|------|
| source | String |
| event_id | String |
| wallet | String |
| role | String |
| side | String |
| condition_id | String |
| outcome_index | Int64 |
| usdc_amount | Float64 |
| token_amount | Float64 |
| fee_amount | Float64 |
| trade_time | DateTime |
| block_number | UInt64 |
| tx_hash | String |

---

### pm_unified_ledger_v5

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.pm_unified_ledger_v5\n(\n    `source_type` String,\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `event_time` DateTime,\n    `event_id` String,\n    `usdc_delta` Float64,\n    `token_delta` Float64,\n    `payout_numerators` String,\n    `payout_norm` Nullable(Int64)\n)\nAS SELECT\n    \'CLOB\' AS source_type,\n    t.wallet AS wallet_address,\n    m.condition_id AS condition_id,\n    m.outcome_index AS outcome_index,\n    t.trade_time AS event_time,\n    t.event_id AS event_id,\n    if(t.side = \'buy\', -t.usdc_amount, t.usdc_amount) AS usdc_delta,\n    if(t.side = \'buy\', t.token_amount, -t.token_amount) AS token_delta,\n    r.payout_numerators AS payout_numerators,\n    if(r.payout_numerators IS NOT NULL, if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1, JSONExtractInt(r.payout_numerators, m.outcome_index + 1)), NULL) AS payout_norm\nFROM\n(\n    SELECT\n        event_id,\n        trader_wallet AS wallet,\n        any(side) AS side,\n        any(usdc_amount) / 1000000. AS usdc_amount,\n        any(token_amount) / 1000000. AS token_amount,\n        any(trade_time) AS trade_time,\n        any(token_id) AS token_id\n    FROM default.pm_trader_events_v2\n    WHERE is_deleted = 0\n    GROUP BY\n        event_id,\n        trader_wallet\n) AS t\nLEFT JOIN default.pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec\nLEFT JOIN default.pm_condition_resolutions AS r ON m.condition_id = r.condition_id\nUNION ALL\nSELECT\n    \'PositionSplit\' AS source_type,\n    c.user_address AS wallet_address,\n    c.condition_id AS condition_id,\n    0 AS outcome_index,\n    c.event_timestamp AS event_time,\n    c.id AS event_id,\n    (-toFloat64OrZero(c.amount_or_payout)) / 1000000. AS usdc_delta,\n    toFloat64OrZero(c.amount_or_payout) / 1000000. AS token_delta,\n    r.payout_numerators AS payout_numerators,\n    NULL AS payout_norm\nFROM default.pm_ctf_events AS c\nLEFT JOIN default.pm_condition_resolutions AS r ON c.condition_id = r.condition_id\nWHERE (c.is_deleted = 0) AND (c.event_type = \'PositionSplit\')\nUNION ALL\nSELECT\n    \'PositionsMerge\' AS source_type,\n    c.user_address AS wallet_address,\n    c.condition_id AS condition_id,\n    0 AS outcome_index,\n    c.event_timestamp AS event_time,\n    c.id AS event_id,\n    toFloat64OrZero(c.amount_or_payout) / 1000000. AS usdc_delta,\n    (-toFloat64OrZero(c.amount_or_payout)) / 1000000. AS token_delta,\n    r.payout_numerators AS payout_numerators,\n    NULL AS payout_norm\nFROM default.pm_ctf_events AS c\nLEFT JOIN default.pm_condition_resolutions AS r ON c.condition_id = r.condition_id\nWHERE (c.is_deleted = 0) AND (c.event_type = \'PositionsMerge\')\nUNION ALL\nSELECT\n    \'PayoutRedemption\' AS source_type,\n    c.user_address AS wallet_address,\n    c.condition_id AS condition_id,\n    0 AS outcome_index,\n    c.event_timestamp AS event_time,\n    c.id AS event_id,\n    toFloat64OrZero(c.amount_or_payout) / 1000000. AS usdc_delta,\n    (-toFloat64OrZero(c.amount_or_payout)) / 1000000. AS token_delta,\n    r.payout_numerators AS payout_numerators,\n    1 AS payout_norm\nFROM default.pm_ctf_events AS c\nLEFT JOIN default.pm_condition_resolutions AS r ON c.condition_id = r.condition_id\nWHERE (c.is_deleted = 0) AND (c.event_type = \'PayoutRedemption\')
```

**Columns:**

| Column | Type |
|--------|------|
| source_type | String |
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| event_time | DateTime |
| event_id | String |
| usdc_delta | Float64 |
| token_delta | Float64 |
| payout_numerators | String |
| payout_norm | Nullable(Int64) |

---

### vw_ctf_ledger

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_ctf_ledger\n(\n    `wallet` LowCardinality(String),\n    `condition_id` String,\n    `ctf_deposits` Float64,\n    `ctf_payouts` Float64,\n    `net_ctf_cash` Float64,\n    `tokens_minted` Float64,\n    `tokens_burned` Float64,\n    `flow_count` UInt64,\n    `first_flow_time` DateTime,\n    `last_flow_time` DateTime\n)\nAS SELECT\n    wallet,\n    condition_id,\n    sumIf(abs(usdc_delta), (usdc_delta < 0) AND (flow_type IN (\'SPLIT\', \'MINT\'))) AS ctf_deposits,\n    sumIf(usdc_delta, (usdc_delta > 0) AND (flow_type IN (\'MERGE\', \'REDEEM\', \'BURN\'))) AS ctf_payouts,\n    ctf_payouts - ctf_deposits AS net_ctf_cash,\n    sumIf(token_amount, flow_type IN (\'SPLIT\', \'MINT\')) AS tokens_minted,\n    sumIf(token_amount, flow_type IN (\'MERGE\', \'REDEEM\', \'BURN\')) AS tokens_burned,\n    count() AS flow_count,\n    min(block_time) AS first_flow_time,\n    max(block_time) AS last_flow_time\nFROM default.pm_ctf_flows_inferred\nWHERE is_deleted = 0\nGROUP BY\n    wallet,\n    condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | LowCardinality(String) |
| condition_id | String |
| ctf_deposits | Float64 |
| ctf_payouts | Float64 |
| net_ctf_cash | Float64 |
| tokens_minted | Float64 |
| tokens_burned | Float64 |
| flow_count | UInt64 |
| first_flow_time | DateTime |
| last_flow_time | DateTime |

---

### vw_ctf_ledger_proxy

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_ctf_ledger_proxy\n(\n    `wallet` LowCardinality(String),\n    `condition_id` String,\n    `ctf_deposits` Float64,\n    `ctf_payouts` Float64,\n    `net_ctf_cash` Float64,\n    `tokens_minted` Float64,\n    `tokens_burned` Float64,\n    `flow_count` UInt64,\n    `first_flow_time` DateTime,\n    `last_flow_time` DateTime,\n    `wallet_type` LowCardinality(String)\n)\nAS SELECT\n    l.wallet,\n    l.condition_id,\n    l.ctf_deposits,\n    l.ctf_payouts,\n    l.net_ctf_cash,\n    l.tokens_minted,\n    l.tokens_burned,\n    l.flow_count,\n    l.first_flow_time,\n    l.last_flow_time,\n    coalesce(c.wallet_type, \'proxy\') AS wallet_type\nFROM default.vw_ctf_ledger AS l\nLEFT JOIN default.pm_wallet_classification AS c ON l.wallet = c.wallet\nWHERE coalesce(c.wallet_type, \'proxy\') != \'infra\'
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | LowCardinality(String) |
| condition_id | String |
| ctf_deposits | Float64 |
| ctf_payouts | Float64 |
| net_ctf_cash | Float64 |
| tokens_minted | Float64 |
| tokens_burned | Float64 |
| flow_count | UInt64 |
| first_flow_time | DateTime |
| last_flow_time | DateTime |
| wallet_type | LowCardinality(String) |

---

### vw_ctf_ledger_user

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_ctf_ledger_user\n(\n    `wallet` LowCardinality(String),\n    `condition_id` String,\n    `ctf_deposits` Float64,\n    `ctf_payouts` Float64,\n    `net_ctf_cash` Float64,\n    `tokens_minted` Float64,\n    `tokens_burned` Float64,\n    `flow_count` UInt64,\n    `first_flow_time` DateTime,\n    `last_flow_time` DateTime,\n    `wallet_type` LowCardinality(String)\n)\nAS SELECT\n    l.*,\n    coalesce(c.wallet_type, \'proxy\') AS wallet_type\nFROM default.vw_ctf_ledger AS l\nLEFT JOIN default.pm_wallet_classification AS c ON (l.wallet = c.wallet) AND (c.is_deleted = 0)\nWHERE coalesce(c.wallet_type, \'proxy\') NOT IN (\'infra\', \'market_maker\')
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | LowCardinality(String) |
| condition_id | String |
| ctf_deposits | Float64 |
| ctf_payouts | Float64 |
| net_ctf_cash | Float64 |
| tokens_minted | Float64 |
| tokens_burned | Float64 |
| flow_count | UInt64 |
| first_flow_time | DateTime |
| last_flow_time | DateTime |
| wallet_type | LowCardinality(String) |

---

### vw_pm_ctf_ledger

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_ctf_ledger\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` UInt8,\n    `shares_delta` Float64,\n    `cash_delta_usdc` Float64,\n    `fee_usdc` UInt8,\n    `event_type` String,\n    `block_time` DateTime,\n    `block_number` Int64,\n    `tx_hash` String,\n    `source` String\n)\nAS SELECT\n    lower(user_address) AS wallet_address,\n    lower(condition_id) AS condition_id,\n    0 AS outcome_index,\n    -(toFloat64OrZero(amount_or_payout) / 1000000.) AS shares_delta,\n    toFloat64OrZero(amount_or_payout) / 1000000. AS cash_delta_usdc,\n    0 AS fee_usdc,\n    event_type,\n    event_timestamp AS block_time,\n    block_number,\n    tx_hash,\n    concat(\'CTF_\', event_type) AS source\nFROM default.pm_ctf_events\nWHERE (is_deleted = 0) AND (event_timestamp > toDateTime(\'1970-01-01 01:00:00\'))
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | UInt8 |
| shares_delta | Float64 |
| cash_delta_usdc | Float64 |
| fee_usdc | UInt8 |
| event_type | String |
| block_time | DateTime |
| block_number | Int64 |
| tx_hash | String |
| source | String |

---

### vw_pm_ledger

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_ledger\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `token_id` String,\n    `block_time` DateTime,\n    `block_number` UInt64,\n    `tx_hash` String,\n    `role` String,\n    `side_raw` String,\n    `shares` Float64,\n    `usdc` Float64,\n    `fee` Float64,\n    `shares_delta` Nullable(Float64),\n    `cash_delta_usdc` Nullable(Float64),\n    `fee_usdc` Float64,\n    `event_type` String\n)\nAS SELECT\n    lower(t.trader_wallet) AS wallet_address,\n    m.condition_id,\n    m.outcome_index,\n    toString(t.token_id) AS token_id,\n    t.trade_time AS block_time,\n    t.block_number,\n    t.transaction_hash AS tx_hash,\n    lower(t.role) AS role,\n    lower(t.side) AS side_raw,\n    t.token_amount / 1000000. AS shares,\n    t.usdc_amount / 1000000. AS usdc,\n    t.fee_amount / 1000000. AS fee,\n    multiIf(lower(t.side) = \'buy\', t.token_amount / 1000000., lower(t.side) = \'sell\', (-t.token_amount) / 1000000., NULL) AS shares_delta,\n    multiIf(lower(t.side) = \'buy\', (-(t.usdc_amount + t.fee_amount)) / 1000000., lower(t.side) = \'sell\', (t.usdc_amount - t.fee_amount) / 1000000., NULL) AS cash_delta_usdc,\n    t.fee_amount / 1000000. AS fee_usdc,\n    \'TRADE\' AS event_type\nFROM default.pm_trader_events_v2 AS t\nINNER JOIN default.pm_token_to_condition_map_v3 AS m ON toString(t.token_id) = toString(m.token_id_dec)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| token_id | String |
| block_time | DateTime |
| block_number | UInt64 |
| tx_hash | String |
| role | String |
| side_raw | String |
| shares | Float64 |
| usdc | Float64 |
| fee | Float64 |
| shares_delta | Nullable(Float64) |
| cash_delta_usdc | Nullable(Float64) |
| fee_usdc | Float64 |
| event_type | String |

---

### vw_pm_ledger_v2

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_ledger_v2\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `shares_delta` Nullable(Float64),\n    `cash_delta_usdc` Nullable(Float64),\n    `fee_usdc` Float64,\n    `block_time` DateTime,\n    `block_number` UInt64,\n    `tx_hash` String,\n    `source` String\n)\nAS SELECT\n    wallet_address,\n    condition_id,\n    outcome_index,\n    shares_delta,\n    cash_delta_usdc,\n    fee_usdc,\n    block_time,\n    toUInt64(block_number) AS block_number,\n    tx_hash,\n    \'TRADE\' AS source\nFROM default.vw_pm_ledger\nUNION ALL\nSELECT\n    wallet_address,\n    condition_id,\n    outcome_index,\n    shares_delta,\n    cash_delta_usdc,\n    fee_usdc,\n    block_time,\n    toUInt64(block_number) AS block_number,\n    tx_hash,\n    source\nFROM default.vw_pm_ctf_ledger
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| shares_delta | Nullable(Float64) |
| cash_delta_usdc | Nullable(Float64) |
| fee_usdc | Float64 |
| block_time | DateTime |
| block_number | UInt64 |
| tx_hash | String |
| source | String |

---

### vw_pm_ledger_v3

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_ledger_v3\n(\n    `wallet` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `cash_delta` Float64,\n    `shares_delta` Float64,\n    `event_timestamp` DateTime,\n    `block_number` UInt64,\n    `tx_hash` String,\n    `source` String\n)\nAS SELECT\n    t.trader_wallet AS wallet,\n    lower(multiIf(startsWith(m.condition_id, \'0x\'), substring(m.condition_id, 3), m.condition_id)) AS condition_id,\n    m.outcome_index,\n    multiIf(lower(t.side) = \'buy\', -(t.usdc_amount / 1000000), t.usdc_amount / 1000000) AS cash_delta,\n    multiIf(lower(t.side) = \'buy\', t.token_amount / 1000000, -(t.token_amount / 1000000)) AS shares_delta,\n    t.trade_time AS event_timestamp,\n    toUInt64(t.block_number) AS block_number,\n    t.transaction_hash AS tx_hash,\n    \'CLOB\' AS source\nFROM default.pm_trader_events_v2 AS t\nINNER JOIN default.pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec\nUNION ALL\nSELECT\n    wallet,\n    condition_id,\n    outcome_index,\n    cash_delta,\n    shares_delta,\n    event_timestamp,\n    block_number,\n    tx_hash,\n    multiIf(event_type = \'PositionSplit\', \'CTF_SPLIT\', event_type = \'PositionsMerge\', \'CTF_MERGE\', event_type) AS source\nFROM default.pm_ctf_split_merge_expanded
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| condition_id | String |
| outcome_index | Int64 |
| cash_delta | Float64 |
| shares_delta | Float64 |
| event_timestamp | DateTime |
| block_number | UInt64 |
| tx_hash | String |
| source | String |

---

## PnL

### vw_pm_market_pnl_v1

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_market_pnl_v1\n(\n    `condition_id` String,\n    `is_resolved` UInt8,\n    `participant_count` UInt64,\n    `market_pnl_sum` Float64,\n    `total_trade_volume` Float64,\n    `net_shares` Float64,\n    `first_trade` DateTime,\n    `last_trade` DateTime,\n    `resolved_at` DateTime\n)\nAS SELECT\n    condition_id,\n    is_resolved,\n    COUNTDistinct(trader_wallet) AS participant_count,\n    sum(realized_pnl) AS market_pnl_sum,\n    sum(trade_cash_flow) AS total_trade_volume,\n    sum(final_shares) AS net_shares,\n    min(first_trade) AS first_trade,\n    max(last_trade) AS last_trade,\n    max(resolved_at) AS resolved_at\nFROM default.vw_pm_realized_pnl_v1\nGROUP BY\n    condition_id,\n    is_resolved
```

**Columns:**

| Column | Type |
|--------|------|
| condition_id | String |
| is_resolved | UInt8 |
| participant_count | UInt64 |
| market_pnl_sum | Float64 |
| total_trade_volume | Float64 |
| net_shares | Float64 |
| first_trade | DateTime |
| last_trade | DateTime |
| resolved_at | DateTime |

---

### vw_pm_pnl_with_ctf

**Engine:** View
**Dependencies:** default, aggregated, with_resolution

**Definition:**
```sql
CREATE VIEW default.vw_pm_pnl_with_ctf\n(\n    `wallet` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `total_cash` Float64,\n    `final_shares` Float64,\n    `event_count` UInt64,\n    `first_event` DateTime,\n    `last_event` DateTime,\n    `clob_events` UInt64,\n    `split_events` UInt64,\n    `merge_events` UInt64,\n    `resolved_price` Nullable(Float64),\n    `is_resolved` UInt8,\n    `resolved_at` DateTime,\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64)\n)\nAS WITH\n    aggregated AS\n    (\n        SELECT\n            wallet,\n            condition_id,\n            outcome_index,\n            sum(cash_delta) AS total_cash,\n            sum(shares_delta) AS final_shares,\n            count() AS event_count,\n            min(event_timestamp) AS first_event,\n            max(event_timestamp) AS last_event,\n            countIf(source = \'CLOB\') AS clob_events,\n            countIf(source = \'CTF_SPLIT\') AS split_events,\n            countIf(source = \'CTF_MERGE\') AS merge_events\n        FROM default.vw_pm_ledger_v3\n        GROUP BY\n            wallet,\n            condition_id,\n            outcome_index\n    ),\n    with_resolution AS\n    (\n        SELECT\n            a.*,\n            multiIf((r.payout_numerators LIKE \'[0,%\') AND (a.outcome_index = 0), 0., (r.payout_numerators LIKE \'[0,%\') AND (a.outcome_index = 1), 1., (r.payout_numerators LIKE \'[1,%\') AND (a.outcome_index = 0), 1., (r.payout_numerators LIKE \'[1,%\') AND (a.outcome_index = 1), 0., NULL) AS resolved_price,\n            r.condition_id IS NOT NULL AS is_resolved,\n            r.resolved_at\n        FROM\n        aggregated AS a\n        LEFT JOIN default.pm_condition_resolutions AS r ON a.condition_id = r.condition_id\n    )\nSELECT\n    wallet,\n    condition_id,\n    outcome_index,\n    total_cash,\n    final_shares,\n    event_count,\n    first_event,\n    last_event,\n    clob_events,\n    split_events,\n    merge_events,\n    resolved_price,\n    is_resolved,\n    resolved_at,\n    multiIf(is_resolved, final_shares * resolved_price, NULL) AS resolution_cash,\n    multiIf(is_resolved, total_cash + (final_shares * resolved_price), NULL) AS realized_pnl\nFROM\nwith_resolution
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| condition_id | String |
| outcome_index | Int64 |
| total_cash | Float64 |
| final_shares | Float64 |
| event_count | UInt64 |
| first_event | DateTime |
| last_event | DateTime |
| clob_events | UInt64 |
| split_events | UInt64 |
| merge_events | UInt64 |
| resolved_price | Nullable(Float64) |
| is_resolved | UInt8 |
| resolved_at | DateTime |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |

---

### vw_pm_realized_pnl_v1

**Engine:** View
**Dependencies:** default, deduped_trades, with_condition, aggregated, with_resolution

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v1\n(\n    `trader_wallet` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `trade_cash_flow` Float64,\n    `final_shares` Float64,\n    `resolution_price` Nullable(Float64),\n    `realized_pnl` Float64,\n    `trade_count` UInt64,\n    `first_trade` DateTime,\n    `last_trade` DateTime,\n    `resolved_at` DateTime,\n    `is_resolved` UInt8\n)\nAS WITH\n    deduped_trades AS\n    (\n        SELECT\n            event_id,\n            any(trader_wallet) AS trader_wallet,\n            any(side) AS side,\n            any(usdc_amount) AS usdc_amount,\n            any(token_amount) AS token_amount,\n            any(token_id) AS token_id,\n            any(trade_time) AS trade_time\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY event_id\n    ),\n    with_condition AS\n    (\n        SELECT\n            t.event_id,\n            t.trader_wallet,\n            t.side,\n            t.usdc_amount,\n            t.token_amount,\n            t.trade_time,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        deduped_trades AS t\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON toString(t.token_id) = toString(m.token_id_dec)\n    ),\n    aggregated AS\n    (\n        SELECT\n            trader_wallet,\n            condition_id,\n            outcome_index,\n            sum(multiIf(side = \'buy\', -usdc_amount, usdc_amount)) / 1000000. AS trade_cash_flow,\n            sum(multiIf(side = \'buy\', token_amount, -token_amount)) / 1000000. AS final_shares,\n            count(*) AS trade_count,\n            min(trade_time) AS first_trade,\n            max(trade_time) AS last_trade\n        FROM\n        with_condition\n        GROUP BY\n            trader_wallet,\n            condition_id,\n            outcome_index\n    ),\n    with_resolution AS\n    (\n        SELECT\n            a.trader_wallet,\n            a.condition_id,\n            a.outcome_index,\n            a.trade_cash_flow,\n            a.final_shares,\n            a.trade_count,\n            a.first_trade,\n            a.last_trade,\n            r.payout_numerators,\n            r.resolved_at,\n            multiIf((r.payout_numerators LIKE \'[0,%\') AND (a.outcome_index = 0), 0., (r.payout_numerators LIKE \'[0,%\') AND (a.outcome_index = 1), 1., (r.payout_numerators LIKE \'[1,%\') AND (a.outcome_index = 0), 1., (r.payout_numerators LIKE \'[1,%\') AND (a.outcome_index = 1), 0., NULL) AS resolution_price\n        FROM\n        aggregated AS a\n        LEFT JOIN default.pm_condition_resolutions AS r ON (lower(a.condition_id) = lower(r.condition_id)) AND (r.is_deleted = 0)\n    )\nSELECT\n    trader_wallet,\n    condition_id,\n    outcome_index,\n    trade_cash_flow,\n    final_shares,\n    resolution_price,\n    trade_cash_flow + (final_shares * coalesce(resolution_price, 0)) AS realized_pnl,\n    trade_count,\n    first_trade,\n    last_trade,\n    resolved_at,\n    resolution_price IS NOT NULL AS is_resolved\nFROM\nwith_resolution
```

**Columns:**

| Column | Type |
|--------|------|
| trader_wallet | String |
| condition_id | String |
| outcome_index | Int64 |
| trade_cash_flow | Float64 |
| final_shares | Float64 |
| resolution_price | Nullable(Float64) |
| realized_pnl | Float64 |
| trade_count | UInt64 |
| first_trade | DateTime |
| last_trade | DateTime |
| resolved_at | DateTime |
| is_resolved | UInt8 |

---

### vw_pm_realized_pnl_v2

**Engine:** View
**Dependencies:** default, trade_aggregates

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v2\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `trade_cash` Nullable(Float64),\n    `final_shares` Nullable(Float64),\n    `total_fees` Float64,\n    `trade_count` UInt64,\n    `first_trade_time` DateTime,\n    `last_trade_time` DateTime,\n    `resolved_price` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `is_resolved` UInt8,\n    `is_winner` Nullable(UInt8)\n)\nAS WITH trade_aggregates AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            sum(cash_delta_usdc) AS trade_cash,\n            sum(shares_delta) AS final_shares,\n            sum(fee_usdc) AS total_fees,\n            count() AS trade_count,\n            min(block_time) AS first_trade_time,\n            max(block_time) AS last_trade_time\n        FROM default.vw_pm_ledger_v2\n        GROUP BY\n            wallet_address,\n            condition_id,\n            outcome_index\n    )\nSELECT\n    t.wallet_address,\n    t.condition_id,\n    t.outcome_index,\n    t.trade_cash,\n    t.final_shares,\n    t.total_fees,\n    t.trade_count,\n    t.first_trade_time,\n    t.last_trade_time,\n    r.resolved_price,\n    r.resolution_time,\n    multiIf(r.resolved_price IS NOT NULL, t.final_shares * r.resolved_price, 0) AS resolution_cash,\n    multiIf(r.resolved_price IS NOT NULL, t.trade_cash + (t.final_shares * r.resolved_price), NULL) AS realized_pnl,\n    r.resolved_price IS NOT NULL AS is_resolved,\n    r.resolved_price > 0 AS is_winner\nFROM\ntrade_aggregates AS t\nLEFT JOIN default.vw_pm_resolution_prices AS r ON (t.condition_id = r.condition_id) AND (t.outcome_index = r.outcome_index)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| trade_cash | Nullable(Float64) |
| final_shares | Nullable(Float64) |
| total_fees | Float64 |
| trade_count | UInt64 |
| first_trade_time | DateTime |
| last_trade_time | DateTime |
| resolved_price | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| is_resolved | UInt8 |
| is_winner | Nullable(UInt8) |

---

### vw_pm_realized_pnl_v2_with_quality

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v2_with_quality\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `trade_cash` Nullable(Float64),\n    `final_shares` Nullable(Float64),\n    `total_fees` Float64,\n    `trade_count` UInt64,\n    `first_trade_time` DateTime,\n    `last_trade_time` DateTime,\n    `resolved_price` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `is_resolved` UInt8,\n    `is_winner` Nullable(UInt8),\n    `data_quality` Enum8(\'ok\' = 1, \'partial\' = 2, \'missing_trades\' = 3, \'missing_amm\' = 4),\n    `quality_note` String\n)\nAS SELECT\n    p.*,\n    coalesce(q.data_quality, \'ok\') AS data_quality,\n    q.note AS quality_note\nFROM default.vw_pm_realized_pnl_v2 AS p\nLEFT JOIN default.pm_market_data_quality AS q ON p.condition_id = lower(q.condition_id)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| trade_cash | Nullable(Float64) |
| final_shares | Nullable(Float64) |
| total_fees | Float64 |
| trade_count | UInt64 |
| first_trade_time | DateTime |
| last_trade_time | DateTime |
| resolved_price | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| is_resolved | UInt8 |
| is_winner | Nullable(UInt8) |
| data_quality | Enum8('ok' = 1, 'partial' = 2, 'missing_trades' = 3, 'missing_amm' = 4) |
| quality_note | String |

---

### vw_pm_realized_pnl_v3

**Engine:** View
**Dependencies:** default, per_outcome, with_resolution

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v3\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8\n)\nAS WITH\n    per_outcome AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            sum(cash_delta_usdc) AS outcome_trade_cash,\n            sum(shares_delta) AS outcome_final_shares\n        FROM default.vw_pm_ledger_v2\n        GROUP BY\n            wallet_address,\n            condition_id,\n            outcome_index\n    ),\n    with_resolution AS\n    (\n        SELECT\n            p.wallet_address,\n            p.condition_id,\n            p.outcome_index,\n            p.outcome_trade_cash,\n            p.outcome_final_shares,\n            r.resolved_price,\n            r.resolution_time\n        FROM\n        per_outcome AS p\n        LEFT JOIN default.vw_pm_resolution_prices AS r ON (p.condition_id = r.condition_id) AND (p.outcome_index = r.outcome_index)\n    )\nSELECT\n    wallet_address,\n    condition_id,\n    sum(outcome_trade_cash) AS trade_cash,\n    sum(outcome_final_shares) * max(if(resolved_price > 0, resolved_price, 0)) AS resolution_cash,\n    sum(outcome_trade_cash) + (sum(outcome_final_shares) * max(if(resolved_price > 0, resolved_price, 0))) AS realized_pnl,\n    max(resolution_time) AS resolution_time,\n    max(resolved_price IS NOT NULL) AS is_resolved\nFROM\nwith_resolution\nGROUP BY\n    wallet_address,\n    condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |

---

### vw_pm_realized_pnl_v3_detail

**Engine:** View
**Dependencies:** default, per_outcome

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v3_detail\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `trade_cash` Nullable(Float64),\n    `final_shares` Nullable(Float64),\n    `resolved_price` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `resolution_cash` Nullable(Float64),\n    `is_resolved` UInt8\n)\nAS WITH per_outcome AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            sum(cash_delta_usdc) AS outcome_trade_cash,\n            sum(shares_delta) AS outcome_final_shares\n        FROM default.vw_pm_ledger_v2\n        GROUP BY\n            wallet_address,\n            condition_id,\n            outcome_index\n    )\nSELECT\n    p.wallet_address,\n    p.condition_id,\n    p.outcome_index,\n    p.outcome_trade_cash AS trade_cash,\n    p.outcome_final_shares AS final_shares,\n    r.resolved_price,\n    r.resolution_time,\n    if(r.resolved_price > 0, p.outcome_final_shares * r.resolved_price, 0) AS resolution_cash,\n    r.resolved_price IS NOT NULL AS is_resolved\nFROM\nper_outcome AS p\nLEFT JOIN default.vw_pm_resolution_prices AS r ON (p.condition_id = r.condition_id) AND (p.outcome_index = r.outcome_index)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| trade_cash | Nullable(Float64) |
| final_shares | Nullable(Float64) |
| resolved_price | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| resolution_cash | Nullable(Float64) |
| is_resolved | UInt8 |

---

### vw_pm_realized_pnl_v3_detail_with_quality

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v3_detail_with_quality\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `trade_cash` Nullable(Float64),\n    `final_shares` Nullable(Float64),\n    `resolved_price` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `resolution_cash` Nullable(Float64),\n    `is_resolved` UInt8,\n    `data_quality` Enum8(\'ok\' = 1, \'partial\' = 2, \'missing_trades\' = 3, \'missing_amm\' = 4, \'missing_resolution\' = 5),\n    `quality_note` String\n)\nAS SELECT\n    p.*,\n    coalesce(q.data_quality, \'ok\') AS data_quality,\n    q.note AS quality_note\nFROM default.vw_pm_realized_pnl_v3_detail AS p\nLEFT JOIN default.pm_market_data_quality AS q ON p.condition_id = lower(q.condition_id)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| outcome_index | Int64 |
| trade_cash | Nullable(Float64) |
| final_shares | Nullable(Float64) |
| resolved_price | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| resolution_cash | Nullable(Float64) |
| is_resolved | UInt8 |
| data_quality | Enum8('ok' = 1, 'partial' = 2, 'missing_trades' = 3, 'missing_amm' = 4, 'missing_resolution' = 5) |
| quality_note | String |

---

### vw_pm_realized_pnl_v3_market

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v3_market\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `final_shares` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8\n)\nAS SELECT\n    wallet_address,\n    condition_id,\n    sum(trade_cash) AS trade_cash,\n    sum(final_shares) AS final_shares,\n    sum(resolution_cash) AS resolution_cash,\n    sum(realized_pnl) AS realized_pnl,\n    max(resolution_time) AS resolution_time,\n    max(is_resolved) AS is_resolved\nFROM default.vw_pm_realized_pnl_v3\nGROUP BY\n    wallet_address,\n    condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| final_shares | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |

---

### vw_pm_realized_pnl_v3_with_quality

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v3_with_quality\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8,\n    `data_quality` Enum8(\'ok\' = 1, \'partial\' = 2, \'missing_trades\' = 3, \'missing_amm\' = 4, \'missing_resolution\' = 5),\n    `quality_note` String,\n    `flagged_at` DateTime,\n    `verified_at` Nullable(DateTime)\n)\nAS SELECT\n    p.*,\n    coalesce(q.data_quality, \'ok\') AS data_quality,\n    q.note AS quality_note,\n    q.flagged_at,\n    q.verified_at\nFROM default.vw_pm_realized_pnl_v3 AS p\nLEFT JOIN default.pm_market_data_quality AS q ON p.condition_id = lower(q.condition_id)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |
| data_quality | Enum8('ok' = 1, 'partial' = 2, 'missing_trades' = 3, 'missing_amm' = 4, 'missing_resolution' = 5) |
| quality_note | String |
| flagged_at | DateTime |
| verified_at | Nullable(DateTime) |

---

### vw_pm_realized_pnl_v4

**Engine:** View
**Dependencies:** default, per_outcome, with_resolution, per_outcome_pnl

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v4\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8\n)\nAS WITH\n    per_outcome AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            sum(cash_delta_usdc) AS outcome_trade_cash,\n            sum(shares_delta) AS outcome_final_shares\n        FROM default.vw_pm_ledger_v2\n        GROUP BY\n            wallet_address,\n            condition_id,\n            outcome_index\n    ),\n    with_resolution AS\n    (\n        SELECT\n            p.wallet_address,\n            p.condition_id,\n            p.outcome_index,\n            p.outcome_trade_cash,\n            p.outcome_final_shares,\n            r.resolved_price,\n            r.resolution_time\n        FROM\n        per_outcome AS p\n        LEFT JOIN default.vw_pm_resolution_prices AS r ON (p.condition_id = r.condition_id) AND (p.outcome_index = r.outcome_index)\n    ),\n    per_outcome_pnl AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            outcome_trade_cash,\n            if(resolved_price IS NOT NULL, outcome_final_shares * resolved_price, 0) AS outcome_resolution_cash,\n            resolved_price,\n            resolution_time\n        FROM\n        with_resolution\n    )\nSELECT\n    wallet_address,\n    condition_id,\n    sum(outcome_trade_cash) AS trade_cash,\n    sum(outcome_resolution_cash) AS resolution_cash,\n    sum(outcome_trade_cash) + sum(outcome_resolution_cash) AS realized_pnl,\n    max(resolution_time) AS resolution_time,\n    max(resolved_price IS NOT NULL) AS is_resolved\nFROM\nper_outcome_pnl\nGROUP BY\n    wallet_address,\n    condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |

---

### vw_pm_realized_pnl_v4_with_quality

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v4_with_quality\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8,\n    `data_quality` Enum8(\'ok\' = 1, \'partial\' = 2, \'missing_trades\' = 3, \'missing_amm\' = 4, \'missing_resolution\' = 5),\n    `quality_note` String\n)\nAS SELECT\n    p.*,\n    coalesce(q.data_quality, \'ok\') AS data_quality,\n    q.note AS quality_note\nFROM default.vw_pm_realized_pnl_v4 AS p\nLEFT JOIN default.pm_market_data_quality AS q ON p.condition_id = q.condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |
| data_quality | Enum8('ok' = 1, 'partial' = 2, 'missing_trades' = 3, 'missing_amm' = 4, 'missing_resolution' = 5) |
| quality_note | String |

---

### vw_pm_realized_pnl_v5

**Engine:** View
**Dependencies:** default, per_outcome, with_resolution, per_outcome_pnl

**Definition:**
```sql
CREATE VIEW default.vw_pm_realized_pnl_v5\n(\n    `wallet_address` String,\n    `condition_id` String,\n    `trade_cash` Nullable(Float64),\n    `resolution_cash` Nullable(Float64),\n    `realized_pnl` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `is_resolved` UInt8\n)\nAS WITH\n    per_outcome AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            sum(cash_delta_usdc) AS outcome_trade_cash,\n            sum(shares_delta) AS outcome_final_shares\n        FROM default.vw_pm_ledger\n        GROUP BY\n            wallet_address,\n            condition_id,\n            outcome_index\n    ),\n    with_resolution AS\n    (\n        SELECT\n            p.wallet_address,\n            p.condition_id,\n            p.outcome_index,\n            p.outcome_trade_cash,\n            p.outcome_final_shares,\n            r.resolved_price,\n            r.resolution_time\n        FROM\n        per_outcome AS p\n        LEFT JOIN default.vw_pm_resolution_prices AS r ON (p.condition_id = r.condition_id) AND (p.outcome_index = r.outcome_index)\n    ),\n    per_outcome_pnl AS\n    (\n        SELECT\n            wallet_address,\n            condition_id,\n            outcome_index,\n            outcome_trade_cash,\n            if(resolved_price IS NOT NULL, outcome_final_shares * resolved_price, 0) AS outcome_resolution_cash,\n            resolved_price,\n            resolution_time\n        FROM\n        with_resolution\n    )\nSELECT\n    wallet_address,\n    condition_id,\n    sum(outcome_trade_cash) AS trade_cash,\n    sum(outcome_resolution_cash) AS resolution_cash,\n    sum(outcome_trade_cash) + sum(outcome_resolution_cash) AS realized_pnl,\n    max(resolution_time) AS resolution_time,\n    max(resolved_price IS NOT NULL) AS is_resolved\nFROM\nper_outcome_pnl\nGROUP BY\n    wallet_address,\n    condition_id
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| condition_id | String |
| trade_cash | Nullable(Float64) |
| resolution_cash | Nullable(Float64) |
| realized_pnl | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| is_resolved | UInt8 |

---

### vw_pm_wallet_pnl_v1

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_wallet_pnl_v1\n(\n    `trader_wallet` String,\n    `total_realized_pnl` Float64,\n    `gross_profit` Float64,\n    `gross_loss` Float64,\n    `resolved_markets` UInt64,\n    `winning_markets` UInt64,\n    `losing_markets` UInt64,\n    `total_trades` UInt64,\n    `win_rate` Float64,\n    `profit_factor` Nullable(Float64),\n    `first_trade` DateTime,\n    `last_trade` DateTime\n)\nAS SELECT\n    trader_wallet,\n    sum(multiIf(is_resolved, realized_pnl, 0)) AS total_realized_pnl,\n    sum(multiIf(is_resolved AND (realized_pnl > 0), realized_pnl, 0)) AS gross_profit,\n    sum(multiIf(is_resolved AND (realized_pnl < 0), abs(realized_pnl), 0)) AS gross_loss,\n    COUNTDistinct(multiIf(is_resolved, condition_id, NULL)) AS resolved_markets,\n    COUNTDistinct(multiIf(is_resolved AND (realized_pnl > 0), condition_id, NULL)) AS winning_markets,\n    COUNTDistinct(multiIf(is_resolved AND (realized_pnl < 0), condition_id, NULL)) AS losing_markets,\n    sum(trade_count) AS total_trades,\n    multiIf(COUNTDistinct(multiIf(is_resolved, condition_id, NULL)) > 0, (COUNTDistinct(multiIf(is_resolved AND (realized_pnl > 0), condition_id, NULL)) * 1.) / COUNTDistinct(multiIf(is_resolved, condition_id, NULL)), 0) AS win_rate,\n    multiIf(sum(multiIf(is_resolved AND (realized_pnl < 0), abs(realized_pnl), 0)) > 0, sum(multiIf(is_resolved AND (realized_pnl > 0), realized_pnl, 0)) / sum(multiIf(is_resolved AND (realized_pnl < 0), abs(realized_pnl), 0)), NULL) AS profit_factor,\n    min(first_trade) AS first_trade,\n    max(last_trade) AS last_trade\nFROM default.vw_pm_realized_pnl_v1\nGROUP BY trader_wallet
```

**Columns:**

| Column | Type |
|--------|------|
| trader_wallet | String |
| total_realized_pnl | Float64 |
| gross_profit | Float64 |
| gross_loss | Float64 |
| resolved_markets | UInt64 |
| winning_markets | UInt64 |
| losing_markets | UInt64 |
| total_trades | UInt64 |
| win_rate | Float64 |
| profit_factor | Nullable(Float64) |
| first_trade | DateTime |
| last_trade | DateTime |

---

### vw_realized_pnl_clob_only

**Engine:** View
**Dependencies:** default, clob_deduped, wallet_token_flows, with_mapping, with_resolution, with_payout

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_clob_only\n(\n    `wallet` String,\n    `condition_id` String,\n    `outcome_index` Int64,\n    `net_cash_usdc` Float64,\n    `final_net_tokens` Float64,\n    `payout_price` Float64,\n    `is_resolved` UInt8,\n    `realized_pnl_clob_only` Nullable(Float64)\n)\nAS WITH\n    clob_deduped AS\n    (\n        SELECT\n            event_id,\n            any(trader_wallet) AS trader_wallet,\n            any(token_id) AS token_id,\n            any(side) AS side,\n            any(usdc_amount) / 1000000. AS usdc,\n            any(token_amount) / 1000000. AS tokens\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY event_id\n    ),\n    wallet_token_flows AS\n    (\n        SELECT\n            lower(trader_wallet) AS wallet,\n            token_id,\n            sum(multiIf(side = \'buy\', -usdc, usdc)) AS net_cash_usdc,\n            sum(multiIf(side = \'buy\', tokens, -tokens)) AS final_net_tokens\n        FROM\n        clob_deduped\n        GROUP BY\n            lower(trader_wallet),\n            token_id\n    ),\n    with_mapping AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.net_cash_usdc,\n            w.final_net_tokens,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        wallet_token_flows AS w\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON w.token_id = m.token_id_dec\n    ),\n    with_resolution AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.net_cash_usdc,\n            w.final_net_tokens,\n            w.condition_id,\n            w.outcome_index,\n            r.payout_numerators,\n            r.resolved_at IS NOT NULL AS is_resolved\n        FROM\n        with_mapping AS w\n        LEFT JOIN default.pm_condition_resolutions AS r ON lower(w.condition_id) = lower(r.condition_id)\n    ),\n    with_payout AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            condition_id,\n            outcome_index,\n            net_cash_usdc,\n            final_net_tokens,\n            is_resolved,\n            multiIf(is_resolved AND (payout_numerators IS NOT NULL), JSONExtract(payout_numerators, \'Array(Float64)\')[toUInt32(outcome_index + 1)], 0.) AS payout_price\n        FROM\n        with_resolution\n    )\nSELECT\n    wallet,\n    condition_id,\n    outcome_index,\n    net_cash_usdc,\n    final_net_tokens,\n    payout_price,\n    is_resolved,\n    multiIf(is_resolved, net_cash_usdc + (final_net_tokens * payout_price), NULL) AS realized_pnl_clob_only\nFROM\nwith_payout
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| condition_id | String |
| outcome_index | Int64 |
| net_cash_usdc | Float64 |
| final_net_tokens | Float64 |
| payout_price | Float64 |
| is_resolved | UInt8 |
| realized_pnl_clob_only | Nullable(Float64) |

---

### vw_realized_pnl_v7

**Engine:** View
**Dependencies:** default, clob_deduped, wallet_token_clob, with_mapping, with_resolution, with_payout, pnl_per_outcome, ctf_payouts, ctf_deposits

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_v7\n(\n    `wallet` String,\n    `total_clob_net_cash` Float64,\n    `total_ctf_payouts` Float64,\n    `total_ctf_deposits` Float64,\n    `realized_pnl_clob` Nullable(Float64),\n    `realized_pnl_v7` Nullable(Float64),\n    `resolved_outcomes` UInt64,\n    `unresolved_outcomes` UInt64\n)\nAS WITH\n    ctf_payouts AS\n    (\n        SELECT\n            to_address AS wallet,\n            sum(amount_usdc) AS total_ctf_payouts\n        FROM default.pm_erc20_usdc_flows\n        WHERE (flow_type = \'ctf_payout\') AND (amount_usdc > 0) AND (amount_usdc < 1000000000)\n        GROUP BY to_address\n    ),\n    ctf_deposits AS\n    (\n        SELECT\n            from_address AS wallet,\n            sum(amount_usdc) AS total_ctf_deposits\n        FROM default.pm_erc20_usdc_flows\n        WHERE (flow_type = \'ctf_deposit\') AND (amount_usdc > 0) AND (amount_usdc < 1000000000)\n        GROUP BY from_address\n    ),\n    clob_deduped AS\n    (\n        SELECT\n            event_id,\n            any(trader_wallet) AS trader_wallet,\n            any(token_id) AS token_id,\n            any(side) AS side,\n            any(usdc_amount) / 1000000. AS usdc,\n            any(token_amount) / 1000000. AS tokens\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY event_id\n    ),\n    wallet_token_clob AS\n    (\n        SELECT\n            lower(trader_wallet) AS wallet,\n            token_id,\n            sum(multiIf(side = \'buy\', -usdc, usdc)) AS clob_net_cash,\n            sum(multiIf(side = \'buy\', tokens, -tokens)) AS clob_net_tokens\n        FROM\n        clob_deduped\n        GROUP BY\n            lower(trader_wallet),\n            token_id\n    ),\n    with_mapping AS\n    (\n        SELECT\n            c.wallet,\n            c.token_id,\n            c.clob_net_cash,\n            c.clob_net_tokens,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        wallet_token_clob AS c\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON c.token_id = m.token_id_dec\n    ),\n    with_resolution AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.clob_net_cash,\n            w.clob_net_tokens,\n            w.condition_id,\n            w.outcome_index,\n            r.payout_numerators,\n            r.resolved_at IS NOT NULL AS is_resolved\n        FROM\n        with_mapping AS w\n        LEFT JOIN default.pm_condition_resolutions AS r ON lower(w.condition_id) = lower(r.condition_id)\n    ),\n    with_payout AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            is_resolved,\n            multiIf(is_resolved AND (payout_numerators IS NOT NULL), JSONExtract(payout_numerators, \'Array(Float64)\')[toUInt32(outcome_index + 1)], 0.) AS payout_price\n        FROM\n        with_resolution\n    ),\n    pnl_per_outcome AS\n    (\n        SELECT\n            p.wallet,\n            p.condition_id,\n            p.outcome_index,\n            p.clob_net_cash,\n            p.clob_net_tokens,\n            p.payout_price,\n            p.is_resolved,\n            multiIf(p.is_resolved, p.clob_net_cash + (p.clob_net_tokens * p.payout_price), NULL) AS realized_pnl_clob\n        FROM\n        with_payout AS p\n    )\nSELECT\n    o.wallet AS wallet,\n    sum(o.clob_net_cash) AS total_clob_net_cash,\n    coalesce(cp.total_ctf_payouts, 0) AS total_ctf_payouts,\n    coalesce(cd.total_ctf_deposits, 0) AS total_ctf_deposits,\n    sum(multiIf(o.is_resolved, o.realized_pnl_clob, 0)) AS realized_pnl_clob,\n    (sum(multiIf(o.is_resolved, o.realized_pnl_clob, 0)) + coalesce(cp.total_ctf_payouts, 0)) - coalesce(cd.total_ctf_deposits, 0) AS realized_pnl_v7,\n    countIf(o.is_resolved = 1) AS resolved_outcomes,\n    countIf(o.is_resolved = 0) AS unresolved_outcomes\nFROM\npnl_per_outcome AS o\nLEFT JOIN\nctf_payouts AS cp ON o.wallet = cp.wallet\nLEFT JOIN\nctf_deposits AS cd ON o.wallet = cd.wallet\nGROUP BY\n    o.wallet,\n    cp.total_ctf_payouts,\n    cd.total_ctf_deposits
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| total_clob_net_cash | Float64 |
| total_ctf_payouts | Float64 |
| total_ctf_deposits | Float64 |
| realized_pnl_clob | Nullable(Float64) |
| realized_pnl_v7 | Nullable(Float64) |
| resolved_outcomes | UInt64 |
| unresolved_outcomes | UInt64 |

---

### vw_realized_pnl_v7_ctf

**Engine:** View
**Dependencies:** default, clob_deduped, wallet_token_clob, with_mapping, with_resolution, with_payout, clob_pnl, ctf_wallet_summary

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_v7_ctf\n(\n    `wallet` String,\n    `total_clob_net_cash` Float64,\n    `total_ctf_deposits` Float64,\n    `total_ctf_payouts` Float64,\n    `net_ctf_cash` Float64,\n    `realized_pnl_clob` Nullable(Float64),\n    `realized_pnl_v7_ctf` Nullable(Float64),\n    `resolved_outcomes` UInt64,\n    `unresolved_outcomes` UInt64\n)\nAS WITH\n    ctf_wallet_summary AS\n    (\n        SELECT\n            wallet,\n            sum(ctf_deposits) AS total_ctf_deposits,\n            sum(ctf_payouts) AS total_ctf_payouts,\n            sum(net_ctf_cash) AS net_ctf_cash\n        FROM default.vw_ctf_ledger\n        GROUP BY wallet\n    ),\n    clob_deduped AS\n    (\n        SELECT\n            event_id,\n            any(trader_wallet) AS trader_wallet,\n            any(token_id) AS token_id,\n            any(side) AS side,\n            any(usdc_amount) / 1000000. AS usdc,\n            any(token_amount) / 1000000. AS tokens\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY event_id\n    ),\n    wallet_token_clob AS\n    (\n        SELECT\n            lower(trader_wallet) AS wallet,\n            token_id,\n            sum(multiIf(side = \'buy\', -usdc, usdc)) AS clob_net_cash,\n            sum(multiIf(side = \'buy\', tokens, -tokens)) AS clob_net_tokens\n        FROM\n        clob_deduped\n        GROUP BY\n            lower(trader_wallet),\n            token_id\n    ),\n    with_mapping AS\n    (\n        SELECT\n            c.wallet,\n            c.token_id,\n            c.clob_net_cash,\n            c.clob_net_tokens,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        wallet_token_clob AS c\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON c.token_id = m.token_id_dec\n    ),\n    with_resolution AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.clob_net_cash,\n            w.clob_net_tokens,\n            w.condition_id,\n            w.outcome_index,\n            r.payout_numerators,\n            r.resolved_at IS NOT NULL AS is_resolved\n        FROM\n        with_mapping AS w\n        LEFT JOIN default.pm_condition_resolutions AS r ON lower(w.condition_id) = lower(r.condition_id)\n    ),\n    with_payout AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            is_resolved,\n            multiIf(is_resolved AND (payout_numerators IS NOT NULL), JSONExtract(payout_numerators, \'Array(Float64)\')[toUInt32(outcome_index + 1)], 0.) AS payout_price\n        FROM\n        with_resolution\n    ),\n    clob_pnl AS\n    (\n        SELECT\n            wallet,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            payout_price,\n            is_resolved,\n            multiIf(is_resolved, clob_net_cash + (clob_net_tokens * payout_price), NULL) AS realized_pnl_clob\n        FROM\n        with_payout\n    )\nSELECT\n    c.wallet AS wallet,\n    sum(c.clob_net_cash) AS total_clob_net_cash,\n    coalesce(ctf.total_ctf_deposits, 0) AS total_ctf_deposits,\n    coalesce(ctf.total_ctf_payouts, 0) AS total_ctf_payouts,\n    coalesce(ctf.net_ctf_cash, 0) AS net_ctf_cash,\n    sum(multiIf(c.is_resolved, c.realized_pnl_clob, 0)) AS realized_pnl_clob,\n    sum(multiIf(c.is_resolved, c.realized_pnl_clob, 0)) + coalesce(ctf.net_ctf_cash, 0) AS realized_pnl_v7_ctf,\n    countIf(c.is_resolved = 1) AS resolved_outcomes,\n    countIf(c.is_resolved = 0) AS unresolved_outcomes\nFROM\nclob_pnl AS c\nLEFT JOIN\nctf_wallet_summary AS ctf ON c.wallet = ctf.wallet\nGROUP BY\n    c.wallet,\n    ctf.total_ctf_deposits,\n    ctf.total_ctf_payouts,\n    ctf.net_ctf_cash
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| total_clob_net_cash | Float64 |
| total_ctf_deposits | Float64 |
| total_ctf_payouts | Float64 |
| net_ctf_cash | Float64 |
| realized_pnl_clob | Nullable(Float64) |
| realized_pnl_v7_ctf | Nullable(Float64) |
| resolved_outcomes | UInt64 |
| unresolved_outcomes | UInt64 |

---

### vw_realized_pnl_v7_txhash

**Engine:** View
**Dependencies:** default, clob_deduped, wallet_token_clob, with_mapping, with_resolution, with_payout, pnl_per_outcome, ctf_payouts, ctf_deposits

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_v7_txhash\n(\n    `wallet` String,\n    `total_clob_net_cash` Float64,\n    `total_ctf_payouts` Float64,\n    `total_ctf_deposits` Float64,\n    `realized_pnl_clob` Nullable(Float64),\n    `realized_pnl_v7` Nullable(Float64),\n    `resolved_outcomes` UInt64,\n    `unresolved_outcomes` UInt64\n)\nAS WITH\n    ctf_payouts AS\n    (\n        SELECT\n            to_address AS wallet,\n            sum(amount_usdc) AS total_ctf_payouts\n        FROM default.pm_erc20_usdc_flows\n        WHERE (flow_type = \'ctf_payout\') AND (amount_usdc > 0) AND (amount_usdc < 1000000000)\n        GROUP BY to_address\n    ),\n    ctf_deposits AS\n    (\n        SELECT\n            from_address AS wallet,\n            sum(amount_usdc) AS total_ctf_deposits\n        FROM default.pm_erc20_usdc_flows\n        WHERE (flow_type = \'ctf_deposit\') AND (amount_usdc > 0) AND (amount_usdc < 1000000000)\n        GROUP BY from_address\n    ),\n    clob_deduped AS\n    (\n        SELECT\n            substring(event_id, 1, position(event_id, \'_\') - 1) AS tx_hash,\n            lower(trader_wallet) AS wallet,\n            token_id,\n            any(side) AS side,\n            any(usdc_amount) / 1000000. AS usdc,\n            any(token_amount) / 1000000. AS tokens\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY\n            substring(event_id, 1, position(event_id, \'_\') - 1),\n            lower(trader_wallet),\n            token_id\n    ),\n    wallet_token_clob AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            sum(multiIf(side = \'buy\', -usdc, usdc)) AS clob_net_cash,\n            sum(multiIf(side = \'buy\', tokens, -tokens)) AS clob_net_tokens\n        FROM\n        clob_deduped\n        GROUP BY\n            wallet,\n            token_id\n    ),\n    with_mapping AS\n    (\n        SELECT\n            c.wallet,\n            c.token_id,\n            c.clob_net_cash,\n            c.clob_net_tokens,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        wallet_token_clob AS c\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON c.token_id = m.token_id_dec\n    ),\n    with_resolution AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.clob_net_cash,\n            w.clob_net_tokens,\n            w.condition_id,\n            w.outcome_index,\n            r.payout_numerators,\n            r.resolved_at IS NOT NULL AS is_resolved\n        FROM\n        with_mapping AS w\n        LEFT JOIN default.pm_condition_resolutions AS r ON lower(w.condition_id) = lower(r.condition_id)\n    ),\n    with_payout AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            is_resolved,\n            multiIf(is_resolved AND (payout_numerators IS NOT NULL), JSONExtract(payout_numerators, \'Array(Float64)\')[toUInt32(outcome_index + 1)], 0.) AS payout_price\n        FROM\n        with_resolution\n    ),\n    pnl_per_outcome AS\n    (\n        SELECT\n            wallet,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            payout_price,\n            is_resolved,\n            multiIf(is_resolved, clob_net_cash + (clob_net_tokens * payout_price), NULL) AS realized_pnl_clob\n        FROM\n        with_payout\n    )\nSELECT\n    o.wallet AS wallet,\n    sum(o.clob_net_cash) AS total_clob_net_cash,\n    coalesce(cp.total_ctf_payouts, 0) AS total_ctf_payouts,\n    coalesce(cd.total_ctf_deposits, 0) AS total_ctf_deposits,\n    sum(multiIf(o.is_resolved, o.realized_pnl_clob, 0)) AS realized_pnl_clob,\n    (sum(multiIf(o.is_resolved, o.realized_pnl_clob, 0)) + coalesce(cp.total_ctf_payouts, 0)) - coalesce(cd.total_ctf_deposits, 0) AS realized_pnl_v7,\n    countIf(o.is_resolved = 1) AS resolved_outcomes,\n    countIf(o.is_resolved = 0) AS unresolved_outcomes\nFROM\npnl_per_outcome AS o\nLEFT JOIN\nctf_payouts AS cp ON o.wallet = cp.wallet\nLEFT JOIN\nctf_deposits AS cd ON o.wallet = cd.wallet\nGROUP BY\n    o.wallet,\n    cp.total_ctf_payouts,\n    cd.total_ctf_deposits
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| total_clob_net_cash | Float64 |
| total_ctf_payouts | Float64 |
| total_ctf_deposits | Float64 |
| realized_pnl_clob | Nullable(Float64) |
| realized_pnl_v7 | Nullable(Float64) |
| resolved_outcomes | UInt64 |
| unresolved_outcomes | UInt64 |

---

### vw_realized_pnl_v8_proxy

**Engine:** View
**Dependencies:** default, clob_deduped, wallet_token_clob, with_mapping, with_resolution, with_payout, clob_pnl, ctf_proxy_summary

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_v8_proxy\n(\n    `wallet` String,\n    `total_clob_net_cash` Float64,\n    `total_ctf_deposits` Float64,\n    `total_ctf_payouts` Float64,\n    `net_ctf_cash` Float64,\n    `realized_pnl_clob` Nullable(Float64),\n    `realized_pnl_v8` Nullable(Float64),\n    `resolved_outcomes` UInt64,\n    `unresolved_outcomes` UInt64\n)\nAS WITH\n    ctf_proxy_summary AS\n    (\n        SELECT\n            wallet,\n            sum(ctf_deposits) AS total_ctf_deposits,\n            sum(ctf_payouts) AS total_ctf_payouts,\n            sum(net_ctf_cash) AS net_ctf_cash\n        FROM default.vw_ctf_ledger_proxy\n        GROUP BY wallet\n    ),\n    clob_deduped AS\n    (\n        SELECT\n            event_id,\n            any(trader_wallet) AS trader_wallet,\n            any(token_id) AS token_id,\n            any(side) AS side,\n            any(usdc_amount) / 1000000. AS usdc,\n            any(token_amount) / 1000000. AS tokens\n        FROM default.pm_trader_events_v2\n        WHERE is_deleted = 0\n        GROUP BY event_id\n    ),\n    wallet_token_clob AS\n    (\n        SELECT\n            lower(trader_wallet) AS wallet,\n            token_id,\n            sum(multiIf(side = \'buy\', -usdc, usdc)) AS clob_net_cash,\n            sum(multiIf(side = \'buy\', tokens, -tokens)) AS clob_net_tokens\n        FROM\n        clob_deduped\n        GROUP BY\n            lower(trader_wallet),\n            token_id\n    ),\n    with_mapping AS\n    (\n        SELECT\n            c.wallet,\n            c.token_id,\n            c.clob_net_cash,\n            c.clob_net_tokens,\n            m.condition_id,\n            m.outcome_index\n        FROM\n        wallet_token_clob AS c\n        INNER JOIN default.pm_token_to_condition_map_v3 AS m ON c.token_id = m.token_id_dec\n    ),\n    with_resolution AS\n    (\n        SELECT\n            w.wallet,\n            w.token_id,\n            w.clob_net_cash,\n            w.clob_net_tokens,\n            w.condition_id,\n            w.outcome_index,\n            r.payout_numerators,\n            r.resolved_at IS NOT NULL AS is_resolved\n        FROM\n        with_mapping AS w\n        LEFT JOIN default.pm_condition_resolutions AS r ON lower(w.condition_id) = lower(r.condition_id)\n    ),\n    with_payout AS\n    (\n        SELECT\n            wallet,\n            token_id,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            is_resolved,\n            multiIf(is_resolved AND (payout_numerators IS NOT NULL), JSONExtract(payout_numerators, \'Array(Float64)\')[toUInt32(outcome_index + 1)], 0.) AS payout_price\n        FROM\n        with_resolution\n    ),\n    clob_pnl AS\n    (\n        SELECT\n            wallet,\n            condition_id,\n            outcome_index,\n            clob_net_cash,\n            clob_net_tokens,\n            payout_price,\n            is_resolved,\n            multiIf(is_resolved, clob_net_cash + (clob_net_tokens * payout_price), NULL) AS realized_pnl_clob\n        FROM\n        with_payout\n    )\nSELECT\n    c.wallet AS wallet,\n    sum(c.clob_net_cash) AS total_clob_net_cash,\n    coalesce(ctf.total_ctf_deposits, 0) AS total_ctf_deposits,\n    coalesce(ctf.total_ctf_payouts, 0) AS total_ctf_payouts,\n    coalesce(ctf.net_ctf_cash, 0) AS net_ctf_cash,\n    sum(multiIf(c.is_resolved, c.realized_pnl_clob, 0)) AS realized_pnl_clob,\n    sum(multiIf(c.is_resolved, c.realized_pnl_clob, 0)) + coalesce(ctf.net_ctf_cash, 0) AS realized_pnl_v8,\n    countIf(c.is_resolved = 1) AS resolved_outcomes,\n    countIf(c.is_resolved = 0) AS unresolved_outcomes\nFROM\nclob_pnl AS c\nLEFT JOIN\nctf_proxy_summary AS ctf ON c.wallet = ctf.wallet\nGROUP BY\n    c.wallet,\n    ctf.total_ctf_deposits,\n    ctf.total_ctf_payouts,\n    ctf.net_ctf_cash
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| total_clob_net_cash | Float64 |
| total_ctf_deposits | Float64 |
| total_ctf_payouts | Float64 |
| net_ctf_cash | Float64 |
| realized_pnl_clob | Nullable(Float64) |
| realized_pnl_v8 | Nullable(Float64) |
| resolved_outcomes | UInt64 |
| unresolved_outcomes | UInt64 |

---

### vw_realized_pnl_v9_proxy

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_realized_pnl_v9_proxy\n(\n    `wallet` String,\n    `condition_id` String,\n    `clob_net_cash` Float64,\n    `clob_net_tokens` Float64,\n    `ctf_deposits` Float64,\n    `ctf_payouts` Float64,\n    `total_usdc_delta` Float64,\n    `net_token_position` Float64,\n    `is_resolved` UInt8,\n    `payout_numerators` String,\n    `event_count` UInt64,\n    `first_trade_time` DateTime,\n    `last_trade_time` DateTime\n)\nAS SELECT\n    l.wallet,\n    l.condition_id,\n    sumIf(l.usdc_delta, l.source IN (\'CLOB_BUY\', \'CLOB_SELL\')) AS clob_net_cash,\n    sumIf(l.token_delta, l.source IN (\'CLOB_BUY\', \'CLOB_SELL\')) AS clob_net_tokens,\n    sumIf(l.usdc_delta, l.source = \'CTF_MINT\') AS ctf_deposits,\n    sumIf(l.usdc_delta, l.source = \'CTF_BURN\') AS ctf_payouts,\n    sum(l.usdc_delta) AS total_usdc_delta,\n    sum(l.token_delta) AS net_token_position,\n    r.resolved_at IS NOT NULL AS is_resolved,\n    r.payout_numerators,\n    count() AS event_count,\n    min(l.tx_time) AS first_trade_time,\n    max(l.tx_time) AS last_trade_time\nFROM default.pm_wallet_condition_ledger_v9 AS l\nLEFT JOIN default.pm_condition_resolutions AS r ON lower(l.condition_id) = lower(r.condition_id)\nWHERE l.is_deleted = 0\nGROUP BY\n    l.wallet,\n    l.condition_id,\n    r.resolved_at,\n    r.payout_numerators
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| condition_id | String |
| clob_net_cash | Float64 |
| clob_net_tokens | Float64 |
| ctf_deposits | Float64 |
| ctf_payouts | Float64 |
| total_usdc_delta | Float64 |
| net_token_position | Float64 |
| is_resolved | UInt8 |
| payout_numerators | String |
| event_count | UInt64 |
| first_trade_time | DateTime |
| last_trade_time | DateTime |

---

### vw_wallet_pnl_archive

**Engine:** View
**Dependencies:** pm_archive

**Definition:**
```sql
CREATE VIEW default.vw_wallet_pnl_archive\n(\n    `wallet` String,\n    `realized_pnl_usd` Float64,\n    `unrealized_pnl_usd` Float64,\n    `total_pnl_usd` Float64,\n    `total_bought_usd` Float64,\n    `total_sold_usd` Float64,\n    `position_count` UInt64,\n    `latest_block` UInt64\n)\nAS SELECT\n    proxy_wallet AS wallet,\n    sum(realized_pnl) / 1000000. AS realized_pnl_usd,\n    sum(unrealized_pnl) / 1000000. AS unrealized_pnl_usd,\n    sum(realized_pnl + unrealized_pnl) / 1000000. AS total_pnl_usd,\n    sum(total_bought) / 1000000. AS total_bought_usd,\n    sum(total_sold) / 1000000. AS total_sold_usd,\n    count(*) AS position_count,\n    max(block_number) AS latest_block\nFROM pm_archive.pm_user_positions\nWHERE is_deleted = 0\nGROUP BY proxy_wallet
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| realized_pnl_usd | Float64 |
| unrealized_pnl_usd | Float64 |
| total_pnl_usd | Float64 |
| total_bought_usd | Float64 |
| total_sold_usd | Float64 |
| position_count | UInt64 |
| latest_block | UInt64 |

---

### vw_wallet_pnl_ui_activity_v1

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_wallet_pnl_ui_activity_v1\n(\n    `wallet` String,\n    `pnl_activity_total` Float64,\n    `gain_activity` Float64,\n    `loss_activity` Float64,\n    `volume_traded` Float64,\n    `fills_count` UInt32,\n    `redemptions_count` UInt32,\n    `updated_at` DateTime\n)\nAS SELECT\n    wallet,\n    pnl_activity_total,\n    gain_activity,\n    loss_activity,\n    volume_traded,\n    fills_count,\n    redemptions_count,\n    updated_at\nFROM default.pm_wallet_pnl_ui_activity_v1\nFINAL
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| pnl_activity_total | Float64 |
| gain_activity | Float64 |
| loss_activity | Float64 |
| volume_traded | Float64 |
| fills_count | UInt32 |
| redemptions_count | UInt32 |
| updated_at | DateTime |

---

## Resolutions

### vw_pm_resolution_prices

**Engine:** View
**Dependencies:** default, numerators

**Definition:**
```sql
CREATE VIEW default.vw_pm_resolution_prices\n(\n    `condition_id` String,\n    `outcome_index` Int64,\n    `resolved_price` Nullable(Float64),\n    `resolution_time` Nullable(DateTime),\n    `resolution_tx_hash` String,\n    `resolution_block` UInt64\n)\nAS SELECT\n    lower(r.condition_id) AS condition_id,\n    idx - 1 AS outcome_index,\n    toNullable(numerator / arraySum(numerators)) AS resolved_price,\n    toNullable(r.resolved_at) AS resolution_time,\n    r.tx_hash AS resolution_tx_hash,\n    r.block_number AS resolution_block\nFROM\n(\n    SELECT\n        condition_id,\n        JSONExtract(payout_numerators, \'Array(Float64)\') AS numerators,\n        resolved_at,\n        tx_hash,\n        block_number\n    FROM default.pm_condition_resolutions\n    WHERE is_deleted = 0\n) AS r\nARRAY JOIN\n    numerators AS numerator,\n    arrayEnumerate(numerators) AS idx
```

**Columns:**

| Column | Type |
|--------|------|
| condition_id | String |
| outcome_index | Int64 |
| resolved_price | Nullable(Float64) |
| resolution_time | Nullable(DateTime) |
| resolution_tx_hash | String |
| resolution_block | UInt64 |

---

## Wallets

### vw_pm_retail_wallets_v1

**Engine:** View
**Dependencies:** default

**Definition:**
```sql
CREATE VIEW default.vw_pm_retail_wallets_v1\n(\n    `wallet_address` String,\n    `total_long_tokens` Float64,\n    `total_short_tokens` Float64,\n    `short_winner_tokens` Float64,\n    `long_winner_tokens` Float64,\n    `short_ratio` Float64,\n    `wallet_tier` String,\n    `is_retail` UInt8\n)\nAS SELECT\n    wallet_address,\n    total_long_tokens,\n    total_short_tokens,\n    short_winner_tokens,\n    long_winner_tokens,\n    short_ratio,\n    if(short_ratio < 0.1, \'retail\', if(short_ratio < 0.3, \'mixed\', \'operator\')) AS wallet_tier,\n    short_ratio < 0.1 AS is_retail\nFROM\n(\n    SELECT\n        wallet_address,\n        sumIf(token_delta, (token_delta > 0) AND (source_type = \'CLOB\')) AS total_long_tokens,\n        sumIf(abs(token_delta), (token_delta < 0) AND (source_type = \'CLOB\')) AS total_short_tokens,\n        sumIf(abs(token_delta), (token_delta < 0) AND (source_type = \'CLOB\') AND (payout_norm = 1)) AS short_winner_tokens,\n        sumIf(token_delta, (token_delta > 0) AND (source_type = \'CLOB\') AND (payout_norm = 1)) AS long_winner_tokens,\n        if((short_winner_tokens + long_winner_tokens) > 0, short_winner_tokens / (short_winner_tokens + long_winner_tokens), 0) AS short_ratio\n    FROM default.pm_unified_ledger_v5\n    GROUP BY wallet_address\n    HAVING (total_long_tokens + total_short_tokens) > 100\n)
```

**Columns:**

| Column | Type |
|--------|------|
| wallet_address | String |
| total_long_tokens | Float64 |
| total_short_tokens | Float64 |
| short_winner_tokens | Float64 |
| long_winner_tokens | Float64 |
| short_ratio | Float64 |
| wallet_tier | String |
| is_retail | UInt8 |

---

### vw_pm_wallet_summary_with_ctf

**Engine:** View
**Dependencies:** default, market_pnl

**Definition:**
```sql
CREATE VIEW default.vw_pm_wallet_summary_with_ctf\n(\n    `wallet` String,\n    `total_markets` UInt64,\n    `resolved_markets` UInt64,\n    `total_events` UInt64,\n    `clob_events` UInt64,\n    `split_events` UInt64,\n    `merge_events` UInt64,\n    `realized_pnl` Nullable(Float64),\n    `avg_pnl_per_market` Nullable(Float64),\n    `wins` UInt64,\n    `losses` UInt64,\n    `win_rate_pct` Nullable(Float64),\n    `total_gains` Nullable(Float64),\n    `total_losses` Nullable(Float64),\n    `profit_factor` Nullable(Float64)\n)\nAS WITH market_pnl AS\n    (\n        SELECT\n            wallet,\n            condition_id,\n            max(is_resolved) AS is_resolved,\n            sum(realized_pnl) AS market_pnl,\n            sum(event_count) AS total_events,\n            sum(clob_events) AS clob_events,\n            sum(split_events) AS split_events,\n            sum(merge_events) AS merge_events\n        FROM default.vw_pm_pnl_with_ctf\n        GROUP BY\n            wallet,\n            condition_id\n    )\nSELECT\n    wallet,\n    countDistinct(condition_id) AS total_markets,\n    countIf(is_resolved = 1) AS resolved_markets,\n    sum(total_events) AS total_events,\n    sum(clob_events) AS clob_events,\n    sum(split_events) AS split_events,\n    sum(merge_events) AS merge_events,\n    round(sumIf(market_pnl, is_resolved = 1), 2) AS realized_pnl,\n    round(avgIf(market_pnl, is_resolved = 1), 2) AS avg_pnl_per_market,\n    countIf((is_resolved = 1) AND (market_pnl > 0)) AS wins,\n    countIf((is_resolved = 1) AND (market_pnl < 0)) AS losses,\n    round((100. * countIf((is_resolved = 1) AND (market_pnl > 0))) / nullIf(countIf(is_resolved = 1), 0), 2) AS win_rate_pct,\n    round(sumIf(market_pnl, (is_resolved = 1) AND (market_pnl > 0)), 2) AS total_gains,\n    round(sumIf(market_pnl, (is_resolved = 1) AND (market_pnl < 0)), 2) AS total_losses,\n    round(sumIf(market_pnl, (is_resolved = 1) AND (market_pnl > 0)) / nullIf(abs(sumIf(market_pnl, (is_resolved = 1) AND (market_pnl < 0))), 0), 3) AS profit_factor\nFROM\nmarket_pnl\nGROUP BY wallet
```

**Columns:**

| Column | Type |
|--------|------|
| wallet | String |
| total_markets | UInt64 |
| resolved_markets | UInt64 |
| total_events | UInt64 |
| clob_events | UInt64 |
| split_events | UInt64 |
| merge_events | UInt64 |
| realized_pnl | Nullable(Float64) |
| avg_pnl_per_market | Nullable(Float64) |
| wins | UInt64 |
| losses | UInt64 |
| win_rate_pct | Nullable(Float64) |
| total_gains | Nullable(Float64) |
| total_losses | Nullable(Float64) |
| profit_factor | Nullable(Float64) |

---

