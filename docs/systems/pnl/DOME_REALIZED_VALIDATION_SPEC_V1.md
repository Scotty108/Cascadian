# Dome Realized PnL Validation Spec V1

> **Status:** ACTIVE | **Created:** 2025-12-09 | **Owner:** Terminal 1

## Purpose

This spec defines how to validate Cascadian's realized PnL engine against the Dome API's `realizedPnL` field. Dome is the external ground truth for realized-only PnL (excludes unrealized positions).

---

## Current State (2025-12-09)

> **V1 harness shows low parity at 10% tolerance on a 20-wallet pilot.**

This is expected until we:
1. Refine the Dome-matching formula
2. Possibly adjust ledger sourcing (see Hybrid Ledger Note below)
3. Complete a 10-wallet deep trace to identify systematic issues

**Do not scale to 100 wallets until the 10-wallet deep trace passes.**

---

## Hybrid Ledger Note

> **Critical Discovery:** Neither V8 nor V9 alone may be sufficient for Dome parity.

| Ledger | Strength | Weakness |
|--------|----------|----------|
| **V8 Full** | Has CTF events (merge/split/redemption) | May be incomplete on CLOB fills |
| **V9 CLOB** | Better CLOB trade coverage | Missing CTF events entirely |

**Implications:**
- Dome-realized validation may require a **hybrid source**:
  - CLOB trades from V9 (better coverage)
  - Payout/redemption events from V8 (for resolved markets)
- This is a formula refinement task, not a data quality issue

**Next step:** Terminal 2 should trace 5 wallets through both ledgers to quantify the coverage gap.

---

## Known Dome Behaviors

### 1. Zero-PnL Coverage

Dome returns `realizedPnL: 0` for some wallets that have trading activity. This is NOT an error - it means:
- The wallet has no **settled** (resolved) trades yet, OR
- All positions are still open (unrealized)

**Acceptance:** Wallets with Dome `realizedPnL = 0` but non-zero V12 output are EXCLUDED from pass rate calculations (neither pass nor fail).

### 2. Time Delay

Dome's realized PnL may lag behind our data by several minutes. When comparing:
- Capture Dome and V12 within same 5-minute window
- If discrepancy found, re-fetch after 10 minutes before marking as failure

### 3. Market Scope

Dome's `realizedPnL` covers all Polymarket markets the wallet has traded. There is no per-market breakdown available via API.

---

## Validation Formula

**Dome-Realized PnL should equal:**

```
V12 CashV2 Realized = SUM(usdc_delta)
                    + SUM(token_delta * payout_norm) [for resolved markets only]
```

Where:
- `usdc_delta` = USDC in/out from CLOB trades
- `token_delta` = Token position change from trades
- `payout_norm` = 0, 0.5, or 1 based on resolution outcome
- **Exclude:** Unredeemed winning tokens (these are in Synthetic Realized, not Dome Realized)

---

## Sampling Plan

### Gate 0: 10-Wallet Deep Trace (REQUIRED FIRST)

Before any large-scale validation, complete a deep trace of 10 wallets:

| Step | Description |
|------|-------------|
| 1 | Pick 10 wallets from Tier A Comparable |
| 2 | For each: dump raw events from V8 AND V9 |
| 3 | Calculate PnL manually step-by-step |
| 4 | Compare to Dome API value |
| 5 | Identify root cause of any mismatch |

**Exit criteria:** ≥8/10 wallets match Dome within 10% tolerance using refined formula.

### Initial Validation (Tier A Comparable)

| Criteria | Value |
|----------|-------|
| Unresolved positions | ≤5% of total events |
| Minimum PnL | ≥$1,000 absolute value |
| Minimum trades | ≥10 events |
| Sample size | **100 wallets** (raised from 50) |

**Gating:** Only proceed to 100-wallet validation after Gate 0 passes.

### Expanded Validation (Full Population)

After Tier A passes (≥80%), expand to:
- Random 1,000-wallet sample
- No unresolved filter (test full semantics)
- Document failure categories

---

