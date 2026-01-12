# PnL Engine Production Architecture

> **Last Updated:** January 11, 2026
> **Status:** Design Document (Implementation Pending)
> **Based On:** V55 formula achieving 96.7% accuracy on resolved-only wallets

## Overview

This document describes the materialized table architecture for calculating PnL (Profit and Loss) across thousands of wallets with sub-100ms query times.

### PnL Components

| Component | Formula | Source |
|-----------|---------|--------|
| **Realized PnL** | `clob_cash + ctf_cash(/2) + long_wins - short_losses` | Resolved positions only |
| **Unrealized PnL** | `(net_tokens × mark_price) + clob_cash + ctf_cash(/2)` | Open positions with MTM |
| **Total PnL** | `realized + unrealized` | Combined |

**Where:**
- `clob_cash` = CLOB sell_usdc - buy_usdc (per outcome)
- `ctf_cash` = sum(cash_delta) / 2 at **condition level** (not per-outcome)
- `long_wins` = net_tokens on winning outcomes where net_tokens > 0
- `short_losses` = abs(net_tokens) on winning outcomes where net_tokens < 0

---

## Critical: ClickHouse Join Semantics

### Rule 1: NO FULL OUTER JOINs in Production

ClickHouse FULL OUTER JOIN has dangerous default behavior:
- Non-Nullable types return **default values** (0, ''), not NULL
- `COALESCE(outcome_index, ...)` won't work as expected on UInt8
- Empty strings are not NULL: `COALESCE('', 'fallback')` returns `''`

**Solution:** Use `UNION ALL` + `GROUP BY` instead of FULL OUTER JOIN:

```sql
-- WRONG: FULL OUTER JOIN
SELECT COALESCE(c.condition_id, f.condition_id) ...
FROM clob_pos c FULL OUTER JOIN ctf_pos f ON ...

-- CORRECT: UNION ALL + GROUP BY
SELECT
    wallet, condition_id, outcome_index,
    sum(clob_tokens) as clob_tokens,
    sum(ctf_tokens) as ctf_tokens,
    sum(clob_cash) as clob_cash,
    sum(ctf_cash) as ctf_cash
FROM (
    SELECT wallet, condition_id, outcome_index,
           tokens as clob_tokens, 0 as ctf_tokens,
           usdc as clob_cash, 0 as ctf_cash
    FROM clob_fills
    UNION ALL
    SELECT wallet, condition_id, outcome_index,
           0 as clob_tokens, tokens as ctf_tokens,
           0 as clob_cash, cash as ctf_cash
    FROM ctf_fills
)
GROUP BY wallet, condition_id, outcome_index
```

### Rule 2: Handle Empty Strings as NULL

```sql
-- WRONG
COALESCE(condition_id, 'fallback')  -- Returns '' if condition_id is ''

-- CORRECT
COALESCE(nullIf(condition_id, ''), 'fallback')
```

---

## CTF Cash Handling Policy

### The Problem

CTF `cash_delta` is **duplicated per outcome** in `pm_ctf_split_merge_expanded`:
- A $100 split records `cash_delta = -100` on **both** outcome 0 AND outcome 1
- Summing naively gives -$200 when the true economic cost is -$100
- V55 excluded CTF cash entirely, which broke CTF-only positions

### The Rule: Divide by 2 at Condition Level (VALIDATED)

**This approach was validated by pnlEngineV1.ts achieving 100% accuracy on 8 test wallets.**

```sql
-- Aggregate CTF cash at CONDITION level (not per-outcome)
-- Divide by 2 to correct for the duplication
ctf_cash AS (
    SELECT
        condition_id,
        sum(cash_delta) / 2 / 1e6 as ctf_cash_flow  -- Divide by 2!
    FROM pm_ctf_split_merge_expanded
    WHERE lower(wallet) = {wallet}
    GROUP BY condition_id
)
```

**Why this works:**
- Splits: -$100 on outcome 0, -$100 on outcome 1 → sum = -$200 → /2 = -$100 ✓
- Merges: +$100 on outcome 0, +$100 on outcome 1 → sum = +$200 → /2 = +$100 ✓

### Alternative: outcome_index = 0 Filter

If you prefer per-outcome aggregation, only count cash on outcome 0:

```sql
-- Only count cash_delta for outcome_index = 0
sumIf(cash_delta, outcome_index = 0) as ctf_cash
```

Both approaches are equivalent for binary markets.

### Workaround for FULL OUTER JOIN (from pnlEngineV1.ts)

If you must use FULL OUTER JOIN with UInt8 columns:

