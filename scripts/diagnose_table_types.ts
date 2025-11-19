import { createClient } from '@clickhouse/client';

async function diagnose() {
  const client = createClient({
    url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
    username: 'default',
    password: '8miOkWI~OhsDb',
    database: 'default',
    request_timeout: 180000,
  });
  
  try {
    console.log('=== TABLE TYPE & ENGINE ANALYSIS ===\n');
    
    // Get all tables we care about
    const tables = await client.query({
      query: "SELECT name, engine, is_temporary, total_rows FROM system.tables WHERE database IN ('default', 'cascadian_clean') AND name IN ('trades_raw', 'vw_trades_canonical', 'trades_with_direction', 'fact_trades_clean') ORDER BY name",
      format: 'JSONCompact'
    });
    
    const tablesText = await tables.text();
    const tablesData = JSON.parse(tablesText);
    
    console.log('Table Overview:');
    console.log('');
    tablesData.data.forEach((row: any) => {
      console.log('Name: ' + row[0]);
      console.log('Engine: ' + row[1]);
      console.log('Is Temporary: ' + row[2]);
      console.log('Total Rows: ' + (row[3] as number).toLocaleString());
      console.log('');
    });
    
    // Now check vw_trades_canonical more carefully
    console.log('=== vw_trades_canonical Source Check ===\n');
    
    // Sample from vw_trades_canonical
    const sample1 = await client.query({
      query: 'SELECT COUNT(DISTINCT transaction_hash) as unique_tx_hashes FROM default.vw_trades_canonical',
      format: 'JSONCompact'
    });
    const sample1Text = await sample1.text();
    const sample1Data = JSON.parse(sample1Text);
    console.log('Unique transaction_hash in vw_trades_canonical:', sample1Data.data[0][0]);
    
    // Sample from trades_raw
    const sample2 = await client.query({
      query: 'SELECT COUNT(DISTINCT transaction_hash) as unique_tx_hashes FROM default.trades_raw LIMIT 1000000',
      format: 'JSONCompact'
    });
    const sample2Text = await sample2.text();
    const sample2Data = JSON.parse(sample2Text);
    console.log('Unique transaction_hash in trades_raw:', sample2Data.data[0][0]);
    
    console.log('');
    console.log('If vw_trades_canonical unique TX < trades_raw, then duplication is the issue.');
    console.log('If vw_trades_canonical unique TX > trades_raw, then the view is from multiple sources.');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

diagnose();
