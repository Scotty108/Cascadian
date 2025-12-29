# Economic Parity P&L Formula

**Status:** In Progress (Double-count bug fixed)
**Date:** 2025-12-23
**Note:** Earlier -$86 "validation" was against buggy double-counting formula

---

## The Formula

```
P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
```

### Components

| Component | Source | Description |
|-----------|--------|-------------|
| **Sells** | CLOB trades | Total USDC received from selling tokens |
| **Redemptions** | CTF PayoutRedemption | USDC from redeeming winning tokens |
| **Buys** | CLOB trades | Total USDC spent buying tokens |
| **SplitCost** | CTF PositionSplit (via tx_hash) | USDC spent to create YES+NO token pairs |
| **HeldValue** | Positions × resolution price | Value of unredeemed tokens at resolution |

---

## Why This Formula Works

### 1. Cash-Flow Basis
The formula tracks actual USDC movement:
- **IN:** Sells + Redemptions
- **OUT:** Buys + SplitCost
- **PAPER GAIN:** HeldValue (tokens held at resolution)

### 2. Why Merges Are Excluded
Merges return USDC by burning YES+NO pairs. But:
- Split cost already accounts for the USDC that created those tokens
- Including merges would double-count the value
- The merge value is implicitly captured in reduced HeldValue

### 3. Split Cost via tx_hash Join
PositionSplit events are recorded under the **Exchange contract**, not the user wallet.
We join CLOB trades to CTF events by transaction hash to attribute splits.

---

## Double-Count Bug Fix (2025-12-23)

The original formula double-counted redemptions:
1. Redemptions captured as cash received
2. SAME tokens also counted in HeldValue (unredeemed position value)

**Fix:** Reduce net positions by redemption amounts (up to current balance).

**Result:** Sign accuracy improved (bc97 wallet flipped from +$4,243 to -$720).

## Current Validation State

| Wallet | Our P&L | Polymarket UI | Sign | Split Coverage |
|--------|---------|---------------|------|----------------|
| 0x925a | -$193.59 | -$31.05 | ✓ | 85.9% |
| 0xbc97 | -$720.80 | -$30.29 | ✓ | 0.4% ⚠️ |
| 0x2cf9 | -$6,255.96 | -$607.67 | ✓ | 78.4% |

**Key insight:** Polymarket UI shows a different metric (likely UI-specific performance).
For copy trading, we prioritize **sign accuracy** and **relative ranking** over exact match.

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/pnl/economicParityPnl.ts` | Economic parity P&L engine |
| `scripts/copytrade/polymarket-style-pnl.ts` | CLI tool for single wallet P&L |
| `scripts/copytrade/simple-batch-pnl.ts` | Batch P&L calculation |
| `pm_token_to_condition_patch` | Greedy-optimized token mappings |

---

## What NOT to Do

1. **Don't add merges** - Double-counts USDC
2. **Don't use subgraph engine for economic parity** - Position tracking differs
3. **Don't use 0.5 mark-to-market** - Only use resolution prices (0 or 1)
4. **Don't include ERC-1155 transfers** - Not needed for CLOB-based calculation

---

## Token Mapping

For tokens without Gamma API mappings (15-minute crypto markets):
1. Correlate tokens to conditions via tx_hash (CLOB trade → CTF split)
2. Use greedy optimization to determine outcome_index
3. Store in `pm_token_to_condition_patch` table

---

## Next Steps

1. Run `simple-batch-pnl.ts --limit=200` for broader validation
2. Validate known wallets (Holliewell, pb7)
3. Build cohort ranking pipeline using this formula
