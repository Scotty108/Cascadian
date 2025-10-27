# Dimension Enrichment Summary
**Generated**: October 27, 2025, 12:00 PM

---

## 📊 EVENTS DIMENSION

**Total events fetched**: 50,100

### Category Field Coverage
**Events with non-null `category`**: 2,836 (5.7%)

**Top 10 categories** (using category field):
1. Sports: 1,443 events
2. Crypto: 270 events
3. US-current-affairs: 245 events
4. Pop-Culture: 182 events
5. NBA Playoffs: 124 events
6. Coronavirus: 109 events
7. Business: 101 events
8. NFTs: 75 events
9. Chess: 66 events
10. Art: 61 events

### Tags Coverage (Alternative to Category)
**Events with tags**: ~50,000 (99%+)

**Common category-like tags seen**:
- Politics (forceHide: true in many cases)
- Geopolitics
- World
- Sports
- Crypto
- Business
- Entertainment
- Science

**Note**: Most modern/recent events have `category: null` but include rich tags array. Tags include both high-level categories ("Politics", "Geopolitics") and specific topics ("Ukraine", "Putin", "kupyansk").

---

## 📊 MARKETS DIMENSION

**Total markets**: 4,961

### Event Association
**Markets with non-null `event_id`**: 3,497 (70.5%)
**Markets without `event_id`**: 1,464 (29.5%)

### Category Enrichment (via Events)
**Markets enrichable with category** (event has category field): **0 (0.0%)**

**Why so low?**
The 3,497 markets with event_ids reference 843 unique events. However, NONE of those 843 events have the `category` field populated. They all have `category: null` but include tags instead.

**Example**: Event "will-russia-capture-kupiansk-by"
- `category`: null
- `tags`: ["World", "Geopolitics", "Politics", "Ukraine", "Russia", "putin", etc.]

---

## 🎯 IMPLICATIONS FOR CATEGORY ATTRIBUTION

### Using Category Field Only (Current Approach)
- ❌ **0% of our 4,961 markets** can be categorized
- ❌ Our markets reference newer events that don't use the category field
- ❌ Cannot generate meaningful category-level P&L

### Using Tags as Categories (Recommended)
- ✅ **~70% of our markets** have event_id and can get tags
- ✅ Tags include useful category-like labels ("Geopolitics", "Politics", "Sports", "Crypto")
- ✅ Can extract primary category from tags array (e.g., first non-"All" tag)
- ⚠️  Requires mapping tags → canonical categories

---

## 📋 RECOMMENDATIONS

### Option 1: Accept Low Coverage (Not Recommended)
- Only 0% of markets have categories
- Cannot deliver on "wallet is good at Politics" narrative

### Option 2: Use Tags as Proxy Categories (Recommended)
**Implementation**:
1. For each market with `event_id`, look up event's tags
2. Extract category-like tags (filter out "All", specific names, dates)
3. Map common tags to canonical categories:
   - "Politics", "Geopolitics", "US-current-affairs" → **Politics**
   - "Sports", "NBA", "NFL", "NBA Playoffs" → **Sports**
   - "Crypto", "Bitcoin", "Ethereum" → **Crypto**
   - "Business", "Earnings" → **Business**
   - "Pop-Culture", "Entertainment" → **Entertainment**

4. Use first mapped category as primary category
5. Store all tags for fine-grained filtering

**Expected coverage**: ~70% of markets (those with event_id)

### Option 3: Hybrid Approach
1. Use `category` field where available (rare but authoritative)
2. Fall back to tags→category mapping
3. Mark uncategorized markets as "Other"

---

## 🔍 SAMPLE EVENTS ANALYSIS

### Event WITH Category (Old Sports Event)
```json
{
  "event_id": "nba-will-the-mavericks-beat-the-grizzlies...",
  "category": "Sports",
  "tags": [{"label": "All"}]
}
```

### Event WITHOUT Category (Modern Geopolitics Event)
```json
{
  "event_id": "will-russia-capture-kupiansk-by",
  "category": null,
  "tags": [
    {"label": "World"},
    {"label": "Geopolitics"},
    {"label": "Politics", "forceHide": true},
    {"label": "Ukraine"},
    {"label": "russia"},
    {"label": "putin"}
  ]
}
```

**For product purposes**, the second event should be categorized as **"Geopolitics"** or **"Politics"** based on tags.

---

## ⚠️  CRITICAL ISSUE

**Our market set (4,961 markets from signal wallets) references NEWER events that don't use Polymarket's category field.**

This means:
- We fetched 50,100 events (success!)
- 2,836 have categories (mostly old sports bets)
- But our 843 matched events are all category: null

**Root cause**: Our wallets trade on current/recent markets, which use tags instead of the legacy category field.

**Solution**: Implement tags→category mapping to unlock category attribution.

---

## ✅ WHAT WE DID GET

1. ✅ **Complete event hierarchy**: 50,100 events with full metadata
2. ✅ **Event→market linkage**: 70.5% of markets have event_id
3. ✅ **Rich tags**: Nearly all events have detailed tags array
4. ✅ **Condition→event mapping**: 131,191 condition mappings built

**Not useless** - we just need to adapt to Polymarket's data model (tags > category).

---

**Next Steps**:
1. Implement tags→category extraction logic
2. Define canonical category mappings
3. Re-generate wallet category breakdown using tags
4. Update watchlist auto-population to use tags-derived categories
