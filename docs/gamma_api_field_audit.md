# Polymarket Gamma API - Comprehensive Field Audit Report

**Date:** 2025-11-19
**Audit Scope:** 300+ sample markets from `https://gamma-api.polymarket.com/markets`
**Objective:** Identify ALL fields we should extract for tags, categorization, and metadata enrichment

---

## Executive Summary

**Current extraction coverage: ~60% of available fields**

We are currently extracting **31 fields** but the API provides **70+ fields** across market and event data. This audit identifies **39 additional fields** we should consider capturing, with **12 HIGH PRIORITY** fields for immediate implementation.

---

## 1. Complete API Response Structure

### Top-Level Market Fields (70 total)

```typescript
{
  // IDENTIFIERS (currently extracted ✓)
  id: string                           // ✓ Extracted as market_id
  conditionId: string                  // ✓ Extracted as condition_id
  slug: string                         // ✓ Extracted

  // CONTENT (currently extracted ✓)
  question: string                     // ✓ Extracted
  description: string                  // ✓ Extracted
  image: string                        // ✓ Extracted as image_url
  icon: string                         // ✓ Extracted as fallback
  twitterCardImage: string             // ❌ NOT extracted

  // CATEGORIZATION (partially extracted)
  category: string                     // ✓ Extracted in tags[0]
  mailchimpTag: string                 // ✓ Extracted in tags[1] as "mailchimp:X"
  marketType: string                   // ❌ NOT extracted (values: "normal", "scalar")
  formatType: string | null            // ❌ NOT extracted (for scalar: "decimal", "number", etc.)

  // STATE (currently extracted ✓)
  active: boolean                      // ✓ Used in is_active calculation
  closed: boolean                      // ✓ Extracted as is_closed
  archived: boolean                    // ❌ NOT extracted
  restricted: boolean                  // ❌ NOT extracted

  // METADATA FLAGS (NOT extracted)
  new: boolean                         // ❌ NOT extracted
  cyom: boolean                        // ❌ NOT extracted (Create Your Own Market)
  competitive: number                  // ❌ NOT extracted
  wideFormat: boolean | null           // ❌ NOT extracted

  // VOLUME (partial extraction)
  volume: string                       // ✓ Extracted as volume_usdc
  volumeNum: number                    // ✓ Used as fallback
  volume24hr: number                   // ❌ NOT extracted
  volume1wk: number                    // ❌ NOT extracted
  volume1mo: number                    // ❌ NOT extracted
  volume1yr: number                    // ❌ NOT extracted
  volume1wkAmm: number                 // ❌ NOT extracted (AMM volume)
  volume1moAmm: number                 // ❌ NOT extracted
  volume1yrAmm: number                 // ❌ NOT extracted
  volume1wkClob: number                // ❌ NOT extracted (CLOB volume)
  volume1moClob: number                // ❌ NOT extracted
  volume1yrClob: number                // ❌ NOT extracted

  // PRICE CHANGES (NOT extracted)
  oneDayPriceChange: number            // ❌ NOT extracted
  oneHourPriceChange: number           // ❌ NOT extracted
  oneWeekPriceChange: number           // ❌ NOT extracted
  oneMonthPriceChange: number          // ❌ NOT extracted
  oneYearPriceChange: number           // ❌ NOT extracted
  lastTradePrice: number               // ❌ NOT extracted

  // MARKET DEPTH (currently extracted ✓)
  liquidity: string                    // ✓ Extracted as liquidity_usdc
  liquidityNum: number                 // ✓ Used as fallback
  liquidityAmm: number                 // ❌ NOT extracted (separate AMM liquidity)
  liquidityClob: number                // ❌ NOT extracted (separate CLOB liquidity)
  spread: number                       // ✓ Extracted
  bestBid: number                      // ✓ Extracted as best_bid
  bestAsk: number                      // ✓ Extracted as best_ask

  // OUTCOMES (currently extracted ✓)
  outcomes: string[]                   // ✓ Extracted
  outcomePrices: string[]              // ✓ Extracted as JSON string

  // RESOLUTION (partially extracted)
  resolutionSource: string             // ✓ Extracted
  winningOutcome: string               // ✓ Extracted (but mostly empty)
  umaResolutionStatuses: string        // ❌ NOT extracted (UMA oracle data)

  // SCALAR MARKET BOUNDS (NOT extracted)
  lowerBound: string                   // ❌ NOT extracted (16/300 markets have this)
  upperBound: string                   // ❌ NOT extracted

  // CONFIGURATION (partially extracted)
  enableOrderBook: boolean             // ✓ Extracted as enable_order_book
  orderPriceMinTickSize: number        // ✓ Extracted
  notificationsEnabled: boolean        // ✓ Extracted
  pagerDutyNotificationEnabled: boolean // ❌ NOT extracted
  rfqEnabled: boolean                  // ❌ NOT extracted (Request for Quote)
  holdingRewardsEnabled: boolean       // ❌ NOT extracted
  feesEnabled: boolean                 // ❌ NOT extracted
  clearBookOnStart: boolean            // ❌ NOT extracted
  manualActivation: boolean            // ❌ NOT extracted
  negRiskOther: boolean                // ❌ NOT extracted
  fpmmLive: boolean                    // ❌ NOT extracted (Fixed Product Market Maker)

  // REWARDS (currently extracted ✓)
  rewardsMinSize: number               // ✓ Extracted as rewards_min_size
  rewardsMaxSpread: number             // ✓ Extracted as rewards_max_spread

  // METADATA
  marketMakerAddress: string           // ❌ NOT extracted
  clobTokenIds: string                 // ❌ NOT extracted
  creator: string                      // ❌ NOT extracted
  updatedBy: number                    // ❌ NOT extracted

  // TIMESTAMPS (currently extracted ✓)
  startDate: string                    // ✓ Extracted as start_date
  endDate: string                      // ✓ Extracted as end_date
  endDateIso: string                   // ✓ Used as fallback
  createdAt: string                    // ✓ Extracted as created_at
  updatedAt: string                    // ✓ Extracted as updated_at
  closedTime: string                   // ❌ NOT extracted

  // INTERNAL FLAGS
  ready: boolean                       // ❌ NOT extracted
  funded: boolean                      // ❌ NOT extracted
  approved: boolean                    // ❌ NOT extracted
  hasReviewedDates: boolean            // ❌ NOT extracted
  readyForCron: boolean                // ❌ NOT extracted
  pendingDeployment: boolean           // ❌ NOT extracted
  deploying: boolean                   // ❌ NOT extracted

  // EVENTS ARRAY (partially extracted)
  events: [{
    id: string                         // ✓ Extracted as event_id
    slug: string                       // ✓ Extracted as group_slug
    title: string                      // ❌ NOT extracted
    ticker: string                     // ❌ NOT extracted
    description: string                // ❌ NOT extracted (event-level, different from market)
    category: string                   // ❌ NOT extracted (event-level category)

    // EVENT METADATA
    featured: boolean                  // ❌ NOT extracted (0/300 were true in sample)
    seriesSlug: string                 // ❌ NOT extracted (66/300 markets have this)
    series: [{                         // ❌ NOT extracted (recurring market series)
      id: string
      slug: string
      title: string
      subtitle: string
      seriesType: string               // "single", etc.
      recurrence: string               // "weekly", etc.
      image: string
      icon: string
      active: boolean
      featured: boolean
      pythTokenID: string              // Pyth price feed ID
      cgAssetName: string              // CoinGecko asset name
      commentCount: number
      volume: number
      liquidity: number
      startDate: string
      // ... more fields
    }]

    // EVENT STATE
    active: boolean
    closed: boolean
    archived: boolean
    restricted: boolean

    // EVENT DISPLAY
    showAllOutcomes: boolean           // ❌ NOT extracted
    showMarketImages: boolean          // ❌ NOT extracted
    enableNegRisk: boolean             // ❌ NOT extracted
    negRiskAugmented: boolean          // ❌ NOT extracted

    // EVENT METRICS
    volume: number
    volume24hr: number
    volume1wk: number
    volume1mo: number
    volume1yr: number
    liquidity: number
    liquidityAmm: number
    liquidityClob: number
    openInterest: number               // ❌ NOT extracted
    commentCount: number               // ❌ NOT extracted
    competitive: number

    // EVENT DATES
    startDate: string
    creationDate: string
    endDate: string
    closedTime: string
    published_at: string

    sortBy: string                     // "ascending" etc.
    cyom: boolean
    pendingDeployment: boolean
    deploying: boolean
  }]
}
```

