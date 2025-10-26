# Migration: Add Event Information to Markets Table

**Migration ID**: `20251024200000_add_event_info_to_markets`
**Date**: 2025-10-24
**Status**: ✅ Applied
**Author**: database-architect agent

## Purpose

Add event relationship columns to the `markets` table to enable linking markets back to their parent Polymarket events. This allows for:

- Event-level aggregation and filtering in the UI
- Navigation from markets to parent events
- Better data organization and hierarchy
- Event-centric views and analytics

## Schema Changes

### New Columns Added

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `event_id` | TEXT | YES | Polymarket event ID for API lookups |
| `event_slug` | TEXT | YES | Event slug for URL routing (e.g., "trump-2025-meetings") |
| `event_title` | TEXT | YES | Event title for display purposes |

### Indexes Created

| Index Name | Column(s) | Type | Purpose |
|------------|-----------|------|---------|
| `idx_markets_event_id` | event_id | B-tree | Fast lookups of markets by event ID |
| `idx_markets_event_slug` | event_slug | B-tree | Fast lookups of markets by event slug |

## Design Decisions

### Why TEXT vs UUID?
- Polymarket uses string-based event IDs, not UUIDs
- Using TEXT maintains consistency with their API
- Allows for flexible ID formats if Polymarket changes their schema

### Why Nullable?
- Existing markets don't have event data yet
- Will be populated during next sync operation
- Some markets may not be part of events (standalone markets)

### Why Three Columns?
- `event_id`: For programmatic API lookups and joins
- `event_slug`: For URL generation and SEO-friendly routes
- `event_title`: For display without additional API calls (denormalized for performance)

## Data Population Strategy

Data will be populated in phases:

1. **Migration Applied**: Columns exist but are NULL
2. **Sync Enhancement**: Update sync logic to fetch event data from Polymarket API
3. **Backfill**: Historical markets updated during normal sync operations
4. **Ongoing**: New markets get event data on first sync

## Query Examples

### Find all markets for a specific event
```sql
SELECT market_id, title, current_price, volume_24h
FROM markets
WHERE event_id = 'abc123'
  AND active = true
ORDER BY volume_24h DESC;
```

### Get event aggregates
```sql
SELECT
  event_slug,
  event_title,
  COUNT(*) as market_count,
  SUM(volume_24h) as total_volume_24h,
  AVG(current_price) as avg_price
FROM markets
WHERE event_id IS NOT NULL
  AND active = true
GROUP BY event_slug, event_title
ORDER BY total_volume_24h DESC;
```

### Find markets without event data (for monitoring)
```sql
SELECT COUNT(*)
FROM markets
WHERE event_id IS NULL
  AND active = true;
```

## Performance Impact

### Index Statistics
- B-tree indexes on TEXT columns: ~16-32 bytes per entry (typical event ID length)
- Total index size estimate: ~200KB for 2000 markets
- Query performance: O(log n) lookups on indexed columns

### Storage Impact
- 3 new TEXT columns per row
- Average storage per market: ~100-150 bytes (assuming typical event data)
- Total storage increase: ~300KB for 2000 markets

**Verdict**: Negligible performance and storage impact

## Testing & Verification

### Pre-Migration State
- ✅ 2024 markets in database
- ✅ No event columns existed
- ✅ All queries worked without event data

### Post-Migration State
- ✅ 2024 markets still present
- ✅ Event columns created with correct data types
- ✅ Indexes created successfully
- ✅ Queries work with NULL event data
- ✅ Can filter and query by event columns

### Verification Script
Run `node scripts/check-event-columns.mjs` to verify:
- Column existence
- Data type correctness
- Query functionality
- Current population status

## Rollback Plan

If rollback is needed:

```sql
-- Remove indexes
DROP INDEX IF EXISTS idx_markets_event_id;
DROP INDEX IF EXISTS idx_markets_event_slug;

-- Remove columns
ALTER TABLE markets
DROP COLUMN IF EXISTS event_id,
DROP COLUMN IF EXISTS event_slug,
DROP COLUMN IF EXISTS event_title;
```

**Note**: This is a non-destructive additive migration. Rollback is safe as no existing data is modified.

## Next Steps

1. **Update Sync Logic** (`lib/polymarket/sync.ts`):
   - Fetch event data from Polymarket API
   - Extract event_id, event_slug, event_title from API response
   - Include in UPSERT operations

2. **Update Types** (`lib/polymarket/types.ts`):
   - Add optional event fields to `Market` interface
   - Update API response types

3. **Update UI Components**:
   - Add event breadcrumbs to market detail pages
   - Create event grouping in market screener
   - Add event filter to screener interface

4. **Backfill Historical Data**:
   - Run sync to populate event data for existing markets
   - Monitor population rate via verification script

## Related Files

- Migration: `/supabase/migrations/20251024200000_add_event_info_to_markets.sql`
- Verification: `/scripts/check-event-columns.mjs`
- Schema Docs: `/supabase/migrations/20251022140000_create_polymarket_tables_v2.sql`
- Sync Logic: `/lib/polymarket/sync.ts`

## References

- **Polymarket API**: Events are exposed via their API as parent containers for markets
- **Database Design**: Denormalized event_title for read performance (avoiding joins)
- **Indexing Strategy**: B-tree indexes for exact match and range queries

---

**Migration Status**: ✅ Successfully applied to production database
**Last Verified**: 2025-10-24
**Next Review**: After sync logic implementation
