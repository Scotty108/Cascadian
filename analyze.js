const fs = require('fs');
const data = JSON.parse(fs.readFileSync('CLICKHOUSE_TABLE_INVENTORY.json', 'utf-8'));
const totalRows = data.reduce((sum, t) => sum + Number(t.exact_row_count || t.total_rows || 0), 0);
const totalBytes = data.reduce((sum, t) => sum + Number(t.total_bytes || 0), 0);
console.log('Total Tables:', data.length);
console.log('Total Rows:', totalRows.toLocaleString());
console.log('Total Storage:', (totalBytes / 1024 / 1024 / 1024).toFixed(2), 'GB');
