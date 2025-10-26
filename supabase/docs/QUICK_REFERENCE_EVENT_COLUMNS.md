# Quick Reference: Event Columns

## At a Glance

**Status**: ✅ Active
**Migration**: `20251024200000_add_event_info_to_markets`
**Table**: `markets`
**Columns Added**: 3 (event_id, event_slug, event_title)
**Indexes Added**: 2 (event_id, event_slug)

## Quick Commands

### Check Current State
```bash
# Run verification script
node scripts/check-event-columns.mjs
```

### Query Examples

```sql
-- Find markets by event slug
SELECT * FROM markets WHERE event_slug = 'trump-2025-meetings';

-- Get all events with market counts
SELECT
  event_slug,
  event_title,
  COUNT(*) as market_count
FROM markets
WHERE event_id IS NOT NULL
GROUP BY event_slug, event_title;

-- Check data population status
SELECT
  COUNT(*) as total_markets,
  COUNT(event_id) as markets_with_events,
  ROUND(COUNT(event_id)::NUMERIC / COUNT(*)::NUMERIC * 100, 2) as percent_populated
FROM markets;
```

## TypeScript Integration

```typescript
// Add to Market interface
interface Market {
  market_id: string;
  title: string;
  // ... other fields ...

  // Event fields
  event_id?: string | null;
  event_slug?: string | null;
  event_title?: string | null;
}

// Query markets by event
const { data: markets } = await supabase
  .from('markets')
  .select('*')
  .eq('event_slug', eventSlug)
  .eq('active', true)
  .order('volume_24h', { ascending: false });

// Build event breadcrumb
const breadcrumb = market.event_title
  ? `Events > ${market.event_title} > ${market.title}`
  : market.title;
```

## Files Location

```
/supabase/migrations/
  └─ 20251024200000_add_event_info_to_markets.sql

/supabase/docs/
  ├─ migrations/20251024200000_add_event_info_to_markets.md
  └─ schema-diagrams/markets-table-with-events.md

/scripts/
  └─ check-event-columns.mjs

/
  └─ EVENT_COLUMNS_MIGRATION_COMPLETE.md
```

## Next Actions Required

1. **Update sync logic** in `/lib/polymarket/sync.ts`
2. **Add TypeScript types** in `/lib/polymarket/types.ts`
3. **Update UI components** to use event data
4. **Run sync** to populate event data

## Support

- View full docs: `/supabase/docs/migrations/20251024200000_add_event_info_to_markets.md`
- View schema diagram: `/supabase/docs/schema-diagrams/markets-table-with-events.md`
- Run verification: `node scripts/check-event-columns.mjs`