```sql
-- WRONG: COALESCE doesn't work for UInt8 (returns 0, not NULL)
COALESCE(c.outcome_index, f.outcome_index) as outcome_index

-- CORRECT: Use if() with empty string check on the String join key
if(c.condition_id != '', c.outcome_index, f.outcome_index) as outcome_index
```

### CTF Event Types

Not all CTF events behave the same:
- **Splits:** USDC → Token pairs (cash out, tokens in)
- **Merges:** Token pairs → USDC (tokens out, cash in)
- **Redemptions:** Winning tokens → USDC payout

For splits/merges, the /2 rule applies. Check `pm_ctf_split_merge_expanded.event_type` if redemptions need separate handling.

---

## NegRisk Paired Trade Classification

### The Problem

NegRisk adapter creates synthetic trades that look like real CLOB trades. Self-fill dedup alone doesn't catch these.

### Detection Criteria (All Must Be True)

A trade pair is a NegRisk synthetic if:
1. Same `wallet` + `transaction_hash` + `condition_id`
2. BUY on one outcome, SELL on the other outcome
3. Token amounts equal (within epsilon: `abs(buy_tokens - sell_tokens) < 0.01`)
4. Prices complementary: `buy_price + sell_price ≈ 1.0` (within 0.02 tolerance)

### Treatment

- Keep the BUY leg (real position)
- Drop the SELL leg (synthetic from NegRisk adapter)
- This belongs in **Layer 1 canonicalization** so all downstream is clean

```sql
-- Flag NegRisk paired trades
WITH tx_pairs AS (
    SELECT
        transaction_hash,
        condition_id,
        sumIf(tokens, side = 'buy') as buy_tokens,
        sumIf(tokens, side = 'sell') as sell_tokens,
        sumIf(price, side = 'buy') as buy_price,
        sumIf(price, side = 'sell') as sell_price,
        count(DISTINCT outcome_index) as outcomes_touched
    FROM trades
    GROUP BY transaction_hash, condition_id
    HAVING outcomes_touched = 2
       AND abs(buy_tokens - sell_tokens) < 0.01
       AND abs(buy_price + sell_price - 1.0) < 0.02
)
-- Exclude SELL side of flagged pairs
```

---

## Source Tables (Already Exist)

| Table | Purpose | Update Frequency |
|-------|---------|------------------|
| `pm_trader_events_v3` | Raw CLOB trades | Real-time via Goldsky |
| `pm_ctf_split_merge_expanded` | CTF split/merge operations | Real-time via Goldsky |
| `pm_token_to_condition_map_v5` | Token → Condition mapping | Daily backfill |
| `pm_condition_resolutions` | Resolution outcomes | Event-driven (when markets resolve) |
| `pm_latest_mark_price_v1` | Current mark prices | Every 5 minutes |
| `pm_neg_risk_conversions_v1` | NegRisk adapter events | Real-time via Goldsky |

---

## Layer 1: Canonical Fills Table

**Table:** `pm_canonical_fills_v1`

**Purpose:** Pre-deduped, self-fill-aware trade ledger combining CLOB and CTF

```sql
CREATE TABLE pm_canonical_fills_v1 (
    fill_id String,           -- Unique identifier
    wallet LowCardinality(String),
    condition_id String,
    outcome_index UInt8,
    source Enum8('clob' = 1, 'ctf' = 2),
    side Enum8('buy' = 1, 'sell' = 2),
    tokens Decimal64(6),      -- Positive for buy, negative for sell
    usdc Decimal64(6),        -- Negative for buy (spent), positive for sell (received)
    block_number UInt64,
    block_timestamp DateTime,
    transaction_hash String,
    is_self_fill UInt8,       -- 1 if this was a self-fill (wallet both maker/taker)
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (wallet, condition_id, outcome_index, fill_id)
```

### Compute Job: `build-canonical-fills`

