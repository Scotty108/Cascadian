#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad'

async function investigate() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('INVESTIGATING WALLET 4 MARKET COUNT EXPLOSION')
    console.log('=' .repeat(80))
    console.log(`Wallet: ${WALLET}`)
    console.log('=' .repeat(80))
    console.log('')

    // Check if this wallet exists in backup table
    const backupCheck = await client.query({
      query: `
        SELECT count() as market_count, sum(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_backup_20251111
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const backupData = await backupCheck.json<any[]>()
    console.log(`Baseline backup (pre-fix):`)
    console.log(`  Markets: ${backupData[0].market_count}`)
    console.log(`  P&L: $${parseFloat(backupData[0].total_pnl || '0').toLocaleString()}`)
    console.log('')

    // Check current table
    const currentCheck = await client.query({
      query: `
        SELECT count() as market_count, sum(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const currentData = await currentCheck.json<any[]>()
    console.log(`Current (post-fix):`)
    console.log(`  Markets: ${currentData[0].market_count}`)
    console.log(`  P&L: $${parseFloat(currentData[0].total_pnl || '0').toLocaleString()}`)
    console.log('')

    // Check if wallet actually exists in our source data
    const tradesCheck = await client.query({
      query: `
        SELECT count(DISTINCT condition_id_norm) as unique_conditions
        FROM trade_cashflows_v3
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const tradesData = await tradesCheck.json<any[]>()
    console.log(`Source data (trade_cashflows_v3):`)
    console.log(`  Unique condition IDs: ${tradesData[0].unique_conditions}`)
    console.log('')

    // Sample some markets for this wallet
    const sampleMarkets = await client.query({
      query: `
        SELECT condition_id_norm, realized_pnl_usd
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
        ORDER BY abs(realized_pnl_usd) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const markets = await sampleMarkets.json<any[]>()

    console.log(`Top 10 markets by absolute P&L:`)
    markets.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.condition_id_norm.substring(0, 16)}... : $${parseFloat(m.realized_pnl_usd).toLocaleString()}`)
    })
    console.log('')

    // Check if this wallet is actually a valid trader or system wallet
    console.log(`DIAGNOSIS:`)
    console.log(`-----------`)

    if (currentData[0].market_count > 1000) {
      console.log(`⚠️  This wallet has an unusually high market count (${currentData[0].market_count})`)
      console.log(`   This could indicate:`)
      console.log(`   1. Polymarket infrastructure wallet (relayer, market maker, etc.)`)
      console.log(`   2. Data quality issue (misattributed trades)`)
      console.log(`   3. Genuine high-frequency trader`)
      console.log('')
      console.log(`RECOMMENDATION: Remove from validation set if it's an infrastructure wallet`)
    } else {
      console.log(`✅ Market count looks reasonable`)
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

investigate()
