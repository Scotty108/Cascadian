# "View Event" Button Fix - Implementation Guide

**Date**: October 24, 2025
**Status**: ✅ Code Complete - Requires Manual SQL Migration

---

## Problem

The "View Event" button on market detail pages was hardcoded to `"2024-presidential-election"` (an archived event), causing all markets to link to a broken event page.

**Root Cause**: Markets don't include parent event information from the Polymarket API, so we couldn't dynamically link back to events.

---

## Solution

Store event information (`event_id`, `event_slug`, `event_title`) in the `markets` table during sync, then use this data to show the "View Event" button.

---

## What Was Changed

### 1. **Database Schema** (`supabase/migrations/20251024200000_add_event_info_to_markets.sql`)

Added three new columns to `markets` table:
- `event_id` TEXT - Polymarket event ID for API lookups
- `event_slug` TEXT - Event slug for URL routing
- `event_title` TEXT - Event title for display

### 2. **Sync Process** (`lib/polymarket/utils.ts:139`)

Updated `expandEventsToMarkets` function to include event information:

```typescript
export function expandEventsToMarkets(events: PolymarketEvent[]): Array<PolymarketMarket & {
  category: string;
  event_id: string;      // ← NEW
  event_slug: string;    // ← NEW
  event_title: string;   // ← NEW
}> {
  // ...
  for (const event of events) {
    for (const market of event.markets) {
      allMarkets.push({
        ...market,
        category,
        event_id: event.id,       // ← NEW
        event_slug: event.slug,   // ← NEW
        event_title: event.title, // ← NEW
      });
    }
  }
}
```

### 3. **Database Insert** (`lib/polymarket/sync.ts:107-110`)

Updated sync to store event fields:

```typescript
const rows = batch.map(market => ({
  // ... existing fields
  event_id: (market as any).event_id || null,
  event_slug: (market as any).event_slug || null,
  event_title: (market as any).event_title || null,
}));
```

### 4. **UI Component** (`components/market-detail-interface/index.tsx:253-254`)

Updated to use real event data:

**Before**:
```typescript
const eventSlug = "2024-presidential-election"; // ❌ Hardcoded!
```

**After**:
```typescript
const eventSlug = realMarket?.event_slug || null;
const eventTitle = realMarket?.event_title || null;
```

Button now only shows when event data exists:
```typescript
{eventSlug && (
  <Button variant="outline" asChild>
    <Link href={`/events/${eventSlug}`}>
      <Calendar className="h-4 w-4" />
      View Event
    </Link>
  </Button>
)}
```

---

## ⚠️ Manual Migration Required

**You need to run this SQL in your Supabase dashboard:**

1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql
2. Paste and run this SQL:

```sql
-- Add event information columns to markets table
ALTER TABLE markets
ADD COLUMN IF NOT EXISTS event_id TEXT,
ADD COLUMN IF NOT EXISTS event_slug TEXT,
ADD COLUMN IF NOT EXISTS event_title TEXT;

-- Create indexes for faster event lookups
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);
CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug);

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'markets'
AND column_name LIKE '%event%';
```

**Expected Output**:
```
column_name   | data_type
--------------|-----------
event_id      | text
event_slug    | text
event_title   | text
```

---

## Post-Migration Steps

### 1. Trigger a Sync

After running the SQL migration, trigger a sync to populate the new columns:

```bash
# Option A: Wait for auto-sync (every 5 minutes)
# Option B: Restart the dev server to force a sync

# Option C: Make a request to trigger sync
curl http://localhost:3001/api/polymarket/markets?limit=1
```

The sync will:
- Fetch all active markets from Polymarket's events API
- Extract `event_id`, `event_slug`, `event_title` for each market
- Store this data in the new columns

### 2. Verify Data

Check that event data was populated:

```bash
curl "http://localhost:3001/api/polymarket/markets/524148" | jq '.data | {
  market_id,
  title,
  event_id: .raw_data.event_id,
  event_slug: .raw_data.event_slug,
  event_title: .raw_data.event_title
}'
```

