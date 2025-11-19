-- PART 1: Find all tables in default database
SELECT 
    name,
    engine,
    total_rows,
    total_bytes
FROM system.tables 
WHERE database = 'default' 
ORDER BY name;
