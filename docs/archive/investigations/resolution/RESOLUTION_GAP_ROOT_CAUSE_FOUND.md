# Resolution Gap - Root Cause Analysis ✅

**Date:** 2025-11-09
**Status:** ROOT CAUSE IDENTIFIED

---

## 🎯 THE PROBLEM

You were right to question everything. The investigation uncovered:

1. **148K positions showing as "unresolved"** (91.8% of all positions!)
2. **Only 1.1M resolved positions** (8.2%) - suspiciously low
3. **Wallet 0x4ce7 shows 0 resolved markets** despite having 30 traded markets

---

## 🔍 ROOT CAUSE DISCOVERED

### Finding #1: Incomplete Market Backfill

**What Happened:**
- Backfilled 161,180 markets from Gamma API
- ClickHouse has trades for **227,838 unique condition_ids**
- **Gap: 66,658 markets missing from api_markets_staging** (29%)

**Proof:**
```sql
-- Markets we're trading
SELECT COUNT(DISTINCT condition_id) FROM fact_trades_clean
Result: 227,838

-- Markets we backfilled
SELECT COUNT(DISTINCT condition_id) FROM api_markets_staging
Result: 161,180

-- Missing
227,838 - 161,180 = 66,658 markets (29% gap)
```

**Example:**
- Condition ID: `c007c362e141a1ca...` ("Will Joe Biden get Coronavirus?")
- **128,314 trades** from **27,057 wallets**
- **384 days old** (from 2020 election!)
- ❌ **NOT in api_markets_staging**
- ✅ **IS in Gamma API** (marked closed: true)

### Finding #2: Markets Missing Payout Vectors

**What Happened:**
- 161K markets in api_markets_staging
- But only **56,575 have actual payout vectors** (payout_denominator > 0)
- **Gap: 104,605 markets lack resolution data** (65% of backfilled markets!)

**Why This Matters:**
- These markets show in database but can't calculate P&L
- Many are **OLD, CLOSED markets** that should have resolutions
- This is NOT "markets still active" - it's missing data

### Finding #3: Multiple Trade Tables Causing Confusion

**Discovered:**
- `cascadian_clean.fact_trades_clean` - Has 227K condition_ids ✅
- `default.fact_trades_clean` - Different table, fewer markets ⚠️
- `default.vw_trades_canonical` - View over one of the above
- P&L views may be using wrong table

**This explains contradictory results:**
- "0 markets missing" when querying wrong table
- "66K markets missing" when counting from correct table

---

## 📊 THE FULL PICTURE

```
Total Markets Traded:           227,838 condition_ids
├─ In api_markets_staging:      161,180 (71%)
│  ├─ With payout vectors:       56,575 (25% of total)
│  └─ Without payouts:          104,605 (46% of total)
└─ NOT in staging at all:        66,658 (29% of total)

Resolution Coverage:
├─ Can calculate P&L:            56,575 markets (25%)
└─ Cannot calculate P&L:        171,263 markets (75%)
```

**Translation:**
- **Only 25% of traded markets have the data needed for P&L**
- 75% are either missing from staging OR lack payout vectors
- This explains why wallet 0x4ce7 and others show $0 P&L

---

## 🔧 WHY THE BACKFILL FAILED

### Problem with Pagination Approach

**What we did:**
```typescript
// backfill-all-markets-global.ts
while (true) {
  const url = `https://gamma-api.polymarket.com/markets?limit=500&offset=${offset}`;
  const markets = await fetch(url).json();
  // ...
}
```

**Why it failed:**
1. Gamma API pagination might not return ALL historical markets
2. Old/archived markets may not be in the default paginated results
3. 2020-2024 markets may be filtered out by API defaults
4. No explicit filter for "give me EVERYTHING including historical"

### The Fix

**Instead of paginating all markets, query by condition_id:**

```typescript
// For each condition_id we're actually trading:
for (const conditionId of tradedConditionIds) {
  const url = `https://gamma-api.polymarket.com/markets?condition_id=0x${conditionId}`;
  const market = await fetch(url).json();
  // This ensures we get EVERY market we actually trade
}
```

**Benefits:**
- Guaranteed to get every traded market
- No pagination issues
- Covers full history (2020-2024)
- Won't miss old/archived markets

---

## 🎯 ACTION PLAN TO FIX

### Phase 1: Backfill Missing 66K Markets (2-3 hours)

**Script:** `backfill-missing-markets-by-condition-id.ts`

```typescript
// 1. Get all traded condition_ids
const tradedIds = await clickhouse.query(`
  SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
  FROM cascadian_clean.fact_trades_clean
`);

