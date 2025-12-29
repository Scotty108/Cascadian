> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Methodology - Cascadian Reference

> **Status:** Production | **Last Updated:** 2025-11-22

---

## Overview

Cascadian provides **TWO PnL tables** for different use cases:

| Table | Methodology | Best For |
|-------|-------------|----------|
| `pm_wallet_market_pnl_v2` | MAKER-ONLY | Matching Goldsky/external references |
| `pm_wallet_market_pnl_v3` | ALL FILLS | Complete trading activity tracking |

Both tables provide per-position PnL breakdown with trading and resolution payouts.

---

## Critical Discovery: Goldsky Uses Maker-Only

### The Key Finding

After extensive calibration testing, we discovered:

| Source | Theo PnL | Sports Bettor Trading PnL |
|--------|----------|---------------------------|
| **Goldsky pm_user_positions** | $22.05M | N/A (shows $28.8M total) |
| **v2 (MAKER-ONLY)** | $21.76M ✅ | -$63.7M ❌ |
| **v3 (ALL FILLS)** | $33.25M ❌ | -$11.1M ✅ |
| **Analytics Site Reference** | ~$22M | ~-$10M |

### Goldsky's Methodology

Goldsky's `pm_user_positions` table shows **$0 total_sold** for both calibration wallets. This confirms they use a maker-centric or buy-only tracking methodology, which:
- Matches v2 (MAKER-ONLY) for wallets like Theo
- Does NOT capture complete trading activity

### Why Different Methodologies Exist

**MAKER-ONLY (v2):**
- Captures limit order fills where the wallet provided liquidity
- Matches Goldsky and some external data sources
- Misses taker fills (market orders)

**ALL FILLS (v3):**
- Captures ALL trading activity (maker + taker)
- Provides complete cash flow picture
- Correct for trading analytics and PnL tracking

---

## Which Table Should I Use?

### Use v2 (MAKER-ONLY) when:
- Matching Goldsky or external leaderboards
- Comparing to third-party data sources
- Building features that need to align with public rankings

### Use v3 (ALL FILLS) when:
- Tracking actual trading performance
- Building analytics dashboards
- Calculating true cash flows (buys, sells, fees)
- Auditing wallet trading activity

---

## Case Studies

### Theo (0x56687bf4...)

| Metric | v2 (MAKER-ONLY) | v3 (ALL FILLS) | Goldsky |
|--------|-----------------|----------------|---------|
| Total Bought | $20.07M | $23.39M | $43.14M* |
| Total Sold | $0 | $9.16M | $0 |
| Trading PnL | -$20.07M | -$14.23M | — |
| Resolution | $41.83M | $47.48M | — |
| **Total PnL** | **$21.76M** | **$33.25M** | **$22.05M** |

*Goldsky's total_bought appears to be in shares, not USD

**Pattern:** Theo buys as maker, sells as taker. v2 matches Goldsky because both ignore taker sells.

### Sports Bettor (0xf29bb8e0...)

| Metric | v2 (MAKER-ONLY) | v3 (ALL FILLS) | Analytics Site |
|--------|-----------------|----------------|----------------|
| Buys Captured | $64M | $66.7M | — |
| Sells Captured | $0.26M | $55.6M | — |
| **Trading PnL** | **-$63.7M** ❌ | **-$11.1M** ✅ | **~-$10M** |

**Pattern:** Sports Bettor buys as maker ($64M), sells as taker ($55M). v2 misses 99.5% of sells!

---

## PnL Formula

### Core Calculation

```
Trading PnL = total_sold_usdc - total_bought_usdc - total_fees_usdc

Resolution Payout = max(0, net_shares) * outcome_payout

Total PnL = Trading PnL + Resolution Payout
```

### Variable Definitions

| Variable | Definition |
|----------|------------|
| `total_bought_usdc` | Sum of USDC spent buying shares |
| `total_sold_usdc` | Sum of USDC received selling shares |
| `total_fees_usdc` | Sum of all fees paid |
| `net_shares` | `bought_shares - sold_shares` |
| `outcome_payout` | `1` if this outcome won, `0` otherwise |

### Important: Negative Position Flooring

```sql
max(0, net_shares) * outcome_payout
```

The `max(0, net_shares)` expression **floors negative positions at zero**.

**Why?** You cannot receive a negative payout. If you sold more shares than you bought (net short), your resolution payout is $0 - you've already realized your gains/losses through trading.

---

## Data Sources

### Primary Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `pm_trader_events_v2` | Raw fill events | `trader_wallet`, `token_id`, `side`, `usdc_amount`, `token_amount`, `fee_amount` |
| `pm_token_to_condition_map_v2` | Token-to-market mapping | `token_id` -> `condition_id`, `outcome_index` |
| `pm_market_metadata` | Market context | `condition_id`, `question`, `category` |
| `pm_condition_resolutions` | Resolution payouts | `condition_id`, `payout_numerators` |

