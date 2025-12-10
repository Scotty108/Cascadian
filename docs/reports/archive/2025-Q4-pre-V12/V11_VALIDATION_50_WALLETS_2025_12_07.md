# V11 Engine Validation Report - CORRECTED

**Date:** 2025-12-07 (Updated)
**Test Set:** 50 CLOB-only, transfer-free wallets

## CRITICAL FINDING: V11 IS CORRECT!

**The Dome benchmark data was WRONG, not V11!**

### Evidence

| Wallet | Polymarket UI Shows | V11 Calculates | Dome Benchmark Said |
|--------|---------------------|----------------|---------------------|
| 0x0465410f... | **-$6,706.97** | **-$6,706.98** ✓ | $13,463 ✗ |
| 0x199aefef... | **$1,718.11** | **$1,718** ✓ | $19,222 ✗ |

### Root Cause

The Dome benchmark captured **"Total Gains"** instead of **"Net Realized P/L"**:
- V11 Total Gain: $13,462.52 ← Matches Dome benchmark!
- V11 Total Loss: -$20,169.50
- V11 Net P/L: **-$6,706.98** ← Matches UI exactly!

### Why This Happened

1. **"Zombie" Active Positions**: Markets resolved but not yet redeemed
   - UI shows them as "Active" at 0¢ (not yet claimed)
   - V11 correctly applies resolution payouts (0 for losers)
   - Dome/benchmark only counted "closed" positions (the wins)

2. **V11 is MORE ACCURATE than Dome** because it includes:
   - All resolved positions (even unredeemed ones)
   - Both winning AND losing outcomes

### Validation

All 24 positions for wallet 0x0465410f have resolutions in our database:
- `[1,0]` = outcome 0 won
- `[0,1]` = outcome 1 won

V11 correctly applies these payouts to calculate true P/L.

---

## Original Report (for reference)

Ran 50-wallet validation comparing V11 engine variants after fixing token map drift:

| Engine | Passes | Rate | Notes |
|--------|--------|------|-------|
| **V11** | 4/50 | 8% | Base engine with price rounding |
| **V11b** | 6/50 | **12%** | Unbounded synthetic pair adjustment (best) |
| **V11c** | 4/50 | 8% | Bounded lot-level adjustment (too conservative) |

**Winner: V11b** with 12% pass rate

## Changes Made

### 1. Centralized Data Source Constants

Created `lib/pnl/dataSourceConstants.ts` as single source of truth:

```typescript
export const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';  // 400K+ tokens
export const UNIFIED_LEDGER_TABLE = 'pm_unified_ledger_v8_tbl'; // 347M rows
export const RESOLUTIONS_TABLE = 'pm_condition_resolutions';
export const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';
```

### 2. Updated Engines

All V11 variants now use centralized constants:
- `lib/pnl/uiActivityEngineV11.ts` - Updated queries to use `${TOKEN_MAP_TABLE}`, `${TRADER_EVENTS_TABLE}`, `${RESOLUTIONS_TABLE}`
- `lib/pnl/uiActivityEngineV11b.ts` - Added imports and updated queries
- `lib/pnl/uiActivityEngineV11c.ts` - Already using constants (verified)

## Detailed Results

### Pass/Fail by Wallet

| Wallet | Dome | V11 | V11b | V11c | Pairs |
|--------|------|-----|------|------|-------|
| 0x0465410f | $13,463 | -$6,707 | **$13,384 ✓** | $10,915 | 21 |
| 0x142f92b9 | $3,336 | $3,133 | $4,682 | **$3,402 ✓** | 1 |
| 0x199aefef | $19,222 | $1,718 | **$19,219 ✓** | $17,147 | 18 |
| 0x243692fe | $2,583 | -$30 | **$2,534 ✓** | $1,755 | 16 |
| 0x258a6d3f | $102,200 | **$102,200 ✓** | **$102,200 ✓** | **$102,200 ✓** | 0 |
| 0x2bb8d4aa | $6,546 | **$6,475 ✓** | **$6,641 ✓** | **$6,641 ✓** | 3 |
| 0xa2e512d8 | -$8,058 | -$8,976 | **-$7,755 ✓** | -$6,582 | 11 |
| 0xca979700 | $618 | **$618 ✓** | $1,219 | $1,208 | 2 |
| 0xd6ac95e2 | $977 | **$1,020 ✓** | $1,415 | $1,352 | 163 |
| 0xdab3b867 | $23,096 | -$419 | $31,497 | **$22,776 ✓** | 24 |

### Engine Win Analysis

- **V11 exclusive wins**: 0xca979700, 0xd6ac95e2
- **V11b exclusive wins**: 0x0465410f, 0x199aefef, 0x243692fe, 0xa2e512d8
- **V11c exclusive wins**: 0x142f92b9, 0xdab3b867
- **Shared wins (all three)**: 0x258a6d3f, 0x2bb8d4aa

## Analysis

### Why V11b Wins More

V11b applies synthetic pair credits globally to the position, which benefits wallets with:
- Many synthetic pairs (high pair count)
- Positions held to resolution (credit reduces cost basis → higher resolution profit)

### Why V11c Underperforms

V11c's lot-level credit application is too conservative:
- Only credits the matched quantity per lot
- Doesn't spread credit across the whole position
- Results in higher effective cost basis

### Problematic Wallets

Both variants severely overcorrect for high-activity wallets:

| Wallet | Dome | V11 | V11b | V11c | Pairs |
|--------|------|-----|------|------|-------|
| 0xe62d0223 | $71,046 | $76,334 | **$293,248** | $212,147 | 5,278 |
| 0x01cedeca | -$1,700 | -$1,578 | **$23,796** | $18,818 | 950 |

These wallets have thousands of synthetic pairs, causing massive overcorrection.

## Recommendations

### Short-term (For V1 Leaderboard)

1. **Use V11b as default** - Best overall pass rate
2. **Gate with behavioral filters**:
   - CLOB-only wallets
   - Transfer-free wallets
   - Closed positions only
   - |realized| >= $200
   - trade_count >= 10

3. **Flag overcorrection risk**:
   - Wallets with >500 synthetic pairs should be flagged
   - Consider capping adjustment at some threshold

### Medium-term (Accuracy Improvements)

1. **Proportional credit formula** for V11c:
   - Instead of exact match, credit proportionally: `credit = sell_usdc * (matchedQty / sell_qty)`
   - This might fix the under-crediting issue

2. **Multi-engine agreement confidence**:
   - If V11 and V11b agree within threshold → high confidence
   - If they disagree significantly → flag for manual review

### Long-term

1. **Investigate Dome's exact methodology** - What formula does Polymarket use?
2. **Build better synthetic pair detection** - Tag at ingestion time

## Files Modified

1. `lib/pnl/dataSourceConstants.ts` - NEW: Centralized table constants
2. `lib/pnl/uiActivityEngineV11.ts` - Updated to use centralized constants
3. `lib/pnl/uiActivityEngineV11b.ts` - Updated to use centralized constants
4. `lib/pnl/uiActivityEngineV11c.ts` - Verified using centralized constants

## Test Command

```bash
npx tsx scripts/pnl/compare-v11-variants.ts tmp/clob_50_wallets.json
```
