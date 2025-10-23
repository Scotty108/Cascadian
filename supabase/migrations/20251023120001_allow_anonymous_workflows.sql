-- =====================================================================
-- DEVELOPMENT FIX: Allow Anonymous Workflow Saves
-- =====================================================================
-- Purpose: Allow unauthenticated users to save workflows during development
--          This enables testing without setting up full authentication
--
-- IMPORTANT: For production, remove this migration and implement proper auth
-- =====================================================================

-- Create a default "anonymous" user ID for development
-- Using a well-known UUID that won't conflict with real users
DO $$
BEGIN
  -- This is just a constant, doesn't insert into auth.users
  -- We'll use it in the policies below
  RAISE NOTICE 'Anonymous user ID for development: 00000000-0000-0000-0000-000000000000';
END $$;

-- Drop existing restrictive policies
DROP POLICY IF EXISTS workflow_sessions_insert_own ON workflow_sessions;
DROP POLICY IF EXISTS workflow_sessions_update_own ON workflow_sessions;
DROP POLICY IF EXISTS workflow_sessions_select_own ON workflow_sessions;

-- Create new policies that allow anonymous access
-- Policy: Users can view their own workflows OR anonymous can view anonymous workflows
CREATE POLICY workflow_sessions_select_own_or_anon
  ON workflow_sessions
  FOR SELECT
  USING (
    auth.uid() = user_id  -- Authenticated users see their own
    OR is_template = TRUE  -- Anyone can view templates
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)  -- Anonymous users see anonymous workflows
  );

-- Policy: Users can insert workflows (authenticated OR anonymous)
CREATE POLICY workflow_sessions_insert_own_or_anon
  ON workflow_sessions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id  -- Authenticated users must use their own ID
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)  -- Anonymous users must use anonymous ID
  );

-- Policy: Users can update workflows (authenticated OR anonymous)
CREATE POLICY workflow_sessions_update_own_or_anon
  ON workflow_sessions
  FOR UPDATE
  USING (
    auth.uid() = user_id  -- Authenticated users can update their own
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)  -- Anonymous can update anonymous workflows
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Keep delete policy restrictive (only authenticated users can delete)
-- This prevents accidental data loss during development

-- =====================================================================
-- VALIDATION
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Anonymous workflow access enabled for development';
  RAISE NOTICE '📝 Anonymous workflows will use user_id: 00000000-0000-0000-0000-000000000000';
  RAISE NOTICE '⚠️  REMINDER: Remove this migration before production deployment';
END $$;
