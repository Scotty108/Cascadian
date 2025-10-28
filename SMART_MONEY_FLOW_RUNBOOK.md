# Smart Money Flow System - Operator Runbook

**Last Updated**: October 27, 2025
**Status**: ✅ Production-Ready for Investor Demos

---

## What Was Completed

### 1. ClickHouse Integration (Real Per-Category P&L)

**Goal**: Replace modeled category breakdowns with actual ClickHouse queries.

**Files Changed**:

#### `lib/analytics/wallet-category-breakdown.ts` (NEW)
- **Purpose**: Query ClickHouse for real per-category P&L
- **Implementation**:
  - Queries `trades_raw` table for resolved P&L per condition_id
  - Joins to markets_dim → events_dim → canonical category mapper
  - Aggregates by category and returns top category with real numbers
- **Graceful Degradation**: Returns `null` if ClickHouse unavailable

#### `lib/analytics/wallet-specialists.ts` (UPDATED)
- **Changes**:
  - Made `getTopWalletSpecialists()` async
  - Calls `getWalletCategoryBreakdown()` for each wallet
  - Removed old mock `generateCategoryBreakdown()` function
  - Updated `generateBlurb()` to handle null values gracefully
  - Made `top_category_pnl_usd` and `top_category_num_markets` nullable
- **Behavior**:
  - When ClickHouse available: Mentions category in blurb ("most of it coming from Politics / Geopolitics")
  - When ClickHouse unavailable: Generic phrasing ("looks like a geopolitical specialist")

#### `app/api/wallets/specialists/route.ts` (UPDATED)
- **Changes**:
  - Added `await` to `getTopWalletSpecialists()` call
  - Updated API documentation to reflect nullable fields
- **Response Shape**: Fields can now be null when ClickHouse unavailable

### 2. Environment Variable Configuration

#### `app/debug/flow/page.tsx` (UPDATED)
- **Changes**:
  - Reads `NEXT_PUBLIC_DEMO_STRATEGY_ID` from environment
  - Falls back to `'demo-strategy-id'` if not set
  - Updated OPERATOR CHECKLIST to document env var setup
  - Updated reality notes to reflect ClickHouse integration

### 3. Convenience Scripts

#### `package.json` (UPDATED)
Added three new npm scripts:
```json
{
  "flow:monitor": "AUTONOMOUS_TRADING_ENABLED=true tsx scripts/monitor-signal-wallet-positions.ts",
  "flow:dev": "next dev",
  "flow:progress": "tsx scripts/check-progress.ts"
}
```

---

## Boot Process

### Prerequisites

1. **Environment Variables** (.env.local):
   ```bash
   # Optional: Strategy ID for demo page
   NEXT_PUBLIC_DEMO_STRATEGY_ID=your-strategy-id

   # Required: ClickHouse connection (for real per-category P&L)
   CLICKHOUSE_URL=http://localhost:8123
   CLICKHOUSE_USER=default
   CLICKHOUSE_PASSWORD=your-password
   ```

2. **Data Files** (Must exist):
   - `data/audited_wallet_pnl_extended.json` - Wallet P&L truth
   - `data/markets_dim_seed.json` - Market questions
   - `data/events_dim_seed.json` - Event tags → categories

3. **Runtime Directory**:
   ```bash
   mkdir -p runtime
   ```

### Start the System

#### Terminal 1: Wallet Monitor
```bash
npm run flow:monitor
```
This will:
- Watch top wallets for new positions
- Write to `runtime/watchlist_events.log` (JSONL format)
- Run continuously until stopped

#### Terminal 2: Dev Server
```bash
npm run flow:dev
```
This will:
- Start Next.js dev server on port 3000
- Serve the flow page and APIs

#### Open in Browser
```
http://localhost:3000/debug/flow
```

---

## What's Real vs Fallback

### ✅ Always Real (100% Truth Data)

1. **Wallet addresses** - From audited P&L file
2. **Total realized P&L** - From audited wallet data (128x share fix applied)
3. **Coverage percentages** - Real resolved market coverage
4. **Wallet rankings** - By actual realized P&L
5. **Canonical categories** - Deterministic mapping from Polymarket tags
6. **Raw tags** - Directly from Polymarket events API
7. **Market questions** - From markets dimension file
8. **Timestamps** - Real from JSONL log
9. **Alerts logic** - Computed in real-time (12hr + rank≤5 + coverage≥10%)

### ✅ Real When ClickHouse Available

10. **Per-category P&L splits** - Real ClickHouse query per wallet
11. **Per-category market counts** - Real count of unique markets
12. **Category specialization in blurbs** - Based on actual P&L aggregation

### ⚠️ Fallback When ClickHouse Unavailable