```sql
-- Step 1: Identify self-fill transactions (wallet is both maker AND taker)
WITH self_fills AS (
    SELECT transaction_hash
    FROM pm_trader_events_v3
    WHERE block_timestamp >= {start_time}
    GROUP BY transaction_hash
    HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
),

-- Step 2: Identify NegRisk paired trades (strict criteria)
negrisk_pairs AS (
    SELECT transaction_hash, condition_id
    FROM (
        SELECT
            t.transaction_hash,
            m.condition_id,
            sumIf(t.token_amount / 1e6, t.side = 'buy') as buy_tokens,
            sumIf(t.token_amount / 1e6, t.side = 'sell') as sell_tokens,
            sumIf(t.usdc_amount / t.token_amount, t.side = 'buy') as buy_price,
            sumIf(t.usdc_amount / t.token_amount, t.side = 'sell') as sell_price,
            count(DISTINCT m.outcome_index) as outcomes_touched
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.block_timestamp >= {start_time}
          AND t.is_deleted = 0
          AND m.condition_id != ''
        GROUP BY t.transaction_hash, m.condition_id
        HAVING outcomes_touched = 2
           AND abs(buy_tokens - sell_tokens) < 0.01
           AND abs(buy_price + sell_price - 1.0) < 0.02
    )
),

-- Step 3: Get CLOB fills with both dedup layers applied
clob_fills AS (
    SELECT
        concat(t.event_id, '_clob') as fill_id,
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        'clob' as source,
        t.side,
        t.token_amount / 1e6 as tokens,
        t.usdc_amount / 1e6 as usdc,
        t.block_number,
        t.trade_time as block_timestamp,
        t.transaction_hash
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE t.block_timestamp >= {start_time}
      AND t.is_deleted = 0
      AND m.condition_id != ''
      -- Exclude maker side of self-fills
      AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
      -- Exclude SELL side of NegRisk paired trades
      AND NOT (
          (t.transaction_hash, m.condition_id) IN (SELECT transaction_hash, condition_id FROM negrisk_pairs)
          AND t.side = 'sell'
      )
),

-- Step 4: Get CTF fills (tokens per outcome)
ctf_token_fills AS (
    SELECT
        concat(toString(id), '_ctf_', toString(outcome_index)) as fill_id,
        lower(wallet) as wallet,
        condition_id,
        outcome_index,
        'ctf' as source,
        if(shares_delta > 0, 'buy', 'sell') as side,
        abs(shares_delta) / 1e6 as tokens,
        block_number,
        block_timestamp,
        transaction_hash
    FROM pm_ctf_split_merge_expanded
    WHERE block_timestamp >= {start_time}
),

-- Insert CLOB fills
INSERT INTO pm_canonical_fills_v1
SELECT
    fill_id, wallet, condition_id, outcome_index, source, side,
    if(side = 'buy', tokens, -tokens) as tokens,
    if(side = 'buy', -usdc, usdc) as usdc,
    block_number, block_timestamp, transaction_hash,
    0 as is_self_fill
FROM clob_fills;

-- Insert CTF token fills (cash handled in SEPARATE table - see below)
INSERT INTO pm_canonical_fills_v1
SELECT
    fill_id, wallet, condition_id, outcome_index, source, side,
    if(side = 'buy', tokens, -tokens) as tokens,
    0 as usdc,  -- CTF cash is in pm_ctf_cash_condition_v1, not here
    block_number, block_timestamp, transaction_hash,
    0 as is_self_fill
FROM ctf_token_fills;
```

**Cron Schedule:** Every 5 minutes (incremental)
- Use `block_timestamp >= now() - INTERVAL 10 MINUTE` for overlap safety
- ReplacingMergeTree handles deduplication

---

## Layer 1b: CTF Cash Condition Table (Separate from Fills)

**Table:** `pm_ctf_cash_condition_v1`

**Purpose:** Store CTF cash at condition level with deterministic values. Kept separate from per-outcome fills to avoid allocation complexity and double-counting.

```sql
CREATE TABLE pm_ctf_cash_condition_v1 (
    wallet LowCardinality(String),
    condition_id String,
    ctf_cash_flow Decimal64(6),        -- sum(cash_delta) / 2 / 1e6
    first_timestamp DateTime,           -- min(block_timestamp) from source
    last_timestamp DateTime,            -- max(block_timestamp) from source
    operation_count UInt32,             -- Number of CTF operations
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet, condition_id)
```

### Compute Job: `build-ctf-cash-condition`

```sql
-- VALIDATED: sum(cash_delta) / 2 achieves 100% accuracy in pnlEngineV1.ts
INSERT INTO pm_ctf_cash_condition_v1
SELECT
    lower(wallet) as wallet,
    condition_id,
    sum(cash_delta) / 2 / 1e6 as ctf_cash_flow,  -- Divide by 2!
    min(block_timestamp) as first_timestamp,
    max(block_timestamp) as last_timestamp,
    count() as operation_count,
    now() as updated_at
FROM pm_ctf_split_merge_expanded
WHERE block_timestamp >= {start_time}
GROUP BY wallet, condition_id
HAVING abs(ctf_cash_flow) > 0.001
```

