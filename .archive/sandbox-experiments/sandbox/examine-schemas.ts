import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function examineSchemas() {
  console.log('🔍 EXAMINING SCHEMAS FOR MASSIVE TRADE TABLES');
  console.log('='.repeat(50));

  const tables = [
    'default.vw_trades_canonical',
    'default.trades_with_direction',
    'cascadian_clean.fact_trades_clean',
    'default.clob_fills'
  ];

  for (const table of tables) {
    try {
      const schema = await clickhouse.query({
        query: `DESCRIBE ${table}`,
        format: 'JSONEachRow'
      });

      const columns = await schema.json();
      console.log(`\n${table}:`);
      console.log('Columns:', columns.map((c: any) => c.name).join(', '));

      // Sample a few rows to see the data format
      const sample = await clickhouse.query({
        query: `SELECT * FROM ${table} LIMIT 2`,
        format: 'JSONEachRow'
      });

      const sampleData = await sample.json();
      if (sampleData.length > 0) {
        console.log('Sample row keys:', Object.keys(sampleData[0]).join(', '));
      }

    } catch (error: any) {
      console.log(`\n${table}: Schema error - ${error.message}`);
    }
  }
}

examineSchemas().catch(console.error);