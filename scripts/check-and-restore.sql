-- Check table status
SELECT name FROM system.tables WHERE database = 'default' AND name LIKE 'erc1155%';

-- If erc1155_transfers_backup exists but erc1155_transfers doesn't, restore it
-- Uncomment and run if needed:
-- RENAME TABLE default.erc1155_transfers_backup TO default.erc1155_transfers;
