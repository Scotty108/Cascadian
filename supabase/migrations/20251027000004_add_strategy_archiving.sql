-- Add archiving support to strategy_definitions table
-- This allows us to hide old default templates while preserving them

-- Add is_archived column
ALTER TABLE strategy_definitions
ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;

-- Create index for archived strategies
CREATE INDEX idx_archived_strategies ON strategy_definitions(is_archived) WHERE is_archived = TRUE;

-- Add comment
COMMENT ON COLUMN strategy_definitions.is_archived IS 'True for strategies that have been archived (hidden from main library view but accessible in Archived tab)';

-- Mark all current predefined strategies as archived
-- This moves them out of the main view so we can add new, better default strategies
UPDATE strategy_definitions
SET is_archived = TRUE
WHERE is_predefined = TRUE;

-- Note: After this migration, the main library will be empty until new default strategies are added
