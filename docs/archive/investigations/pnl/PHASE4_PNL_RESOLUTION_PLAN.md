# Phase 4: P&L Validation - Root Cause & Resolution Plan

## Problem Identified

The P&L calculation is using the **wrong formula**:
- **Current (WRONG)**: Sum all USDC cashflows = $1,907,531.19 ❌
- **Polymarket (CORRECT)**: Realized Gains - Realized Losses = $101,949.55 ✓

### Polymarket Formula (Verified)
```
Net P&L = Realized Gains - Realized Losses

For niggemon:
  Gain:  +$297,637.31 (closed winning positions)
  Loss:  -$195,687.76 (closed losing positions)
  Net:   +$101,949.55 (Gain - Loss)
```

## Root Cause

The tables `outcome_positions_v2` and `trade_cashflows_v3` are pre-aggregated incorrectly:
- They sum **all USDC flows** (buys + sells)
- But Polymarket calculates **gain/loss on closed positions**
- These are fundamentally different metrics

### Data Issues Found

1. **outcome_positions_v2**:
   - 8,374,571 rows (after filtering empty condition_id_norm)
   - Stores position snapshots, not trade history
   - Cannot reconstruct entry/exit prices

2. **trade_cashflows_v3**:
   - 35,874,799 rows (after filtering)
   - Sums all USDC movements
   - Doesn't distinguish realized gains from losses

## Solution: Rebuild from trades_raw

To calculate correct P&L using Polymarket formula:

### Step 1: Build Trade-Level Metrics
From `trades_raw`, for each wallet + condition:
```sql
- Entry price: AVG(price) for BUY trades
- Exit price: AVG(price) for SELL trades
- Winning outcome: FROM market_resolutions_final
- Realized gain: (exit_price - entry_price) * shares if winning
- Realized loss: (exit_price - entry_price) * shares if losing
```

### Step 2: Aggregate to Wallet Level
```sql
Net P&L = SUM(realized_gains > 0) - SUM(realized_losses < 0)
```

### Step 3: Validate Against Polymarket
```
Niggemon:
  Calculated: Must equal $101,949.55 ±2%
  Polymarket: $101,949.55 ✓
```

## Implementation Tasks

- [ ] **Task 1**: Rebuild wallet_pnl table from trades_raw
  - Extract individual trades (BUY/SELL)
  - Calculate entry/exit prices
  - Match to market_resolutions_final for outcomes
  - Estimate: 2-3 hours

- [ ] **Task 2**: Validate against all 4 reference wallets
  - niggemon: $101,949.55 ±2%
  - LucasMeow: $179,243 ±5%
  - xcnstrategy: $94,730 ±5%
  - HolyMoses7: $93,181 ±5%
  - Estimate: 30 min

- [ ] **Task 3**: Update Phase 4 validation script
  - Use correct wallet_pnl table
  - Run tests against all wallets
  - Estimate: 15 min

- [ ] **Task 4**: Phase 5-6 Deployment
  - Can only proceed after Phase 4 PASSED

## Current Status

✅ **Completed**:
- Market_id normalization
- Winning_index rebuild (137K → 224K rows)
- Root cause diagnosis
- Polymarket formula analysis

🚫 **BLOCKED** (Waiting for rebuild):
- Phase 4 validation
- Phase 5-6 deployment

## Next Steps

Choose one:

**Option A (Recommended)**: Rebuild P&L from trades_raw (~2-3 hours)
- Guarantees accurate calculations
- Matches Polymarket exactly
- Enables complete Phase 4-6

**Option B**: Use Polymarket API directly
- Pull P&L from Polymarket
- Skip local calculation
- Faster implementation

## Files to Update

- `validate-pnl-after-fix.ts` - Update to use correct formula
- `wallet_pnl.sql` or new table - Rebuild from trades_raw
- Documentation - Record solution and implementation
