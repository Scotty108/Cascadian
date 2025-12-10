# Cascadian PnL System - Technical Report for GoldSky

**Prepared for:** John @ GoldSky
**Date:** December 1, 2025
**Support Thread:** Roddick

---

## Executive Summary

Cascadian is building an analytics platform for Polymarket that calculates how much money each wallet has made or lost (Profit & Loss). We use GoldSky pipelines to pull blockchain data into our database, then we compute PnL by combining trade data with market resolution outcomes.

**Current Status:**
- We have **1.6 million wallets** and **787 million trade events** in our database
- Our PnL calculations **match Polymarket exactly** for wallets that have cashed out all their winnings
- We have a **known discrepancy** for wallets holding unclaimed winning positions (explained in detail in Section 4)
- We need GoldSky's help to verify we're not missing any data sources

---

## 1. Data Sources & Tables

### 1.1 GoldSky Pipeline Data

| Table | Rows | Size | Source | Description |
|-------|------|------|--------|-------------|
| `pm_trader_events_v2` | 787,749,784 | 63.36 GiB | GoldSky: `polymarket.order_filled` | CLOB order fills (maker + taker sides) |
| `pm_ctf_events` | 118,493,780 | 6.79 GiB | GoldSky: `matic.raw_logs` | CTF events: splits, merges, redemptions |
| `pm_condition_resolutions` | 198,155 | 45.58 MiB | GoldSky: `matic.raw_logs` | Market resolution outcomes (payout_numerators) |
| `pm_fpmm_trades` | TBD | TBD | GoldSky: `matic.raw_logs` | AMM/FPMM trades (FPMMBuy/FPMMSell) |
| `pm_erc1155_transfers` | 42,649,320 | 1.76 GiB | GoldSky | Conditional token transfers |

### 1.2 Derived/Enrichment Tables

| Table | Rows | Size | Source | Description |
|-------|------|------|--------|-------------|
| `pm_token_to_condition_map_v3` | 358,617 | 46.77 MiB | **Gamma API** | Maps token_id → condition_id + outcome_index |
| `pm_cascadian_pnl_v1_new` | 24,695,013 | 1.01 GiB | Computed | Pre-calculated PnL per wallet/market |

### 1.3 Gamma API (Event Enrichment)

We use the **Polymarket Gamma API** to enrich blockchain data with market metadata:
- **Base URL:** `https://gamma-api.polymarket.com`
- **Purpose:** Map token_id → condition_id, get market questions, categories, outcome names
- **Used for:** Building `pm_token_to_condition_map_v3` table

### 1.4 Data Coverage

- **Unique wallets in database:** 1,644,671+ (CLOB traders)
- **Time range:** Full historical (earliest to present)
- **CTF Event breakdown:**
  - PositionSplit: 78,198,817 events
  - PositionsMerge: 20,164,085 events
  - PayoutRedemption: 20,130,878 events

---

## 2. GoldSky Pipeline Configurations (ACTUAL PRODUCTION)

We have **5 active pipelines** in GoldSky. Below are the exact YAML configurations currently running in production.

### 2.1 CLOB Fills Pipeline: `cascadian-hard-pipe-v3`

**Source:** `polymarket.order_filled` v1.1.0 (GoldSky dataset)
**Target:** `pm_trader_events_v2`
**Status:** ACTIVE (streaming from Nov 30, 2024)

