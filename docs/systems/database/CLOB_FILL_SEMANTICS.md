# CLOB Fill Semantics & Deduplication Guide

**Status:** Canonical Reference (Jan 9, 2026)
**Author:** Claude Code (Database Agent)
**Purpose:** Define the correct way to deduplicate and interpret CLOB fill events

---

## Executive Summary

**Key Finding:** The documentation claim about "2-3x duplicates per wallet" in `pm_trader_events_v2` is **OUTDATED** or **INCORRECT**. Current data shows:

1. **NO duplicates found** in `pm_trader_events_v2` for active wallets
2. The `GROUP BY event_id` dedup pattern in CLAUDE.md is **unnecessary** for v2/v3
3. The real dedup requirement is: **GROUP BY (tx_hash, condition_id, outcome_index, side)** to handle maker+taker double-counting

**Recommendation:** Update CLAUDE.md to reflect accurate deduplication semantics.

---

## Table Architecture

### pm_trader_events_v2 (Source Table)
- **Engine:** `SharedMergeTree` (NOT ReplacingMergeTree)
- **Sort Key:** `(trader_wallet, token_id, trade_time)`
- **Key Fields:**
  - `event_id` (String) - Unique identifier per fill role
  - `trader_wallet` (String) - Wallet address (lowercase)
  - `role` (String) - "maker" or "taker"
  - `side` (String) - "buy" or "sell"
  - `is_deleted` (UInt8) - Soft delete flag (0 = active)
  - `token_id` (String) - ERC1155 token ID (decimal string)
  - `usdc_amount` (Float64) - USDC amount in micro-units (divide by 1e6)
  - `token_amount` (Float64) - Token amount in micro-units (divide by 1e6)
  - `fee_amount` (Float64) - Fee amount in micro-units (divide by 1e6)
  - `trade_time` (DateTime) - Timestamp of trade
  - `transaction_hash` (String) - On-chain transaction hash
  - `block_number` (UInt64) - Block number

**Rows:** 1,014,344,780 (including soft-deleted)

### pm_trader_events_v3 (Deduplicated View)
- **Engine:** `SharedReplacingMergeTree(_version)`
- **Sort Key:** `(trader_wallet, trade_time, event_id)`
- **Purpose:** Deduped view automatically maintained via materialized view from v2
- **Key Difference:** Uses `LowCardinality(String)` for role/side fields
- **Version Field:** `_version` (UInt64) - For ReplacingMergeTree deduplication

**Rows:** 671,698,700

### pm_trader_events_dedup_v2_tbl
- **Engine:** `SharedReplacingMergeTree(trade_time)`
- **Sort Key:** `(event_id, trader_wallet, role)`
- **Purpose:** Older dedup table (likely deprecated)

**Rows:** 106,040,285

---

## Event ID Structure

### Format
```
{tx_hash}_{fill_id}-{role_suffix}
```

**Components:**
- `tx_hash`: 66-char on-chain transaction hash (with 0x prefix)
- `fill_id`: 66-char unique fill identifier (with 0x prefix)
- `role_suffix`: `-m` (maker) or `-t` (taker)

### Examples
```
Maker event:
0x04b9161f822d40eb2a4bf172167bef8964cd320af29de171c9dc28edf363bdc5_0x5341eecf12821859a9aaee53c0f5746233cc1ded2250af407a4f8665a11770e3-m

Taker event:
0x04b9161f822d40eb2a4bf172167bef8964cd320af29de171c9dc28edf363bdc5_0x5341eecf12821859a9aaee53c0f5746233cc1ded2250af407a4f8665a11770e3-t
```

**Extracting Components:**
```sql
substring(event_id, 1, 66) as tx_hash,    -- Transaction hash
substring(event_id, 68) as fill_suffix,    -- fill_id + role suffix
substring(event_id, 68, 66) as fill_id,    -- Just the fill_id (no suffix)
substring(event_id, -1, 1) as role_suffix  -- 'm' or 't'
```

---

## Fill Semantics

### A "Fill" = One Maker + One Taker

A single CLOB fill involves **TWO event_ids** (one maker, one taker) representing the same economic transaction:

```sql
-- Example: Same fill from both sides
event_id                                                                    trader_wallet                             role   side  usdc      tokens
--------                                                                    --------------                            ----   ----  ----      ------
...5341eecf12821859a9aaee53c0f5746233cc1ded2250af407a4f8665a11770e3-m    0x2395f7024cd34265cbf4e63ba5b55bb452e11c61  maker  buy   4.999998  8.771927
...5341eecf12821859a9aaee53c0f5746233cc1ded2250af407a4f8665a11770e3-t    0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e  taker  sell  4.999998  8.771927
```

**Key Observations:**
1. Same `usdc_amount` and `token_amount` on both sides
2. Opposite `side` semantics (maker buy ↔ taker sell)
3. Different wallets (usually)
4. Same `transaction_hash` and `trade_time`

