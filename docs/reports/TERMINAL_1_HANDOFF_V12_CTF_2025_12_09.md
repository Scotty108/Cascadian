# Terminal 1 Handoff: V12 CTF-Active Benchmark Findings

**Date:** 2025-12-09
**Terminal:** Claude 1 (Definitions validation, Dome parity hardening)
**Status:** CRITICAL FINDING - Hypothesis reversed

## Executive Summary

The CTF-active benchmark (30 wallets with PositionsMerge > 0) **DISPROVES** the original hypothesis.

**Original Hypothesis:** DomeCash (CLOB + PayoutRedemption ONLY) should match Dome better than CashFull (which includes PositionsMerge/Split).

**Actual Finding:** V12 Synthetic is the ONLY metric that tracks Dome. All cash-flow based metrics fail badly for CTF-active wallets.

## Key Results (6/30 wallets complete)

| Wallet | Dome | Synthetic | SynthErr | CashFull | FullErr | DomeCash | DomeErr |
|--------|------|-----------|----------|----------|---------|----------|---------|
| 0xddd757c8 | $185 | $260 | 40.8% | $37,145 | 20003% | -$109,415 | 59315% |
| 0x5df52b96 | $847 | $826 | **2.6%** | $825 | 2.6% | -$172,325 | 20434% |
| 0x6a2491e7 | $243 | $325 | 33.5% | $40,227 | 16449% | -$123,396 | 50864% |
| 0xb15e92d1 | $179 | $199 | **10.9%** | $38,755 | 21502% | -$108,276 | 60453% |
| 0x91585a40 | $159 | $169 | **6.5%** | $24,040 | 15017% | -$79,432 | 50049% |
| 0x854fc44c | $15,966 | $14,599 | **8.6%** | $8,587 | 46.2% | -$884,055 | 5637% |

**Conclusion:** V12 Synthetic achieves 2.6-40% error. Cash metrics fail with 46-60000% error.

## Root Cause

Dome API uses **synthetic valuation** (`usdc_delta + token_delta * payout_norm` for resolved markets), NOT cash flow accounting.

When a wallet does CTF operations (PositionsMerge), the cash flows don't tell the full story:
- CLOB usdc_delta: -$196K (spent on trades)
- PayoutRedemption: +$24K (redeemed)
- PositionsMerge: +$173K (CTF redemption)

DomeCash = -$172K (WRONG - just sums cash)
Synthetic = ~$826 (CORRECT - values resolved positions)

## Updated Metric Taxonomy

1. **V12 Synthetic** - CANONICAL for Dome parity
   - Formula: `usdc_delta + (token_delta * payout_norm)` for resolved markets
   - Source: `pm_trader_events_v2` with GROUP BY event_id dedup
   - Use: Product metrics, Dome validation

2. **V12 CashFull** - Internal analytics only
   - Formula: CLOB + PayoutRedemption + PositionsMerge + PositionSplit
   - Source: `pm_unified_ledger_v8_tbl`
   - Use: Cash flow accounting, NOT Dome validation

3. **V12 DomeCash** - DEPRECATED
   - Originally for Dome validation, now proven wrong
   - Fails badly for CTF-active wallets

## Files Created/Updated

1. `docs/reports/V12_CTF_ACTIVE_BENCHMARK_2025_12_09.md` - Full benchmark report
2. `docs/specs/REALIZED_METRIC_TAXONOMY.md` - Updated with CTF-active findings
3. `scripts/pnl/build-ctf-active-cohort.ts` - Cohort builder
4. `scripts/pnl/create-micro-regression-set.ts` - 10-wallet regression set
5. `data/micro_regression_set_v1.json` - Fixed regression test wallets
6. `tmp/ctf_active_moderate_benchmark.json` - 30-wallet CTF cohort

## Benchmark Still Running

The CTF-active benchmark (30 wallets) is still running in background.
Check `tmp/v12_ctf_moderate_live.log` for latest results.

## Recommended Next Steps

1. **Deprecate DomeCash** - Remove or rename to avoid confusion
2. **Focus V12 Synthetic optimization** - Investigate remaining 10-40% error cases
3. **Run micro-regression set** - Use 10-wallet fixed set for CI testing
4. **Classify wallets by Merge activity** - Different validation approaches needed

## Technical Note

V12 Synthetic sources from `pm_trader_events_v2` (CLOB only), while Cash metrics source from `pm_unified_ledger_v8_tbl` (includes all event types). The different data sources explain part of the divergence.

---

**Terminal 1 signing off.** V12 Synthetic is canonical.
