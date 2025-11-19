#!/usr/bin/env npx tsx

/**
 * SHADOW_V1 DIAGNOSTIC
 * Check data flow through views
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('SHADOW_V1 DIAGNOSTIC - Checking Data Flow')
  console.log('='.repeat(100))

  try {
    const testWallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

    // Check 1: Is data in trade_flows_v2?
    console.log('\n[1] Checking trade_flows_v2 for test wallet...')
    const flows = await (await clickhouse.query({
      query: `
        SELECT count() as row_count,
               min(wallet) as min_wallet,
               max(wallet) as max_wallet,
               countIf(lower(wallet) = '${testWallet.toLowerCase()}') as test_wallet_rows
        FROM trade_flows_v2
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Total rows: ${flows[0].row_count}`)
    console.log(`   Test wallet rows: ${flows[0].test_wallet_rows}`)
    console.log(`   Sample wallet: ${flows[0].min_wallet}`)

    // Check 2: Is data in flows_by_market?
    console.log('\n[2] Checking shadow_v1.flows_by_market...')
    const flowsByMarket = await (await clickhouse.query({
      query: `
        SELECT count() as row_count,
               countIf(wallet = '${testWallet.toLowerCase()}') as test_wallet_rows
        FROM shadow_v1.flows_by_market
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Total rows: ${flowsByMarket[0].row_count}`)
    console.log(`   Test wallet rows: ${flowsByMarket[0].test_wallet_rows}`)

    // Check 3: Is data in flows_by_condition?
    console.log('\n[3] Checking shadow_v1.flows_by_condition...')
    const flowsByCondition = await (await clickhouse.query({
      query: `
        SELECT count() as row_count,
               countIf(wallet = '${testWallet.toLowerCase()}') as test_wallet_rows,
               uniqExact(condition_id_norm) as unique_conditions
        FROM shadow_v1.flows_by_condition
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Total rows: ${flowsByCondition[0].row_count}`)
    console.log(`   Test wallet rows: ${flowsByCondition[0].test_wallet_rows}`)
    console.log(`   Unique conditions: ${flowsByCondition[0].unique_conditions}`)

    // Check 4: Is data in winners?
    console.log('\n[4] Checking shadow_v1.winners...')
    const winners = await (await clickhouse.query({
      query: `
        SELECT count() as condition_count,
               min(condition_id_norm) as sample_condition
        FROM shadow_v1.winners
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Resolved conditions: ${winners[0].condition_count}`)
    console.log(`   Sample: ${winners[0].sample_condition}`)

    // Check 5: Sample data from flows_by_condition for test wallet
    console.log(`\n[5] Sample data from flows_by_condition for test wallet...`)
    const sample = await (await clickhouse.query({
      query: `
        SELECT wallet, condition_id_norm, cash_usd
        FROM shadow_v1.flows_by_condition
        WHERE wallet = '${testWallet.toLowerCase()}'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    if (sample.length > 0) {
      console.log(`   Found ${sample.length} rows`)
      sample.forEach((row, i) => {
        console.log(`   [${i}] wallet=${row.wallet}, condition=${row.condition_id_norm}, cash=$${row.cash_usd}`)
      })
    } else {
      console.log(`   No data found for this wallet`)
    }

    // Check 6: Is the condition mapping working?
    console.log('\n[6] Checking canonical_condition_uniq...')
    const mapping = await (await clickhouse.query({
      query: `
        SELECT count() as market_count,
               uniqExact(condition_id_norm) as unique_conditions
        FROM shadow_v1.canonical_condition_uniq
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Markets: ${mapping[0].market_count}`)
    console.log(`   Conditions: ${mapping[0].unique_conditions}`)

    console.log('\n' + '='.repeat(100))

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
