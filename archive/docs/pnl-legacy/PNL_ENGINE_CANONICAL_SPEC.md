# PnL Engine Canonical Specification

**Status:** CANONICAL - This is the authoritative PnL spec for Cascadian
**Version:** 1.0
**Created:** 2025-11-24
**Last Updated:** 2025-11-24

---

## Overview

This document defines the canonical approach to calculating Profit & Loss (PnL) for Polymarket wallets. All new PnL features, views, and metrics MUST align with this specification.

## Core Principle

**PnL is computed from raw events, not from pre-aggregated Goldsky fields.**

The Goldsky `pm_user_positions.realized_pnl` field is known to be unreliable (40x inflation for active traders due to accumulating trade-level profits). We do NOT use it as a source of truth.

---

## Version 1 Scope

This spec describes **Version 1** of the PnL engine.

**Version 1 will:**
- Compute **realized PnL only** using:
  - Trade cashflows from `pm_trader_events_v2`
  - Resolution outcomes from `pm_condition_resolutions`

**Version 1 ignores:**
- Unrealized PnL on open positions
- CTF split / merge / redeem flows
- Multi-outcome markets beyond simple winner vs loser

Future versions may extend this with full CTF events, unrealized PnL, and advanced tax lot logic.

---

## Data Sources

### Primary (Use These in V1)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `pm_trader_events_v2` | Raw trade events per wallet | `trader_wallet`, `token_id`, `role`, `side`, `usdc_amount`, `token_amount`, `fee_amount`, `trade_time` |
| `pm_token_to_condition_map_v3` | Map token to condition and outcome | `token_id_dec`, `condition_id`, `outcome_index` |
| `pm_condition_resolutions` | Resolution outcomes | `condition_id`, `payout_numerators` |
| `pm_market_metadata` | Market info and categories | `condition_id`, `question`, `category`, `tags` |

### Future Sources (Planned for V2+)

These tables are not required for V1. They are reserved for future extensions:

| Table | Purpose |
|-------|---------|
| `pm_ctf_events` | CTF split / merge / redeem events and payouts |

### Reference Only (Do NOT Use as Source of Truth)

| Table | Why Reference Only |
|-------|-------------------|
| `pm_user_positions` | `realized_pnl` accumulates trade profits, causing 40x inflation |
| Polymarket Data API | Useful for spot-checks, but not canonical |
| Any "ground truth" spreadsheet | Unknown methodology, often mathematically impossible |

---

## State Model (Conceptual Reference)

> **Important:** The state model below is a **conceptual reference only**.
> Version 1 of the engine implements realized PnL as a **cash ledger**:
> buys are negative cash, sells are positive cash, and resolution payouts are final positive cash.
> We do **not** maintain per-row `avg_cost` state in ClickHouse in V1.

Per wallet, per condition (or per token), the conceptual model tracks:

```
position_size     -- Current shares held
total_bought      -- Cumulative USDC spent buying (including fees)
total_sold        -- Cumulative USDC received selling (minus fees)
avg_cost          -- Average cost basis per share (conceptual, not stored)
realized_pnl      -- Locked-in profit/loss from closed positions
```

---

## PnL Calculation Rules (V1 Cash Ledger)

### On BUY Trade (from wallet perspective)

```
shares_delta = +token_amount
cash_delta   = -(usdc_amount + fee_amount)   -- spend cash plus fee
```

No realized PnL at trade time in V1. The trade just updates the cash ledger.

### On SELL Trade (from wallet perspective)

```
shares_delta = -token_amount
cash_delta   = +(usdc_amount - fee_amount)   -- receive cash minus fee
```

Realized PnL is implicitly captured in the cash ledger. Total realized PnL for a condition equals `sum(cash_delta)` from all trades plus any resolution payout for remaining shares.

### On RESOLUTION (Market Closes)

For each wallet, condition, and outcome:

1. Let `trade_cash = sum(cash_delta)` from all BUY and SELL trades for that condition and outcome
2. Let `final_shares = net sum of shares_delta` over all trades
3. Let `won = (payout_numerators[outcome_index + 1] > 0)`

Resolution payout:
- If `won = true`: `resolution_cash = final_shares * 1.0` (paid 1 USDC per share)
- If `won = false`: `resolution_cash = 0`

**V1 realized PnL for that condition and outcome:**

```
realized_pnl = trade_cash + resolution_cash
```

---

## Outcome Resolution

In ClickHouse, `pm_condition_resolutions.payout_numerators` is expected to be an **array of integers**, not a string.

For binary markets in V1:
- Index 1 (array index 1) corresponds to `outcome_index = 0`
- Index 2 (array index 2) corresponds to `outcome_index = 1`
- A positive numerator means that outcome won and pays out at 1.0 relative to collateral

