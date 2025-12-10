# Pipeline Integrity Status Report

**Date:** 2025-12-07
**Terminal:** Claude 1
**Status:** Ready for rebuild

---

## Executive Summary

Backfill duplicates confirmed and neutralized via wallet-aware dedupe view. Unified ledger should be rebuilt from normalized staging. Remaining high-error wallets are consistent with Polymarket subgraph's inventory-capped realized PnL model. Next work splits into pipeline rebuild and a UI-mimic realized engine variant.

---

## What is Now Proven

### 1. True Backfill Duplicates in pm_trader_events_v2
- Same `(event_id, wallet, role)` with **identical payloads**
- This is re-ingestion noise, NOT maker/taker duality
- **50% duplication rate** for tested wallets (866 rows → 433 unique)

### 2. Wallet-Aware Dedupe View is the Correct Fix
- Created: `vw_pm_trader_events_wallet_dedup_v2`
- Key: `(event_id, trader_wallet, role)`
- Uses `argMin(..., insert_time)` for deterministic picking
- **Original table is UNCHANGED**

### 3. Remaining Large UI Deltas Are Explainable
- Caused by Polymarket subgraph's **sell-cap rule** for untracked inventory
- Polymarket: "we don't give PnL for tokens obtained outside what we track"
- Our formula calculates PnL on negative inventory → causes large errors

---

## Architectural Story

| Chunk | Problem | Solution | Status |
|-------|---------|----------|--------|
| **A: Pipeline Hygiene** | Backfill duplicates | Normalized staging view | ✅ Done |
| **B: Definition Alignment** | Formula mismatch | UI-mimic engine variant | 📋 Spec ready |
| **C: Leaderboard Policy** | Integrity-risk wallets | Tiered cleanliness exclusion | ✅ Done |

---

## Key Philosophical Difference

| Approach | Source of Truth | Implication |
|----------|-----------------|-------------|
| **V29 (Ours)** | Final share balance | Negative inventory = huge PnL swings |
| **Polymarket Subgraph** | Tracked inventory only | Sells capped at what we tracked |

---

## Views Created (Non-Destructive)

### vw_pm_trader_events_wallet_dedup_v1
```sql
-- Key: (event_id, trader_wallet)
-- Simple dedupe with any() aggregation
GROUP BY event_id, trader_wallet
```

### vw_pm_trader_events_wallet_dedup_v2
```sql
-- Key: (event_id, trader_wallet, role)
-- Deterministic picking via argMin(..., insert_time)
GROUP BY event_id, trader_wallet, role
```

---

## Files Modified/Created

| File | Change | Destructive? |
|------|--------|--------------|
| `scripts/pnl/create-normalized-trader-events-view.ts` | Created V1 view | No |
| `scripts/pnl/create-normalized-trader-events-view-v2.ts` | Created V2 view | No |
| `scripts/pnl/materialize-v8-ledger.ts` | Updated to use V1 view | No (script only) |
| `lib/pnl/clobCleanlinessDbRules.ts` | Created tiered classifier | No |
| `docs/systems/pnl/POLYMARKET_SUBGRAPH_PNL_FORMULA.md` | Documented PM formula | No |

---

## Next Steps (Ordered by Risk)

### 1. Lock in Normalized Staging Layer
- Use `vw_pm_trader_events_wallet_dedup_v2` as upstream for all CLOB-derived data
- This eliminates debate about "real vs duplicate noise"

### 2. Full Rematerialization of Unified Ledger
- Run `materialize-v8-ledger.ts` (reads from normalized view)
- Creates new data alongside existing
- **Does NOT delete existing data**

### 3. Re-run Truth Checkpoint
Expected improvements:
- `DATA_MISSING_CLOB_PRIMARY_PRESENT_IN_TRADER_EVENTS` tag should collapse
- Significant jump in TIER_A/B wallets

### 4. Split Validation into Two Targets

**Target A: Ledger-Correct PnL**
- Current V29 formula
- Strict cleanliness exclusion
- Best for internal analytics

**Target B: UI-Mimic Realized PnL**
- Implement avg-cost + sell-cap logic
- Compare against Dome/UI realized
- Separate engine variant (V30)

### 5. UI-Mimic Engine Prototype (Optional)
Minimal implementation:
```typescript
// Per wallet-position running state
interface PositionState {
  avgPrice: number;
  amount: number;
  realizedPnl: number;
}

// On buy:
newAvgPrice = (avgPrice * amount + buyPrice * buyAmount) / (amount + buyAmount)
amount += buyAmount

// On sell:
adjustedAmount = Math.min(sellAmount, amount)
realizedPnl += adjustedAmount * (sellPrice - avgPrice)
amount -= adjustedAmount
```

---

## Validation Checklist

### After Rebuild
- [ ] Normalized view row count matches expected dedupe
- [ ] Unified ledger CLOB count increased (maker+taker included)
- [ ] Negative inventory flags decreased
- [ ] TIER_A/B wallet count increased
- [ ] Known outliers still flagged as TIER_C

### For UI Parity (Future)
- [ ] V30 engine matches Dome realized for clean wallets
- [ ] Negative inventory wallets show capped PnL (not huge swings)
- [ ] Rounding matches UI (cents, not sub-cent)

---

## Safety Notes

- **NO DATA WAS DELETED**
- **NO TABLES WERE MODIFIED**
- All changes are:
  - New views (non-destructive)
  - Script updates (not run yet for full rebuild)
  - Documentation

The original `pm_trader_events_v2` and `pm_unified_ledger_v8_tbl` remain intact.
