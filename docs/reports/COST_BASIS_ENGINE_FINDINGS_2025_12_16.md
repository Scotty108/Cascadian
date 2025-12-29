# Cost Basis Engine Investigation Findings

**Date:** 2025-12-16 (Updated)
**Status:** Complete - Batch Engine with Omega Implemented

## LATEST UPDATE: Batch Engine PnL with Validated Spot Checks (Session 4)

### Batch Computation Complete

Created `scripts/pnl/batch-compute-engine-pnl.ts` to compute real cost-basis PnL with profit factor for all wallets. Results cached in `pm_wallet_engine_pnl_cache` table.

**Sample run (2,000 wallets):**

| Metric | Count | % |
|--------|-------|---|
| Total processed | 2,000 | 100% |
| Profitable (PnL > 0) | 800 | 40% |
| PnL > $500 | 116 | 5.8% |
| PnL > $500 AND profit_factor > 1 | 116 | 5.8% |

**Note:** Profit factor = sum(winning_pnl) / sum(losing_pnl). PF > 1 is redundant when PnL > 0 (by definition). Use PF >= 1.2 or higher for meaningful filtering.

### Playwright Spot Check Results (Session 4)

Validated top wallets from cache against live UI:

| Wallet | Engine PnL | UI PnL | Error | Notes |
|--------|------------|--------|-------|-------|
| @scottilicious | $1,310k | $1,338k | **+2%** | Excellent accuracy |
| 0x006cc... | $681k | $999k | **-32%** | Underestimate |
| @11122 | $340k | $473k | **-28%** | Underestimate |

**Pattern:** Engine tends to **underestimate** PnL in these samples. However:
- 3 wallets is not enough to claim "no false positives" globally
- Need stratified validation to confirm bias direction
- Underestimation likely explained by: unresolved positions (engine marks at 0, UI marks at current price), taker profits not counted, external token acquisitions

### Corrected Pool Size Estimate

Extrapolating from 2,000 wallet sample to full 357k pool:

| Filter | Sample (2k) | Extrapolated (357k) |
|--------|-------------|---------------------|
| PnL > $500 | 116 (5.8%) | ~21,000 wallets |
| PnL > $1k | ~80 (4%) | ~14,000 wallets |
| PnL > $5k | ~25 (1.25%) | ~4,500 wallets |

**Note:** profit_factor > 1 is redundant when PnL > 0. Use profit_factor >= 1.2+ for meaningful quality filtering.

### Files Created (Session 4)

- `scripts/pnl/batch-compute-engine-pnl.ts` - Batch PnL + profit factor computation
- `scripts/pnl/spotcheck-engine-vs-ui.ts` - Spot check validation script
- `pm_wallet_engine_pnl_cache` - ClickHouse cache table with profit factor metrics

### Cache Table Schema

```sql
CREATE TABLE pm_wallet_engine_pnl_cache (
  wallet String,
  engine_pnl Float64,
  realized_pnl Float64,
  unrealized_pnl Float64,
  trade_count UInt32,
  position_count UInt32,
  external_sells Float64,
  winning_pnl Float64,
  losing_pnl Float64,
  profit_factor Float64,  -- sum(winning_pnl) / sum(losing_pnl)
  win_count UInt32,
  loss_count UInt32,
  computed_at DateTime
) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY wallet
```

### PnL Definition Contract

Understanding why engine and UI values differ:

| Metric | Engine | UI (Polymarket) |
|--------|--------|-----------------|
| **Realized PnL** | Sum of (sell_price - avg_cost) × shares for all sells | Closed positions P/L |
| **Unrealized PnL** | shares × (resolution_price - avg_cost) for resolved markets only | Open positions at current market price |
| **Unresolved treatment** | Marked at 0 (no unrealized contribution) | Marked at current market price |
| **Data source** | Maker trades only from pm_trader_events_v2 | Full trading history + transfers + splits |
| **Token provenance** | CLOB buys only; external acquisitions ignored | All token sources tracked |

**Expected systematic differences:**
- Engine **underestimates** wallets with large unresolved/open positions
- Engine **excludes** taker activity (by design, for cleaner inventory tracking)
- Engine **can't track** tokens acquired via transfers, splits, or redemptions
- Engine **can't mark** positions at current prices (no live price feed)

**When engine should match UI closely:**
- Wallets with mostly resolved positions
- Wallets with low external_sells (acquired tokens via CLOB)
- Wallets with low taker activity

**When engine will diverge from UI:**
- Wallets with large open/unresolved positions (UI marks at current price)
- Wallets with high external_sells (acquired tokens outside CLOB)
- Wallets with high taker activity (UI includes, engine excludes)

### Next Steps

