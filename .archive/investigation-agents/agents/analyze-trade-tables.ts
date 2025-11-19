#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

async function analyzeTradeTables() {
  console.log('═'.repeat(70))
  console.log('ANALYZING TRADE TABLES')
  console.log('═'.repeat(70))
  console.log()

  // Check trades_with_direction
  console.log('TABLE: trades_with_direction')
  console.log('-'.repeat(70))

  try {
    const schema1 = await q('DESCRIBE TABLE trades_with_direction')
    console.log('Schema:')
    schema1.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`)
    })
    console.log()

    const stats1 = await q(`
      SELECT
        COUNT(*) as total_rows,
        COUNT(CASE WHEN tx_hash != '' AND tx_hash IS NOT NULL THEN 1 END) as with_tx_hash,
        COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
        COUNT(CASE WHEN market_id != '' AND market_id IS NOT NULL AND market_id != '12' THEN 1 END) as with_valid_market_id,
        COUNT(CASE WHEN market_id = '12' THEN 1 END) as market_id_is_12,
        COUNT(CASE WHEN market_id = '' OR market_id IS NULL THEN 1 END) as missing_market_id
      FROM trades_with_direction
    `)
    console.log('Statistics:')
    console.log(`  Total rows: ${Number(stats1[0].total_rows).toLocaleString()}`)
    console.log(`  With tx_hash: ${Number(stats1[0].with_tx_hash).toLocaleString()}`)
    console.log(`  With condition_id: ${Number(stats1[0].with_condition_id).toLocaleString()}`)
    console.log(`  With valid market_id: ${Number(stats1[0].with_valid_market_id).toLocaleString()}`)
    console.log(`  market_id = '12': ${Number(stats1[0].market_id_is_12).toLocaleString()}`)
    console.log(`  Missing market_id: ${Number(stats1[0].missing_market_id).toLocaleString()}`)
    console.log()

    const sample1 = await q(`SELECT * FROM trades_with_direction LIMIT 3`)
    console.log('Sample rows:')
    sample1.forEach((row: any, i: number) => {
      console.log(`\n  Row ${i + 1}:`)
      Object.keys(row).slice(0, 8).forEach(key => {
        console.log(`    ${key}: ${row[key]}`)
      })
    })
    console.log()
  } catch (e: any) {
    console.log(`  ❌ Table does not exist or error: ${e.message}`)
    console.log()
  }

  // Check trades_dedup_mat_new
  console.log('TABLE: trades_dedup_mat_new')
  console.log('-'.repeat(70))

  try {
    const schema2 = await q('DESCRIBE TABLE trades_dedup_mat_new')
    console.log('Schema:')
    schema2.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`)
    })
    console.log()

    const stats2 = await q(`
      SELECT
        COUNT(*) as total_rows,
        COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
        COUNT(CASE WHEN market_id != '' AND market_id IS NOT NULL THEN 1 END) as with_market_id
      FROM trades_dedup_mat_new
    `)
    console.log('Statistics:')
    console.log(`  Total rows: ${Number(stats2[0].total_rows).toLocaleString()}`)
    console.log(`  With condition_id: ${Number(stats2[0].with_condition_id).toLocaleString()}`)
    console.log(`  With market_id: ${Number(stats2[0].with_market_id).toLocaleString()}`)
    console.log()

    const sample2 = await q(`SELECT * FROM trades_dedup_mat_new LIMIT 3`)
    console.log('Sample rows:')
    sample2.forEach((row: any, i: number) => {
      console.log(`\n  Row ${i + 1}:`)
      Object.keys(row).slice(0, 8).forEach(key => {
        console.log(`    ${key}: ${row[key]}`)
      })
    })
    console.log()
  } catch (e: any) {
    console.log(`  ❌ Table does not exist or error: ${e.message}`)
    console.log()
  }

  // Check trades_raw for comparison
  console.log('TABLE: trades_raw (for comparison)')
  console.log('-'.repeat(70))

  const statsRaw = await q(`
    SELECT
      COUNT(*) as total_rows,
      COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
      COUNT(CASE WHEN market_id != '' AND market_id IS NOT NULL THEN 1 END) as with_market_id
    FROM trades_raw
  `)
  console.log('Statistics:')
  console.log(`  Total rows: ${Number(statsRaw[0].total_rows).toLocaleString()}`)
  console.log(`  With condition_id: ${Number(statsRaw[0].with_condition_id).toLocaleString()}`)
  console.log(`  With market_id: ${Number(statsRaw[0].with_market_id).toLocaleString()}`)
  console.log()

  console.log('═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))
  console.log()
  console.log('Next steps:')
  console.log('1. Find the script that created trades_with_direction')
  console.log('2. Check if it can enrich the remaining rows')
  console.log('3. Compare with trades_dedup_mat_new to see which is more complete')
  console.log()
}

analyzeTradeTables().catch(console.error)
