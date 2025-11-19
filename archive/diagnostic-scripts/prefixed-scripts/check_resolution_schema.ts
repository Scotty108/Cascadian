import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
});

async function main() {
  const schema = await client.query({
    query: `DESCRIBE TABLE default.market_resolutions_final`,
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  console.log('ALL COLUMNS:');
  console.log(JSON.stringify(cols, null, 2));
  
  // Sample data
  console.log('\n\nSAMPLE DATA:');
  const sample = await client.query({
    query: `SELECT * FROM default.market_resolutions_final LIMIT 3`,
    format: 'JSONEachRow',
  });
  const data = await sample.json();
  console.log(JSON.stringify(data, null, 2));
  
  await client.close();
}

main().catch(console.error);