**Canonical V1 rule:**
```sql
won = (arrayElement(payout_numerators, outcome_index + 1) > 0)
```

- If `won = 1` then remaining shares pay out at 1.0
- If `won = 0` then remaining shares are worthless

---

## SQL Pattern for Wallet PnL (V1 Normative Reference)

Version 1 canonical implementation is a **cash ledger model**. The query below is the normative reference that all other PnL logic must match semantically.

```sql
WITH trades AS (
  SELECT
    lower(t.trader_wallet) AS wallet,
    m.condition_id,
    m.outcome_index,
    lower(t.side) AS side,
    t.usdc_amount / 1e6 AS usdc,
    t.token_amount / 1e6 AS shares,
    t.fee_amount / 1e6 AS fee
  FROM pm_trader_events_v2 t
  JOIN pm_token_to_condition_map_v3 m
    ON toString(t.token_id) = toString(m.token_id_dec)
),
aggregated AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    -- Cash ledger: buys are negative, sells are positive
    SUM(CASE WHEN side = 'buy'  THEN -(usdc + fee)
             WHEN side = 'sell' THEN  (usdc - fee)
             ELSE 0 END) AS trade_cash,
    -- Net shares position
    SUM(CASE WHEN side = 'buy'  THEN  shares
             WHEN side = 'sell' THEN -shares
             ELSE 0 END) AS final_shares
  FROM trades
  GROUP BY wallet, condition_id, outcome_index
),
with_resolution AS (
  SELECT
    a.*,
    r.payout_numerators,
    -- Did this outcome win? Use array indexing (1-based in ClickHouse)
    (arrayElement(r.payout_numerators, a.outcome_index + 1) > 0) AS won
  FROM aggregated a
  LEFT JOIN pm_condition_resolutions r
    ON a.condition_id = r.condition_id
)
SELECT
  wallet,
  condition_id,
  outcome_index,
  trade_cash,
  CASE WHEN won THEN final_shares * 1.0 ELSE 0 END AS resolution_cash,
  trade_cash + CASE WHEN won THEN final_shares * 1.0 ELSE 0 END AS realized_pnl
FROM with_resolution
```

---

## Key Conventions

### Units
- `usdc_amount`, `fee_amount`: micro-USDC (divide by 1e6)
- `token_amount`: micro-shares (divide by 1e6)
- All PnL values in this spec are in **dollars**

### Side Attribution
- `side = 'buy'` or `side = 'BUY'`: Wallet bought shares
- `side = 'sell'` or `side = 'SELL'`: Wallet sold shares
- Always use `lower(side)` for case-insensitive matching

### Outcome Index
- `outcome_index = 0`: YES outcome
- `outcome_index = 1`: NO outcome

### Resolution Detection (Array-Based)
- `arrayElement(payout_numerators, 1) > 0`: YES won
- `arrayElement(payout_numerators, 2) > 0`: NO won
- `NULL` or empty array: Not yet resolved

---

## Do NOT Do This

1. **Do NOT use `pm_user_positions.realized_pnl`** as source of truth
2. **Do NOT calibrate to arbitrary "ground truth" spreadsheets** without knowing methodology
3. **Do NOT define PnL as net trade cash flow only** - resolution payouts are critical
4. **Do NOT assume Goldsky numbers match Polymarket UI** - they often don't
5. **Do NOT create complex WAC logic in V1** - stick to the cash ledger model

---

## Validation Approach

When building new PnL logic:

1. **Pick 3-5 test wallets** with known characteristics:
   - One market maker (high volume, many trades)
   - One long-term holder (few trades, mostly resolutions)
   - One active trader (moderate volume)

2. **Manually verify** against Polymarket UI for at least one resolved condition

3. **Check mathematical consistency**:
   - PnL should NOT exceed total trading volume
   - Resolved positions should have zero remaining shares

---

## Out of Scope for Version 1

The following are explicitly **out of scope** for the initial implementation and will be specified in separate documents:

- Unrealized PnL and live mark-to-market
- Full CTF event integration (splits, merges, redeems)
- Multi-outcome markets beyond simple winner vs loser logic
- Category-level equity curves and Omega ratio
- Per-trade WAC cost basis tracking

---

## Related Files

- **Core Tables Schema:** `docs/systems/database/CORE_TABLES_SCHEMA.md`
- **Table Relationships:** `docs/systems/database/TABLE_RELATIONSHIPS.md`
- **Archived Investigations:** `archive/docs/pnl/` (historical reference only)

---

## Changelog

- **2025-11-24:** Initial canonical spec created after repo cleanup
- **2025-11-24:** V1 scope clarified, cash ledger model documented, array-based resolution logic added
