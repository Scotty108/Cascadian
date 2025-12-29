# Terminal 2 Copy Trading P&L Debrief
**Date:** 2025-12-23
**Focus:** CLOB API automation attempt + utility infrastructure

---

## Executive Summary

Terminal 2 investigated GPT's suggestion to use CLOB API `getMarket(conditionId)` for automatic token→winner mapping. **Result: CLOB API works but has inherent limitations** - it shows CLOB positions, not actual held tokens after redemptions/merges.

Created **three utility modules** to address recurring format/conversion issues that slowed down the investigation.

---

## CLOB API Investigation

### What We Tested

GPT suggested using CLOB API to eliminate ground truth requirement:
```typescript
const client = new ClobClient('https://clob.polymarket.com', 137);
const market = await client.getMarket('0x' + conditionId);
// Returns: { tokens: [{ token_id, outcome, winner, price }] }
```

### Scripts Created

| Script | Purpose | Result |
|--------|---------|--------|
| `fetch-clob-token-metadata.ts` | Test CLOB API | ✅ 27/27 markets resolved |
| `automated-pnl-via-clob.ts` | Full P&L via API | ❌ $274 error |
| `final-pnl-with-clob-api.ts` | With merges | ❌ $194 error |
| `check-split-only-tokens.ts` | Find untraded tokens | Found gap source |
| `debug-token-flow.ts` | Token lifecycle | Confirmed burn issue |

### Key Finding: CLOB Positions ≠ Actual Holdings

**Problem:** CLOB only tracks buys/sells. It doesn't know about:
1. **Redemptions** - burn tokens, CLOB still shows original position
2. **Merges** - burn tokens, CLOB still shows original position
3. **Split-only tokens** - tokens minted via split but never traded on CLOB

**Example from calibration wallet:**
```
CLOB shows:     139.82 in winner positions
Actually held:  334.02 (after accounting for non-CLOB activity)
Gap:            $194.20
```

### Conclusion

CLOB API is **useful for winner/loser detection** but **cannot replace ground truth calibration** for accurate P&L. The greedy optimization approach (Terminal 1) remains correct.

---

## Utility Modules Created

### 1. `lib/polymarket/normalizers.ts`

**Purpose:** Eliminate format conversion bugs that caused repeated issues.

| Issue | Solution |
|-------|----------|
| Address case sensitivity | `normalizeAddress()` → lowercase with 0x |
| tx_hash format (binary vs hex) | `normalizeTxHash()` → lowercase with 0x |
| condition_id (0x prefix) | `normalizeConditionId()` → 64 hex, no 0x |
| token_id (hex vs decimal) | `normalizeTokenId()` → decimal string |
| side (BUY/buy/0/1) | `normalizeSide()` → 'buy' or 'sell' |
| amounts (raw vs USDC) | `toUsdc()`, `rawToUsdc()` → divide by 1e6 |

**Usage:**
```typescript
import { normalizeAddress, normalizeSide, toUsdc } from '@/lib/polymarket/normalizers';

const wallet = normalizeAddress(rawWallet);  // '0x925ad88d...'
const side = normalizeSide('BUY');           // 'buy'
const amount = toUsdc(136650000);            // 136.65
```

### 2. `lib/polymarket/vocabulary.ts`

**Purpose:** Document field name variations across tables.

| Canonical | pm_trader_events_v2 | pm_ctf_events | pm_erc1155_transfers |
|-----------|---------------------|---------------|----------------------|
| wallet | `trader_wallet` | `user_address` | `from_address` |
| token_id | `token_id` | `token_id` | `id` |
| amount | `usdc_amount` | `amount_or_payout` | `value` |
| tx_hash | `transaction_hash` (binary) | `tx_hash` | `transaction_hash` |

**Pre-built SQL patterns:**
```typescript
import { SqlPatterns } from '@/lib/polymarket/vocabulary';

const query = SqlPatterns.clobDeduped(wallet);      // Deduped CLOB trades
const query = SqlPatterns.netPositions(wallet);     // Net positions
const query = SqlPatterns.redemptions(wallet);      // CTF redemptions
const query = SqlPatterns.splitsViaTxHash(wallet);  // Splits via tx join
```

### 3. `lib/pnl/validationGuards.ts`

**Purpose:** Safety catches before running P&L calculations.

