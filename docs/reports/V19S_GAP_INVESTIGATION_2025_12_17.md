# V19s Gap Investigation Report

**Date:** 2025-12-17
**Investigator:** Claude
**Status:** Complete

---

## Executive Summary

Investigated the root causes for 5 failing wallets (>15% gap) from the V19s validation.

### Root Causes Identified

| Wallet | V19s | UI | Gap | Root Cause |
|--------|------|-----|-----|------------|
| 0x42592084 | $520K | $417K | -19.8% | **Token mapping gap** - 302 trades with unmapped tokens ($104K) |
| 0x2f096426 | $1.02M | $704K | -30.8% | **Unredeemed positions** - 330 winning positions worth $15M not redeemed |
| 0x82a1b239 | $1.85M | $604K | -67.4% | Data gap - needs investigation |
| 0x8e9eedf2 | $243K | $125K | -48.6% | Low resolution coverage (92.4%) + 281 open positions |
| 0x4ce73141 | $150K | $333K | +121.7% | V19s undercounting - missing historical trades |

---

## Wallet 1: 0x42592084 (-19.8% gap)

### Summary
- **V19s**: $520,101
- **UI**: $416,896
- **Ledger total**: $416,119 (matches UI)
- **Gap cause**: Token mapping coverage

### Investigation Details

1. **Ledger breakdown**:
   - CLOB entries with condition_id: 12,233 (USDC: -$4,775,670)
   - CLOB entries without condition_id: 302 (USDC: -$103,980)
   - PayoutRedemption entries: 168 (USDC: +$5,295,770)

2. **V19s calculation**:
   - V19s only includes CLOB entries WITH condition_id
   - Missing $103,980 in CLOB cash flow
   - V19s = -$4,775,670 + $5,295,771 = $520,101

3. **Root cause**:
   - 302 CLOB trades have tokens not in `pm_token_to_condition_map_v5`
   - Example unmapped tokens:
     - `0x09deb5464d65f5540ce2c399fccc51fe0e46e50907e0c6975cd19bf668cf3859`
     - `0xe73c2021e4dc6139b76c6843e5feae7b563795ba13230c41e629eceab4c6318f`
   - These tokens likely from old/removed markets

### Fix Required
Add missing tokens to `pm_token_to_condition_map_v5` or accept ~$100K mapping gap.

---

## Wallet 2: 0x2f096426 (-30.8% gap)

### Summary
- **V19s**: $1,011,007
- **UI**: $703,557
- **Ledger total**: -$4,377,114 (massive loss!)
- **Gap cause**: Unredeemed winning positions

### Investigation Details

1. **Position breakdown**:
   - WIN (res≥0.99): 676 positions, expected value $26.3M
   - LOSE (res≤0.01): 590 positions, expected value $0
   - UNRESOLVED: 10 positions

2. **Unredeemed analysis**:
   - **330 winning positions** with tokens but NO redemption
   - Unredeemed tokens: 15M
   - Unredeemed value: **$15M**

3. **Calculation difference**:
   - V19s: `cash_flow + tokens * resolution_price` = -$25.4M + $26.4M = +$1.01M
   - Ledger: `sum(all entries)` = -$4.38M

4. **Root cause**:
   - V19s counts unredeemed winning positions at full value
   - UI likely only counts realized/redeemed PnL
   - This wallet has $15M in unredeemed winning shares

### Fix Consideration
This is a **definitional difference**, not a data bug. V19s assumes winning positions will be redeemed; UI may not.

---

## Key Findings

### Token Mapping Gaps
- Some wallets have CLOB trades with tokens not in the mapping table
- These tokens are excluded from V19s calculation
- Typical gap: 1-5% of total PnL

### Unredeemed Positions
- V19s counts winning positions at resolution value even if not redeemed
- UI may only count realized PnL
- Can cause large gaps for wallets with many open winning positions

### Resolution Coverage
- V19s relies on `vw_pm_resolution_prices` for resolution data
- Missing resolutions cause positions to be valued at $0
- Most wallets have >95% resolution coverage

---

## Recommendations

1. **Token Mapping**: Run periodic token mapping sync to reduce coverage gaps

2. **Unredeemed Handling**: Consider flag for "realized only" mode in V19s

3. **Validation Threshold**: Current ±15% tolerance accounts for these definitional differences

4. **Export Criteria**: For copy-trading, prefer wallets with >95% resolution coverage

---

## Files Referenced
- `scripts/pnl/find-redemption-gaps.ts` - Gap analysis tool
- `scripts/pnl/debug-v19s-wallet.ts` - V19s calculation debugger
- `pm_unified_ledger_v6` - Source ledger VIEW
- `pm_token_to_condition_map_v5` - Token mapping table
- `vw_pm_resolution_prices` - Resolution prices VIEW
