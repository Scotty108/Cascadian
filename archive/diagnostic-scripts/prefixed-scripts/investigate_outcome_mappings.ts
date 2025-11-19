import { createClient } from '@clickhouse/client';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

const HIGH_VOLUME_CIDS = [
  'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
  'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
  'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
];

async function investigateTable(db: string, table: string) {
  console.log('\n================================================================================');
  console.log('Investigating: ' + db + '.' + table);
  console.log('================================================================================');

  try {
    // Step 1: Check schema
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE ' + db + '.' + table,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json<any>();
    
    console.log('\nSCHEMA:');
    console.log('Column Name'.padEnd(40) + 'Type');
    console.log('--------------------------------------------------------------------------------');
    schema.forEach((col: any) => {
      console.log(col.name.padEnd(40) + col.type);
    });

    // Check for key columns
    const hasTokenId = schema.some((c: any) => c.name.includes('token_id') || c.name.includes('asset_id'));
    const hasConditionId = schema.some((c: any) => c.name.includes('condition_id'));
    const hasOutcomeIndex = schema.some((c: any) => c.name.includes('outcome_index'));
    const hasOutcomeText = schema.some((c: any) => c.name.includes('outcome') && c.name.includes('text'));

    console.log('\nKEY COLUMNS:');
    console.log('  Token/Asset ID: ' + (hasTokenId ? 'YES' : 'NO'));
    console.log('  Condition ID: ' + (hasConditionId ? 'YES' : 'NO'));
    console.log('  Outcome Index: ' + (hasOutcomeIndex ? 'YES' : 'NO'));
    console.log('  Outcome Text: ' + (hasOutcomeText ? 'YES' : 'NO'));

    // Step 2: Sample data
    const sampleResult = await client.query({
      query: 'SELECT * FROM ' + db + '.' + table + ' LIMIT 5',
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<any>();
    
    console.log('\nSAMPLE DATA (5 rows):');
    if (samples.length > 0) {
      console.log(JSON.stringify(samples, null, 2));
    } else {
      console.log('  (empty table)');
    }

    // Step 3: Test high-volume market (if has condition_id)
    if (hasConditionId) {
      console.log('\nHIGH-VOLUME MARKET TEST:');
      for (const cid of HIGH_VOLUME_CIDS.slice(0, 1)) {
        const condCols = schema.filter((c: any) => c.name.includes('condition_id')).map((c: any) => c.name);
        const whereClause = condCols.map(col => col + ' = \'' + cid + '\'').join(' OR ');
        
        const testResult = await client.query({
          query: 'SELECT * FROM ' + db + '.' + table + ' WHERE ' + whereClause + ' LIMIT 10',
          format: 'JSONEachRow'
        });
        const testRows = await testResult.json<any>();
        
        console.log('  Condition ID: ' + cid.substring(0, 16) + '...');
        console.log('  Rows found: ' + testRows.length);
        if (testRows.length > 0) {
          console.log('  Sample match: ' + JSON.stringify(testRows[0], null, 2));
        }
      }
    }

    // Step 4: Coverage analysis
    console.log('\nCOVERAGE:');
    const countResult = await client.query({
      query: 'SELECT count(*) as total FROM ' + db + '.' + table,
      format: 'JSONEachRow'
    });
    const countData = await countResult.json<any>();
    console.log('  Total rows: ' + countData[0].total);

    // Try to get unique counts for key columns
    if (hasTokenId) {
      const tokenCols = schema.filter((c: any) => c.name.includes('token_id') || c.name.includes('asset_id')).map((c: any) => c.name);
      for (const col of tokenCols) {
        const uniqResult = await client.query({
          query: 'SELECT uniq(' + col + ') as unique_tokens FROM ' + db + '.' + table,
          format: 'JSONEachRow'
        });
        const uniqData = await uniqResult.json<any>();
        console.log('  Unique ' + col + ': ' + uniqData[0].unique_tokens);
      }
    }

    if (hasConditionId) {
      const condCols = schema.filter((c: any) => c.name.includes('condition_id')).map((c: any) => c.name);
      for (const col of condCols) {
        const uniqResult = await client.query({
          query: 'SELECT uniq(' + col + ') as unique_conditions FROM ' + db + '.' + table,
          format: 'JSONEachRow'
        });
        const uniqData = await uniqResult.json<any>();
        console.log('  Unique ' + col + ': ' + uniqData[0].unique_conditions);
      }
    }

    // Step 5: Classification
    console.log('\nVERDICT:');
    if (hasTokenId && hasConditionId && hasOutcomeIndex) {
      console.log('  JACKPOT - Has token_id + condition_id + outcome_index');
    } else if (hasTokenId && hasConditionId) {
      console.log('  PARTIAL - Has mappings but missing outcome_index');
    } else if (hasConditionId && hasOutcomeIndex) {
      console.log('  PARTIAL - Has condition+outcome but missing token_id');
    } else {
      console.log('  NOT USEFUL - Missing critical fields for mapping');
    }

  } catch (error: any) {
    console.log('\nERROR: ' + error.message);
  }
}

async function main() {
  const tables = [
    { db: 'default', table: 'canonical_condition' },
    { db: 'default', table: 'condition_market_map' },
    { db: 'default', table: 'erc1155_condition_map' },
    { db: 'default', table: 'legacy_token_condition_map' },
    { db: 'default', table: 'market_to_condition_dict' },
    { db: 'default', table: 'pnl_final_by_condition' },
    { db: 'default', table: 'vol_rank_by_condition' },
    { db: 'default', table: 'vw_condition_categories' },
    { db: 'default', table: 'vw_conditions_enriched' },
    { db: 'cascadian_clean', table: 'token_condition_market_map' }
  ];

  for (const { db, table } of tables) {
    await investigateTable(db, table);
  }

  await client.close();
  console.log('\n\nInvestigation complete!');
}

main().catch(console.error);