---

## 2. Missing Fields Analysis

### HIGH PRIORITY (Immediate Value)

| Field Path | Data Type | Coverage | Example Values | Why Important |
|------------|-----------|----------|----------------|---------------|
| `marketType` | string | 100% | "normal", "scalar" | **Critical for filtering** - distinguishes binary vs ranged markets |
| `formatType` | string | 5% | "decimal", "number" | **Essential for scalar markets** - defines price formatting |
| `lowerBound` | string | 5% | "5000", "8000000000" | **Required for scalar markets** - defines range bounds |
| `upperBound` | string | 5% | "15000", "20000000000" | **Required for scalar markets** - defines range bounds |
| `volume24hr` | number | ~5% | 1234.56 | **High-value filter** - active markets indicator |
| `volume1wk` | number | ~10% | 5678.90 | **Trending markets** - weekly activity |
| `oneDayPriceChange` | number | ~5% | 0.15 | **Momentum indicator** - price movement |
| `events[0].seriesSlug` | string | 22% | "btc-weeklies", "nba", "ufc" | **Powerful grouping** - recurring market series |
| `events[0].series` | array | 22% | Series metadata | **Rich context** - Pyth feeds, CoinGecko names |
| `events[0].commentCount` | number | 14% | 2621 | **Engagement metric** - community activity |
| `restricted` | boolean | varies | true/false | **Access control** - geographic/regulatory restrictions |
| `archived` | boolean | varies | true/false | **Lifecycle tag** - historical markets |

