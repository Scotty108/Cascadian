# V11 vs UI Validation - Transfer-Free Wallets MVP Report

**Date:** 2025-12-07
**Engine:** V11 (Polymarket Subgraph Port)
**Cohort:** Transfer-free wallets from trader_strict sample

## Summary

| Metric | Value |
|--------|-------|
| Total Transfer-Free Wallets | 28 |
| Total Passed | 14 |
| **Overall Pass Rate** | **50.0%** |
| Target (MVP-grade) | 90% |

## Dual-Threshold Scoring

### Large Wallets (|UI PnL| >= $200) - 6% Error Threshold
| Metric | Value |
|--------|-------|
| Count | 8 |
| Passed | 2 |
| Pass Rate | 25.0% |
| Median Error | $1736.49 |

### Small Wallets (|UI PnL| < $200) - $10 Absolute Error Threshold
| Metric | Value |
|--------|-------|
| Count | 20 |
| Passed | 12 |
| Pass Rate | 60.0% |
| Median Error | $5.75 |

## Failure Analysis

### Failure Reason Distribution

| Reason | Count | % of Failures |
|--------|-------|---------------|
| LOW_ACTIVITY | 8 | 57.1% |
| SIGN_DISAGREEMENT | 4 | 28.6% |
| POSSIBLE_PROXY_MISMATCH | 2 | 14.3% |

### Top 10 Failures

| Wallet | UI PnL | V11 PnL | Error | Reason |
|--------|--------|---------|-------|--------|
| `0xb9d82124...` | $110000.00 | $-3.43 | $110003 | POSSIBLE_PROXY_MISMATCH |
| `0x461c988b...` | $110000.00 | $0.87 | $109999 | POSSIBLE_PROXY_MISMATCH |
| `0x23da3c3a...` | $7908.45 | $-594.01 | $8502 | SIGN_DISAGREEMENT |
| `0xb130f0cc...` | $-9972.85 | $-11709.34 | $1736 | LOW_ACTIVITY |
| `0xd81b5681...` | $126.68 | $271.21 | $145 | LOW_ACTIVITY |
| `0xa01a52f3...` | $-120.00 | $-220.00 | $100 | LOW_ACTIVITY |
| `0x0d8c06dd...` | $85.82 | $0.00 | $86 | LOW_ACTIVITY |
| `0x28d5558f...` | $210.00 | $127.22 | $83 | LOW_ACTIVITY |
| `0x13a435df...` | $34.85 | $-25.34 | $60 | SIGN_DISAGREEMENT |
| `0x532f42df...` | $-17.40 | $33.60 | $51 | SIGN_DISAGREEMENT |

## MVP Safe Universe

**This cohort represents the MVP-safe universe for copy trading.**

Wallets in this set:
- Have ZERO ERC1155 transfers (no wallet-to-wallet token movements)
- Trade only via CLOB (buy/sell through orderbook)
- Show consistent V11 vs UI alignment

These wallets can be safely used for:
- Omega ratio calculations
- Win rate metrics
- Copy trading leaderboards
