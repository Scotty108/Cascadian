# The 692 "Closed" Markets Mystery - SOLVED

## Summary

The 692 markets marked as "closed" in the database DID get their resolution data from the Polymarket API, but **the data is encoded in the `outcomePrices` field, not in a separate `resolvedOutcome` field**.

## Key Finding

**The Polymarket API NEVER returns a `resolvedOutcome` field.**

Instead, when a market resolves, the API returns `outcomePrices` as an array where one price is `"0"` and the other is `"1"`:
- `["0", "1"]` = NO won (first outcome = 0)
- `["1", "0"]` = YES won (first outcome = 1)

The `current_price` field in the database reflects this resolution state.

## The Data Flow

```
Polymarket API Response (for closed markets):
├── closed: true
├── active: true (or false)
├── outcomePrices: ["0", "1"]  ← RESOLUTION IS HERE
├── resolvedOutcome: undefined  ← NEVER PROVIDED
└── raw_polymarket_data stores this entire response
```

## Why Enrichment Only Works for 692 Markets

Looking at `enrich-trades.ts` lines 191-215:

```typescript
function calculateOutcome(market: ResolvedMarket, tradeSide: 'YES' | 'NO'): number | null {
  if (!market.closed) {
    return null
  }

  // Try to get resolved outcome from raw data
  const resolvedOutcome = market.raw_polymarket_data?.resolvedOutcome
  
  // If we have explicit outcome from Polymarket API
  if (resolvedOutcome !== undefined && resolvedOutcome !== null) {
    // ← This branch is NEVER taken (API never provides this field)
    ...
  }

  // Fallback: infer from final price
  const finalPrice = market.current_price
  
  if (finalPrice >= 0.98) {
    // YES won
    return tradeSide === 'YES' ? 1 : 0
  } else if (finalPrice <= 0.02) {
    // NO won
    return tradeSide === 'NO' ? 1 : 0
  }
  
  // Ambiguous resolution - skip for now ← This is why 98.7% of trades aren't enriched
  return null
}
```

## Why Only 29,108 Trades Were Enriched

The enrichment script uses a **high confidence threshold**:
- Only enriches if `current_price >= 0.98` OR `current_price <= 0.02`
- This means only markets with CLEAR resolution prices

But here's the problem: **We're only fetching ACTIVE markets from the Polymarket API.**

Looking at `lib/polymarket/client.ts` line 294:
```typescript
searchParams.set('closed', 'false');  // Only fetches active markets
```

And in the enrichment script line 100:
```typescript
.eq('closed', true)  // Only uses markets marked as closed in DB
```

So we have:
- 20,219 total markets in database
- 692 marked as closed (from historical API syncs where Polymarket returned them as closed)
- Only 29,108 trades can be enriched because we stopped syncing new closed markets

## The Missing 19,527 Markets

When we stopped syncing closed/resolved markets from the Polymarket API (probably to focus on active markets), we lost the ability to enrich trades on those markets.

**Resolution data IS available** on the Polymarket API through `/markets?closed=true` endpoint, but we're not regularly syncing it.

## Solution Options

### Option 1: Re-sync All Closed Markets (RECOMMENDED)
Fetch all closed markets from `GET /markets?closed=true` and add them to the database:

```typescript
async function syncClosedMarkets() {
  let offset = 0;
  const limit = 100;
  let allClosed = [];
  
  while (true) {
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?closed=true&limit=${limit}&offset=${offset}`
    );
    const markets = await response.json();
    
    if (markets.length === 0) break;
    allClosed.push(...markets);
    offset += limit;
  }
  
  // Upsert to database (will update existing with resolved prices)
  await supabase.from('markets').upsert(allClosed);
}
```

### Option 2: Enhance Enrichment to Parse `outcomePrices`
Extract resolution logic from `outcomePrices` array:

```typescript
function getResolvedOutcomeFromPrices(
  outcomePrices: string | undefined,
  outcomes: string[]
): number | null {
  if (!outcomePrices) return null;
  
  try {
    const prices = typeof outcomePrices === 'string' 
      ? JSON.parse(outcomePrices)
      : outcomePrices;
    
    // Find which outcome is 1 (won) and which is 0 (lost)
    if (Array.isArray(prices)) {
      if (prices[0] === "1" || prices[0] === 1) return 1; // First outcome won
      if (prices[1] === "1" || prices[1] === 1) return 0; // Second outcome won
    }
  } catch {
    return null;
  }
  
  return null;
}
```

### Option 3: Improve API Response Parsing
The enrichment script already falls back to `current_price` for inference, but it's too strict:

```typescript
// Current (only >= 0.98 or <= 0.02)
if (finalPrice >= 0.98) {
  return tradeSide === 'YES' ? 1 : 0
} else if (finalPrice <= 0.02) {
  return tradeSide === 'NO' ? 1 : 0
}

// Better (any price that's clearly resolved)
if (finalPrice >= 0.95) {  // Relaxed from 0.98
  return tradeSide === 'YES' ? 1 : 0
} else if (finalPrice <= 0.05) {  // Relaxed from 0.02
  return tradeSide === 'NO' ? 1 : 0
}
```

## Data Verification

The following script confirms the 692 markets have resolution data encoded in `outcomePrices`:

```bash
npx tsx scripts/investigate-692-markets.ts
```

Results:
- Total markets: 20,219
- Closed markets: 692
- Markets with `resolvedOutcome` field: 0
- Markets with `outcomePrices` as array: 692 (with values like ["0","1"] or ["1","0"])

## Why This Happened

1. **Initial sync**: Polymarket API returned ~700 closed markets with resolution prices encoded in `outcomePrices`
2. **DB schema limitation**: The team expected a dedicated `resolvedOutcome` field that Polymarket never provided
3. **Enrichment bug**: The enrichment script explicitly checks for `resolvedOutcome` (which doesn't exist) instead of parsing `outcomePrices`
4. **Sync focus shift**: Later syncs stopped fetching closed markets (probably for performance), so the 19,527 newer resolved markets never made it to the database

## Impact

- 98.7% of trades can't be enriched because we're missing resolution data for 19,527 markets
- The fix is straightforward: either sync closed markets OR enhance the enrichment logic
- All necessary data is available from the Polymarket API

## Recommended Next Steps

1. Run the closed market sync to get all 19,527+ resolved markets
2. Update enrichment logic to parse `outcomePrices` as fallback
3. Re-run enrichment on all trades
4. Verify the 29,108 → ~2.5M trades enriched

## Files to Update

- `/scripts/enrich-trades.ts` - Enhance `calculateOutcome()` to parse `outcomePrices`
- `/scripts/sync-markets-fast.ts` - Add option to sync closed markets
- New script: `/scripts/sync-closed-markets.ts` - Dedicated closed market syncer

