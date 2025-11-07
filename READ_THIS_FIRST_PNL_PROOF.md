# READ THIS FIRST - P&L System Proof

**Status:** CRITICAL BUG CONFIRMED
**Date:** 2025-11-07

---

## The Bottom Line

**THE P&L SYSTEM IS BROKEN. HERE IS THE PROOF:**

### niggemon Wallet Test

| Source | Realized P&L | Status |
|--------|-------------|---------|
| `trades_raw` (correct) | $117.24 | ✅ Authoritative source |
| `wallet_realized_pnl_v2` (view) | $1,907,531.19 | ❌ **16,270x INFLATED** |

**Proof:** The view shows **$1.9 million** when the actual P&L is **$117**.

### HolyMoses7 Wallet Test

| Source | Realized P&L | Status |
|--------|-------------|---------|
| `trades_raw` (correct) | $0.00 | ✅ Zero resolved trades |
| `wallet_realized_pnl_v2` (view) | $301,156.45 | ❌ **INFINITE INFLATION** |

**Proof:** The view claims $301k in realized P&L for a wallet with **ZERO resolved trades**. This is mathematically impossible.

---

## How to Verify

Run these commands in the project directory:

```bash
# Test niggemon wallet
npx tsx verify-pnl-proof.ts

# Test HolyMoses7 wallet
npx tsx test-holymoses.ts

# See the root cause
npx tsx investigate-cashflows.ts
```

All scripts are in `/Users/scotty/Projects/Cascadian-app/`

---

## Root Cause (Simplified)

The P&L views use a table called `trade_cashflows_v3` that contains:
- **5,576 rows** for niggemon's cashflows
- But only **332 resolved trades** exist in `trades_raw`
- **Ratio: 16.8x duplication**

The view naively sums ALL cashflows without deduplication, resulting in 16,000x inflation.

---

## What to Do

### DO NOT USE (Broken):
- ❌ `wallet_realized_pnl_v2`
- ❌ `wallet_pnl_summary_v2`
- ❌ `realized_pnl_by_market_v2`
- ❌ `trade_cashflows_v3`

### USE INSTEAD (Correct):
```sql
-- Get wallet P&L from source of truth
SELECT
  wallet_address,
  SUM(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE 0 END) as realized_pnl,
  SUM(CASE WHEN is_resolved = 0 THEN realized_pnl_usd ELSE 0 END) as unrealized_pnl
FROM trades_raw
GROUP BY wallet_address
```

---

## Complete Documentation

For full analysis with all query results and technical details, see:

1. **`FINAL_PROOF_PNL_BROKEN.md`** - Complete proof with actual query results
2. **`PNL_SYSTEM_PROOF_REPORT.md`** - Initial findings and test results
3. **`SMOKING_GUN_FOUND.md`** - Root cause identification

---

## Key Numbers

- **Inflation factor:** 16,270.81x (not a typo)
- **Cashflow row duplication:** 16.8x
- **Markets inflated:** 799 shown vs 18 actual (44.4x)
- **HolyMoses7 impossible P&L:** $301k from 0 resolved trades

**This is reproducible proof that the P&L system is fundamentally broken.**
