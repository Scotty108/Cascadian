# Wallet Bubble Chart Fix - Status Report
**Date:** October 24, 2025
**Wallet Tested:** `0xeffcc79a8572940cee2238b44eac89f2c48fda88` (FirstOrder)

---

## 🎯 Original Problem Statement

### Issue 1: Incorrect PnL Values
- **UI Shows:** Total PnL = $-8.1k (varying between $-5.7k to $-8.1k)
- **Polymarket Shows:** Total PnL = $287,642.40
- **Gap:** ~$295k discrepancy

### Issue 2: All Categories Show "Other"
- Bubble chart shows 100% of trades categorized as "Other"
- Should show: Crypto, Sports, Politics, Economics, Science & Tech, Pop Culture
- User requirement: **"I really want to avoid doing hard coded categories based on keywords. And I would rather be able to get that straight from the source of the API if we can"**

### Issue 3: Missing Category Bubbles
- Trades not grouping into category-based bubbles
- Visual representation not showing market type clustering

---

## 📊 Current Data Sources

### Polymarket Data-API
- **Endpoint:** `https://data-api.polymarket.com/closed-positions?user={address}&limit={limit}`
- **Pros:**
  - Has market titles, categories, condition IDs
  - Fast response time
  - Reliable uptime
- **Cons:**
  - Previously thought to only return wins (this was incorrect assumption)
  - Category enrichment requires CLOB API calls

### Goldsky PnL Subgraph
- **Endpoint:** `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn`
- **Pros:**
  - Complete win/loss data
  - Has realized PnL values
- **Cons:**
  - **CRITICAL BUG:** Currently failing with "Load failed" error
  - No `conditionId` field in `UserPosition` type (GraphQL schema limitation)
  - No market metadata (titles, categories)
  - PnL values need proper conversion factor (unknown)

### Polymarket CLOB API
- **Endpoint:** `https://clob.polymarket.com/markets/{conditionId}`
- **Pros:**
  - Returns market metadata including `tags` array
  - First tag is typically the category
  - Works for old/closed markets
- **Success Rate:** 100% when conditionIds are available
- **Example:** Successfully enriched 5/5 markets in testing

---

## 🔄 Attempts Made (Chronological)

### Attempt 1: Keyword-Based Category Matching ❌
**What we tried:** Created `categorizeMarket()` function matching market titles against keywords
**Result:** REJECTED by user - wanted API-sourced categories only
**Reason for failure:** User explicitly stated: *"I really want to avoid doing hard coded categories based on keywords"*

### Attempt 2: Polymarket Gamma-API Category Enrichment ✅ (Partial)
**What we tried:**
- Fetched categories from `https://gamma-api.polymarket.com/markets`
- Updated `mapPolymarketCategory()` to normalize category names
- Added to `/api/polymarket/wallet/[address]/closed-positions` route

**Result:** PARTIAL SUCCESS
- Closed-positions API successfully enriches: `"Total enriched: 5/5 with real Polymarket categories"`
- But old/closed markets not in gamma-api response

**Files Changed:**
- `app/api/polymarket/wallet/[address]/closed-positions/route.ts` (lines 17-43)

### Attempt 3: CLOB API Enrichment for Missing Markets ✅
**What we tried:**
- For markets not in database, fetch from CLOB API individually
- Extract category from `tags[0]` field

**Result:** SUCCESS for closed-positions API
```
[Closed Positions API] Found 0/5 markets in database
[Closed Positions API] Fetching 5 markets from Polymarket CLOB API...
[Closed Positions API] Enriched 5 more from CLOB API
[Closed Positions API] Total enriched: 5/5 with real Polymarket categories
```

**Files Changed:**
- `app/api/polymarket/wallet/[address]/closed-positions/route.ts` (lines 112-140)

### Attempt 4: PnL Matching Between Goldsky and Polymarket ❌
**What we tried:**
- Match Goldsky positions with Polymarket positions by PnL amount (10% tolerance)
- Transfer category data from matched positions

**Result:** POOR SUCCESS RATE
- Only 26/134 positions matched (19%)
- PnL values don't align due to conversion factor issues

