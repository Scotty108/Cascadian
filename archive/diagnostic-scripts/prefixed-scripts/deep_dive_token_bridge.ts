import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Deep dive into token_to_cid_bridge');

  // Get samples
  const samplesResult = await client.query({
    query: 'SELECT * FROM cascadian_clean.token_to_cid_bridge LIMIT 10',
    format: 'JSONEachRow'
  });
  const samples = await samplesResult.json<any>();
  
  console.log('\nSAMPLE ROWS from token_to_cid_bridge:');
  samples.forEach((row, idx) => {
    console.log('Row ' + (idx + 1) + ':');
    console.log('  token_hex: ' + row.token_hex);
    console.log('  cid_hex: ' + row.cid_hex);
    console.log('  outcome_index: ' + row.outcome_index);
  });

  // Check formats
  const formatResult = await client.query({
    query: 'SELECT length(token_hex) as token_len, length(cid_hex) as cid_len, count(*) as cnt FROM cascadian_clean.token_to_cid_bridge GROUP BY token_len, cid_len',
    format: 'JSONEachRow'
  });
  const formats = await formatResult.json<any>();
  
  console.log('\nToken/CID length distribution:');
  formats.forEach(f => {
    console.log('  token_len=' + f.token_len + ', cid_len=' + f.cid_len + ', count=' + f.cnt);
  });

  // Sample asset_ids from clob_fills
  const clobSamplesResult = await client.query({
    query: 'SELECT DISTINCT asset_id FROM clob_fills LIMIT 10',
    format: 'JSONEachRow'
  });
  const clobSamples = await clobSamplesResult.json<any>();
  
  console.log('\nSAMPLE ASSET_IDs from clob_fills:');
  clobSamples.forEach((row, idx) => {
    console.log('  ' + (idx + 1) + '. ' + row.asset_id);
  });

  // Test normalized join
  const joinTest = await client.query({
    query: 'SELECT count(*) as match_count FROM clob_fills c INNER JOIN cascadian_clean.token_to_cid_bridge b ON lower(replaceAll(c.asset_id, \'0x\', \'\')) = lower(replaceAll(b.token_hex, \'0x\', \'\')) LIMIT 1',
    format: 'JSONEachRow'
  });
  const match = await joinTest.json<any>();
  console.log('\nJoin test (normalized): ' + match[0].match_count + ' matches found');

  if (match[0].match_count > 0) {
    // Show sample joins
    const sampleJoinResult = await client.query({
      query: 'SELECT c.asset_id, b.token_hex, b.cid_hex, b.outcome_index FROM clob_fills c INNER JOIN cascadian_clean.token_to_cid_bridge b ON lower(replaceAll(c.asset_id, \'0x\', \'\')) = lower(replaceAll(b.token_hex, \'0x\', \'\')) LIMIT 5',
      format: 'JSONEachRow'
    });
    const sampleJoins = await sampleJoinResult.json<any>();
    
    console.log('\nSAMPLE JOIN RESULTS:');
    sampleJoins.forEach((row, idx) => {
      console.log('Match ' + (idx + 1) + ':');
      console.log('  asset_id: ' + row.asset_id);
      console.log('  token_hex: ' + row.token_hex);
      console.log('  cid_hex: ' + row.cid_hex);
      console.log('  outcome_index: ' + row.outcome_index);
    });

    // Coverage
    const coverageResult = await client.query({
      query: 'SELECT uniq(c.asset_id) as total, countIf(b.token_hex IS NOT NULL) as mappable FROM (SELECT DISTINCT asset_id FROM clob_fills WHERE asset_id != \'\') c LEFT JOIN cascadian_clean.token_to_cid_bridge b ON lower(replaceAll(c.asset_id, \'0x\', \'\')) = lower(replaceAll(b.token_hex, \'0x\', \'\'))',
      format: 'JSONEachRow'
    });
    const coverage = await coverageResult.json<any>();
    
    console.log('\nCOVERAGE:');
    console.log('  Total assets: ' + coverage[0].total);
    console.log('  Mappable: ' + coverage[0].mappable);
    console.log('  Percent: ' + (coverage[0].mappable * 100.0 / coverage[0].total).toFixed(2) + '%');
  }

  await client.close();
}

main().catch(console.error);
