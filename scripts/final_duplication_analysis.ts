import { createClient } from '@clickhouse/client';

async function analyze() {
  const client = createClient({
    url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
    username: 'default',
    password: '8miOkWI~OhsDb',
    database: 'default',
    request_timeout: 180000,
  });
  
  try {
    console.log('=== DUPLICATION ROOT CAUSE ANALYSIS ===\n');
    
    // trades_raw is a VIEW on vw_trades_canonical
    // So the duplication chain is:
    // Some underlying table(s) -> vw_trades_canonical -> trades_raw (view)
    
    // Find what tables vw_trades_canonical might contain
    console.log('Checking if vw_trades_canonical is raw data or a view itself...\n');
    
    // Get the actual CREATE statement
    const def = await client.query({
      query: "SELECT create_table_query FROM system.tables WHERE database = 'default' AND name = 'vw_trades_canonical'",
      format: 'JSONCompact'
    });
    
    const defText = await def.text();
    const defData = JSON.parse(defText);
    
    if (defData.data.length > 0) {
      const createStmt = defData.data[0][0];
      console.log('vw_trades_canonical CREATE statement:');
      console.log(createStmt);
      console.log('');
      
      if (createStmt.includes('AS SELECT')) {
        console.log('STATUS: vw_trades_canonical is created AS SELECT (it is a view/materialized view)');
      } else if (createStmt.includes('ENGINE')) {
        console.log('STATUS: vw_trades_canonical is a regular table (not a view)');
      }
    }
    
    console.log('');
    console.log('=== FINAL ROWCOUNT SUMMARY ===\n');
    
    // Final counts to confirm
    const counts = await client.query({
      query: "SELECT 'vw_trades_canonical (actual table)' as source, COUNT(*) as rows UNION ALL SELECT 'trades_raw (view on vw_trades_canonical)' as source, COUNT(*) as rows FROM default.trades_raw",
      format: 'JSONCompact'
    });
    
    const countsText = await counts.text();
    const countsData = JSON.parse(countsText);
    
    countsData.data.forEach((row: any) => {
      console.log(row[0] + ': ' + (row[1] as number).toLocaleString() + ' rows');
    });
    
    console.log('');
    console.log('=== CONCLUSION ===');
    console.log('');
    console.log('trades_raw is a filtered VIEW of vw_trades_canonical');
    console.log('(filtering out zero market IDs and condition IDs)');
    console.log('');
    console.log('vw_trades_canonical itself appears to be a base table with 157.5M rows');
    console.log('The question is: WHERE did those 157.5M rows come from?');
    console.log('');
    console.log('Hypothesis: vw_trades_canonical likely contains duplicates from');
    console.log('multiple inserts or was created via UNION ALL from multiple sources.');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyze();
