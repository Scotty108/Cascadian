import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function check() {
  const query = `
    SELECT DISTINCT side, count(*) as cnt
    FROM trades_raw
    WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
    GROUP BY side
  `;
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('Side values:');
  console.log(JSON.stringify(data, null, 2));
  
  await client.close();
}

check();
