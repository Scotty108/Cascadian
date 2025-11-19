-- ERC-1155 Timestamp Finalization
-- This script applies the fetched timestamps to the main table
-- Estimated runtime: 2-5 minutes

-- Step 1: Create new table with corrected timestamps
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

-- Step 2: Atomic swap (fast - just renames)
RENAME TABLE default.erc1155_transfers TO default.erc1155_transfers_backup;
RENAME TABLE default.erc1155_transfers_fixed TO default.erc1155_transfers;

-- Step 3: Cleanup
DROP TABLE IF EXISTS default.tmp_block_timestamps_opt;
DROP TABLE IF EXISTS default.erc1155_transfers_backup;

-- Verify
SELECT
  count() as total_rows,
  toDate(min(block_timestamp)) as earliest_date,
  toDate(max(block_timestamp)) as latest_date,
  dateDiff('day', toDate(min(block_timestamp)), toDate(max(block_timestamp))) as days_span
FROM default.erc1155_transfers
WHERE block_timestamp > toDateTime(0);