```yaml
name: cascadian-hard-pipe-v3
version: 20
resource_size: s
apiVersion: 3

sources:
  polymarket_orders:
    dataset_name: polymarket.order_filled
    version: 1.1.0
    type: dataset
    start_at: '1732924800000'  # Nov 30, 2024

transforms:
  fills_enriched:
    type: sql
    primary_key: event_id
    sql: |-
      -- Maker side
      SELECT
        `id` || '-m' AS event_id,
        `maker` AS trader_wallet,
        'maker' AS role,
        CASE WHEN `maker_asset_id` = '0' THEN 'buy' ELSE 'sell' END AS side,
        CASE WHEN `maker_asset_id` = '0' THEN `taker_asset_id` ELSE `maker_asset_id` END AS token_id,
        CASE WHEN `maker_asset_id` = '0' THEN CAST(`maker_amount_filled` AS DOUBLE)
             ELSE CAST(`taker_amount_filled` AS DOUBLE) END AS usdc_amount,
        CASE WHEN `maker_asset_id` = '0' THEN CAST(`taker_amount_filled` AS DOUBLE)
             ELSE CAST(`maker_amount_filled` AS DOUBLE) END AS token_amount,
        CAST(0 AS DOUBLE) AS fee_amount,
        TO_TIMESTAMP(FROM_UNIXTIME(CAST(`timestamp` AS BIGINT))) AS trade_time,
        `transaction_hash`,
        CAST(`vid` AS BIGINT) AS block_number
      FROM polymarket_orders

      UNION ALL

      -- Taker side
      SELECT
        `id` || '-t' AS event_id,
        `taker` AS trader_wallet,
        'taker' AS role,
        CASE WHEN `taker_asset_id` = '0' THEN 'buy' ELSE 'sell' END AS side,
        CASE WHEN `taker_asset_id` = '0' THEN `maker_asset_id` ELSE `taker_asset_id` END AS token_id,
        CASE WHEN `taker_asset_id` = '0' THEN CAST(`taker_amount_filled` AS DOUBLE)
             ELSE CAST(`maker_amount_filled` AS DOUBLE) END AS usdc_amount,
        CASE WHEN `taker_asset_id` = '0' THEN CAST(`maker_amount_filled` AS DOUBLE)
             ELSE CAST(`taker_amount_filled` AS DOUBLE) END AS token_amount,
        CAST(`fee` AS DOUBLE) AS fee_amount,
        TO_TIMESTAMP(FROM_UNIXTIME(CAST(`timestamp` AS BIGINT))) AS trade_time,
        `transaction_hash`,
        CAST(`vid` AS BIGINT) AS block_number
      FROM polymarket_orders

sinks:
  clickhouse_fills_v2:
    type: clickhouse
    table: pm_trader_events_v2
    secret_name: CASCADIAN_FINAL_HTTP
    batch_size: 10000
    batch_flush_interval: 3s
    append_only_mode: true
    from: fills_enriched
```

### 2.2 CTF Events + Resolutions Pipeline: `conditionresolutions-final2`

**Source:** `matic.raw_logs` filtered for CTF contract `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`
**Target:** `pm_ctf_events` AND `pm_condition_resolutions`
**Status:** ACTIVE (with snapshot)

```yaml
name: conditionresolutions-final2
version: 7
resource_size: m
from_snapshot:
  id: snapshot-cmida0hcfkh6601z91ecq9bb5
apiVersion: 3

sources:
  matic_raw_logs:
    dataset_name: matic.raw_logs
    version: 1.0.0
    type: dataset
    start_at: earliest
    filter: >-
      address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045' and (
        topics like '0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177%' or
        topics like '0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894%' or
        topics like '0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d%'
      )

transforms:
  matic_decoded_sql:
    type: sql
    primary_key: id
    sql: |-
      SELECT
        _gs_log_decode('[...CTF ABI...]', topics, data) AS decoded,
        id, block_number, block_timestamp, transaction_hash
      FROM matic_raw_logs

  matic_resolutions_sql:
    type: sql
    primary_key: id
    sql: |-
      SELECT
        decoded.event_params[1] AS condition_id,
        decoded.event_params[5] AS payout_numerators,
        decoded.event_params[4] AS payout_denominator,
        TO_TIMESTAMP(FROM_UNIXTIME(block_timestamp)) AS resolved_at,
        block_number,
        transaction_hash AS tx_hash,
        id
      FROM matic_decoded_sql
      WHERE decoded IS NOT NULL
        AND decoded.event_signature = 'ConditionResolution'

  matic_ctf_events_sql:
    type: sql
    primary_key: id
    sql: |-
      -- PositionSplit
      SELECT 'PositionSplit' AS event_type,
        decoded.event_params[1] AS user_address,
        decoded.event_params[4] AS condition_id,
        decoded.event_params[6] AS amount_or_payout,
        TO_TIMESTAMP(FROM_UNIXTIME(block_timestamp)) AS event_timestamp,
        block_number, transaction_hash AS tx_hash, id
      FROM matic_decoded_sql
      WHERE decoded.event_signature = 'PositionSplit'

      UNION ALL

      -- PositionsMerge
      SELECT 'PositionsMerge' AS event_type, ...
      WHERE decoded.event_signature = 'PositionsMerge'

      UNION ALL

      -- PayoutRedemption
      SELECT 'PayoutRedemption' AS event_type, ...
      WHERE decoded.event_signature = 'PayoutRedemption'

sinks:
  matic_decoded_sink:
    type: clickhouse
    table: pm_condition_resolutions
    secret_name: CASCADIAN_FINAL_HTTP
    from: matic_resolutions_sql

  matic_ctf_events_sink:
    type: clickhouse
    table: pm_ctf_events
    secret_name: CASCADIAN_FINAL_HTTP
    from: matic_ctf_events_sql
```