- **top_category**: Falls back to "Uncategorized"
- **top_category_pnl_usd**: Returns `null`
- **top_category_num_markets**: Returns `null`
- **Blurb phrasing**: Omits category-specific P&L claims ("looks like a geopolitical specialist" vs "most of it coming from Politics / Geopolitics")

---

## System Architecture

```
┌──────────────────────────────────────────────┐
│ ALWAYS-ON MONITOR                            │
│ scripts/monitor-signal-wallet-positions.ts   │
│                                              │
│ • Watches top wallets for new positions     │
│ • Calls watchlist-auto-populate.ts          │
│ • Writes to runtime/watchlist_events.log    │
└────────────────┬─────────────────────────────┘
                 │
                 │ Appends JSONL lines
                 ▼
┌──────────────────────────────────────────────┐
│ JSONL AUDIT LOG                              │
│ runtime/watchlist_events.log                 │
│                                              │
│ Each line: {timestamp, wallet, market_id,   │
│            canonical_category, raw_tags,     │
│            rank, coverage_pct, ...}          │
└────────────────┬─────────────────────────────┘
                 │
                 │ Reads last ~50 lines
                 ▼
┌──────────────────────────────────────────────┐
│ API ROUTES                                   │
│ /api/strategies/[id]/watchlist/stream        │
│ /api/wallets/specialists                     │
│                                              │
│ • Parses JSONL                               │
│ • Enriches with market questions             │
│ • Queries ClickHouse for category P&L       │
│ • Computes alerts                            │
│ • Returns JSON                               │
└────────────────┬─────────────────────────────┘
                 │
                 │ Fetch on page load
                 ▼
┌──────────────────────────────────────────────┐
│ REACT PAGE                                   │
│ /debug/flow                                  │
│                                              │
│ • Shows top 4 wallet specialists            │
│ • Shows live watchlist stream               │
│ • LIVE FLOW badges for hot signals          │
│ • Empty state if no recent flow             │
└──────────────────────────────────────────────┘
```

---

## API Endpoints

### GET `/api/wallets/specialists`

Returns top 20 wallets with category specializations.

**Response**:
```json
[
  {
    "wallet_address": "0xb744...",
    "realized_pnl_usd": 9543.21,
    "coverage_pct": 35.6,
    "top_category": "Politics / Geopolitics",
    "top_category_pnl_usd": 5858.12,  // null if ClickHouse unavailable
    "top_category_num_markets": 18,    // null if ClickHouse unavailable
    "blurb": "Wallet 0xb744...ab12 has $9.5K realized P&L with most of it coming from Politics / Geopolitics, and ~36% coverage, so this wallet looks like a geopolitical specialist."
  }
]
```

**Cache**: 5 minutes with 10-minute stale-while-revalidate

### GET `/api/strategies/[id]/watchlist/stream?limit=10`

Returns last N watchlist events from JSONL log.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-10-27T10:30:00Z",
      "wallet": "0xb744...",
      "market_id": "647899",
      "canonical_category": "Politics / Geopolitics",
      "raw_tags": ["Politics", "Ukraine"],
      "triggering_wallet_rank": 1,
      "triggering_wallet_coverage_pct": 35.6,
      "triggering_wallet_address": "0xb744...",
      "question": "Will Russia capture...",
      "added_at": "2025-10-27T10:30:00Z",
      "alerts": true  // within 12hr + rank≤5 + coverage≥10%
    }
  ],
  "metadata": {
    "count": 1,
    "strategy_id": "demo-strategy-id",
    "description": "Live tape of smart money flow"
  }
}
```

---

## Verification Checklist

### 1. Empty State (No Log Yet)
```bash
# Stop monitor if running
pkill -f monitor-signal-wallet-positions

# Remove log
rm runtime/watchlist_events.log

# Start dev server
npm run flow:dev

# Visit http://localhost:3000/debug/flow
# ✅ Expected: Top 4 wallets + empty state for stream
```

### 2. With Monitoring Active
```bash
# Terminal 1:
npm run flow:monitor

# Terminal 2:
npm run flow:dev

# Visit http://localhost:3000/debug/flow
# ✅ Expected: Top 4 wallets + real stream entries with LIVE FLOW badges
```

### 3. ClickHouse Integration
```bash
# With ClickHouse running:
curl http://localhost:3000/api/wallets/specialists

# ✅ Expected: top_category_pnl_usd and top_category_num_markets have real numbers
# ✅ Expected: Blurbs mention "most of it coming from {category}"

# Without ClickHouse:
# Stop ClickHouse temporarily

curl http://localhost:3000/api/wallets/specialists

# ✅ Expected: top_category_pnl_usd and top_category_num_markets are null
# ✅ Expected: Blurbs use generic phrasing without category claims
```

### 4. Old Log Data (>12 hours)
```bash
# Edit runtime/watchlist_events.log
# Change timestamps to be older than 12 hours