### MEDIUM PRIORITY (Enhanced Filtering)

| Field Path | Data Type | Coverage | Why Useful |
|------------|-----------|----------|------------|
| `volume1mo` / `volume1yr` | number | ~15% | Longer-term activity metrics |
| `liquidityAmm` / `liquidityClob` | number | varies | Separate AMM vs CLOB depth |
| `volume1wkAmm` / `volume1wkClob` | number | varies | Trading venue breakdown |
| `lastTradePrice` | number | ~5% | Most recent execution price |
| `oneWeekPriceChange` / `oneMonthPriceChange` | number | ~5% | Longer-term momentum |
| `events[0].openInterest` | number | varies | Total outstanding position value |
| `twitterCardImage` | string | 100% | Better social sharing image |
| `closedTime` | string | varies | Actual closure timestamp |
| `cyom` | boolean | <1% | User-created markets tag |
| `competitive` | number | <1% | Competition/tournament flag |

### LOW PRIORITY (Internal/Rare)

| Field Path | Data Type | Why Low Priority |
|------------|-----------|------------------|
| `rfqEnabled` / `feesEnabled` / `holdingRewardsEnabled` | boolean | Feature flags, mostly false |
| `clearBookOnStart` / `manualActivation` | boolean | Internal configuration |
| `fpmmLive` / `negRiskOther` | boolean | Technical implementation details |
| `marketMakerAddress` / `clobTokenIds` | string | Already in blockchain data |
| `creator` / `updatedBy` | string/number | Internal user IDs |
| `ready` / `funded` / `approved` | boolean | Internal state flags |
| `pendingDeployment` / `deploying` | boolean | Transient deployment state |
| `umaResolutionStatuses` | string | Duplicate of resolution data |
| `events[0].showAllOutcomes` | boolean | Display preference, rarely true |
| `events[0].enableNegRisk` | boolean | Technical flag, rarely true |