**Why Separate Table?**
- CTF cash is per-condition, not per-outcome
- Mixing per-condition cash into per-outcome fills creates allocation ambiguity
- Deterministic timestamps (min/max from source) instead of `now()`
- Clean join at Layer 2/3: `LEFT JOIN pm_ctf_cash_condition_v1 USING (wallet, condition_id)`

**Cron Schedule:** Every 5 minutes (same as canonical fills)

---

## Layer 2: Position State Table

**Table:** `pm_wallet_positions_v1`

**Purpose:** Aggregated positions per (wallet, condition, outcome) with resolution status

```sql
CREATE TABLE pm_wallet_positions_v1 (
    wallet LowCardinality(String),
    condition_id String,
    outcome_index UInt8,

    -- Position metrics
    net_tokens Decimal64(6),           -- bought - sold (can be negative = SHORT)
    total_usdc_flow Decimal64(6),      -- sell_usdc - buy_usdc

    -- Trade counts
    trade_count UInt32,
    first_trade DateTime,
    last_trade DateTime,

    -- Resolution status (denormalized for fast queries)
    is_resolved UInt8,
    won UInt8,                          -- 1 if this outcome won
    payout_numerator Nullable(UInt8),

    -- Timestamps
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet, condition_id, outcome_index)
```

### Compute Job: `build-wallet-positions`

**Approach:** Use partitioned incremental updates, not full wallet rebuilds.

```sql
-- Aggregate per-outcome positions from canonical fills
-- CTF cash is joined at condition level (not per-outcome)
INSERT INTO pm_wallet_positions_v1
SELECT
    cf.wallet,
    cf.condition_id,
    cf.outcome_index,

    sum(cf.tokens) as net_tokens,
    sum(cf.usdc) as clob_usdc_flow,  -- CLOB cash only (per-outcome)

    count() as trade_count,
    min(cf.block_timestamp) as first_trade,
    max(cf.block_timestamp) as last_trade,

    -- Resolution status (use nullIf for empty string handling)
    nullIf(r.payout_numerators, '') IS NOT NULL as is_resolved,
    toInt64OrNull(JSONExtractString(r.payout_numerators, cf.outcome_index + 1)) = 1 as won,
    toInt64OrNull(JSONExtractString(r.payout_numerators, cf.outcome_index + 1)) as payout_numerator,

    now() as updated_at

FROM pm_canonical_fills_v1 cf
LEFT JOIN pm_condition_resolutions r
  ON cf.condition_id = r.condition_id
  AND r.is_deleted = 0
WHERE cf.wallet IN (
    -- Only rebuild wallets with recent activity
    SELECT DISTINCT wallet
    FROM pm_canonical_fills_v1
    WHERE block_timestamp >= {start_time}
)
GROUP BY cf.wallet, cf.condition_id, cf.outcome_index, r.payout_numerators
```

**Important:** `clob_usdc_flow` is per-outcome. CTF cash (`ctf_cash_flow`) is per-condition and joined separately at Layer 3 to avoid double-counting.

**Option B: Materialized View (Better for Scale)**

```sql
-- Pre-build canonical fills with condition_id already materialized
-- Then use MV to auto-aggregate into positions
CREATE MATERIALIZED VIEW pm_wallet_positions_mv
TO pm_wallet_positions_v1
AS SELECT
    wallet,
    condition_id,
    outcome_index,
    sum(tokens) as net_tokens,
    sum(usdc) as total_usdc_flow,
    count() as trade_count,
    min(block_timestamp) as first_trade,
    max(block_timestamp) as last_trade,
    -- Resolution joined at query time or via scheduled denormalization
    0 as is_resolved,
    0 as won,
    NULL as payout_numerator,
    now() as updated_at
FROM pm_canonical_fills_v1
GROUP BY wallet, condition_id, outcome_index
```

**Cron Schedule:** Every 10 minutes
- Option A: Rebuild affected wallets (works up to ~10K active wallets)
- Option B: MV handles incrementally (scales to 100K+ wallets)

---

## Layer 3: Wallet Summary Table

**Table:** `pm_wallet_summary_v1`

**Purpose:** Fast filtering and leaderboard queries