1. **Run stratified validation** (100 wallets across 5 bands)
2. **Analyze error patterns** by diagnostic features
3. **Update confidence tiers** based on empirical findings
4. **Run full batch** only after validation passes

---

## Previous: Pool Counter Was Using Wrong Metric (Session 3b)

### Original Spot Check (Cashflow vs Actual PnL)

**The "3,443 wallets" pool count was INVALID.** The pool counter used `sell_usdc - buy_usdc` (cashflow) instead of actual PnL.

| Wallet | CLOB Cashflow | Engine PnL | UI PnL | Cashflow Error |
|--------|---------------|------------|--------|----------------|
| @qrpenc | **$71.7M** | $419k | $333k | **215x off** |
| @JustPracticeMan | **$63.2M** | -$9k | $3.3k | **19,000x off** |
| @walletmobile | $17.8M | $5.9M | $5.94M | 3x off |
| @Karajan | $11.5M | $176k | $120k | 96x off |
| @Theo4 | - | $22.0M | $22.0M | ✓ baseline |

**Root cause:** `sell_usdc - buy_usdc` measures CLOB turnover, not profit. Market makers have massive turnover but tiny margins.

---

## Previous Update: Copy-Trading Pool & Confidence Gate (Session 3)

### Redemption Adjustment Test - FAILED

Tested hypothesis: Adding redemption cashflows as PnL adjustment improves accuracy.

**Result:** Massive accuracy degradation.

| Threshold | Baseline | + Redemption | Delta |
|-----------|----------|--------------|-------|
| ≤1% | 47% | 23% | -33 |
| ≤10% | **68%** | 31% | **-50** |
| ≤25% | 80% | 32% | -65 |

**Median error:** 1.4% → 187.7%

**Why it failed:** Redemption USDC = cost recovery + profit. For wallets where we already track cost basis, adding redemption double-counts. Only 3% of wallets improved.

**Conclusion:** Use redemption level as a **confidence signal**, not a PnL adjustment.

### Copy-Trading Pool Size (Actual Numbers)

Filters: 30d active, >20 trades, omega>1, profit>$500

| Metric | Count |
|--------|-------|
| Total wallets with maker trades | 1,720,091 |
| >20 maker trades | 1,002,954 |
| + 30d active | 356,738 |
| + profit > $500 | 5,195 |
| + omega > 1 (FINAL POOL) | **3,443** |

### Confidence Tier Breakdown

| Tier | Count | % |
|------|-------|---|
| HIGH | 2,972 | 86.3% |
| MEDIUM | 409 | 11.9% |
| LOW | 62 | 1.8% |

### PnL Distribution of Pool

| PnL Range | Total | High Conf | Med Conf | Low Conf |
|-----------|-------|-----------|----------|----------|
| $500-$1k | 815 | 644 | 154 | 17 |
| $1k-$5k | 2,039 | 1,813 | 206 | 20 |
| $5k-$10k | 226 | 199 | 17 | 10 |
| $10k-$50k | 228 | 204 | 17 | 7 |
| $50k-$100k | 87 | 68 | 12 | 7 |
| $100k-$500k | 31 | 27 | 3 | 1 |
| $500k+ | 17 | 17 | 0 | 0 |

### Top High-Confidence Wallets

| Wallet | PnL Est | Trades | Redemptions |
|--------|---------|--------|-------------|
| 0xc23b2190.. | $63.2M | 219,439 | 78 (0.0%) |
| 0x8e9eedf2.. | $11.5M | 442,241 | 1 (0.0%) |
| 0xe3726a1b.. | $10.8M | 1,846,852 | 0 (0.0%) |
| 0x7298060b.. | $4.9M | 251,372 | 0 (0.0%) |
| 0x3eebc652.. | $2.7M | 20,512 | 101 (0.5%) |

### Files Created (Session 3)

- `lib/pnl/loadRedemptions.ts` - Redemption loader module
- `lib/pnl/copyTradingConfidence.ts` - Confidence scoring module
- `scripts/pnl/benchmark-with-redemptions.ts` - A/B comparison (redemption vs baseline)
- `scripts/pnl/count-copytrading-pool.ts` - Pool size counter
- `scripts/pnl/test-confidence-gate.ts` - Confidence gate validation

### Confidence Gate Logic

```typescript
// HIGH: Low redemption activity relative to trades
if (redemptionRatio < 0.1 && redemptionUsdc < pnlEstimate * 2) → HIGH

// MEDIUM: Moderate redemption activity
if (redemptionRatio < 0.3 && redemptionUsdc < pnlEstimate * 5) → MEDIUM

// LOW: High redemption activity (likely external acquisitions)
else → LOW
```

### Key Conclusions