**Expected**: Should show event information, not null values.

### 3. Test "View Event" Button

1. Open any market detail page: http://localhost:3001/analysis/market/524148
2. Look for "View Event" button in the header (next to market title)
3. Click it - should navigate to the parent event page
4. Event page should show all markets in that event group

---

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Sync Process (Every 5 min or on-demand)                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Fetch events from Polymarket API                            │
│ GET https://gamma-api.polymarket.com/events                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ expandEventsToMarkets() - lib/polymarket/utils.ts          │
│                                                              │
│ For each event:                                             │
│   event = {                                                 │
│     id: "16084",                                            │
│     slug: "fed-rate-hike-in-2025",                         │
│     title: "Fed rate hike in 2025?",                       │
│     markets: [...]                                          │
│   }                                                          │
│                                                              │
│   For each market in event.markets:                         │
│     market.event_id = event.id        ← Store parent ID    │
│     market.event_slug = event.slug    ← Store parent slug  │
│     market.event_title = event.title  ← Store parent title │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Save to Database - lib/polymarket/sync.ts                   │
│                                                              │
│ INSERT INTO markets (                                        │
│   market_id,                                                 │
│   title,                                                     │
│   event_id,      ← NEW COLUMN                               │
│   event_slug,    ← NEW COLUMN                               │
│   event_title,   ← NEW COLUMN                               │
│   ...                                                        │
│ )                                                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. User Views Market Detail Page                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Fetch market from database                                   │
│ GET /api/polymarket/markets/524148                          │
│                                                              │
│ Returns:                                                     │
│ {                                                            │
│   market_id: "524148",                                      │
│   title: "Will Trump meet with Xi Jinping in 2025?",       │
│   event_id: "16087",                                        │
│   event_slug: "will-trump-meet-with-world-leaders-in-2025",│
│   event_title: "Trump's 2025 Diplomatic Meetings",         │
│   ...                                                        │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ UI Component Reads event_slug                                │
│ components/market-detail-interface/index.tsx                 │
│                                                              │
│ const eventSlug = realMarket?.event_slug                    │
│ // eventSlug = "will-trump-meet-with-world-leaders-in-2025" │
│                                                              │
│ {eventSlug && (                                             │
│   <Link href={`/events/${eventSlug}`}>                     │
│     View Event                                              │
│   </Link>                                                    │
│ )}                                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. User Clicks "View Event"                                  │
│ Navigates to: /events/will-trump-meet-with-world-leaders... │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Event Detail Page Shows ALL Markets in Event                 │
│                                                              │
│ Event: "Trump's 2025 Diplomatic Meetings"                   │
│ Markets:                                                     │
│   - Will Trump meet with Xi Jinping in 2025?               │
│   - Will Trump meet with Putin in 2025?                    │
│   - Will Trump meet with Zelenskyy in 2025?                │
│   - Will Trump meet with Modi in 2025?                     │
│   ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Example: Trump/Xi Jinping Market

**Before Fix**:
```
Market: "Will Trump meet with Xi Jinping in 2025?"
  │
  │ Click "View Event"
  ▼
Event: "2024-presidential-election" ← ❌ WRONG! (hardcoded, archived)
  │
  ▼
Error: "Event not found or no longer available"
```

**After Fix**:
```
Market: "Will Trump meet with Xi Jinping in 2025?"
  ├─ event_id: "16087"
  ├─ event_slug: "will-trump-meet-with-world-leaders-in-2025"
  └─ event_title: "Trump's 2025 Diplomatic Meetings"
  │
  │ Click "View Event"
  ▼
Event: "Trump's 2025 Diplomatic Meetings" ← ✅ CORRECT!
  │
  ▼
Shows ALL markets in this event:
  - Xi Jinping meeting
  - Putin meeting
  - Zelenskyy meeting
  - Modi meeting
  - etc.
```

---

## Benefits

1. **Dynamic Links**: Each market links to its actual parent event
2. **No Hardcoding**: Event information comes from Polymarket's data
3. **Better UX**: Users can explore related markets within the same event
4. **Future-Proof**: Works for all new events automatically

---

## Edge Cases Handled

### 1. Markets Without Parent Events

Some markets may not be part of a multi-market event. In these cases:
- `event_id`, `event_slug`, `event_title` will be `null`
- "View Event" button will be **hidden** (not broken)

### 2. Archived Events

If a user somehow lands on a market from an old/archived event:
- The event slug will still be valid from the database
- Clicking "View Event" may show "Event Not Available" (expected)
- This is better than showing a hardcoded wrong event

### 3. Sync Failures

If sync fails and event data isn't populated:
- "View Event" button won't appear (graceful degradation)
- Users can still use the market detail page normally
- Next successful sync will populate the missing data

---

## Files Changed

| File | Lines | What Changed |
|------|-------|--------------|
| `lib/polymarket/utils.ts` | 139-160 | Added `event_id`, `event_slug`, `event_title` to `expandEventsToMarkets()` |
| `lib/polymarket/sync.ts` | 107-110 | Store event fields in database during UPSERT |
| `components/market-detail-interface/index.tsx` | 253-254, 760-767 | Read event data from market, conditionally show "View Event" button |
| `supabase/migrations/20251024200000_add_event_info_to_markets.sql` | - | SQL migration to add columns |

---

## Testing Checklist

After running the migration and sync:

- [ ] SQL migration executed successfully
- [ ] New columns appear in `markets` table schema
- [ ] Sync completes without errors
- [ ] Event data populated in database (`event_id`, `event_slug` not null for most markets)
- [ ] "View Event" button appears on market detail pages
- [ ] Clicking button navigates to correct event page
- [ ] Event page shows multiple related markets
- [ ] Markets without events don't show the button (no errors)

---

## Rollback Plan

If something goes wrong, you can revert:

1. **Remove columns** (optional, won't hurt to keep them):
```sql
ALTER TABLE markets
DROP COLUMN IF EXISTS event_id,
DROP COLUMN IF EXISTS event_slug,
DROP COLUMN IF EXISTS event_title;
```

2. **Revert code changes**:
```bash
git revert <commit-hash>
```

3. **Hide "View Event" button**:
```typescript
// In market-detail-interface/index.tsx
const eventSlug = null; // Force hide button
```

---

## Production Deployment

When deploying to production:

1. **Run migration first** (in Supabase dashboard)
2. **Deploy code** (Vercel will build with new logic)
3. **Trigger sync** (will run automatically on first request)
4. **Monitor logs** for any UPSERT errors
5. **Verify** a few market pages show "View Event" button

---

## Future Enhancements

### Option 1: Show Event Title on Market Page

```typescript
// components/market-detail-interface/index.tsx
{eventTitle && (
  <div className="text-sm text-muted-foreground">
    Part of: <Link href={`/events/${eventSlug}`} className="text-[#00E0AA] hover:underline">
      {eventTitle}
    </Link>
  </div>
)}
```

### Option 2: Breadcrumb Navigation

```typescript
<Breadcrumb>
  <BreadcrumbItem href="/events">Events</BreadcrumbItem>
  <BreadcrumbItem href={`/events/${eventSlug}`}>{eventTitle}</BreadcrumbItem>
  <BreadcrumbItem>{market.title}</BreadcrumbItem>
</Breadcrumb>
```

### Option 3: Related Markets Section

Show other markets from the same event directly on the market detail page (without navigating to event page).

---

## Summary

✅ **Code is ready** - All changes are committed
⚠️ **Manual SQL required** - Run the migration in Supabase dashboard
⏳ **Sync needed** - Restart server or wait for auto-sync to populate data

Once you run the SQL migration, the "View Event" button will work correctly for all markets!