```sql
CREATE TABLE pm_wallet_summary_v1 (
    wallet LowCardinality(String),

    -- Realized PnL Components (resolved positions)
    realized_cash_flow Decimal64(6),     -- Total USDC flow from resolved positions
    realized_long_wins Decimal64(6),     -- Tokens on winning outcomes (long)
    realized_short_losses Decimal64(6),  -- Tokens on winning outcomes (short)
    realized_pnl Decimal64(6),           -- cash_flow + long_wins - short_losses

    -- Open Position Metrics
    open_position_count UInt32,
    open_tokens_long Decimal64(6),       -- Total long exposure
    open_tokens_short Decimal64(6),      -- Total short exposure
    open_cash_flow Decimal64(6),         -- Cash spent/received on open positions

    -- Unrealized PnL (MTM - updated separately)
    unrealized_pnl Decimal64(6),         -- From mark prices

    -- Total PnL
    total_pnl Decimal64(6),              -- realized + unrealized

    -- Activity Metrics
    total_trades UInt32,
    first_trade DateTime,
    last_trade DateTime,
    conditions_traded UInt32,

    -- Flags
    has_negrisk UInt8,
    has_ctf UInt8,

    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet)
```

### Compute Job: `build-wallet-summary`

```sql
-- Step 1: Aggregate per-outcome data from positions
WITH position_agg AS (
    SELECT
        wallet,
        -- CLOB cash (per-outcome, summed across all outcomes)
        sumIf(clob_usdc_flow, is_resolved = 1) as resolved_clob_cash,
        sumIf(clob_usdc_flow, is_resolved = 0) as open_clob_cash,
        -- Win/loss tokens
        sumIf(net_tokens, is_resolved = 1 AND won = 1 AND net_tokens > 0) as realized_long_wins,
        sumIf(abs(net_tokens), is_resolved = 1 AND won = 1 AND net_tokens < 0) as realized_short_losses,
        -- Open positions
        countIf(is_resolved = 0 AND abs(net_tokens) > 0.01) as open_position_count,
        sumIf(net_tokens, is_resolved = 0 AND net_tokens > 0) as open_tokens_long,
        sumIf(abs(net_tokens), is_resolved = 0 AND net_tokens < 0) as open_tokens_short,
        -- Activity
        sum(trade_count) as total_trades,
        min(first_trade) as first_trade,
        max(last_trade) as last_trade,
        count(DISTINCT condition_id) as conditions_traded
    FROM pm_wallet_positions_v1
    GROUP BY wallet
),

-- Step 2: Aggregate CTF cash at condition level (already /2 in source table)
-- Split into resolved vs open based on resolution status
ctf_cash_agg AS (
    SELECT
        c.wallet,
        sumIf(c.ctf_cash_flow, r.payout_numerators != '' AND r.payout_numerators IS NOT NULL) as resolved_ctf_cash,
        sumIf(c.ctf_cash_flow, r.payout_numerators = '' OR r.payout_numerators IS NULL) as open_ctf_cash
    FROM pm_ctf_cash_condition_v1 c
    LEFT JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
    GROUP BY c.wallet
)

INSERT INTO pm_wallet_summary_v1
SELECT
    p.wallet,

    -- Realized PnL = CLOB cash + CTF cash(/2) + long_wins - short_losses
    p.resolved_clob_cash + COALESCE(c.resolved_ctf_cash, 0) as realized_cash_flow,
    p.realized_long_wins,
    p.realized_short_losses,
    realized_cash_flow + p.realized_long_wins - p.realized_short_losses as realized_pnl,

    -- Open position metrics
    p.open_position_count,
    p.open_tokens_long,
    p.open_tokens_short,
    p.open_clob_cash + COALESCE(c.open_ctf_cash, 0) as open_cash_flow,

    -- MTM placeholder (calculated in separate job)
    0 as unrealized_pnl,
    realized_pnl as total_pnl,

    -- Activity
    p.total_trades,
    p.first_trade,
    p.last_trade,
    p.conditions_traded,

    -- Flags
    p.wallet NOT IN (SELECT wallet FROM pm_wallets_no_negrisk) as has_negrisk,
    c.wallet IS NOT NULL as has_ctf,

    now() as updated_at

FROM position_agg p
LEFT JOIN ctf_cash_agg c ON p.wallet = c.wallet
```

**Key Points:**
- CLOB cash is summed from per-outcome positions
- CTF cash is joined from `pm_ctf_cash_condition_v1` (already /2)
- Both are split by resolution status to correctly allocate to realized vs open

**Cron Schedule:** Every 15 minutes (rebuild affected wallets)

---

## Layer 4: MTM Update Job

**Purpose:** Update unrealized PnL based on current mark prices

### Compute Job: `update-mtm`

