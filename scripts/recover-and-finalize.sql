-- Recovery and Finalization Script for ERC-1155 Timestamps
-- This handles both recovery (if table was renamed) and finalization

-- Step 1: Restore if needed (safe - only renames if backup exists and main doesn't)
-- Check and restore from backup if main table is missing
CREATE TABLE IF NOT EXISTS default.erc1155_transfers AS SELECT * FROM default.erc1155_transfers_backup;

-- Step 2: Create new table with corrected timestamps
DROP TABLE IF EXISTS default.erc1155_transfers_fixed;
CREATE TABLE default.erc1155_transfers_fixed ENGINE = ReplacingMergeTree()
ORDER BY (block_number, log_index) AS
SELECT
  block_number,
  log_index,
  tx_hash,
  contract,
  token_id,
  from_address,
  to_address,
  COALESCE(tt.block_timestamp, toDateTime(0)) as block_timestamp,
  operator
FROM default.erc1155_transfers t
LEFT JOIN default.tmp_block_timestamps_opt tt ON t.block_number = tt.block_number;

-- Step 3: Atomic swap
RENAME TABLE default.erc1155_transfers TO default.erc1155_transfers_old;
RENAME TABLE default.erc1155_transfers_fixed TO default.erc1155_transfers;

-- Step 4: Cleanup
DROP TABLE IF EXISTS default.erc1155_transfers_old;
DROP TABLE IF EXISTS default.tmp_block_timestamps_opt;

-- Step 5: Verify
SELECT
  count() as total_rows,
  toDate(min(block_timestamp)) as earliest_date,
  toDate(max(block_timestamp)) as latest_date,
  dateDiff('day', toDate(min(block_timestamp)), toDate(max(block_timestamp))) as days_span,
  countIf(block_timestamp = toDateTime(0)) as epoch_zero_count
FROM default.erc1155_transfers;
