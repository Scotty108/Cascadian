import { createClient } from '@clickhouse/client';

async function verify() {
  const client = createClient({
    url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
    username: 'default',
    password: '8miOkWI~OhsDb',
    database: 'default',
    request_timeout: 180000,
  });
  
  try {
    console.log('=== ROWCOUNT VERIFICATION ===\n');
    
    // Simple individual queries
    const q1 = await client.query({
      query: 'SELECT COUNT(*) FROM default.vw_trades_canonical',
      format: 'JSONCompact'
    });
    const q1Text = await q1.text();
    const q1Data = JSON.parse(q1Text);
    console.log('vw_trades_canonical: ' + q1Data.data[0][0]);
    
    const q2 = await client.query({
      query: 'SELECT COUNT(*) FROM default.trades_raw',
      format: 'JSONCompact'
    });
    const q2Text = await q2.text();
    const q2Data = JSON.parse(q2Text);
    console.log('trades_raw (view): ' + q2Data.data[0][0]);
    
    const q3 = await client.query({
      query: 'SELECT COUNT(*) FROM default.trades_with_direction',
      format: 'JSONCompact'
    });
    const q3Text = await q3.text();
    const q3Data = JSON.parse(q3Text);
    console.log('trades_with_direction: ' + q3Data.data[0][0]);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verify();
