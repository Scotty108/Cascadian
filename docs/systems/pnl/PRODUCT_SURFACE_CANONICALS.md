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

## Related Documents

- [PERSISTED_OBJECTS_MANIFEST.md](./PERSISTED_OBJECTS_MANIFEST.md) - Full table inventory
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - V1 Leaderboard wallet criteria
- [PNL_VOCABULARY_V1.md](./PNL_VOCABULARY_V1.md) - Metric definitions
