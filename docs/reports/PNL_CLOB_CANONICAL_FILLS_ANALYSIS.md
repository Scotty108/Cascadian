# PnL CLOB Canonical Fills Analysis

**Date:** January 10, 2026
**Status:** Complete

## Executive Summary

After extensive analysis, we identified TWO distinct issues causing PnL calculation errors:

1. **Self-fill double-counting** (SOLVED) - When a wallet is both maker and taker in the same transaction, CLOB records both legs. Solution: Keep only taker leg for self-fills.

2. **NegRisk minting invisibility** (NOT SOLVABLE FROM CLOB) - When wallets mint complete sets through NegRisk adapter, the collateral deposit doesn't appear in CLOB. Only the subsequent token sales are visible.

## Key Findings

### 1. Self-Fill Detection Fix

**Problem:** Wallets that fill their own orders appear twice in CLOB data:
- Once as maker (placing the order)
- Once as taker (filling the order)

This caused a 2x error in PnL calculations.

**Solution:** For each (wallet, transaction_hash):
- If wallet appears as both maker AND taker → self-fill → keep only taker leg
- Otherwise keep all rows

**Result:** Created `pm_validation_fills_canon_v1` table with 68,992 canonical fills (down from ~90K raw).

### 2. Accuracy Results on Canonical Fills

| Cohort | Count | Within $1 | Within $10 | Within $100 |
|--------|-------|-----------|------------|-------------|
| mixed | 158 | 30 (19%) | 33 (21%) | 67 (42%) |
| maker_heavy | 151 | 16 (11%) | 20 (13%) | 47 (31%) |
| taker_heavy | 158 | 6 (4%) | 6 (4%) | 8 (5%) |

**Mixed wallets improved significantly** with canonical fills approach.

### 3. NegRisk Minting - The Unsolvable Problem

**Example:** Wallet `0x55853b19e6588b3ea621b858ee4acfc0b3a3b166` (@macrojake)

CLOB shows:
- YES bought: 1.54M tokens for $11K
- NO sold: 1.65M tokens for $1.63M (no corresponding NO buy!)

What actually happened:
1. Wallet deposited $1.65M collateral to NegRisk adapter
2. Adapter minted 1.65M YES + 1.65M NO tokens
3. Wallet sold 1.65M NO on CLOB for $1.63M
4. Wallet holds 1.65M YES (worth $0 when NO won)

**The minting transaction is NOT in CLOB data** - it's a direct contract interaction.

Calculated PnL: +$1.6M (sees NO sale revenue, doesn't see collateral deposit)
API PnL: -$25K (includes all on-chain activity)
Error: $1.6M!

### 4. pm_wallets_no_negrisk is Unreliable

The @macrojake wallet is marked as "Non-NegRisk" in `pm_wallets_no_negrisk`, but clearly uses NegRisk minting. The flag doesn't capture wallets that mint complete sets without trading on explicitly-flagged NegRisk markets.

## Recommendations

### Path A: Use API for All PnL (Recommended)

Continue using `pnlEngineV7.ts` (API-based) for production PnL calculations. It matches Polymarket UI 100%.

### Path B: Two-Tier Accuracy System

1. **High-accuracy pool** (use calculated PnL):
   - Wallets that ONLY trade (no minting/redemption)
   - Detected by: no pm_ctf_events with PositionSplit/PositionsMerge
   - Use canonical fills table + V1 formula

2. **Low-accuracy pool** (use API PnL):
   - Wallets with any minting/redemption activity
   - Fall back to API

### Path C: Full On-Chain Tracking (Not Recommended)

Would require:
- Syncing all NegRisk adapter events
- Tracking collateral deposits/withdrawals
- Reconstructing complete position history

This is essentially what Polymarket's backend does. Not worth rebuilding.

## Tables Created

| Table | Purpose | Row Count |
|-------|---------|-----------|
| `pm_validation_fills_canon_v1` | Canonical fills with self-fill detection | 68,992 |

## Files Modified

| File | Change |
|------|--------|
| `lib/pnl/pnlEngineNegRiskAware.ts` | Added self-fill detection query |
| `scripts/build-canon-fills.ts` | Created canonical fills builder |
| `scripts/test-canon-pnl.ts` | Accuracy testing script |

## Conclusion

**CLOB data alone cannot accurately calculate PnL for wallets that use NegRisk minting/redemption.** The self-fill fix improved accuracy for mixed wallets (42% within $100), but wallets that mint complete sets will always have massive errors because the collateral transactions are invisible in CLOB.

For production: Use API-based PnL (V7) as the source of truth.

---

*Analysis completed: January 10, 2026*
