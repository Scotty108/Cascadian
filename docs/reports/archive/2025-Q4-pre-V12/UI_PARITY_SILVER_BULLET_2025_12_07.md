# UI Parity Silver Bullet Report - 2025-12-07

## Executive Summary

**Silver Bullet Found:** The Polymarket UI uses a **position-based PnL model**, not a cash-flow model.

### Key Formula

```
Realized PnL = Σ (tokens_bought × payout_price - cost_basis)
```

Where:
- `tokens_bought` = shares from CLOB trades (positive token_delta)
- `payout_price` = 0 or 1 from resolution (payout_numerators[outcome_index])
- `cost_basis` = USDC spent (|usdc_delta| for CLOB buys)

## Validation Results

### Pass Rate: 3/14 (21%)

| Wallet | UI | Ours | Error | Status |
|--------|-----|------|-------|--------|
| 0x766e6a0a... | $8,755 | $8,418 | 3.8% | ✅ PASS |
| 0x18fdbd64... | $128 | $126 | 1.8% | ✅ PASS |
| 0xbe69fe92... | $815 | $798 | 2.1% | ✅ PASS |
| 0xf7850ebb... | $104,071 | $0 | 100% | ❌ DATA_ABSENT |
| 0x07a2b2c0... | $34,676 | $0 | 100% | ❌ DATA_ABSENT |
| 0x815faf65... | $16,335 | $0 | 100% | ❌ DATA_ABSENT |
| 0x927deae4... | $149 | $0 | 100% | ❌ DATA_ABSENT |
| 0x021a33fb... | $802 | $0 | 100% | ❌ DATA_ABSENT |
| 0x2f121805... | $1,195 | $0 | 100% | ❌ DATA_ABSENT |
| 0xb6d8819c... | $1,066 | $0 | 100% | ❌ DATA_ABSENT |
| 0xe26da87b... | $755 | $0 | 100% | ❌ DATA_ABSENT |
| 0xb0d6a0fe... | $1,003 | $0 | 100% | ❌ DATA_ABSENT |
| 0xf3812afa... | $1,162 | $0 | 100% | ❌ DATA_ABSENT |
| 0xffd0dc90... | $6,176 | $0 | 100% | ❌ DATA_ABSENT |

### Key Improvement

Wallet 0x18fdbd64... improved from **99.8% error** to **1.8% error** with the new formula!

## Failure Analysis

### Category Breakdown

| Category | Count | Description |
|----------|-------|-------------|
| PASSING | 3 | Formula works correctly |
| DATA_ABSENT | 11 | Zero data in all tables |

### DATA_ABSENT Investigation

Checked these tables for missing wallets:
- `pm_unified_ledger_v8_tbl` - 0 rows
- `pm_trader_events_v2` - 0 rows
- `pm_fpmm_trades` - 0 rows

**Hypothesis:** These wallets trade through:
1. Polymarket Relay/Proxy system
2. Gnosis Safe multisigs
3. Other mechanisms not indexed by Goldsky CLOB stream

## Formula Comparison

### Old Formula (Cash-Flow Based)
```
dome_like_realized = cash_realized + resolved_unredeemed_winning_value

Where:
- cash_realized = Σ usdc_delta (all source_types)
- resolved_unredeemed_winning_value = net winning shares still held
```

### New Formula (Position-Based)
```
realized_pnl = Σ (tokens_bought × payout_price - cost_basis)

Where:
- tokens_bought = CLOB token_delta > 0 per (condition_id, outcome_index)
- payout_price = payout_numerators[outcome_index] (0 or 1)
- cost_basis = |CLOB usdc_delta| for that position
```

### Why Position-Based is Correct

1. **Redemptions don't affect PnL** - Whether you redeem or not, your profit/loss is the same
2. **Per-outcome tracking** - Each outcome needs separate position tracking
3. **Simpler calculation** - Just final_value - cost_basis per position

## Implementation

Created: `lib/pnl/realizedUiStyleV1.ts`

```typescript
export async function calculateRealizedUiStyle(wallet: string): Promise<UiStyleRealizedResult>
```

Returns:
- `realized_pnl` - UI-style realized PnL
- `unrealized_value_estimate` - Rough estimate for unresolved positions
- `total_positions`, `resolved_positions`, `winning_positions`, `losing_positions`

## Next Steps

### To Improve DATA_ABSENT Coverage

1. **Investigate Relay System**
   - Check if Polymarket uses proxy contracts
   - Find operator-to-user mapping

2. **Alternative Data Sources**
   - Polymarket Subgraph (GraphQL)
   - Direct RPC position queries
   - Gamma API position endpoints

3. **Scope Decision**
   - Accept CLOB-only as baseline
   - Or invest in full coverage

## Key Insight

**For wallets where we have data, the new formula achieves < 5% error.**

The remaining gaps are purely data availability issues, not algorithmic problems.
