# V2 Total PnL Implementation Plan

**Created:** 2025-12-07
**Status:** Planning Complete
**Estimated Effort:** 8-12 hours

---

## Executive Summary

V1 leaderboard ships with realized-only PnL validated against Dome at 71% pass rate. V2 adds unrealized PnL to match Polymarket UI total. The V29 engine already has the structural foundation - the key gap is injecting real market prices instead of the hardcoded `0.5` placeholder.

---

## Current Architecture Analysis

### Existing Components

1. **PnL Engines:**
   - `pnlComposerV1.ts` - Main orchestrator (realized-only)
   - `realizedUiStyleV2.ts` - Current realized engine (FIFO/inventory-based)
   - `inventoryEngineV29.ts` - Most advanced engine with `uiParityPnl`, `unrealizedPnl`, and `resolvedUnredeemedValue`

2. **Price Data Sources (Already Implemented):**
   - `pm_market_metadata.outcome_prices` - **UI's actual price source** (validated in V23c)
   - `pm_condition_resolutions.payout_numerators` - Resolution prices
   - `v23cBatchLoaders.ts` - Batch price loading already implemented

3. **Validation Infrastructure:**
   - `validationThresholds.ts` - Unified pass/fail logic (6% for large, $10 for small)
   - `uiTruthLoader.ts` - Loads UI PnL benchmarks from multiple sources
   - `fetch-polymarket-profile-pnl.ts` - Playwright-based live UI scraping

4. **Key Finding:** The V29 engine already calculates all three PnL components:
   - `realizedPnl` - From actual cash events
   - `unrealizedPnl` - Using 0.5 as default mark price (placeholder)
   - `resolvedUnredeemedValue` - Resolved but not redeemed positions

---

## Architecture Decision: Extend V29

**Recommendation: Extend V29 Engine**

The V29 engine already has the structural foundation for total PnL. The gap is that it uses a hardcoded `0.5` as the mark price for unrealized positions:

```typescript
// From inventoryEngineV29.ts, line 343
const markPrice = 0.5;  // <-- This needs to use pm_market_metadata.outcome_prices
```

Rather than creating a new engine, we should:
1. Inject real-time prices into V29's unrealized calculation
2. Create a "UI Parity Mode" that uses pm_market_metadata.outcome_prices

---

## Data Sources for Current Prices

### Primary Source: `pm_market_metadata.outcome_prices`

This is the **same source the Polymarket UI uses** (validated in V23c report). The V23c batch loaders already implement this:

```typescript
// From v23cBatchLoaders.ts - loadV23cUIPricesBatch()
SELECT
  lower(condition_id) as condition_id,
  outcome_prices
FROM pm_market_metadata
WHERE lower(condition_id) IN ({conditions:Array(String)})
  AND outcome_prices IS NOT NULL
```

**Data Format:** JSON string array like `["0.385", "0.614"]` where indices map to outcome_index.

### Trade-offs

| Source | Pros | Cons |
|--------|------|------|
| `pm_market_metadata.outcome_prices` | Same as UI, pre-computed | May be stale (sync frequency) |
| CLOB mid-price (live fetch) | Most accurate | Requires API call, rate limits |
| Last trade price | Available in our data | Can be stale for illiquid markets |

**Recommendation:** Use `pm_market_metadata.outcome_prices` as primary source with fallback to last trade price for missing markets.

---

## Implementation Steps

### Phase 1: Price Oracle Integration (2-3 hours)

1. **Create `lib/pnl/priceOracle.ts`**
   - Batch fetch prices from `pm_market_metadata.outcome_prices`
   - Handle JSON parsing edge cases (double-escaped strings)
   - Cache prices for wallet batch processing
   - Fallback to 0.5 for markets without prices

2. **Extend V29 Engine**
   - Add `markPrices: Map<string, Map<number, number>>` parameter
   - Replace hardcoded `0.5` with lookup from price map
   - Update `calculateUnrealizedPnl()` to use injected prices

### Phase 2: Integration with Composer (2-3 hours)

1. **Create `lib/pnl/totalPnlComposer.ts` (or extend `pnlComposerV1.ts`)**
   - Input: wallet address
   - Steps:
     1. Load ledger events (existing)
     2. Load resolution prices (existing)
     3. Load market prices from oracle (new)
     4. Run V29 with injected prices
     5. Return `{ realizedPnl, unrealizedPnl, totalPnl }`

2. **Add UI Parity Mode Flag**
   ```typescript
   interface TotalPnlOptions {
     mode: 'realized_only' | 'ui_parity';  // ui_parity includes unrealized
     priceSource: 'metadata' | 'clob_live';
   }
   ```