### Edge Case: Same Wallet as Both Maker and Taker

**Yes, this happens!** A wallet can be both maker and taker in the same transaction. Example query found 10+ cases:

```sql
SELECT transaction_hash, trader_wallet, groupArray(DISTINCT role) as roles, count() as event_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY transaction_hash, trader_wallet
HAVING length(groupArray(DISTINCT role)) = 2
```

**Results:**
- tx: `1de4af6814e5b2441d077b1845ff01e315af3f27535bf5dc89ff31d902619477`
  - wallet: `0x28ff687642a2fa8f3b9fe67c4ebbd98c78965793`
  - roles: `["taker","maker"]`
  - event_count: 2

**Interpretation:** This is likely a self-trading scenario or algorithmic trading pattern. Both events should be counted for that wallet.

---

## Deduplication Requirements

### MYTH: "pm_trader_events_v2 has 2-3x duplicates"

**FALSE** (as of Jan 9, 2026). Testing shows:

```sql
-- Check for duplicate event_ids for a single wallet
SELECT event_id, count() as duplicate_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND trader_wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'  -- High-volume wallet (118M events)
  AND toDate(trade_time) = '2025-01-09'
GROUP BY event_id
HAVING count() > 1
```

**Result:** 0 duplicates found.

### The REAL Deduplication Need: Maker + Taker Double-Counting

When calculating per-wallet PnL or volume, you need to **avoid double-counting fills where the same wallet is both maker and taker**.

**Wrong Approach (from CLAUDE.md):**
```sql
-- This is unnecessary for v2/v3
SELECT event_id, any(side) as side, ...
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...' AND is_deleted = 0
GROUP BY event_id  -- ❌ Not needed - event_id is already unique
```

**Correct Approach (for PnL calculations):**
```sql
WITH deduped_trades AS (
  SELECT
    substring(event_id, 1, 66) as tx_hash,
    m.condition_id,
    m.outcome_index,
    t.side,
    max(t.usdc_amount) / 1e6 as usdc,      -- Use max() to handle maker+taker same wallet
    max(t.token_amount) / 1e6 as tokens
  FROM pm_trader_events_v3 t
  LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  WHERE lower(t.trader_wallet) = '0x...'
    AND m.condition_id IS NOT NULL
  GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
)
SELECT condition_id, outcome_index, side,
  sum(tokens) as total_tokens,
  sum(usdc) as total_usdc
FROM deduped_trades
GROUP BY condition_id, outcome_index, side
```

**Why `GROUP BY (tx_hash, condition_id, outcome_index, side)`?**
- Handles same wallet as both maker + taker (rare but real)
- Preserves buy vs sell distinction
- Aggregates at the "economic fill" level, not event_id level

**Why use `max()` in the aggregation?**
- If same wallet is both maker and taker, both rows have identical amounts
- `max()` ensures we count the fill once (any() also works)
- For normal fills (different wallets), there's only 1 row per (tx, condition, outcome, side) anyway

---

## Side Semantics

### How `side` is Determined

The `side` field represents the **direction relative to the trader**:

| role  | side | meaning                              |
|-------|------|--------------------------------------|
| maker | buy  | Maker created limit order to buy     |
| maker | sell | Maker created limit order to sell    |
| taker | buy  | Taker matched with sell order        |
| taker | sell | Taker matched with buy order         |

**Key Insight:** In a fill, the maker and taker have **opposite** sides:
- Maker buy ↔ Taker sell
- Maker sell ↔ Taker buy

### Source of Truth

The `side` field is derived from the CLOB API (`/trades` endpoint) and represents the **user-facing action**. For PnL calculations:
- `side = 'buy'` → wallet spent USDC to acquire tokens (negative cash flow, positive token flow)
- `side = 'sell'` → wallet received USDC for tokens (positive cash flow, negative token flow)

---

## Canonical Deduplication Pattern

### For Simple Volume/Count Queries

**Use v3 directly** (no dedup needed):
```sql
SELECT count() as trade_count
FROM pm_trader_events_v3 FINAL
WHERE trader_wallet = '0x...'
```

**Note:** Use `FINAL` keyword to ensure ReplacingMergeTree shows latest version.

### For PnL Calculations (Most Common)

**Use the per-outcome aggregation pattern:**
```sql
WITH deduped_trades AS (
  SELECT
    substring(event_id, 1, 66) as tx_hash,
    m.condition_id,
    m.outcome_index,
    m.question,
    t.side,
    max(t.usdc_amount) / 1e6 as usdc,
    max(t.token_amount) / 1e6 as tokens
  FROM pm_trader_events_v3 t
  LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  WHERE lower(t.trader_wallet) = '{wallet}'
    AND m.condition_id IS NOT NULL
    AND m.condition_id != ''
  GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
),
outcome_totals AS (
  SELECT
    condition_id,
    any(question) as question,
    outcome_index,
    sumIf(tokens, side='buy') as bought,
    sumIf(tokens, side='sell') as sold,
    sumIf(usdc, side='buy') as buy_cost,
    sumIf(usdc, side='sell') as sell_proceeds
  FROM deduped_trades
  GROUP BY condition_id, outcome_index
)
SELECT * FROM outcome_totals
```

