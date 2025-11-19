#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  clickhouse_settings: {
    send_progress_in_http_headers: 0  // Disable progress headers
  }
})

async function main() {
  console.log('Gate B Quick Check')
  console.log('='.repeat(60))

  const gateBResult = await client.query({
    query: `
      WITH res AS (
        SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid
        FROM market_resolutions_final
        WHERE condition_id_norm != ''
      ),
      fact AS (
        SELECT DISTINCT cid FROM fact_trades_clean
      )
      SELECT
        (SELECT count() FROM res) AS res_cids,
        (SELECT count() FROM fact) AS fact_cids,
        (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact)) AS overlap_cids,
        round(100.0 * overlap_cids / nullIf(res_cids, 0), 2) AS pct_res_covered_by_fact
      FROM res
      LIMIT 1
    `,
    format: 'JSONEachRow'
  })

  const gateB = await gateBResult.json<{
    res_cids: string
    fact_cids: string
    overlap_cids: string
    pct_res_covered_by_fact: string
  }>()

  const gateBPct = parseFloat(gateB[0].pct_res_covered_by_fact)
  const gateBPassed = gateBPct >= 85.0

  console.log(`Total resolution CIDs:     ${parseInt(gateB[0].res_cids).toLocaleString()}`)
  console.log(`CIDs in fact_trades_clean: ${parseInt(gateB[0].fact_cids).toLocaleString()}`)
  console.log(`Resolution CIDs covered:   ${parseInt(gateB[0].overlap_cids).toLocaleString()}`)
  console.log(`Gate B Coverage:           ${gateBPct.toFixed(2)}%`)
  console.log(`Gate B Status:             ${gateBPassed ? '✅ PASSED' : '❌ FAILED'} (≥85% required)`)

  await client.close()
}

main().catch(console.error)