**Files Changed:**
- `hooks/use-wallet-goldsky-positions.ts` (lines 155-215)

### Attempt 5: Database Enrichment Fallback ❌
**What we tried:**
- Query `markets` table for market data
- Match by title (lowercase, trimmed)

**Result:** 0/108 positions enriched
- Unmatched positions had placeholder titles: "Position 1", "Position 2"
- Database only has active markets, not historical closed markets

**Files Changed:**
- `hooks/use-wallet-goldsky-positions.ts` (lines 219-273)

### Attempt 6: TokenId → Market Resolution System ❌
**What we tried:**
- Built `buildTokenMap()` function to create tokenId → market mapping
- Fetched 1000 markets from gamma-api
- For each market, fetch tokens from CLOB API
- Cache map for 1 hour

**Result:** CATASTROPHIC FAILURE
- Takes 54+ seconds to build map
- API returned 0/108 tokens matched
- Server appears to hang during map building
- User reported: "NO change"

**Files Changed:**
- `app/api/polymarket/enrich-categories/route.ts` (lines 54-111, 117-160)
- `hooks/use-wallet-goldsky-positions.ts` (lines 266-313)

### Attempt 7: Add conditionId to Goldsky Query ❌
**What we tried:**
- Added `conditionId` and `outcomeIndex` fields to GraphQL query
- Planned to use conditionId for direct CLOB API lookups

**Result:** SCHEMA ERROR
```
Error: Type `UserPosition` has no field `conditionId`
Error: Type `UserPosition` has no field `outcomeIndex`
```

**Reason for failure:** Goldsky PnL Subgraph schema doesn't include these fields

**Files Changed:**
- `hooks/use-wallet-goldsky-positions.ts` (lines 105-117) - REVERTED

### Attempt 8: Switch from Goldsky to Polymarket Data ✅ (In Progress)
**What we tried:**
- Use Polymarket `/closed-positions` exclusively for bubble chart
- Updated metrics calculation to use Polymarket data
- Removed dependency on failing Goldsky hook

**Result:** PENDING VERIFICATION
- Should fix both PnL and category issues
- Polymarket data already enriched with categories (5/5 success rate)

**Files Changed:**
- `components/wallet-detail-interface/index.tsx` (lines 59, 391, 395)

---

## 🐛 Known Issues

### Critical Issues

1. **Goldsky Hook Failing with "Load failed"**
   - **Location:** `hooks/use-wallet-goldsky-positions.ts:229`
   - **Error:** `TypeError: Load failed`
   - **Impact:** Cannot fetch Goldsky data for bubble chart
   - **Likely Cause:**
     - CORS issue
     - Network connectivity problem
     - Goldsky API temporarily down
   - **Workaround:** Use Polymarket data instead (Attempt 8)

2. **PnL Conversion Factor Unknown**
   - **Issue:** Raw Goldsky PnL values don't match Polymarket display values
   - **Example:**
     - Raw: `14059`
     - Displayed: Should be ~$7,421.93 (based on Polymarket)
     - Current ÷1e6: $0.01
   - **Attempted conversions:**
     - ÷1e6 = $0.01 (too small)
     - ÷1e3 = $14.06 (too small)
     - ÷1e2 = $140.59 (too small)
     - ÷1e1 = $1,405.90 (still too small)
     - raw = $14,059.00 (likely too large)
   - **Need:** Console logs showing actual raw values vs expected Polymarket values

3. **Win Rate Showing 0% Despite 50.4% Actual**
   - **UI Shows:** "Win Rate: 0.0% ↓ 0W / 0L"
   - **Omega Score Shows:** "Win Rate: 50.4% • 944 closed trades" (CORRECT)
   - **Issue:** Metrics calculation using wrong data source
   - **Fix Applied:** Changed from `goldskyPositions` to `closedPositions` (Attempt 8)

### Minor Issues

4. **Port Mismatch**
   - **Error in logs:** `http://localhost:3002` referenced but dev server on `localhost:3004`
   - **Impact:** May cause fetch failures
   - **Severity:** Low (Next.js usually handles this)

