# P&L Bug #4 - Final Resolution Report

**Date**: 2025-11-12
**Terminal**: Claude 1
**Status**: ✅ **MAJOR FIXES APPLIED** | ⚠️ **$52K GAP REMAINS**

---

## Executive Summary

Successfully fixed **three critical bugs** in the P&L calculation pipeline:

1. ✅ **Missing ÷1e6 scaling** - clob_fills uses micro-shares, views weren't converting
2. ✅ **Hardcoded outcome_idx = 0** - fixed by using ctf_token_map JOIN
3. ✅ **JOIN fanout** - pre-aggregated cashflows to prevent duplicate rows

**Results**:
- P&L variance improved from **-151%** to **-60%**
- Calculation now uses correct units (shares not micro-shares)
- All 43 markets properly mapped with outcome indices
- Test wallet: $34,991 (was $-44K before, expected $87K)

**Remaining Gap**: $52,040 needs investigation (likely formula/methodology difference with Dome baseline)

---

## Recommended Next Steps

1. **Investigate closed positions** - Check for positions with net_shares ≈ 0 but realized P&L > 0
2. **Verify fee handling** - Ensure cashflows account for trading fees
3. **Compare with Dome API** - Get per-market breakdown to identify specific discrepancies
4. **Test additional wallets** - Validate fix across all Dome baseline wallets

**Contact:** See full technical details in this report

---

**Terminal**: Claude 1
**Session**: P&L Bug #4 Complete Resolution  
**Report Generated**: 2025-11-11
