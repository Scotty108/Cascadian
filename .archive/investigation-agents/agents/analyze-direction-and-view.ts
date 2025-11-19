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

async function analyze() {
  console.log('═'.repeat(70))
  console.log('ANALYZING: trade_direction_assignments & vw_trades_canonical')
  console.log('═'.repeat(70))
  console.log()

  // trade_direction_assignments
  console.log('1. trade_direction_assignments (130M rows)')
  console.log('-'.repeat(70))

  const dir1 = await ch.query({
    query: `
      SELECT
        count() as total,
        countDistinct(wallet_address) as unique_wallets,
        countDistinct(tx_hash) as unique_txs,
        countIf(condition_id_norm != '') as with_condition_id_norm,
        countIf(direction = 'BUY') as buy_trades,
        countIf(direction = 'SELL') as sell_trades,
        countIf(direction = 'UNKNOWN') as unknown_direction,
        countIf(confidence = 'HIGH') as high_confidence,
        countIf(confidence = 'MEDIUM') as medium_confidence,
        countIf(confidence = 'LOW') as low_confidence
      FROM trade_direction_assignments
    `,
    format: 'JSONEachRow'
  })
  const d1 = (await dir1.json())[0]
  console.log(`  Total rows: ${Number(d1.total).toLocaleString()}`)
  console.log(`  Unique wallets: ${Number(d1.unique_wallets).toLocaleString()}`)
  console.log(`  Unique tx_hash: ${Number(d1.unique_txs).toLocaleString()}`)
  console.log(`  With condition_id_norm: ${Number(d1.with_condition_id_norm).toLocaleString()} (${(Number(d1.with_condition_id_norm)/Number(d1.total)*100).toFixed(1)}%)`)
  console.log()
  console.log(`  Direction breakdown:`)
  console.log(`    BUY: ${Number(d1.buy_trades).toLocaleString()}`)
  console.log(`    SELL: ${Number(d1.sell_trades).toLocaleString()}`)
  console.log(`    UNKNOWN: ${Number(d1.unknown_direction).toLocaleString()}`)
  console.log()
  console.log(`  Confidence breakdown:`)
  console.log(`    HIGH: ${Number(d1.high_confidence).toLocaleString()}`)
  console.log(`    MEDIUM: ${Number(d1.medium_confidence).toLocaleString()}`)
  console.log(`    LOW: ${Number(d1.low_confidence).toLocaleString()}`)
  console.log()

  // Sample
  const sample = await ch.query({
    query: `SELECT * FROM trade_direction_assignments LIMIT 3`,
    format: 'JSONEachRow'
  })
  const sampleData = await sample.json()
  console.log('Sample rows:')
  sampleData.forEach((row: any, i: number) => {
    console.log(`\n  Row ${i + 1}:`)
    console.log(`    tx_hash: ${row.tx_hash}`)
    console.log(`    wallet: ${row.wallet_address}`)
    console.log(`    condition_id_norm: ${row.condition_id_norm}`)
    console.log(`    direction: ${row.direction}`)
    console.log(`    confidence: ${row.confidence}`)
    console.log(`    usdc_in: ${row.usdc_in}, usdc_out: ${row.usdc_out}`)
    console.log(`    tokens_in: ${row.tokens_in}, tokens_out: ${row.tokens_out}`)
  })
  console.log()

  // vw_trades_canonical
  console.log('2. vw_trades_canonical (view)')
  console.log('-'.repeat(70))

  try {
    // First get the schema
    const viewSchema = await ch.query({
      query: `DESCRIBE TABLE vw_trades_canonical`,
      format: 'JSONEachRow'
    })
    const schema = await viewSchema.json()
    console.log('Schema:')
    schema.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`)
    })
    console.log()

    // Try to get stats
    const viewStats = await ch.query({
      query: `SELECT count() as total FROM vw_trades_canonical`,
      format: 'JSONEachRow'
    })
    const vs = (await viewStats.json())[0]
    console.log(`Total rows: ${Number(vs.total).toLocaleString()}`)
    console.log()

  } catch (e: any) {
    console.log(`Error: ${e.message}`)
    console.log()
  }

  console.log('═'.repeat(70))
  console.log('RECOMMENDATION')
  console.log('═'.repeat(70))
  console.log()

  const dirCoverage = Number(d1.with_condition_id_norm) / Number(d1.total) * 100
  if (dirCoverage >= 90) {
    console.log(`✅ trade_direction_assignments has ${dirCoverage.toFixed(1)}% condition_id coverage`)
    console.log('   Consider using this as primary table (130M vs 82M in trades_with_direction)')
  } else if (dirCoverage >= 50) {
    console.log(`⚠️  trade_direction_assignments has ${dirCoverage.toFixed(1)}% condition_id coverage`)
    console.log('   Could be enriched to match trades_with_direction quality')
  } else {
    console.log(`❌ trade_direction_assignments has low coverage (${dirCoverage.toFixed(1)}%)`)
    console.log('   Stick with trades_with_direction (82M, 100% coverage)')
  }
  console.log()
}

analyze().catch(console.error)
