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
    send_progress_in_http_headers: 0
  }
})

async function main() {
  console.log('='.repeat(80))
  console.log('CID NORMALIZATION DIAGNOSTIC')
  console.log('='.repeat(80))

  // 1. Check CID format in fact_trades_clean
  console.log('\n[1/5] fact_trades_clean CID format analysis:')
  const factFormat = await client.query({
    query: `
      SELECT
        length(cid) as cid_length,
        substring(cid, 1, 2) as prefix,
        count() as count,
        any(cid) as sample_cid
      FROM fact_trades_clean
      GROUP BY cid_length, prefix
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const factFormatResult = await factFormat.json<{ cid_length: number; prefix: string; count: string; sample_cid: string }>()
  factFormatResult.forEach(row => {
    console.log(`  Length ${row.cid_length}, Prefix "${row.prefix}": ${parseInt(row.count).toLocaleString()} CIDs (sample: ${row.sample_cid.substring(0, 20)}...)`)
  })

  // 2. Check CID format in market_resolutions_final
  console.log('\n[2/5] market_resolutions_final CID format analysis:')
  const resFormat = await client.query({
    query: `
      SELECT
        length(condition_id_norm) as cid_length,
        substring(condition_id_norm, 1, 2) as prefix,
        count() as count,
        any(condition_id_norm) as sample_cid
      FROM market_resolutions_final
      WHERE condition_id_norm != ''
      GROUP BY cid_length, prefix
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const resFormatResult = await resFormat.json<{ cid_length: number; prefix: string; count: string; sample_cid: string }>()
  resFormatResult.forEach(row => {
    console.log(`  Length ${row.cid_length}, Prefix "${row.prefix}": ${parseInt(row.count).toLocaleString()} CIDs (sample: ${row.sample_cid.substring(0, 20)}...)`)
  })

  // 3. Top orphaned CIDs (in fact but not in resolutions)
  console.log('\n[3/5] Top 10 orphaned CIDs (in fact_trades_clean but NOT in resolutions):')
  const orphaned = await client.query({
    query: `
      WITH res_cids AS (
        SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid
        FROM market_resolutions_final
        WHERE condition_id_norm != ''
      )
      SELECT
        cid,
        count() as trade_count
      FROM fact_trades_clean
      WHERE cid NOT IN (SELECT cid FROM res_cids)
      GROUP BY cid
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const orphanedResult = await orphaned.json<{ cid: string; trade_count: string }>()
  orphanedResult.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.cid}: ${parseInt(row.trade_count).toLocaleString()} trades`)
  })

  // 4. Check if orphaned CIDs exist in market_resolutions_final with different normalization
  console.log('\n[4/5] Checking if orphaned CIDs exist in market_resolutions_final (non-normalized):')
  if (orphanedResult.length > 0) {
    const sampleOrphan = orphanedResult[0].cid
    const matchCheck = await client.query({
      query: `
        SELECT
          condition_id,
          condition_id_norm,
          market_id,
          question
        FROM market_resolutions_final
        WHERE
          lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('${sampleOrphan}', '0x', ''))
          OR lower(replaceAll(condition_id_norm, '0x', '')) = lower(replaceAll('${sampleOrphan}', '0x', ''))
          OR condition_id = '${sampleOrphan}'
          OR condition_id_norm = '${sampleOrphan}'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const matchResult = await matchCheck.json<any>()
    if (matchResult.length > 0) {
      console.log(`  ✅ Found matches for ${sampleOrphan}:`)
      matchResult.forEach((row: any) => {
        console.log(`    - condition_id: ${row.condition_id}`)
        console.log(`      condition_id_norm: ${row.condition_id_norm}`)
        console.log(`      market_id: ${row.market_id}`)
      })
    } else {
      console.log(`  ❌ No matches found for ${sampleOrphan} in market_resolutions_final`)
      console.log(`     This CID truly doesn't exist in resolutions (not a normalization issue)`)
    }
  }

  // 5. Check view definition used in Step 1
  console.log('\n[5/5] Comparing view normalization formula vs actual data:')
  const viewFormula = await client.query({
    query: `
      SELECT DISTINCT
        lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) as normalized_via_view
      FROM market_resolutions_final
      WHERE condition_id_norm != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const viewResult = await viewFormula.json<{ normalized_via_view: string }>()
  console.log('  Sample CIDs normalized via view formula:')
  viewResult.forEach((row, i) => {
    console.log(`    ${i + 1}. ${row.normalized_via_view} (length: ${row.normalized_via_view.length})`)
  })

  const directCids = await client.query({
    query: `
      SELECT DISTINCT cid
      FROM fact_trades_clean
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const directResult = await directCids.json<{ cid: string }>()
  console.log('  Sample CIDs from fact_trades_clean (direct):')
  directResult.forEach((row, i) => {
    console.log(`    ${i + 1}. ${row.cid} (length: ${row.cid.length})`)
  })

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('DIAGNOSTIC SUMMARY')
  console.log('='.repeat(80))
  console.log(`✓ Format comparison complete`)
  console.log(`✓ Orphan analysis complete`)
  console.log(`✓ Normalization validation complete`)
  console.log(`\nRecommendation: Review the format differences above.`)
  console.log(`If lengths or prefixes differ, CID normalization mismatch is confirmed.`)

  await client.close()
}

main().catch(console.error)
