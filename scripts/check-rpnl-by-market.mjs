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

  // First check schema
  const describeQuery = `DESCRIBE realized_pnl_by_market_final`;
  const describeResult = await client.query({ query: describeQuery, format: 'JSONEachRow' });
  const schema = await describeResult.json();

  console.log('realized_pnl_by_market_final Schema:');
  console.log('='.repeat(80));
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  // Now check data for each wallet
  for (const [name, address] of Object.entries(wallets)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${name} (${address})`);
    console.log('='.repeat(80));

    // Try different column names
    const possibleColumns = ['wallet', 'wallet_address', 'trader', 'address'];

    let foundData = false;
    for (const col of possibleColumns) {
      try {
        const query = `
          SELECT *
          FROM realized_pnl_by_market_final
          WHERE ${col} = '${address}'
          LIMIT 3
        `;

        const result = await client.query({ query, format: 'JSONEachRow' });
        const data = await result.json();

        if (data.length > 0) {
          console.log(`\nFound ${data.length} rows using column: ${col}`);
          console.log(JSON.stringify(data, null, 2));
          foundData = true;
          break;
        }
      } catch (error) {
        // Column doesn't exist, try next
        continue;
      }
    }

    if (!foundData) {
      console.log('No data found for this wallet');
    }
  }

  await client.close();
}

check();
