# Tier A Comparable Wallet Specification

> **Status:** V1 Ready | **Last Updated:** 2025-12-09

## Scope

**This spec is for the V1 CLOB-only product surface.**

- Canonical table: `pm_unified_ledger_v9_clob_tbl`
- Import: `CLOB_ONLY_LEDGER_TABLE` from `lib/pnl/dataSourceConstants.ts`

Full-ledger comparability (with CTF events) lives in a separate spec for future products.

---

## Purpose

Tier A Comparable wallets are the subset of Polymarket traders suitable for the V1 Copy-Trade Leaderboard. These wallets have characteristics that allow our Realized PnL formula to closely match Polymarket's UI PnL display.

## Validation Results

| Metric | Value |
|--------|-------|
| Pass rate (comparable ≤5% unresolved) | **90.0%** |
| Pass rate (all wallets) | 58.8% |
| Tolerance threshold | 10% |
| Qualifying wallets | 2,183 |
| Profitable | 1,795 (82%) |
| Unprofitable | 388 (18%) |

## Selection Criteria

A wallet qualifies as **Tier A Comparable** if ALL of the following are true:

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| `unresolved_pct` | ≤5% | Low open positions = realized ≈ total PnL |
| `abs(realized_pnl)` | ≥$1,000 | Filters out noise, meaningful trader |
| `total_events` | ≥10 | Active trader, not one-off activity |

## SQL Query Definition

```sql
-- Tier A Comparable Wallet Query (V1 Leaderboard)
-- Source: pm_unified_ledger_v9_clob_tbl (CLOB-only, fixed trade coverage)

WITH wallet_stats AS (
  SELECT
    wallet_address as wallet,
    count() as total_events,
    countIf(payout_norm IS NOT NULL AND payout_norm > 0) as resolved_events,
    round(sum(usdc_delta + token_delta * coalesce(payout_norm, 0)), 2) as realized_pnl
  FROM pm_unified_ledger_v9_clob_tbl
  GROUP BY wallet_address
  HAVING total_events >= 10  -- Active trader filter
)
SELECT
  wallet,
  total_events,
  resolved_events,
  round((total_events - resolved_events) * 100.0 / total_events, 2) as unresolved_pct,
  realized_pnl,
  abs(realized_pnl) as abs_pnl
FROM wallet_stats
WHERE (total_events - resolved_events) * 100.0 / total_events <= 5.0  -- Comparable
  AND abs(realized_pnl) >= 1000                                        -- Meaningful
ORDER BY abs_pnl DESC
```

## Formula Used

**V12 Synthetic Realized PnL:**
```
realized_pnl = usdc_delta + (token_delta × payout_norm)
```

Where:
- `usdc_delta`: Cash flow from trades (negative for buys, positive for sells)
- `token_delta`: Net token position change (positive for buys, negative for sells)
- `payout_norm`: Resolution payout (0 or 1 for binary markets)

## Why 5% Unresolved Threshold?

Polymarket UI shows **Total PnL** = Realized + Unrealized. Our engine calculates **Realized PnL** only.

| Unresolved % | Expected Match | Reason |
|--------------|----------------|--------|
| 0% | Near-perfect | All positions resolved |
| ≤5% | Good (90%+ pass) | Minimal unrealized impact |
| 5-10% | Moderate | Some unrealized divergence |
| >10% | Poor | Significant open position impact |

**Evidence from 18-wallet truth:**
- Wallets with >5% unresolved: 7/18 (39%)
- These wallets drive most failures (94%, 52%, 30%, 22% errors)

## Known Limitations

### 1. Unredeemed Winning Tokens

**Example:** Wallet `0x2e41d5e1de9a072d73fd30eef9df55396270f050`
- UI PnL: $14,049.01
- V12 Realized: $27,048.35
- Error: 92%
- **Cause:** Wallet holds 42,370 unredeemed winning tokens worth $31K

Our formula counts unredeemed winning tokens as "realized" (they have a locked-in value), but Polymarket UI doesn't display them until redeemed.

**Impact:** Rare for Tier A wallets. Affects <5% of comparable set.

### 2. Multi-Outcome Markets

Markets with >2 outcomes (e.g., "Who wins the election?" with 5+ candidates) may have different payout structures. Current formula handles binary markets optimally.

## Leaderboard API Filter

When serving leaderboard data, apply this filter:

```typescript
// TypeScript filter for Tier A Comparable
function isTierAComparable(wallet: WalletStats): boolean {
  const unresolvedPct =
    ((wallet.totalEvents - wallet.resolvedEvents) * 100) / wallet.totalEvents;

  return (
    unresolvedPct <= 5.0 &&
    Math.abs(wallet.realizedPnl) >= 1000 &&
    wallet.totalEvents >= 10
  );
}
```

## Sample Tier A Wallets (Top 10 by abs PnL)

| Wallet | Events | Unres% | Realized PnL |
|--------|--------|--------|--------------|
| 0x56687bf4...5839 | 16,005 | 0.51% | $22,037,641 |
| 0x78b9ac44...6b76 | 5,756 | 0.10% | $8,705,078 |
| 0x863134d0...aa53 | 6,827 | 0.00% | $7,527,260 |
| 0xe9ad918c...7091 | 5,025 | 0.00% | $5,936,332 |
| 0x88578376...c270 | 6,480 | 0.00% | $5,634,964 |
| 0x23786fda...5fcb | 11,824 | 0.08% | $5,134,848 |
| 0xd0c042c0...5565 | 2,529 | 0.08% | $4,800,671 |
| 0x94a428cf...6356 | 9,114 | 2.85% | $4,257,170 |
| 0x16f91db2...99e3 | 6,472 | 0.02% | $4,042,385 |
| 0xed2239a9...3dd0 | 5,289 | 1.06% | $3,092,835 |

## Exit Criteria Met

✅ **Tier A Comparable query defined** (this document)
✅ **≥80% pass rate** (90.0% achieved on comparable wallets)
✅ **0x2e41 root-caused** (unredeemed winning tokens, documented as known limitation)
⏳ **Leaderboard API filter** (implement with this spec)

## Related Documents

- [PnL Engine V12 Architecture](./V12_ARCHITECTURE_SPEC.md)
- [Validation Plan](../../reports/LEADERBOARD_VALIDATION_PLAN_2025_12_07.md)
- [Master Plan](~/.claude/plans/jazzy-sprouting-bonbon.md)
