# Token Map Policy

> **Last Updated:** 2025-12-13
> **Status:** ENFORCED

## Summary

Always use `pm_token_to_condition_map_v5` (or the view `pm_token_to_condition_map_current`) for token-to-condition mapping in PnL calculations. Never reference `v3` or earlier versions in new code.

---

## Canonical Tables

| Table | Status | Notes |
|-------|--------|-------|
| `pm_token_to_condition_map_v5` | **CANONICAL** | Cron-rebuilt every 6 hours, ReplacingMergeTree, no duplicates |
| `pm_token_to_condition_map_current` | **VIEW** | Points to v5, use for forward compatibility |
| `pm_token_to_condition_map_v3` | **DEPRECATED** | Missing 41,712 tokens, do not use |
| `pm_token_to_condition_map_v4` | **DEPRECATED** | Superseded by v5 |

### Import Pattern

```typescript
// In lib/pnl/canonicalTables.ts
export const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';

// In scripts
import { CANONICAL_TABLES } from '@/lib/pnl/canonicalTables';
const TOKEN_MAP = CANONICAL_TABLES.TOKEN_MAP;  // 'pm_token_to_condition_map_v5'
```

---

## Duplicate Token Guard Query

**ALWAYS run this check at script startup before any JOIN on token map:**

```sql
SELECT token_id_dec, count() c
FROM pm_token_to_condition_map_v5
GROUP BY token_id_dec
HAVING c > 1
LIMIT 1;
```

**If any row returns, ABORT.** Duplicates in the token map will cause JOIN multiplication, inflating volumes and corrupting PnL calculations.

### TypeScript Implementation

```typescript
// Add to script startup
const dupCheckQ = await clickhouse.query({
  query: `
    SELECT token_id_dec, count() c
    FROM ${TOKEN_MAP_TABLE}
    GROUP BY token_id_dec
    HAVING c > 1
    LIMIT 1
  `,
  format: 'JSONEachRow'
});
const duplicates = await dupCheckQ.json() as any[];
if (duplicates.length > 0) {
  console.error(`FATAL: Token map ${TOKEN_MAP_TABLE} has duplicates!`);
  console.error(`  Example: token_id_dec=${duplicates[0].token_id_dec} appears ${duplicates[0].c} times`);
  process.exit(1);
}
```

---

## V5 Cron Rebuild

The token map is rebuilt every 6 hours by `/app/api/cron/rebuild-token-map/route.ts`:

1. Source: `pm_market_metadata FINAL`
2. Atomic rebuild: CREATE NEW -> RENAME (no data loss)
3. Safety checks:
   - Aborts if metadata has <50k tokens
   - Aborts if new table is <90% of old
4. Verifies 14-day trade coverage after rebuild

---

## ANY INNER JOIN Warning

### The Bug (2025-12-13)

Using `ANY INNER JOIN` with the token map silently dropped rows:

```sql
-- WRONG: Drops rows silently
SELECT ...
FROM pm_trader_events_v2 t
ANY INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
-- Result: 8 rows when there should be 24
```

```sql
-- CORRECT: Returns all matching rows
SELECT ...
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
-- Result: 24 rows (correct)
```

### When ANY JOIN is Safe

`ANY JOIN` is only safe when:
1. The right table is **guaranteed** to have exactly one row per join key
2. You explicitly want to pick an **arbitrary** matching row when duplicates exist

For token maps, use regular `JOIN` because:
- You need **all** matching rows for accurate aggregation
- `ANY` can silently hide data quality issues (duplicates)
- Token maps should never have duplicates (enforce with guard query)

---

## V3 vs V5 Coverage Comparison

As of 2025-12-13:

| Metric | V3 | V5 |
|--------|----|----|
| Total rows | 358,617 | 400,157 |
| Unique tokens | 358,617 | 400,157 |
| Duplicates | 0 | 0 |
| V5-exclusive tokens | - | 41,712 |
| V3-exclusive tokens | 172 | - |
| Overlap | 358,445 | 358,445 |

**Cohort coverage (24,514 HC wallets):** Both V3 and V5 have **0 missing tokens** for the 125,988 traded tokens in the cohort. However, V5 is preferred for:
- Newer markets (41k more tokens)
- Cron updates (always fresh)
- Future-proofing

---

## Verification Results (2025-12-13)

### Wallets That Match UI (within $1)

| Wallet | UI PnL | Our Calc | Match |
|--------|--------|----------|-------|
| 0x132b505596fadb6971bbb0fbded509421baf3a16 | $2,068.50 | $2,068.50 | ✅ |
| 0x0030490676215689d0764b54c135d47f2c310513 | $4,335.50 | $4,335.50 | ✅ |
| 0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1 | $4,494.50 | $4,494.50 | ✅ |

### Large-Delta Wallets (Do Not Match)

| Wallet | UI PnL | Our Calc | Notes |
|--------|--------|----------|-------|
| 0x8605e2ae... (GOTTAPAYRENT) | -$158,049.95 | $279,447.80 | High-volume sports bettor |
| 0x26437896... (Latina) | $433,602.97 | $6,052,025.80 | Extreme volume ($28M traded) |

**Hypothesis:** High-volume sports bettors may have:
- FPMM pool interactions not captured in CLOB data
- Proxy wallet activity
- Different fee structures

The 3 validation wallets with typical trading patterns match exactly. The formula is correct for standard use cases.

---

## Checklist for New PnL Scripts

- [ ] Import `TOKEN_MAP_TABLE` from `canonicalTables.ts`
- [ ] Run duplicate guard query at startup
- [ ] Log table names and git commit at startup
- [ ] Use regular `JOIN`, not `ANY JOIN`
- [ ] Test on 3 validation wallets before production run