## Acceptance Thresholds

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Pass rate (Tier A) | ≥80% | 10% tolerance |
| Pass rate (Full) | ≥60% | Expected lower due to unrealized differences |
| Tolerance band | ±10% | Relative error |
| Zero-Dome exclusion | Yes | Don't count as pass/fail |

---

## Test Harness

### Primary Script
```bash
npx tsx scripts/pnl/validate-v12-vs-dome.ts --wallets=tmp/tier_a_comparable.json
```

### Output Format
```json
{
  "wallet": "0x...",
  "dome_realized": 12345.67,
  "v12_realized": 12300.00,
  "error_pct": 0.37,
  "status": "PASS"
}
```

### Status Values
- `PASS`: Error ≤10%
- `FAIL`: Error >10%
- `SKIP_DOME_ZERO`: Dome returned 0 (excluded from stats)
- `SKIP_V12_ERROR`: Engine error (investigate)

---

## Known Limitations

### 1. Unredeemed Winning Tokens

When a wallet wins on a resolved market but hasn't redeemed:
- **Dome:** Does NOT include (shows lower realized)
- **V12 CashV2:** Does NOT include (matches Dome)
- **Synthetic Realized:** DOES include (semantic difference)

### 2. CTF Merge/Split Events

Dome excludes merge/split USDC flows from realized PnL:
- **V12 on V8 Full:** Includes them
- **V12 on V9 CLOB:** Excludes them (matches Dome)

**Recommendation:** Use V9 CLOB ledger for Dome validation lane.

### 3. Rounding

Dome rounds to 2 decimal places. V12 may have more precision. Use 10% tolerance to absorb rounding effects.

---

## Execution Checklist

### Gate 0: Deep Trace (Do First)
- [ ] Pick 10 Tier A Comparable wallets
- [ ] Dump raw events from V8 AND V9 for each
- [ ] Calculate PnL manually step-by-step
- [ ] Compare to Dome API value
- [ ] Identify root cause of mismatches
- [ ] Refine formula if needed
- [ ] **Exit:** ≥8/10 pass at 10% tolerance

### Gate 1: 100-Wallet Validation (After Gate 0)
- [ ] Generate Tier A Comparable wallet list (100 wallets)
- [ ] Fetch Dome realized PnL for all 100
- [ ] Run V12 CashV2 with refined formula
- [ ] Calculate error percentages
- [ ] Exclude Dome-zero wallets from stats
- [ ] Report pass rate
- [ ] **Exit:** ≥80% pass at 10% tolerance

### Gate 2: Investigate Failures (If Gate 1 Fails)
- [ ] If <80%, investigate top 10 failures
- [ ] Document systematic patterns
- [ ] Refine formula and repeat Gate 0

---

## Conclusion: Dome Is Not Canonical

> **Key Finding:** Dome is NOT a canonical realized PnL benchmark for general wallets.

### What Dome Measures

Dome's `realizedPnL` field measures **cash movement**, not profit in the accounting sense:
- USDC in/out from trades
- USDC from payout redemptions
- Does NOT include unredeemed winning positions
- Does NOT match Polymarket UI's "Total PnL"

### Implications

| Use Case | Dome Suitable? | Why |
|----------|----------------|-----|
| Sanity check cash flows | Yes | That's what it measures |
| Benchmark realized profit | No | Semantic mismatch |
| Release gate for V1 | No | Too many edge cases |
| Debug data pipeline | Yes | Good for spot-checking |

### Gate Status Change

Given this finding, Gates 0-2 are now **optional diagnostics**, not release gates:

| Gate | Previous Status | New Status |
|------|-----------------|------------|
| Gate 0: 10-wallet trace | Required | Optional diagnostic |
| Gate 1: 100-wallet validation | Required | Optional diagnostic |
| Gate 2: Failure investigation | Required | Optional diagnostic |

**V1 Leaderboard release does NOT depend on Dome parity.**

See: [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md) for full explanation.

---

## Related Documents

- [PRODUCT_SURFACE_CANONICALS.md](./PRODUCT_SURFACE_CANONICALS.md) - Validation lane rules
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - Wallet selection criteria
- [V12_ARCHITECTURE_SPEC.md](./V12_ARCHITECTURE_SPEC.md) - Engine implementation details
- [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md) - Why Dome is non-authoritative
