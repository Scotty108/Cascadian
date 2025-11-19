# Proxy Mapping Discovery Report
**Date:** 2025-11-16T00:14:17.011Z
---
## Tables Found
### pm_user_proxy_wallets
**Status:** Does not exist

### pm_user_proxy_wallets_v2
**Status:** ✅ Exists
**Row Count:** 6
**Total Columns:** 7

**Proxy/Wallet Columns:**
- `user_eoa` (String)
- `proxy_wallet` (String)

**Full Schema:**
```
user_eoa                       String
proxy_wallet                   String
source                         LowCardinality(String)
first_seen_at                  DateTime
last_seen_at                   DateTime
is_active                      UInt8
metadata                       String
```

**Sample Rows (first 5):**
```json
[
  {
    "user_eoa": "0x3b6fd06a595d71c70afb3f44414be1c11304340b",
    "proxy_wallet": "0x3b6fd06a595d71c70afb3f44414be1c11304340b",
    "source": "api",
    "first_seen_at": "2025-11-11 09:38:26",
    "last_seen_at": "2025-11-11 09:38:26",
    "is_active": 1,
    "metadata": ""
  },
  {
    "user_eoa": "0x7f3c8979d0afa00007bae4747d5347122af05613",
    "proxy_wallet": "0x7f3c8979d0afa00007bae4747d5347122af05613",
    "source": "api",
    "first_seen_at": "2025-11-11 09:38:24",
    "last_seen_at": "2025-11-11 09:38:24",
    "is_active": 1,
    "metadata": ""
  },
  {
    "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    "proxy_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    "source": "api",
    "first_seen_at": "2025-11-11 09:38:23",
    "last_seen_at": "2025-11-11 09:38:23",
    "is_active": 1,
    "metadata": ""
  },
  {
    "user_eoa": "0xd06f0f7719df1b3b75b607923536b3250825d4a6",
    "proxy_wallet": "0xd06f0f7719df1b3b75b607923536b3250825d4a6",
    "source": "api",
    "first_seen_at": "2025-11-11 09:38:25",
    "last_seen_at": "2025-11-11 09:38:25",
    "is_active": 1,
    "metadata": ""
  },
  {
    "user_eoa": "0xd748c701ad93cfec32a3420e10f3b08e68612125",
    "proxy_wallet": "0xd748c701ad93cfec32a3420e10f3b08e68612125",
    "source": "api",
    "first_seen_at": "2025-11-11 09:38:24",
    "last_seen_at": "2025-11-11 09:38:24",
    "is_active": 1,
    "metadata": ""
  }
]
```

### wallet_identity_map
**Status:** ✅ Exists
**Row Count:** 735,637
**Total Columns:** 7

**Proxy/Wallet Columns:**
- `user_eoa` (String)
- `proxy_wallet` (String)
- `canonical_wallet` (String)

**Full Schema:**
```
user_eoa                       String
proxy_wallet                   String
canonical_wallet               String
fills_count                    UInt64
markets_traded                 UInt64
first_fill_ts                  DateTime64(3)
last_fill_ts                   DateTime64(3)
```

**Sample Rows (first 5):**
```json
[
  {
    "user_eoa": "0x00000000000050ba7c429821e6d66429452ba168",
    "proxy_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
    "canonical_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
    "fills_count": "257",
    "markets_traded": "3",
    "first_fill_ts": "2024-03-09 23:13:22.000",
    "last_fill_ts": "2024-03-17 19:58:31.000"
  },
  {
    "user_eoa": "0x00000f27e5cc48331f6992ac339c149fef9b324f",
    "proxy_wallet": "0x00000f27e5cc48331f6992ac339c149fef9b324f",
    "canonical_wallet": "0x00000f27e5cc48331f6992ac339c149fef9b324f",
    "fills_count": "3",
    "markets_traded": "3",
    "first_fill_ts": "2025-02-18 01:55:28.000",
    "last_fill_ts": "2025-04-27 07:33:43.000"
  },
  {
    "user_eoa": "0x00002c5cfc7e21a32a8a9d01a39447d132856ed7",
    "proxy_wallet": "0x00002c5cfc7e21a32a8a9d01a39447d132856ed7",
    "canonical_wallet": "0x00002c5cfc7e21a32a8a9d01a39447d132856ed7",
    "fills_count": "1",
    "markets_traded": "1",
    "first_fill_ts": "2025-10-13 14:59:09.000",
    "last_fill_ts": "2025-10-13 14:59:09.000"
  },
  {
    "user_eoa": "0x000044dfcd0911300bc743c0b4c9ac2c3043bfec",
    "proxy_wallet": "0x000044dfcd0911300bc743c0b4c9ac2c3043bfec",
    "canonical_wallet": "0x000044dfcd0911300bc743c0b4c9ac2c3043bfec",
    "fills_count": "4",
    "markets_traded": "1",
    "first_fill_ts": "2025-11-01 02:19:34.000",
    "last_fill_ts": "2025-11-01 02:19:34.000"
  },
  {
    "user_eoa": "0x0000e78a359eb7c497551fe46cb81271dc4ecc86",
    "proxy_wallet": "0x0000e78a359eb7c497551fe46cb81271dc4ecc86",
    "canonical_wallet": "0x0000e78a359eb7c497551fe46cb81271dc4ecc86",
    "fills_count": "4",
    "markets_traded": "3",
    "first_fill_ts": "2025-02-22 04:26:25.000",
    "last_fill_ts": "2025-06-26 02:40:37.000"
  }
]
```