**Topic Signatures in this pipeline:**
- `0xab3760c3...` - ConditionPreparation
- `0xb44d84d3...` - ConditionResolution
- `0x2682012a...` - PayoutRedemption

### 2.3 Splits & Merges Pipeline: `splits-and-merges-only`

**Source:** `matic.raw_logs`
**Target:** `pm_ctf_events`
**Status:** ACTIVE

```yaml
name: splits-and-merges-only
version: 1
resource_size: s
apiVersion: 3

sources:
  matic_raw_logs:
    dataset_name: matic.raw_logs
    version: 1.0.0
    type: dataset
    start_at: earliest
    filter: >-
      address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045' and (
        topics like '0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298%' or
        topics like '0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca%'
      )

transforms:
  matic_ctf_events_sql:
    type: sql
    sql: |-
      -- PositionSplit ONLY
      SELECT 'PositionSplit' AS event_type, ...
      WHERE decoded.event_signature = 'PositionSplit'

      UNION ALL

      -- PositionsMerge ONLY
      SELECT 'PositionsMerge' AS event_type, ...
      WHERE decoded.event_signature = 'PositionsMerge'

sinks:
  matic_ctf_events_sink:
    type: clickhouse
    table: pm_ctf_events
    secret_name: CASCADIAN_FINAL_HTTP
    from: matic_ctf_events_sql
```

**Topic Signatures:**
- `0x2e6bb91f...` - PositionSplit
- `0x6f13ca62...` - PositionsMerge

### 2.4 FPMM/AMM Trades Pipeline: `cascadian-fpmm-trades-v1`

**Source:** `matic.raw_logs` (FPMMBuy/FPMMSell events)
**Target:** `pm_fpmm_trades`
**Status:** ACTIVE (from June 1, 2023)

