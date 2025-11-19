import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

const HIGH_VOLUME_CIDS = [
  'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
  'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
  'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
];

async function investigateTable(db: string, table: string, priority: string) {
  console.log('\n' + '='.repeat(80));
  console.log('Table: ' + db + '.' + table + ' [' + priority + ']');
  console.log('='.repeat(80));

  try {
    // Schema
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE ' + db + '.' + table,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json<any>();
    
    console.log('\nSCHEMA (' + schema.length + ' columns):');
    const keyColumns: string[] = [];
    schema.forEach((col: any) => {
      const name = col.name;
      const type = col.type;
      const isKey = name.includes('token') || name.includes('asset') || 
                    name.includes('condition') || name.includes('outcome') || 
                    name.includes('market');
      if (isKey) {
        console.log('  >> ' + name.padEnd(35) + type);
        keyColumns.push(name);
      } else {
        console.log('     ' + name.padEnd(35) + type);
      }
    });

    // Sample data
    const sampleResult = await client.query({
      query: 'SELECT * FROM ' + db + '.' + table + ' LIMIT 3',
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<any>();
    
    console.log('\nSAMPLE DATA (3 rows):');
    if (samples.length > 0) {
      samples.forEach((row, i) => {
        console.log('\nRow ' + (i + 1) + ':');
        Object.entries(row).forEach(([key, value]) => {
          const display = typeof value === 'string' && value.length > 60 
            ? value.substring(0, 60) + '...' 
            : value;
          console.log('  ' + key + ': ' + display);
        });
      });
    } else {
      console.log('  (empty table)');
    }

    // Coverage stats
    const countResult = await client.query({
      query: 'SELECT count(*) as total FROM ' + db + '.' + table,
      format: 'JSONEachRow'
    });
    const countData = await countResult.json<any>();
    console.log('\nCOVERAGE:');
    console.log('  Total rows: ' + countData[0].total);

    // High-volume test
    const condCols = schema.filter((c: any) => c.name.includes('condition_id')).map((c: any) => c.name);
    if (condCols.length > 0) {
      console.log('\nHIGH-VOLUME TEST:');
      const testCid = HIGH_VOLUME_CIDS[0];
      const whereClause = condCols.map(col => col + " = '" + testCid + "'").join(' OR ');
      
      const testResult = await client.query({
        query: 'SELECT * FROM ' + db + '.' + table + ' WHERE ' + whereClause + ' LIMIT 5',
        format: 'JSONEachRow'
      });
      const testRows = await testResult.json<any>();
      
      console.log('  Test CID: ' + testCid.substring(0, 20) + '...');
      console.log('  Rows found: ' + testRows.length);
      if (testRows.length > 0) {
        console.log('  Sample match:');
        Object.entries(testRows[0]).forEach(([key, value]) => {
          console.log('    ' + key + ': ' + value);
        });
      }
    }

    // Classification
    const hasToken = keyColumns.some(c => c.includes('token') || c.includes('asset'));
    const hasCondition = keyColumns.some(c => c.includes('condition'));
    const hasOutcomeIndex = keyColumns.some(c => c.includes('outcome_index'));
    const hasOutcome = keyColumns.some(c => c.includes('outcome'));
    
    console.log('\nVERDICT:');
    if (hasToken && hasCondition && hasOutcomeIndex) {
      console.log('  ⭐⭐⭐ JACKPOT - Has token + condition + outcome_index');
    } else if (hasToken && hasCondition && hasOutcome) {
      console.log('  ⭐⭐ VERY GOOD - Has token + condition + outcome (need to parse)');
    } else if (hasToken && hasCondition) {
      console.log('  ⭐ PARTIAL - Has token + condition (missing outcome)');
    } else {
      console.log('  ❌ NOT USEFUL - Missing critical fields');
    }

  } catch (error: any) {
    console.log('\nERROR: ' + error.message);
  }
}

async function main() {
  // Priority 1: Most promising names
  await investigateTable('cascadian_clean', 'token_condition_market_map', 'PRIORITY 1');
  await investigateTable('cascadian_clean', 'token_to_cid_bridge', 'PRIORITY 1');
  
  // Priority 2: Default database candidates
  await investigateTable('default', 'erc1155_condition_map', 'PRIORITY 2');
  await investigateTable('default', 'legacy_token_condition_map', 'PRIORITY 2');
  await investigateTable('default', 'market_to_condition_dict', 'PRIORITY 2');
  
  // Priority 3: Other candidates
  await investigateTable('default', 'canonical_condition', 'PRIORITY 3');
  await investigateTable('default', 'condition_market_map', 'PRIORITY 3');
  await investigateTable('default', 'vw_conditions_enriched', 'PRIORITY 3');
  
  await client.close();
  console.log('\n\n✅ Investigation complete!');
}

main().catch(console.error);
