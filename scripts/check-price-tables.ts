import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'default',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('Looking for tables with price or market data...\n');
  
  const result = await client.query({
    query: `
      SELECT 
        name, 
        engine, 
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables 
      WHERE database = currentDatabase()
        AND (name LIKE '%price%' OR name LIKE '%market%' OR name LIKE '%candle%')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  
  const tables = await result.json();
  console.log('Tables with market/price data:');
  console.table(tables);
  
  // Check if there's a mapping table
  console.log('\nLooking for mapping tables...\n');
  const mappingResult = await client.query({
    query: `
      SELECT 
        name,
        total_rows
      FROM system.tables 
      WHERE database = currentDatabase()
        AND (name LIKE '%map%' OR name LIKE '%token%' OR name LIKE '%condition%')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  
  const mappingTables = await mappingResult.json();
  console.table(mappingTables);
  
  // Check what market_id format looks like
  console.log('\nSample market_ids from market_candles_5m:');
  const sampleResult = await client.query({
    query: `
      SELECT DISTINCT market_id
      FROM market_candles_5m
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  
  const samples = await sampleResult.json();
  console.table(samples);
}

main().catch(console.error).finally(() => client.close());
