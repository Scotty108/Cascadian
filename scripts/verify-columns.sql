-- Verification queries for event columns migration

-- 1. Check column existence and properties
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'markets'
    AND column_name LIKE '%event%'
ORDER BY column_name;

-- 2. Check indexes on event columns
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'markets'
    AND indexname LIKE '%event%'
ORDER BY indexname;

-- 3. Check column comments
SELECT
    col_description('markets'::regclass, ordinal_position) as column_comment,
    column_name
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'markets'
    AND column_name LIKE '%event%'
ORDER BY column_name;

-- 4. Sample data check
SELECT
    COUNT(*) as total_markets,
    COUNT(event_id) as markets_with_event_id,
    COUNT(event_slug) as markets_with_event_slug,
    COUNT(event_title) as markets_with_event_title
FROM markets;

-- 5. Show first few markets with any event data (if exists)
SELECT
    id,
    title,
    event_id,
    event_slug,
    event_title,
    updated_at
FROM markets
WHERE event_id IS NOT NULL
LIMIT 5;