**Validates:**
- Unmapped tokens (missing condition_id)
- Missing outcome assignments
- Duplicate event IDs (CLOB dedup check)
- Missing resolution data
- Invalid position values (NaN, Infinity)

**Usage:**
```typescript
import { validatePnlInputs, guardPnlInputs, PnlValidationError } from '@/lib/pnl/validationGuards';

// Option 1: Check and handle
const result = validatePnlInputs({ walletAddress, tokens, positions });
if (!result.isValid) {
  console.log(formatValidationResult(result));
  return;
}

// Option 2: Guard (throws on invalid)
try {
  guardPnlInputs(data);
} catch (e) {
  if (e instanceof PnlValidationError) {
    console.log(e.validationResult.errors);
  }
}
```

### 4. Updated `lib/pnl/index.ts`

All utilities now exported from main PnL module:
```typescript
import {
  // Normalizers
  normalizeAddress, normalizeTokenId, toUsdc, normalizeSide,

  // Validation
  validatePnlInputs, guardPnlInputs, PnlValidationError,

  // Engine
  computeWalletActivityPnlV3,
} from '@/lib/pnl';
```

---

## Files Created/Modified

### New Files
```
lib/polymarket/normalizers.ts      # Data format standardization
lib/polymarket/vocabulary.ts       # Field name reference + SQL patterns
lib/pnl/validationGuards.ts        # Safety checks for PnL
```

### Modified Files
```
lib/pnl/index.ts                   # Added exports for new utilities
```

### Investigation Scripts (in scripts/copytrade/)
```
fetch-clob-token-metadata.ts       # CLOB API test
automated-pnl-via-clob.ts          # Full P&L via API
automated-pnl-corrected.ts         # Attempted fix
final-pnl-with-clob-api.ts         # With merges included
check-split-only-tokens.ts         # Untraded token analysis
check-unresolved-markets.ts        # Resolution check
debug-token-flow.ts                # Token lifecycle debug
debug-held-value-discrepancy.ts    # Gap analysis
check-unlinked-tokens.ts           # Token linkage check
```

---

## Recurring Issues Addressed

| Issue | Root Cause | Solution |
|-------|------------|----------|
| Case mismatch in wallet addresses | Polygon case-insensitive but stored differently | `normalizeAddress()` |
| tx_hash join failures | Binary vs hex format, 0x prefix | `normalizeTxHash()` + `clickhouseTxHashSql()` |
| Token ID lookup failures | Decimal vs hex format | `normalizeTokenId()` |
| Side field confusion | 'BUY'/'buy'/0/1 variations | `normalizeSide()` |
| Amount unit confusion | Raw integers vs USDC decimals | `toUsdc()`, `rawToUsdc()` |
| Field name confusion | trader_wallet vs user_address | `FieldNames` constants |
| Unmapped tokens in P&L | No validation before calc | `validateTokenMappings()` |
| Duplicate events in CLOB | pm_trader_events_v2 dupes | `checkEventDuplicates()` |

---

## Key Learnings

1. **CLOB API limitations**: Shows trade history, not actual token holdings after burns
2. **tx_hash is the key join**: Links CLOB trades → CTF splits → condition_id
3. **Greedy optimization works**: Terminal 1's approach is correct for calibration
4. **Mappings are per-condition**: Once derived, all wallets benefit
5. **Standardize at boundaries**: Normalize data as early as possible

---

## Recommended Next Steps

1. **Use normalizers everywhere**: Import from `@/lib/polymarket/normalizers` at data boundaries
2. **Add validation guards**: Call `guardPnlInputs()` before any P&L calculation
3. **Use SQL patterns**: Import from `vocabulary.ts` for consistent queries
4. **Consider CLOB API for winner detection only**: Don't use for position tracking

---

## Terminal 1 Cross-Reference

Terminal 1 completed:
- ✅ Greedy optimization for token→condition mapping
- ✅ Inserted 54 mappings into `pm_token_to_condition_patch`
- ✅ Verified P&L at $0.62 error

Terminal 2 completed:
- ✅ Investigated CLOB API automation (found limitations)
- ✅ Created normalizer utilities
- ✅ Created vocabulary reference
- ✅ Created validation guards

**Combined outcome:** P&L formula validated, infrastructure in place for production use.