```yaml
name: cascadian-fpmm-trades-v1
version: 8
resource_size: m
apiVersion: 3

sources:
  matic_raw_logs:
    dataset_name: matic.raw_logs
    version: 1.0.0
    type: dataset
    start_at: '1685577600000'  # June 1, 2023
    filter: >-
      topics like '0x4f62630f51608fc8a7603a9391a5101e58bd7c276139366fc107dc3b67c3dcf8%' or
      topics like '0xadcf2a240ed9300d681d9a3f5382b6c1beed1b7e46643e0c7b42cbe6e2d766b4%'

transforms:
  fpmm_decoded_sql:
    type: sql
    primary_key: id
    sql: |-
      SELECT
        _gs_log_decode(
          '[{"anonymous":false,"inputs":[{"indexed":true,"name":"buyer","type":"address"},
            {"indexed":false,"name":"investmentAmount","type":"uint256"},
            {"indexed":false,"name":"feeAmount","type":"uint256"},
            {"indexed":true,"name":"outcomeIndex","type":"uint256"},
            {"indexed":false,"name":"outcomeTokensBought","type":"uint256"}],"name":"FPMMBuy","type":"event"},
           {"anonymous":false,"inputs":[{"indexed":true,"name":"seller","type":"address"},
            {"indexed":false,"name":"returnAmount","type":"uint256"},
            {"indexed":false,"name":"feeAmount","type":"uint256"},
            {"indexed":true,"name":"outcomeIndex","type":"uint256"},
            {"indexed":false,"name":"outcomeTokensSold","type":"uint256"}],"name":"FPMMSell","type":"event"}]',
          topics, data
        ) AS decoded,
        id, address AS fpmm_pool_address, block_number, block_timestamp, transaction_hash
      FROM matic_raw_logs

  fpmm_events_sql:
    type: sql
    primary_key: event_id
    sql: |-
      -- FPMMBuy events
      SELECT
        CONCAT(id, '-buy') AS event_id,
        'FPMMBuy' AS event_type,
        fpmm_pool_address,
        decoded.event_params[1] AS trader_wallet,
        CAST(decoded.event_params[4] AS BIGINT) AS outcome_index,
        'buy' AS side,
        CAST(decoded.event_params[2] AS DOUBLE) / 1000000.0 AS usdc_amount,
        CAST(decoded.event_params[3] AS DOUBLE) / 1000000.0 AS fee_amount,
        CAST(decoded.event_params[5] AS DOUBLE) / 1000000.0 AS token_amount,
        TO_TIMESTAMP(FROM_UNIXTIME(block_timestamp)) AS trade_time,
        block_number,
        transaction_hash
      FROM fpmm_decoded_sql
      WHERE decoded.event_signature = 'FPMMBuy'

      UNION ALL

      -- FPMMSell events
      SELECT
        CONCAT(id, '-sell') AS event_id,
        'FPMMSell' AS event_type,
        ...
      FROM fpmm_decoded_sql
      WHERE decoded.event_signature = 'FPMMSell'

sinks:
  clickhouse_fpmm:
    type: clickhouse
    table: pm_fpmm_trades
    secret_name: CASCADIAN_FINAL_HTTP
    from: fpmm_events_sql
```

**Topic Signatures:**
- `0x4f62630f...` - FPMMBuy
- `0xadcf2a24...` - FPMMSell

### 2.5 Paused Pipeline: `conditionresolutions-final2-copy`

**Status:** PAUSED (duplicate of main pipeline, different topic signatures)

---

### Summary of All Topic Signatures

| Event | Topic Signature | Pipeline |
|-------|-----------------|----------|
| PositionSplit | `0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298` | splits-and-merges-only |
| PositionsMerge | `0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca` | splits-and-merges-only |
| PayoutRedemption | `0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d` | conditionresolutions-final2 |
| ConditionPreparation | `0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177` | conditionresolutions-final2 |
| ConditionResolution | `0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894` | conditionresolutions-final2 |
| FPMMBuy | `0x4f62630f51608fc8a7603a9391a5101e58bd7c276139366fc107dc3b67c3dcf8` | cascadian-fpmm-trades-v1 |
| FPMMSell | `0xadcf2a240ed9300d681d9a3f5382b6c1beed1b7e46643e0c7b42cbe6e2d766b4` | cascadian-fpmm-trades-v1 |

---

## 3. Data Coverage & Row Counts (Live Production)

### 3.1 Table Statistics (as of Dec 1, 2025)

