#!/usr/bin/env npx tsx
/**
 * VERIFY WALLETS EXIST
 * Check if the problematic wallets actually exist in production table
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const TEST_WALLETS = [
  '0x7f3c8979e6a0eb28b951dc948bf2969dcdcea24a',
  '0x1489046c1db6d67d2f90886fb91b189165f5c67b',
  '0x8e9eedf26a13a6e20ccf73acfb41fe37d69b0e7e',
  '0xeb6f0a13e67d8452271c195f5ce58f8eb9b3c58c' // Magnitude test wallet
]

async function verifyWalletsExist() {
  const client = getClickHouseClient()

  try {
    console.log('\n🔍 VERIFYING WALLET EXISTENCE\n')

    // Check what columns exist in realized_pnl_by_market_final
    console.log('1️⃣  Table schema:')
    const schemaResult = await client.query({
      query: `DESCRIBE TABLE realized_pnl_by_market_final`,
      format: 'JSONEachRow'
    })
    const schema = await schemaResult.json<any>()

    schema.forEach((col: any) => {
      console.log(`   ${col.name}: ${col.type}`)
    })

    // Check wallet field variations
    const walletField = schema.find((c: any) =>
      c.name.toLowerCase().includes('wallet') || c.name.toLowerCase().includes('user')
    )

    console.log(`\n2️⃣  Wallet field detected: ${walletField?.name || 'NONE FOUND!'}\n`)

    if (!walletField) {
      console.log('❌ No wallet/user field found in schema!')
      return
    }

    // Check total rows in table
    const totalResult = await client.query({
      query: `SELECT COUNT(*) as total, uniq(${walletField.name}) as unique_wallets FROM realized_pnl_by_market_final`,
      format: 'JSONEachRow'
    })
    const total = await totalResult.json<any>()

    console.log(`3️⃣  Table status:`)
    console.log(`   Total rows: ${parseInt(total[0].total).toLocaleString()}`)
    console.log(`   Unique wallets: ${parseInt(total[0].unique_wallets).toLocaleString()}\n`)

    // Sample 10 random wallets
    console.log(`4️⃣  Sample wallets in table:`)
    const sampleResult = await client.query({
      query: `SELECT DISTINCT ${walletField.name} FROM realized_pnl_by_market_final LIMIT 10`,
      format: 'JSONEachRow'
    })
    const sample = await sampleResult.json<any>()

    sample.forEach((row: any, idx: number) => {
      console.log(`   ${idx + 1}. ${row[walletField.name]}`)
    })

    // Check each test wallet
    console.log(`\n5️⃣  Test wallet existence:\n`)

    for (const wallet of TEST_WALLETS) {
      const checkResult = await client.query({
        query: `
          SELECT
            COUNT(*) as row_count,
            SUM(realized_pnl_usd) as total_pnl
          FROM realized_pnl_by_market_final
          WHERE lower(${walletField.name}) = lower('${wallet}')
        `,
        format: 'JSONEachRow'
      })
      const check = await checkResult.json<any>()

      const exists = parseInt(check[0].row_count) > 0
      const symbol = exists ? '✅' : '❌'

      console.log(`   ${symbol} ${wallet}`)
      if (exists) {
        console.log(`      Rows: ${parseInt(check[0].row_count).toLocaleString()}`)
        console.log(`      P&L: $${(parseFloat(check[0].total_pnl) / 1000).toFixed(1)}K`)
      } else {
        console.log(`      NOT FOUND in table`)
      }
    }

    // Check if wallets exist with different casing
    console.log(`\n6️⃣  Case-sensitive search:\n`)

    for (const wallet of TEST_WALLETS.slice(0, 2)) { // Just check first 2
      const variations = [
        wallet.toLowerCase(),
        wallet.toUpperCase(),
        wallet // Original casing
      ]

      for (const v of variations) {
        const checkResult = await client.query({
          query: `
            SELECT COUNT(*) as count
            FROM realized_pnl_by_market_final
            WHERE ${walletField.name} = '${v}'
          `,
          format: 'JSONEachRow'
        })
        const check = await checkResult.json<any>()

        if (parseInt(check[0].count) > 0) {
          console.log(`   ✅ Found with casing: ${v}`)
        }
      }
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

verifyWalletsExist()
