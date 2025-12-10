# UI PnL Snapshot Audit

**Date:** 2025-12-07
**Snapshot:** polymarket_profile_live
**Fetched At:** 2025-12-07T02:10:58.323Z
**Status:** ✅ COMPLETE

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ OK | 96 | 96.0% |
| ⚠️  Nonexistent | 4 | 4.0% |
| ❌ Error | 0 | 0.0% |
| 🔍 Outlier | 0 | 0.0% |
| **Total** | **100** | **100.0%** |

---

## ✅ OK Wallets (96)

Successfully fetched with valid PnL data.

| Wallet | UI PnL |
|--------|--------|
| `0xc0fab651a924414627c18be715adcd92146f4f92` | +$130,000 |
| `0x461c988bf3938cb4d394766b3e9e9c53d580ec34` | +$110,000 |
| `0xb9d8212498245d4ef5b9266619357b284748d04b` | +$110,000 |
| `0x6352953c96866159aa635d157212573a61241445` | +$15,271.16 |
| `0x63681d492a4a5356c630a1ccb7a43066c3b9b88b` | +$8,000 |
| `0x23da3c3a38a41ad9da39f7cec2eb391954258bf5` | +$7,908.45 |
| `0x5a1df0546225c6ecca67c2c2eaae9dc221a8c5ba` | +$4,800 |
| `0x89c6ae77dd2e36895a7e4d8ecb31f91c76b482fc` | +$4,439.13 |
| `0x98a1ba5ae859c5d09a1495216040a8c3925cb3ea` | +$4,000 |
| `0xb68c76a0f7b26606f7494dca7e0157082a1beda5` | +$1,379.18 |
| ... | ... |
| *86 more wallets* | |

---

## ⚠️  Nonexistent Wallets (4)

These wallets show "anon" + $0 on Polymarket UI, indicating they don't exist or have no activity.

**Action:** Exclude from validation.

| Wallet | Error |
|--------|-------|
| `0xb1a970348a936ff2fe3002399a83d78706612a8d` | Profile does not exist (anon) |
| `0x1ba20d4314c1928e0a5d0302f7951b0c1d82eccd` | Profile does not exist (anon) |
| `0x37bec22c55bf32423641439398954139ba2370e5` | Profile does not exist (anon) |
| `0xc6455eedbfba4bf972322c2238b0bc3d9f02ec85` | Profile does not exist (anon) |

---

## Recommendations

### For Validation Work

1. **Exclude nonexistent wallets** from validation cohorts
2. **Retry error wallets** if critical to your test set
3. **Verify outliers manually** before using as truth

### Next Steps

1. Load snapshot into `pm_ui_pnl_benchmarks_v2` table
2. Use OK wallets (96) as primary truth set
3. Run V29 validation against this cohort

---

**Generated:** 2025-12-07T02:18:45.302Z
**Terminal:** Claude 1
**Tool:** `scripts/pnl/audit-ui-snapshot.ts`