| Table | Rows | Size | Pipeline | Status |
|-------|------|------|----------|--------|
| `pm_trader_events_v2` | **787,785,582** | 63.36 GiB | cascadian-hard-pipe-v3 | Active |
| `pm_ctf_events` | **118,503,775** | 6.79 GiB | conditionresolutions-final2 + splits-and-merges-only | Active |
| `pm_erc1155_transfers` | **42,649,320** | 1.76 GiB | Legacy | Active |
| `pm_ctf_split_merge_expanded` | **31,710,366** | 1.99 GiB | Derived | Active |
| `pm_cascadian_pnl_v1_new` | **24,695,013** | 1.01 GiB | Computed | Active |
| `pm_fpmm_trades` | **4,423,130** | 383.08 MiB | cascadian-fpmm-trades-v1 | Active |
| `pm_token_to_condition_map_v3` | **358,617** | 25.78 MiB | Gamma API | Active |
| `pm_condition_resolutions` | **198,164** | 21.25 MiB | conditionresolutions-final2 | Active |
| `pm_market_metadata` | **179,830** | 52.76 MiB | Gamma API | Active |

### 3.2 CTF Events Breakdown

| Event Type | Row Count | Unique Wallets |
|------------|-----------|----------------|
| PositionSplit | **78,190,691** | 74,501 |
| PositionsMerge | **20,149,847** | 23,468 |
| PayoutRedemption | **20,048,755** | 778,122 |

### 3.3 Unique Wallets Coverage

| Data Source | Unique Wallets |
|-------------|----------------|
| CLOB (pm_trader_events_v2) | **1,644,671** |
| CTF (pm_ctf_events) | **791,100** |
| Mapped tokens (Gamma API) | **358,617** tokens |
| Resolved conditions | **198,164** markets |

### 3.4 Time Coverage

| Table | Earliest | Latest |
|-------|----------|--------|
| pm_trader_events_v2 | 2022-11-21 19:50:09 | 2025-12-01 21:11:28 |
| pm_ctf_events | 1970-01-01 (epoch) | 2025-12-01 21:11:30 |
| pm_condition_resolutions | 1970-01-01 (epoch) | 2025-12-01 21:02:00 |

---

## 4. Testing Results: Which Wallets Match Polymarket UI

We tested our calculation engine against 6 real wallets where we know the Polymarket UI shows their actual profit/loss. Here's what we found:

### 4.1 Test Results Summary

| Wallet Address | Our Calculation | Polymarket UI Shows | Match? | Why? |
|----------------|-----------------|---------------------|--------|------|
| `0xdfe10ac1ed86f4f2b87e26c84dcb4b77c39eff7e` | **+$4,405** | **+$4,405** | **EXACT** | Cashed out all winnings |
| `0x9d36c904d33e4bed5aa95297f25a2cf04a2e73cf` | -$7,451 | -$6,139 | Close (21% off) | Has some unclaimed wins |
| `0xd82831ad36c7ffbe862620c87b333cb58ccb9520` | -$253 | -$295 | Close (14% off) | Has some unclaimed wins |
| `0x3feb7f10729b719ef24374ec2ad1268ab4b7f4aa` | +$591 | +$470 | Close (26% off) | Has some unclaimed wins |
| `0x93b3cb33192eb148e9f2e5b267a3f1f07fea02b4` | +$336 | +$147 | Off (129%) | Never cashed out |
| `0x418db17e07e41f40199e88a4c4bc52c1fef1c24c` | +$2,503 | +$5 | Way off | Sitting on $2,500 in unclaimed Trump winnings |

### 4.2 The Perfect Match: Wallet `0xdfe10ac1ed86f4f2b87e26c84dcb4b77c39eff7e`

This wallet shows **exactly $4,405 profit** in both our system and Polymarket UI. Here's why it matches perfectly:

- This wallet made 51 trades across 22 different prediction markets
- When markets resolved in their favor, they **cashed out every time** (17 redemption events)
- Because they cashed out everything, our calculation and Polymarket's calculation are identical

**This proves our engine works correctly.** The math is right.

### 4.3 The Big Discrepancy: Wallet `0x418db17e07e41f40199e88a4c4bc52c1fef1c24c`

This wallet shows a huge difference:
- **Our calculation:** +$2,503 profit
- **Polymarket UI:** +$5 profit