5. **Multiple Backup Files in Codebase**
   - Found: `index.tsx.backup`, `index.tsx.bak`, `index.tsx.bak2`, `index.tsx.bak3`, `index.tsx.final`, `index.tsx.final2`, `index.tsx.fake-backup`
   - **Impact:** Code clutter, confusion
   - **Recommendation:** Clean up backup files

6. **Token Enrichment API Performance**
   - **buildTokenMap() takes 54+ seconds**
   - Processing 200 markets × batches of 10
   - Not scalable for production use
   - **Recommendation:** Remove or redesign with database caching

---

## ✅ What's Working

1. **Closed Positions API Category Enrichment**
   - Successfully enriching 100% of markets via CLOB API
   - Logs show: `"Total enriched: 5/5 with real Polymarket categories"`
   - Using Polymarket's actual category field (not keywords)

2. **Omega Score Calculation**
   - Showing correct data: "Win Rate: 50.4% • 944 closed trades"
   - Fetching from background worker successfully

3. **CLOB API Integration**
   - Reliable 200ms-1000ms response times
   - Works for old/closed markets
   - Provides category via `tags[0]`

4. **Category Mapping Function**
   - `mapPolymarketCategory()` successfully normalizes:
     - `cryptocurrency` → `Crypto`
     - `us-elections` → `Politics`
     - `science-tech` → `Science & Tech`
     - `pop-culture` → `Pop Culture`

---

## 🔧 Potential Fixes

### Fix 1: Complete Migration to Polymarket Data (RECOMMENDED) ⭐
**Status:** In progress (Attempt 8)

**What to do:**
1. ✅ DONE: Switch bubble chart to use `closedPositions` instead of `goldskyPositions`
2. ✅ DONE: Update metrics to use `closedPositions`
3. ⏳ PENDING: Verify categories are showing correctly
4. ⏳ PENDING: Verify PnL values match Polymarket ($287k)
5. ⏳ PENDING: Confirm win/loss visualization (red + green bubbles)

**Why this should work:**
- Polymarket `/closed-positions` API is enriching categories successfully (5/5)
- PnL values come directly from Polymarket (already correct)
- No conversion factor needed
- No Goldsky dependency

**Files to verify:**
- `components/wallet-detail-interface/index.tsx:391` - Using `closedPositions`
- `components/wallet-detail-interface/components/trading-bubble-chart.tsx:141` - Uses `category` field

**Testing steps:**
1. Refresh wallet page: `http://localhost:3004/analysis/wallet/0xeffcc79a8572940cee2238b44eac89f2c48fda88`
2. Check bubble chart shows categories (not "Other")
3. Verify Total PnL shows ~$287k
4. Verify Win Rate shows ~50.4%
5. Look for both green (wins) and red (losses) bubbles

### Fix 2: Debug and Fix Goldsky PnL Conversion
**Status:** Not started (requires console logs)

**What to do:**
1. Get raw console logs showing Goldsky position data:
   ```
   [Goldsky] Position 0:
     rawPnl=..., pnlInDollars (RAW)=$...
     avgPrice=..., totalBought=..., invested=$...
   ```
2. Compare with Polymarket's displayed values
3. Determine correct conversion factor
4. Update `hooks/use-wallet-goldsky-positions.ts:161-165`

**Why we need this:**
- Backup option if Polymarket migration fails
- Understanding Goldsky data format for future use
- May be needed for other features

### Fix 3: Increase Closed Positions Limit
**Status:** Not started

**Current limit:** 1000 positions
**Polymarket shows:** 9,233 predictions

**What to do:**
1. Increase limit to 10,000 in `components/wallet-detail-interface/index.tsx:48`
2. May need pagination if API doesn't support that high

### Fix 4: Clean Up Goldsky Hook Error Handling
**Status:** Not started

**What to do:**
1. Add better error handling in `hooks/use-wallet-goldsky-positions.ts`
2. Return empty array on error (already doing this)
3. Add user-friendly error message
4. Consider removing hook entirely if Polymarket migration succeeds

---

## 📁 Files Modified

