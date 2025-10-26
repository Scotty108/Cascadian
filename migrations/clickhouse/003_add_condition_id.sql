-- Add condition_id column to trades_raw table
-- This enables joining with Supabase markets table to get categories
-- without needing to resolve tokenId on every query

-- Add the column
ALTER TABLE trades_raw
  ADD COLUMN IF NOT EXISTS condition_id String DEFAULT ''
  COMMENT 'Condition ID from CTF Exchange (maps to markets.condition_id in Supabase)';

-- Create index for fast joins
ALTER TABLE trades_raw
  ADD INDEX IF NOT EXISTS idx_condition_id (condition_id) TYPE bloom_filter(0.01) GRANULARITY 1;

SELECT '✅ Added condition_id column to trades_raw table' AS status;