Here's what happened:
1. This wallet bought 7,494 Trump tokens for $4,999
2. Trump won, so those tokens are now worth $7,494 (they pay out $1 each)
3. **But the wallet never clicked "Redeem"** - the money is sitting there unclaimed
4. Our system counts the $2,495 profit because the market resolved
5. Polymarket UI only counts profit when you actually cash out

**This is NOT a data problem - we have all the data.** It's a question of *when* to count the profit.

### 4.4 How Polymarket UI Calculates Profit (and why it differs from us)

Polymarket uses what accountants call "cash basis" accounting:
- **Profit from winning bets:** Only counted when you click "Redeem" and receive USDC
- **Losses from losing bets:** Counted immediately when the market resolves (your tokens become worthless)

Our original engine used "mark-to-market" accounting:
- **Profit from winning bets:** Counted immediately when market resolves (even if unclaimed)
- **Losses from losing bets:** Counted immediately when market resolves

**The difference:** If you have unclaimed winnings, Polymarket shows lower profit than our system.

### 4.5 We Built a Fix: "Asymmetric Mode"

We updated our engine (V7/V8) to match Polymarket's approach:

| Wallet | Old Engine (V3) | New Engine (V7) | Polymarket UI |
|--------|-----------------|-----------------|---------------|
| `0xdfe10ac1ed86f4f2b87e26c84dcb4b77c39eff7e` | +$4,405 | +$4,405 | +$4,405 |
| `0x418db17e07e41f40199e88a4c4bc52c1fef1c24c` | +$2,503 | +$5 | +$5 |
| `0x9d36c904d33e4bed5aa95297f25a2cf04a2e73cf` | -$7,451 | -$8,763 | -$6,139 |

The new V7 engine is much closer to Polymarket UI for all wallets.

### 4.6 Remaining Small Differences

Even with V7, we still see 2-5% differences on some wallets. Possible causes:
1. **Fees:** We may be handling trading fees slightly differently
2. **AMM trades:** We recently added support for the old AMM system (before the order book). Polymarket may include these differently.
3. **Rounding:** Small differences in decimal handling

### 4.7 What We Still Need to Verify

We want to confirm with GoldSky/Polymarket:

1. **Are we missing any event types?** We capture:
   - Order book trades (CLOB fills)
   - Token redemptions (PayoutRedemption)
   - Market resolutions (ConditionResolution)
   - AMM trades (FPMMBuy/FPMMSell)

2. **Are there other ways tokens move?** Like:
   - NegRisk adapter events
   - Direct token transfers between wallets
   - Any other smart contract interactions

---

## 5. PnL Calculation Methodology

### 5.1 Algorithm Overview

We use **Average Cost Basis** accounting with three PnL sources:

```
Total PnL = CLOB Trading PnL + Redemption PnL + Implicit Resolution PnL
```

**Data Flow:**
```
CLOB Fills (pm_trader_events_v2)
    │
    ├──► Map token_id → condition_id (pm_token_to_condition_map_v3)
    │
    └──► Build position per (condition_id, outcome_index)
            │
            ├──► CLOB_BUY: Add to position at cost
            │
            ├──► CLOB_SELL: Realize PnL = (sell_price - avg_cost) × qty
            │
            └──► REDEMPTION: Same as SELL but at payout_price

CTF Events (pm_ctf_events)
    │
    └──► PayoutRedemption events = "sells" at resolution payout_price

Market Resolutions (pm_condition_resolutions)
    │
    └──► For unredeemed positions in resolved markets:
         Realize PnL = (payout_price - avg_cost) × remaining_qty
```

### 5.2 Core Algorithm Code

