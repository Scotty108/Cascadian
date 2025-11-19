import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

const HIGH_VOLUME_CID = 'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058';

async function investigateTable(tableName: string) {
  console.log('\n' + '='.repeat(80));
  console.log('TABLE: ' + tableName);
  console.log('='.repeat(80));
  
  try {
    // Schema
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE ' + tableName,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json<any>();
    
    console.log('\nKEY COLUMNS:');
    const keyCols = schema.filter((c: any) => 
      c.name.includes('condition') || c.name.includes('market') || 
      c.name.includes('outcome') || c.name.includes('token')
    );
    keyCols.forEach((c: any) => {
      console.log('  ' + c.name.padEnd(30) + c.type);
    });
    
    // Sample
    const sampleResult = await client.query({
      query: 'SELECT * FROM ' + tableName + ' LIMIT 3',
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<any>();
    
    console.log('\nSAMPLE (3 rows):');
    if (samples.length > 0) {
      samples.forEach((row, idx) => {
        console.log('\nRow ' + (idx + 1) + ':');
        Object.entries(row).slice(0, 8).forEach(([key, val]) => {
          const display = typeof val === 'string' && val.length > 50 ? val.substring(0, 50) + '...' : val;
          console.log('  ' + key + ': ' + display);
        });
      });
    }
    
    // Row count
    const countResult = await client.query({
      query: 'SELECT count(*) as cnt FROM ' + tableName,
      format: 'JSONEachRow'
    });
    const count = await countResult.json<any>();
    console.log('\nTotal rows: ' + count[0].cnt);
    
    // Check for high-volume CID
    const condCols = schema.filter((c: any) => c.name.includes('condition_id')).map((c: any) => c.name);
    if (condCols.length > 0) {
      const whereClause = condCols.map(col => 
        "lower(replaceAll(" + col + ", '0x', '')) = '" + HIGH_VOLUME_CID + "'"
      ).join(' OR ');
      
      const testResult = await client.query({
        query: 'SELECT * FROM ' + tableName + ' WHERE ' + whereClause + ' LIMIT 3',
        format: 'JSONEachRow'
      });
      const testRows = await testResult.json<any>();
      
      console.log('\nHigh-volume CID test: ' + testRows.length + ' rows found');
      if (testRows.length > 0) {
        console.log('Sample match:');
        Object.entries(testRows[0]).slice(0, 6).forEach(([key, val]) => {
          console.log('  ' + key + ': ' + val);
        });
      }
    }
    
  } catch (error: any) {
    console.log('\nERROR: ' + error.message);
  }
}

async function main() {
  // Tables that might have complete outcome sets
  await investigateTable('market_outcomes');
  await investigateTable('market_outcomes_expanded');
  await investigateTable('outcome_positions_v2');
  await investigateTable('outcome_positions_v3');
  
  await client.close();
  console.log('\n\nDone!');
}

main().catch(console.error);