1. **3,443 wallets** pass copy-trading filters
2. **86% (2,972)** are HIGH confidence
3. **Redemption adjustment doesn't work** - use it as confidence signal instead
4. **Stricter filters available:**
   - >50 trades, >$1k PnL: 2,376 wallets (2,115 high-conf)
   - >100 trades, >$5k PnL: 450 wallets (401 high-conf)
   - >50 trades, >$10k PnL: 341 wallets (299 high-conf)

---

## Previous Update: Comprehensive Benchmark Analysis (Session 2)

### Resolution Bug Fixed
Created `loadResolutionsStrict()` in `lib/pnl/loadResolutionsStrict.ts` that properly filters empty `payout_numerators`. The bug was that `JSONExtractInt('', 1)` returns 0, treating unresolved markets as total losses.

### Benchmark Results (136 wallets)

| Threshold | Maker-Only | All-Trades |
|-----------|------------|------------|
| ≤1% | 47% (64/136) | 7% (9/136) |
| ≤10% | **68%** (92/136) | 29% (39/136) |
| ≤25% | **80%** (109/136) | 51% (70/136) |

### Cluster Analysis

| Cluster | Count | ≤10% | Median Error | Notes |
|---------|-------|------|--------------|-------|
| **Normal** | 19 | 94.7% | **0.1%** | Works excellent |
| Tiny (<$200) | 47 | 76.6% | 0.1% | Denominator noise |
| **High Redemptions** | 55 | 56.4% | 6.9% | Need redemption cashflows |
| Taker-Heavy | 14 | 50% | 24.2% | Stale benchmarks (UI=$0) |
| High External Sells | 1 | 0% | 51% | Need inventory provenance |

### Why All-Trades Is WORSE Than Maker-Only

Concrete example (Wallet 0xd31a2ea0b5..):

| Mode | Trades | Buys | Sells | External Sells |
|------|--------|------|-------|----------------|
| Maker-only | 116 | 104 | 12 | **0 tokens** |
| All-trades | 1,025 | 301 | **724** | **2.6M tokens** |

**Root cause:** Taker sells are tokens sold that were never bought through CLOB - they came from transfers, splits, or other mechanisms. Adding taker data without inventory provenance creates false external sells.

### Playwright MCP Findings

1. **"Taker-heavy" outliers have 0 CLOB data** - they're stale benchmark values, not taker-heavy wallets
2. **YatSen ($2.27M UI PnL)** improved from 57% → 6% error with all-trades because they're 91% maker, so taker noise is minimal

### Key Conclusions

1. **Maker-only is the correct CLOB approach** - achieves 80% within 25% error
2. **Normal wallets work excellent** - 94.7% within 10%, 0.1% median error
3. **High-redemption wallets need CTF PayoutRedemption cashflows** - biggest remaining gap
4. **All-trades breaks calculation** for wallets that acquire tokens outside CLOB

### Copy-Trading Pool Estimate

For filters (30d active, >20 trades, omega>1, profit>$500):
- Current engine: ~1,000-5,000 wallets
- After adding redemption cashflows: ~3,000-10,000 wallets

---

## Update: Deep Investigation of Problematic Wallets

### New Finding: ERC1155 Data Gap is Root Cause

Investigation into wallet `0x7f3c8979...` (LucasMeow) which shows -$1.4M engine vs +$214k UI:

| Data Source | Net Tokens | Date Range |
|-------------|------------|------------|
| CLOB | +5,982,599 | Feb 26 - Dec 14 |
| ERC1155 | +133,619 | Mar 24 - Nov 10 |

**The ERC1155 backfill is missing ~6 weeks of data**, explaining the massive discrepancy:
- Missing Feb 26 - Mar 24 (early activity)
- Missing Nov 10 - Dec 14 (recent activity)

The wallet has likely redeemed/sold most positions during the missing periods:
- Current ERC1155 holdings: $410k winning shares, $0 losing shares
- Already redeemed: $477k winning shares
- Total on-chain value: ~$888k

But cost-basis engine calculates unrealized on CLOB positions that no longer exist, creating phantom -$2M losses.

### Staleness Hypothesis - DISPROVEN

Fresh UI scrapes show same large errors:
| Wallet | Fresh UI | Engine | Error |
|--------|----------|--------|-------|
| 0xa7cfaf.. | $16.3k | -$138.5k | -951% |
| 0x7f3c89.. | $214.2k | -$1,447.6k | -776% |

### Recommendation: Complete ERC1155 Pipeline

Before trusting cost-basis engine for any wallet:
1. Verify ERC1155 date range covers full CLOB activity
2. Reconcile CLOB net position vs ERC1155 net position
3. Flag wallets with >10% discrepancy

---

## Original Executive Summary

Built and tested a cost-basis PnL engine to understand why including taker trades causes PnL inflation. Key findings:

