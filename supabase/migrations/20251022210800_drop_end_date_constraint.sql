-- Drop the markets_end_date_check constraint
-- This constraint is too strict for real Polymarket data

ALTER TABLE markets
DROP CONSTRAINT IF EXISTS markets_end_date_check;

-- We can add a more lenient constraint later if needed
