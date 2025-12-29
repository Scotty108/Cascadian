# PnL Validation Matrix V1

> **Status:** CANONICAL | **Last Updated:** 2025-12-09

This document defines which external benchmark validates which PnL metric, and which ledger table each uses.

---

## The Matrix

| Metric | Ledger Table | Validate Against | Release Gate? | NEVER Validate Against |
|--------|--------------|------------------|---------------|------------------------|
| **Dome Cashflow** | `pm_unified_ledger_v8_tbl` | Dome API | **NO** (secondary reference) | Polymarket UI |
| **Synthetic Realized** | `pm_unified_ledger_v9_clob_tbl` | UI tooltip (low-unresolved) | **YES** (V1 Leaderboard) | Dome API |
| **Unrealized** | Live positions + prices | Live market prices | Future | Any historical data |
| **Total PnL** | V9 CLOB + live pricing | UI tooltip (All Time) | Future | Dome API |

> **Note:** Dome validation is an optional diagnostic tool, not a release gate. See [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md).

---

## Validation Paths (Detailed)

### 1. Dome Cashflow Validation (Secondary Reference)

> **WARNING:** This is NOT a release gate. Dome measures cash movement, not profit.
> See [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md) for why.

**Purpose:** Optional diagnostic for spot-checking cash flow accounting.

**What it measures:** Cash that actually moved through on-chain redemptions (excludes unredeemed winning tokens).

**Canonical data source:**
```typescript
import { CANONICAL_TABLES } from '@/lib/pnl/canonicalTables';
const ledger = CANONICAL_TABLES.UNIFIED_LEDGER_FULL; // pm_unified_ledger_v8_tbl
```

**Validation process:**
1. Fetch realized PnL from Dome API for wallet
2. Compute Dome-style PnL from V8 ledger (CLOB + PayoutRedemption only)
3. Compare at 10% tolerance

**Coverage notes:**
- Dome returns zeros for many wallets (coverage limitation, not accuracy issue)
- Track coverage and accuracy separately
- Success = (wallets with Dome data) AND (delta < 10%)

**Sample query:**
```sql
SELECT
  wallet_address,
  sum(usdc_delta) as dome_realized
FROM pm_unified_ledger_v8_tbl
WHERE event_type IN ('Trade', 'PayoutRedemption')
GROUP BY wallet_address
```

---

### 2. Synthetic Realized Validation (V1 Leaderboard)

**Purpose:** Verify copy-trading PnL including unredeemed but resolved positions.

**What it measures:** Realized value treating resolved positions as cashed out.

**Canonical data source:**
```typescript
import { CANONICAL_TABLES, getLedgerForSurface } from '@/lib/pnl/canonicalTables';
const ledger = getLedgerForSurface('leaderboard_v1_clob');
// Returns: pm_unified_ledger_v9_clob_tbl
```

**Validation process:**
1. Scrape UI tooltip via Playwright (Net Total, All Time)
2. Compute V12 Synthetic Realized from V9 CLOB ledger
3. Compare at 10% tolerance for Tier A Comparable wallets

**Tier A Comparable filters:**
- `unresolved_pct <= 5%`
- `abs(realized_pnl) >= $1,000`
- `total_events >= 10`

**Why not validate against Dome:**
- Dome requires actual redemption
- Synthetic counts unredeemed winning tokens as realized
- These are intentionally different definitions

**Sample query:**
```sql
SELECT
  wallet_address,
  sum(usdc_delta + token_delta * coalesce(payout_norm, 0)) as synthetic_realized
FROM pm_unified_ledger_v9_clob_tbl
WHERE payout_norm IS NOT NULL
GROUP BY wallet_address
```

---

### 3. Unrealized Validation (Future)

**Purpose:** Verify mark-to-market value of open positions.

**What it measures:** Current value of unresolved positions.

**Data requirements:**
- Open positions inventory per wallet/token
- Real-time or near-real-time market prices
- Price source: best bid/ask mid from CLOB

**Implementation status:** Not yet built.

**Validation approach (when implemented):**
1. Compute unrealized from positions + live prices
2. Compare to UI tooltip immediately after page load
3. Accept timing variance (few seconds)

---

### 4. Total PnL Validation

**Purpose:** Verify complete profit/loss picture for user display.

**What it measures:** `Synthetic Realized + Unrealized`

**Validation process:**
1. Scrape UI tooltip via Playwright (Net Total, All Time)
2. Compute Total = V12 Synthetic + Mark-to-Market
3. Compare at 10% tolerance

**Implementation status:** Blocked on Unrealized engine.

**When to use Total vs Synthetic:**
| Surface | Use |
|---------|-----|
| Copy-trade leaderboard | Synthetic Realized |
| User portfolio view | Total PnL |
| Win/loss statistics | Synthetic Realized |
| Category breakdown | Synthetic Realized |

