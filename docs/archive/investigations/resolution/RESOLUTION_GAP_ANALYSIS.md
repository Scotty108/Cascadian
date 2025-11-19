# Resolution Data Gap Analysis

**Date:** 2025-01-09
**Status:** 🚨 CRITICAL DATA GAP IDENTIFIED

---

## The Problem

Only **8.2%** of positions (1.1M / 13.4M) have resolved P&L, but we expected much higher coverage.

## Root Cause

We have resolution data in **TEXT format** but haven't converted it to **numeric payout vectors** needed for P&L calculation.

### Current State

| Table | Rows | Format | Coverage |
|-------|------|--------|----------|
| `resolution_candidates` | 424K | TEXT ("Yes"/"No") | ⚠️ Not usable |
| `staging_resolutions_union` | 544K | TEXT ("Yes"/"No") | ⚠️ Not usable |
| `market_resolutions_final` | 218K | Payout vectors ([1,0]) | ✅ Usable |
| **Traded markets** | **203K** | - | **Need payouts** |

### The Gap

- **Traded markets:** 203,072 unique condition IDs
- **Markets with payout vectors:** 56,575 (27.6%)
- **Markets with TEXT outcomes:** 424,000+
- **Missing conversion:** ~150K markets

### Why TEXT Can't Be Used Directly

P&L calculation requires numeric payout vectors:
```sql
pnl_usd = (shares × payout_numerators[outcome_index + 1] / payout_denominator) - cost_basis
```

We can't use "Yes"/"No" strings - we need arrays like `[1, 0]` or `[0, 1]`.

---

## The Solution

### Convert TEXT outcomes → Payout Vectors

**Step 1: Get market outcome arrays from `api_markets_staging`**

We fetched 161K markets with their outcome arrays:
```typescript
{
  condition_id: "abc123...",
  outcomes: ["Yes", "No"],  // The order matters!
  resolved: true,
  winning_outcome: null
}
```

**Step 2: Match TEXT resolutions to outcome position**

From `resolution_candidates`:
```typescript
{
  condition_id_norm: "abc123...",
  outcome: "Yes",  // This is the winning outcome
  source: "clob",
  confidence: 1.0
}
```

**Step 3: Create payout vector**

```typescript
// If outcomes = ["Yes", "No"] and outcome = "Yes"
const winnerIndex = outcomes.indexOf("Yes");  // = 0
const payout_numerators = outcomes.map((_, i) => i === winnerIndex ? 1 : 0);
// Result: [1, 0]
const payout_denominator = 1;
```

**Step 4: Insert into `market_resolutions_final`**

Update the 218K table with the additional ~150K conversions.

---

## Implementation Plan

### Phase 1: Build Converter (2 hours)

Create `convert-text-resolutions-to-payouts.ts`:

```typescript
async function convertTextToPayout(conditionId: string, outcome: string, outcomeArray: string[]) {
  const winnerIndex = outcomeArray.indexOf(outcome);

  if (winnerIndex === -1) {
    // Handle fuzzy matching: "YES" vs "Yes"
    // Handle aliases: "Trump" → "Donald Trump"
    return null;  // Skip for now, manual review
  }

  return {
    condition_id_norm: conditionId,
    payout_numerators: outcomeArray.map((_, i) => i === winnerIndex ? 1 : 0),
    payout_denominator: 1,
    winning_outcome: outcome
  };
}
```

**Input:**
- `resolution_candidates`: 424K TEXT outcomes
- `api_markets_staging`: 161K outcome arrays

**Output:**
- ~150K new payout vectors

**Expected match rate:**
- Exact matches: ~80% (120K markets)
- Fuzzy matches: ~15% (22K markets)
- Manual review: ~5% (8K markets)

### Phase 2: Run Conversion (30 minutes)

```bash
npx tsx convert-text-resolutions-to-payouts.ts
```

- Process 424K candidate resolutions
- Join with outcome arrays from api_markets_staging
- Generate payout vectors
- Insert into market_resolutions_final
- Report conversion stats

### Phase 3: Verify (15 minutes)

```sql
-- Check new coverage
WITH traded_markets AS (
  SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
  FROM fact_trades_clean
)
SELECT
  COUNT(*) as total_traded_markets,
  SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout,
  SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) / COUNT(*) as coverage_pct
FROM traded_markets tm
LEFT JOIN market_resolutions_final r ON tm.condition_id = r.condition_id_norm
```

**Expected improvement:**
- Before: 27.6% (56K / 203K)
- After: **85-90%** (170K-180K / 203K)

---

## Alternative: Fetch from Blockchain

If API data is insufficient, we can fetch payout vectors from CTF contract events:

**Polygon CTF Contract:** `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`

**PayoutRedemption Event:**
```solidity
event PayoutRedemption(
  bytes32 indexed conditionId,
  address indexed redeemer,
  uint256[] payouts
)
```

**Estimated coverage:**
- All resolved markets on Polygon
- ~200K+ markets with on-chain payouts
- 100% accuracy (source of truth)
- **Runtime:** 3-4 hours for full backfill

---

## Recommendation

**Hybrid Approach (Best ROI):**

1. **Phase 1:** Convert TEXT→Payouts (2 hours) → Get to 85-90% coverage
2. **Phase 2 (Optional):** Blockchain backfill for remaining 10-15%

**Total time:** 2 hours for 85-90% coverage vs 3-4 hours for 100%

**Decision point:** Is 85-90% good enough for MVP, or do we need 100%?

---

## Expected Impact

### Before Conversion
- Resolved positions: 1.1M (8.2%)
- Unresolved positions: 12.3M (91.8%)
- Usable P&L coverage: **27.6%** of traded markets

### After Conversion
- Resolved positions: **~10M (75%)**
- Unresolved positions: ~3.5M (25%)
- Usable P&L coverage: **85-90%** of traded markets

### User Impact
- ✅ 75% of positions will have P&L calculated
- ✅ Wallet leaderboards will be accurate for most wallets
- ✅ Only very recent/active markets will show "unresolved"

---

## Next Steps

1. **Build converter script** (convert-text-resolutions-to-payouts.ts)
2. **Run conversion** on 424K resolution candidates
3. **Verify coverage** improvement
4. **Update P&L views** (they'll automatically pick up new payouts)
5. **Document any ambiguous cases** for manual review

**Estimated completion:** 2-3 hours total
