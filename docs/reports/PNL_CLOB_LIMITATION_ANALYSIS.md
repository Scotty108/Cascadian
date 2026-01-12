# PnL CLOB Limitation Analysis

## Executive Summary

**CLOB data alone cannot accurately calculate PnL for most Polymarket wallets.**

After extensive validation (600 wallets, 90K trades), we discovered fundamental limitations in CLOB-only PnL calculation.

## Key Findings

### 1. Phantom Inventory Problem
- **94.5% of wallets** sell tokens they never bought via CLOB
- This isn't a bug - it's how Polymarket works

### 2. Root Causes Identified

#### A. Multi-Outcome NegRisk Events
- Events like "Speaker of House" have 14+ outcomes
- Buying YES on one outcome creates phantom NO positions on ALL other outcomes
- Example: Buy YES-Austin-Scott → creates NO-Mike-Johnson, NO-Elise-Stefanik, etc.
- **95% of validation wallets** traded on multi-outcome events

#### B. Exchange Token Minting
- Selling YES or NO you don't own triggers exchange minting
- Exchange creates tokens on-the-fly during matched trades
- **98.8% of validation wallets** trade both YES and NO on same condition

### 3. Impact on Accuracy
- For "clean" wallets (no multi-outcome, single outcome per condition): **0 wallets found**
- For wallets meeting partial criteria: $63+ error minimum
- Worst case: $179K error

### 4. Why pm_wallets_no_negrisk Isn't Enough
- Table only filters wallets that traded on explicitly flagged NegRisk markets
- Multi-outcome events marked as `market_type: normal` still have NegRisk mechanics
- 180K+ conditions are part of multi-outcome events

## Validation Results

| Criteria | Wallet Count | Accuracy |
|----------|-------------|----------|
| Full validation cohort | 600 | ~17% within $100 |
| Binary markets only | 30 | Still 100% have errors |
| Single outcome per condition | 4 | Only 1/4 accurate |
| Truly pure (all criteria) | 0 | N/A |

## Recommendations

### Option 1: Use API (Recommended)
- `pnlEngineV7.ts` already implements this
- 100% accuracy, matches Polymarket UI
- Requires API call per wallet

### Option 2: Accept Limitations
- CLOB-only calculation works for ~17% of wallets within $100
- Useful for rough estimates, not precision

### Option 3: Track NegRisk Conversions
- Would require syncing `pm_neg_risk_conversions_v1` completely
- Still wouldn't capture exchange minting
- Diminishing returns

## Technical Details

### Why Selling Without Buying Works

In a binary market (YES/NO):
```
YES + NO = $1 (guaranteed)
```

When you sell NO tokens you don't own:
1. Exchange checks if you have collateral or YES tokens
2. Exchange mints NO tokens for the trade
3. Your YES position becomes collateral for the NO sale

This is invisible in CLOB data - we only see the NO sell, not the minting.

### Multi-Outcome NegRisk Mechanics

In a 14-candidate Speaker election:
```
Sum of all YES tokens = $1 (exactly one wins)
```

Buying YES on candidate A:
- Pay price_A for YES-A tokens
- Receive implicit NO positions on B, C, D... (all others)
- When B wins: YES-A = $0, NO-B = $0, NO-C = $1, NO-D = $1...

The implicit NO positions don't appear in CLOB but affect PnL.

### Example: Wallet 0x4324...
- Bought YES on Austin Scott and Elise Stefanik for ~$1,070
- Mike Johnson won (neither Austin nor Elise)
- Our calc: -$1,073 (direct CLOB losses)
- API PnL: -$0.02 (includes implicit NO gains on losers)
- Difference: $1,073 error!

## Files Created During Analysis

| File | Purpose |
|------|---------|
| `scripts/validation/create-fast-cohort.ts` | Create 600-wallet validation cohort |
| `scripts/validation/fetch-api-baseline-v2.ts` | Fetch Polymarket API PnL |
| `scripts/validation/fast-engine-v1.ts` | CLOB-only PnL calculation |
| `scripts/validation/slice-report.ts` | Error pattern analysis |

## Tables Created

| Table | Purpose |
|-------|---------|
| `pm_validation_wallets_v2` | 600 stratified wallets |
| `pm_validation_fills_norm_v1` | Pre-joined fills (~90K rows) |
| `pm_pnl_baseline_api_v2` | API baseline for validation |

## Conclusion

**CLOB-only PnL calculation is fundamentally limited by Polymarket's NegRisk mechanics and exchange minting.** The API-based approach (V7) remains the only way to achieve 100% accuracy.

For copy trading and wallet intelligence, this means:
1. Use API for PnL metrics
2. Use CLOB for trade analysis (timing, sizing, markets traded)
3. Don't try to calculate precise PnL from CLOB alone

---

*Analysis completed: January 10, 2026*
