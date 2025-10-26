# Autonomous Execution Database Migrations

This directory contains migrations for the **Autonomous Strategy Execution System** feature.

## Migration Files

The following migrations were created on 2025-10-26:

1. `20251026000000_alter_workflow_sessions_autonomous.sql` - Add autonomous execution columns to workflow_sessions
2. `20251026000001_create_strategy_watchlists.sql` - Create strategy watchlists table
3. `20251026000002_create_notification_settings.sql` - Create notification settings table
4. `20251026000003_create_strategy_execution_logs.sql` - Create execution logs table
5. `20251026000004_enhance_notifications_table.sql` - Add strategy notification support

## Quick Start

### Apply Migrations (Development)

```bash
# Option 1: Reset entire database (WARNING: This deletes all data)
supabase db reset

# Option 2: Apply new migrations only
supabase migration up
```

### Verify Migrations

```bash
# Connect to local Supabase database
psql "postgresql://postgres:postgres@localhost:54322/postgres"

# Check tables exist
\dt

# Check indexes
\di

# Check RLS policies
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN (
  'strategy_watchlists',
  'notification_settings',
  'strategy_execution_logs'
);

# Exit
\q
```

### Rollback Migrations (If Needed)

Each migration file contains rollback SQL in comments at the bottom. To rollback:

1. Copy the rollback SQL from the migration file
2. Run it in your database client or via Supabase dashboard

**Example** (rollback workflow_sessions changes):
```sql
-- Drop the index
DROP INDEX IF EXISTS idx_workflow_sessions_auto_run;

-- Remove new columns
ALTER TABLE workflow_sessions
  DROP COLUMN IF EXISTS execution_interval_minutes,
  DROP COLUMN IF EXISTS auto_run,
  DROP COLUMN IF EXISTS last_executed_at,
  DROP COLUMN IF EXISTS next_execution_at,
  DROP COLUMN IF EXISTS success_count,
  DROP COLUMN IF EXISTS error_count,
  DROP COLUMN IF EXISTS average_execution_time_ms;

-- Restore original status constraint
ALTER TABLE workflow_sessions
  DROP CONSTRAINT IF EXISTS workflow_sessions_status_check;

ALTER TABLE workflow_sessions
  ADD CONSTRAINT workflow_sessions_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'archived'));
```

## Schema Overview

### Tables Created/Modified

1. **workflow_sessions** (modified)
   - Added 7 columns for autonomous execution
   - Updated status constraint
   - Added partial index for cron job optimization

2. **strategy_watchlists** (new)
   - Stores markets added to strategy watchlists
   - Prevents duplicates via UNIQUE constraint
   - RLS enabled

3. **notification_settings** (new)
   - User preferences for notification delivery
   - Quiet hours support
   - RLS enabled

4. **strategy_execution_logs** (new)
   - Node-level execution logs for debugging
   - Performance analytics via helper functions
   - RLS enabled

5. **notifications** (modified)
   - Added workflow_id column
   - Added 7 new notification types
   - Added index on workflow_id

### Helper Functions Created

- `should_send_notification(user_id, notification_type)` - Check if notification should be sent
- `create_strategy_notification(...)` - Create strategy notification with preference checking
- `get_execution_log_summary(execution_id)` - Get execution statistics
- `get_node_performance_stats(workflow_id, node_id)` - Get node performance stats

## Testing

Database schema tests are located at:
`/Users/scotty/Projects/Cascadian-app/lib/database/__tests__/autonomous-execution-schema.test.ts`

**Note**: Tests require test framework setup (Jest or Vitest).

## Migration Dependencies

These migrations depend on:
- `20251023000000_create_workflow_sessions.sql` - workflow_sessions table
- `20251023200000_create_notifications_table.sql` - notifications table

Ensure these migrations are applied before applying the autonomous execution migrations.

## Production Deployment

### Pre-Deployment Checklist

- [ ] All migrations tested in development environment
- [ ] Database tests pass
- [ ] RLS policies verified
- [ ] Index performance verified with EXPLAIN ANALYZE
- [ ] Rollback plan prepared
- [ ] Database backup taken

### Deployment Steps

1. **Backup Production Database**
   ```bash
   # Via Supabase dashboard: Project Settings > Database > Backups
   # Or via CLI
   supabase db dump > backup-$(date +%Y%m%d-%H%M%S).sql
   ```

2. **Apply Migrations**
   ```bash
   # Push migrations to production
   supabase db push
   ```

3. **Verify Migrations**
   - Check all tables exist
   - Check RLS is enabled
   - Check indexes exist
   - Test a few queries

4. **Monitor Performance**
   - Watch database metrics in Supabase dashboard
   - Monitor query performance
   - Check for errors in logs

### Rollback Plan

If issues arise:

1. **Stop Cron Job** (prevent new data from being created)
2. **Run Rollback SQL** (from migration file comments)
3. **Restore from Backup** (if needed)
4. **Investigate Issue**

## Common Issues

### Issue: Migration fails with "relation already exists"

**Solution**: Migration files use `IF NOT EXISTS` clauses, so this shouldn't happen. If it does, check if migrations were partially applied.

### Issue: RLS policies prevent data access

**Solution**: Verify user is authenticated and owns the data. Check `auth.uid()` returns correct user ID.

### Issue: Indexes not being used

**Solution**: Run `EXPLAIN ANALYZE` on queries. Ensure indexes match query patterns. Consider updating index strategy.

## Support

For questions or issues:
- Review migration file comments for details
- Check `/Users/scotty/Projects/Cascadian-app/.agent-os/specs/spec-20251026-autonomous-strategy-execution/TASK-GROUP-1-SUMMARY.md`
- Review Supabase documentation: https://supabase.com/docs

---

**Last Updated**: 2025-10-26
**Feature**: Autonomous Strategy Execution System
**Task Group**: 1 - Database Schema & Migrations
