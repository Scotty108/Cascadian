# Data Source Policy: pm_trades_complete as Canonical Source

**Effective Date:** 2025-11-15
**Status:** ACTIVE

---

## Policy Statement

**ALL new analytics, P&L calculations, Omega metrics, and leaderboards MUST use `pm_trades_complete` as the canonical trade source.**

---

## Why pm_trades_complete?

`pm_trades_complete` is the **interface layer** that integrates:

1. **CLOB trades** (38.9M trades from clob_fills)
2. **External trades** (46+ trades from polymarket_data_api, Dome, etc.)
3. **Canonical wallet mapping** (EOA + proxy aggregation via wallet_identity_map)
4. **Data source tracking** (preserves 'clob_fills' vs 'polymarket_data_api' tags)

## Architecture

```
external_trades_raw (C2 ingestion)
    ↓
pm_trades_with_external (UNION of CLOB + external)
    ↓
pm_trades_complete (+ canonical_wallet_address) ← USE THIS
    ↓
pm_wallet_market_pnl_resolved
    ↓
pm_wallet_pnl_summary
    ↓
Omega & Leaderboards
```

---

## DO NOT Use

❌ **pm_trades** - CLOB-only, excludes external trades
❌ **pm_trades_with_external** - Missing canonical_wallet_address field
❌ **clob_fills** - Raw CLOB data, unprocessed

---

## Known Issues

### Duplicate Trades (194 rows, 0.0005%)

**Cause:** LEFT JOIN with OR condition in canonical wallet mapping:
```sql
LEFT JOIN wallet_identity_map wim
  ON t.wallet_address = wim.user_eoa OR t.wallet_address = wim.proxy_wallet
```

**Impact:**
- ~194 trades duplicated out of 38.9M (0.0005%)
- Does NOT affect xcnstrategy
- P&L views use GROUP BY which deduplicates automatically

**Mitigation:** All aggregate views use GROUP BY, which eliminates duplicates during aggregation.

**Fix Priority:** Low - scheduled for future View revision

**Backlog Ticket:** Add DISTINCT or refine JOIN logic to prevent fan-out

---

## Usage Examples

### ✅ Correct

```sql
-- PnL calculation
SELECT
  canonical_wallet_address,
  SUM(pnl_net) as total_pnl
FROM pm_trades_complete t
JOIN pm_markets m ON t.condition_id = m.condition_id
WHERE m.status = 'resolved'
GROUP BY canonical_wallet_address

-- Omega calculation
SELECT
  canonical_wallet_address,
  COUNT(*) as trades,
  data_source
FROM pm_trades_complete
GROUP BY canonical_wallet_address, data_source

-- Leaderboard
SELECT wallet_address, ...
FROM pm_wallet_market_pnl_resolved  -- Already uses pm_trades_complete
WHERE ...
```

### ❌ Incorrect

```sql
-- DON'T DO THIS - excludes external trades
SELECT * FROM pm_trades WHERE ...

-- DON'T DO THIS - missing canonical_wallet_address
SELECT * FROM pm_trades_with_external WHERE ...
```

---

## Verification

To verify you're using the correct source:

```sql
-- Check if query uses pm_trades_complete
EXPLAIN SELECT ... FROM pm_trades_complete ...

-- Verify external trades are included
SELECT data_source, COUNT(*)
FROM pm_trades_complete
GROUP BY data_source
-- Should show: clob_fills + polymarket_data_api
```

---

## Updates to This Policy

Any changes to the canonical source must be:
1. Documented in this file with version history
2. Announced in project communication channels
3. Accompanied by migration guide for existing queries

---

**Version:** 1.0
**Last Updated:** 2025-11-15
**Owner:** C1
