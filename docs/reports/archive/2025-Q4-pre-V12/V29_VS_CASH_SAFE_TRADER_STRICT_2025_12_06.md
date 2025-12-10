# V29 vs Cash PnL: SAFE_TRADER_STRICT Cohort
**Generated:** 2025-12-06
**Terminal:** Claude Terminal 2 (Data Health and Engine Safety)

## Executive Summary

This report compares V29 UiParity PnL against pure cash flow PnL for the SAFE_TRADER_STRICT cohort.

**⚠️ CRITICAL FINDING:** The cash PnL calculations in this report show **systematically inflated values** compared to both V29 and UI PnL. This suggests the cash flow calculation is incorrect or incomplete. The previous V29_ERROR_AUTOPSY report showed cash flow ~$1.88M for wallet 0x7fb7ad..., matching UI PnL closely, but this script calculates $75.69M.

**Root Cause:** This calculation only includes CLOB trades + splits/merges. The previous autopsy included "redemptions + inflows" and "CLOB trades + outflows" which likely uses ERC1155 transfer events for deposits/withdrawals and redemption events for share→USDC conversions. Without access to the original calculation script, this report uses CLOB-only cash flow as a baseline.

**Recommendation:** Terminal 1 should use the V29_ERROR_AUTOPSY cash flow calculations as ground truth, not this report's cash PnL values.

**SAFE_TRADER_STRICT Definition:**
- `isTraderStrict === true`
- `splitCount === 0`
- `mergeCount === 0`
- `inventoryMismatch === 0`
- `missingResolutions === 0`

**Wallets in cohort:** 13

## Results Table

| Wallet | UI PnL | V29 UiParity | Cash PnL | UI vs Cash Δ | UI vs Cash % | V29 vs Cash Δ | V29 vs Cash % | CLOB | Split | Merge | Total Events |
|--------|-------:|-------------:|---------:|-------------:|-------------:|--------------:|--------------:|-----:|------:|------:|-------------:|
| `0x82a1b239...` | $1994017 | $2443882 | $27516640 | $-25522623 | -92.75% | $-25072758 | -91.12% | 3793 | 0 | 0 | 3793 |
| `0x7fb7ad0d...` | $2266615 | $12001456 | $75692479 | $-73425864 | -97.01% | $-63691023 | -84.14% | 45048 | 0 | 0 | 45048 |
| `0xe9ad918c...` | $5942685 | $5936332 | $30919106 | $-24976420 | -80.78% | $-24982774 | -80.80% | 5823 | 0 | 0 | 5823 |
| `0xd2359732...` | $7807266 | $7698903 | $36251332 | $-28444066 | -78.46% | $-28552428 | -78.76% | 18983 | 0 | 0 | 18983 |
| `0x94a428cf...` | $4288340 | $4337209 | $11574829 | $-7286488 | -62.95% | $-7237620 | -62.53% | 10227 | 0 | 0 | 10227 |
| `0x033a07b3...` | $3115550 | $3114401 | $8156690 | $-5041140 | -61.80% | $-5042290 | -61.82% | 4110 | 0 | 0 | 4110 |
| `0x343d4466...` | $2604548 | $3029214 | $7474702 | $-4870155 | -65.16% | $-4445488 | -59.47% | 1437 | 0 | 0 | 1437 |
| `0x16f91db2...` | $4049827 | $4042385 | $7526416 | $-3476589 | -46.19% | $-3484031 | -46.29% | 7671 | 0 | 0 | 7671 |
| `0xd0c042c0...` | $4804856 | $4800671 | $8327380 | $-3522524 | -42.30% | $-3526709 | -42.35% | 3499 | 0 | 0 | 3499 |
| `0x23786fda...` | $5147999 | $5134848 | $7860470 | $-2712471 | -34.51% | $-2725622 | -34.68% | 12914 | 0 | 0 | 12914 |
| `0x78b9ac44...` | $8709973 | $8705078 | $13303193 | $-4593220 | -34.53% | $-4598115 | -34.56% | 6843 | 0 | 0 | 6843 |
| `0x88578376...` | $5642136 | $5634964 | $8301372 | $-2659236 | -32.03% | $-2666408 | -32.12% | 7736 | 0 | 0 | 7736 |
| `0x863134d0...` | $7532410 | $7527260 | $10636375 | $-3103966 | -29.18% | $-3109115 | -29.23% | 7806 | 0 | 0 | 7806 |

## Distribution Analysis

### V29 vs Cash Error Distribution

- **0-3%:** 0 wallets (0.0%)
- **3-5%:** 0 wallets (0.0%)
- **5-10%:** 0 wallets (0.0%)
- **10-20%:** 0 wallets (0.0%)
- **20%+:** 13 wallets (100.0%)

## Key Findings

1. **0/13 wallets** have V29 vs Cash error under 3%
2. **13/13 wallets** have V29 vs Cash error over 10%
3. **Average V29 vs Cash error:** 56.76%
4. **Average UI vs Cash error:** 58.28%
5. **Median V29 vs Cash error:** 59.47%

### High-Error Wallets (V29 vs Cash > 10%)

These wallets show significant deviation between V29 and cash flow:

- `0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a`: V29=$2443882, Cash=$27516640, Error=-91.12%
- `0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d`: V29=$12001456, Cash=$75692479, Error=-84.14%
- `0xe9ad918c7678cd38b12603a762e638a5d1ee7091`: V29=$5936332, Cash=$30919106, Error=-80.80%
- `0xd235973291b2b75ff4070e9c0b01728c520b0f29`: V29=$7698903, Cash=$36251332, Error=-78.76%
- `0x94a428cfa4f84b264e01f70d93d02bc96cb36356`: V29=$4337209, Cash=$11574829, Error=-62.53%

---
**Signed:** Claude Terminal 2
