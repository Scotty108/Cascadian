-- Add order_id column to pm_trade_fifo_roi_v3
-- This enables accurate trade counting (1 order_id = 1 trading decision)
ALTER TABLE pm_trade_fifo_roi_v3
ADD COLUMN IF NOT EXISTS order_id String AFTER tx_hash;
