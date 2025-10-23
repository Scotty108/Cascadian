-- Add condition_id column to markets table
-- This is needed for CLOB API trade aggregation

ALTER TABLE markets
ADD COLUMN IF NOT EXISTS condition_id TEXT;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_markets_condition_id 
  ON markets(condition_id);

-- Add comment
COMMENT ON COLUMN markets.condition_id IS 'Polymarket condition ID for CLOB API queries';
