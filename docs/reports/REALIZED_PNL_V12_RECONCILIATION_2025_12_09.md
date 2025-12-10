# Realized PnL V12 Reconciliation Report

**Date:** 2025-12-09
**Engine:** V12 (production-grade realized-only)
**Wallets Tested:** 45

## Summary

| Metric | Value |
|--------|-------|
| Total Wallets | 45 |
| Pass (<5% error) | 40 |
| Fail (>=5% error) | 3 |
| Not Comparable (>50% unresolved) | 2 |
| Errors | 0 |
| **Raw Pass Rate** | **88.9%** |
| **Comparable Pass Rate** | **93.0%** (40/43) |

## Methodology

V12 calculates realized PnL using:
1. Source: `pm_trader_events_v2` (complete CLOB events)
2. Dedup: Query-time GROUP BY event_id with argMax pattern
3. Join: `pm_token_to_condition_map_v5` for condition/outcome mapping
4. Join: `pm_condition_resolutions` for payout info
5. Critical fix: Empty string payout_numerators treated as unresolved

**Formula:**
```
realized_pnl = usdc_delta + (token_delta * payout_norm)
WHERE payout_numerators IS NOT NULL
  AND payout_numerators != ''
  AND outcome_index IS NOT NULL
```

## Detailed Results

| Wallet | UI PnL | V12 Realized | Unresolved % | Error % | Verdict |
|--------|--------|--------------|--------------|---------|---------|
| 0x127a09d79f0edb3813... | $-1,069 | $-1,069 | 0.0% | 0.0% | pass |
| 0xbd63d4c614d365b835... | $7,890 | $7,890 | 0.0% | 0.0% | pass |
| 0x28ce5cafe96d33c909... | $302 | $302 | 0.0% | 0.0% | pass |
| 0xfbc0ef7366d8e4d860... | $803 | $803 | 35.7% | 0.0% | pass |
| 0xe114efcf1ac3fc88ee... | $56 | $56 | 1.6% | 0.0% | pass |
| 0x0869625aa0e044e96e... | $20,472 | $20,146 | 21.2% | 1.6% | pass |
| 0x1031db1ad6526d02c6... | $14,240 | $14,240 | 3.0% | 0.0% | pass |
| 0x08807dfd5308b0cf0e... | $9,814 | $9,814 | 4.2% | 0.0% | pass |
| 0x3d7efaab5b331e2118... | $4,713 | $4,713 | 0.0% | 0.0% | pass |
| 0xb2370e1f9a7d888b32... | $3,725 | $3,723 | 0.0% | 0.0% | pass |
| 0xd04f7c90bc6f15a29c... | $-21,562 | $-21,773 | 4.2% | 1.0% | pass |
| 0x61a10eac4392073969... | $-3,216 | $-3,556 | 5.1% | 10.6% | fail |
| 0x65b8e0082af7a5f533... | $-1,705 | $-1,705 | 0.0% | 0.0% | pass |
| 0xe527c444845592b89c... | $-1,742 | $-1,734 | 16.7% | 0.4% | pass |
| 0x0d89739863885ca3cc... | $7,425 | $7,432 | 3.5% | 0.1% | pass |
| 0xb0ed149445fa7719cf... | $-11,272 | $-11,272 | 0.0% | 0.0% | pass |
| 0xdc0803c3cd15b097ec... | $3,590 | $3,590 | 12.5% | 0.0% | pass |
| 0x89d76333f210697ce1... | $-7,255 | $-7,258 | 0.0% | 0.0% | pass |
| 0x3a8b8e32800686a04a... | $-6,572 | $-6,572 | 0.0% | 0.0% | pass |
| 0xe2d468102e231887b3... | $-4,323 | $-4,323 | 0.0% | 0.0% | pass |
| 0x7fae7b41c69744844b... | $-4,662 | $-4,662 | 0.0% | 0.0% | pass |
| 0xcc652abe2aa89ee82f... | $-2,287 | $-2,287 | 0.0% | 0.0% | pass |
| 0x7bf5b395c34d067743... | $312 | $311 | 0.2% | 0.3% | pass |
| 0x7acd2f93e6eeaa232e... | $-75,153 | $-73,028 | 0.7% | 2.8% | pass |
| 0xb1fa1aa03ce4f1f4e2... | $106,051 | $106,042 | 0.0% | 0.0% | pass |
| 0x9bcf7a2326fa387dcc... | $-12,158 | $-12,159 | 0.0% | 0.0% | pass |
| 0xf919981d00ddd432a8... | $-42,352 | $-42,353 | 0.0% | 0.0% | pass |
| 0xff6fd4302ae3bb7f8e... | $-53,428 | $-53,428 | 0.0% | 0.0% | pass |
| 0xee92e51827803eefc3... | $-1,806 | $-994 | 77.9% | 44.9% | not_comparable |
| 0x45b4d553a87b97aefc... | $2,719 | $2,708 | 1.8% | 0.4% | pass |
| 0x20bcdf5a9c7696d113... | $185,725 | $185,691 | 8.4% | 0.0% | pass |
| 0x24ae4e2bee4afbd04c... | $-2,002,324 | $-2,002,352 | 0.0% | 0.0% | pass |
| 0x3f2bebc298d6aac47c... | $389,837 | $389,834 | 0.0% | 0.0% | pass |
| 0x76ccd18183a933a4a8... | $85,275 | $85,274 | 0.0% | 0.0% | pass |
| 0x0ff5a33586e60560a4... | $-156,378 | $-156,382 | 0.0% | 0.0% | pass |
| 0xe1b40c6772bd0d5759... | $-37,538 | $0 | 100.0% | 100.0% | not_comparable |
| 0xd57057c9cb6223ca3c... | $5,610 | $5,610 | 0.0% | 0.0% | pass |
| 0xda647386ce953f0d95... | $-4,796 | $-5,014 | 2.5% | 4.5% | pass |
| 0xc60437e21520ddb053... | $-31,376 | $-26,711 | 9.0% | 14.9% | fail |
| 0x37e73a3b6130c8a836... | $-64,911 | $-64,912 | 0.0% | 0.0% | pass |
| 0xc48e3194036e417190... | $-63,072 | $-63,071 | 4.2% | 0.0% | pass |
| 0xbc296b625eb16033b3... | $8,360 | $8,359 | 0.0% | 0.0% | pass |
| 0x40a24ce1ff7eb4575b... | $840 | $-1,369 | 30.0% | 263.0% | fail |
| 0xa3a6fa49a39a4bf84c... | $51,448 | $51,448 | 0.0% | 0.0% | pass |
| 0x7899cf94386b13e409... | $-44,885 | $-44,887 | 0.0% | 0.0% | pass |

## Observations

### Wallets Not Comparable (>50% Unresolved)

These wallets have significant open positions and should not be compared for realized-only metrics:

- `0xee92e51827803eefc3...` - 77.9% unresolved
- `0xe1b40c6772bd0d5759...` - 100.0% unresolved

### Failures Analysis

- `0x61a10eac4392073969...` - UI=$-3216, V12=$-3556, Error=10.6%
- `0xc60437e21520ddb053...` - UI=$-31376, V12=$-26711, Error=14.9%
- `0x40a24ce1ff7eb4575b...` - UI=$840, V12=$-1369, Error=263.0%

## Conclusion

V12 achieves **93.0%** accuracy on comparable wallets (those with <50% unresolved positions).

This engine is recommended for production use when calculating realized PnL for CLOB-only activity on resolved markets.
