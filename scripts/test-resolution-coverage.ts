#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

async function main() {
  console.log('Testing which resolution table provides best coverage...\n')
  
  // Test market_resolutions_final
  const mrf = await client.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
      )
      SELECT count() as match_count
      FROM traded t
      INNER JOIN market_resolutions_final r
        ON t.cid_norm = lower(replaceAll(r.condition_id_norm, '0x', ''))
    `,
    format: 'JSONEachRow'
  })
  const mrfCount = Number((await mrf.json<any>())[0].match_count)
  const mrfPct = (mrfCount / 204680 * 100).toFixed(2)
  console.log(`market_resolutions_final: ${mrfCount.toLocaleString()} (${mrfPct}%)`)
  
  // Test resolution_candidates
  const rc = await client.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
      )
      SELECT count() as match_count
      FROM traded t
      INNER JOIN resolution_candidates r
        ON t.cid_norm = lower(replaceAll(r.condition_id_norm, '0x', ''))
    `,
    format: 'JSONEachRow'
  })
  const rcCount = Number((await rc.json<any>())[0].match_count)
  const rcPct = (rcCount / 204680 * 100).toFixed(2)
  console.log(`resolution_candidates: ${rcCount.toLocaleString()} (${rcPct}%)`)
  
  // Test resolutions_external_ingest
  const rei = await client.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
      )
      SELECT count() as match_count
      FROM traded t
      INNER JOIN resolutions_external_ingest r
        ON t.cid_norm = lower(replaceAll(r.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow'
  })
  const reiCount = Number((await rei.json<any>())[0].match_count)
  const reiPct = (reiCount / 204680 * 100).toFixed(2)
  console.log(`resolutions_external_ingest: ${reiCount.toLocaleString()} (${reiPct}%)`)
  
  console.log(`\n✅ Best table: ${mrfCount > rcCount && mrfCount > reiCount ? 'market_resolutions_final' : rcCount > reiCount ? 'resolution_candidates' : 'resolutions_external_ingest'}`)
  
  await client.close()
}

main().catch(console.error)