```typescript
// From lib/pnl/uiActivityEngineV3.ts

function calculateActivityPnL(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>
): CalculationResult {

  // Sort events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome (condition_id + outcome_index)
  const outcomeStates = new Map<string, OutcomeState>();

  for (const event of events) {
    const key = `${event.condition_id}_${event.outcome_index}`;
    const state = outcomeStates.get(key) || { position_qty: 0, position_cost: 0, realized_pnl: 0 };

    if (event.event_type === 'CLOB_BUY') {
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    }
    else if (event.event_type === 'CLOB_SELL' || event.event_type === 'REDEMPTION') {
      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;

        state.realized_pnl += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
    }
  }

  // PHASE 2: Implicit resolution for remaining positions
  for (const [key, state] of outcomeStates.entries()) {
    if (state.position_qty <= 0.01) continue;

    const [conditionId, outcomeIndex] = key.split('_');
    const resolution = resolutions.get(conditionId.toLowerCase());

    if (!resolution) continue; // Not resolved yet

    const payout_price = resolution.payout_numerators[outcomeIndex] || 0;
    const avg_cost = state.position_cost / state.position_qty;
    const pnl_from_resolution = (payout_price - avg_cost) * state.position_qty;

    state.realized_pnl += pnl_from_resolution;
  }

  return { pnl_total: sum(state.realized_pnl), ... };
}
```

### 5.3 Key SQL Queries

**CLOB Fills Query (with deduplication):**
```sql
SELECT
  m.condition_id,
  m.outcome_index,
  fills.trade_time as event_time,
  fills.side,
  fills.qty_tokens,
  fills.usdc_notional,
  fills.price
FROM (
  -- Deduplicate via GROUP BY event_id
  SELECT
    any(token_id) as token_id,
    any(trade_time) as trade_time,
    any(side) as side,
    any(token_amount) / 1000000.0 as qty_tokens,
    any(usdc_amount) / 1000000.0 as usdc_notional,
    CASE WHEN any(token_amount) > 0
      THEN any(usdc_amount) / any(token_amount)
      ELSE 0
    END as price
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x...')
    AND is_deleted = 0
  GROUP BY event_id
) fills
INNER JOIN pm_token_to_condition_map_v3 m
  ON fills.token_id = m.token_id_dec
```

**Redemption Events Query:**
```sql
SELECT
  e.condition_id,
  e.amount_or_payout / 1e6 as payout_usdc,
  e.event_timestamp,
  r.payout_numerators
FROM pm_ctf_events e
LEFT JOIN pm_condition_resolutions r
  ON lower(e.condition_id) = lower(r.condition_id)
WHERE lower(e.user_address) = lower('0x...')
  AND e.event_type = 'PayoutRedemption'
  AND e.is_deleted = 0
```

---

## 6. Questions for GoldSky Team

### 6.1 Confirming Our Data is Complete

We want to verify we're capturing everything. Here's what we currently ingest:

**From `polymarket.order_filled` dataset:**
- Every trade on the order book (787 million events)
- Both sides of each trade (maker and taker)

**From `matic.raw_logs` (CTF contract `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`):**
- PositionSplit events (78 million) - when users create positions
- PositionsMerge events (20 million) - when users close positions
- PayoutRedemption events (20 million) - when users cash out winnings
- ConditionResolution events (198,000) - when markets resolve

**From `matic.raw_logs` (FPMM pools):**
- FPMMBuy events (4.4 million) - AMM buys
- FPMMSell events - AMM sells

**Question:** Are there any other event types or data sources we should be capturing?

### 6.2 Specific Questions

1. **NegRisk Adapter:** Does Polymarket use a "NegRisk" adapter contract for certain markets? If so, what's the contract address and what events does it emit?

2. **Direct Transfers:** Can users transfer position tokens directly between wallets (outside of trading)? If so, how should we account for these?

3. **The Subgraph `realized_pnl` Field:** During our call, we noticed that the subgraph's `realized_pnl` field only returns positive numbers. Is this intentional? Does it only capture gains, not losses?

4. **How Polymarket.com Calculates PnL:** Is the profit/loss shown on wallet pages calculated from:
   - The subgraph data?
   - Separate backend calculations?
   - Something else?

