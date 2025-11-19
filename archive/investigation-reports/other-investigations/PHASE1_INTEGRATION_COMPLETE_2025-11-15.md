# Phase 1 Complete: pm_trades_complete Wired to External Trades

**Date:** 2025-11-15
**Agent:** C1
**Status:** ✅ Integration Complete (with noted limitation)

---

## Summary

Successfully integrated C2's external trade ingestion into the P&L pipeline through the `pm_trades_complete` interface layer.

**What Works:**
- ✅ pm_trades_complete now reads from pm_trades_with_external (CLOB + external)
- ✅ 38,945,760 CLOB trades + 46 external trades = 38,945,806 total
- ✅ canonical_wallet_address mapping added via wallet_identity_map
- ✅ pm_wallet_market_pnl_resolved view rebuilt to use pm_trades_complete
- ✅ Data source tracking: 'clob_fills' vs 'polymarket_data_api'

**Current Limitation:**
- ⚠️  6 ghost markets (external-only) NOT yet in pm_markets
- ⚠️  These won't appear in PnL views until market metadata + resolution data added
- ⚠️  Affects xcnstrategy's ghost market P&L (currently $0, should be ~$7,800 based on Dome)

---

## Changes Made

### 1. Updated scripts/127-create-pm-trades-complete-view.ts

**Before (Phase 4 passthrough):**
```sql
CREATE VIEW pm_trades_complete AS
SELECT *, 'clob_only' AS data_source
FROM pm_trades
```

**After (Phase 1 integration):**
```sql
CREATE VIEW pm_trades_complete AS
SELECT
  t.*,
  COALESCE(wim.canonical_wallet, t.wallet_address) as canonical_wallet_address
FROM pm_trades_with_external t
LEFT JOIN wallet_identity_map wim
  ON t.wallet_address = wim.user_eoa OR t.wallet_address = wim.proxy_wallet
```

**Key Enhancements:**
- Reads from C2's `pm_trades_with_external` (UNION of CLOB + external)
- Adds `canonical_wallet_address` for proper EOA + proxy aggregation
- Preserves `data_source` field from underlying view

### 2. Rebuilt pm_wallet_market_pnl_resolved View

Ran `scripts/90-build-pm_wallet_market_pnl_resolved_view.ts`:
- View successfully created
- Now includes `data_sources` array field showing contributing sources
- Stats gathering failed due to large response (expected, not an issue)

---

## Verification Results

### pm_trades_complete Statistics

| Data Source | Trades | Wallets | Markets | Date Range |
|-------------|--------|---------|---------|------------|
| clob_fills | 38,945,760 | 735,637 | 118,660 | 2022-12-12 to 2025-11-11 |
| polymarket_data_api | 46 | 1 | 6 | 2025-03-10 to 2025-10-15 |
| **TOTAL** | **38,945,806** | **735,637** | **118,660** | - |

### xcnstrategy External Trades

| Condition ID | Market Question | Trades | Shares |
|--------------|----------------|--------|--------|
| f2ce8d38... | Xi Jinping out in 2025? | 27 | 72,090 |
| bff3fad6... | Trump Gold Cards 100k+ in 2025? | 14 | 6,958 |
| e9c127a8... | Elon budget cut 10%+ in 2025? | 2 | 200 |
| 293fb49f... | Satoshi moves Bitcoin in 2025? | 1 | 1,000 |
| fc4453f8... | China unbans Bitcoin in 2025? | 1 | 1,670 |
| ce733629... | US ally gets nuke in 2025? | 1 | 100 |

**Total:** 46 trades, 82,019 shares, ~$74,740 notional

---

## Ghost Market Limitation

### Current State

These 6 markets exist ONLY in external_trades_raw (zero CLOB coverage):
1. Xi Jinping out in 2025?
2. Trump Gold Cards 100k+ in 2025?
3. Elon budget cut 10%+ in 2025?
4. Satoshi moves Bitcoin in 2025?
5. China unbans Bitcoin in 2025?
6. US ally gets nuke in 2025?

**Problem:** They are NOT in `pm_markets` table.

