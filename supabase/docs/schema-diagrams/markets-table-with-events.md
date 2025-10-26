# Markets Table Schema - With Event Relationships

## Updated Schema Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        markets TABLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PRIMARY KEY                                                     │
│  ├─ market_id                TEXT (PK)                          │
│                                                                  │
│  MARKET IDENTITY                                                 │
│  ├─ title                     TEXT                              │
│  ├─ description               TEXT                              │
│  ├─ slug                      TEXT                              │
│  ├─ condition_id              TEXT                              │
│                                                                  │
│  ⭐ EVENT RELATIONSHIPS (NEW)                                    │
│  ├─ event_id                  TEXT ◄─── Polymarket Event ID    │
│  ├─ event_slug                TEXT ◄─── For URL routing        │
│  └─ event_title               TEXT ◄─── For display            │
│                                                                  │
│  METADATA                                                        │
│  ├─ category                  TEXT                              │
│  ├─ tags                      TEXT[]                            │
│  └─ image_url                 TEXT                              │
│                                                                  │
│  OUTCOMES                                                        │
│  └─ outcomes                  TEXT[] (default: ['Yes', 'No'])   │
│                                                                  │
│  PRICING                                                         │
│  ├─ current_price             NUMERIC(18,8)                     │
│  └─ outcome_prices            NUMERIC(18,8)[]                   │
│                                                                  │
│  VOLUME & LIQUIDITY                                              │
│  ├─ volume_24h                NUMERIC(18,2)                     │
│  ├─ volume_total              NUMERIC(18,2)                     │
│  └─ liquidity                 NUMERIC(18,2)                     │
│                                                                  │
│  STATUS                                                          │
│  ├─ active                    BOOLEAN                           │
│  ├─ closed                    BOOLEAN                           │
│  └─ end_date                  TIMESTAMPTZ                       │
│                                                                  │
│  SIGNALS (Phase 2)                                               │
│  ├─ momentum_score            NUMERIC(5,2)                      │
│  ├─ sii_score                 NUMERIC(5,2)                      │
│  ├─ smart_money_delta         NUMERIC(5,4)                      │
│  └─ last_trade_timestamp      TIMESTAMPTZ                       │
│                                                                  │
│  AUDIT                                                           │
│  ├─ raw_polymarket_data       JSONB                             │
│  ├─ created_at                TIMESTAMPTZ                       │
│  └─ updated_at                TIMESTAMPTZ                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Indexes on `markets` Table

```
EXISTING INDEXES (15 total)
├─ idx_markets_active              ON active WHERE active = TRUE
├─ idx_markets_category            ON category WHERE active = TRUE
├─ idx_markets_volume_24h          ON volume_24h DESC WHERE active = TRUE
├─ idx_markets_end_date            ON end_date ASC WHERE active = TRUE AND closed = FALSE
├─ idx_markets_title_trgm          USING gin(title gin_trgm_ops)
├─ idx_markets_category_volume     ON (category, volume_24h DESC) WHERE active = TRUE
├─ idx_markets_raw_data_gin        USING gin(raw_polymarket_data)
├─ idx_markets_momentum_score      ON momentum_score DESC WHERE active = TRUE AND momentum_score IS NOT NULL
└─ idx_markets_sii_score           ON sii_score DESC WHERE active = TRUE AND sii_score IS NOT NULL

⭐ NEW EVENT INDEXES (2 added)
├─ idx_markets_event_id            ON event_id
└─ idx_markets_event_slug          ON event_slug
```

## Event Relationship Flow

```
┌──────────────────────┐
│  Polymarket API      │
│                      │
│  Event Object:       │
│  ├─ id: "evt_123"   │
│  ├─ slug: "trump"   │
│  └─ title: "Trump"  │
│                      │
│  Markets: [          │
│    {                 │
│      id: "mkt_456"  │
│      event_id: ...  │◄──────┐
│      ...             │       │
│    }                 │       │
│  ]                   │       │
└──────────────────────┘       │
                               │
         Sync                  │
           │                   │
           ▼                   │
┌──────────────────────┐       │
│  markets Table       │       │
│                      │       │
│  Row:                │       │
│  ├─ market_id        │       │
│  ├─ title            │       │
│  ├─ event_id ────────┼───────┘ Links to parent event
│  ├─ event_slug       │         For URL: /events/{slug}
│  └─ event_title      │         For display without API call
│                      │
└──────────────────────┘
```

## Query Patterns Enabled

### 1. Find Markets by Event

```sql
-- Get all markets for "Trump 2025 Diplomatic Meetings"
SELECT market_id, title, current_price, volume_24h
FROM markets
WHERE event_slug = 'trump-2025-meetings'
  AND active = true
ORDER BY volume_24h DESC;

-- Uses: idx_markets_event_slug
-- Performance: O(log n) index lookup
```

