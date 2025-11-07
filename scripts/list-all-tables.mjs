import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function listTables() {
  const query = "SHOW TABLES";
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Available Tables:');
  console.log('='.repeat(80));
  data.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.name}`);
  });

  await client.close();
}

listTables();
