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
  console.log('=== RESOLUTIONS_EXTERNAL_INGEST SCHEMA ===\n');
  
  const schema = await client.query({
    query: 'DESCRIBE resolutions_external_ingest',
    format: 'JSONEachRow',
  });
  
  const schemaData = await schema.json();
  console.table(schemaData);
  
  console.log('\n=== SAMPLE DATA ===\n');
  const samples = await client.query({
    query: `
      SELECT *
      FROM resolutions_external_ingest
      WHERE length(payout_numerators) > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  
  const samplesData = await samples.json();
  console.log(JSON.stringify(samplesData, null, 2));
}

main().catch(console.error).finally(() => client.close());