### Primary Files
1. **`hooks/use-wallet-goldsky-positions.ts`**
   - Lines 105-117: Attempted conditionId query (REVERTED)
   - Lines 150-180: Added PnL conversion debugging
   - Lines 155-215: PnL matching logic
   - Lines 219-273: Database enrichment (0% success)
   - Lines 266-313: TokenId enrichment (REMOVED)

2. **`app/api/polymarket/wallet/[address]/closed-positions/route.ts`**
   - Lines 17-43: `mapPolymarketCategory()` function
   - Lines 89-109: Database enrichment step
   - Lines 112-140: CLOB API enrichment (100% success)

3. **`app/api/polymarket/enrich-categories/route.ts`**
   - Lines 18-24: Token map cache structure
   - Lines 54-111: `buildTokenMap()` function (SLOW - 54s)
   - Lines 117-160: TokenId enrichment endpoint

4. **`components/wallet-detail-interface/index.tsx`**
   - Line 59: Changed metrics to use `closedPositions`
   - Line 391: Changed bubble chart to use `closedPositions`
   - Line 395: Updated display message

5. **`components/wallet-detail-interface/components/trading-bubble-chart.tsx`**
   - Line 141: Uses `category` field from API (no keyword matching)

### Supporting Files
6. **`lib/polymarket/utils.ts`** - Contains `categorizeMarket()` (DEPRECATED - not used)

---

## 🎯 Next Steps (Priority Order)

### Immediate (Do Tomorrow Morning)

1. **Test Polymarket Data Migration (Fix 1)**
   - Refresh wallet page
   - Check console for any new errors
   - Verify categories showing correctly
   - Verify PnL shows ~$287k
   - Screenshot results

2. **If Still Showing "Other":**
   - Check browser console for `[Closed Positions API]` logs
   - Verify enrichment is happening: "Total enriched: X/Y with real Polymarket categories"
   - If Y is low, check CLOB API responses
   - May need to increase batch processing

3. **If PnL Still Wrong:**
   - Check if using Polymarket data (should be automatic now)
   - Verify `closedPositions` array has correct `realizedPnl` values
   - Check metrics calculation in `use-wallet-metrics.ts`

### Short Term

4. **Optimize Category Enrichment**
   - Consider caching CLOB API responses in database
   - Add batch processing for CLOB API calls
   - Monitor rate limiting

5. **Clean Up Codebase**
   - Remove backup files (`*.bak`, `*.backup`, `*.final`)
   - Remove unused `categorizeMarket()` function
   - Remove slow `buildTokenMap()` function
   - Remove `/api/polymarket/enrich-categories` route (not needed)

6. **Improve Error Handling**
   - Add user-friendly error messages
   - Graceful degradation when APIs fail
   - Loading states for enrichment process

### Long Term

7. **Database Optimization**
   - Store historical market categories in database
   - Pre-populate with common markets
   - Reduce API calls for repeat wallets

8. **Performance Monitoring**
   - Add timing logs for enrichment steps
   - Monitor CLOB API rate limits
   - Cache frequently accessed markets

9. **Consider Alternative Data Sources**
   - Polymarket Gamma-API for active markets
   - Goldsky if PnL conversion figured out
   - Hybrid approach for best reliability

---

## 📝 Important Code Snippets

### Working Category Mapping
```typescript
function mapPolymarketCategory(polymarketCategory: string | null): string {
  if (!polymarketCategory) return 'Other'

  const categoryMap: Record<string, string> = {
    'crypto': 'Crypto',
    'cryptocurrency': 'Crypto',
    'sports': 'Sports',
    'politics': 'Politics',
    'us-current-affairs': 'Politics',
    'us-elections': 'Politics',
    'economics': 'Economics',
    'business': 'Economics',
    'finance': 'Economics',
    'science-tech': 'Science & Tech',
    'technology': 'Science & Tech',
    'science': 'Science & Tech',
    'pop-culture': 'Pop Culture',
    'pop culture': 'Pop Culture',
    'entertainment': 'Pop Culture',
  }

  return categoryMap[polymarketCategory.toLowerCase()] || 'Other'
}
```

