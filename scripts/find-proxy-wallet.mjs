import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function find() {
  const wallets = {
    HolyMoses7: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    niggemon: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  };

  // Check pm_user_proxy_wallets schema
  const describeQuery = `DESCRIBE pm_user_proxy_wallets`;
  const describeResult = await client.query({ query: describeQuery, format: 'JSONEachRow' });
  const schema = await describeResult.json();

  console.log('pm_user_proxy_wallets Schema:');
  console.log('='.repeat(80));
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  // Check if our addresses are in this table
  for (const [name, address] of Object.entries(wallets)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${name} (${address})`);
    console.log('='.repeat(80));

    const query = `
      SELECT *
      FROM pm_user_proxy_wallets
      WHERE proxy_wallet = '${address}' OR wallet = '${address}'
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    if (data.length > 0) {
      console.log('Found mapping:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log('No mapping found');
    }
  }

  await client.close();
}

find();