```sql
-- Calculate unrealized PnL for open positions
WITH open_mtm AS (
    SELECT
        p.wallet,
        sum(
            CASE
                WHEN p.net_tokens > 0 THEN p.net_tokens * mp.mark_price  -- Long: tokens × price
                WHEN p.net_tokens < 0 THEN abs(p.net_tokens) * (1 - mp.mark_price)  -- Short: tokens × (1 - price)
                ELSE 0
            END
        ) + sum(p.total_usdc_flow) as unrealized_pnl
    FROM pm_wallet_positions_v1 p
    JOIN pm_latest_mark_price_v1 mp
        ON p.condition_id = mp.condition_id
        AND p.outcome_index = mp.outcome_index
    WHERE p.is_resolved = 0 AND abs(p.net_tokens) > 0.01
    GROUP BY p.wallet
)
-- Update wallet summary
INSERT INTO pm_wallet_summary_v1
SELECT
    s.wallet,
    s.realized_cash_flow,
    s.realized_long_wins,
    s.realized_short_losses,
    s.realized_pnl,
    s.open_position_count,
    s.open_tokens_long,
    s.open_tokens_short,
    s.open_cash_flow,
    COALESCE(m.unrealized_pnl, 0) as unrealized_pnl,
    s.realized_pnl + COALESCE(m.unrealized_pnl, 0) as total_pnl,
    s.total_trades,
    s.first_trade,
    s.last_trade,
    s.conditions_traded,
    s.has_negrisk,
    s.has_ctf,
    now() as updated_at
FROM pm_wallet_summary_v1 s
LEFT JOIN open_mtm m ON s.wallet = m.wallet
```

**Cron Schedule:** Every 5 minutes (MTM prices change frequently)

---

## Cron Job Summary

| Job | Schedule | Duration Est. | Dependency |
|-----|----------|---------------|------------|
| `build-canonical-fills` | Every 5 min | 30-60 sec | Source tables |
| `build-ctf-cash-condition` | Every 5 min | 10-20 sec | Source tables |
| `build-wallet-positions` | Every 10 min | 1-2 min | Layer 1 |
| `build-wallet-summary` | Every 15 min | 30-60 sec | Layer 2 + Layer 1b |
| `update-mtm` | Every 5 min | 15-30 sec | Layer 3 + mark prices |
| `sync-resolutions` | Event-driven | 5-10 sec | When markets resolve |

---

## Resolution Sync Job

**Purpose:** When a market resolves, update affected positions immediately

```sql
-- When pm_condition_resolutions gets a new resolution:
-- 1. Get affected condition_ids
-- 2. Mark positions as resolved
-- 3. Recalculate wallet summaries for affected wallets

INSERT INTO pm_wallet_positions_v1
SELECT
    p.wallet,
    p.condition_id,
    p.outcome_index,
    p.net_tokens,
    p.total_usdc_flow,
    p.trade_count,
    p.first_trade,
    p.last_trade,
    1 as is_resolved,  -- Now resolved
    toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won,
    toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) as payout_numerator,
    now() as updated_at
FROM pm_wallet_positions_v1 p
JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
WHERE r.condition_id IN ({newly_resolved_condition_ids})
  AND r.is_deleted = 0
```

**Trigger:** Webhook or polling on `pm_condition_resolutions` for new entries

---

## Query Examples

### Fast wallet PnL lookup
```sql
SELECT wallet, realized_pnl, unrealized_pnl, total_pnl, open_position_count
FROM pm_wallet_summary_v1
WHERE wallet = '0x...'
-- Response: < 10ms
```

### Leaderboard (top 100 by realized PnL)
```sql
SELECT wallet, realized_pnl, total_trades, conditions_traded
FROM pm_wallet_summary_v1
ORDER BY realized_pnl DESC
LIMIT 100
-- Response: < 50ms
```

### Wallets with open positions in specific market
```sql
SELECT wallet, net_tokens, total_usdc_flow
FROM pm_wallet_positions_v1
WHERE condition_id = '0x...'
  AND is_resolved = 0
  AND abs(net_tokens) > 0.01
ORDER BY abs(net_tokens) DESC
-- Response: < 100ms
```

### Wallet position details with MTM
```sql
SELECT
    p.condition_id,
    p.outcome_index,
    p.net_tokens,
    p.total_usdc_flow,
    p.is_resolved,
    p.won,
    mp.mark_price,
    CASE
        WHEN p.is_resolved = 1 AND p.won = 1 AND p.net_tokens > 0 THEN p.net_tokens
        WHEN p.is_resolved = 1 AND p.won = 1 AND p.net_tokens < 0 THEN -abs(p.net_tokens)
        WHEN p.is_resolved = 0 AND p.net_tokens > 0 THEN p.net_tokens * mp.mark_price
        WHEN p.is_resolved = 0 AND p.net_tokens < 0 THEN abs(p.net_tokens) * (1 - mp.mark_price)
        ELSE 0
    END as position_value
FROM pm_wallet_positions_v1 p
LEFT JOIN pm_latest_mark_price_v1 mp
    ON p.condition_id = mp.condition_id
    AND p.outcome_index = mp.outcome_index
WHERE p.wallet = '0x...'
ORDER BY abs(p.net_tokens) DESC
```

