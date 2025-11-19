# XCN Wallet P&L Investigation Report
## Wallet: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

---

## Executive Summary

Investigated billion-scale P&L numbers that don't match user's expectation of $1-2M volume and ~$80-100K P&L.

**Root Causes Identified:**

1. **102,618 duplicate trade_keys** in the view (trades appearing up to 12x)
2. **Wallet clustering of 13 executors** with vastly different volume profiles
3. **One dominant executor** (`0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`) with $2.6B volume (90% of total)
4. **No field scaling needed** - `usd_value` is already in proper dollars

---

## Key Findings

### 1. Data is Already Normalized
- Individual trades show correct values: $9.99, $0.99, $101.00 (verified via sample)
- **No division by 1e3 or 1e6 needed**
- Field `usd_value` is `Decimal(18, 2)` and already in USD

### 2. Duplicate Trades in View
- **Total rows:** 17,246,600
- **Unique trade_keys:** 17,143,982
- **Duplicates:** 102,618 trades
- **Max duplicates:** 12x for single trade_key
- **Impact:** Minimal (~$10M difference after deduplication)

### 3. Wallet Clustering Analysis
- **Canonical wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- **Executor wallets:** 13 total
- **Total volume (all executors):** $2.9B
- **Total trades:** 17.2M (excluding orphans)

### 4. Executor Breakdown (Top 3)

| Executor | Trades | Volume | % of Total |
|----------|--------|--------|-----------|
| `0x4bfb...82e` | 16,585,504 | $2.58B | 90% |
| `0xf29b...d4c` | 22,184 | $123M | 4% |
| `0x0540...8eb` | 516,114 | $53M | 2% |

### 5. Wallet Identity Source
- Problem executor added via **`manual_validation_c1_agent`** (2025-11-17 05:09:17)
- Other 11 executors added via **`tx_overlap_discovery_c1_agent_multi_proxy`** (2025-11-17 18:40-18:41)

---

## Current Numbers (Deduplicated)

### With All 13 Executors:
- **Trade P&L:** $-1,791,005,168.07
- **Trade Volume:** $2,875,715,333.57
- **Total Trades:** 17,143,982
- **Unique Markets:** 212,935

### Excluding Problem Executor (`0x4bfb...82e`):
- **Trade P&L:** $-155,191,417.54
- **Trade Volume:** $290,948,223.20
- **Total Trades:** 558,478

---

## Discrepancy Analysis

User expected:
- Volume: **$1-2M**
- P&L: **~$80-100K**

Actual (all executors):
- Volume: **$2.9B** (1,450x higher)
- P&L: **$-1.8B** (18,000x higher in magnitude)

Actual (excluding problem executor):
- Volume: **$291M** (145x higher)
- P&L: **$-155M** (1,550x higher in magnitude)

---

## Possible Explanations

1. **Wrong wallet queried** - User may have meant a different wallet address
2. **Wrong metric expected** - User may have meant unrealized P&L (open positions only)
3. **Bad wallet clustering** - The `0x4bfb...82e` executor shouldn't be part of this canonical wallet
4. **Data corruption** - The dominant executor has corrupted/inflated trade data
5. **Misunderstanding** - User's "$1-2M" refers to current open position value, not total volume

---

## Next Steps

Need user clarification on:

1. **Is the canonical wallet address correct?** (`0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`)
2. **Should executor `0x4bfb...82e` be included?** (It has 90% of the volume)
3. **What does "$1-2M volume" refer to?**
   - Total cumulative trade volume (all time)?
   - Current open position value (unrealized)?
   - Monthly/recent volume only?
4. **What does "~$80-100K P&L" refer to?**
   - Trade-only P&L?
   - Realized P&L (with settlements)?
   - Unrealized P&L (current positions)?
   - Net P&L (realized + unrealized)?

---

## Technical Notes

- View: `vw_trades_canonical_with_canonical_wallet`
- Base table: `pm_trades_canonical_v3`
- Identity mapping: `wallet_identity_overrides`
- No `usd_norm` or `shares_norm` fields exist in view
- Orphan trades (empty `cid_norm`) excluded from analysis
- Deduplication performed via `GROUP BY trade_key`

---

**Report Generated:** 2025-11-17
**Agent:** Claude 2 (Database Agent)
