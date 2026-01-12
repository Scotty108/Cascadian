# PnL Engine V1 - Complete Discrepancy Analysis

**Date:** 2026-01-07
**Purpose:** Document ALL known discrepancies to guide TDD-driven fix

---

## Executive Summary

PnL Engine V1 works perfectly for wallets that only trade via CLOB (no splits/transfers).
However, it **overcounts profit** for wallets that:
1. Use bundled splits (deposit USDC → get YES+NO → sell one side)
2. Receive tokens via ERC1155 transfers
3. Sell tokens they never bought via CLOB

**Root Cause:** Missing cost basis for tokens acquired outside CLOB trades.

---

## All Known Discrepancy Wallets

### Category 1: Bundled Split Users (OVERSELL Pattern)

| Wallet | UI PnL | Engine PnL | Delta | Pattern |
|--------|--------|------------|-------|---------|
| 0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e | $57.71 | $314.26 | +447% | Copy-trading bot (Pond) |
| 0x44de2a52d8d2d3ddcf39d58e315a10df53ba9c08 | ~$416K | ~$500K+ | ~20% | BlueHorseshoe86 - 119K tokens oversold |
| DeRonin wallet | -27% delta | | | OVERSELL on Zama/Lighter FDV outcomes |
| tumi wallet | | | -25% | Likely OVERSELL |
| 0xUhtred wallet | | | +58% | Needs investigation |

### Category 2: Working Correctly (CLOB-Only)

| Wallet | UI PnL | Engine PnL | Status |
|--------|--------|------------|--------|
| 0xf918977ef9d3f101385eda508621d5f835fa9052 | $1.16 | $1.16 | ✅ EXACT |
| 0x105a54a721d475a5d2faaf7902c55475758ba63c | -$12.60 | -$12.60 | ✅ EXACT |
| 0x2e4a6d6dccff351fccfd404f368fa711d94b2e12 | $1,500.00 | $1,500.00 | ✅ EXACT |
| 0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc | -$47.19 | -$47.19 | ✅ EXACT |
| 0x94fabfc86594fffbf76996e2f66e5e19675a8164 | -$73.00 | -$73.00 | ✅ EXACT |
| 0x583537b26372c4527ff0eb9766da22fb6ab038cd | -$0.01 | -$0.01 | ✅ EXACT |
| 0x8a8752f8c1b6e8bbdd4d8c47d6298e3a25a421f7 | $4,916.75 | $4,916.75 | ✅ EXACT |
| 3w21binFf (0x99d14ecb...) | -$2,429.89 | -$2,429.88 | ✅ EXACT |
| Mistswirl (0x29f8ad6b...) | -$1,470.50 | -$1,470.50 | ✅ EXACT |

---

## The OVERSELL Problem Explained

### What Happens

```
1. User deposits $100 USDC via split
2. User receives: 100 YES tokens + 100 NO tokens
3. User sells 100 NO tokens for $95 on CLOB
4. User keeps 100 YES tokens (cost basis: $50 from split)

Our Engine Sees:
- CLOB sell: +$95 proceeds
- No buy cost recorded (split not in CLOB)
- Net: +$95 "profit" (WRONG!)

Reality:
- Split cost: $100 total ($50 per outcome)
- NO outcome: sold for $95, cost $50 → PnL: +$45
- YES outcome: cost $50, value depends on resolution
```

### Detection Pattern

```sql
-- If sold > bought for ANY outcome, this wallet has OVERSELL
SELECT
  condition_id,
  outcome_index,
  sumIf(tokens, side='buy') as bought,
  sumIf(tokens, side='sell') as sold,
  sold - bought as oversell_tokens
FROM trades
GROUP BY condition_id, outcome_index
HAVING sold > bought  -- This is the OVERSELL flag
```

---

## Solution: Infer Split Cost from Oversold Positions

### The Fix

When `sold > bought` for an outcome:
```sql
oversell_tokens = sold - bought
split_cost = oversell_tokens * 0.50  -- Polymarket standard split price
adjusted_pnl = sell_proceeds - buy_cost - split_cost
```

### Why $0.50?

Polymarket splits work at $0.50 per token per outcome:
- Deposit $1 USDC → Get 1 YES + 1 NO token
- Each token costs $0.50 of your deposit
- This is the standard cost basis for split-acquired tokens

### Edge Cases

1. **Partial oversell**: Only apply split cost to the oversold portion
2. **Multiple outcomes**: Apply per-outcome, not per-market
3. **Resolution**: Still calculate settlement normally for tokens held

---

## TDD Test Cases Required

### Must Pass (Currently Working)
```typescript
// These 7 wallets MUST continue to match exactly
test('original wallet: $1.16', ...);
test('maker_heavy_1: -$12.60', ...);
test('maker_heavy_2: $1,500.00', ...);
test('taker_heavy_1: -$47.19', ...);
test('taker_heavy_2: -$73.00', ...);
test('mixed_1: -$0.01', ...);
test('mixed_2: $4,916.75', ...);
```

### Must Fix (Currently Broken)
```typescript
// Copy-trading wallet - currently overcounting
test('copy_trading: should be ~$57.71 not $314.26', ...);
```

### Scale Test
```typescript
// All 50 wallets from scale test
test('scale test: all within 5% of UI', ...);
```

---

## Implementation Plan

### Phase 1: Add Oversell Detection
- Query to detect oversell patterns per wallet
- Flag wallets with OVERSELL vs CLOB-only

### Phase 2: Implement Split Cost Inference
- When oversell detected, calculate implied split cost
- Apply $0.50 per token adjustment

### Phase 3: Validate
- Run against all 7 original wallets (must still match)
- Run against copy-trading wallet (should now match ~$57)
- Run against full 50-wallet scale test

---

## Files to Modify

| File | Change |
|------|--------|
| `lib/pnl/pnlEngineV1.ts` | Add split cost inference to query |
| `lib/pnl/pnlEngineV1.test.ts` | Create TDD test suite |
| `docs/READ_ME_FIRST_PNL.md` | Update with new formula |

---

## Key Insight

**The current engine is CORRECT for CLOB-only wallets.**

The fix is ADDITIVE - we need to:
1. Detect oversell patterns
2. Infer split cost for oversold tokens
3. Subtract from PnL

This should NOT break wallets that don't use splits (bought >= sold always).
