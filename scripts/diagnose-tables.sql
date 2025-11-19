-- Diagnostic script to see what tables exist
SELECT name FROM system.tables WHERE database = 'default' AND name LIKE '%erc1155%' ORDER BY name;
