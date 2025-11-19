import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Investigating outcome coverage');
  
  // Outcome distribution
  console.log('\nOutcome distribution per condition ID:');
  const outcomeDistResult = await client.query({
    query: `
      SELECT 
        outcomes_per_cid,
        count(*) as market_count
      FROM (
        SELECT 
          cid_hex,
          count(DISTINCT outcome_index) as outcomes_per_cid
        FROM cascadian_clean.token_to_cid_bridge
        GROUP BY cid_hex
      )
      GROUP BY outcomes_per_cid
      ORDER BY outcomes_per_cid
    `,
    format: 'JSONEachRow'
  });
  const outcomeDist = await outcomeDistResult.json<any>();
  
  let totalMarkets = 0;
  outcomeDist.forEach(row => {
    console.log('  ' + row.outcomes_per_cid + ' outcome(s): ' + row.market_count + ' markets');
    totalMarkets += parseInt(row.market_count);
  });
  console.log('  Total markets: ' + totalMarkets);
  
  // Find multi-outcome markets
  console.log('\n\nSample markets with 2+ outcomes:');
  const multiResult = await client.query({
    query: `
      SELECT 
        cid_hex,
        groupArray(DISTINCT outcome_index) as outcomes
      FROM cascadian_clean.token_to_cid_bridge
      GROUP BY cid_hex
      HAVING count(DISTINCT outcome_index) >= 2
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const multi = await multiResult.json<any>();
  
  if (multi.length > 0) {
    multi.forEach((row, idx) => {
      console.log('  ' + (idx + 1) + '. cid: ' + row.cid_hex.substring(0, 20) + '... outcomes: [' + row.outcomes.join(', ') + ']');
    });
    
    // Test first multi-outcome market
    const testCid = multi[0].cid_hex;
    console.log('\n\nTesting join for: ' + testCid);
    
    const joinResult = await client.query({
      query: `
        SELECT 
          b.outcome_index,
          count(*) as trades
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
    const trades = await joinResult.json<any>();
    
    console.log('Trade counts by outcome:');
    trades.forEach(row => {
      console.log('  Outcome ' + row.outcome_index + ': ' + row.trades + ' trades');
    });
  } else {
    console.log('  No multi-outcome markets found');
  }
  
  // Outcome index stats
  console.log('\n\nOutcome index range:');
  const statsResult = await client.query({
    query: 'SELECT min(outcome_index) as min_idx, max(outcome_index) as max_idx, uniq(outcome_index) as unique_idx FROM cascadian_clean.token_to_cid_bridge',
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<any>();
  console.log('  Min: ' + stats[0].min_idx + ', Max: ' + stats[0].max_idx + ', Unique: ' + stats[0].unique_idx);
  
  await client.close();
}

main().catch(console.error);
