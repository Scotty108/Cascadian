import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('FINAL INVESTIGATION: ctf_token_map table');
  console.log('='.repeat(80));
  
  // Get schema
  const schemaResult = await client.query({
    query: 'DESCRIBE TABLE ctf_token_map',
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json<any>();
  
  console.log('\nCTF_TOKEN_MAP SCHEMA:');
  schema.forEach((col: any) => {
    console.log('  ' + col.name.padEnd(30) + col.type);
  });
  
  // Sample with filled condition_id_norm
  console.log('\n\nSample rows WITH condition_id_norm:');
  const sampleResult = await client.query({
    query: 'SELECT * FROM ctf_token_map WHERE condition_id_norm != \'\' LIMIT 5',
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<any>();
  
  samples.forEach((row, idx) => {
    console.log('\nRow ' + (idx + 1) + ':');
    Object.entries(row).forEach(([key, val]) => {
      const display = typeof val === 'string' && val.length > 60 ? val.substring(0, 60) + '...' : val;
      console.log('  ' + key + ': ' + display);
    });
  });
  
  // Coverage stats
  console.log('\n\nCOVERAGE STATS:');
  const statsResult = await client.query({
    query: `
      SELECT 
        count(*) as total,
        countIf(condition_id_norm != '') as with_cid,
        countIf(outcome_index IS NOT NULL) as with_outcome_index
      FROM ctf_token_map
    `,
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<any>();
  
  const total = parseInt(stats[0].total);
  const withCid = parseInt(stats[0].with_cid);
  const withOutcome = parseInt(stats[0].with_outcome_index);
  
  console.log('  Total rows: ' + total);
  console.log('  With condition_id_norm: ' + withCid + ' (' + (withCid * 100 / total).toFixed(2) + '%)');
  console.log('  With outcome_index: ' + withOutcome + ' (' + (withOutcome * 100 / total).toFixed(2) + '%)');
  
  // Try joining to market_outcomes_expanded
  console.log('\n\nTesting join to market_outcomes_expanded:');
  const joinTestResult = await client.query({
    query: `
      SELECT count(*) as matches
      FROM ctf_token_map c
      INNER JOIN market_outcomes_expanded m
        ON c.condition_id_norm = m.condition_id_norm
      WHERE c.condition_id_norm != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const joinTest = await joinTestResult.json<any>();
  
  console.log('  Join matches: ' + joinTest[0].matches);
  
  if (parseInt(joinTest[0].matches) > 0) {
    console.log('\n  SUCCESS! Can join ctf_token_map to market_outcomes_expanded');
    
    // Sample join
    const sampleJoinResult = await client.query({
      query: `
        SELECT 
          c.token_id,
          c.condition_id_norm,
          c.outcome_index as ctf_outcome,
          m.outcome_idx as market_outcome,
          m.outcome_label
        FROM ctf_token_map c
        INNER JOIN market_outcomes_expanded m
          ON c.condition_id_norm = m.condition_id_norm
        WHERE c.condition_id_norm != ''
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleJoins = await sampleJoinResult.json<any>();
    
    console.log('\n  Sample joins:');
    sampleJoins.forEach((row, idx) => {
      console.log('    ' + (idx + 1) + '. token: ' + row.token_id.substring(0, 20) + '...');
      console.log('       ctf_outcome: ' + row.ctf_outcome + ', market_outcome: ' + row.market_outcome + ' (' + row.outcome_label + ')');
    });
  }
  
  // Test join from clob_fills
  console.log('\n\nTesting FULL join: clob_fills → ctf_token_map → market_outcomes_expanded');
  
  const fullJoinResult = await client.query({
    query: `
      SELECT count(*) as matches
      FROM clob_fills cf
      INNER JOIN ctf_token_map c
        ON cf.asset_id = c.token_id
      INNER JOIN market_outcomes_expanded m
        ON c.condition_id_norm = m.condition_id_norm
      WHERE c.condition_id_norm != ''
        AND cf.asset_id != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const fullJoin = await fullJoinResult.json<any>();
  
  console.log('  Full join matches: ' + fullJoin[0].matches);
  
  if (parseInt(fullJoin[0].matches) > 0) {
    console.log('\n  *** JACKPOT! Full join path works! ***');
    
    // Sample the join
    const fullSampleResult = await client.query({
      query: `
        SELECT 
          cf.asset_id,
          c.condition_id_norm,
          c.outcome_index as traded_outcome,
          m.outcome_idx,
          m.outcome_label
        FROM clob_fills cf
        INNER JOIN ctf_token_map c
          ON cf.asset_id = c.token_id
        INNER JOIN market_outcomes_expanded m
          ON c.condition_id_norm = m.condition_id_norm
          AND c.outcome_index = toInt16(m.outcome_idx)
        WHERE c.condition_id_norm != ''
          AND cf.asset_id != ''
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const fullSamples = await fullSampleResult.json<any>();
    
    console.log('\n  Sample full joins:');
    fullSamples.forEach((row, idx) => {
      console.log('    ' + (idx + 1) + '. asset_id: ' + row.asset_id.substring(0, 20) + '...');
      console.log('       traded_outcome: ' + row.traded_outcome);
      console.log('       outcome_idx: ' + row.outcome_idx + ' (' + row.outcome_label + ')');
    });
  }
  
  await client.close();
  console.log('\n\nFINAL INVESTIGATION COMPLETE!');
}

main().catch(console.error);