1. **V6 (maker-only) remains the best approach** for matching Polymarket UI
2. **Cost basis with sell capping works correctly** (0 negative balances)
3. **External sells reveal tokens acquired outside CLOB** (PositionSplit, transfers)
4. **Resolution formula bug fixed** - payout_numerators are stored as [1,0] not [1000,0]

## Test Results

### V6 (Maker-Only) - Production Baseline
| Wallet | V6 PnL | UI Benchmark | Error |
|--------|--------|--------------|-------|
| Theo4 | $22.16M | $22.05M | **0.5%** ✓ |
| primm | - | $5.06M | - |
| anon | - | $11.62M | - |

### Cost Basis (Maker-Only)
| Wallet | Cost Basis PnL | V6 PnL | Error |
|--------|----------------|--------|-------|
| Theo4 | $22.03M | $22.16M | **-0.58%** ✓ |

The cost basis engine matches V6 when using maker-only trades.

### Cost Basis (All Trades with Sell Capping)
| Wallet | Total PnL | UI PnL | Error | External Sells |
|--------|-----------|--------|-------|----------------|
| Theo4 | $25.00M | $22.05M | 13.3% | 15.5M tokens |
| primm | $3.19M | $5.06M | -37.0% | 18.6M tokens |
| anon | $0.19M | $11.62M | -98.4% | 2.6M tokens |
| smoughshammer | -$0.02M | $5.05M | -100.5% | 0.2M tokens |

## Key Findings

### 1. Resolution Formula Bug (Fixed)
The `payout_numerators` field has two formats:
- `[1, 0]` - Already normalized (1 = winner)
- `[1000000, 0]` - Raw values (need division)

**Correct formula:** `if(value >= 1000, 1, value)`
**Bug:** Was dividing by 1000 for small values

### 2. External Sells Explained
External sells are tokens sold that were never bought in CLOB:

For Theo4's biggest external sell (5.3M tokens):
- **Token:** Kamala Harris popular vote - NO outcome
- **CLOB Activity:** 0 buys, 578 taker sells
- **Source:** Unknown - tokens acquired through non-CLOB sources

**What external sells mean:** The wallet obtained inventory through sources we are not currently ingesting:
- PositionSplit by the same wallet (minting both outcomes)
- ERC-1155 transfers from other wallets
- PositionMerge operations
- Redemptions or other CTF mechanisms

We confirmed Theo4 has 0 PositionSplit events for this condition, suggesting the tokens came from ERC-1155 transfers or a proxy/contract wallet we're not tracking.

### 3. Why V6 Achieves UI Parity
V6 (maker-only) is the best UI-parity proxy given our current inventory coverage:
1. Maker trades capture the primary position-building activity we can track
2. Excluding taker trades avoids counting sells for inventory we don't have
3. The resulting cash-flow formula remains balanced without artificial inflation

**Note:** This is a pragmatic parity choice, not a claim about how Polymarket UI calculates PnL internally. We observe that maker-only achieves low error vs UI benchmarks.

### 4. Why Cost Basis (All Trades) Has Issues
Including all trades causes imbalance:
- Taker BUYS are counted (adds to positions)
- Taker SELLS are capped at 0 (external sells ignored)
- Net effect: Over-counting positions without corresponding costs

## Recommendations

### Short Term (Use V6)
Keep V6 (maker-only) as production baseline:
- 0.5% error for maker-primary wallets
- Matches Polymarket UI behavior
- Simple and stable

### Medium Term (Position Engine)
If need better accuracy for taker-primary wallets:
1. Add PositionSplit events as inventory source
2. Track position per (wallet, condition_id, outcome_index)
3. Cap sells at tracked inventory from ALL sources

### Long Term (Full Accounting)
For complete economic accuracy:
1. Ingest all inventory sources (PositionSplit, Merge, ERC1155 transfers)
2. Implement full cost-basis tracking like Polymarket subgraph
3. This may NOT match UI if UI uses limited data sources

## Files Created

- `lib/pnl/costBasisEngineV1.ts` - Cost basis engine module
- `scripts/pnl/test-cost-basis-engine.ts` - Full benchmark test
- `scripts/pnl/test-cost-basis-maker-only.ts` - Maker-only comparison test
- `docs/systems/pnl/COST_BASIS_ENGINE_SPEC.md` - Engine specification

## Conclusion

V6 (maker-only) achieves the best UI parity given our current CLOB-only data coverage. The cost-basis engine validates this understanding and provides diagnostic capabilities (external_sell tracking).

For taker-primary wallets (primm, anon, smoughshammer), our CLOB-only tracking undercounts their activity because they acquire significant inventory through non-CLOB sources we don't ingest.

**Key insight:** The gap is not a bug in our calculation - it reflects the limitation of CLOB-only data. To close this gap would require ingesting additional inventory sources (PositionSplit, ERC-1155 transfers, etc.).
