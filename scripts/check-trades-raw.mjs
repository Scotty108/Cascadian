import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function checkSchema() {
  const query = "DESCRIBE trades_raw";
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('trades_raw schema (columns):');
  data.forEach(col => console.log(`  ${col.name}: ${col.type}`));
  
  await client.close();
}

checkSchema();
