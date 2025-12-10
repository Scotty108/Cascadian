# PnL Accuracy Improvement Plan

**Date:** 2025-11-29
**Author:** Claude 1
**Status:** Planning Phase

---

## Executive Summary

After running V3 vs V3+FPMM validation on 50 wallets, we discovered:
- **V3 Sign Accuracy:** 91.8% (45/49 valid wallets)
- **V3 Median Error:** 22.0%
- **FPMM data was sparse:** Only 1/50 wallets had FPMM activity
- **Many validation wallets are invalid:** 7+ wallets return zero data (don't exist in our DB or on Polymarket)

The path to maximum accuracy requires addressing **three distinct problems**:

| Problem | Impact | Priority | Effort |
|---------|--------|----------|--------|
| Invalid validation data | Can't measure progress | P0 | 2 hours |
| Data coverage gaps | Zero-PnL for real wallets | P1 | 4-8 hours |
| NegRisk cost basis | Sign mismatches for operators | P2 | 8-16 hours |

---

## Phase 1: Fix the Validation Set (P0)

### Problem
Our 50-wallet validation set contains fabricated/stale addresses that:
- Return zero data from ClickHouse
- Return 404 from Polymarket API
- Cannot be validated against any ground truth

### Evidence
```
Wallet 0x12d6cccf4b65...
  pm_trader_events_v2: 0
  pm_erc1155_transfers: 0
  Polymarket API: 404
```

### Solution
1. **Clean the validation set** - Remove all wallets that:
   - Have zero CLOB events in `pm_trader_events_v2`
   - Return 404 from Polymarket API
   - Have fabricated addresses (not real Ethereum addresses)

2. **Use ONLY verified benchmark wallets:**
   - W1: `0x9d36c904...` - Verified in ClickHouse + Polymarket
   - W2: `0xdfe10ac1...` - Verified, perfect match baseline
   - W3: `0x418db17e...` - Verified (edge case: unredeemed Trump)
   - W4: `0x4974d5c6...` - Verified
   - W5: `0xeab03de4...` - Verified
   - W6: `0x7dca4d9f...` - Verified

3. **Expand with real wallets from ClickHouse:**
   ```sql
   SELECT trader_wallet, count() as trades, sum(usdc_amount)/1e6 as volume
   FROM pm_trader_events_v2
   WHERE is_deleted = 0
   GROUP BY trader_wallet
   HAVING trades > 100 AND volume > 10000
   ORDER BY volume DESC
   LIMIT 50
   ```

### Deliverable
- Script: `scripts/pnl/build-validated-wallet-set.ts`
- Output: `scripts/pnl/validated-wallet-benchmarks.json`

---

## Phase 2: Data Coverage Analysis (P1)

### Problem
Some real wallets (e.g., W1, W4) have large discrepancies between our PnL and Polymarket UI, suggesting missing data.

### Root Causes
1. **CLOB data gaps** - Fills missing from `pm_trader_events_v2`
2. **CTF event gaps** - Redemptions missing from `pm_ctf_events`
3. **Token mapping gaps** - Unmapped token_ids in `pm_token_to_condition_map_v3`
4. **Resolution gaps** - Missing resolutions in `pm_condition_resolutions`

### Investigation Steps

#### A. CLOB Data Completeness
```sql
-- Compare our CLOB trades vs what Polymarket API reports
SELECT
  count() as our_trades,
  sum(usdc_amount)/1e6 as our_volume
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('W1_ADDRESS')
```
Then compare with `https://gamma-api.polymarket.com/wallets/W1/history`

#### B. Token Mapping Coverage
```sql
-- Find unmapped tokens for a wallet
SELECT t.token_id, count() as trades
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
WHERE lower(t.trader_wallet) = lower('W1_ADDRESS')
  AND m.condition_id IS NULL
GROUP BY t.token_id
```

#### C. Resolution Coverage
```sql
-- Check how many conditions are resolved vs unresolved
SELECT
  countIf(r.condition_id IS NOT NULL) as resolved,
  countIf(r.condition_id IS NULL) as unresolved
FROM (
  SELECT DISTINCT m.condition_id
  FROM pm_trader_events_v2 t
  JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
  WHERE lower(t.trader_wallet) = lower('W1_ADDRESS')
) c
LEFT JOIN pm_condition_resolutions r ON lower(c.condition_id) = lower(r.condition_id)
```

### Deliverable
- Script: `scripts/pnl/data-coverage-audit.ts`
- Report: Per-wallet data completeness metrics

---

## Phase 3: NegRisk Cost Basis (P2)

### Problem
Sign mismatches occur for wallets that:
- Sell more tokens than they buy via CLOB
- Acquire tokens via NegRisk conversions (not tracked in CLOB)
- Result: Negative position costs → wrong PnL sign

### Evidence (from V6 experiment)
- Wallet `0x4ce73141...`: UI +$333K → V3 -$283K (sign mismatch)
- Root cause: 25,583 NegRisk acquisitions not tracked

### Why V6 Failed
- Used flat $0.26 cost basis for all NegRisk events
- Overfitted to one extreme wallet
- Made 24/32 NegRisk wallets WORSE

### Better Approaches (Ranked)

#### Option A: Dynamic Cost Basis (Best)
```typescript
// Lookup market price at time of NegRisk conversion
const priceAtConversion = await getMarketPrice(tokenId, blockTimestamp);
const costBasis = shares * priceAtConversion;
```
**Pros:** Accurate per-event
**Cons:** Requires price lookup infrastructure (slow, needs price index)

#### Option B: Wallet-Specific Calibration
```typescript
// Calculate implied cost basis from economic flows
const totalUsdcSpent = await getWalletTotalUsdcOutflows(wallet);
const totalTokensAcquired = await getWalletTotalTokenAcquisitions(wallet);
const impliedCostBasis = totalUsdcSpent / totalTokensAcquired;
```
**Pros:** Simple, wallet-specific
**Cons:** Requires USDC transfer tracking

#### Option C: Higher Default Cost Basis
- Try $0.40 or $0.50 instead of $0.26
- May help more wallets but still not universal

#### Option D: Skip NegRisk Wallets
- Classify wallets by NegRisk exposure
- Show "low confidence" warning for high NegRisk wallets
- Focus accuracy on retail-tier wallets

### Deliverable
- Research: `scripts/pnl/negrisk-cost-basis-research.ts`
- Decision doc: Which approach to implement

---

## Phase 4: V11_POLY vs V3 Comparison (P2)

### Background
We have TWO PnL engines:
1. **V3 (Activity PnL)** - Average cost, CLOB + CTF + resolution loss
2. **V11_POLY** - Port of Polymarket's subgraph algorithm

### Question
Which engine is more accurate for which wallet types?

### Test Plan
```typescript
for (const wallet of validatedWallets) {
  const v3Result = await computeWalletActivityPnlV3(wallet);
  const v11Result = await computePolymarketSubgraphPnl(wallet);
  compare(v3Result, v11Result, uiPnl);
}
```

### Expected Outcome
- V11_POLY: Better for simple retail wallets
- V3: Better for wallets with complex positions

---

## Immediate Action Items

### This Week
1. [ ] **Clean validation set** (2 hours)
   - Remove invalid wallets
   - Verify remaining wallets against Polymarket API
   - Create `validated-wallet-benchmarks.json`

2. [ ] **Run data coverage audit** (4 hours)
   - Check CLOB completeness for W1-W6
   - Check token mapping coverage
   - Identify missing resolutions

### Next Week
3. [ ] **Research NegRisk cost basis options** (4 hours)
   - Analyze USDC flows for NegRisk wallets
   - Prototype dynamic cost basis lookup
   - Decide on approach

4. [ ] **Compare V3 vs V11_POLY** (4 hours)
   - Run both engines on validated set
   - Document which is better for each wallet type
   - Create hybrid recommendation

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Sign Accuracy | 91.8% | 95%+ |
| Median Error | 22.0% | <15% |
| Valid Benchmarks | 6 | 30+ |
| Zero-PnL Wallets | 7 | 0 |

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/pnl/build-validated-wallet-set.ts` | Clean and expand validation set |
| `scripts/pnl/data-coverage-audit.ts` | Per-wallet data completeness |
| `scripts/pnl/negrisk-cost-basis-research.ts` | NegRisk costing options |
| `scripts/pnl/validated-wallet-benchmarks.json` | Clean benchmark data |

---

*Report generated by Claude 1 - 2025-11-29*
