import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Testing join with safe numeric filtering');
  
  // Check what non-numeric values exist
  console.log('\nChecking asset_id values:');
  const invalidResult = await client.query({
    query: `
      SELECT DISTINCT asset_id, count(*) as cnt
      FROM clob_fills
      WHERE asset_id != '' AND NOT match(asset_id, '^[0-9]+$')
      GROUP BY asset_id
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const invalids = await invalidResult.json<any>();
  
  if (invalids.length > 0) {
    console.log('Found invalid (non-numeric) asset_id values:');
    invalids.forEach(row => {
      console.log('  "' + row.asset_id + '" - count: ' + row.cnt);
    });
  } else {
    console.log('  All asset_id values are numeric (good!)');
  }
  
  // Now test join with numeric filter
  console.log('\nTesting join with numeric asset_id only...');
  const joinTest = await client.query({
    query: `
      SELECT count(*) as match_count
      FROM clob_fills c
      INNER JOIN cascadian_clean.token_to_cid_bridge b
        ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      WHERE match(c.asset_id, '^[0-9]+$')
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const matches = await joinTest.json<any>();
  console.log('Join matches: ' + matches[0].match_count);
  
  if (parseInt(matches[0].match_count) > 0) {
    console.log('\n*** JACKPOT FOUND! ***');
    console.log('\nShowing sample join results:');
    const sampleJoinResult = await client.query({
      query: `
        SELECT 
          c.asset_id,
          lower(concat('0x', hex(toUInt256(c.asset_id)))) as asset_id_hex,
          b.token_hex,
          b.cid_hex,
          b.outcome_index
        FROM clob_fills c
        INNER JOIN cascadian_clean.token_to_cid_bridge b
          ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
        WHERE match(c.asset_id, '^[0-9]+$')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleJoinResult.json<any>();
    
    samples.forEach((row, idx) => {
      console.log('\nMatch ' + (idx + 1) + ':');
      console.log('  asset_id: ' + row.asset_id.substring(0, 30) + '...');
      console.log('  asset_id_hex: ' + row.asset_id_hex);
      console.log('  token_hex: ' + row.token_hex);
      console.log('  cid_hex: ' + row.cid_hex);
      console.log('  outcome_index: ' + row.outcome_index);
    });
    
    // Coverage
    console.log('\n\nCOVERAGE ANALYSIS:');
    const coverageResult = await client.query({
      query: `
        SELECT 
          uniq(c.asset_id) as total_assets,
          countIf(b.token_hex IS NOT NULL) as mappable_assets
        FROM (
          SELECT DISTINCT asset_id 
          FROM clob_fills 
          WHERE match(asset_id, '^[0-9]+$')
        ) c
        LEFT JOIN cascadian_clean.token_to_cid_bridge b
          ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      `,
      format: 'JSONEachRow'
    });
    const coverage = await coverageResult.json<any>();
    
    const total = parseInt(coverage[0].total_assets);
    const mappable = parseInt(coverage[0].mappable_assets);
    const pct = (mappable * 100.0 / total).toFixed(2);
    
    console.log('  Total unique assets (numeric): ' + total);
    console.log('  Mappable via token_to_cid_bridge: ' + mappable);
    console.log('  Coverage: ' + pct + '%');
    
    // High-volume test
    console.log('\n\nHIGH-VOLUME MARKET TEST:');
    const testCids = [
      'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
      'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
      'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
    ];
    
    for (const cid of testCids) {
      const hvResult = await client.query({
        query: `
          SELECT 
            b.outcome_index,
            count(*) as trade_count
          FROM clob_fills c
          INNER JOIN cascadian_clean.token_to_cid_bridge b
            ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
          WHERE match(c.asset_id, '^[0-9]+$')
            AND lower(replaceAll(b.cid_hex, '0x', '')) = '${cid}'
          GROUP BY b.outcome_index
          ORDER BY b.outcome_index
        `,
        format: 'JSONEachRow'
      });
      const results = await hvResult.json<any>();
      
      console.log('\nCondition ID: ' + cid.substring(0, 20) + '...');
      if (results.length > 0) {
        results.forEach(row => {
          console.log('  Outcome ' + row.outcome_index + ': ' + row.trade_count + ' trades');
        });
      } else {
        console.log('  No trades found');
      }
    }
  }
  
  await client.close();
  console.log('\n\nAnalysis complete!');
}

main().catch(console.error);
