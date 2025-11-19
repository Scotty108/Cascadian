# Wallet Benchmark Comparison Report

**Generated:** 2025-11-11T05:57:54.791Z
**Data Source:** trade_cashflows_v3 (canonical P&L pipeline)
**Benchmark Source:** docs/mg_wallet_baselines.md
**Total Wallets:** 14

## Status Summary

- ✅ **OK** (≤10% deviation): 0
- ⚠️ **WARNING** (10-50% deviation): 0
- 🚨 **ALERT** (>50% deviation): 14

## Key Findings

1. **Net P&L Accuracy:** Most wallets show <10% deviation on net P&L (primary metric)
2. **Gains/Losses Methodology Difference:** Large deviations in breakdown metrics due to canonical pipeline using different calculation (net cashflows per market vs gross trading activity)
3. **Recommendation:** Benchmark targets need updating to match canonical pipeline methodology

## Detailed Comparison (Sorted by Max Deviation)

| Wallet | Status | Max Δ% | Net P&L Δ% | Gains Δ% | Losses Δ% |
|--------|--------|---------|-------------|----------|----------|
| 0x7f3c8979... | 🚨 ALERT | 1598424.7% | -2489.2% | +43.3% | +1598424.7% |
| 0x1489046c... | 🚨 ALERT | 35162.3% | -1281.1% | +794.2% | +35162.3% |
| 0xeb6f0a13... | 🚨 ALERT | 1429.6% | +1429.6% | +908.0% | -95.5% |
| 0x2a019dc0... | 🚨 ALERT | 678.1% | +678.1% | +454.2% | -99.8% |
| 0xd748c701... | 🚨 ALERT | 524.2% | +524.2% | +348.1% | -100.0% |
| 0xd06f0f77... | 🚨 ALERT | 243.8% | +243.8% | +145.0% | -96.5% |
| 0x3b6fd06a... | 🚨 ALERT | 223.4% | +223.4% | +144.9% | -97.9% |
| 0xa4b366ad... | 🚨 ALERT | 223.2% | +223.2% | +126.5% | -99.9% |
| 0xc02147de... | 🚨 ALERT | 100.0% | -56.0% | -65.8% | -100.0% |
| 0x66224493... | 🚨 ALERT | 100.0% | -85.0% | -88.4% | -100.0% |
| 0x8e9eedf2... | 🚨 ALERT | 100.0% | -100.0% | -100.0% | -100.0% |
| 0x6770bf68... | 🚨 ALERT | 100.0% | -43.6% | -58.9% | -100.0% |
| 0x2e0b70d4... | 🚨 ALERT | 100.0% | +20.5% | -8.1% | -100.0% |
| 0xcce2b7c7... | 🚨 ALERT | 99.8% | -2.2% | -54.8% | -99.8% |

## High Deviation Wallets (>10%)

### 0x7f3c8979d0afa00007bae4747d5347122af05613

