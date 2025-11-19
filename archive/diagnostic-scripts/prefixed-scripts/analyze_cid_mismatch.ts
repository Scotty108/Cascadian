import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

async function main() {
  console.log('Analyzing CID format discrepancy');
  
  // Compare exact hex values - check if last byte differs
  console.log('\nComparing first CID from bridge in detail:');
  const bridgeCid = '0000040e1054aebd79ce9c6d0668822c5cb2b2fdf2dad3f14ee40cac8b930ca2';
  
  console.log('Bridge CID: ' + bridgeCid);
  console.log('Length: ' + bridgeCid.length);
  console.log('Last 4 chars: ' + bridgeCid.substring(60));
  
  // Check the original cid_hex with 0x prefix
  const originalResult = await client.query({
    query: "SELECT cid_hex FROM cascadian_clean.token_to_cid_bridge WHERE lower(replaceAll(cid_hex, '0x', '')) = '" + bridgeCid + "' LIMIT 1",
    format: 'JSONEachRow'
  });
  const original = await originalResult.json<any>();
  
  if (original.length > 0) {
    console.log('\nOriginal cid_hex from bridge: ' + original[0].cid_hex);
    console.log('Length (with 0x): ' + original[0].cid_hex.length);
    
    // Notice the pattern: cid_hex ends in ...30ca2 but token_hex ends in ...30ca238
    // The cid might be truncated! Let me check token_hex for same record
    const fullResult = await client.query({
      query: "SELECT token_hex, cid_hex FROM cascadian_clean.token_to_cid_bridge WHERE cid_hex = '" + original[0].cid_hex + "' LIMIT 1",
      format: 'JSONEachRow'
    });
    const full = await fullResult.json<any>();
    
    console.log('\nFull record:');
    console.log('  token_hex: ' + full[0].token_hex);
    console.log('  cid_hex:   ' + full[0].cid_hex);
    console.log('\nNOTICE: token_hex is 66 chars, cid_hex is 66 chars');
    console.log('Last 10 of token: ...' + full[0].token_hex.substring(56));
    console.log('Last 10 of cid:   ...' + full[0].cid_hex.substring(56));
    
    // The cid_hex appears to be the token_id with last byte removed!
    // Let me verify this pattern
    console.log('\n\nHypothesis: cid_hex = token_hex with last byte stripped');
    console.log('Testing: Remove last 2 hex chars from token_hex');
    
    const tokenNorm = full[0].token_hex.toLowerCase().replace('0x', '');
    const cidNorm = full[0].cid_hex.toLowerCase().replace('0x', '');
    const tokenTruncated = tokenNorm.substring(0, tokenNorm.length - 2);
    
    console.log('  token_hex (norm):      ' + tokenNorm);
    console.log('  token truncated (-2):  ' + tokenTruncated);
    console.log('  cid_hex (norm):        ' + cidNorm);
    console.log('  Match? ' + (tokenTruncated === cidNorm));
  }
  
  // Now check market_outcomes_expanded format
  console.log('\n\nChecking market_outcomes_expanded CID format:');
  const marketSampleResult = await client.query({
    query: 'SELECT condition_id_norm, length(condition_id_norm) as len FROM market_outcomes_expanded LIMIT 1',
    format: 'JSONEachRow'
  });
  const marketSample = await marketSampleResult.json<any>();
  
  console.log('  Sample CID: ' + marketSample[0].condition_id_norm);
  console.log('  Length: ' + marketSample[0].len);
  console.log('  Format: Full 32-byte (64 hex char) condition ID');
  
  // The issue is clear: cid_hex in bridge is 64 chars (32 bytes) but token_hex is 66 chars (33 bytes with outcome)
  // ERC1155 token IDs encode BOTH condition_id AND outcome_index in a single 256-bit value
  
  console.log('\n\nCONCLUSION:');
  console.log('  - token_hex (66 chars) = full ERC1155 token ID');
  console.log('  - cid_hex (66 chars but different) = condition_id with padding');
  console.log('  - market_outcomes_expanded has pure condition_ids (64 chars)');
  console.log('  - These are DIFFERENT data sources with NO overlap');
  
  // Let me check if ctf_token_map has the bridge we need
  console.log('\n\nChecking ctf_token_map as alternative:');
  const ctfResult = await client.query({
    query: 'SELECT token_id, condition_id, condition_id_norm FROM ctf_token_map WHERE condition_id_norm != \'\' LIMIT 5',
    format: 'JSONEachRow'
  });
  const ctf = await ctfResult.json<any>();
  
  console.log('Sample from ctf_token_map:');
  ctf.forEach((row, idx) => {
    console.log('  ' + (idx + 1) + '. token_id: ' + row.token_id.substring(0, 20) + '...');
    console.log('     condition_id: ' + row.condition_id.substring(0, 20) + '...');
    console.log('     condition_id_norm: ' + row.condition_id_norm.substring(0, 20) + '...');
  });
  
  await client.close();
}

main().catch(console.error);
