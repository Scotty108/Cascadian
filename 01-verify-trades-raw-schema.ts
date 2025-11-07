#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('STEP 1: Verify trades_raw Schema')
  console.log('='.repeat(100))

  try {
    // Get schema
    console.log('\n[1] Checking trades_raw table structure...')
    const schema = await (await clickhouse.query({
      query: `
        SELECT
          name,
          type,
          default_expression,
          comment
        FROM system.columns
        WHERE table = 'trades_raw' AND database = 'default'
        ORDER BY position
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nFound ${schema.length} columns:\n`)
    schema.forEach((col, i) => {
      console.log(`${i + 1}. ${col.name.padEnd(30)} : ${col.type}`)
    })

    // Get sample row
    console.log('\n[2] Sample row from trades_raw...')
    const sample = await (await clickhouse.query({
      query: `
        SELECT *
        FROM trades_raw
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (sample.length > 0) {
      const row = sample[0]
      console.log('\nSample row keys:', Object.keys(row).join(', '))

      // Look for P&L related columns
      const pnlRelated = Object.keys(row).filter(k =>
        k.toLowerCase().includes('pnl') ||
        k.toLowerCase().includes('cost') ||
        k.toLowerCase().includes('proceeds') ||
        k.toLowerCase().includes('fee') ||
        k.toLowerCase().includes('price') ||
        k.toLowerCase().includes('usdc') ||
        k.toLowerCase().includes('outcome') ||
        k.toLowerCase().includes('shares') ||
        k.toLowerCase().includes('delta')
      )
      console.log('\nP&L-related columns found:', pnlRelated.join(', '))
    }

    // Get row counts and basic stats
    console.log('\n[3] Row count statistics...')
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(is_resolved = 1) as resolved_rows,
          countIf(is_resolved = 0) as unresolved_rows,
          uniqExact(wallet_address) as unique_wallets,
          uniqExact(market_id) as unique_markets
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    console.log(`Total rows: ${s.total_rows}`)
    console.log(`Resolved rows: ${s.resolved_rows}`)
    console.log(`Unresolved rows: ${s.unresolved_rows}`)
    console.log(`Unique wallets: ${s.unique_wallets}`)
    console.log(`Unique markets: ${s.unique_markets}`)

    // Check for our test wallet
    console.log('\n[4] Test wallet coverage...')
    const testWallets = [
      '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
      '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
      '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
    ]

    for (const wallet of testWallets) {
      const count = await (await clickhouse.query({
        query: `
          SELECT countIf(lower(wallet_address) = '${wallet.toLowerCase()}' AND is_resolved = 1) as resolved_count
          FROM trades_raw
        `,
        format: 'JSONEachRow'
      })).json() as any[]
      console.log(`${wallet.substring(0, 10)}... : ${count[0].resolved_count} resolved trades`)
    }

    console.log('\n' + '='.repeat(100))
    console.log('SCHEMA VERIFICATION COMPLETE')
    console.log('='.repeat(100))

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