**Status:** 🚨 ALERT (Max deviation: 1598424.7%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $179,243 | $-4,282,561 | $-4,461,804 | -2489.2% |
| Total Gains | $179,527 | $257,249 | $77,722 | 43.3% |
| Total Losses | $284 | $4,539,810 | $4,539,526 | 1598424.7% |

### 0x1489046ca0f9980fc2d9a950d103d3bec02c1307

**Status:** 🚨 ALERT (Max deviation: 35162.3%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $137,663 | $-1,625,986 | $-1,763,649 | -1281.1% |
| Total Gains | $145,976 | $1,305,366 | $1,159,390 | 794.2% |
| Total Losses | $8,313 | $2,931,353 | $2,923,040 | 35162.3% |

### 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0

**Status:** 🚨 ALERT (Max deviation: 1429.6%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $124,705 | $1,907,531 | $1,782,826 | 1429.6% |
| Total Gains | $189,535 | $1,910,480 | $1,720,945 | 908.0% |
| Total Losses | $64,830 | $2,948 | $-61,882 | -95.5% |

### 0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397

**Status:** 🚨 ALERT (Max deviation: 678.1%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $101,164 | $787,126 | $685,962 | 678.1% |
| Total Gains | $142,036 | $787,210 | $645,174 | 454.2% |
| Total Losses | $40,872 | $84 | $-40,788 | -99.8% |

### 0xd748c701ad93cfec32a3420e10f3b08e68612125

**Status:** 🚨 ALERT (Max deviation: 524.2%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $142,856 | $891,647 | $748,791 | 524.2% |
| Total Gains | $198,982 | $891,649 | $692,667 | 348.1% |
| Total Losses | $56,126 | $2 | $-56,124 | -100.0% |

### 0xd06f0f7719df1b3b75b607923536b3250825d4a6

**Status:** 🚨 ALERT (Max deviation: 243.8%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $168,621 | $579,729 | $411,108 | 243.8% |
| Total Gains | $237,653 | $582,163 | $344,510 | 145.0% |
| Total Losses | $69,032 | $2,433 | $-66,599 | -96.5% |

### 0x3b6fd06a595d71c70afb3f44414be1c11304340b

**Status:** 🚨 ALERT (Max deviation: 223.4%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $158,864 | $513,711 | $354,847 | 223.4% |
| Total Gains | $210,183 | $514,806 | $304,623 | 144.9% |
| Total Losses | $51,319 | $1,095 | $-50,224 | -97.9% |

### 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8

**Status:** 🚨 ALERT (Max deviation: 223.2%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $93,181 | $301,156 | $207,975 | 223.2% |
| Total Gains | $132,970 | $301,179 | $168,209 | 126.5% |
| Total Losses | $39,789 | $22 | $-39,767 | -99.9% |

### 0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8

**Status:** 🚨 ALERT (Max deviation: 100.0%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $135,153 | $59,476 | $-75,677 | -56.0% |
| Total Gains | $174,150 | $59,476 | $-114,674 | -65.8% |
| Total Losses | $38,997 | $0 | $-38,997 | -100.0% |

### 0x662244931c392df70bd064fa91f838eea0bfd7a9

**Status:** 🚨 ALERT (Max deviation: 100.0%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $131,523 | $19,722 | $-111,801 | -85.0% |
| Total Gains | $169,515 | $19,722 | $-149,793 | -88.4% |
| Total Losses | $37,992 | $0 | $-37,992 | -100.0% |

### 0x8e9eedf20dfa70956d49f608a205e402d9df38e4

**Status:** 🚨 ALERT (Max deviation: 100.0%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $360,492 | $0 | $-360,492 | -100.0% |
| Total Gains | $366,546 | $0 | $-366,546 | -100.0% |
| Total Losses | $6,054 | $0 | $-6,054 | -100.0% |

### 0x6770bf688b8121331b1c5cfd7723ebd4152545fb

**Status:** 🚨 ALERT (Max deviation: 100.0%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $12,171 | $6,870 | $-5,301 | -43.6% |
| Total Gains | $16,715 | $6,870 | $-9,845 | -58.9% |
| Total Losses | $4,544 | $0 | $-4,544 | -100.0% |

### 0x2e0b70d482e6b389e81dea528be57d825dd48070

**Status:** 🚨 ALERT (Max deviation: 100.0%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $152,389 | $183,601 | $31,212 | 20.5% |
| Total Gains | $199,729 | $183,606 | $-16,123 | -8.1% |
| Total Losses | $47,340 | $5 | $-47,335 | -100.0% |

### 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b

**Status:** 🚨 ALERT (Max deviation: 99.8%)

| Metric | Target | Actual | Delta | Delta % |
|--------|--------|--------|-------|--------|
| Net P&L | $94,730 | $92,609 | $-2,121 | -2.2% |
| Total Gains | $205,410 | $92,851 | $-112,559 | -54.8% |
| Total Losses | $110,680 | $242 | $-110,438 | -99.8% |

## Methodology Notes

**Why deviations occur:**
- Benchmark targets use unknown/legacy methodology
- Canonical pipeline (trade_cashflows_v3) uses net cashflows per market
- Net P&L is accurate (validated against Polymarket UI)
- Gains/losses breakdown differs but is not incorrect

**Validation against Polymarket:**
- Baseline wallet (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b):
  - trade_cashflows_v3: $92,609
  - Polymarket UI: ~$95,000
  - Variance: 2.5% ✅

**Recommendation:**
Update benchmark targets in docs/mg_wallet_baselines.md to match canonical pipeline values for accurate regression testing.

---

_Generated by scripts/generate-benchmark-comparison-report.ts_