---

## 3. Tag Sources Analysis

### Current Tag Sources (2 fields)
```typescript
tags: [
  raw.category,              // ✓ Extracted
  `mailchimp:${raw.mailchimpTag}`  // ✓ Extracted
]
```

**Coverage:**
- `category`: ~80% of markets (sample showed some nulls)
- `mailchimpTag`: ~30% of markets

### Additional Tag Sources

| Source | Coverage | Example Tags | Implementation |
|--------|----------|--------------|----------------|
| **`marketType`** | 100% | "binary", "scalar" | Direct tag |
| **`formatType`** | 5% | "decimal", "number" | For scalar markets only |
| **`events[0].seriesSlug`** | 22% | "btc-weeklies", "eth-weeklies", "nba", "ufc", "mlb" | Powerful grouping tag |
| **`events[0].series[0].seriesType`** | 22% | "single", etc. | Series classification |
| **`events[0].series[0].recurrence`** | 22% | "weekly", etc. | Temporal pattern |
| **`restricted`** | varies | "restricted" (if true) | Access control tag |
| **`archived`** | varies | "archived" (if true) | Lifecycle tag |
| **`wideFormat`** | 31% | "wide-format" (if true) | Display format tag |
| **Volume tiers** | 100% | "high-volume", "medium-volume", "low-volume" | Computed from volume24hr |
| **Liquidity tiers** | 100% | "high-liquidity", "low-liquidity" | Computed from liquidity_usdc |
| **Activity status** | 100% | "trending", "stagnant" | Computed from volume24hr |

---

## 4. Field Coverage Statistics

Based on 300-market sample:

```
Markets with series data: 66 (22%)
Markets with resolution source: 269 (90%)
Markets with scalar bounds: 16 (5%)
Markets with wideFormat=true: 93 (31%)
Markets with wideFormat=false: 207 (69%)
Markets with mailchimpTag: ~90 (30%)

Volume coverage:
  volume24hr > 0: ~15 markets (5%)
  volume1wk > 0: ~30 markets (10%)
  volume1mo > 0: ~45 markets (15%)

Price changes (mostly old/closed markets):
  oneDayPriceChange != 0: ~15 markets (5%)
  lastTradePrice > 0: ~15 markets (5%)

Event-level:
  commentCount > 0: 14/100 (14%)
  featured = true: 0/100 (0% in sample)
```

---

## 5. Recommended Code Changes

### 5.1 Add to Schema (`pm_market_metadata` table)

```sql
-- HIGH PRIORITY additions to table schema
market_type String,                    -- "normal" or "scalar"
format_type String,                    -- "decimal", "number" (for scalar)
lower_bound String,                    -- Scalar market lower bound
upper_bound String,                    -- Scalar market upper bound

volume_24hr Float64,                   -- 24-hour volume
volume_1wk Float64,                    -- 1-week volume
volume_1mo Float64,                    -- 1-month volume

price_change_1d Float64,               -- 1-day price change
price_change_1w Float64,               -- 1-week price change
last_trade_price Float64,              -- Most recent trade price

series_slug String,                    -- Recurring series identifier
series_data String,                    -- JSON string of series metadata
comment_count UInt32,                  -- Community engagement

is_restricted UInt8,                   -- Geographic/regulatory restrictions
is_archived UInt8,                     -- Archived status
wide_format UInt8,                     -- Wide format display

-- MEDIUM PRIORITY
liquidity_amm Float64,                 -- AMM liquidity separate
liquidity_clob Float64,                -- CLOB liquidity separate
volume_1wk_amm Float64,                -- AMM volume breakdown
volume_1wk_clob Float64,               -- CLOB volume breakdown
open_interest Float64,                 -- Event-level open interest
twitter_card_image String,             -- Better social image
closed_time Nullable(DateTime64(3)),   -- Actual closure timestamp

-- LOW PRIORITY (optional)
cyom UInt8,                            -- User-created market flag
competitive UInt8,                     -- Competition flag
```

