import { createClient } from '@clickhouse/client';

async function checkViews() {
  const timestamp = new Date().toISOString();
  
  const client = createClient({
    url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
    username: 'default',
    password: '8miOkWI~OhsDb',
    database: 'default',
    request_timeout: 180000,
  });
  
  try {
    console.log('=== VIEW DEFINITION ANALYSIS ===');
    console.log('Timestamp:', timestamp);
    console.log('');
    
    // Check vw_trades_canonical definition
    const viewDef = await client.query({
      query: "SELECT create_table_query FROM system.tables WHERE database = 'default' AND name = 'vw_trades_canonical'",
      format: 'JSONCompact'
    });
    const viewText = await viewDef.text();
    const viewData = JSON.parse(viewText);
    
    if (viewData.data.length > 0) {
      console.log('=== vw_trades_canonical Definition ===\n');
      console.log(viewData.data[0][0]);
      console.log('');
    }
    
    // Check fact_trades_clean definition
    try {
      const factDef = await client.query({
        query: "SELECT create_table_query FROM system.tables WHERE database = 'cascadian_clean' AND name = 'fact_trades_clean'",
        format: 'JSONCompact'
      });
      const factText = await factDef.text();
      const factData = JSON.parse(factText);
      
      if (factData.data.length > 0) {
        console.log('=== fact_trades_clean Definition ===\n');
        console.log(factData.data[0][0]);
        console.log('');
      }
    } catch (e) {
      console.log('fact_trades_clean definition: Could not retrieve');
    }
    
    // Check trades_with_direction definition
    try {
      const tradeDef = await client.query({
        query: "SELECT create_table_query FROM system.tables WHERE database = 'default' AND name = 'trades_with_direction'",
        format: 'JSONCompact'
      });
      const tradeText = await tradeDef.text();
      const tradeData = JSON.parse(tradeText);
      
      if (tradeData.data.length > 0) {
        console.log('=== trades_with_direction Definition ===\n');
        console.log(tradeData.data[0][0]);
        console.log('');
      }
    } catch (e) {
      console.log('trades_with_direction definition: Could not retrieve');
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkViews();
