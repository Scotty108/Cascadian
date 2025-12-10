# Win Rate & Omega Ratio Implementation Plan

## Executive Summary

We have all the data needed to calculate Win Rate, ROI, and Omega Ratio. The V11_POLY engine provides correct realized PnL. This plan extends it to per-market attribution for advanced metrics.

**Status:** Ready to implement
**Estimated Effort:** 6-8 hours
**Dependencies:** None (data is complete)

---

## Current State

### What We Have

| Data Source | Rows | Purpose |
|-------------|------|---------|
| `pm_trader_events_v2` | 780M+ | Complete CLOB trade history |
| `pm_condition_resolutions` | 192K | Market outcomes (payout_numerators) |
| `pm_token_to_condition_map_v3` | 358K | token_id → condition_id mapping |
| V11_POLY Engine | N/A | Verified realized PnL calculation |

### Resolution Coverage

W2 benchmark wallet: **100% coverage** (22/22 markets resolved)
- All traded markets have resolution data
- payout_numerators available (e.g., [1,0] for YES wins, [0,1] for NO wins)

---

## Metric Definitions

### 1. Win Rate

```
Win Rate = (Markets with positive return) / (Total resolved markets traded)
```

**Definition of "Win":**
- Market-level return > 0 after accounting for all buys, sells, and resolution payout
- For partially exited positions: Include resolution payout for remaining shares

### 2. Return per Market

```
Market Return = (Total Sells + Resolution Payout) - Total Buys
Market ROI = Market Return / Total Buys
```

### 3. Omega Ratio

```
Omega = Sum(positive returns) / |Sum(negative returns)|
```

The Omega ratio measures the probability-weighted ratio of gains to losses.
- Omega > 1: More gains than losses (good)
- Omega = 1: Break-even
- Omega < 1: More losses than gains (bad)

---

## Implementation Plan

### Phase 1: Per-Market Attribution (2-3 hours)

**Goal:** Compute return for each market a wallet traded

**Query Pattern:**
```sql
WITH wallet_trades AS (
  SELECT
    event_id,
    any(token_id) as token_id,
    any(side) as side,
    any(usdc_amount) / 1e6 as usdc,
    any(token_amount) / 1e6 as tokens,
    any(outcome_index) as outcome_index
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet:String} AND is_deleted = 0
  GROUP BY event_id
),
with_condition AS (
  SELECT
    t.*,
    m.condition_id
  FROM wallet_trades t
  LEFT JOIN pm_token_to_condition_map_v3 m
    ON t.token_id = m.token_id_dec
),
market_aggregates AS (
  SELECT
    condition_id,
    outcome_index,
    -- Cost basis
    sum(if(side = 'BUY', usdc, 0)) as total_bought_usdc,
    sum(if(side = 'BUY', tokens, 0)) as total_bought_tokens,
    -- Sales proceeds
    sum(if(side = 'SELL', usdc, 0)) as total_sold_usdc,
    sum(if(side = 'SELL', tokens, 0)) as total_sold_tokens,
    -- Net position at resolution
    sum(if(side = 'BUY', tokens, 0)) - sum(if(side = 'SELL', tokens, 0)) as net_tokens
  FROM with_condition
  WHERE condition_id IS NOT NULL
  GROUP BY condition_id, outcome_index
)
SELECT
  a.condition_id,
  a.outcome_index,
  a.total_bought_usdc,
  a.total_sold_usdc,
  a.net_tokens,
  r.payout_numerators,
  -- Resolution payout for remaining position
  a.net_tokens * arrayElement(r.payout_numerators, a.outcome_index + 1) as resolution_payout,
  -- Total return
  (a.total_sold_usdc + a.net_tokens * arrayElement(r.payout_numerators, a.outcome_index + 1))
    - a.total_bought_usdc as market_return
FROM market_aggregates a
LEFT JOIN pm_condition_resolutions r ON a.condition_id = r.condition_id
WHERE r.condition_id IS NOT NULL  -- Only resolved markets
```

**Deliverables:**
- [ ] `lib/pnl/computeMarketReturns.ts` - Per-market return calculation
- [ ] Script to validate against V11_POLY totals

