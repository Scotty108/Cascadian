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
  console.log('=== RESOLUTIONS COUNT ===\n');
  
  const counts = await client.query({
    query: `
      SELECT 
        count() as total_resolutions,
        countIf(winning_index >= 0) as with_winner,
        countIf(length(payout_numerators) > 0) as with_payouts
      FROM resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });
  
  const countsData = await counts.json();
  console.table(countsData);
  
  console.log('\n=== SAMPLE RESOLUTIONS ===\n');
  const samples = await client.query({
    query: `
      SELECT *
      FROM resolutions_external_ingest
      WHERE winning_index >= 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  
  const samplesData = await samples.json();
  console.log(JSON.stringify(samplesData, null, 2));
  
  // Check other resolution tables
  console.log('\n=== OTHER RESOLUTION TABLES ===\n');
  const otherTables = await client.query({
    query: `
      SELECT 
        'market_resolutions' as table_name,
        count() as row_count
      FROM market_resolutions
      UNION ALL
      SELECT 
        'market_resolutions_final',
        count()
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow',
  });
  
  const otherData = await otherTables.json();
  console.table(otherData);
  
  // Check market_resolutions_final schema
  console.log('\n=== MARKET_RESOLUTIONS_FINAL SCHEMA ===\n');
  const schema = await client.query({
    query: 'DESCRIBE market_resolutions_final',
    format: 'JSONEachRow',
  });
  
  const schemaData = await schema.json();
  console.table(schemaData);
}

main().catch(console.error).finally(() => client.close());
