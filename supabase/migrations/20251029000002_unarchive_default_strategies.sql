-- Unarchive Default Strategies
--
-- Migration 20251027000004 archived all predefined strategies to make room for "new, better default strategies",
-- but those new strategies were never added. This migration unarchives the predefined strategies
-- so they show up in the library again.
--
-- Run this migration when Supabase is accessible (after quota reset or upgrade to Pro)

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