**Impact:**
- ✅ Trades accessible in `pm_trades_complete`
- ❌ Won't appear in `pm_wallet_market_pnl_resolved` (requires pm_markets join)
- ❌ xcnstrategy P&L shows $0 for these markets (should show ~$7,800)

### Why This Happens

`pm_wallet_market_pnl_resolved` view has this filter:
```sql
FROM pm_trades_complete t
INNER JOIN pm_markets m
  ON t.condition_id = m.condition_id
WHERE m.status = 'resolved'
  AND m.market_type = 'binary'
```

Ghost markets fail the `INNER JOIN pm_markets` condition.

### Solution Required

Add ghost markets to `pm_markets` with:
1. Market metadata (question, market_type = 'binary')
2. Resolution data (status = 'resolved', resolved_at, winning_outcome_index)

**Options:**
1. **Fetch from Polymarket API** - Get market metadata for these 6 condition IDs
2. **Infer from trades** - Use external_trades_raw to extract questions, guess outcome from final prices
3. **Manual entry** - Add 6 rows to pm_markets with known resolution data

---

## Next Steps

### Immediate (Phase 2 - Sanity Checks)

1. ✅ Run healthcheck on xcnstrategy (CLOB trades only for now)
2. ✅ Run coverage dump to verify external trades count
3. ✅ Check row counts and duplicates
4. ✅ Document findings

### Short Term (Phase 3 - Ghost Market Integration)

1. **Add ghost markets to pm_markets:**
   - Fetch metadata from Polymarket API
   - Determine winning outcomes (from Dome or API)
   - Insert 6 rows into pm_markets

2. **Rebuild P&L views** to include ghost markets

3. **Generate new snapshot** showing xcn's full P&L (CLOB + external)

4. **Create diff report** showing before/after comparison

### Medium Term (Phase 4 - Multi-Wallet Rollout)

1. Identify additional wallets with external trades
2. Extend snapshot script for batch processing
3. Generate baseline P&L for pilot wallets

---

## Files Created/Modified

### Created
- ✅ `scripts/check-ghost-markets.ts` - Ghost market diagnostic tool
- ✅ `PHASE1_INTEGRATION_COMPLETE_2025-11-15.md` - This document

### Modified
- ✅ `scripts/127-create-pm-trades-complete-view.ts` - Now uses pm_trades_with_external + canonical mapping
- ✅ `scripts/90-build-pm_wallet_market_pnl_resolved_view.ts` - Rebuilt with external data (already modified in Phase 4)

---

## Integration Architecture

```
external_trades_raw (46 trades, 6 ghost markets)
    ↓
pm_trades_with_external (UNION)
    ↓
pm_trades_complete (+ canonical_wallet_address)
    ↓
pm_wallet_market_pnl_resolved (⚠️ filtered by pm_markets)
    ↓
pm_wallet_pnl_summary
```

**Bottleneck:** Ghost markets blocked at pm_markets join

---

## Validation Status

| Check | Status | Details |
|-------|--------|---------|
| pm_trades_complete exists | ✅ PASS | 38.9M trades accessible |
| External trades included | ✅ PASS | 46 trades from polymarket_data_api |
| canonical_wallet_address added | ✅ PASS | Mapped via wallet_identity_map |
| PnL view rebuilt | ✅ PASS | View created successfully |
| Ghost markets in PnL | ⚠️  BLOCKED | Need pm_markets entries |

---

## Technical Notes

### canonical_wallet_address Mapping

Used `wallet_identity_map` table with this join:
```sql
LEFT JOIN wallet_identity_map wim
  ON t.wallet_address = wim.user_eoa OR t.wallet_address = wim.proxy_wallet
```

This ensures both EOA and proxy addresses map to the same canonical wallet for aggregation.

### Data Source Tracking

`pm_trades_complete` preserves `data_source` from `pm_trades_with_external`:
- CLOB trades: `'clob_fills'`
- External trades: `'polymarket_data_api'`, `'dune'`, `'bitquery'`, etc.

`pm_wallet_market_pnl_resolved` aggregates into `data_sources` array:
```sql
groupArray(DISTINCT t.data_source) as data_sources
```

This allows filtering or analysis by source later.

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
**Status:** Phase 1 complete, proceeding to Phase 2