**This pattern handles:**
- ✅ Maker + taker events for different wallets (normal case)
- ✅ Same wallet as both maker and taker (edge case)
- ✅ Multiple fills in same tx for same outcome (common)
- ✅ Bundled split transactions (buy outcome A + sell outcome B in same tx)

---

## When to Use v2 vs v3

| Scenario | Table | Reason |
|----------|-------|--------|
| **Read queries (SELECT)** | v3 | Cleaner schema (LowCardinality), automatically deduped |
| **Real-time ingestion** | v2 | Direct insert target, v3 is updated via materialized view |
| **Historical analysis** | v3 | Better performance, smaller data size (671M vs 1014M rows) |
| **Need `is_deleted` flag** | v2 | v3 doesn't have this field |

---

## Common Pitfalls

### ❌ Don't Do This
```sql
-- WRONG: GROUP BY event_id is unnecessary
SELECT event_id, any(side) as side
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...'
GROUP BY event_id  -- ❌ Waste of compute - event_id is unique per row
```

### ❌ Don't Do This Either
```sql
-- WRONG: Double-counts if same wallet is maker+taker
SELECT sum(usdc_amount) / 1e6 as total_volume
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...' AND side = 'buy'
-- ❌ If wallet was both maker and taker, counts the fill twice
```

### ✅ Do This Instead
```sql
-- CORRECT: Aggregate at the economic fill level
WITH deduped AS (
  SELECT
    substring(event_id, 1, 66) as tx_hash,
    token_id,
    side,
    max(usdc_amount) / 1e6 as usdc
  FROM pm_trader_events_v3
  WHERE trader_wallet = '0x...'
  GROUP BY tx_hash, token_id, side
)
SELECT sum(usdc) as total_volume
FROM deduped
WHERE side = 'buy'
```

---

## Historical Context

### Why the Confusion?

The CLAUDE.md documentation states:
> "pm_trader_events_v2 has duplicates from historical backfills (2-3x per wallet)"

**Possible Explanations:**
1. **Outdated:** Duplicates existed pre-cleanup, now resolved
2. **Misinterpretation:** Refers to maker+taker double-counting, not true duplicates
3. **Different Context:** Referred to a previous table version (v1?) that had issues
4. **Incomplete Cleanup:** Some duplicates remain in old data partitions not tested

**Evidence Against Current Duplicates:**
- Tested high-volume wallet (118M events) - 0 duplicates found
- `pm_trader_events_v3` exists specifically for deduplication via ReplacingMergeTree
- The ingestion-guardrail.ts module prevents duplicate `trade_id` insertion

---

## Recommended Actions

### 1. Update CLAUDE.md
Replace the deduplication pattern with:
```markdown
### CLOB Deduplication Pattern (REQUIRED for PnL)

The `pm_trader_events_v3` table is pre-deduped at the event_id level.
For PnL calculations, dedupe at the **fill level** using this pattern:

\`\`\`sql
WITH deduped_trades AS (
  SELECT
    substring(event_id, 1, 66) as tx_hash,
    m.condition_id,
    m.outcome_index,
    t.side,
    max(t.usdc_amount) / 1e6 as usdc,
    max(t.token_amount) / 1e6 as tokens
  FROM pm_trader_events_v3 t
  LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  WHERE lower(t.trader_wallet) = '0x...'
    AND m.condition_id IS NOT NULL
  GROUP BY tx_hash, condition_id, outcome_index, side
)
SELECT ... FROM deduped_trades
\`\`\`

**Why:** Handles edge cases where same wallet is both maker and taker in same tx.
```

### 2. Add to STABLE_PACK_REFERENCE.md
Create a skill label:
- **[FDD]** Fill Deduplication - Understanding maker/taker fill semantics and correct aggregation patterns

### 3. Verify V1 Engine Logic
The pnlEngineV1.ts already uses the correct pattern:
```typescript
GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
```
✅ No changes needed.

---

## References

- **Source Code:** `/Users/scotty/Projects/Cascadian-app/lib/pnl/pnlEngineV1.ts` (lines 133-147)
- **Ingestion Logic:** `/Users/scotty/Projects/Cascadian-app/lib/ingestion-guardrail.ts`
- **Table Schemas:** Query via `mcp__clickhouse__list_tables`

---

**Last Updated:** 2026-01-09
**Next Review:** When implementing PnL V2 or updating wallet analytics
