# PnL Engine Archaeology Report

**Date:** 2025-12-17
**Purpose:** Document all PnL calculation approaches before implementing Polymarket-accurate engine
**Status:** REFERENCE DOCUMENT - Do not delete

---

## Executive Summary

We discovered that our engines diverge from Polymarket's official PnL calculation. This document preserves all existing approaches for reference and potential rollback.

**Key Discovery:** Polymarket uses **Weighted Average Cost Basis**, not FIFO.

---

## Table of Contents

1. [Data Sources](#1-data-sources)
2. [Engine Inventory](#2-engine-inventory)
3. [Maker-Only Batch Approach](#3-maker-only-batch-approach)
4. [V19b Unified Ledger Approach](#4-v19b-unified-ledger-approach)
5. [Polymarket Official Algorithm](#5-polymarket-official-algorithm)
6. [Validation Results](#6-validation-results)
7. [Files to Preserve](#7-files-to-preserve)

---

## 1. Data Sources

### 1.1 pm_trader_events_v2 (CLOB Trades)

**Location:** ClickHouse
**Coverage:** All CLOB order fills
**Key Fields:**
- `trader_wallet` - Wallet address
- `event_id` - Unique trade identifier
- `role` - 'maker' or 'taker'
- `side` - 'buy' or 'sell'
- `token_id` - ERC1155 token ID
- `token_amount` - Amount in 6 decimals
- `usdc_amount` - USDC in 6 decimals
- `trade_time` - Timestamp
- `is_deleted` - Soft delete flag

**Deduplication Required:** YES - Each trade appears twice (once per counterparty)
```sql
SELECT event_id, any(side) as side, any(token_amount) as tokens, any(usdc_amount) as usdc
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...' AND is_deleted = 0
GROUP BY event_id
```

**Known Issues:**
- Contains duplicates from backfill processes (2-3x per wallet)
- Must always GROUP BY event_id

---

### 1.2 pm_unified_ledger_v9_clob_tbl

**Location:** ClickHouse
**Coverage:** CLOB trades only (no splits/merges/redemptions)
**Key Fields:**
- `wallet_address` - Wallet address
- `event_id` - Unique event identifier
- `condition_id` - Market condition ID
- `outcome_index` - 0 or 1 for binary markets
- `usdc_delta` - Signed USDC change
- `token_delta` - Signed token change
- `payout_norm` - Resolution price (0 or 1, null if unresolved)
- `event_time` - Timestamp

**Deduplication Required:** YES - 55% duplicate rate observed
```sql
SELECT event_id, any(usdc_delta) as usdc, any(token_delta) as tokens
FROM pm_unified_ledger_v9_clob_tbl
WHERE wallet_address = '0x...'
GROUP BY event_id
```

**Known Issues:**
- Does NOT include splits, merges, or redemptions
- Heavy duplication (observed 7,110 rows → 3,178 unique for one wallet)

---

### 1.3 pm_wallet_trade_stats

**Location:** ClickHouse
**Purpose:** Pre-computed per-wallet trade statistics
**Created:** 2025-12-17
**Population Time:** 44 seconds for 1.3M wallets

**Schema:**
```sql
CREATE TABLE pm_wallet_trade_stats (
  wallet String,
  maker_count UInt32,
  taker_count UInt32,
  total_count UInt32,
  maker_usdc Float64,
  taker_usdc Float64,
  total_usdc Float64,
  first_trade_time DateTime,
  last_trade_time DateTime,
  taker_ratio Float64,
  computed_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY wallet
```

---

### 1.4 pm_wallet_engine_pnl_cache

**Location:** ClickHouse
**Purpose:** Cached PnL results from batch computation
**Engine Used:** Maker-only FIFO (NOT Polymarket-accurate)

**Schema:**
```sql
CREATE TABLE pm_wallet_engine_pnl_cache (
  wallet String,
  realized_pnl Float64,
  unrealized_pnl Float64,
  engine_pnl Float64,
  profit_factor Float64,
  external_sells_ratio Float64,
  open_exposure_ratio Float64,
  computed_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY wallet
```

**WARNING:** Values in this table are from maker-only FIFO approach and do NOT match Polymarket UI.

---

## 2. Engine Inventory

### Engine Files in lib/pnl/

| File | Version | Cost Basis | Data Source | Status |
|------|---------|------------|-------------|--------|
| `costBasisEngine.ts` | V1 | FIFO | pm_unified_ledger_v9 | Reference |
| `costBasisEngineV1.ts` | V1 | FIFO | pm_unified_ledger_v9 | Reference |
| `uiActivityEngineV17.ts` | V17 | Cash flow | pm_unified_ledger | Canonical (frozen) |
| `uiActivityEngineV19b.ts` | V19b | Cash flow | pm_unified_ledger_v9_clob_tbl | Active |
| `uiActivityEngineV19s.ts` | V19s | Cash flow | Synthetic resolution | Active |

### Batch Scripts in scripts/pnl/

| File | Approach | Data Source | Status |
|------|----------|-------------|--------|
| `fast-compute-priority-wallets.ts` | FIFO, maker-only | pm_trader_events_v2 | **BROKEN** |
| `batch-compute-engine-pnl.ts` | FIFO, maker-only | pm_trader_events_v2 | Reference |
| `replay-cost-basis-v1.ts` | FIFO | pm_unified_ledger_v9 | Test harness |

---

## 3. Maker-Only Batch Approach

**File:** `scripts/pnl/fast-compute-priority-wallets.ts`

### Algorithm

```typescript
// Load only MAKER trades
const trades = await query(`
  SELECT * FROM pm_trader_events_v2
  WHERE trader_wallet = '${wallet}'
    AND is_deleted = 0
    AND role = 'maker'  // <-- PROBLEM: Ignores taker trades
`);

// FIFO cost basis
for (const trade of trades) {
  if (trade.side === 'buy') {
    // Add to position with price tracking
    position.amount += tokens;
    position.costBasis += usdc;
    position.avgPrice = costBasis / amount;
  } else {
    // Sell: realize PnL based on avg cost
    const pnl = tokens * (sellPrice - avgPrice);
    realizedPnl += pnl;
    position.amount -= tokens;
  }
}
```

### Why It Failed

1. **Only maker trades** - Misses 30-50% of trading activity
2. **FIFO vs Weighted Average** - Different from Polymarket's approach
3. **No splits/merges** - Misses position adjustments

### Observed Results (cozyfnf wallet)

| Metric | Value |
|--------|-------|
| Maker-only realized_pnl | $1,410,873 |
| WebFetch UI PnL | $1,409,525 |
| Delta | +0.1% |

**Note:** This accidentally matched for low-taker wallets but fails for high-taker wallets.

---

## 4. V19b Unified Ledger Approach

**File:** `lib/pnl/uiActivityEngineV19b.ts`

### Algorithm

```typescript
// Load from unified ledger (CLOB only)
const positions = await query(`
  SELECT
    condition_id, outcome_index,
    sum(usdc_delta) AS cash_flow,
    sum(token_delta) AS final_tokens,
    any(payout_norm) AS resolution_price
  FROM pm_unified_ledger_v9_clob_tbl
  WHERE wallet_address = '${wallet}'
  GROUP BY condition_id, outcome_index
`);

// Cash flow + tokens × resolution price
for (const pos of positions) {
  if (pos.resolution_price !== null) {
    realizedPnl += pos.cash_flow + pos.final_tokens * pos.resolution_price;
  } else {
    // Synthetic resolution for near-certain outcomes
    const currentPrice = await fetchMarketPrice(pos.condition_id);
    if (currentPrice >= 0.99) {
      realizedPnl += pos.cash_flow + pos.final_tokens * 1.0;
    } else if (currentPrice <= 0.01) {
      realizedPnl += pos.cash_flow + pos.final_tokens * 0.0;
    } else {
      unrealizedPnl += pos.final_tokens * (currentPrice - 0.5);
    }
  }
}
```

### Why It Failed

1. **No deduplication** - 55% duplicate rows inflated results
2. **No splits/merges/redemptions** - Missing event types
3. **Different formula** - Cash flow aggregation vs weighted average

### Observed Results (cozyfnf wallet)

| Metric | Value |
|--------|-------|
| V19b realized_pnl (no dedup) | $4,035,798 |
| V19b realized_pnl (with dedup) | $2,435,637 |
| UI PnL | $1,409,525 |
| Delta (deduped) | +72.8% |

---

## 5. Polymarket Official Algorithm

**Source:** https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph

### Events Tracked

1. **OrderFilled** - All CLOB trades (maker AND taker)
2. **PositionSplit** - Buy YES+NO at $0.50 each
3. **PositionsMerge** - Sell YES+NO at $0.50 each
4. **PayoutRedemption** - Sell at resolution price
5. **PositionsConverted** - NO↔YES conversions (NegRisk)

### Data Model

```graphql
type UserPosition @entity {
  id: ID!
  user: String!
  tokenId: BigInt!
  amount: BigInt!         # Current token balance
  avgPrice: BigInt!       # Weighted average cost
  realizedPnl: BigInt!    # Cumulative realized PnL
  totalBought: BigInt!    # Total tokens ever bought
}
```

### Buy Logic (updateUserPositionWithBuy)

```typescript
if (amount > 0) {
  // Weighted average cost basis
  const numerator = avgPrice * currentAmount + buyPrice * buyAmount;
  const denominator = currentAmount + buyAmount;
  avgPrice = numerator / denominator;

  amount += buyAmount;
  totalBought += buyAmount;
}
```

### Sell Logic (updateUserPositionWithSell)

```typescript
// Cap at tracked position - can't sell more than you bought through tracked channels
const adjustedAmount = min(sellAmount, position.amount);

// Realized PnL = shares × (sell price - avg cost)
const deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE;

realizedPnl += deltaPnL;
amount -= adjustedAmount;
```

### Key Differences from Our Approaches

| Aspect | Our Engines | Polymarket |
|--------|-------------|------------|
| Cost basis | FIFO | **Weighted Average** |
| Trades included | Maker only | **All OrderFilled** |
| Splits/Merges | Ignored | **At $0.50** |
| Redemptions | Ignored | **At resolution price** |
| Sell cap | None | **Cap at position.amount** |
| Deduplication | Sometimes | **Event-based (no dupes)** |

---

## 6. Validation Results

### Wallet: 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd (@cozyfnf)

| Engine | Result | vs UI |
|--------|--------|-------|
| Maker-only FIFO | $1,410,873 | +0.1% |
| V19b (no dedup) | $4,035,798 | +186% |
| V19b (deduped) | $2,435,637 | +72.8% |
| WebFetch UI | $1,409,525 | baseline |

### Wallet: 0x8fe70c889ce14f67acea5d597e3d0351d73b4f20 (FALSE POSITIVE)

| Engine | Result | vs UI |
|--------|--------|-------|
| Maker-only FIFO | $342,418 | **+9,778%** |
| V19b (deduped) | $143,840 | +4,166% |
| WebFetch UI | -$3,538 | baseline |

**Note:** This wallet has 32% taker ratio, causing massive overestimation with maker-only.

---

## 7. Files to Preserve

### Critical Engine Files (DO NOT DELETE)

```
lib/pnl/costBasisEngine.ts
lib/pnl/costBasisEngineV1.ts
lib/pnl/uiActivityEngineV17.ts
lib/pnl/uiActivityEngineV19b.ts
lib/pnl/uiActivityEngineV19s.ts
```

### Batch Scripts (Reference)

```
scripts/pnl/fast-compute-priority-wallets.ts
scripts/pnl/batch-compute-engine-pnl.ts
scripts/pnl/replay-cost-basis-v1.ts
scripts/pnl/check-export-counts.ts
scripts/pnl/get-validation-sample.ts
```

### Validation Artifacts

```
tmp/validation_sample_25.json
tmp/spotcheck_low_taker_results.md
tmp/spotcheck_low_taker_sample.json
tmp/VALIDATION_REPORT_2025_12_17.md
```

### Data Tables (Keep for reference)

```sql
-- Do NOT drop these tables
pm_wallet_engine_pnl_cache      -- Maker-only FIFO results
pm_wallet_trade_stats           -- Pre-computed stats
pm_unified_ledger_v9_clob_tbl   -- Unified ledger (CLOB only)
pm_trader_events_v2             -- Raw CLOB events
```

---

## Appendix: Available Data Sources for Polymarket-Accurate Engine

### pm_ctf_events (139M rows)

Contains all CTF (Conditional Token Framework) events:

| Event Type | Count | Use |
|------------|-------|-----|
| PositionSplit | 93,520,122 | Buy at $0.50 |
| PayoutRedemption | 24,124,902 | Sell at resolution price |
| PositionsMerge | 21,506,196 | Sell at $0.50 |

**Schema:**
```
event_type: String
user_address: String
condition_id: String
amount_or_payout: String
event_timestamp: DateTime
```

### pm_trader_events_v2 (856M rows)

Contains all CLOB trades (OrderFilled events):
- Both maker AND taker trades
- Needs deduplication (GROUP BY event_id)

### pm_trader_events_dedup_v2_tbl (522M rows)

Pre-deduped CLOB trades - use this for efficiency.

---

## Appendix A: Taker Ratio Analysis

For wallet 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd:

| Role | Trades | Volume |
|------|--------|--------|
| Maker | 5,624 | $21,149,967 |
| Taker | 732 | $10,657,560 |
| Taker % | 11.5% | 33.5% |

For wallet 0x8fe70c889ce14f67acea5d597e3d0351d73b4f20:

| Role | Trades | Volume |
|------|--------|--------|
| Maker | 49,508 | $10,632,930 |
| Taker | 23,034 | $7,194,913 |
| Taker % | 31.8% | 40.4% |

---

## Appendix B: Duplication Analysis

pm_unified_ledger_v9_clob_tbl for cozyfnf:

| Metric | Value |
|--------|-------|
| Total rows | 7,110 |
| Unique event_ids | 3,178 |
| Duplicate rows | 3,932 (55.3%) |

pm_trader_events_v2 for cozyfnf:

| Metric | Value |
|--------|-------|
| Total rows | 6,356 |
| Unique event_ids | 3,178 |
| Duplicate rows | 3,178 (50%) |

**Note:** Duplicates are expected in trader_events (maker + taker rows per trade).

---

## Appendix C: Polymarket Subgraph Reference

**Repository:** https://github.com/Polymarket/polymarket-subgraph/
**Commit:** f5a074a5a3b7622185971c5f18aec342bcbe96a6
**Path:** pnl-subgraph/

**Key Files:**
- `src/ExchangeMapping.ts` - OrderFilled handler
- `src/ConditionalTokensMapping.ts` - Split/Merge/Redemption handlers
- `src/NegRiskAdapterMapping.ts` - NegRisk conversions
- `src/utils/updateUserPositionWithBuy.ts` - Buy logic
- `src/utils/updateUserPositionWithSell.ts` - Sell logic (PnL calculation)
- `schema.graphql` - Data model

---

**Document Version:** 1.0
**Last Updated:** 2025-12-17T03:30:00Z
**Author:** Claude Code
**Purpose:** Preserve institutional knowledge before engine rewrite