---

## Ledger Selection Decision Tree

```
Building V1 Leaderboard logic?
├── YES → Use CLOB_ONLY_LEDGER_TABLE (pm_unified_ledger_v9_clob_tbl)
│         Import: getLedgerForSurface('leaderboard_v1_clob')
│
└── NO → Building full accounting with CTF events?
         ├── YES → Use UNIFIED_LEDGER_TABLE (pm_unified_ledger_v8_tbl)
         │         Import: getLedgerForSurface('full_pnl')
         │
         └── NO → Probably Unrealized/Total PnL
                  → Wait for pricing engine
```

---

## Gold Set Management

### V1 Leaderboard Gold Set

**File:** `tmp/gold_clob_ui_truth.json`

**Contents:**
- Tier A Comparable wallets only
- UI tooltip values (Playwright scraped)
- V12 Synthetic Realized values
- Identity verified: `abs(Gain - Loss - Net Total) < $1`

**Usage:**
```typescript
const goldSet = require('./tmp/gold_clob_ui_truth.json');
// Use for regression testing V12 changes
```

### Full Accounting Gold Set

**File:** `tmp/gold_full_dome_truth.json`

**Contents:**
- Wallets with Dome coverage
- Dome API realized values
- V8 CashFull computed values

**Usage:**
```typescript
const goldSet = require('./tmp/gold_full_dome_truth.json');
// Use for regression testing full accounting changes
```

---

## Validation Script Mapping

| Script | Validates | Against | Ledger |
|--------|-----------|---------|--------|
| `validate-v12-vs-tooltip-truth.ts` | Synthetic Realized | UI tooltip | V9 CLOB |
| `validate-dome-realized.ts` | Dome-Realized | Dome API | V8 Full |
| `regression-check-gold-set.ts` | V12 stability | Pinned gold set | V9 CLOB |

---

## Exit Criteria for V1 Launch

| Metric | Target | Current | Release Gate? |
|--------|--------|---------|---------------|
| Synthetic Realized @ 10% tolerance | ≥80% Tier A pass | 90% ✅ | **YES** |
| Synthetic Realized @ 20% tolerance | ≥80% Tier A pass | 82.6% ✅ | Fallback |
| Dome parity | Informational only | ~40% | **NO** |
| Gold set size | 100+ wallets | 50 | Nice to have |

**Decision:** V1 Leaderboard ships when Synthetic Realized hits 80%+ on Tier A Comparable. **Dome parity is NOT a release gate.**

---

## V1 Shipping Rules

> **CANONICAL** - This section defines the validation contracts for V1 launch.

### Two Surfaces, Two Ledgers

This is **NOT** "V9 replaces V8". It is "two surfaces, two ledgers":

| Surface | Ledger | Purpose |
|---------|--------|---------|
| **V1 Leaderboard** | `pm_unified_ledger_v9_clob_tbl` | CLOB trade coverage, no CTF event accounting |
| **Full Accounting** | `pm_unified_ledger_v8_tbl` | CTF merges/splits/redemptions included |

### Validation Contracts by Metric Type

| Metric | Validate Against | Release Gate? | Reasoning |
|--------|------------------|---------------|-----------|
| **Dome Cashflow** | Dome API | **NO** | Optional diagnostic, measures cash movement not profit |
| **Total PnL** | UI Tooltip (Playwright) | Future | What users see on Polymarket profile |
| **Synthetic Realized** | Internal + low-unresolved UI spot checks | **YES** | V1 Leaderboard metric |

> **Note:** Dome validation was previously considered as a release gate but has been downgraded to an optional diagnostic. See [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md).

### CI Enforcement

The `pnpm pnl:audit-canonical` script enforces:
- All active code uses `CANONICAL_TABLES` imports
- No hardcoded table strings in production paths
- Violations in archive scope don't fail CI

### Runtime Assertions (Available)

```typescript
import { assertLedgerMatchesSurface } from '@/lib/pnl/assertCanonicalTable';

// In leaderboard code:
assertLedgerMatchesSurface(tableName, 'leaderboard_v1_clob');
// Throws NonCanonicalTableError if wrong table used
```

---

## Related Documents

- [PNL_VOCABULARY_V1.md](./PNL_VOCABULARY_V1.md) - Metric definitions
- [PERSISTED_OBJECTS_MANIFEST.md](./PERSISTED_OBJECTS_MANIFEST.md) - Table inventory
- [PRODUCT_SURFACE_CANONICALS.md](./PRODUCT_SURFACE_CANONICALS.md) - Surface routing
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - Wallet filtering
- [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md) - Why Dome is non-authoritative

---

*Generated by Terminal 2 - Enforcement Layer Implementation*
