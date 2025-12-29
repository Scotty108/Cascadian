# Cost Basis PnL Engine Specification

**Date:** 2025-12-16
**Status:** Design

## Background

The current cash-flow based PnL calculation (`cash_flow + winner_tokens * resolution_price`) breaks for:
1. **Active traders** who sell before resolution
2. **Arbitrageurs** who buy/sell opposite outcomes in same transaction
3. **Market makers** who acquire tokens from counterparty PositionSplits atomically

### Root Cause
When Theo4 sells "No" tokens as taker, those tokens were never tracked as acquired in CLOB. They came from the counterparty's PositionSplit in the same atomic transaction. Our CLOB-only view sees the sell but not the acquisition.

## Solution: Cost Basis Accounting

### Data Model

```typescript
interface Position {
  wallet: string;
  token_id: string;          // or (condition_id, outcome_index)
  amount: number;            // current token balance (>=0)
  avg_price: number;         // weighted average cost basis
  realized_pnl: number;      // cumulative realized PnL
}
```

### Update Rules (from Polymarket subgraph)

#### On BUY
```typescript
function updateWithBuy(position: Position, amount: number, price: number) {
  // Weighted average cost basis
  const totalCost = position.amount * position.avg_price + amount * price;
  const newAmount = position.amount + amount;

  position.avg_price = newAmount > 0 ? totalCost / newAmount : price;
  position.amount = newAmount;
}
```

#### On SELL
```typescript
function updateWithSell(position: Position, amount: number, price: number) {
  // Cap sell at tracked inventory (CRITICAL)
  const effectiveAmount = Math.min(amount, position.amount);
  const externalSell = amount - effectiveAmount;

  // Realize PnL only on tracked inventory
  const deltaPnL = effectiveAmount * (price - position.avg_price);
  position.realized_pnl += deltaPnL;
  position.amount -= effectiveAmount;

  // Track external sells for diagnostics
  return { effectiveAmount, externalSell };
}
```

### PnL Calculation

```typescript
function calculatePnL(position: Position, currentPrice: number) {
  const unrealized = position.amount * (currentPrice - position.avg_price);
  return position.realized_pnl + unrealized;
}

// For resolved markets:
function calculateResolvedPnL(position: Position, resolutionPrice: number) {
  const finalPayout = position.amount * resolutionPrice;
  const unrealized = finalPayout - (position.amount * position.avg_price);
  return position.realized_pnl + unrealized;
}
```

## Implementation Plan

### Phase 1: Position Engine Module
Create `lib/pnl/costBasisEngine.ts` with:
- Position tracking per (wallet, token_id)
- BUY/SELL update functions
- Sell capping with external_sell tracking
- PnL calculation functions

### Phase 2: Validation Script
Create `scripts/pnl/test-cost-basis-engine.ts` to:
- Load deduped CLOB trades for test wallets
- Process in chronological order
- Output position states and PnL
- Compare to benchmarks

### Phase 3: Integration
- Create `pm_unified_ledger_v8` view that uses cost basis
- Update benchmark tests

## Key Invariants

1. **Position.amount >= 0** (enforced by sell capping)
2. **external_sell tracking** for diagnostics
3. **Price must be in [0, 1]** for Polymarket outcomes
4. **avg_price preserved** when amount becomes 0 (for reopening positions)

## Edge Cases

### 1. Selling more than owned
- Cap at owned amount
- Track external_sell for reporting
- Do NOT allow negative positions

### 2. Zero-price trades
- Skip or use small epsilon for avg_price

### 3. Resolution
- Final payout = amount * resolution_price
- Close position (amount = 0)
- Realize remaining unrealized PnL

## Expected Impact

| Wallet | Current V6 Error | Expected with Cost Basis |
|--------|------------------|--------------------------|
| Theo4 | 0.5% | ≤1% |
| primm | 472% | TBD (needs inventory sources) |
| anon | 235% | TBD |

For wallets like primm/anon that are primarily takers acquiring tokens outside CLOB, the cost-basis engine with sell capping will:
1. Prevent negative balances
2. Show `external_sell` as diagnostic metric
3. Likely still undercount total PnL (same as Polymarket UI does)