### Phase 3: Validation Harness (2-3 hours)

1. **Create `scripts/pnl/validate-v2-total-pnl.ts`**
   - Fetch UI total PnL using Playwright (existing infrastructure)
   - Calculate V2 total PnL
   - Compare with existing threshold logic
   - Report pass/fail rates

2. **Extend Benchmark Table**
   - Add `ui_total_pnl` column to `pm_ui_pnl_benchmarks_v2`
   - Store both realized and total benchmarks

### Phase 4: Testing and Validation (2-3 hours)

1. **Unit Tests for Price Oracle**
   - Mock price loading
   - Test fallback behavior
   - Test stale price handling

2. **Integration Tests**
   - Test 50 benchmark wallets with known UI values
   - Compare realized + unrealized vs UI total
   - Document pass rate (target: 70%+)

---

## Key Implementation Details

### Price Lookup Logic

```typescript
// Proposed: lib/pnl/priceOracle.ts
export async function loadMarketPrices(conditionIds: string[]): Promise<Map<string, Map<number, number>>> {
  // 1. Query pm_market_metadata.outcome_prices
  // 2. Parse JSON arrays with double-escape handling
  // 3. Return Map<condition_id, Map<outcome_index, price>>
}

export function getMarkPrice(
  conditionId: string,
  outcomeIndex: number,
  priceMap: Map<string, Map<number, number>>,
  defaultPrice: number = 0.5
): number {
  return priceMap.get(conditionId)?.get(outcomeIndex) ?? defaultPrice;
}
```

### V29 Unrealized Modification

```typescript
// Current (inventoryEngineV29.ts line 343)
const markPrice = 0.5;

// Proposed
const markPrice = this.getMarkPriceForPosition(conditionId, outcomeIndex);

// Where getMarkPriceForPosition() checks injected priceMap with 0.5 fallback
```

### Total PnL Formula

```
Total PnL = Realized PnL + Unrealized PnL + Resolved Unredeemed Value

Where:
- Realized PnL = Sum of (sell_revenue - cost_basis) for all closed positions
- Unrealized PnL = Sum of (shares * current_price - cost_basis) for unresolved open positions
- Resolved Unredeemed = Sum of (shares * resolution_price - cost_basis) for resolved but unredeemed
```

This matches V29's existing structure - we just need to inject real prices for unrealized.

---

## Validation Approach

### Benchmark Strategy

1. **Source of Truth:** Polymarket UI total PnL (scraped via Playwright)
2. **Capture Method:** Use `fetch-polymarket-profile-pnl.ts` with retries
3. **Storage:** Extend `pm_ui_pnl_benchmarks_v2` or create v3

### Validation Threshold (Same as V1)

```typescript
// From validationThresholds.ts
UI_THRESHOLDS = {
  pctThreshold: 5,      // 5% for |PnL| >= $200
  absThreshold: 10,     // $10 for |PnL| < $200
  signMustMatch: true,  // Sign disagreement = fail
};
```

### Expected Accuracy

Based on V1 realized-only achieving 71%, V2 total may see:
- **Best case:** 65-70% (prices match well)
- **Realistic:** 55-65% (some price staleness issues)
- **Challenge areas:** Illiquid markets, multi-outcome markets

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Price Staleness | Medium | Document sync frequency, consider CLOB fallback |
| Missing Price Data | Low | Fallback to 0.5, track coverage % |
| Multi-Outcome Markets | Medium | Test specifically with multi-outcome wallets |
| Timing Differences | Low-Medium | Document in reports, consider time normalization |
| Edge Cases (negative inventory, splits) | Low | V29's existing guards handle these |

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Price Oracle | 2-3 hours | None |
| Phase 2: Composer Integration | 2-3 hours | Phase 1 |
| Phase 3: Validation Harness | 2-3 hours | Phase 2 |
| Phase 4: Testing | 2-3 hours | Phase 3 |
| **Total** | **8-12 hours** | |

---

## Success Criteria

1. **V2 Total PnL pass rate >=60%** on 50-wallet benchmark
2. **Median error <5%** for large PnL wallets (>=$200)
3. **No sign disagreements** for wallets with |PnL| >= $100
4. **Price coverage >=90%** for active conditions

---

## Critical Files for Implementation

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV29.ts` | Core engine to extend (line 343) |
| `lib/pnl/v23cBatchLoaders.ts` | Price loading patterns to reuse |
| `lib/pnl/pnlComposerV1.ts` | Orchestrator to extend |
| `scripts/pnl/fetch-polymarket-profile-pnl.ts` | Playwright scraper |
| `lib/pnl/validationThresholds.ts` | Threshold logic |

---

*Plan created by Planning Agent on 2025-12-07*
