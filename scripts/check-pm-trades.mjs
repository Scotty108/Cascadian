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
  const describeQuery = `DESCRIBE pm_trades`;
  const describeResult = await client.query({ query: describeQuery, format: 'JSONEachRow' });
  const schema = await describeResult.json();

  console.log('pm_trades Schema:');
  console.log('='.repeat(80));
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  // Now check data for one wallet
  const address = wallets.HolyMoses7;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`HolyMoses7 (${address})`);
  console.log('='.repeat(80));

  // Try to find the right column
  const possibleColumns = ['maker_address', 'taker_address', 'wallet', 'address', 'trader'];

  for (const col of possibleColumns) {
    try {
      const query = `
        SELECT count(*) as cnt
        FROM pm_trades
        WHERE ${col} = '${address}'
      `;

      const result = await client.query({ query, format: 'JSONEachRow' });
      const data = await result.json();

      if (parseInt(data[0].cnt) > 0) {
        console.log(`\nFound ${data[0].cnt} rows using column: ${col}`);

        // Get sample data
        const sampleQuery = `
          SELECT *
          FROM pm_trades
          WHERE ${col} = '${address}'
          LIMIT 3
        `;

        const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
        const sampleData = await sampleResult.json();

        console.log('\nSample data:');
        console.log(JSON.stringify(sampleData, null, 2));
        break;
      }
    } catch (error) {
      // Column doesn't exist, try next
      continue;
    }
  }

  await client.close();
}

check();
