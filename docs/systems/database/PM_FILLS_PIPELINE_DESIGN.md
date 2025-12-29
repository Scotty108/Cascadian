# PM Fills Pipeline Design

## Status: Design Complete, Implementation Required

**Date:** 2025-11-22
**Author:** Claude 1

---

## Summary

This document outlines the design for computing ground-truth wallet PnL from Polymarket fills data. The key insight is that we need to update the Goldsky transform to capture ALL fields from `polymarket.order_filled` events.

---

## Current State

### pm_trader_events (290M rows)
- **Structure:** One row per fill side (maker `-m` suffix, taker `-t` suffix)
- **Fields captured:**
  - `event_id`: `{txHash}_{orderHash}-{m|t}`
  - `trader_wallet`: wallet address
  - `token_id`: asset being GIVEN by this party (`0` = USDC)
  - `amount_usdc`: amount of asset being given
  - `trade_time`, `transaction_hash`, `block_number`

### Problem
- Current schema captures only ONE side's amount per event
- To compute price/size, we need BOTH `makerAmountFilled` AND `takerAmountFilled`
- JOINing/aggregating 290M rows times out (~2 min+ and 54GB memory)
- `fee` field is not captured

---

## OrderFilled Event Schema (from Goldsky orderbook-subgraph)

```graphql
type OrderFilledEvent {
  id: ID!
  orderHash: String!
  maker: String!
  taker: String!
  makerAssetId: String!     # What maker GIVES (0 = USDC)
  takerAssetId: String!     # What taker GIVES
  makerAmountFilled: BigInt! # Amount of maker asset
  takerAmountFilled: BigInt! # Amount of taker asset
  fee: BigInt!
  timestamp: BigInt!
}
```

### Direction Logic
- If `makerAssetId = 0` → maker gives USDC → maker **BUYS** tokens
- If `makerAssetId != 0` → maker gives tokens → maker **SELLS** tokens

### Price Calculation
```
price = USDC_amount / token_amount
      = (makerAssetId == 0 ? makerAmountFilled : takerAmountFilled)
        / (makerAssetId == 0 ? takerAmountFilled : makerAmountFilled)
```

---

## Proposed Solution

### Option A: Update Goldsky Transform (Recommended)

Update `unify_orders` to emit ALL needed fields per event:

```yaml
transforms:
  unify_orders:
    type: sql
    sql: |-
      -- Maker row (enriched)
      SELECT
        `id` || '-m' AS event_id,
        `maker` AS trader_wallet,
        `maker_asset_id` AS asset_given_id,
        CAST(`maker_amount_filled` AS DOUBLE) AS amount_given,
        CAST(`taker_amount_filled` AS DOUBLE) AS amount_received,
        -- Derived fields
        IF(`maker_asset_id` = '0', 'BUY', 'SELL') AS side,
        IF(`maker_asset_id` = '0',
          `maker_amount_filled` / `taker_amount_filled`,
          `taker_amount_filled` / `maker_amount_filled`
        ) AS price,
        IF(`maker_asset_id` = '0', `taker_amount_filled`, `maker_amount_filled`) AS size_shares,
        IF(`maker_asset_id` = '0', `maker_amount_filled`, `taker_amount_filled`) AS notional_usdc,
        CAST(`fee` AS DOUBLE) AS fee_usdc,
        IF(`maker_asset_id` = '0', `taker_asset_id`, `maker_asset_id`) AS outcome_token_id,
        toTimestamp(fromUnixTimestamp(CAST(`timestamp` AS BIGINT))) AS trade_time,
        `transaction_hash`,
        CAST(`vid` AS BIGINT) AS block_number,
        'maker' AS role
      FROM polymarket_orders

      UNION ALL

      -- Taker row (enriched)
      SELECT
        `id` || '-t' AS event_id,
        `taker` AS trader_wallet,
        `taker_asset_id` AS asset_given_id,
        CAST(`taker_amount_filled` AS DOUBLE) AS amount_given,
        CAST(`maker_amount_filled` AS DOUBLE) AS amount_received,
        -- Taker side is OPPOSITE of maker
        IF(`maker_asset_id` = '0', 'SELL', 'BUY') AS side,
        IF(`maker_asset_id` = '0',
          `maker_amount_filled` / `taker_amount_filled`,
          `taker_amount_filled` / `maker_amount_filled`
        ) AS price,
        IF(`maker_asset_id` = '0', `taker_amount_filled`, `maker_amount_filled`) AS size_shares,
        IF(`maker_asset_id` = '0', `maker_amount_filled`, `taker_amount_filled`) AS notional_usdc,
        0 AS fee_usdc,  -- Fees typically charged to taker
        IF(`maker_asset_id` = '0', `taker_asset_id`, `maker_asset_id`) AS outcome_token_id,
        toTimestamp(fromUnixTimestamp(CAST(`timestamp` AS BIGINT))) AS trade_time,
        `transaction_hash`,
        CAST(`vid` AS BIGINT) AS block_number,
        'taker' AS role
      FROM polymarket_orders
```

