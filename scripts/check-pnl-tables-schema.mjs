import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function checkSchema() {
  const tables = [
    'wallet_realized_pnl_final',
    'wallet_pnl_summary_final',
    'realized_pnl_by_market_final'
  ];

  for (const table of tables) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Table: ${table}`);
    console.log('='.repeat(80));

    const describeQuery = `DESCRIBE ${table}`;
    const describeResult = await client.query({ query: describeQuery, format: 'JSONEachRow' });
    const schema = await describeResult.json();

    console.log('Schema:');
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type}`);
    });

    const sampleQuery = `SELECT * FROM ${table} LIMIT 3`;
    const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json();

    console.log(`\nSample data (${sampleData.length} rows):`);
    if (sampleData.length > 0) {
      console.log(JSON.stringify(sampleData, null, 2));
    }
  }

  await client.close();
}

checkSchema();
