# PnL Data Sources

**Last Updated:** 2025-12-17

---

## Table of Contents

1. [pm_trader_events_v2](#pm_trader_events_v2)
2. [pm_unified_ledger_v9_clob_tbl](#pm_unified_ledger_v9_clob_tbl)
3. [pm_ctf_events](#pm_ctf_events)
4. [pm_condition_resolutions](#pm_condition_resolutions)
5. [pm_wallet_engine_pnl_cache](#pm_wallet_engine_pnl_cache)
6. [pm_wallet_trade_stats](#pm_wallet_trade_stats)

---

## pm_trader_events_v2

**Purpose:** Raw CLOB order fills (OrderFilled events)
**Row Count:** ~856M rows
**Coverage:** All CLOB trades since platform launch

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `trader_wallet` | String | Wallet address |
| `event_id` | String | Unique event identifier |
| `role` | String | 'maker' or 'taker' |
| `side` | String | 'buy' or 'sell' |
| `token_id` | String | ERC1155 token ID |
| `token_amount` | Int64 | Tokens in **6 decimals** (÷ 1,000,000) |
| `usdc_amount` | Int64 | USDC in **6 decimals** (÷ 1,000,000) |
| `trade_time` | DateTime | Trade timestamp |
| `is_deleted` | UInt8 | Soft delete flag (0 = active) |

### Units and Scaling

- `token_amount` and `usdc_amount` are in **6 decimals**
- Divide by 1,000,000 to get normal units
- Example: `token_amount = 1500000` → 1.5 tokens

### Duplication Pattern

**Why duplicates exist:**
1. Each trade has TWO rows: one for maker, one for taker
2. Historical backfill processes created additional duplicates (2-3x)

**Canonical Dedupe Key:** `event_id`

```sql
-- ALWAYS use this pattern
SELECT
  event_id,
  any(trader_wallet) as wallet,
  any(side) as side,
  any(token_amount) / 1000000.0 as tokens,
  any(usdc_amount) / 1000000.0 as usdc
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x...')
  AND is_deleted = 0
GROUP BY event_id
```

### What It Contains

✅ All CLOB trades (maker + taker)
✅ Both buys and sells
✅ Full history

### What It Does NOT Contain

❌ Position splits (buying $1 for YES+NO)
❌ Position merges (redeeming YES+NO for $1)
❌ Payout redemptions (collecting winnings)
❌ Position conversions (NegRisk NO↔YES)

---

## pm_unified_ledger_v9_clob_tbl

**Purpose:** Unified ledger with CLOB trades normalized
**Row Count:** ~700M rows (estimated)
**Coverage:** CLOB trades only (no CTF events)

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | String | Wallet address |
| `event_id` | String | Unique event identifier |
| `condition_id` | String | Market condition ID |
| `outcome_index` | UInt8 | 0 or 1 for binary markets |
| `usdc_delta` | Float64 | **Signed** USDC change |
| `token_delta` | Float64 | **Signed** token change |
| `payout_norm` | Float64 | Resolution price (0 or 1, null if unresolved) |
| `event_time` | DateTime | Event timestamp |
| `source_type` | String | Always 'CLOB' for this table |

### Units and Scaling

- `usdc_delta` and `token_delta` are **already scaled** to normal units
- Positive = receiving, Negative = spending/losing

### Duplication Pattern

**Observed duplication rate:** ~55% duplicates
**Why:** Unknown, likely ingestion issues

**Canonical Dedupe Key:** `event_id`

```sql
-- ALWAYS dedupe
SELECT
  event_id,
  any(condition_id) as condition_id,
  any(outcome_index) as outcome_index,
  any(usdc_delta) as usdc_delta,
  any(token_delta) as token_delta,
  any(payout_norm) as payout_norm
FROM pm_unified_ledger_v9_clob_tbl
WHERE lower(wallet_address) = lower('0x...')
GROUP BY event_id
```

### What It Contains

✅ CLOB trades (normalized to condition_id + outcome_index)

### What It Does NOT Contain

❌ Position splits
❌ Position merges
❌ Payout redemptions
❌ Position conversions

---

## pm_ctf_events

**Purpose:** Conditional Token Framework events (splits, merges, redemptions)
**Row Count:** ~139M rows
**Coverage:** All CTF events since platform launch

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `event_type` | String | 'PositionSplit', 'PositionsMerge', 'PayoutRedemption' |
| `user_address` | String | Wallet address |
| `condition_id` | String | Market condition ID |
| `amount_or_payout` | String | Amount in **6 decimals** (parse as number) |
| `event_timestamp` | DateTime | Event timestamp |
| `tx_hash` | String | Transaction hash |
| `is_deleted` | UInt8 | Soft delete flag |

### Event Type Counts

| Event Type | Count |
|------------|-------|
| PositionSplit | 93,520,122 |
| PayoutRedemption | 24,124,902 |
| PositionsMerge | 21,506,196 |

### Units and Scaling

- `amount_or_payout` is a string, parse to Float64 then ÷ 1,000,000

### Event Semantics (per Polymarket subgraph)

**PositionSplit:**
- User pays $1 USDC, receives 1 YES token + 1 NO token
- PnL treatment: BUY YES at $0.50, BUY NO at $0.50

**PositionsMerge:**
- User returns 1 YES token + 1 NO token, receives $1 USDC
- PnL treatment: SELL YES at $0.50, SELL NO at $0.50

**PayoutRedemption:**
- User redeems winning tokens at resolution price
- PnL treatment: SELL at resolution price (0 or 1)

### Canonical Dedupe Key

`(tx_hash, event_type, user_address, condition_id)` or use `id` column if unique

---

## pm_condition_resolutions

**Purpose:** Market resolution prices
**Row Count:** ~227k rows

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `condition_id` | String | Market condition ID |
| `payout_norm` | Float64 | Resolution price (0 or 1 for binary) |

### Usage

```sql
SELECT condition_id, payout_norm
FROM pm_condition_resolutions
WHERE payout_norm IS NOT NULL
```

---

## pm_wallet_engine_pnl_cache

**Purpose:** Cached PnL results from batch computation
**Row Count:** ~17k rows (as of 2025-12-17)
**Engine Used:** Maker-only FIFO (NOT Polymarket-accurate)

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `wallet` | String | Wallet address (lowercase) |
| `realized_pnl` | Float64 | Realized PnL in USDC |
| `unrealized_pnl` | Float64 | Unrealized PnL in USDC |
| `engine_pnl` | Float64 | realized + unrealized |
| `profit_factor` | Float64 | wins / losses |
| `external_sells_ratio` | Float64 | External sells / total sells |
| `open_exposure_ratio` | Float64 | Open position value / total |
| `computed_at` | DateTime | Computation timestamp |

### WARNING

Values in this table are from **maker-only FIFO** approach and **do NOT match Polymarket UI**.

---

## pm_wallet_trade_stats

**Purpose:** Pre-computed per-wallet trade statistics
**Row Count:** ~1.3M rows
**Created:** 2025-12-17 (44 seconds to populate)

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `wallet` | String | Wallet address (lowercase) |
| `maker_count` | UInt32 | Number of maker trades |
| `taker_count` | UInt32 | Number of taker trades |
| `total_count` | UInt32 | maker + taker |
| `maker_usdc` | Float64 | Maker volume in USDC |
| `taker_usdc` | Float64 | Taker volume in USDC |
| `total_usdc` | Float64 | Total volume |
| `first_trade_time` | DateTime | First trade timestamp |
| `last_trade_time` | DateTime | Last trade timestamp |
| `taker_ratio` | Float64 | taker_count / total_count |
| `computed_at` | DateTime | Computation timestamp |

### Usage

Filter for copy-trading suitability:
```sql
SELECT * FROM pm_wallet_trade_stats FINAL
WHERE taker_ratio <= 0.15  -- Low taker ratio = more replicable
  AND total_count >= 20    -- Minimum activity
  AND last_trade_time >= now() - INTERVAL 30 DAY
```

---

## Summary: Which Tables for Which Engine

| Engine | Primary Data Source | CTF Events |
|--------|---------------------|------------|
| maker_fifo_v1 | pm_trader_events_v2 (role='maker') | ❌ No |
| v19b_v1 | pm_unified_ledger_v9_clob_tbl | ❌ No |
| polymarket_avgcost_v1 | pm_trader_events_v2 (all) + pm_ctf_events | ✅ Yes |