### New pm_trader_events Schema

```sql
CREATE TABLE pm_trader_events_v2 (
  event_id String,
  trader_wallet String,
  role Enum8('maker' = 1, 'taker' = 2),
  side Enum8('BUY' = 1, 'SELL' = 2),
  outcome_token_id String,
  price Float64,
  size_shares Float64,
  notional_usdc Float64,
  fee_usdc Float64,
  trade_time DateTime,
  transaction_hash String,
  block_number UInt64,
  insert_time DateTime DEFAULT now(),
  is_deleted UInt8 DEFAULT 0
) ENGINE = SharedMergeTree
ORDER BY (trader_wallet, trade_time, event_id);
```

### pm_fills View (post-migration)

```sql
CREATE VIEW pm_fills AS
SELECT
  t.event_id,
  t.trader_wallet as wallet,
  t.role,
  t.side,
  t.outcome_token_id,
  m.condition_id,
  mm.slug,
  mm.question,
  t.price,
  t.size_shares / 1e6 as size_shares,
  t.notional_usdc / 1e6 as notional_usdc,
  t.fee_usdc / 1e6 as fee_usdc,
  t.trade_time,
  t.transaction_hash,
  t.block_number
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map m ON t.outcome_token_id = m.token_id_dec
LEFT JOIN pm_market_metadata mm ON m.condition_id = mm.condition_id
WHERE t.is_deleted = 0;
```

---

## Migration Plan

1. **Create `pm_trader_events_v2` table** with new schema
2. **Update Goldsky pipeline YAML** with enriched transform
3. **Backfill from earliest** (full re-ingest, ~2-5 hours with 8 workers)
4. **Validate** sample of fills against Goldsky subgraph
5. **Create `pm_fills` view** joining to token map + metadata
6. **Build `pm_wallet_market_pnl`** from fills + resolutions
7. **Run validation checks** (internal consistency, external spot-checks)

---

## Validation Approach

### Internal Consistency
- Sum of BUY notional should approximately equal SUM of SELL notional (market is zero-sum)
- For resolved markets: winning_tokens * 1.0 + losing_tokens * 0.0 should match resolution payouts

### External Spot-Checks
- Sample 10-20 wallets, verify fills against Goldsky subgraph queries
- Compare wallet PnL against Polymarket leaderboard (if available)

---

## Files Referenced
- Current pipeline: `cascadian-hard-pipe-v3` (Goldsky)
- Token mapping: `pm_token_to_condition_map`
- Market metadata: `pm_market_metadata`
- Documentation: `docs/systems/database/GOLDSKY_PNL_DATA_LIMITATIONS.md`

---

## Next Steps

1. **Immediate:** Update Goldsky pipeline YAML with enriched transform
2. **Backfill:** Re-ingest all order_filled events with new schema
3. **Post-backfill:** Create pm_fills view and wallet PnL tables
4. **Validation:** Run internal/external checks before deprecating old schema