### 2. Event Aggregation

```sql
-- Get event-level statistics
SELECT
  event_slug,
  event_title,
  COUNT(*) as total_markets,
  COUNT(*) FILTER (WHERE active = true) as active_markets,
  SUM(volume_24h) as total_volume_24h,
  SUM(liquidity) as total_liquidity,
  AVG(current_price) as avg_price
FROM markets
WHERE event_id IS NOT NULL
GROUP BY event_slug, event_title
ORDER BY total_volume_24h DESC;
```

### 3. Event + Category Filtering

```sql
-- Politics events with high volume
SELECT DISTINCT
  event_slug,
  event_title,
  SUM(volume_24h) OVER (PARTITION BY event_slug) as event_volume
FROM markets
WHERE category = 'Politics'
  AND event_id IS NOT NULL
  AND active = true
ORDER BY event_volume DESC
LIMIT 10;
```

### 4. Event Breadcrumb Navigation

```sql
-- Get event context for market detail page
SELECT
  market_id,
  title as market_title,
  event_id,
  event_slug,
  event_title
FROM markets
WHERE market_id = 'mkt_123';

-- Returns:
-- market_id: mkt_123
-- market_title: "Will Trump meet Xi Jinping?"
-- event_slug: "trump-2025-meetings"
-- event_title: "Trump's 2025 Diplomatic Meetings"
--
-- UI Breadcrumb:
-- Home > Events > Trump's 2025 Diplomatic Meetings > Will Trump meet Xi Jinping?
```

## Data Flow Timeline

```
PHASE 1: Migration Applied ✅ (Current State)
├─ Columns created with NULL values
├─ Indexes created
└─ 2,024 markets ready for event data

PHASE 2: Sync Logic Updated (Next)
├─ Fetch event data from Polymarket API
├─ Extract event_id, event_slug, event_title
└─ UPSERT markets with event data

PHASE 3: Data Populated (After Sync)
├─ Historical markets backfilled
├─ New markets get event data on creation
└─ Events queryable and filterable

PHASE 4: UI Integration (After Data Populated)
├─ Event breadcrumbs on market pages
├─ Event grouping in screener
├─ Event detail pages with market lists
└─ Event-based filtering and analytics
```

## Column Comments

```sql
COMMENT ON COLUMN markets.event_id IS
  'Polymarket event ID that this market belongs to';

COMMENT ON COLUMN markets.event_slug IS
  'Polymarket event slug for URL routing';

COMMENT ON COLUMN markets.event_title IS
  'Parent event title for display purposes';
```

## Design Rationale

### Why Denormalize event_title?

**Option A: Separate `events` Table (Normalized)**
```sql
-- events table
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  slug TEXT,
  title TEXT
);

-- markets table
ALTER TABLE markets ADD COLUMN event_id TEXT REFERENCES events(event_id);

-- Query requires JOIN
SELECT m.*, e.title as event_title
FROM markets m
LEFT JOIN events e ON m.event_id = e.event_id;
```
- Pros: Single source of truth for event data
- Cons: Requires JOIN on every query, more complex

**Option B: Denormalized (Chosen)**
```sql
-- markets table contains event data
ALTER TABLE markets
ADD COLUMN event_id TEXT,
ADD COLUMN event_slug TEXT,
ADD COLUMN event_title TEXT;

-- Query is simple
SELECT market_id, title, event_title
FROM markets
WHERE active = true;
```
- Pros: No JOINs, faster queries, simpler code
- Cons: Event title duplicated across markets
- **Decision**: Performance wins for read-heavy workload

### Why TEXT for event_id?

- Polymarket uses string-based IDs (not UUIDs)
- Flexibility for future ID format changes
- Consistent with Polymarket API response structure

### Why Nullable?

- Existing markets don't have event data yet
- Will be populated incrementally during sync
- Some markets may be standalone (not part of events)
- Nullable allows gradual migration without breaking changes

## Migration Stats

```
Database: PostgreSQL 15 (Supabase)
Table: markets
Rows: 2,024 markets

BEFORE Migration:
- Columns: 27
- Indexes: 15
- Size: ~2.1 MB (estimated)

AFTER Migration:
- Columns: 30 (+3 event columns)
- Indexes: 17 (+2 event indexes)
- Size: ~2.4 MB (+300 KB)

Impact:
- Storage: +14% (negligible)
- Query Performance: No degradation
- New Capabilities: Event-based queries enabled
```

## References

- **Migration File**: `/supabase/migrations/20251024200000_add_event_info_to_markets.sql`
- **Full Documentation**: `/supabase/docs/migrations/20251024200000_add_event_info_to_markets.md`
- **Original Schema**: `/supabase/migrations/20251022140000_create_polymarket_tables_v2.sql`

---

**Status**: ✅ Migration Complete | **Date**: 2025-10-24 | **Version**: v1.1
