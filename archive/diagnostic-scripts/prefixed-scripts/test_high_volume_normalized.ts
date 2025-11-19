import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Testing high-volume markets with normalized condition IDs');
  
  const testCids = [
    'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
    'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
    'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
  ];
  
  console.log('\nChecking if these condition IDs exist in token_to_cid_bridge:');
  
  for (const cid of testCids) {
    const checkResult = await client.query({
      query: `
        SELECT 
          DISTINCT cid_hex,
          count(*) as token_count
        FROM cascadian_clean.token_to_cid_bridge
        WHERE lower(replaceAll(replaceAll(cid_hex, '0x', ''), '00', '')) = '${cid.replace(/^0x/, '').replace(/^00/, '')}'
           OR lower(replaceAll(cid_hex, '0x', '')) = '${cid}'
           OR lower(replaceAll(cid_hex, '0x', '')) LIKE '%${cid}%'
        GROUP BY cid_hex
      `,
      format: 'JSONEachRow'
    });
    const results = await checkResult.json<any>();
    
    console.log('\nCID: ' + cid.substring(0, 20) + '...');
    if (results.length > 0) {
      console.log('  FOUND in bridge table!');
      results.forEach(row => {
        console.log('    cid_hex: ' + row.cid_hex);
        console.log('    tokens: ' + row.token_count);
      });
    } else {
      console.log('  NOT FOUND in bridge table');
    }
  }
  
  // Check what cid_hex values actually look like
  console.log('\n\nSample cid_hex values from token_to_cid_bridge:');
  const sampleResult = await client.query({
    query: 'SELECT DISTINCT cid_hex FROM cascadian_clean.token_to_cid_bridge LIMIT 20',
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<any>();
  
  samples.forEach((row, idx) => {
    console.log('  ' + (idx + 1) + '. ' + row.cid_hex);
  });
  
  // Check length distribution of cid_hex
  console.log('\n\nLength distribution of cid_hex:');
  const lengthResult = await client.query({
    query: 'SELECT length(cid_hex) as len, count(*) as cnt FROM cascadian_clean.token_to_cid_bridge GROUP BY len ORDER BY cnt DESC',
    format: 'JSONEachRow'
  });
  const lengths = await lengthResult.json<any>();
  
  lengths.forEach(row => {
    console.log('  Length ' + row.len + ': ' + row.cnt + ' rows');
  });
  
  // See if there are any markets with lots of trades
  console.log('\n\nTop markets by trade count in joined data:');
  const topMarketsResult = await client.query({
    query: `
      SELECT 
        b.cid_hex,
        count(*) as trade_count,
        count(DISTINCT b.outcome_index) as outcome_count
      FROM clob_fills c
      INNER JOIN cascadian_clean.token_to_cid_bridge b
        ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      WHERE match(c.asset_id, '^[0-9]+$')
      GROUP BY b.cid_hex
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topMarkets = await topMarketsResult.json<any>();
  
  topMarkets.forEach((row, idx) => {
    console.log('\n  ' + (idx + 1) + '. cid_hex: ' + row.cid_hex);
    console.log('     trades: ' + row.trade_count);
    console.log('     outcomes: ' + row.outcome_count);
  });
  
  await client.close();
  console.log('\n\nAnalysis complete!');
}

main().catch(console.error);
