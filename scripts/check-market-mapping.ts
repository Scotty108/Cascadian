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
  console.log('=== CONDITION_MARKET_MAP SCHEMA ===\n');
  
  const schema = await client.query({
    query: 'DESCRIBE condition_market_map',
    format: 'JSONEachRow',
  });
  
  const schemaData = await schema.json();
  console.table(schemaData);
  
  console.log('\n=== SAMPLE MAPPINGS ===\n');
  const samples = await client.query({
    query: `
      SELECT
        condition_id,
        market_id,
        event_id,
        canonical_category
      FROM condition_market_map
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  
  const samplesData = await samples.json();
  console.table(samplesData);
  
  console.log('\n=== CHECK IF WE CAN JOIN TO RESOLUTIONS ===\n');
  const joinTest = await client.query({
    query: `
      SELECT 
        count(DISTINCT r.condition_id) as resolutions_count,
        count(DISTINCT cm.condition_id) as mapped_count,
        count(DISTINCT cm.market_id) as unique_market_ids
      FROM resolutions_external_ingest r
      LEFT JOIN condition_market_map cm 
        ON lower(replaceAll(r.condition_id, '0x', '')) = lower(replaceAll(cm.condition_id, '0x', ''))
      WHERE r.winning_outcome_index IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  
  const joinData = await joinTest.json();
  console.table(joinData);
}

main().catch(console.error).finally(() => client.close());
