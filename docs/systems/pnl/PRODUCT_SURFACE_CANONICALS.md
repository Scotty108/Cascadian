# Product Surface Canonical Tables

> **Status:** CANONICAL | **Last Updated:** 2025-12-09

## Quick Reference

| Product Surface | Canonical Table | TypeScript Import |
|-----------------|-----------------|-------------------|
| **V1 Leaderboard (CLOB-only)** | `pm_unified_ledger_v9_clob_tbl` | `CLOB_ONLY_LEDGER_TABLE` |
| **Full PnL (all event types)** | `pm_unified_ledger_v8_tbl` | `UNIFIED_LEDGER_TABLE` |

---

## Rules

**If you are building V1 leaderboard logic:**
```typescript
import { CLOB_ONLY_LEDGER_TABLE } from '@/lib/pnl/dataSourceConstants';
```

**If you are building full accounting (CTF merge/split/redemption):**
```typescript
import { UNIFIED_LEDGER_TABLE } from '@/lib/pnl/dataSourceConstants';
```

---

## Validation Lanes (Do Not Compare Across)

> **CRITICAL:** Each validation lane targets a specific metric. Cross-lane comparisons produce meaningless results.

### Lane 1: Dome-Realized Validation
- **Engine output:** Realized PnL from V12 CashV2
- **Truth source:** Dome API `realizedPnL` field
- **Ledger:** V8 Full (includes payouts)
- **DO NOT COMPARE TO:** UI Total PnL, Synthetic Realized

### Lane 2: UI Total PnL Validation
- **Engine output:** Realized + Unrealized PnL
- **Truth source:** Polymarket UI tooltip (Playwright scrape)
- **Ledger:** V8 Full (includes CTF events for cash-flow accuracy)
- **DO NOT COMPARE TO:** Dome-Realized (which excludes unrealized)

### Lane 3: Synthetic Realized Validation
- **Engine output:** Realized PnL + unredeemed winning tokens
- **Truth source:** Internal consistency check
- **Ledger:** V9 CLOB (for V1 Leaderboard surface)
- **DO NOT COMPARE TO:** Dome-Realized (different semantics for unredeemed)

### Why This Matters

| Metric A | Metric B | Comparison Valid? | Why |
|----------|----------|-------------------|-----|
| Dome Realized | Dome Realized | YES | Same semantic |
| Dome Realized | UI Total | NO | UI includes unrealized |
| V9 CLOB PnL | V8 Full PnL | NO | Different event types |
| Synthetic Realized | Dome Realized | NO | Unredeemed token handling differs |

---

## Related Documents

- [PERSISTED_OBJECTS_MANIFEST.md](./PERSISTED_OBJECTS_MANIFEST.md) - Full table inventory
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - V1 Leaderboard wallet criteria
- [PNL_VOCABULARY_V1.md](./PNL_VOCABULARY_V1.md) - Metric definitions
