import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Testing decimal <-> hex conversion for joining');
  
  // First, understand asset_id type in clob_fills
  const schemaResult = await client.query({
    query: 'DESCRIBE TABLE clob_fills',
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json<any>();
  const assetIdCol = schema.find((c: any) => c.name === 'asset_id');
  console.log('\nclob_fills.asset_id type: ' + assetIdCol.type);
  
  // Test conversion: asset_id (decimal string) to hex
  console.log('\nTest: Convert asset_id to hex format');
  const conversionTest = await client.query({
    query: `
      SELECT 
        asset_id,
        lower(concat('0x', hex(toUInt256(asset_id)))) as asset_id_hex
      FROM clob_fills 
      WHERE asset_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const conversions = await conversionTest.json<any>();
  
  console.log('\nSample conversions:');
  conversions.forEach((row, idx) => {
    console.log('Row ' + (idx + 1) + ':');
    console.log('  asset_id (decimal): ' + row.asset_id);
    console.log('  asset_id_hex: ' + row.asset_id_hex);
  });
  
  // Now test if we can join using hex conversion
  console.log('\nTesting join with hex conversion...');
  const joinTest = await client.query({
    query: `
      SELECT count(*) as match_count
      FROM clob_fills c
      INNER JOIN cascadian_clean.token_to_cid_bridge b
        ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      WHERE c.asset_id != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const matches = await joinTest.json<any>();
  console.log('Join matches with hex conversion: ' + matches[0].match_count);
  
  if (matches[0].match_count > 0) {
    console.log('\nSUCCESS! Showing sample join results:');
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
        WHERE c.asset_id != ''
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleJoinResult.json<any>();
    
    samples.forEach((row, idx) => {
      console.log('\nMatch ' + (idx + 1) + ':');
      console.log('  asset_id (decimal): ' + row.asset_id);
      console.log('  asset_id_hex: ' + row.asset_id_hex);
      console.log('  token_hex: ' + row.token_hex);
      console.log('  cid_hex: ' + row.cid_hex);
      console.log('  outcome_index: ' + row.outcome_index);
    });
    
    // Coverage estimate
    console.log('\n\nCOVERAGE ESTIMATE:');
    const coverageResult = await client.query({
      query: `
        SELECT 
          uniq(c.asset_id) as total_unique_assets,
          countIf(b.token_hex IS NOT NULL) as mappable_assets
        FROM (
          SELECT DISTINCT asset_id 
          FROM clob_fills 
          WHERE asset_id != ''
        ) c
        LEFT JOIN cascadian_clean.token_to_cid_bridge b
          ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      `,
      format: 'JSONEachRow'
    });
    const coverage = await coverageResult.json<any>();
    
    const total = parseInt(coverage[0].total_unique_assets);
    const mappable = parseInt(coverage[0].mappable_assets);
    const pct = (mappable * 100.0 / total).toFixed(2);
    
    console.log('  Total unique assets in clob_fills: ' + total);
    console.log('  Mappable via token_to_cid_bridge: ' + mappable);
    console.log('  Coverage percentage: ' + pct + '%');
    
    // Test with high-volume condition IDs
    console.log('\n\nHIGH-VOLUME MARKET TEST:');
    const hvTest = await client.query({
      query: `
        SELECT 
          b.cid_hex,
          b.outcome_index,
          count(*) as trade_count
        FROM clob_fills c
        INNER JOIN cascadian_clean.token_to_cid_bridge b
          ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
        WHERE c.asset_id != ''
          AND lower(replaceAll(b.cid_hex, '0x', '')) IN (
            'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
            'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
            'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
          )
        GROUP BY b.cid_hex, b.outcome_index
        ORDER BY trade_count DESC
      `,
      format: 'JSONEachRow'
    });
    const hvResults = await hvTest.json<any>();
    
    if (hvResults.length > 0) {
      console.log('Found high-volume markets!');
      hvResults.forEach((row, idx) => {
        console.log('  ' + (idx + 1) + '. cid_hex: ' + row.cid_hex);
        console.log('     outcome_index: ' + row.outcome_index + ', trades: ' + row.trade_count);
      });
    } else {
      console.log('  No matches for high-volume condition IDs');
    }
  } else {
    console.log('\nNo matches found. Conversion approach failed.');
  }
  
  await client.close();
  console.log('\n\nAnalysis complete!');
}

main().catch(console.error);