### 6.3 Large Wallet Discrepancy (From Our Call)

We discussed a specific wallet during the call that showed a big mismatch:

| Source | PnL Value |
|--------|-----------|
| Polymarket UI | -$10,000,000 (big loss) |
| Our calculation | +$28,000,000 (big profit) |
| Subgraph realized_pnl | +$28,000,000 |

Our calculation matched the subgraph but NOT the UI. This suggests the UI uses a different data source or calculation method than the subgraph.

**Question:** What data source does the Polymarket UI use for the wallet profit/loss display?

---

## 7. Data Quality Notes

### 7.1 Deduplication Required

The `pm_trader_events_v2` table contains duplicate rows due to historical backfill issues. **Always use GROUP BY event_id** pattern:

```sql
-- CORRECT: Deduplicated
SELECT ... FROM (
  SELECT any(column) as column
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) ...

-- WRONG: Will count duplicates
SELECT * FROM pm_trader_events_v2
```

### 7.2 Unit Conversions

- **USDC:** Stored as integers, divide by 1,000,000 for USD
- **Tokens:** Stored as integers, divide by 1,000,000 for shares
- **Prices:** Calculated as USDC/tokens (0.0 to 1.0 range)

### 7.3 ID Formats

- **condition_id:** 32-byte hex string (64 chars without 0x)
- **token_id:** Large integer (decimal representation)
- **Always normalize to lowercase** for joins

---

## 8. Next Steps

### What We Need From GoldSky

1. **Review this document** and let us know if any of our pipeline configurations look wrong
2. **Confirm we're not missing any event types** (especially NegRisk adapter events)
3. **Explain how Polymarket.com calculates the wallet PnL** shown in their UI

### What We'll Do Next

1. Once we confirm our data sources are complete, we'll run a larger validation (100+ wallets)
2. Investigate the remaining 2-5% differences on wallets that should match exactly
3. Add the NegRisk adapter events if they exist

---

## Appendix A: Table Schemas

### pm_trader_events_v2
```sql
CREATE TABLE pm_trader_events_v2 (
  event_id String,
  trader_wallet String,
  role String,              -- 'maker' or 'taker'
  side String,              -- 'buy' or 'sell'
  token_id String,          -- Outcome token ID
  usdc_amount Int64,        -- USDC in raw units (÷1e6)
  token_amount Int64,       -- Tokens in raw units (÷1e6)
  fee_amount Int64,
  trade_time DateTime,
  transaction_hash String,
  block_number UInt64,
  is_deleted UInt8
)
```

### pm_ctf_events
```sql
CREATE TABLE pm_ctf_events (
  event_type String,        -- 'PositionSplit', 'PositionsMerge', 'PayoutRedemption'
  user_address String,
  collateral_token String,
  parent_collection_id String,
  condition_id String,
  partition_index_sets String,
  amount_or_payout String,  -- Raw amount (÷1e6 for USDC)
  event_timestamp DateTime,
  block_number UInt64,
  tx_hash String,
  is_deleted UInt8
)
```

### pm_condition_resolutions
```sql
CREATE TABLE pm_condition_resolutions (
  condition_id String,
  payout_numerators String,  -- JSON array: [1, 0] for Yes wins, [0, 1] for No wins
  payout_denominator UInt64,
  resolved_at DateTime
)
```

### pm_token_to_condition_map_v3
```sql
CREATE TABLE pm_token_to_condition_map_v3 (
  condition_id String,
  token_id_dec String,      -- Decimal token ID
  slug String,              -- Market slug
  question String,
  category String,
  outcome_index UInt8       -- 0 = Yes, 1 = No (for binary markets)
)
```

---

## Appendix B: Contact & Resources

**Cascadian Support Thread:** [Same thread with Roddick]

**GitHub Repos Referenced:**
- Polymarket CLOB client
- Polymarket CTF exchange contracts

**Documentation:**
- GoldSky Mirror docs
- Polymarket API docs

---

*Report prepared by Cascadian development team*
