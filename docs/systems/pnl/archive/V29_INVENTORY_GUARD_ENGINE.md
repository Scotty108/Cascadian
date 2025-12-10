# V29 Inventory Guard PnL Engine

**Status:** CANONICAL
**Date:** 2025-12-05
**Terminal:** Claude 1

## Executive Summary

V29 is the "once and for all" PnL engine that solves the 97% wallet failure problem by implementing Polymarket's own `adjustedAmount` inventory guard approach.

## The Problem

Previous engines (V17-V28) failed on most wallets because:
1. Most traders use CLOB only (never emit CTF events)
2. When markets resolve, traders have phantom shares we never tracked them buying
3. Without CTF data, redemptions appear as pure profit or phantom losses

## The Solution: Inventory Guard

Polymarket's subgraph handles this with an inventory guard:

```javascript
// From Polymarket's actual codebase
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount  // CLAMP to tracked inventory
  : amount;
// "the user obtained tokens outside of what we track"
// "we don't want to give them PnL for the extra"
```

V29 implements this same logic: when a wallet tries to sell/redeem more shares than we tracked them buying, we CLAMP the sale to tracked inventory.

## Key Features

### 1. Condition-Level Cost Basis Pooling (from V28)
Cost basis is pooled at the condition level, not outcome level. This handles the CTF mismatch where:
- CLOB buys happen on the traded outcome (e.g., idx=1 for YES tokens)
- PayoutRedemption happens on the winning outcome (e.g., idx=0 if YES wins)

### 2. Inventory Guard (NEW in V29)
When selling/redeeming more shares than tracked:
```
adjustedTokensSold = MAX(0, totalQuantity)  // Clamp to inventory
clampedTokens = tokensSold - adjustedTokensSold  // Track the gap
```

### 3. Fresh Token Mapping via V8 Ledger
Uses `pm_unified_ledger_v8` which is built on `pm_token_to_condition_map_v5`:
- V5 map: 400,155 tokens (fresh from pm_market_metadata)
- V4 map: 359,117 tokens (stale)

### 4. UI Rounding Mode (optional)
For UI parity testing, rounds prices to cents before multiplication:
```
markPrice = Math.floor(price * 100) / 100
```

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `inventoryGuard: true` | Clamps sells to tracked inventory | Default - matches UI |
| `inventoryGuard: false` | Shows phantom losses | Economic truth / audit |
| `uiRounding: true` | Round prices to cents | UI parity debugging |
| `useV8Ledger: true` | Use fresh V5 token map | Default |
| `useV8Ledger: false` | Use stale V4 token map | Comparison |

## Usage

```typescript
import { calculateV29PnL, compareV29Modes } from './lib/pnl/inventoryEngineV29';

// Default mode (with guard)
const result = await calculateV29PnL(wallet);

// Compare all modes
const modes = await compareV29Modes(wallet);
console.log('With guard:', modes.withGuard.realizedPnl);
console.log('Without guard:', modes.withoutGuard.realizedPnl);
console.log('Guard impact:', modes.withGuard.realizedPnl - modes.withoutGuard.rawRealizedPnl);
```

## Result Fields

| Field | Description |
|-------|-------------|
| `realizedPnl` | PnL with inventory guard applied |
| `rawRealizedPnl` | PnL without guard (economic truth) |
| `unrealizedPnl` | Value of open positions |
| `totalPnl` | realized + unrealized |
| `clampedPositions` | Number of positions where guard was triggered |
| `totalClampedTokens` | Total phantom tokens that were clamped |

## Data Flow

```
pm_trader_events_v2 (CLOB trades)
        │
        ├── JOIN pm_token_to_condition_map_v5 (token_id → condition_id)
        │
        └── UNION with pm_ctf_events (Splits/Merges/Redemptions)
                │
                ▼
        pm_unified_ledger_v8 (unified event stream)
                │
                ▼
        InventoryEngineV29 (state machine with guard)
                │
                ▼
        V29Result (PnL with diagnostics)
```

## Files

- **Engine:** `lib/pnl/inventoryEngineV29.ts`
- **Test Script:** `scripts/pnl/test-v29-benchmark.ts`
- **Data Pipeline:** `scripts/fix-data-pipeline-v8.sql`

## Validation

Run the benchmark test:
```bash
npx tsx scripts/pnl/test-v29-benchmark.ts
```

Expected metrics:
- 80%+ wallets within $1 of UI PnL
- 95%+ wallets within 5% of UI PnL
- Guard impact visible in `clampedPositions` count

## Why This Works

1. **Matches Polymarket's behavior** - We do exactly what their subgraph does
2. **Handles incomplete data gracefully** - Most traders are CLOB-only
3. **Preserves economic truth** - `rawRealizedPnl` shows the unclamped value
4. **Provides diagnostics** - `clampedPositions` shows where data is incomplete

## Known Limitations

1. **V8 ledger is a VIEW** - Can timeout on full-table scans. Consider materializing for production.
2. **Clamp hides real issues** - Some phantom positions may indicate actual data bugs
3. **UI rounding is approximate** - Polymarket's exact rounding logic may differ

## Changelog

- **V29** (2025-12-05): Added inventory guard, fresh V5 map
- **V28** (2025-12-05): Condition-level cost basis pooling
- **V27b**: Per-outcome cost basis (had outcome mismatch bug)
- **V23c**: Shadow ledger with UI price oracle
