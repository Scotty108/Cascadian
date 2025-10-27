# Wallet Trust Score Specification
**Version:** 1.0
**Date:** October 26, 2025
**Status:** Draft - Pending Category Data

---

## Overview

The Wallet Trust Score is a 0.0 to 1.0 metric that ranks Polymarket wallets based on **proven profitability**, **data reliability**, and **consistency**. This score identifies "smart money" wallets whose trading signals can be trusted and surfaced in the product.

**Core Philosophy:** Conservative scoring that heavily penalizes low-quality data and one-hit wonders. A high trust score (>0.7) should mean "we have strong evidence this wallet has repeatable edge."

---

## Inputs (All Audited & Proven)

1. **realized_pnl_usd** - Total profit from resolved markets (hold-to-resolution accounting)
2. **coverage_pct** - Percentage of wallet's conditions that are resolved (data quality proxy)
3. **num_resolved_conditions** - Count of resolved markets wallet traded
4. **category_concentration** - (BLOCKED) Will measure specialization once category data available

---

## Scoring Formula

### Component Scores (0.0 to 1.0 each)

#### 1. Profit Score (Weight: 40%)

Measures absolute profitability with saturation to prevent whale domination.

**Formula:**
```
profit_raw = realized_pnl_usd
profit_saturated = min(profit_raw / 10000, 1.0)  // Saturate at $10K
profit_score = sqrt(profit_saturated)            // Square root to compress further

If profit_raw < 0:
  profit_score = 0.0  // No credit for losses
```

**Rationale:**
- $10K saturation: A wallet with $10K profit gets same profit_score as one with $100K
- Square root: $2.5K profit → 0.5 score, $10K profit → 1.0 score
- Prevents whales from dominating score purely on bankroll size
- Negative P&L gets zero (no "short bias" credit)

**Examples:**
- $10,000+ realized → profit_score = 1.0
- $2,500 realized → profit_score = 0.5
- $625 realized → profit_score = 0.25
- -$1,000 realized → profit_score = 0.0

---

#### 2. Coverage Score (Weight: 35%)

Measures data reliability. Low coverage = high uncertainty = heavy penalty.

**Formula:**
```
If coverage_pct < 5%:
  coverage_score = 0.0  // Insufficient data - no trust possible

Else if coverage_pct < 10%:
  coverage_score = 0.3  // Marginal data quality

Else if coverage_pct < 20%:
  coverage_score = 0.6  // Acceptable quality

Else if coverage_pct < 40%:
  coverage_score = 0.85 // Good quality

Else:
  coverage_score = 1.0  // Excellent quality (40%+ coverage)
```

