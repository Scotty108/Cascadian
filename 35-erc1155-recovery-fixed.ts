#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Fixed Implementation
 *
 * Corrected ClickHouse syntax and optimized for large join
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Creating Recovered Table')
  console.log('='.repeat(100))

  // Step 1: Drop if exists
  console.log('\n[STEP 1] Cleaning up...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS trades_raw_recovered`
  })

  console.log('  ✅ Dropped old recovery table')

  // Step 2: Create table from query (correct ClickHouse syntax)
  console.log('\n[STEP 2] Creating trades_raw_recovered with recovered condition_ids...')
  console.log('  This will take 5-10 minutes...')

  try {
    await clickhouse.command({
      query: `
        CREATE TABLE trades_raw_recovered ENGINE = MergeTree()
        ORDER BY (wallet_address, timestamp)
        AS
        SELECT
          t.wallet_address,
          t.timestamp,
          t.transaction_hash,
          t.outcome_index,
          t.shares,
          t.price,
          t.entry_price,
          t.fee_usd,
          COALESCE(
            NULLIF(t.condition_id, ''),
            IF(
              length(e.token_id) > 64,
              substring(lower(e.token_id), 1, 64),
              ''
            )
          ) as condition_id,
          t.side,
          t.market_hash,
          t.is_resolved
        FROM trades_raw t
        LEFT JOIN erc1155_transfers e ON
          t.transaction_hash = e.tx_hash
          AND (
            lower(t.wallet_address) = lower(e.from_address)
            OR lower(t.wallet_address) = lower(e.to_address)
          )
      `
    })
    console.log('  ✅ Table created successfully')
  } catch (error) {
    console.error('  ❌ Error creating table:', error)
    return
  }

  // Step 3: Validate
  console.log('\n[STEP 3] Validating recovery...')

  const validation = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as with_id,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
      FROM trades_raw_recovered
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const v = validation[0]
  console.log(`  Total rows: ${v.total}`)
  console.log(`  With condition_id: ${v.with_id}`)
  console.log(`  Empty: ${v.empty} (${(v.empty * 100 / v.total).toFixed(2)}%)`)

  // Step 4: Check test wallets
  console.log('\n[STEP 4] Results for test wallets...')

  const testWallets = [
    { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', name: 'Wallet 1' },
    { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2' },
    { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
    { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4' },
  ]

  for (const wallet of testWallets) {
    const before = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty,
          COUNT(DISTINCT condition_id) as unique_cond
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const after = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty,
          COUNT(DISTINCT condition_id) as unique_cond
        FROM trades_raw_recovered
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const b = before[0]
    const a = after[0]

    const recovered = b.empty - a.empty
    const improvement = recovered > 0 ? `✅ ${recovered} recovered` : '✓ No change'

    console.log(`\n  ${wallet.name}:`)
    console.log(`    Before: ${b.total} trades, ${b.empty} empty, ${b.unique_cond} unique conditions`)
    console.log(`    After:  ${a.total} trades, ${a.empty} empty, ${a.unique_cond} unique conditions`)
    console.log(`    ${improvement}`)
  }

  // Step 5: Atomic swap
  console.log('\n[STEP 5] Performing atomic table swap...')

  await clickhouse.command({
    query: `
      RENAME TABLE
      trades_raw TO trades_raw_before_recovery,
      trades_raw_recovered TO trades_raw
    `
  })

  console.log('  ✅ Atomic swap complete')

  // Step 6: Verify
  console.log('\n[STEP 6] Final verification...')

  const finalCheck = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_empty
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const final = finalCheck[0]
  console.log(`  Total trades: ${final.total}`)
  console.log(`  Empty condition_ids: ${final.empty} (${final.pct_empty.toFixed(2)}%)`)

  if (parseFloat(final.pct_empty) < 5) {
    console.log(`\n  ✅ SUCCESS!`)
    console.log(`     Empty IDs reduced from 48.53% to ${final.pct_empty.toFixed(2)}%`)
    console.log(`     Recovered ~${(77435673 - parseInt(final.empty)).toLocaleString()} condition_ids`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('READY FOR P&L RECALCULATION')
  console.log('='.repeat(100))
  console.log(`
✅ ERC1155 recovery complete
✅ Table swapped atomically
✅ Backup available: trades_raw_before_recovery

Next: Run P&L calculation for test wallets to verify recovery worked correctly.
  `)
}

main().catch(e => console.error('Error:', e))