### 5.2 Update `transformToMetadata()` Function

```typescript
function transformToMetadata(raw: any): GammaMarketMetadata {
  // ... existing code ...

  // ========== HIGH PRIORITY ADDITIONS ==========

  // Market type classification
  const marketType = raw.marketType || 'normal';
  const formatType = raw.formatType || '';

  // Scalar market bounds
  const lowerBound = raw.lowerBound || '';
  const upperBound = raw.upperBound || '';

  // Volume breakdown
  const volume24hr = parseFloat(raw.volume24hr || '0');
  const volume1wk = parseFloat(raw.volume1wk || '0');
  const volume1mo = parseFloat(raw.volume1mo || '0');

  // Price changes
  const priceChange1d = parseFloat(raw.oneDayPriceChange || '0');
  const priceChange1w = parseFloat(raw.oneWeekPriceChange || '0');
  const lastTradePrice = parseFloat(raw.lastTradePrice || '0');

  // Series data (powerful grouping!)
  const seriesSlug = raw.events?.[0]?.seriesSlug || '';
  const seriesData = raw.events?.[0]?.series?.[0]
    ? JSON.stringify(raw.events[0].series[0])
    : '';

  // Community engagement
  const commentCount = parseInt(raw.events?.[0]?.commentCount || '0');

  // State flags
  const isRestricted = raw.restricted ? 1 : 0;
  const isArchived = raw.archived ? 1 : 0;
  const wideFormat = raw.wideFormat ? 1 : 0;

  // ========== MEDIUM PRIORITY ADDITIONS ==========

  const liquidityAmm = parseFloat(raw.liquidityAmm || '0');
  const liquidityClob = parseFloat(raw.liquidityClob || '0');
  const volume1wkAmm = parseFloat(raw.volume1wkAmm || '0');
  const volume1wkClob = parseFloat(raw.volume1wkClob || '0');
  const openInterest = parseFloat(raw.events?.[0]?.openInterest || '0');
  const twitterCardImage = raw.twitterCardImage || '';
  const closedTime = parseDate(raw.closedTime);

  // ========== ENHANCED TAGS ==========

  const tags: string[] = [];

  // Existing tags
  if (raw.category) tags.push(raw.category);
  if (raw.mailchimpTag) tags.push(`mailchimp:${raw.mailchimpTag}`);

  // NEW: Market type tag
  if (marketType) tags.push(`type:${marketType}`);

  // NEW: Series tag (powerful!)
  if (seriesSlug) tags.push(`series:${seriesSlug}`);

  // NEW: Format tag (for scalar)
  if (formatType) tags.push(`format:${formatType}`);

  // NEW: State tags
  if (isRestricted) tags.push('restricted');
  if (isArchived) tags.push('archived');
  if (wideFormat) tags.push('wide-format');
  if (raw.cyom) tags.push('cyom');

  // NEW: Computed activity tags
  if (volume24hr > 10000) tags.push('high-volume');
  else if (volume24hr > 1000) tags.push('medium-volume');
  else if (volume24hr > 0) tags.push('low-volume');

  if (liquidity > 50000) tags.push('high-liquidity');
  else if (liquidity > 10000) tags.push('medium-liquidity');

  if (volume24hr > 0 && priceChange1d !== 0) tags.push('trending');

  return {
    // ... existing fields ...

    // HIGH PRIORITY new fields
    market_type: marketType,
    format_type: formatType,
    lower_bound: lowerBound,
    upper_bound: upperBound,
    volume_24hr: volume24hr,
    volume_1wk: volume1wk,
    volume_1mo: volume1mo,
    price_change_1d: priceChange1d,
    price_change_1w: priceChange1w,
    last_trade_price: lastTradePrice,
    series_slug: seriesSlug,
    series_data: seriesData,
    comment_count: commentCount,
    is_restricted: isRestricted,
    is_archived: isArchived,
    wide_format: wideFormat,

    // MEDIUM PRIORITY new fields
    liquidity_amm: liquidityAmm,
    liquidity_clob: liquidityClob,
    volume_1wk_amm: volume1wkAmm,
    volume_1wk_clob: volume1wkClob,
    open_interest: openInterest,
    twitter_card_image: twitterCardImage,
    closed_time: closedTime,

    // Enhanced tags array
    tags,
  };
}
```

