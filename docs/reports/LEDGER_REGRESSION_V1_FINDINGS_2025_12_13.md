# Ledger Regression V1 Findings

**Date:** 2025-12-13
**Status:** 0/7 wallets passing
**Blocker:** Missing CTF redemption data and incomplete token mappings

---

## Summary

Attempted to calculate PnL for 7 regression wallets using the formula:
```
PnL = trade_cash_flow + ctf_cash_flow + settlement_value
```

Results: **0/7 passing**, all wallets have large discrepancies from UI.

---

## Key Findings

### 1. CTF Redemption Data Not Loading into Ledger

The `pm_ctf_events` table has redemption data for wallet `0xf9fc56e1` ($5,530 in payouts), but:
- The INSERT ... SELECT command silently fails in ClickHouse
- Workaround exists: fetch data first, then batch insert via JS mapping
- The ledger build script needs to be updated to use this workaround

### 2. Token ID → Condition Mapping Incomplete

Many tokens in `pm_regression_ledger_v1` don't have mappings in `vw_pm_ledger`:
- Wallet 0x88cee1fe: 20+ tokens missing mappings
- Wallet 0x46e669b5: 8 tokens missing mappings
- Without mapping, cannot lookup resolution prices

### 3. Large Unresolved Positions

All wallets have significant unresolved positions:
| Wallet | Unresolved Shares |
|--------|-------------------|
| 0x1e8d... | 36,637 |
| 0x13cb... | 10,284 |
| 0xadb7... | 10,284 |
| 0xf9fc... | 2,799 |
| 0x46e6... | 2,549 |
| 0x88ce... | 1,675 |
| 0xf70a... | 521 |

For unresolved markets, the UI likely shows:
- **Realized PnL** = cash flow from resolved positions
- **Unrealized PnL** = (current_price - avg_cost) × shares held

Our calculation only includes resolved positions, missing unrealized PnL.

### 4. Data Quality Issue: Negative Share Positions

Patapam222 (0xf70acdab) shows impossible positions:
- Token 109612...: -260.65 shares (SOLD more than BOUGHT)
- No corresponding CTF mint events found
- No ERC1155 transfers found

This suggests either:
1. Missing data source (minting via different mechanism)
2. Data quality issue in pm_trader_events_v2
3. UI calculates differently for edge cases

---

## Regression Results

| Wallet | Calc PnL | UI PnL | Delta | Issue |
|--------|----------|--------|-------|-------|
| 0xadb7 | -$5,626 | -$1,593 | -$4,033 | Missing CTF, unresolved |
| 0xf9fc | -$400 | $1,618 | -$2,018 | CTF not loaded, missing mappings |
| 0xf70a | $341 | $40 | $301 | Unresolved short positions |
| 0x13cb | $9,722 | $9 | $9,714 | Large unresolved position |
| 0x46e6 | -$1,337 | -$5 | -$1,333 | Many missing mappings |
| 0x88ce | $1,103 | -$68 | $1,170 | 20+ missing mappings |
| 0x1e8d | $27,427 | $4,161 | $23,266 | Huge unresolved position |

---

## Root Causes

1. **CTF INSERT fails silently** - ClickHouse INSERT ... SELECT from pm_ctf_events completes but inserts 0 rows. Requires fetch-then-insert workaround.

2. **vw_pm_ledger mapping incomplete** - Not all token_ids have condition_id mappings. Need to build a dedicated token → condition mapping table.

3. **Formula doesn't handle unrealized PnL** - For unresolved markets, we're treating positions as worth $0. UI likely uses current market prices.

4. **Possible data duplication** - pm_trader_events_v2 has 2x duplicates for some trades (backfill issue). Current GROUP BY event_id doesn't fully dedupe.

---

## Recommended Next Steps

### Immediate (to unblock progress)

1. **Fix CTF data loading**
   - Update build-regression-ledger.ts to use fetch-then-insert pattern
   - Re-run ledger build and regression test

2. **Build token→condition mapping table**
   - Create `pm_token_condition_map` from vw_pm_ledger
   - Materialize for fast lookup

### Short-term

3. **Add unrealized PnL calculation**
   - For unresolved positions, use current market price
   - Formula: `unrealized_pnl = (current_price - avg_cost) × net_shares`

4. **Investigate data quality issues**
   - Trace impossible negative positions to root cause
   - Determine if pm_trader_events_v2 needs additional dedup logic

### Medium-term

5. **Cross-validate with known good source**
   - Compare against Polymarket API directly for sample wallets
   - Document exact formula UI uses

---

## Files Created

- `scripts/pnl/build-regression-ledger.ts` - Builds materialized ledger
- `scripts/pnl/check-resolution-pnl.ts` - Per-token resolution check
- `scripts/pnl/regression-summary-v1.ts` - Full regression test
- `lib/pnl/__tests__/fixtures/ui-regression-wallets.json` - Test fixtures

---

## Technical Details

### ClickHouse INSERT Issue

INSERT ... SELECT from pm_ctf_events completes without error but inserts 0 rows:
```sql
-- This silently fails:
INSERT INTO target_table
SELECT ... FROM pm_ctf_events WHERE wallet = '...'

-- Workaround: Fetch then batch insert
const rows = await clickhouse.query({ query: 'SELECT ...' });
await clickhouse.insert({ table: 'target_table', values: rows });
```

### Token ID Format

Trade data uses numeric token_id (ERC1155 position ID):
```
109612312495067640558838633989701459337742301251106810966580588890274721616442
```

CTF events use hex condition_id:
```
da2699840a84b3388cf1162df4b8d4e249a22c44380e55d7820e25c1513121b0
```

Mapping requires vw_pm_ledger which has both, but coverage is incomplete.

---

**Report Generated:** 2025-12-13T21:30:00Z
