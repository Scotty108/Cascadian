-- Add event information columns to markets table
-- This allows us to link markets back to their parent events

ALTER TABLE markets
ADD COLUMN IF NOT EXISTS event_id TEXT,
ADD COLUMN IF NOT EXISTS event_slug TEXT,
ADD COLUMN IF NOT EXISTS event_title TEXT;

-- Create index for faster event lookups
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);
CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug);

-- Add comment for documentation
COMMENT ON COLUMN markets.event_id IS 'Polymarket event ID that this market belongs to';
COMMENT ON COLUMN markets.event_slug IS 'Polymarket event slug for URL routing';
COMMENT ON COLUMN markets.event_title IS 'Parent event title for display purposes';