---

## 6. Implementation Priority

### Phase 1: HIGH VALUE (Implement Immediately)

1. **Market type classification** (`marketType`, `formatType`)
   - Essential for filtering binary vs scalar markets
   - 100% coverage
   - Minimal storage cost

2. **Scalar market bounds** (`lowerBound`, `upperBound`)
   - Required for proper scalar market display
   - 5% coverage but critical for those markets
   - Small storage cost

3. **Time-based volumes** (`volume24hr`, `volume1wk`, `volume1mo`)
   - High-value activity filters
   - Enable "trending markets" queries
   - 5-15% coverage but high information value

4. **Series grouping** (`events[0].seriesSlug`, `events[0].series`)
   - Powerful recurring market grouping
   - 22% coverage (66/300 markets)
   - Includes Pyth price feed IDs, CoinGecko asset names
   - **Example use case:** "Show all BTC weekly markets"

5. **State flags** (`restricted`, `archived`, `wideFormat`)
   - Important for filtering and display
   - Variable coverage
   - Tiny storage cost

### Phase 2: MEDIUM VALUE (Next Sprint)

6. **Price changes** (`oneDayPriceChange`, `lastTradePrice`)
   - Momentum indicators
   - ~5% coverage (mostly active markets)

7. **Liquidity breakdown** (`liquidityAmm`, `liquidityClob`)
   - Trading venue analysis
   - Variable coverage

8. **Engagement metrics** (`commentCount`, `openInterest`)
   - Community activity indicators
   - 14% coverage for comments

### Phase 3: LOW PRIORITY (Future)

9. **Internal flags** (various boolean flags)
   - Mostly for debugging/internal use
   - Low information value for users

---

## 7. Query Examples After Implementation

### Find trending BTC markets
```sql
SELECT question, volume_24hr, price_change_1d
FROM pm_market_metadata
WHERE has(tags, 'series:btc-weeklies')
  AND volume_24hr > 1000
ORDER BY volume_24hr DESC
LIMIT 10
```

### Find all scalar markets
```sql
SELECT question, market_type, lower_bound, upper_bound
FROM pm_market_metadata
WHERE market_type = 'scalar'
  AND is_active = 1
```

### Find high-engagement markets
```sql
SELECT question, comment_count, volume_24hr
FROM pm_market_metadata
WHERE comment_count > 100
  AND is_active = 1
ORDER BY comment_count DESC
```

### Find recurring series
```sql
SELECT series_slug, COUNT(*) as market_count, SUM(volume_usdc) as total_volume
FROM pm_market_metadata
WHERE series_slug != ''
GROUP BY series_slug
ORDER BY total_volume DESC
```

---

## 8. Storage Impact Estimate

Current schema: ~31 fields
Recommended HIGH PRIORITY additions: +15 fields
Recommended MEDIUM PRIORITY additions: +7 fields

**Total if implementing all:** 53 fields (71% increase)

**Storage per market (rough estimate):**
- Current: ~1.5 KB/market
- With HIGH PRIORITY: ~2.0 KB/market (+33%)
- With ALL additions: ~2.3 KB/market (+53%)

For 150,000 markets:
- Current: ~225 MB
- With HIGH PRIORITY: ~300 MB
- With ALL: ~345 MB

**Conclusion:** Storage cost is negligible, information gain is substantial.

---

## 9. Next Steps

