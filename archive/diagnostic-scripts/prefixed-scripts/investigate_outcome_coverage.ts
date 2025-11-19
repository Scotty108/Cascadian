import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Investigating outcome coverage in token_to_cid_bridge');
  
  // How many CIDs have multiple outcomes?
  console.log('\nOutcome distribution per condition ID:');
  const outcomeDistResult = await client.query({
    query: `
      SELECT 
        count(DISTINCT outcome_index) as outcome_count,
        count(*) as cid_count
      FROM (
        SELECT 
          cid_hex,
          count(DISTINCT outcome_index) as outcome_count
        FROM cascadian_clean.token_to_cid_bridge
        GROUP BY cid_hex
      )
      GROUP BY outcome_count
      ORDER BY outcome_count
    `,
    format: 'JSONEachRow'
  });
  const outcomeDist = await outcomeDistResult.json<any>();
  
  outcomeDist.forEach(row => {
    console.log('  ' + row.outcome_count + ' outcomes: ' + row.cid_count + ' markets');
  });
  
  // Sample a multi-outcome market
  console.log('\n\nFinding markets with 2+ outcomes:');
  const multiOutcomeResult = await client.query({
    query: `
      SELECT 
        cid_hex,
        groupArray(outcome_index) as outcomes,
        count(*) as token_count
      FROM cascadian_clean.token_to_cid_bridge
      GROUP BY cid_hex
      HAVING count(DISTINCT outcome_index) >= 2
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const multiOutcome = await multiOutcomeResult.json<any>();
  
  if (multiOutcome.length > 0) {
    console.log('Found ' + multiOutcome.length + ' markets with 2+ outcomes:');
    multiOutcome.forEach((row, idx) => {
      console.log('\n  Market ' + (idx + 1) + ':');
      console.log('    cid_hex: ' + row.cid_hex);
      console.log('    outcomes: [' + row.outcomes.join(', ') + ']');
      console.log('    tokens: ' + row.token_count);
    });
    
    // Test join on first multi-outcome market
    if (multiOutcome.length > 0) {
      const testCid = multiOutcome[0].cid_hex;
      console.log('\n\nTesting join for multi-outcome market:');
      console.log('CID: ' + testCid);
      
      const joinTestResult = await client.query({
        query: `
          SELECT 
            b.outcome_index,
            count(*) as trade_count,
            sum(toFloat64OrZero(c.price)) as total_volume
          FROM clob_fills c
          INNER JOIN cascadian_clean.token_to_cid_bridge b
            ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
          WHERE match(c.asset_id, '^[0-9]+$')
            AND b.cid_hex = '${testCid}'
          GROUP BY b.outcome_index
          ORDER BY b.outcome_index
        `,
        format: 'JSONEachRow'
      });
      const joinTest = await joinTestResult.json<any>();
      
      if (joinTest.length > 0) {
        console.log('\nJoin successful! Trade counts by outcome:');
        joinTest.forEach(row => {
          console.log('  Outcome ' + row.outcome_index + ': ' + row.trade_count + ' trades, volume: ' + row.total_volume);
        });
      } else {
        console.log('  No trades found for this market');
      }
    }
  } else {
    console.log('  No markets with 2+ outcomes found!');
  }
  
  // Check outcome_index range
  console.log('\n\nOutcome index statistics:');
  const statsResult = await client.query({
    query: `
      SELECT 
        min(outcome_index) as min_idx,
        max(outcome_index) as max_idx,
        avg(outcome_index) as avg_idx,
        count(DISTINCT outcome_index) as unique_indices
      FROM cascadian_clean.token_to_cid_bridge
    `,
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<any>();
  
  console.log('  Min outcome_index: ' + stats[0].min_idx);
  console.log('  Max outcome_index: ' + stats[0].max_idx);
  console.log('  Avg outcome_index: ' + stats[0].avg_idx);
  console.log('  Unique indices: ' + stats[0].unique_indices);
  
  // Sample some outcome indices
  console.log('\n\nSample of outcome_index values:');
  const sampleIdxResult = await client.query({
    query: 'SELECT DISTINCT outcome_index FROM cascadian_clean.token_to_cid_bridge ORDER BY outcome_index LIMIT 20',
    format: 'JSONEachRow'
  });
  const sampleIdx = await sampleIdxResult.json<any>();
  
  const indices = sampleIdx.map(r => r.outcome_index);
  console.log('  First 20: [' + indices.join(', ') + ']');
  
  await client.close();
  console.log('\n\nAnalysis complete!');
}

main().catch(console.error);
