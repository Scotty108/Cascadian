# PnL Engine Differences: Quick Reference

**Date:** 2025-12-15
**For:** Quick lookup when debugging PnL discrepancies

---

## One-Line Summary Per Engine

| Engine | One-Line Description | Use When |
|--------|---------------------|----------|
| **V13** | CLOB + CTF splits/merges, weighted average cost basis | Need cost-basis tracking with CTF events |
| **V17** | CLOB-only, paired-outcome normalization, all roles | **Cascadian canonical** (complete-set arbitrage handled) |
| **V18** | CLOB-only, **maker-only filter**, rounded to cents | ❌ **DO NOT USE** (maker-only is incorrect for UI parity) |
| **V19** | Unified ledger v6, CLOB-only, filters unmapped trades | Clean CLOB-only wallets |
| **V20** | Unified ledger v7, CLOB-only, SQL rounding | ✅ **PRODUCTION DEFAULT** (validated on top 15) |
| **V22** | Unified ledger v7, includes redemptions/merges, dual formula | Wallets with CTF activity (experimental) |

---

## Key Architectural Differences (One Table)

| Feature | V13 | V17 | V18 ❌ | V19 | V20 ✅ | V22 |
|---------|-----|-----|-------|-----|-------|-----|
| **Role Filter** | All | All | **Maker** | All | All | All |
| **CTF Events** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Paired Norm** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Unmapped Filter** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Rounding** | ❌ | ❌ | Cents (TS) | ❌ | Cents (SQL) | ❌ |
| **Data Source** | v2 table | dedup table | v2 table | ledger v6 | ledger v7 | ledger v7 |

**Legend:**
- ✅ = Recommended
- ❌ = Issue or not recommended
- All = Includes maker + taker
- Paired Norm = Paired-outcome normalization for complete-set arbitrage

---

## Decision Tree: Which Engine to Use?

```
Are you displaying in the UI?
├─ Yes → Use V20 (canonical, validated on top 15)
│
└─ No → What's your use case?
    ├─ Cost-basis tracking? → V13
    ├─ Complete-set arbitrage? → V17
    ├─ Wallet has CTF events? → V22 (experimental)
    ├─ Academic research? → V20 (stable)
    └─ Debugging? → Run all engines and compare
```

---

## Common Failure Patterns

| Symptom | Likely Cause | Engine to Test |
|---------|--------------|----------------|
| **Sign flip** (UI: -$278, Engine: +$184) | User is taker-heavy, maker-only filter flipped direction | V20 (all roles) |
| **Missing profit** (UI: +$520, Engine: $0) | Profit in taker fills or redemptions | V20 or V22 |
| **Phantom loss** (UI: $0, Engine: -$8,260) | Unmapped trades stuck at 0.5 mark price | V19/V20 (filters unmapped) |
| **Overcounting** (UI: +$3,292, Engine: +$3,814) | Complete-set arbitrage or mixed maker/taker pairs | V17 or V20 |
| **Undercounting loss** (UI: -$400, Engine: -$1) | Missing redemption events | V22 |

---

## Quick Validation Queries

### Check if User is Taker-Heavy (Sign Flip Issue)

```sql
WITH deduped AS (
  SELECT event_id, any(usdc_amount) as usdc, any(role) as role
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('WALLET_ADDRESS')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT
  sumIf(usdc, role = 'maker') / sum(usdc) as maker_pct,
  sumIf(usdc, role = 'taker') / sum(usdc) as taker_pct
FROM deduped;
```

**If `maker_pct` < 0.2:** User is taker-heavy → V18 (maker-only) will fail

---

### Check for Unmapped Trades (Phantom Loss Issue)

```sql
SELECT count(*) as unmapped_count
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('WALLET_ADDRESS')
  AND is_deleted = 0
  AND token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3);
```

**If `unmapped_count` > 0:** Use V19/V20 (filters unmapped)

---

### Check for Redemptions (Missing Profit/Loss Issue)

```sql
SELECT
  sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('WALLET_ADDRESS');
```

**If `redemption_usdc` ≠ 0:** Use V22 (includes redemptions)

---

## Code Locations

| Engine | File Path | Export Name |
|--------|-----------|-------------|
| V13 | `lib/pnl/uiActivityEngineV13.ts` | `createV13Engine()` |
| V17 | `lib/pnl/uiActivityEngineV17.ts` | `createV17Engine()` |
| V18 | `lib/pnl/uiActivityEngineV18.ts` | `createV18Engine()` ❌ |
| V19 | `lib/pnl/uiActivityEngineV19.ts` | (no factory, inline) |
| V20 | `lib/pnl/uiActivityEngineV20.ts` | `calculateV20PnL()` ✅ |
| V22 | `lib/pnl/uiActivityEngineV22.ts` | `calculateV22PnL()` |

**Default Export:** `lib/pnl/index.ts` → Currently V3 (outdated, should be V20)

---

## Testing Checklist

When validating a new wallet or debugging a discrepancy:

- [ ] Run V20 (canonical baseline)
- [ ] Check maker vs taker ratio (SQL query above)
- [ ] Check for unmapped trades (SQL query above)
- [ ] Check for redemptions (SQL query above)
- [ ] If still failing, run V17 (paired normalization)
- [ ] If still failing, run V22 (includes CTF events)
- [ ] Document findings in `docs/reports/`

---

## Migration Guide: V18 → V20

### Before (DO NOT USE)

```typescript
import { createV18Engine } from '@/lib/pnl/uiActivityEngineV18';

const engine = createV18Engine();
const metrics = await engine.compute(wallet);
console.log(metrics.total_pnl);  // ❌ WRONG (maker-only)
```

### After (CORRECT)

```typescript
import { calculateV20PnL } from '@/lib/pnl/uiActivityEngineV20';

const metrics = await calculateV20PnL(wallet);
console.log(metrics.total_pnl);  // ✅ CORRECT (all roles, validated)
```

---

## Related Documentation

- **Full Comparison:** `docs/reports/ENGINE_DIFF_RELEVANT_TO_UI.md`
- **Code Analysis:** `docs/reports/ENGINE_CODE_COMPARISON.md`
- **Investigation Summary:** `docs/reports/UI_PARITY_INVESTIGATION_SUMMARY.md`
- **SQL Tests:** `docs/reports/UI_PARITY_SQL_TESTS.sql`
- **PnL Overview:** `docs/READ_ME_FIRST_PNL.md`