### Data Flow

```
pm_trader_events_v2
        |
        v
pm_token_to_condition_map_v2  -->  pm_market_metadata
        |
        v
pm_condition_resolutions
        |
        v
pm_wallet_market_pnl_v3
```

---

## Unit Scaling

All amounts in raw data are stored in **atomic units** (6 decimal places).

| Raw Value | Actual USD |
|-----------|------------|
| `1000000` | $1.00 |
| `1000000000` | $1,000.00 |
| `55000000000000` | $55,000,000.00 |

### Conversion

```sql
-- Raw to USD
usdc_amount / 1000000.0 AS usdc_value

-- Or using scientific notation
usdc_amount / 1e6 AS usdc_value
```

### Token Amounts

`token_amount` represents outcome shares, also stored with 6 decimal precision:

```sql
token_amount / 1e6 AS shares
```

---

## Calibration Wallets

These wallets serve as validation benchmarks for PnL calculations:

| Wallet | Address | Expected Trading PnL | Expected Total PnL |
|--------|---------|---------------------|-------------------|
| **Theo** | `0x56687bf447db6ffa42ffe2204a05edaa20f55839` | ~-$20M | ~$22M |
| **Sports Bettor** | `0xf29bb8e0712075041e87e8605b69833ef738dd4c` | ~-$11M | ~$62M |

### Validation Notes

- **Theo:** High-volume trader with significant resolution gains offsetting trading losses
- **Sports Bettor:** Demonstrates the critical importance of ALL fills methodology (fails with MAKER-ONLY)

---

## Key Implementation Notes

### 1. ClickHouse Array Indexing

**ClickHouse arrays are 1-indexed**, unlike most programming languages.

```sql
-- CORRECT: Add 1 to 0-based outcome_index
JSONExtractInt(payout_numerators, m.outcome_index + 1)

-- WRONG: Using 0-based index directly
JSONExtractInt(payout_numerators, m.outcome_index)  -- Will be off by one!
```

### 2. condition_id Normalization

The `condition_id` should be:
- **Lowercase** (not mixed case)
- **64 characters** (32 bytes hex-encoded)
- **No `0x` prefix**

```sql
-- Normalize condition_id
lower(substring(condition_id, 3)) AS normalized_condition_id  -- If has 0x prefix
lower(condition_id) AS normalized_condition_id                -- If already clean
```

### 3. Excluding Deleted Events

Always filter out deleted/replaced events:

```sql
WHERE is_deleted = 0
```

This excludes events that were superseded by corrections or reorgs.

### 4. Side Interpretation

| Side Value | Meaning |
|------------|---------|
| `0` | BUY |
| `1` | SELL |

```sql
CASE
    WHEN side = 0 THEN 'BUY'
    WHEN side = 1 THEN 'SELL'
END AS side_label
```

---

## Version History

| Version | Methodology | Status | Use Case |
|---------|-------------|--------|----------|
| **v1** | Initial implementation | Deprecated | — |
| **v2** | MAKER-ONLY fills | **Production** | Match Goldsky/external sources |
| **v3** | ALL fills | **Production** | Complete trading analytics |

### Why Both v2 and v3 Are Production

Neither methodology is universally "correct" - they serve different purposes:
- **v2** matches external data sources like Goldsky that use maker-only tracking
- **v3** captures complete trading activity for accurate analytics

### Choosing Between v2 and v3

```
Need to match leaderboards/Goldsky? → Use v2
Need accurate trading PnL? → Use v3
Building internal analytics? → Use v3
Comparing to external data? → Use v2
```

---

## Example Query

```sql
SELECT
    trader_wallet,
    condition_id,
    outcome_index,

    -- Trading metrics
    total_bought_usdc / 1e6 AS bought_usd,
    total_sold_usdc / 1e6 AS sold_usd,
    total_fees_usdc / 1e6 AS fees_usd,

    -- Calculated PnL
    (total_sold_usdc - total_bought_usdc - total_fees_usdc) / 1e6 AS trading_pnl_usd,
    resolution_payout_usdc / 1e6 AS resolution_payout_usd,
    total_pnl_usdc / 1e6 AS total_pnl_usd

FROM pm_wallet_market_pnl_v3
WHERE trader_wallet = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'  -- Theo
ORDER BY abs(total_pnl_usdc) DESC
LIMIT 100
```

---

## Related Documentation

- [STABLE_PACK_REFERENCE.md](./STABLE_PACK_REFERENCE.md) - Database patterns and skill labels
- [TABLE_RELATIONSHIPS.md](./TABLE_RELATIONSHIPS.md) - Schema reference
- [GOLDSKY_PNL_DATA_LIMITATIONS.md](./GOLDSKY_PNL_DATA_LIMITATIONS.md) - Data source constraints

---

*Document created: 2025-11-22 | Cascadian PnL Methodology V3*
