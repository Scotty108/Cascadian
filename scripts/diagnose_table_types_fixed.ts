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
      query: "SELECT name, engine, is_temporary FROM system.tables WHERE database IN ('default', 'cascadian_clean') AND name IN ('trades_raw', 'vw_trades_canonical', 'trades_with_direction', 'fact_trades_clean') ORDER BY name",
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
      console.log('');
    });
    
    // Get the view definitions
    console.log('=== VIEW DEFINITIONS ===\n');
    
    const rawViewDef = await client.query({
      query: "SELECT create_table_query FROM system.tables WHERE database = 'default' AND name = 'trades_raw'",
      format: 'JSONCompact'
    });
    
    const rawViewText = await rawViewDef.text();
    const rawViewData = JSON.parse(rawViewText);
    
    if (rawViewData.data.length > 0) {
      console.log('trades_raw (VIEW) Definition:');
      console.log(rawViewData.data[0][0]);
      console.log('');
    }
    
    // Check if vw_trades_canonical is actually a view
    const canonicalDef = await client.query({
      query: "SELECT create_table_query FROM system.tables WHERE database = 'default' AND name = 'vw_trades_canonical'",
      format: 'JSONCompact'
    });
    
    const canonicalText = await canonicalDef.text();
    const canonicalData = JSON.parse(canonicalText);
    
    if (canonicalData.data.length > 0) {
      const def = canonicalData.data[0][0];
      if (def.includes('VIEW')) {
        console.log('vw_trades_canonical is a VIEW');
      } else if (def.includes('ENGINE')) {
        console.log('vw_trades_canonical is a TABLE (not a view)');
      }
      console.log('');
    }
    
    // Now check source tables
    console.log('=== DISTINCT TX HASH COUNTS ===\n');
    
    const distinctTx = await client.query({
      query: "SELECT 'trades_raw' as source, COUNT(DISTINCT transaction_hash) as unique_tx UNION ALL SELECT 'vw_trades_canonical' as source, COUNT(DISTINCT transaction_hash) as unique_tx UNION ALL SELECT 'trades_with_direction' as source, COUNT(DISTINCT tx_hash) as unique_tx",
      format: 'JSONCompact'
    });
    
    const distinctText = await distinctTx.text();
    const distinctData = JSON.parse(distinctText);
    
    distinctData.data.forEach((row: any) => {
      console.log(row[0] + ': ' + (row[1] as number).toLocaleString() + ' unique transaction hashes');
    });
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

diagnose();
