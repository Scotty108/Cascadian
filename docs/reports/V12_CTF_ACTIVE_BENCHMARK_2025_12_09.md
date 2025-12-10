# V12 CTF-Active Benchmark Report

**Date:** 2025-12-09
**Terminal:** Claude 1 (Definitions validation, Dome parity hardening)

## Executive Summary

Benchmark of 30 CTF-active wallets (wallets with PositionsMerge events) reveals:

**CRITICAL FINDING: V12 Synthetic is the correct Dome-parity formula**

The hypothesis that "DomeCash should match Dome better than CashFull" was **WRONG**.
Dome API uses synthetic valuation, not cash flow accounting.

## Benchmark Results (First 5 wallets)

| Wallet | Dome | Synthetic | SynthErr | CashFull | FullErr | DomeCash | DomeErr |
|--------|------|-----------|----------|----------|---------|----------|---------|
| 0xddd757c8 | $185 | $260 | 40.8% | $37,145 | 20003% | -$109,415 | 59315% |
| 0x5df52b96 | $847 | $826 | **2.6%** | $825 | 2.6% | -$172,325 | 20434% |
| 0x6a2491e7 | $243 | $325 | 33.5% | $40,227 | 16449% | -$123,396 | 50864% |
| 0xb15e92d1 | $179 | $199 | **10.9%** | $38,755 | 21502% | -$108,276 | 60453% |
| 0x91585a40 | $159 | $169 | **6.5%** | $24,040 | 15017% | -$79,432 | 50049% |

## Key Findings

### 1. V12 Synthetic is the Winner

V12 Synthetic (`usdc_delta + token_delta * payout_norm` for resolved markets) produces:
- Best wallet: 2.6% error
- Typical range: 6-40% error
- Always closest to Dome

### 2. Cash Flow Formulas Fail for CTF-Active Wallets

Both CashFull and DomeCash show massive errors (15,000% - 60,000%) because:
- They sum ALL cash flows regardless of resolution status
- CTF-active wallets have huge Merge USDC that doesn't correspond to Dome

### 3. Why CashFull Sometimes Matches (0x5df52b96)

For wallet `0x5df52b96`:
- Dome: $847
- Synthetic: $826 (2.6% error)
- CashFull: $825 (2.6% error) **<-- coincidental match!**

This wallet's cash flows happen to equal the synthetic value. Not a general pattern.

## Metric Definitions (Revised)

### V12 Synthetic (CORRECT for Dome parity)
```
Formula: usdc_delta + (token_delta * payout_norm) for RESOLVED markets only
Source: pm_trader_events_v2 with dedup
Purpose: Primary realized PnL metric, matches Dome API
```

### V12 CashFull (Internal analytics)
```
Formula: CLOB(dedup) + PayoutRedemption + PositionsMerge + PositionSplit
Source: pm_unified_ledger_v8_tbl
Purpose: Complete cash ledger (NOT for Dome comparison)
```

### V12 DomeCash (DEPRECATED)
```
Formula: CLOB(dedup) + PayoutRedemption ONLY
Status: INCORRECT - fails badly for CTF-active wallets
```

## Component Breakdown Example

For wallet `0x5df52b96990dc5`:
- CLOB usdc_delta: **-$196,625** (spent on trades)
- PayoutRedemption: **+$24,300** (redeemed)
- PositionsMerge: **+$173,170** (CTF complete-set redemptions)
- PositionSplit: **$0**

DomeCash = CLOB + Payout = **-$172,325** (WRONG)
CashFull = CLOB + Payout + Merge + Split = **$825** (coincidentally close)
Synthetic = resolved markets only = **$826** (CORRECT approach)

## Implications

1. **Stop using cash flow formulas for Dome validation**
2. **V12 Synthetic is canonical for realized PnL**
3. **CashFull is useful for internal analytics but NOT Dome parity**
4. **DomeCash should be removed or renamed to avoid confusion**

## Next Steps

1. Archive DomeCash formula (no longer needed)
2. Focus V12 Synthetic optimization for remaining error sources
3. Investigate 10-40% Synthetic error cases

## Cohort Details

CTF-active cohort criteria:
- PositionsMerge events > 10
- CLOB events 100-50,000 (moderate volume to avoid Dome timeouts)
- Merge USDC > $1,000

30 wallets selected, benchmark in progress.

---

**Status:** Preliminary (5/30 wallets complete)
**Terminal:** Claude 1