**Rationale:**
- <5% coverage = unreliable (e.g., 2 resolved out of 50 total conditions)
- 5-10% = bare minimum (e.g., wallet #2 at 6.77% coverage gets 0.3)
- 40%+ coverage = rare and excellent (e.g., wallet #1 at 35.56%, wallet #19 at 65.45%)
- Hard floor at 5% prevents scoring wallets with 1-2 lucky trades

**Current Distribution (from batch results):**
- Top wallet: 65.45% coverage → 1.0 score
- Wallet #2: 6.77% coverage → 0.3 score (barely qualifies)
- Median: ~10-15% coverage → 0.6 score
- 2% minimum already enforced in qualified set

---

#### 3. Repeatability Score (Weight: 25%)

Measures consistency. One lucky hit cannot create "elite" status.

**Formula:**
```
positive_conditions = COUNT(condition_pnl > $10) for resolved markets
total_conditions = num_resolved_conditions

If positive_conditions == 0:
  repeatability_score = 0.0  // No winning trades

Else if positive_conditions == 1:
  repeatability_score = 0.2  // One-hit wonder (capped)

Else if positive_conditions == 2:
  repeatability_score = 0.4  // Two wins (marginal)

Else if positive_conditions < 5:
  repeatability_score = 0.6  // Few wins (acceptable)

Else if positive_conditions < 10:
  repeatability_score = 0.8  // Multiple wins (good)

Else:
  repeatability_score = 1.0  // Many wins (excellent)
```

**Rationale:**
- $10 threshold: Filters out trivial wins (e.g., $2 profit from rounding)
- 1 winning market = max 0.2 score (caps one-hit wonders at trust_score ≤ 0.3)
- 10+ winning markets = full credit (demonstrates repeatability)
- Prevents lucky gambler from getting elite score

**Example:**
- Wallet with $9,000 profit but only 1 winning market out of 20 resolved:
  - profit_score = 0.95
  - coverage_score = 0.6 (assuming 15% coverage)
  - repeatability_score = 0.2 (one-hit wonder)
  - **trust_score = 0.40 × 0.95 + 0.35 × 0.6 + 0.25 × 0.2 = 0.64** (good but not elite)

---

#### 4. Category Specialization Score (Weight: 0% - BLOCKED)

**BLOCKED ON:** 0% event_id enrichment in current data

**Intended Formula (when unblocked):**
```
For each category:
  category_pnl = SUM(condition_pnl) in that category
  category_pct = category_pnl / total_pnl

max_category_pct = MAX(category_pct across all categories)

If max_category_pct > 0.7:
  specialization_score = 1.0  // 70%+ profit from one category = specialist
Else if max_category_pct > 0.5:
  specialization_score = 0.7  // 50-70% = moderate specialization
Else:
  specialization_score = 0.4  // Generalist (spread across categories)

Ignore "uncategorized" category in this calculation.
```

**Rationale:**
- Specialists (e.g., 80% profit from "sports") demonstrate domain expertise
- Generalists may be lucky or lack edge
- Bonus for concentration, not penalty for diversification
- When blocked: **weight redistributed to other components**

**Current Weighting (Category Blocked):**
- Profit: 55% (was 40%)
- Coverage: 35% (unchanged)
- Repeatability: 10% (was 25%, reduced because we can't distinguish lucky generalists without category data)

---

### Final Trust Score

**When category data available:**
```
trust_score = (0.40 × profit_score) +
              (0.35 × coverage_score) +
              (0.25 × repeatability_score) +
              (0.00 × specialization_score)  // BLOCKED, weight = 0
```

**Current formula (category blocked):**
```
trust_score = (0.55 × profit_score) +
              (0.35 × coverage_score) +
              (0.10 × repeatability_score)
```

**Result:** Float between 0.0 and 1.0

---

## Score Tier Interpretation

| Score Range | Tier | Meaning | Use Case |
|-------------|------|---------|----------|
| 0.80 - 1.00 | Elite | Strong evidence of repeatable edge, excellent data quality | Auto-copy trades, premium signals |
| 0.65 - 0.79 | Trusted | Good profitability with solid coverage | Show in "smart money" feed |
| 0.50 - 0.64 | Emerging | Moderate profit or limited data | Monitor, don't highlight |
| 0.30 - 0.49 | Unproven | Insufficient evidence or one-hit wonder | Exclude from signals |
| 0.00 - 0.29 | Low Quality | Very low coverage or net losses | Exclude entirely |

---

## Hard Constraints

### Disqualification Rules (Auto-Score = 0.0)

1. **coverage_pct < 2%** - Already filtered in qualified wallet set (548/2,838 passed)
2. **coverage_pct < 5% AND num_resolved_conditions < 3** - Insufficient data
3. **realized_pnl_usd < 0** - No trust for net losers
4. **num_resolved_conditions < 2** - Cannot assess repeatability

### Maximum Score Caps

1. **coverage_pct < 5%** → trust_score capped at 0.40 (coverage_score = 0)
2. **positive_conditions == 1** → trust_score capped at 0.30 (repeatability_score = 0.2 max)
3. **realized_pnl_usd < $100** → trust_score capped at 0.50 (trivial profit)

---

## Example Calculations

### Example 1: Top Wallet (Rank #1)

**Inputs:**
- realized_pnl_usd = $9,012.68
- coverage_pct = 35.56%
- num_resolved_conditions = 80 (estimated)
- positive_conditions = 45 (estimated)

**Component Scores:**
- profit_score = sqrt(9012.68 / 10000) = sqrt(0.90) = 0.95
- coverage_score = 0.85 (20-40% tier)
- repeatability_score = 1.0 (45 > 10 wins)

**Trust Score:**
```
trust_score = 0.55 × 0.95 + 0.35 × 0.85 + 0.10 × 1.0
            = 0.523 + 0.298 + 0.10
            = 0.921
```

**Tier:** Elite (0.92)

---

### Example 2: Rank #2 Wallet (Validated)

**Inputs:**
- realized_pnl_usd = $4,657.81
- coverage_pct = 6.77%
- num_resolved_conditions = 121 (known from validation)
- positive_conditions = 65 (estimated)

**Component Scores:**
- profit_score = sqrt(4657.81 / 10000) = sqrt(0.47) = 0.68
- coverage_score = 0.3 (5-10% tier)
- repeatability_score = 1.0 (65 > 10 wins)

**Trust Score:**
```
trust_score = 0.55 × 0.68 + 0.35 × 0.3 + 0.10 × 1.0
            = 0.374 + 0.105 + 0.10
            = 0.579
```

**Tier:** Emerging (0.58)

**Analysis:** High profit and repeatability but penalized heavily for low coverage (6.77%). This is correct - we don't have enough data to confidently trust this wallet despite $4.6K profit.

---

### Example 3: One-Hit Wonder (Hypothetical)

**Inputs:**
- realized_pnl_usd = $8,000
- coverage_pct = 15.0%
- num_resolved_conditions = 30
- positive_conditions = 1 (one big win, rest break-even or small losses)

**Component Scores:**
- profit_score = sqrt(8000 / 10000) = sqrt(0.8) = 0.89
- coverage_score = 0.6 (10-20% tier)
- repeatability_score = 0.2 (one-hit wonder)

**Trust Score:**
```
trust_score = 0.55 × 0.89 + 0.35 × 0.6 + 0.10 × 0.2
            = 0.490 + 0.21 + 0.02
            = 0.720
```

**Tier:** Trusted (0.72) - but suspicious

**Analysis:** High score despite being a one-hit wonder. This is a weakness in the current formula with category blocked. When category data is available, we can reduce repeatability weight back to 25% and add specialization check. For now, this wallet would score surprisingly high.

**Mitigation:** Add manual flag for "90%+ profit from single market" as suspicious pattern.

---

## Data Dependencies

### Currently Available ✅

- `audited_wallet_pnl_extended.json` - 548 wallets with realized_pnl_usd, coverage_pct
- `expanded_resolution_map.json` - 2,858 resolutions
- Per-wallet condition-level P&L (from ClickHouse)

### Currently Missing ❌

- `positive_conditions` count per wallet - **NEED TO CALCULATE**
- Category enrichment (0% event_id coverage) - **BLOCKED**
- Market metadata for specialization analysis - **BLOCKED**

---

## Implementation Plan

### Phase 1: Basic Trust Score (Now - Category Blocked)

**Inputs:**
- realized_pnl_usd ✅
- coverage_pct ✅
- num_resolved_conditions ✅

**Missing (need to add):**
- positive_conditions count

**Action:** Extend wallet_category_breakdown.json to include:
```json
{
  "wallet_address": "0x...",
  "realized_pnl_usd": 9012.68,
  "coverage_pct": 35.56,
  "num_resolved_conditions": 80,
  "positive_conditions": 45,  // NEW
  "categories": [...]
}
```

**Formula:** Use current (category-blocked) weights:
- 55% profit
- 35% coverage
- 10% repeatability

**ETA:** Can implement immediately after wallet_category_breakdown.json completes

---

### Phase 2: Fix Category Enrichment (Next Sprint)

**Blockers:**
1. Polymarket API returned 0% event_id enrichment for 4,961 markets
2. Need alternative data source or API investigation

**Actions:**
1. Investigate why Polymarket `/markets/{id}` doesn't return `events` field
2. Try Polymarket `/events` endpoint directly to build event → category map
3. Alternative: Manual category mapping for top markets
4. Alternative: Use market question text NLP to infer category

**Once unblocked:**
- Restore specialization_score (weight: 20%)
- Adjust other weights: profit 40%, coverage 30%, repeatability 25%, specialization 20%

---

### Phase 3: Advanced Signals (Future)

**Additional signals to consider:**
- Win rate (% of positions that are profitable)
- Average profit per position (consistency)
- Volatility (standard deviation of condition P&L)
- Entry timing (did they enter early vs late in market lifecycle)
- Position sizing (Kelly criterion compliance)
- Drawdown recovery (bouncing back from losses)

---

## Production Deployment Notes

### Trust Score Refresh Cadence

**Recommendation:** Daily batch job

**Rationale:**
- Wallet P&L changes as new markets resolve
- Coverage improves as more conditions get market_id mapping
- Trust scores should update but won't fluctuate wildly day-to-day

**Job Schedule:**
```
1. Run batch-calculate-all-wallets-pnl.ts (20 min)
2. Run build-dimension-tables.ts (20 min, if category unblocked)
3. Run build-wallet-category-breakdown.ts (5 min)
4. Calculate trust scores (5 min)
5. Update leaderboard cache
Total: ~50 min
```

### Alerting

**Trigger alert if:**
- Trust score drops >0.2 for a wallet in one refresh (suspicious)
- Top 10 wallets change significantly (market manipulation?)
- Coverage ceiling drops below 50% (data quality regression)

### API Response

**Endpoint:** `GET /api/wallets/trust-scores`

**Response:**
```json
{
  "wallets": [
    {
      "wallet_address": "0x...",
      "trust_score": 0.92,
      "tier": "elite",
      "rank": 1,
      "realized_pnl_usd": 9012.68,
      "coverage_pct": 35.56,
      "component_scores": {
        "profit": 0.95,
        "coverage": 0.85,
        "repeatability": 1.0,
        "specialization": null  // blocked
      }
    }
  ],
  "metadata": {
    "last_updated": "2025-10-26T23:00:00Z",
    "total_qualified_wallets": 548,
    "formula_version": "1.0-category-blocked"
  }
}
```

---

## Known Limitations & Risks

### Critical Blockers

1. **0% Category Enrichment**
   - **Impact:** Cannot assess specialization, one-hit wonders score too high
   - **Workaround:** Reduced repeatability weight from 25% → 10%
   - **Risk:** Wallets with one lucky $10K trade score ~0.70 instead of ~0.50
   - **Mitigation:** Manual review of top wallets for single-market dominance

2. **Low Coverage Ceiling (11.59% market_id mapping)**
   - **Impact:** Most wallets show 5-15% coverage even if data exists
   - **Workaround:** Lowered coverage thresholds (40%+ = 1.0 instead of 80%+)
   - **Risk:** Accepting lower data quality than ideal
   - **Mitigation:** Upstream ETL fix to populate market_id

3. **Missing Positive Conditions Count**
   - **Impact:** Cannot calculate repeatability_score in current wallet_category_breakdown.json
   - **Workaround:** Extend schema to include this field
   - **Risk:** None (easy to add)

### Formula Weaknesses (Category Blocked)

1. **Profit dominance:** 55% weight may overvalue absolute dollars vs edge
2. **One-hit wonder loophole:** 10% repeatability too low to penalize lucky trades
3. **No specialization check:** Cannot detect domain expertise vs random luck

### Formula Weaknesses (General)

1. **Hold-to-resolution bias:** Doesn't credit skilled early exits or short positions
2. **Survivorship bias:** Only counts wallets that traded ≥1 resolved market
3. **No time weighting:** $1K profit last week = $1K profit 6 months ago
4. **No position sizing check:** All-in YOLO vs Kelly sizing both score same

---

## Validation Strategy

### Sanity Checks

Before deploying trust scores to production:

1. **Top 10 manual review:** Inspect top-scoring wallets for suspicious patterns
   - Single market >80% of profit? Flag as one-hit wonder
   - Coverage <10% in top 10? Flag as insufficient data
   - Net profit but trust_score = 0? Check for disqualification rule

2. **Distribution check:**
   - Expected: 5-10% elite (>0.80), 20-30% trusted (0.65-0.79), 40-50% emerging/unproven
   - If 50%+ score >0.80 → formula too loose
   - If <1% score >0.65 → formula too strict

3. **Rank correlation with P&L:**
   - trust_score should correlate with realized_pnl_usd but NOT perfectly
   - Correlation ~0.6-0.7 is healthy (other factors matter)
   - If correlation >0.95 → coverage/repeatability not adding value

### A/B Test Plan (Future)

1. Build two leaderboards: "Top P&L" vs "Top Trust Score"
2. Track which wallets users copy
3. Measure follow-on performance of copied wallets
4. Trust score should predict future performance better than raw P&L

---

## Changelog

**v1.0 (2025-10-26):**
- Initial specification
- Category specialization blocked (0% enrichment)
- Adjusted weights: 55% profit, 35% coverage, 10% repeatability
- Saturated profit at $10K to prevent whale domination
- Hard floor at 5% coverage, caps at 40%+
- Repeatability based on positive_conditions count

**Future versions:**
- v1.1: Add positive_conditions field to wallet_category_breakdown.json
- v2.0: Unblock category specialization, restore balanced weights
- v3.0: Add time-weighted scoring, position sizing analysis

---

## References

- `audited_wallet_pnl_extended.json` - Input data (548 wallets)
- `CANONICAL_PNL_ENGINE_COMPLETE.md` - P&L methodology
- `PATH_B_PROGRESS_REPORT_2025-10-26.md` - Project status
- `dimension_coverage_report.json` - Coverage statistics (0% event enrichment)