### clob_fills
**Status:** ✅ Exists
**Row Count:** 38,945,566
**Total Columns:** 16

**Proxy/Wallet Columns:**
- `proxy_wallet` (String)
- `user_eoa` (String)

**Full Schema:**
```
fill_id                        String
proxy_wallet                   String
user_eoa                       String
market_slug                    String
condition_id                   String
asset_id                       String
outcome                        LowCardinality(String)
side                           LowCardinality(String)
price                          Float64
size                           Float64
fee_rate_bps                   UInt32
timestamp                      DateTime
order_hash                     String
tx_hash                        String
bucket_index                   UInt32
ingested_at                    DateTime
```

**Sample Rows (first 5):**
```json
[
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "proxy_wallet": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "market_slug": "",
    "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "outcome": "",
    "side": "BUY",
    "price": 0.48,
    "size": 592730000,
    "fee_rate_bps": 0,
    "timestamp": "2022-12-18 01:03:12",
    "order_hash": "",
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "bucket_index": 0,
    "ingested_at": "2025-11-11 12:13:48"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "proxy_wallet": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "market_slug": "",
    "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "outcome": "",
    "side": "BUY",
    "price": 0.48,
    "size": 592730000,
    "fee_rate_bps": 0,
    "timestamp": "2022-12-18 01:03:12",
    "order_hash": "",
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "bucket_index": 0,
    "ingested_at": "2025-11-11 12:13:53"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "proxy_wallet": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "market_slug": "",
    "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "outcome": "",
    "side": "BUY",
    "price": 0.48,
    "size": 592730000,
    "fee_rate_bps": 0,
    "timestamp": "2022-12-18 01:03:12",
    "order_hash": "",
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "bucket_index": 0,
    "ingested_at": "2025-11-11 12:17:22"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "proxy_wallet": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "market_slug": "",
    "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "outcome": "",
    "side": "BUY",
    "price": 0.48,
    "size": 592730000,
    "fee_rate_bps": 0,
    "timestamp": "2022-12-18 01:03:12",
    "order_hash": "",
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "bucket_index": 0,
    "ingested_at": "2025-11-11 12:17:22"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "proxy_wallet": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "market_slug": "",
    "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "outcome": "",
    "side": "BUY",
    "price": 0.48,
    "size": 592730000,
    "fee_rate_bps": 0,
    "timestamp": "2022-12-18 01:03:12",
    "order_hash": "",
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "bucket_index": 0,
    "ingested_at": "2025-11-11 12:18:03"
  }
]
```

### pm_trades
**Status:** ✅ Exists
**Row Count:** 38,945,566
**Total Columns:** 18

**Proxy/Wallet Columns:**
- `wallet_address` (String)
- `is_proxy_trade` (UInt8)

**Full Schema:**
```
fill_id                        String
block_time                     DateTime
block_number                   UInt8
tx_hash                        String
asset_id_decimal               String
condition_id                   String
outcome_index                  UInt8
outcome_label                  String
question                       String
wallet_address                 String
operator_address               String
is_proxy_trade                 UInt8
side                           LowCardinality(String)
price                          Float64
shares                         Float64
collateral_amount              Float64
fee_amount                     Float64
data_source                    String
```