### Phase 2: Win Rate Calculation (1-2 hours)

**Goal:** Count wins vs losses per wallet

**Logic:**
```typescript
interface MarketResult {
  condition_id: string;
  outcome_index: number;
  total_bought: number;
  total_sold: number;
  net_tokens: number;
  resolution_payout: number;
  market_return: number;
}

function computeWinRate(markets: MarketResult[]): {
  wins: number;
  losses: number;
  winRate: number;
} {
  const resolved = markets.filter(m => m.resolution_payout !== null);
  const wins = resolved.filter(m => m.market_return > 0).length;
  const losses = resolved.filter(m => m.market_return < 0).length;

  return {
    wins,
    losses,
    winRate: resolved.length > 0 ? wins / resolved.length : 0,
  };
}
```

**Deliverables:**
- [ ] `lib/pnl/computeWinRate.ts` - Win rate calculation
- [ ] Add to wallet metrics API

### Phase 3: Omega Ratio Calculation (1-2 hours)

**Goal:** Compute probability-weighted gain/loss ratio

**Logic:**
```typescript
function computeOmegaRatio(markets: MarketResult[]): number {
  const resolved = markets.filter(m => m.resolution_payout !== null);

  const totalGains = resolved
    .filter(m => m.market_return > 0)
    .reduce((sum, m) => sum + m.market_return, 0);

  const totalLosses = Math.abs(resolved
    .filter(m => m.market_return < 0)
    .reduce((sum, m) => sum + m.market_return, 0));

  if (totalLosses === 0) {
    return totalGains > 0 ? Infinity : 1;
  }

  return totalGains / totalLosses;
}
```

**Deliverables:**
- [ ] `lib/pnl/computeOmegaRatio.ts` - Omega ratio calculation
- [ ] Add to wallet metrics API

### Phase 4: Validation & Integration (2 hours)

**Goal:** Verify calculations and integrate with existing metrics

**Tasks:**
- [ ] Validate against benchmark wallets
- [ ] Ensure sum of market returns ≈ V11_POLY realizedPnL
- [ ] Add to existing wallet metrics endpoint
- [ ] Update dashboard UI (if exists)

---

## Edge Cases

### 1. Partial Exits
Trader buys 100 tokens, sells 50, market resolves.
- **Handling:** Count both realized (from sale) and unrealized-then-resolved (from resolution)

### 2. Multi-Outcome Markets (NegRisk)
Trader may hold multiple outcome positions.
- **Handling:** Track each outcome_index separately, sum returns at condition_id level

### 3. Unresolved Markets
Markets still pending resolution.
- **Handling:** Exclude from win rate and Omega ratio (realized metrics only)

### 4. Zero Cost Basis
Tokens received via transfer with no buy event.
- **Handling:** Use V11_POLY engine's transfer cost model setting

---

## File Structure

```
lib/pnl/
  polymarketSubgraphEngine.ts    # Existing - V11_POLY
  polymarketEventLoader.ts       # Existing - event loading
  computeMarketReturns.ts        # NEW - per-market attribution
  computeWinRate.ts              # NEW - win rate calculation
  computeOmegaRatio.ts           # NEW - Omega ratio calculation
  types.ts                       # NEW - shared types

scripts/pnl/
  validate-market-returns.ts     # NEW - validation script
  benchmark-win-rate.ts          # NEW - benchmark testing
```

---

## Success Criteria

1. **Consistency:** Sum of market returns matches V11_POLY realizedPnL within $1
2. **Coverage:** Win rate computable for all wallets with resolved trades
3. **Benchmark:** W2 win rate and Omega ratio match manual calculation
4. **Performance:** Calculation completes in <5s for typical wallet

---

## Dependencies

None. All required data is already in ClickHouse:
- Trade history: `pm_trader_events_v2`
- Token mapping: `pm_token_to_condition_map_v3`
- Resolutions: `pm_condition_resolutions`

---

*Document Version: 1.0*
*Created: 2025-11-29*
*Author: Claude Code (Opus 4.5)*
