import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkPriceSchema() {
  const tables = ['vw_latest_trade_prices', 'dim_current_prices', 'market_last_price'];

  for (const table of tables) {
    console.log(`\n${table}:`);
    try {
      const query = `SELECT * FROM ${table} LIMIT 1`;
      const result = await clickhouse.query({ query });
      const data = await result.json();
      if (data.length > 0) {
        console.log('Columns:', Object.keys(data[0]).join(', '));
        console.log('Sample:', JSON.stringify(data[0], null, 2));
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }
  }
}

checkPriceSchema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