**Sample Rows (first 5):**
```json
[
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "block_time": "2022-12-18 01:03:12",
    "block_number": 0,
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "asset_id_decimal": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "condition_id": "1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "outcome_index": 0,
    "outcome_label": "Argentina",
    "question": "World Cup Final: France vs. Argentina",
    "wallet_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "operator_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "is_proxy_trade": 0,
    "side": "BUY",
    "price": 0.48,
    "shares": 592.73,
    "collateral_amount": 284.5104,
    "fee_amount": 0,
    "data_source": "clob_fills"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "block_time": "2022-12-18 01:03:12",
    "block_number": 0,
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "asset_id_decimal": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "condition_id": "1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "outcome_index": 0,
    "outcome_label": "Argentina",
    "question": "World Cup Final: France vs. Argentina",
    "wallet_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "operator_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "is_proxy_trade": 0,
    "side": "BUY",
    "price": 0.48,
    "shares": 592.73,
    "collateral_amount": 284.5104,
    "fee_amount": 0,
    "data_source": "clob_fills"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "block_time": "2022-12-18 01:03:12",
    "block_number": 0,
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "asset_id_decimal": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "condition_id": "1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "outcome_index": 0,
    "outcome_label": "Argentina",
    "question": "World Cup Final: France vs. Argentina",
    "wallet_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "operator_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "is_proxy_trade": 0,
    "side": "BUY",
    "price": 0.48,
    "shares": 592.73,
    "collateral_amount": 284.5104,
    "fee_amount": 0,
    "data_source": "clob_fills"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "block_time": "2022-12-18 01:03:12",
    "block_number": 0,
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "asset_id_decimal": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "condition_id": "1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "outcome_index": 0,
    "outcome_label": "Argentina",
    "question": "World Cup Final: France vs. Argentina",
    "wallet_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "operator_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "is_proxy_trade": 0,
    "side": "BUY",
    "price": 0.48,
    "shares": 592.73,
    "collateral_amount": 284.5104,
    "fee_amount": 0,
    "data_source": "clob_fills"
  },
  {
    "fill_id": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f_0x42b60fd40c76c6f57213e57a1b95c4860142495edf74fdccabb18f6cba84fde2",
    "block_time": "2022-12-18 01:03:12",
    "block_number": 0,
    "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f",
    "asset_id_decimal": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
    "condition_id": "1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
    "outcome_index": 0,
    "outcome_label": "Argentina",
    "question": "World Cup Final: France vs. Argentina",
    "wallet_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "operator_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
    "is_proxy_trade": 0,
    "side": "BUY",
    "price": 0.48,
    "shares": 592.73,
    "collateral_amount": 284.5104,
    "fee_amount": 0,
    "data_source": "clob_fills"
  }
]
```

---
## Canonical Wallet Usage in PnL Views

### pm_trades
- **canonical_wallet:** ❌ Not used
- **proxy_wallet:** ✅ Used
- **wallet_address:** ✅ Used

**View Definition:**
```sql
CREATE VIEW default.pm_trades\n(\n    `fill_id` String,\n    `block_time` DateTime,\n    `block_number` UInt8,\n    `tx_hash` String,\n    `asset_id_decimal` String,\n    `condition_id` String,\n    `outcome_index` UInt8,\n    `outcome_label` String,\n    `question` String,\n    `wallet_address` String,\n    `operator_address` String,\n    `is_proxy_trade` UInt8,\n    `side` LowCardinality(String),\n    `price` Float64,\n    `shares` Float64,\n    `collateral_amount` Float64,\n    `fee_amount` Float64,\n    `data_source` String\n)\nAS SELECT\n    cf.fill_id,\n    cf.timestamp AS block_time,\n    0 AS block_number,\n    cf.tx_hash,\n    cf.asset_id AS asset_id_decimal,\n    atm.condition_id AS condition_id,\n    atm.outcome_index AS outcome_index,\n    atm.outcome_label AS outcome_label,\n    atm.question AS question,\n    lower(cf.proxy_wallet) AS wallet_address,\n    lower(cf.user_eoa) AS operator_address,\n    multiIf(lower(cf.proxy_wallet) != lower(cf.user_eoa), 1, 0) AS is_proxy_trade,\n    cf.side,\n    cf.price,\n    cf.size / 1000000. AS shares,\n    (cf.size / 1000000.) * cf.price AS collateral_amount,\n    ((cf.size / 1000000.) * cf.price) * (cf.fee_rate_bps / 10000.) AS fee_amount,\n    \'clob_fills\' AS data_source\nFROM default.clob_fills AS cf\nINNER JOIN default.pm_asset_token_map AS atm ON cf.asset_id = atm.asset_id_decimal\nWHERE (cf.fill_id IS NOT NULL) AND (cf.asset_id IS NOT NULL)

```

