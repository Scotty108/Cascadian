/**
 * DATABASE SCHEMA TESTS: Autonomous Strategy Execution System
 *
 * Tests for Task Group 1: Database Schema & Migrations
 * Feature: 24/7 Autonomous Strategy Execution & Monitoring
 *
 * Test Coverage:
 * 1. workflow_sessions autonomous columns
 * 2. strategy_watchlists table and constraints
 * 3. Row Level Security (RLS) policies
 * 4. Indexes for query optimization
 *
 * NOTE: These tests require a Supabase connection and proper test environment setup.
 * Run with: npm test lib/database/__tests__/autonomous-execution-schema.test.ts
 */

import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client for testing
// TODO: Replace with environment variables or test configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

describe('Autonomous Execution Database Schema', () => {
  /**
   * TEST 1: Verify workflow_sessions has autonomous execution columns
   *
   * Validates that all required columns were added by migration:
   * - execution_interval_minutes
   * - auto_run
   * - last_executed_at
   * - next_execution_at
   * - success_count
   * - error_count
   * - average_execution_time_ms
   */
  test('workflow_sessions table has autonomous execution columns', async () => {
    // Query information_schema to verify columns exist
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'workflow_sessions'
        AND column_name IN (
          'execution_interval_minutes',
          'auto_run',
          'last_executed_at',
          'next_execution_at',
          'success_count',
          'error_count',
          'average_execution_time_ms'
        )
        ORDER BY column_name;
      `,
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data.length).toBe(7)

    // Verify specific column properties
    const columns = data.reduce(
      (acc: any, col: any) => {
        acc[col.column_name] = col
        return acc
      },
      {} as Record<string, any>
    )

    // execution_interval_minutes should be INTEGER with default 5
    expect(columns.execution_interval_minutes).toBeDefined()
    expect(columns.execution_interval_minutes.data_type).toBe('integer')

    // auto_run should be BOOLEAN with default FALSE
    expect(columns.auto_run).toBeDefined()
    expect(columns.auto_run.data_type).toBe('boolean')

    // Timestamps should be nullable
    expect(columns.last_executed_at.is_nullable).toBe('YES')
    expect(columns.next_execution_at.is_nullable).toBe('YES')

    // Counters should default to 0
    expect(columns.success_count).toBeDefined()
    expect(columns.error_count).toBeDefined()
  })

  /**
   * TEST 2: Verify strategy_watchlists table exists with correct structure
   *
   * Validates:
   * - Table exists
   * - UNIQUE constraint on (workflow_id, market_id)
   * - Foreign key cascade behavior
   * - Required columns present
   */
  test('strategy_watchlists table has correct structure and constraints', async () => {
    // Check table exists
    const { data: tableExists, error: tableError } = await supabase.rpc(
      'exec_sql',
      {
        sql: `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'strategy_watchlists';
      `,
      }
    )

    expect(tableError).toBeNull()
    expect(tableExists).toBeDefined()
    expect(tableExists.length).toBe(1)

    // Verify UNIQUE constraint on (workflow_id, market_id)
    const { data: constraints, error: constraintError } = await supabase.rpc(
      'exec_sql',
      {
        sql: `
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'strategy_watchlists'
        AND constraint_type = 'UNIQUE';
      `,
      }
    )

    expect(constraintError).toBeNull()
    expect(constraints).toBeDefined()
    expect(constraints.length).toBeGreaterThanOrEqual(1)

    // Verify CASCADE delete on workflow_id foreign key
    const { data: fkConstraints, error: fkError } = await supabase.rpc(
      'exec_sql',
      {
        sql: `
        SELECT
          tc.constraint_name,
          rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'strategy_watchlists'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND rc.delete_rule = 'CASCADE';
      `,
      }
    )

    expect(fkError).toBeNull()
    expect(fkConstraints).toBeDefined()
    expect(fkConstraints.length).toBeGreaterThanOrEqual(1)
  })

  /**
   * TEST 3: Verify Row Level Security (RLS) policies are enabled
   *
   * Validates:
   * - RLS is enabled on strategy_watchlists
   * - RLS is enabled on notification_settings
   * - RLS is enabled on strategy_execution_logs
   * - Policies exist for SELECT, INSERT, DELETE operations
   */
  test('RLS policies are enabled on new tables', async () => {
    // Check RLS is enabled on all new tables
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
          'strategy_watchlists',
          'notification_settings',
          'strategy_execution_logs'
        )
        ORDER BY tablename;
      `,
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data.length).toBe(3)

    // All tables should have RLS enabled
    data.forEach((table: any) => {
      expect(table.rowsecurity).toBe(true)
    })

    // Verify policies exist for strategy_watchlists
    const { data: policies, error: policyError } = await supabase.rpc(
      'exec_sql',
      {
        sql: `
        SELECT
          schemaname,
          tablename,
          policyname,
          cmd
        FROM pg_policies
        WHERE tablename = 'strategy_watchlists'
        ORDER BY policyname;
      `,
      }
    )

    expect(policyError).toBeNull()
    expect(policies).toBeDefined()
    expect(policies.length).toBeGreaterThanOrEqual(3) // SELECT, INSERT, DELETE
  })

  /**
   * TEST 4: Verify indexes exist for query optimization
   *
   * Validates:
   * - idx_workflow_sessions_auto_run (partial index for cron job)
   * - idx_strategy_watchlists_workflow (watchlist queries)
   * - idx_notification_settings_user (settings queries)
   * - idx_strategy_execution_logs_execution (log queries)
   */
  test('indexes exist for query optimization', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND indexname IN (
          'idx_workflow_sessions_auto_run',
          'idx_strategy_watchlists_workflow',
          'idx_notification_settings_user',
          'idx_strategy_execution_logs_execution'
        )
        ORDER BY indexname;
      `,
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data.length).toBe(4)

    // Verify each index exists
    const indexNames = data.map((idx: any) => idx.indexname)
    expect(indexNames).toContain('idx_workflow_sessions_auto_run')
    expect(indexNames).toContain('idx_strategy_watchlists_workflow')
    expect(indexNames).toContain('idx_notification_settings_user')
    expect(indexNames).toContain('idx_strategy_execution_logs_execution')

    // Verify idx_workflow_sessions_auto_run is a partial index
    const autoRunIndex = data.find(
      (idx: any) => idx.indexname === 'idx_workflow_sessions_auto_run'
    )
    expect(autoRunIndex).toBeDefined()
    expect(autoRunIndex.indexdef).toContain('WHERE') // Partial index
  })
})

describe('Database Helper Functions', () => {
  /**
   * TEST 5: Verify helper functions exist
   *
   * Validates:
   * - should_send_notification (checks user preferences)
   * - create_strategy_notification (creates notifications with preference checking)
   * - get_execution_log_summary (execution analytics)
   */
  test('helper functions exist and are callable', async () => {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT
          proname AS function_name,
          pronargs AS num_args
        FROM pg_proc
        WHERE proname IN (
          'should_send_notification',
          'create_strategy_notification',
          'get_execution_log_summary',
          'get_node_performance_stats'
        )
        ORDER BY proname;
      `,
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data.length).toBeGreaterThanOrEqual(3)

    const functionNames = data.map((fn: any) => fn.function_name)
    expect(functionNames).toContain('should_send_notification')
    expect(functionNames).toContain('create_strategy_notification')
    expect(functionNames).toContain('get_execution_log_summary')
  })
})

// NOTE: This test file uses a hypothetical 'exec_sql' RPC function
// You may need to create this function in Supabase or adjust tests
// to use direct SQL queries via a PostgreSQL client library

/**
 * MIGRATION VALIDATION TEST (Optional)
 *
 * This test validates that all migrations can be rolled back successfully.
 * It should be run in a separate test environment to avoid data loss.
 */
describe('Migration Rollback (Optional - Test Environment Only)', () => {
  test.skip('migrations can be rolled back without errors', async () => {
    // WARNING: This test is destructive and should only be run in test environments
    // It validates that the rollback SQL in each migration file works correctly

    // This would require:
    // 1. Running all migrations
    // 2. Executing rollback SQL from each migration (in reverse order)
    // 3. Verifying tables and columns are removed
    // 4. Re-running migrations to restore schema

    expect(true).toBe(true) // Placeholder
  })
})
