# Critical Database Fixes Deployment Guide

## Status: MANUAL EXECUTION REQUIRED

The Supabase database is currently experiencing connection pool exhaustion (522 timeout errors). Automated deployment is not possible at this time. This guide provides the SQL statements that need to be executed manually.

## Problem Summary

The database was saturated by cron jobs performing full table scans due to missing indexes. This caused:
- 522 timeout errors on all database connections
- Connection pool exhaustion
- Application downtime

Additionally, default strategies were incorrectly archived by a previous migration.

## Solution

Two critical migrations need to be applied:

### Migration 1: Unarchive Default Strategies
- **File**: `supabase/migrations/20251029000002_unarchive_default_strategies.sql`
- **Purpose**: Restore predefined strategies that were incorrectly archived
- **Impact**: Low - simple UPDATE statement

### Migration 2: Add Performance Indexes
- **File**: `supabase/migrations/20251029000003_add_performance_indexes.sql`
- **Purpose**: Create indexes to prevent full table scans by cron jobs
- **Impact**: High - will dramatically reduce database load
- **Indexes Created**:
  - `idx_strategy_definitions_active_scheduled` - For cron job queries
  - `idx_strategy_definitions_mode_active` - For general strategy filtering
  - `idx_strategy_definitions_archived_predefined` - For strategy library queries
  - `idx_notifications_user_read` - For notification queries

## Manual Execution Steps

### Step 1: Access Supabase SQL Editor

Open the SQL Editor in your Supabase Dashboard:

https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new

### Step 2: Execute Migration 1 - Unarchive Strategies

Copy and paste the following SQL into the editor and run it:

```sql
-- Unarchive Default Strategies
--
-- Migration 20251027000004 archived all predefined strategies to make room for "new, better default strategies",
-- but those new strategies were never added. This migration unarchives the predefined strategies
-- so they show up in the library again.

-- Unarchive all predefined strategies
UPDATE strategy_definitions
SET is_archived = FALSE
WHERE is_predefined = TRUE
  AND is_archived = TRUE;

-- Verify the results
-- You should see the count of unarchived strategies
SELECT
  COUNT(*) as unarchived_count,
  STRING_AGG(strategy_name, ', ') as strategy_names
FROM strategy_definitions
WHERE is_predefined = TRUE
  AND is_archived = FALSE;
```

**Expected Result**: You should see a count of unarchived strategies and their names.

### Step 3: Execute Migration 2 - Add Performance Indexes

Copy and paste the following SQL into the editor and run it:

```sql
-- Performance Indexes for Cron Job Queries
--
-- These indexes optimize the queries that were hammering the database from cron jobs.
-- Without these, Postgres does full table scans on every cron execution.

-- Index for strategy executor cron job
-- Query: SELECT * FROM strategy_definitions WHERE execution_mode='SCHEDULED' AND is_active=true
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_active_scheduled
ON public.strategy_definitions (is_active, execution_mode)
WHERE is_active = true AND execution_mode = 'SCHEDULED';

-- Index for general strategy filtering
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_mode_active
ON public.strategy_definitions (execution_mode, is_active);

-- Index for strategy archiving queries
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_archived_predefined
ON public.strategy_definitions (is_archived, is_predefined);

-- Index for notification queries (if they filter by user_id and is_read)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON public.notifications (user_id, is_read, created_at DESC)
WHERE is_archived = false;

-- Add comments
COMMENT ON INDEX idx_strategy_definitions_active_scheduled IS 'Optimizes strategy executor cron job queries';
COMMENT ON INDEX idx_strategy_definitions_mode_active IS 'General index for strategy filtering';
COMMENT ON INDEX idx_strategy_definitions_archived_predefined IS 'Optimizes strategy library filtering';
COMMENT ON INDEX idx_notifications_user_read IS 'Optimizes notification queries';
```

**Expected Result**: Indexes should be created successfully. This may take a few seconds depending on table size.

### Step 4: Verify Indexes Were Created

Run this query to verify all indexes exist:

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_strategy_definitions_active_scheduled',
    'idx_strategy_definitions_mode_active',
    'idx_strategy_definitions_archived_predefined',
    'idx_notifications_user_read'
  )
ORDER BY indexname;
```

**Expected Result**: You should see all 4 indexes listed.

### Step 5: Verify Strategies Were Unarchived

Run this query to verify strategies are active:

```sql
SELECT
  COUNT(*) FILTER (WHERE is_archived = false) as active_count,
  COUNT(*) FILTER (WHERE is_archived = true) as archived_count,
  STRING_AGG(
    CASE WHEN is_archived = false THEN strategy_name ELSE NULL END,
    ', '
  ) as active_strategies
FROM strategy_definitions
WHERE is_predefined = true;
```

**Expected Result**: You should see predefined strategies in the `active_strategies` column.

## Post-Deployment Verification

After executing the migrations:

1. **Monitor Database Performance**: Check if 522 errors have stopped
2. **Check Cron Jobs**: Verify that the strategy executor cron is running without errors
3. **Verify Strategy Library**: Confirm that predefined strategies are visible in the UI
4. **Monitor Connection Pool**: Watch for connection pool metrics to return to normal

## Automated Script for Future Use

Once the database is accessible again, you can use the automated deployment script:

```bash
npx tsx scripts/deploy-critical-fixes.ts
```

This script will attempt automated deployment and provide verification.

## Technical Details

### Why These Indexes Are Critical

1. **idx_strategy_definitions_active_scheduled**:
   - The cron job runs every minute querying for active scheduled strategies
   - Without this index, it does a full table scan every time
   - With the index, it uses a partial index that only includes active scheduled strategies

2. **idx_strategy_definitions_mode_active**:
   - General purpose index for common filtering patterns
   - Improves strategy list queries significantly

3. **idx_strategy_definitions_archived_predefined**:
   - Optimizes strategy library queries that filter by these fields
   - Used by the strategy dashboard and library views

4. **idx_notifications_user_read**:
   - Optimizes notification queries that filter by user and read status
   - Includes `created_at DESC` for proper sorting

### Index Types

- **Partial Indexes**: `idx_strategy_definitions_active_scheduled` uses a WHERE clause to only index relevant rows
- **Composite Indexes**: All indexes use multiple columns in the order they're most commonly queried

## Rollback Plan

If you need to rollback these changes (not recommended):

```sql
-- Remove indexes
DROP INDEX IF EXISTS idx_strategy_definitions_active_scheduled;
DROP INDEX IF EXISTS idx_strategy_definitions_mode_active;
DROP INDEX IF EXISTS idx_strategy_definitions_archived_predefined;
DROP INDEX IF EXISTS idx_notifications_user_read;

-- Re-archive strategies (only if absolutely necessary)
UPDATE strategy_definitions
SET is_archived = TRUE
WHERE is_predefined = TRUE;
```

## Support

If you encounter issues:

1. Check the Supabase dashboard for database metrics
2. Review the PostgREST logs for connection errors
3. Monitor the connection pool usage
4. Check cron job logs for execution errors

## Files Reference

- Migration files:
  - `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000002_unarchive_default_strategies.sql`
  - `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000003_add_performance_indexes.sql`
- Deployment script: `/Users/scotty/Projects/Cascadian-app/scripts/deploy-critical-fixes.ts`
- This guide: `/Users/scotty/Projects/Cascadian-app/DATABASE_FIXES_DEPLOYMENT.md`

---

**Date Created**: 2025-10-29
**Status**: Awaiting Manual Execution
**Priority**: CRITICAL - Database Performance
