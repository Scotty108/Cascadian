#!/usr/bin/env npx tsx
/**
 * CHECK TRADES_DEDUP
 * Check if phantom condition exists in trades_dedup for target wallet
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'
const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'

async function checkTradesDedup() {
  const client = getClickHouseClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('CHECKING trades_dedup FOR PHANTOM')
    console.log('='.repeat(80))
    console.log(`\nTarget wallet: ${TARGET_WALLET}`)
    console.log(`Phantom condition: ${PHANTOM_CONDITION}\n`)

    // Check if phantom exists in trades_dedup for target wallet
    const result = await client.query({
      query: `
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          side,
          entry_price,
          shares,
          timestamp
        FROM trades_dedup
        WHERE lower(replaceAll(condition_id, '0x', '')) = '${PHANTOM_CONDITION}'
          AND lower(wallet_address) = lower('${TARGET_WALLET}')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const trades = await result.json<any[]>()

    console.log(`Rows in trades_dedup: ${trades.length}\n`)

    if (trades.length === 0) {
      console.log('✅ trades_dedup is CLEAN - no phantom trades')
      console.log('   This means the issue is in a JOIN or VIEW logic ABOVE trades_dedup\n')
    } else {
      console.log('❌ PHANTOM FOUND IN trades_dedup!')
      console.log('   This table claims wallet traded this market, but vw_clob_fills_enriched says NO\n')

      console.log('Sample phantom trades:\n')
      trades.slice(0, 5).forEach((t: any, idx: number) => {
        console.log(`${idx + 1}. Side: ${t.side}, Price: ${t.entry_price}, Shares: ${t.shares}`)
        console.log(`   Timestamp: ${t.timestamp}\n`)
      })

      console.log('🔍 HYPOTHESIS: trades_dedup was built from wrong source or has bad dedupe logic\n')
    }

    // Check how trades_dedup is structured
    console.log('Checking trades_dedup table structure...\n')

    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE trades_dedup',
      format: 'JSONEachRow'
    })
    const schema = await schemaResult.json<any[]>()

    console.log('trades_dedup schema:')
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type}`)
    })
    console.log('')

    // Check if trades_dedup is a table or view
    const typeResult = await client.query({
      query: `
        SELECT engine, create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trades_dedup'
      `,
      format: 'JSONEachRow'
    })
    const typeInfo = await typeResult.json<any[]>()

    if (typeInfo.length > 0) {
      console.log('Table engine:', typeInfo[0].engine)

      if (typeInfo[0].engine.includes('View')) {
        console.log('\ntrades_dedup is a VIEW')
        console.log('\n' + '='.repeat(80))
        console.log('VIEW DEFINITION')
        console.log('='.repeat(80) + '\n')
        console.log(typeInfo[0].create_table_query)
        console.log('')
      } else {
        console.log('\ntrades_dedup is a MATERIALIZED TABLE')
        console.log('Need to find the script that populated it\n')
      }
    }

    // Check total rows for comparison
    const totalResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet_address) as unique_wallets,
          uniq(condition_id) as unique_markets
        FROM trades_dedup
      `,
      format: 'JSONEachRow'
    })
    const totals = await totalResult.json<any[]>()

    console.log('trades_dedup summary:')
    console.log(`  Total rows: ${parseInt(totals[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(totals[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique markets: ${parseInt(totals[0].unique_markets).toLocaleString()}\n`)

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

checkTradesDedup()
