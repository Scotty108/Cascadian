import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== UNDERSTANDING THE PRICE DATA ISSUE ===\n');

  // Check if there are other tables with token-level prices
  console.log('Looking for tables with token-level price data...\n');

  const tables = await client.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%token%' OR name LIKE '%price%' OR name LIKE '%trade%')
      ORDER BY total_rows DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const tableData = await tables.json();
  console.table(tableData);

  // Check what market_candles_5m actually represents
  console.log('\n=== MARKET_CANDLES_5M SAMPLE DATA ===\n');

  const sample = await client.query({
    query: `
      SELECT 
        market_id,
        bucket,
        open,
        high,
        low,
        close,
        volume
      FROM market_candles_5m
      WHERE market_id != ''
      ORDER BY bucket DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await sample.json();
  console.table(sampleData);

  console.log('\nKEY INSIGHT:');
  console.log('If market_candles_5m stores aggregated market data (not individual outcome tokens),');
  console.log('then the "close" price represents the market as a whole, not specific outcomes.');
  console.log('\nFor binary markets: price ≈ 1.0 means YES is favored, price ≈ 0.0 means NO is favored');
  console.log('But this matches the EXPECTATION, not the RESOLUTION!');
  console.log('\nWe need TOKEN-LEVEL price data to detect resolutions from prices.\n');

  // Check if trades_raw or similar has token-level data
  console.log('=== CHECKING TRADE TABLES FOR TOKEN-LEVEL DATA ===\n');

  const tradeCheck = await client.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND name LIKE '%trade%'
    `,
    format: 'JSONEachRow',
  });

  const tradeTables = await tradeCheck.json();
  console.log('Trade tables:');
  console.table(tradeTables);

  if (tradeTables.length > 0) {
    const tradeTable = tradeTables[0].name;
    console.log(`\nChecking schema of ${tradeTable}:\n`);

    const schema = await client.query({
      query: `DESCRIBE ${tradeTable}`,
      format: 'JSONEachRow',
    });

    const schemaData = await schema.json();
    console.table(schemaData);
  }

  console.log('\n=== CONCLUSION ===\n');
  console.log('The price inference approach CANNOT work with market-level aggregated prices.');
  console.log('We would need:');
  console.log('1. Individual token prices (YES token price, NO token price separately)');
  console.log('2. OR: Final trade prices from the CLOB fills data');
  console.log('3. OR: A different approach entirely\n');
}

main().catch(console.error).finally(() => client.close());
