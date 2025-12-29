# Total PnL with Live Prices - Technical Specification

**Date:** 2025-12-17
**Status:** Proposed
**Author:** Claude Code

---

## Overview

This document specifies how to extend the V19s PnL engine to calculate **Total PnL** that matches Polymarket UI by adding live market prices for open positions.

---

## PnL Component Definitions

### 1. Realized PnL (Closed Trades)

**Definition:** Profit/loss from positions that have been explicitly closed via selling.

**Formula:**
```
realized_pnl = Σ (sell_price - avg_cost_basis) × shares_sold
```

**Data Source:** CLOB trades (pm_trader_events_v2)

**Accuracy:** ~99% for CLOB-active wallets

---

### 2. Synthetic Realized PnL (Resolved Markets)

**Definition:** Profit/loss from positions in markets that have resolved (or effectively resolved), even if shares weren't explicitly sold.

**Formula:**
```
synthetic_realized = Σ (resolution_price - avg_cost_basis) × shares_held_at_resolution
```

**Resolution Price Sources:**
| Condition | Resolution Price | Rationale |
|-----------|------------------|-----------|
| `payout_numerators = [1,0]` | 1.0 for outcome 0, 0.0 for outcome 1 | Official resolution |
| `payout_numerators = [0,1]` | 0.0 for outcome 0, 1.0 for outcome 1 | Official resolution |
| `live_price <= 0.01` | 0.0 (synthetic loser) | Market priced as worthless |
| `live_price >= 0.99` | 1.0 (synthetic winner) | Market priced as certain |
| No resolution data | Use live price | Treat as unrealized |

**Accuracy:** ~95% (depends on resolution data completeness)

---

### 3. Unrealized PnL (Open Positions)

**Definition:** Mark-to-market value of positions in markets that haven't resolved.

**Formula:**
```
unrealized_pnl = Σ (live_price - avg_cost_basis) × shares_currently_held
```

**Current State (V19s):**
- We mark unrealized at **0** or **resolution_price** (if available)
- This causes UI parity gap for wallets with open positions

**Proposed State (V19s + Live Prices):**
- Mark unrealized at **live_price** from CLOB last-trade or Gamma API
- Should achieve ~90%+ UI parity

---

### 4. Total PnL

**Formula:**
```
total_pnl = realized_pnl + synthetic_realized_pnl + unrealized_pnl
```

Or equivalently:
```
total_pnl = Σ (exit_price - entry_price) × shares

where exit_price =
  - sell_price (if sold)
  - resolution_price (if resolved)
  - live_price (if open)
```

---

## Implementation Plan

### Phase 1: Live Price Table (2-3 hours)

Create `pm_live_prices_v1` populated from our CLOB data:

```sql
CREATE TABLE pm_live_prices_v1 (
  token_id String,
  condition_id String,
  outcome_index UInt8,
  last_price Float64,
  bid_price Float64,      -- Optional: from orderbook
  ask_price Float64,      -- Optional: from orderbook
  mid_price Float64,      -- (bid + ask) / 2
  price_time DateTime,
  trade_count_24h UInt32,
  volume_24h Float64,
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY token_id;
```

**Refresh Logic (cron every 5 minutes):**
```sql
INSERT INTO pm_live_prices_v1
SELECT
  token_id,
  condition_id,
  outcome_index,
  argMax(usdc_amount / token_amount, trade_time) as last_price,
  0 as bid_price,  -- Phase 2
  0 as ask_price,  -- Phase 2
  argMax(usdc_amount / token_amount, trade_time) as mid_price,
  max(trade_time) as price_time,
  count() as trade_count_24h,
  sum(usdc_amount) as volume_24h,
  now() as updated_at
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND trade_time >= now() - INTERVAL 24 HOUR
  AND token_amount > 0
GROUP BY token_id, condition_id, outcome_index;
```

### Phase 2: Gamma API Backfill (Optional, +4 hours)

For illiquid tokens (trade_count_24h < 10), fetch from Gamma:

```typescript
async function backfillIlliquidPrices() {
  const illiquid = await getIlliquidTokens(); // trade_count_24h < 10

  for (const batch of chunk(illiquid, 100)) {
    const prices = await Promise.all(
      batch.map(t => fetchGammaPrice(t.condition_id))
    );
    await insertPrices(prices);
  }
}
```

### Phase 3: V19s Integration (2 hours)

Update `uiActivityEngineV19s.ts`:

