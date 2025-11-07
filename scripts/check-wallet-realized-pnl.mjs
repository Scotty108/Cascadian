import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function check() {
  const wallets = {
    HolyMoses7: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    niggemon: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  };

  console.log('Checking wallet_realized_pnl_final table:');
  console.log('='.repeat(80));

  for (const [name, address] of Object.entries(wallets)) {
    const query = `
      SELECT *
      FROM wallet_realized_pnl_final
      WHERE wallet_address = '${address}'
      LIMIT 1
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    if (data.length > 0) {
      console.log(`\n${name} (${address}):`);
      console.log(JSON.stringify(data[0], null, 2));
    } else {
      console.log(`\n${name} (${address}): NO DATA FOUND`);
    }
  }

  // Also check wallet_pnl_summary_final
  console.log('\n\nChecking wallet_pnl_summary_final table:');
  console.log('='.repeat(80));

  for (const [name, address] of Object.entries(wallets)) {
    const query = `
      SELECT *
      FROM wallet_pnl_summary_final
      WHERE wallet_address = '${address}'
      LIMIT 1
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    if (data.length > 0) {
      console.log(`\n${name} (${address}):`);
      console.log(JSON.stringify(data[0], null, 2));
    } else {
      console.log(`\n${name} (${address}): NO DATA FOUND`);
    }
  }

  await client.close();
}

check();