1. **Review this report** with team - prioritize which fields are most valuable
2. **Update table schema** with HIGH PRIORITY fields
3. **Modify `transformToMetadata()`** to extract new fields
4. **Backfill existing data** (re-run ingest script)
5. **Update frontend filters** to use new tags and fields
6. **Add dashboard widgets** for series grouping, trending markets

---

## Appendix A: Complete Field Mapping

| API Field | Current Extraction | Should Extract? | Priority |
|-----------|-------------------|-----------------|----------|
| `id` | ✓ market_id | Yes | - |
| `conditionId` | ✓ condition_id | Yes | - |
| `slug` | ✓ slug | Yes | - |
| `question` | ✓ question | Yes | - |
| `description` | ✓ description | Yes | - |
| `image` | ✓ image_url | Yes | - |
| `icon` | ✓ fallback | Yes | - |
| `category` | ✓ tags[0] | Yes | - |
| `mailchimpTag` | ✓ tags[1] | Yes | - |
| `active` | ✓ is_active | Yes | - |
| `closed` | ✓ is_closed | Yes | - |
| `volume` | ✓ volume_usdc | Yes | - |
| `liquidity` | ✓ liquidity_usdc | Yes | - |
| `outcomes` | ✓ outcomes | Yes | - |
| `outcomePrices` | ✓ outcome_prices | Yes | - |
| `spread` | ✓ spread | Yes | - |
| `bestBid` | ✓ best_bid | Yes | - |
| `bestAsk` | ✓ best_ask | Yes | - |
| `resolutionSource` | ✓ resolution_source | Yes | - |
| `winningOutcome` | ✓ winning_outcome | Yes | - |
| `enableOrderBook` | ✓ enable_order_book | Yes | - |
| `orderPriceMinTickSize` | ✓ order_price_min_tick_size | Yes | - |
| `notificationsEnabled` | ✓ notifications_enabled | Yes | - |
| `events[0].id` | ✓ event_id | Yes | - |
| `events[0].slug` | ✓ group_slug | Yes | - |
| `rewardsMinSize` | ✓ rewards_min_size | Yes | - |
| `rewardsMaxSpread` | ✓ rewards_max_spread | Yes | - |
| `startDate` | ✓ start_date | Yes | - |
| `endDate` | ✓ end_date | Yes | - |
| `createdAt` | ✓ created_at | Yes | - |
| `updatedAt` | ✓ updated_at | Yes | - |
| **`marketType`** | ❌ | **YES** | **HIGH** |
| **`formatType`** | ❌ | **YES** | **HIGH** |
| **`lowerBound`** | ❌ | **YES** | **HIGH** |
| **`upperBound`** | ❌ | **YES** | **HIGH** |
| **`volume24hr`** | ❌ | **YES** | **HIGH** |
| **`volume1wk`** | ❌ | **YES** | **HIGH** |
| **`volume1mo`** | ❌ | **YES** | **HIGH** |
| **`oneDayPriceChange`** | ❌ | **YES** | **HIGH** |
| **`events[0].seriesSlug`** | ❌ | **YES** | **HIGH** |
| **`events[0].series`** | ❌ | **YES** | **HIGH** |
| **`events[0].commentCount`** | ❌ | **YES** | **HIGH** |
| **`restricted`** | ❌ | **YES** | **HIGH** |
| **`archived`** | ❌ | **YES** | **HIGH** |
| **`wideFormat`** | ❌ | **YES** | **HIGH** |
| `oneWeekPriceChange` | ❌ | YES | MEDIUM |
| `lastTradePrice` | ❌ | YES | MEDIUM |
| `liquidityAmm` | ❌ | YES | MEDIUM |
| `liquidityClob` | ❌ | YES | MEDIUM |
| `twitterCardImage` | ❌ | YES | MEDIUM |
| `closedTime` | ❌ | YES | MEDIUM |
| `events[0].openInterest` | ❌ | YES | MEDIUM |
| `cyom` | ❌ | Maybe | LOW |
| `competitive` | ❌ | Maybe | LOW |
| (38 other fields) | ❌ | No | LOW |

---

**End of Report**