### pm_wallet_market_pnl_resolved
- **canonical_wallet:** ❌ Not used
- **proxy_wallet:** ❌ Not used
- **wallet_address:** ✅ Used

**View Definition:** (too large, truncated)

### pm_wallet_pnl_summary
- **canonical_wallet:** ❌ Not used
- **proxy_wallet:** ❌ Not used
- **wallet_address:** ✅ Used

**View Definition:**
```sql
CREATE VIEW default.pm_wallet_pnl_summary\n(\n    `wallet_address` String,\n    `total_markets` UInt64,\n    `total_trades` UInt64,\n    `gross_notional` Float64,\n    `net_notional` Float64,\n    `fees_paid` Float64,\n    `pnl_gross` Float64,\n    `pnl_net` Float64,\n    `winning_markets` UInt64,\n    `losing_markets` UInt64,\n    `markets_with_result` UInt64,\n    `win_rate` Nullable(Float64),\n    `avg_position_size` Nullable(Float64),\n    `data_source` String\n)\nAS WITH wallet_aggregates AS\n    (\n        SELECT\n            w.wallet_address,\n            COUNTDistinct(w.condition_id) AS total_markets,\n            sum(w.total_trades) AS total_trades,\n            sum(w.gross_notional) AS gross_notional,\n            sum(w.net_notional) AS net_notional,\n            sum(w.fees_paid) AS fees_paid,\n            sum(w.pnl_gross) AS pnl_gross,\n            sum(w.pnl_net) AS pnl_net,\n            COUNTDistinct(multiIf((w.is_winning_outcome = 1) AND (w.pnl_net > 0.), w.condition_id, NULL)) AS winning_markets,\n            COUNTDistinct(multiIf((w.is_winning_outcome = 1) AND (w.pnl_net < 0.), w.condition_id, NULL)) AS losing_markets\n        FROM default.pm_wallet_market_pnl_resolved AS w\n        GROUP BY w.wallet_address\n    )\nSELECT\n    wallet_address,\n    total_markets,\n    total_trades,\n    gross_notional,\n    net_notional,\n    fees_paid,\n    pnl_gross,\n    pnl_net,\n    winning_markets,\n    losing_markets,\n    winning_markets + losing_markets AS markets_with_result,\n    if((winning_markets + losing_markets) > 0, winning_markets / (winning_markets + losing_markets), NULL) AS win_rate,\n    if(total_trades > 0, gross_notional / total_trades, NULL) AS avg_position_size,\n    \'pm_wallet_market_pnl_resolved_v1\' AS data_source\nFROM\nwallet_aggregates

```

---
## xcnstrategy Wallet Mapping

**pm_user_proxy_wallets:** Not available

**wallet_identity_map Results:** 1 rows

```json
[
  {
    "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    "proxy_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    "canonical_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    "fills_count": "194",
    "markets_traded": "45",
    "first_fill_ts": "2024-08-22 12:20:46.000",
    "last_fill_ts": "2025-09-10 01:20:32.000"
  }
]
```

---
## Summary

**Key Findings:**

- Proxy mapping infrastructure EXISTS in the codebase
- pm_user_proxy_wallets table contains EOA → proxy mappings
- wallet_identity_map table contains canonical wallet identities
- clob_fills has both proxy_wallet and user_eoa columns
- PnL views currently use wallet_address (not canonical)
- Scripts exist to build and maintain proxy mappings
- lib/polymarket/resolver has resolveProxyViaAPI function

**Next Steps:**

1. Document current proxy mapping design in PROXY_MAPPING_SPEC_C1.md
2. Verify if PnL views use proxy mapping (initial check: NO)
3. Wire canonical_wallet_address into pm_trades
4. Propagate canonical wallets into PnL views
5. Re-run xcnstrategy comparison with canonical wallets
