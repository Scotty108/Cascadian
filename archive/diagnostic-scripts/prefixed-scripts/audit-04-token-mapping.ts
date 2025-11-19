import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditTokenMapping() {
  console.log('=== AUDIT #4: TOKEN MAPPING COVERAGE ===\n')

  // Total unique token_ids in gamma_markets
  console.log('Token inventory in gamma_markets:')
  const gmTokens = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_markets,
        sum(length(tokens)) as total_token_slots
      FROM gamma_markets
    `,
    format: 'JSONEachRow',
  })
  const gmt = await gmTokens.json<{ total_markets: string; total_token_slots: string }>()
  console.log('   Total markets:', gmt[0].total_markets)
  console.log('   Total token array slots:', gmt[0].total_token_slots)

  // Unique token_ids in ERC-1155
  console.log('\nToken_ids in erc1155_transfers:')
  const erc1155Tokens = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_transfers,
        count(DISTINCT token_id) as unique_token_ids
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  })
  const e1155t = await erc1155Tokens.json<{ total_transfers: string; unique_token_ids: string }>()
  console.log('   Total transfers:', e1155t[0].total_transfers)
  console.log('   Unique token_ids:', e1155t[0].unique_token_ids)

  // Check ctf_token_map
  console.log('\nctf_token_map inventory:')
  const ctfMap = await clickhouse.query({
    query: `SELECT count(*) as total_rows FROM ctf_token_map`,
    format: 'JSONEachRow',
  })
  const ctf = await ctfMap.json<{ total_rows: string }>()
  console.log('   Total rows in ctf_token_map:', ctf[0].total_rows)

  // Sample token formats
  console.log('\nSample token_id formats from erc1155_transfers (first 5):')
  const sampleTokens = await clickhouse.query({
    query: `SELECT DISTINCT token_id FROM erc1155_transfers LIMIT 5`,
    format: 'JSONEachRow',
  })
  const st = await sampleTokens.json<Array<{ token_id: string }>>()
  st.forEach((t, i) => {
    console.log('   ' + (i + 1) + '. ' + t.token_id)
  })

  // Sample tokens from gamma_markets
  console.log('\nSample token formats from gamma_markets (first 3):')
  const gmSample = await clickhouse.query({
    query: `SELECT tokens FROM gamma_markets WHERE length(tokens) > 0 LIMIT 3`,
    format: 'JSONEachRow',
  })
  const gms = await gmSample.json<Array<{ tokens: string[] }>>()
  gms.forEach((t, i) => {
    console.log('   ' + (i + 1) + '. ' + JSON.stringify(t.tokens))
  })
}

auditTokenMapping()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
