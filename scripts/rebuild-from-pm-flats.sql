-- Rebuild erc1155_transfers from pm_erc1155_flats with corrected timestamps
-- This recovers from the failed rename attempts

-- Step 1: Create erc1155_transfers from pm_erc1155_flats + timestamps
CREATE TABLE IF NOT EXISTS default.erc1155_transfers ENGINE = ReplacingMergeTree()
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
FROM default.pm_erc1155_flats t
LEFT JOIN default.tmp_block_timestamps_opt tt ON t.block_number = tt.block_number;

-- Step 2: Cleanup temp table
DROP TABLE IF EXISTS default.tmp_block_timestamps_opt;

-- Step 3: Verify
SELECT
  count() as total_rows,
  formatReadableQuantity(count()) as total_formatted,
  toDate(min(block_timestamp)) as earliest_date,
  toDate(max(block_timestamp)) as latest_date,
  dateDiff('day', toDate(min(block_timestamp)), toDate(max(block_timestamp))) as days_span,
  countIf(block_timestamp = toDateTime(0)) as epoch_zero_count
FROM default.erc1155_transfers;