---

## Architecture Benefits

| Benefit | Description |
|---------|-------------|
| **Layer 1 (Canonical Fills)** | Single source of truth for all fills with self-fill deduplication |
| **Layer 2 (Positions)** | Pre-aggregated positions for fast joins |
| **Layer 3 (Summary)** | Instant wallet lookups and leaderboards |
| **MTM Updates** | Near-real-time unrealized PnL (5-min freshness) |

---

## Data Freshness

| Metric | Freshness |
|--------|-----------|
| Realized PnL | 15 minutes |
| Unrealized PnL | 5 minutes |
| Total PnL | 5 minutes |
| Position counts | 10 minutes |
| Trade counts | 15 minutes |

---

## Implementation Notes

### Self-Fill Deduplication
When a wallet is both maker AND taker in the same transaction (self-fill), exclude the MAKER side to avoid double-counting. The taker side represents the actual position change.

### CTF Cash Handling
CTF splits and merges are economically neutral **only when you include both the token movement AND the corresponding cash flow**. We track:
- **Tokens:** `shares_delta` per outcome
- **Cash:** `sum(cash_delta) / 2` at condition level (corrected for duplication)

Excluding CTF cash breaks CTF-only conditions. The `/2` correction is required because the CTF table stores the same cash_delta on both outcomes.

### NegRisk Considerations
NegRisk adapter creates internal bookkeeping trades that appear in CLOB data. The `has_negrisk` flag helps identify wallets that may need special handling or validation.

### COALESCE Gotcha
ClickHouse returns empty string (not NULL) for non-matching LEFT JOINs on String columns. Use `nullIf(column, '')` before COALESCE to handle this correctly.

---

## Performance Optimization

### Problem: "Rebuild Affected Wallets" Doesn't Scale

```sql
-- This pattern becomes expensive at scale:
WHERE wallet IN (SELECT DISTINCT wallet FROM fills WHERE timestamp >= {start})
```

### Solutions

**1. Pre-Materialize Condition Mapping**

Don't repeatedly join to `pm_token_to_condition_map_v5` in every query:

```sql
-- BAD: Join on every incremental run
SELECT ... FROM pm_trader_events_v3 t
JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec

-- GOOD: Materialize condition_id into canonical fills once
-- Then all downstream queries use the pre-joined data
```

**2. Partition by Day**

```sql
CREATE TABLE pm_canonical_fills_v1 (
    ...
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMMDD(block_timestamp)  -- Partition by day
ORDER BY (wallet, condition_id, outcome_index, fill_id)
```

Benefits:
- Incremental jobs only scan recent partitions
- Old partitions can be archived/compressed
- Parallel processing per partition

**3. Use AggregatingMergeTree for Positions**

```sql
CREATE TABLE pm_wallet_positions_agg (
    wallet LowCardinality(String),
    condition_id String,
    outcome_index UInt8,
    net_tokens_state AggregateFunction(sum, Decimal64(6)),
    usdc_flow_state AggregateFunction(sum, Decimal64(6)),
    trade_count_state AggregateFunction(count),
    ...
)
ENGINE = AggregatingMergeTree()
ORDER BY (wallet, condition_id, outcome_index)

-- Insert with -State functions
INSERT INTO pm_wallet_positions_agg
SELECT
    wallet, condition_id, outcome_index,
    sumState(tokens),
    sumState(usdc),
    countState(),
    ...
FROM pm_canonical_fills_v1
GROUP BY wallet, condition_id, outcome_index

-- Query with -Merge functions
SELECT
    wallet, condition_id, outcome_index,
    sumMerge(net_tokens_state) as net_tokens,
    sumMerge(usdc_flow_state) as usdc_flow,
    countMerge(trade_count_state) as trade_count
FROM pm_wallet_positions_agg
WHERE wallet = '0x...'
GROUP BY wallet, condition_id, outcome_index
```

**4. Avoid Repeated Large Scans**

| Instead Of | Do This |
|------------|---------|
| Scan all fills for wallet list | Maintain `pm_active_wallets` table |
| Re-join token map on every run | Pre-materialize in canonical fills |
| Full wallet rebuild | Delta aggregation with AggregatingMergeTree |