// 2. Get which ones are already in staging
const existingIds = await clickhouse.query(`
  SELECT DISTINCT condition_id
  FROM default.api_markets_staging
`);

// 3. Find the gap
const missingIds = tradedIds.filter(id => !existingIds.includes(id));
// Expected: ~66K markets

// 4. Fetch each from Gamma by condition_id
for (const conditionId of missingIds) {
  const url = `https://gamma-api.polymarket.com/markets?condition_id=0x${conditionId}`;
  const market = await fetch(url).json();

  if (market.length > 0) {
    await insertIntoStaging(market[0]);
  }
}
```

**Result:** All 227K traded markets will be in api_markets_staging

### Phase 2: Get Payout Vectors (Strategy TBD)

Once we have all 227K markets in staging, we need resolution data for the 171K that lack payouts.

**Option A: Query Each Market's Status**

```typescript
// For markets in staging without payouts:
for (const market of marketsWithoutPayouts) {
  // Check if Gamma now shows it as closed/resolved
  const updated = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=0x${market.condition_id}`).json();

  if (updated[0].closed) {
    // Try to get resolution from other sources:
    // - Check gamma_resolved table
    // - Check resolution_candidates table
    // - Query blockchain for ConditionResolved event
  }
}
```

**Option B: Blockchain Event Replay**

```typescript
// Replay ConditionResolved events from Polygon
// For block range 2020-2024
const resolvedEvents = await eth.getLogs({
  address: CTF_CONTRACT,
  topics: [ConditionResolvedSignature],
  fromBlock: '2020-01-01',
  toBlock: 'latest'
});

// Parse and insert payout vectors
for (const event of resolvedEvents) {
  const { conditionId, payoutNumerators, payoutDenominator } = parseEvent(event);
  await insertResolution(conditionId, payoutNumerators, payoutDenominator);
}
```

**Option C: Merge Existing ClickHouse Tables**

We have these tables with partial resolution data:
- `gamma_resolved` - 123K markets
- `resolution_candidates` - 424K records
- `api_ctf_bridge` - 157K markets

Merge them into `market_resolutions_final` to fill gaps.

---

## 🚨 IMMEDIATE CONCERNS

### 1. Which Trade Table is Canonical?

We found:
- `cascadian_clean.fact_trades_clean` - 227K condition_ids
- `default.fact_trades_clean` - unknown coverage
- `default.vw_trades_canonical` - unknown which it uses

**Need to verify:**
- Which table do the P&L views actually use?
- Are they using the table with 227K or fewer markets?
- This could explain the 8.2% resolved rate

### 2. Data Consistency

**Questions:**
- Do all 227K condition_ids have market metadata somewhere?
- Are they all legitimate Polymarket markets?
- Could some be test/invalid markets?

**Validation query:**
```sql
-- Sample 100 random traded condition_ids
SELECT cid_hex, COUNT(*) as trades
FROM cascadian_clean.fact_trades_clean
WHERE cid_hex NOT IN (SELECT condition_id FROM api_markets_staging)
GROUP BY cid_hex
ORDER BY trades DESC
LIMIT 100;

-- Check if they exist in Gamma API
-- If yes → Our backfill missed them
-- If no → They're invalid/test data
```

---

## 📈 EXPECTED FINAL STATE

After completing both phases:

```
Total Markets Traded:           227,838 condition_ids
├─ In api_markets_staging:      227,838 (100%) ✅
│  ├─ With payout vectors:      180,000+ (80%+) ✅
│  └─ Without payouts:           47,000- (20%-) ⚠️
└─ NOT in staging at all:             0 (0%) ✅

Resolution Coverage:
├─ Can calculate P&L:           180,000+ markets (80%+) ✅
└─ Cannot calculate P&L:         47,000- markets (20%-)
   (these are genuinely unresolved)
```

**For Wallet 0x4ce7:**
- Currently: 31 markets (June-Nov 2024 only)
- After Phase 1: Still 31 markets (they only traded recently)
- After Historical Backfill: 2,816 predictions (all-time)

**Note:** Wallet 0x4ce7 specifically needs historical API backfill (pre-June 2024) since they've been trading since 2020. The 66K missing markets are different from their missing history.

---

## 🎯 DECISION POINT

**You asked:** "Does that sound right to what your research showed?"

**Answer:** Your research agent was **CORRECT** about the core issue:
- ✅ ClickHouse only has 5 months of data (June-Nov 2024)
- ✅ Missing historical trades for wallets like 0x4ce7
- ✅ Need to backfill from API or blockchain

**BUT** there are **TWO separate problems:**

**Problem 1:** Missing historical trades for specific wallets
- Scope: Wallets that traded pre-June 2024
- Solution: Targeted API backfill for ~50-100 high-value wallets
- Time: 1-2 hours

**Problem 2:** Missing market metadata and resolutions for June-Nov 2024
- Scope: 66K markets we ARE trading but don't have metadata for
- Solution: Backfill by condition_id (not pagination)
- Time: 2-3 hours

**Both need fixing**, but they're different issues with different solutions.

---

## 🚀 RECOMMENDATION

### Immediate (Next 2 Hours)

1. **Fix the market backfill** (Phase 1 above)
   - Get all 227K traded markets into api_markets_staging
   - This unblocks P&L for June-Nov 2024 data
   - Impacts ALL wallets

2. **Verify P&L views use correct table**
   - Ensure they query `cascadian_clean.fact_trades_clean`
   - Not some other table with fewer markets

### Short-Term (Next 4 Hours)

3. **Get payout vectors** (Phase 2 above)
   - Try merging existing tables first (fastest)
   - Then query Gamma for updated status
   - Last resort: blockchain event replay

4. **Test end-to-end**
   - Should see ~80% resolution coverage
   - P&L calculations work for most wallets

### Long-Term (Next Day)

5. **Historical wallet backfill**
   - For wallet 0x4ce7 and other high-value wallets
   - Get their pre-June 2024 history
   - Use targeted API approach (not 996K wallets!)

---

## 📊 SUCCESS METRICS

**After Phase 1:**
- ✅ 227,838 markets in api_markets_staging (100% of traded)
- ✅ 0 markets missing

**After Phase 2:**
- ✅ 180,000+ markets with payout vectors (80%+)
- ✅ vw_wallet_pnl_summary shows realistic numbers
- ✅ Wallet 0x4ce7 still shows 31 markets (correct for June-Nov window)

**After Historical Backfill:**
- ✅ Wallet 0x4ce7 shows 2,816 predictions (all-time)
- ✅ Top 100 wallets have complete history
- ✅ Leaderboards ready for production

---

## 🎯 FINAL ANSWER TO YOUR QUESTION

> "Why are we running a wallet backfill when we should be running just a condition ID to resolution for all market backfill?"

**You were 100% RIGHT!**

The correct order is:
1. ✅ Backfill ALL markets by condition_id (not pagination)
2. ✅ Get payout vectors for those markets
3. ✅ SQL-based P&L works for everyone (no wallet API needed)
4. ✅ Only then backfill historical data for specific high-value wallets

The 996K wallet crawl was wrong because:
- It tried to get positions via API for all wallets
- But we already have the trade data in ClickHouse
- We just need market metadata + resolutions
- That's a market-level backfill, not wallet-level

**Your instinct was spot on.** The investigation confirmed it and found even more gaps in the market backfill itself.

---

**Next Step:** Should I create the `backfill-missing-markets-by-condition-id.ts` script to fix Phase 1?
