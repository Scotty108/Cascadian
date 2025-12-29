# PnL Parity North Star

> **This is the single source of truth for PnL validation across all terminals.**
> All validation scripts MUST use these definitions and rules.

---

## 1. Objective

**We care about matching Polymarket UI Profit/Loss for the purpose of a copy-trading leaderboard.**

The product can ship with a scoped cohort if accuracy is demonstrably high and the scope is explicit.

---

## 2. Two Metrics (Not One)

### 2.1 Realized PnL Parity
- Cash that has actually been extracted from closed positions
- `sum(usdc_delta)` for CLOB trades on resolved markets
- Does NOT include value of open positions

### 2.2 Total PnL Parity (UI Display)
- What Polymarket shows on the profile page
- `Realized PnL + Unrealized Position Value`
- This is what users see and compare

**Critical Insight**: The UI shows TOTAL PnL. Comparing realized-only calculations to UI values will always show discrepancies for wallets with active positions.

---

## 3. Canonical Pass/Fail Rule

All validation scripts MUST use this rule:

```typescript
function passesUiParity(ui_pnl: number, our_pnl: number): { passed: boolean; threshold_used: 'pct' | 'abs' } {
  const abs_error = Math.abs(our_pnl - ui_pnl);
  const abs_ui = Math.abs(ui_pnl);

  // Large wallets: percentage threshold
  if (abs_ui >= 200) {
    const pct_error = (abs_error / abs_ui) * 100;
    // Must be within 5% AND same sign
    const sign_match = (ui_pnl >= 0) === (our_pnl >= 0);
    return { passed: pct_error <= 5 && sign_match, threshold_used: 'pct' };
  }

  // Small wallets: absolute threshold
  return { passed: abs_error <= 10, threshold_used: 'abs' };
}
```

**Thresholds:**
- **Large wallets (|UI| >= $200)**: ≤5% error AND sign match
- **Small wallets (|UI| < $200)**: ≤$10 absolute error

---

## 4. Cohort Definitions

Wallets are classified into these cohorts, evaluated in order:

### Cohort 1: CLOB-Only, Positions Closed
- **Criteria**:
  - Zero ERC1155 transfers
  - Zero splits/merges in pm_ctf_events
  - No active positions (all markets resolved)
- **Expected Accuracy**: 99%+
- **Formula**: `sum(usdc_delta)` should match UI exactly

### Cohort 2: CLOB-Only, Active Positions
- **Criteria**:
  - Zero ERC1155 transfers
  - Zero splits/merges
  - Has active positions in unresolved markets
- **Expected Accuracy**: 95%+ (with position value add-on)
- **Formula**: `sum(usdc_delta) + current_position_value`

### Cohort 3: Mixed Source (has CTF events)
- **Criteria**:
  - Has splits OR merges in pm_ctf_events
  - May or may not have transfers
- **Expected Accuracy**: 70-85%
- **Status**: Excluded from v1 leaderboard

### Cohort 4: Transfer-Heavy
- **Criteria**:
  - Has ERC1155 transfers
- **Expected Accuracy**: Unknown/Low
- **Status**: Excluded from v1 leaderboard

---

## 5. Leaderboard v1 Scope

The v1 copy-trading leaderboard ships with:

```
INCLUDED:
- Cohort 1 (CLOB-only, closed positions)
- Cohort 2 (CLOB-only, active positions)

EXCLUDED:
- Cohort 3 (splits/merges)
- Cohort 4 (transfers)

FILTERS:
- Minimum realized PnL: >= $200
- Minimum trades: >= 10
- PnL sign: Positive (winners only for copy-trading)
```

---

## 6. Decision Tree

All validation logic follows this tree:

```
1. Is wallet CLOB-only?
   ├── NO → Bucket as Cohort 3 or 4, exclude from v1
   └── YES → Continue

2. Does wallet have ERC1155 transfers?
   ├── YES → Bucket as Cohort 4, exclude from v1
   └── NO → Continue

3. Does wallet have splits/merges?
   ├── YES → Bucket as Cohort 3, exclude from v1
   └── NO → Continue

4. Does wallet have active positions?
   ├── NO → Cohort 1: Use realized formula
   └── YES → Cohort 2: Use realized + position value formula
```

---

## 7. Validation Entrypoint

**The ONLY allowed validation script is:**

```
scripts/pnl/validate-ui-parity.ts
```

This script:
1. Loads wallets with cohort labels
2. Scrapes UI P/L values
3. Computes our values using cohort-appropriate formulas
4. Applies the canonical pass/fail rule
5. Outputs results by cohort and overall

**All other ad-hoc validation scripts are deprecated.**

---

## 8. Terminal Roles

### Claude 1: Benchmark Integrity & Cohort Strategy
**Owns:**
- This North Star document
- Pass/fail rule definition
- Cohort definitions
- Unified harness (`validate-ui-parity.ts`)
- Leaderboard v1 acceptance criteria

### Claude 2: CLOB-Only UI Parity Implementation
**Owns:**
- Realized vs Total decomposition logic
- CLOB-only fast-path implementation
- Position value calculation for active positions
- Integration with validate-ui-parity.ts

---

## 9. Key Formulas

### Realized PnL (Cohort 1 - Closed Positions)
```sql
SELECT sum(usdc_delta) / 1e6 as realized_pnl
FROM pm_unified_ledger_v8_tbl
WHERE wallet = '{wallet}'
  AND source = 'clob'
```

### Total PnL (Cohort 2 - Active Positions)
```
Total PnL = Realized PnL + Unrealized Position Value

Where:
  Unrealized Position Value = sum(current_shares * current_price) - remaining_cost_basis
```

---

## 10. Success Criteria

| Cohort | Target Pass Rate | Status |
|--------|------------------|--------|
| Cohort 1 (CLOB closed) | 99% | Validated |
| Cohort 2 (CLOB active) | 95% | In Progress |
| Cohort 3 (Mixed) | N/A | Excluded from v1 |
| Cohort 4 (Transfers) | N/A | Excluded from v1 |

**Overall v1 Target**: 95%+ accuracy on included cohorts

---

## Changelog

- 2025-12-07: Initial version created to unify Claude 1 and Claude 2 approaches
