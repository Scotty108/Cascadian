import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Debugging CID format mismatch');
  
  // Sample from token_to_cid_bridge
  console.log('\nSample cid_hex from token_to_cid_bridge:');
  const bridgeResult = await client.query({
    query: `
      SELECT DISTINCT 
        cid_hex,
        lower(replaceAll(cid_hex, '0x', '')) as cid_normalized,
        length(lower(replaceAll(cid_hex, '0x', ''))) as norm_len
      FROM cascadian_clean.token_to_cid_bridge
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const bridge = await bridgeResult.json<any>();
  
  bridge.forEach((row, idx) => {
    console.log('  ' + (idx + 1) + '. ' + row.cid_hex);
    console.log('     normalized: ' + row.cid_normalized + ' (len=' + row.norm_len + ')');
  });
  
  // Sample from market_outcomes_expanded
  console.log('\n\nSample condition_id_norm from market_outcomes_expanded:');
  const marketResult = await client.query({
    query: 'SELECT DISTINCT condition_id_norm, length(condition_id_norm) as len FROM market_outcomes_expanded LIMIT 10',
    format: 'JSONEachRow'
  });
  const markets = await marketResult.json<any>();
  
  markets.forEach((row, idx) => {
    console.log('  ' + (idx + 1) + '. ' + row.condition_id_norm + ' (len=' + row.len + ')');
  });
  
  // Direct comparison test
  console.log('\n\nDirect match test (pick one cid from bridge, find in market):');
  const testCid = bridge[0].cid_normalized;
  console.log('Test CID (normalized): ' + testCid);
  
  const matchResult = await client.query({
    query: "SELECT * FROM market_outcomes_expanded WHERE condition_id_norm = '" + testCid + "'",
    format: 'JSONEachRow'
  });
  const matches = await matchResult.json<any>();
  
  if (matches.length > 0) {
    console.log('  MATCH FOUND! ' + matches.length + ' outcomes:');
    matches.forEach(row => {
      console.log('    Outcome ' + row.outcome_idx + ': ' + row.outcome_label);
    });
  } else {
    console.log('  NO MATCH - formats are incompatible');
    
    // Try trimming leading zeros
    const trimmedCid = testCid.replace(/^0+/, '');
    console.log('\n  Trying with leading zeros removed: ' + trimmedCid);
    const trimResult = await client.query({
      query: "SELECT * FROM market_outcomes_expanded WHERE condition_id_norm = '" + trimmedCid + "'",
      format: 'JSONEachRow'
    });
    const trimMatches = await trimResult.json<any>();
    
    if (trimMatches.length > 0) {
      console.log('    MATCH FOUND after trimming!');
    } else {
      console.log('    Still no match');
    }
  }
  
  // Check if any cids overlap
  console.log('\n\nChecking for ANY overlapping CIDs:');
  const overlapResult = await client.query({
    query: `
      SELECT count(*) as overlap_count
      FROM (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
        FROM cascadian_clean.token_to_cid_bridge
      ) b
      INNER JOIN market_outcomes_expanded m
        ON b.cid = m.condition_id_norm
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const overlap = await overlapResult.json<any>();
  
  console.log('  Overlapping CIDs: ' + overlap[0].overlap_count);
  
  if (parseInt(overlap[0].overlap_count) > 0) {
    console.log('\n  SUCCESS! Tables can be joined. Getting sample:');
    const sampleJoinResult = await client.query({
      query: `
        SELECT 
          b.cid,
          m.outcome_idx,
          m.outcome_label
        FROM (
          SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
          FROM cascadian_clean.token_to_cid_bridge
          LIMIT 5
        ) b
        INNER JOIN market_outcomes_expanded m
          ON b.cid = m.condition_id_norm
      `,
      format: 'JSONEachRow'
    });
    const sampleJoins = await sampleJoinResult.json<any>();
    
    sampleJoins.forEach((row, idx) => {
      console.log('    ' + (idx + 1) + '. CID: ' + row.cid.substring(0, 20) + '... → Outcome ' + row.outcome_idx + ': ' + row.outcome_label);
    });
  }
  
  await client.close();
}

main().catch(console.error);