```typescript
// Current
const unrealized = openShares * (resolutionPrice ?? 0);

// New
const livePrice = await getLivePrice(tokenId);
const unrealized = openShares * (resolutionPrice ?? livePrice ?? 0);
```

---

## API Response Structure

```typescript
interface WalletPnLResponse {
  wallet: string;

  // Component breakdown
  realized_pnl: number;           // Closed trades
  synthetic_realized_pnl: number; // Resolved markets (not sold)
  unrealized_pnl: number;         // Open positions at live price

  // Totals
  total_pnl: number;              // Sum of all components

  // Metadata
  open_positions: number;
  resolved_positions: number;
  closed_positions: number;

  // Confidence signals
  price_coverage: number;         // % of positions with live price
  data_completeness: number;      // % of trades we can track

  // Timestamps
  computed_at: string;
  prices_as_of: string;
}
```

---

## Expected Accuracy by Component

| Component | CLOB Wallets | Market Makers |
|-----------|--------------|---------------|
| Realized PnL | ~99% | ~70%* |
| Synthetic Realized | ~95% | ~70%* |
| Unrealized (with live prices) | ~95% | ~90%** |
| **Total PnL** | **~95%** | **~75%** |

*Market makers have tokens from splits/transfers we don't track
**Position value is accurate; cost basis is not

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
├─────────────────────────────────────────────────────────────────┤
│  pm_trader_events_v2     pm_token_to_condition_patch            │
│  (CLOB trades)           (token → condition mapping)            │
│         │                         │                              │
│         ▼                         ▼                              │
│  ┌─────────────┐          ┌──────────────┐                      │
│  │ Last Trade  │          │  Resolution  │                      │
│  │   Prices    │          │    Data      │                      │
│  └──────┬──────┘          └──────┬───────┘                      │
│         │                        │                               │
│         ▼                        ▼                               │
│  ┌─────────────────────────────────────────┐                    │
│  │         pm_live_prices_v1               │                    │
│  │  (token_id, price, price_time)          │                    │
│  └─────────────────┬───────────────────────┘                    │
│                    │                                             │
└────────────────────┼─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     V19s ENGINE                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  For each position:                                              │
│                                                                  │
│  1. Get cost_basis from CLOB buys                               │
│  2. Get exit_price:                                              │
│     - If sold → sell_price                                       │
│     - If resolved → resolution_price                             │
│     - If open → live_price from pm_live_prices_v1               │
│  3. Calculate: (exit_price - cost_basis) × shares               │
│                                                                  │
│  Output:                                                         │
│  - realized_pnl (sold positions)                                │
│  - synthetic_realized_pnl (resolved, not sold)                  │
│  - unrealized_pnl (open, at live price)                         │
│  - total_pnl (sum)                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cron Schedule

| Job | Frequency | Duration | Purpose |
|-----|-----------|----------|---------|
| Refresh live prices | Every 5 min | ~30 sec | Update last-trade prices |
| Gamma backfill | Every 1 hour | ~5 min | Fill illiquid tokens |
| Token mapping fix | Every 6 hours | ~2 min | Map new tokens |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| UI parity (all wallets) | 47% | 85%+ |
| UI parity (CLOB-only) | 60% | 95%+ |
| Price coverage | 0% | 95%+ |
| Price staleness | N/A | <15 min |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `lib/pnl/livePriceCache.ts` | CREATE | Price fetching and caching |
| `lib/pnl/uiActivityEngineV19s.ts` | MODIFY | Add live price lookup |
| `scripts/cron/refresh-live-prices.ts` | CREATE | Price refresh cron |
| `app/api/cron/refresh-live-prices/route.ts` | CREATE | Vercel cron endpoint |

---

## Open Questions

1. **Price staleness threshold:** How stale is too stale? 1 hour? 24 hours?
2. **Illiquid market handling:** Use last price even if 7 days old, or mark as "unknown"?
3. **Sports markets:** Different resolution mechanics - special handling needed?

---

## Appendix: Glossary

| Term | Definition |
|------|------------|
| **Realized** | Position closed via explicit sell trade |
| **Synthetic Realized** | Position in resolved market, shares still held |
| **Unrealized** | Open position in unresolved market |
| **Cost Basis** | Average price paid for shares (FIFO or average) |
| **Live Price** | Current market price from last trade or orderbook |
| **Resolution Price** | Final payout (0 or 1) when market resolves |
