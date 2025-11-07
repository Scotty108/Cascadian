import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function checkSchema() {
  const query = "DESCRIBE market_resolutions_final";
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('market_resolutions_final schema:');
  console.log(JSON.stringify(data, null, 2));
  
  const sampleQuery = "SELECT * FROM market_resolutions_final LIMIT 3";
  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json();
  console.log('\nSample data:');
  console.log(JSON.stringify(sampleData, null, 2));
  
  await client.close();
}

checkSchema();
