# UI PnL Snapshot Audit

**Date:** 2025-12-07
**Snapshot:** polymarket_profile_live
**Fetched At:** 2025-12-07T00:53:38.685Z
**Status:** ✅ COMPLETE

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ OK | 42 | 84.0% |
| ⚠️  Nonexistent | 8 | 16.0% |
| ❌ Error | 0 | 0.0% |
| 🔍 Outlier | 0 | 0.0% |
| **Total** | **50** | **100.0%** |

---

## ✅ OK Wallets (42)

Successfully fetched with valid PnL data.

| Wallet | UI PnL |
|--------|--------|
| `0x7724f6f8023f40bc9ad3e4496449f5924fa56deb` | +$170,000 |
| `0x17b4aa863bf1add299f3ece1a54a9bf19cf44d48` | +$98,000 |
| `0x688beacb04b6b329f38e5da04c212e5c3d594fe1` | +$95,000 |
| `0x78e3e885e0924a3be4d3ac2501815b6b5fa1c585` | +$10,000 |
| `0xf118d0d18e1762ed3ebc212ced3bbbafe72a1f58` | +$7,842.7 |
| `0x2e41d5e1de9a072d73fd30eef9df55396270f050` | +$7,222.06 |
| `0xdf933b45bf02e6f10002da22ea32a7cff08fbdc8` | +$5,000 |
| `0xa6f7075f940a40a2c6cd8c75ab55a2138351b476` | +$4,200 |
| `0x4d6d6fea2dab70681572e616e90d4b0ffefe1ba1` | +$3,791.67 |
| `0x7a3051610fed486c6f21e04a89bddaf22dfc8abd` | +$2,439.59 |
| ... | ... |
| *32 more wallets* | |

---

## ⚠️  Nonexistent Wallets (8)

These wallets show "anon" + $0 on Polymarket UI, indicating they don't exist or have no activity.

**Action:** Exclude from validation.

| Wallet | Error |
|--------|-------|
| `0xe63e39b42207672238a771f2f06fbfbdd91592c6` | Profile does not exist (anon) |
| `0x2259150773c3e3da594b2791c841c6cac575f4a0` | Profile does not exist (anon) |
| `0xc1fc2f9e9e5f6d681873d36cf7af36a26d80ece5` | Profile does not exist (anon) |
| `0xdc8f10db32acc91c3bb06f9d4432a76b6a1df1ec` | Profile does not exist (anon) |
| `0x94a2a056149ba890c6f179188852eba0cbced8df` | Profile does not exist (anon) |
| `0xfa85d8abc01bf06a7cadf9fc464e941d8e73ab19` | Profile does not exist (anon) |
| `0xfa35a0d581b0788c513f98f505c9885f3486646e` | Profile does not exist (anon) |
| `0x4dacffd6ac6dcfc53ebfcdd5ce28691daa5f571e` | Profile does not exist (anon) |

---

## Recommendations

### For Validation Work

1. **Exclude nonexistent wallets** from validation cohorts
2. **Retry error wallets** if critical to your test set
3. **Verify outliers manually** before using as truth

### Next Steps

1. Load snapshot into `pm_ui_pnl_benchmarks_v2` table
2. Use OK wallets (42) as primary truth set
3. Run V29 validation against this cohort

---

**Generated:** 2025-12-07T01:40:47.143Z
**Terminal:** Claude 1
**Tool:** `scripts/pnl/audit-ui-snapshot.ts`