---

## MTM Edge Cases

### 1. Missing Mark Prices

```sql
-- Problem: Missing mark price defaults to 0, causing huge errors
COALESCE(mp.mark_price, 0.5)  -- Default to 0.5 (neutral)

-- Better: Flag positions with missing prices
CASE
    WHEN mp.mark_price IS NULL THEN 'MISSING_PRICE'
    WHEN mp.mark_price < 0.01 OR mp.mark_price > 0.99 THEN 'EXTREME_PRICE'
    ELSE 'NORMAL'
END as price_quality
```

### 2. Synthetic Resolved (Price Near 0/1)

Markets with price < 0.02 or > 0.98 are effectively resolved but may not be in resolution table yet:

```sql
-- Detect "synthetic resolved" states
CASE
    WHEN is_resolved = 1 THEN 'RESOLVED'
    WHEN mp.mark_price < 0.02 THEN 'SYNTHETIC_NO'   -- Likely resolving to NO
    WHEN mp.mark_price > 0.98 THEN 'SYNTHETIC_YES'  -- Likely resolving to YES
    ELSE 'OPEN'
END as resolution_state
```

### 3. Price Source Convention

Ensure `pm_latest_mark_price_v1.mark_price` matches the UI/user-pnl effective mark:
- Some APIs return mid-price
- Others return last trade price
- UI might use weighted average

**Validation:** Compare MTM calculation against Polymarket UI for 10 wallets with open positions.

### 4. MTM Formula for Shorts

```sql
-- Long position: tokens × mark_price
-- Short position: abs(tokens) × (1 - mark_price)

-- Full formula with cash flow
CASE
    WHEN net_tokens > 0 THEN (net_tokens * mark_price) + total_usdc_flow  -- Long
    WHEN net_tokens < 0 THEN (abs(net_tokens) * (1 - mark_price)) + total_usdc_flow  -- Short
    ELSE total_usdc_flow  -- No position, just cash
END as position_mtm
```

---

## Implementation Checklist

Before deploying this architecture, verify:

**Layer 1 (Canonical Fills):**
- [ ] Self-fill dedup excludes maker side correctly
- [ ] NegRisk paired trade classifier has strict criteria (amounts equal, prices sum to 1)
- [ ] CTF tokens in fills table, CTF cash in SEPARATE table (Layer 1b)
- [ ] CTF redemptions handled separately from splits/merges if needed

**Layer 1b (CTF Cash Condition):**
- [x] **CTF cash = sum(cash_delta) / 2 at condition level** (VALIDATED in pnlEngineV1.ts)
- [x] **Deterministic timestamps** (min/max from source, not `now()`)
- [x] **Separate table** avoids per-outcome allocation ambiguity

**Layer 2 (Positions):**
- [ ] No FULL OUTER JOINs (use UNION ALL + GROUP BY) OR use `if()` workaround
- [x] **UInt8 join fix:** `if(c.condition_id != '', c.outcome_index, f.outcome_index)` (VALIDATED)
- [ ] Empty string handling with `nullIf()` for String columns
- [x] **clob_usdc_flow is per-outcome** (CTF cash joined at Layer 3)

**Layer 3 (Summary):**
- [x] **Realized PnL = clob_cash + ctf_cash(/2) + long_wins - short_losses** (VALIDATED)
- [x] **CTF cash joined from pm_ctf_cash_condition_v1** (not from per-outcome data)
- [ ] Unrealized PnL uses MTM formula with same cash components

**MTM:**
- [ ] Missing prices default to 0.5 or flagged
- [ ] Formula matches Polymarket UI for test wallets
- [ ] Per-outcome MTM: long = tokens × price, short = abs(tokens) × (1 - price)

**Performance:**
- [ ] Condition mapping pre-materialized in canonical fills
- [ ] Tables partitioned by day

**Validated Test Results (pnlEngineV1.ts):**
| Wallet | Before Fix | After Fix |
|--------|------------|-----------|
| 0xa277... (CTF-heavy) | $741.53 error | $0.01 error |
| 0xe06a... (16 CTF ops) | $16.30 error | $0.00 error |
| All 8 test wallets | Mixed | **100% PASS** |

---

## Related Documentation

- [READ_ME_FIRST_PNL.md](../../../docs/READ_ME_FIRST_PNL.md) - PnL engine overview
- [STABLE_PACK_REFERENCE.md](./STABLE_PACK_REFERENCE.md) - Database patterns
- [TABLE_RELATIONSHIPS.md](./TABLE_RELATIONSHIPS.md) - Schema reference