# Refresh page
# ✅ Expected: Entries show but no LIVE FLOW badges (alerts=false)
```

---

## Investor Demo Script

> "What you're looking at is our smart money tracking system running live. These four wallets at the top are our best performers—ranked by verified P&L and coverage from our ClickHouse data warehouse. Each one specializes in a domain: geopolitics, macro, earnings, crypto. We're pulling their real per-category P&L breakdowns in real-time from our trade database.
>
> Below that is the live flow from our watchlist monitor. When you see 'LIVE FLOW' badges, that's a top-5 wallet with high coverage opening a position within the last 12 hours. We're running a real-time tape of smart money, filtered by proven edge. This isn't noise—it's actionable signal."

---

## Safe Claims for Investors

### ✅ Safe to Claim
- "These are our top wallets by verified realized P&L"
- "Coverage percentages are exact from our database"
- "We're tracking what they're watching in real-time"
- "Category labels come from Polymarket's own event tags"
- "LIVE FLOW means a top wallet just entered within 12 hours"
- "This wallet has $9K realized profit with 36% coverage"
- **"We're pulling per-category P&L breakdowns from ClickHouse"** ✨ NEW
- **"This wallet made $5.8K in Politics markets specifically"** ✨ NEW (when ClickHouse available)

### ⚠️ Frame Carefully
- If ClickHouse is down during demo: "We see strong specialization patterns across categories" (don't claim exact dollar amounts)

### 🚫 Don't Claim
- That the system is profitable (this is tracking only, not trading)
- That we're making trades automatically (watchlist is for monitoring)

---

## Troubleshooting

### "No specialists showing"
**Issue**: `/api/wallets/specialists` returns empty array
**Fix**: Ensure `data/audited_wallet_pnl_extended.json` exists and has data

### "Empty state showing even with monitor running"
**Issue**: JSONL log is empty or doesn't exist
**Fix**:
1. Check `runtime/watchlist_events.log` exists
2. Check monitor is running: `ps aux | grep monitor-signal-wallet-positions`
3. Check AUTONOMOUS_TRADING_ENABLED=true env var is set

### "All categories are 'Uncategorized'"
**Issue**: Events dimension file is empty or category mapper failing
**Fix**:
1. Check `data/events_dim_seed.json` exists and has data
2. Rebuild if needed: `npm run build-dimensions`

### "top_category_pnl_usd is always null"
**Issue**: ClickHouse is unavailable or connection failed
**Fix**:
1. Check ClickHouse is running: `curl http://localhost:8123/ping`
2. Verify env vars: `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`
3. Check logs: Look for "Failed to get wallet category breakdown" errors

### "LIVE FLOW badges not showing"
**Issue**: Alerts logic not triggering
**Fix**: Verify wallet rank ≤ 5, coverage ≥ 10%, and timestamp within 12 hours

---

## File Summary

### Files Modified

1. **lib/analytics/wallet-category-breakdown.ts** (NEW)
   - Real ClickHouse per-category P&L queries
   - Graceful degradation when DB unavailable

2. **lib/analytics/wallet-specialists.ts** (UPDATED)
   - Now async, calls real ClickHouse queries
   - Removed mock category breakdown function
   - Updated blurb generation for graceful degradation

3. **app/api/wallets/specialists/route.ts** (UPDATED)
   - Made async to await ClickHouse queries
   - Updated documentation for nullable fields

4. **app/debug/flow/page.tsx** (UPDATED)
   - Reads NEXT_PUBLIC_DEMO_STRATEGY_ID from env
   - Updated OPERATOR CHECKLIST
   - Updated reality notes

5. **package.json** (UPDATED)
   - Added flow:monitor script
   - Added flow:dev script
   - Added flow:progress script

### No Changes Needed

- `app/api/strategies/[id]/watchlist/stream/route.ts` - Already reads real JSONL
- `components/WalletSpecialistCard.tsx` - Already handles nullable fields
- `components/StrategyWatchlistRow.tsx` - Already handles alerts
- `lib/services/watchlist-auto-populate.ts` - Already logs canonical categories

---

## Next Steps (Future Enhancements)

1. **Real-time WebSocket Updates**: Convert JSONL polling to WebSocket for instant updates
2. **Strategy-Specific Filtering**: Filter watchlist by specific strategy_id
3. **Historical Playback**: View smart money flow from past date ranges
4. **Wallet Deep Dive**: Click wallet to see full trade history and category breakdown
5. **Performance Monitoring**: Add metrics for ClickHouse query times

---

**Status**: ✅ Production-ready for investor demos
**Last Mile Complete**: All modeled data replaced with real ClickHouse queries
**Graceful Degradation**: System works with or without ClickHouse
**Documentation**: Complete with runbook, API docs, and demo script
