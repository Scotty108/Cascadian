import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function checkSchemas() {
  console.log('Checking table schemas...\n');

  // Check erc20_transfers_decoded columns
  const erc20Cols = await clickhouse.query({
    query: `DESCRIBE TABLE erc20_transfers_decoded`,
    format: 'JSONEachRow'
  });
  const erc20Data = await erc20Cols.json();
  console.log('erc20_transfers_decoded columns:');
  console.log(erc20Data.map((c: any) => `  ${c.name} ${c.type}`).join('\n'));
  console.log('');

  // Check trades_raw columns
  const tradesCol = await clickhouse.query({
    query: `DESCRIBE TABLE trades_raw`,
    format: 'JSONEachRow'
  });
  const tradesData = await tradesCol.json();
  console.log('trades_raw columns:');
  console.log(tradesData.map((c: any) => `  ${c.name} ${c.type}`).join('\n'));
  console.log('');

  // Sample a few rows from erc20_transfers_decoded
  const sample = await clickhouse.query({
    query: `SELECT * FROM erc20_transfers_decoded LIMIT 3`,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  console.log('Sample erc20_transfers_decoded rows:');
  console.log(JSON.stringify(sampleData, null, 2));
}

checkSchemas().catch(console.error);