### Working CLOB API Enrichment
```typescript
const fetchPromises = missingConditionIds.map(async (conditionId) => {
  try {
    const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`)
    if (response.ok) {
      const market = await response.json()
      const categoryTag = market.tags?.[0]
      if (categoryTag) {
        const displayCategory = mapPolymarketCategory(categoryTag)
        marketCategories.set(conditionId, displayCategory)
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch market ${conditionId}:`, err)
  }
})

await Promise.all(fetchPromises)
```

### Current Bubble Chart Data Source (Should be Working)
```typescript
// components/wallet-detail-interface/index.tsx:390-391
<TradingBubbleChart
  closedPositions={closedPositions}  // Using Polymarket data
/>
```

### Bubble Chart Category Usage
```typescript
// components/wallet-detail-interface/components/trading-bubble-chart.tsx:141
const category = (pos as any).category || 'Other';
```

---

## 🔍 Debugging Commands

### Check Dev Server Logs
```bash
# See latest compilation/API logs
tail -100 ~/.local/state/claudecode/background_bash_*/output.txt
```

### Test CLOB API Directly
```bash
curl "https://clob.polymarket.com/markets/0x123..." | jq '.tags[0]'
```

### Test Closed Positions API
```bash
curl "http://localhost:3004/api/polymarket/wallet/0xeffcc79a8572940cee2238b44eac89f2c48fda88/closed-positions?limit=10"
```

### Check Database Markets Count
```sql
SELECT COUNT(*) FROM markets WHERE category IS NOT NULL;
```

---

## 📊 Success Metrics

**We'll know it's working when:**
1. ✅ Total PnL shows ~$287,642.40 (matching Polymarket)
2. ✅ Win Rate shows ~50.4% (matching Omega score)
3. ✅ Bubble chart shows 6-8 category bubbles (not just "Other")
4. ✅ Categories include: Crypto, Sports, Politics (at minimum)
5. ✅ Both green (wins) and red (losses) bubbles visible
6. ✅ Hover shows correct market names (not "Position 1", "Position 2")

**Acceptance criteria:**
- At least 80% of positions categorized correctly (not "Other")
- PnL within $1000 of Polymarket's displayed value
- Page loads in under 5 seconds
- No console errors

---

## 💡 Key Learnings

1. **Goldsky vs Polymarket Data:**
   - Goldsky has complete data but complex conversion factors
   - Polymarket Data-API has accurate display values
   - CLOB API is reliable for enrichment

2. **Category Enrichment Strategy:**
   - Keyword matching = ❌ User rejected
   - API-sourced categories = ✅ User approved
   - CLOB API `tags[0]` = ✅ Working solution

3. **Performance Considerations:**
   - Building token maps = Too slow (54s)
   - Individual CLOB calls = Fast enough (200-1000ms)
   - Database caching = Worth exploring

4. **GraphQL Schema Limitations:**
   - Goldsky PnL Subgraph doesn't have `conditionId` in `UserPosition`
   - Must use alternative enrichment strategies
   - May need to use different subgraph for metadata

---

## 📞 Questions to Answer Tomorrow

1. **Are categories showing correctly now?**
   - Expected: Crypto, Sports, Politics, etc.
   - If still "Other": Check CLOB API enrichment logs

2. **Is PnL matching Polymarket?**
   - Expected: ~$287k
   - If wrong: Check data source (should be `closedPositions`)

3. **Should we keep or remove Goldsky hook?**
   - If Polymarket migration works: Remove it
   - If needed for other features: Fix the conversion factor

4. **Do we need to fetch more than 1000 closed positions?**
   - Wallet has 9,233 predictions
   - May need pagination or higher limit

---

## 📧 Contact Info for APIs

- **Polymarket Data-API:** No auth required, public endpoint
- **Polymarket CLOB API:** No auth required, public endpoint
- **Goldsky:** Public Polymarket subgraphs, no API key needed
- **Rate Limits:** Unknown - monitor for 429 errors

---

**Report Generated:** October 24, 2025
**Last Updated Attempt:** #8 - Polymarket Data Migration
**Status:** PENDING VERIFICATION
**Next Action:** Test wallet page refresh and verify categories + PnL
