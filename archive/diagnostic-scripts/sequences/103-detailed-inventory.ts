import { clickhouse } from './lib/clickhouse/client';
import * as fs from 'fs';

async function getDetailedInventory() {
  console.log('=== DETAILED TABLE INVENTORY ===\n');
  
  const tablesData = JSON.parse(fs.readFileSync('tables-list.json', 'utf-8'));
  const inventory = [];
  
  let processed = 0;
  for (const table of tablesData) {
    processed++;
    console.log(`[${processed}/${tablesData.length}] ${table.database}.${table.table_name}`);
    
    const tableInfo = {...table};
    
    try {
      const columnsResult = await clickhouse.query({
        query: `DESCRIBE TABLE ${table.database}.${table.table_name}`,
        format: 'JSONEachRow'
      });
      tableInfo.columns = await columnsResult.json();
      console.log(`  Columns: ${tableInfo.columns.length}`);
    } catch (e) {
      console.log(`  Error getting columns`);
    }
    
    try {
      if (!table.engine.includes('View')) {
        const countResult = await clickhouse.query({
          query: `SELECT count() as cnt FROM ${table.database}.${table.table_name}`,
          format: 'JSONEachRow'
        });
        const countData = await countResult.json();
        tableInfo.exact_row_count = countData[0].cnt;
        console.log(`  Rows: ${tableInfo.exact_row_count}`);
      }
    } catch (e) {
      console.log(`  Error getting count`);
    }
    
    inventory.push(tableInfo);
    
    if (processed % 20 === 0) {
      fs.writeFileSync('inventory-progress.json', JSON.stringify(inventory, null, 2));
    }
  }
  
  fs.writeFileSync('CLICKHOUSE_TABLE_INVENTORY.json', JSON.stringify(inventory, null, 2));
  console.log('\n✅ Complete inventory saved!');
  
  return inventory;
}

getDetailedInventory().catch(console.error);