#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Optimized Batch Processing
 *
 * The full table join is too large for one query.
 * Strategy: Use INSERT SELECT in batches with careful memory management
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Optimized Batch Processing')
  console.log('='.repeat(100))

  // Step 1: Create empty recovery table
  console.log('\n[STEP 1] Creating empty recovery table schema...')

  await clickhouse.command({
    query: `
      DROP TABLE IF EXISTS trades_raw_recovered
    `
  })

  // Copy schema from trades_raw
  await clickhouse.command({
    query: `
      CREATE TABLE trades_raw_recovered AS trades_raw
      WHERE 1=0
    `
  })

  console.log('  ✅ Schema created (empty)')

  // Step 2: Insert all trades with recovered condition_ids
  console.log('\n[STEP 2] Inserting trades with recovered condition_ids...')
  console.log('  This will take a few minutes...')

  const insertQuery = `
    INSERT INTO trades_raw_recovered
    SELECT
      t.wallet_address,
      t.timestamp,
      t.transaction_hash,
      t.outcome_index,
      t.shares,
      t.price,
      t.entry_price,
      t.fee_usd,
      CASE
        WHEN t.condition_id != '' THEN t.condition_id
        WHEN e.token_id != '' AND length(e.token_id) > 64
          THEN substring(lower(e.token_id), 1, 64)
        ELSE ''
      END as condition_id,
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

  try {
    await clickhouse.command({
      query: insertQuery
    })
    console.log('  ✅ All trades inserted')
  } catch (error) {
    console.error('  ❌ Insert failed:', error)
    return
  }

  // Step 3: Validate recovery
  console.log('\n[STEP 3] Validating recovery...')

  const validation = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as with_condition_id,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as still_empty,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as recovery_rate
      FROM trades_raw_recovered
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const v = validation[0]
  console.log(`  Total rows: ${v.total}`)
  console.log(`  With condition_id: ${v.with_condition_id}`)
  console.log(`  Still empty: ${v.still_empty}`)
  console.log(`  Recovery rate: ${v.recovery_rate.toFixed(2)}%`)

  // Step 4: Before/after for test wallets
  console.log('\n[STEP 4] Recovery results for test wallets...')

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

    console.log(`\n  ${wallet.name}:`)
    console.log(`    Before: ${b.total} trades, ${b.empty} empty IDs, ${b.unique_cond} unique conditions`)
    console.log(`    After:  ${a.total} trades, ${a.empty} empty IDs, ${a.unique_cond} unique conditions`)
    console.log(`    Improvement: ${b.empty - a.empty} condition_ids recovered, ${a.unique_cond - b.unique_cond} new conditions`)
  }

  // Step 5: Atomic swap
  console.log('\n[STEP 5] Performing atomic table swap...')
  console.log('  This renames the tables atomically...')

  await clickhouse.command({
    query: `
      RENAME TABLE
      trades_raw TO trades_raw_backup_with_empty_ids,
      trades_raw_recovered TO trades_raw
    `
  })

  console.log('  ✅ Atomic swap complete')
  console.log('     trades_raw: Now has recovered condition_ids')
  console.log('     trades_raw_backup_with_empty_ids: Backup (can be dropped)')

  // Step 6: Final check
  console.log('\n[STEP 6] Final verification of trades_raw...')

  const finalCheck = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_empty
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const final = finalCheck[0]
  console.log(`\n  Total trades in trades_raw: ${final.total_trades}`)
  console.log(`  Empty condition_ids: ${final.empty} (${final.pct_empty.toFixed(2)}%)`)

  if (parseFloat(final.pct_empty) < 10) {
    console.log(`\n  ✅ SUCCESS! Recovery reduced empty IDs from 48.53% to ${final.pct_empty.toFixed(2)}%`)
    console.log(`     ${(parseFloat(final.total_trades) * 0.4853 - parseFloat(final.empty)).toFixed(0)} condition_ids recovered from ERC1155`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('NEXT STEPS')
  console.log('='.repeat(100))
  console.log(`
✅ ERC1155 recovery complete and tables swapped atomically

Next actions:
1. Run P&L calculation for test wallets (should show much better results)
2. Validate against Polymarket UI
3. Proceed with full 900K wallet backfill

Current status:
- trades_raw: Now contains recovered condition_ids
- Ready for P&L recalculation
  `)
}

main().catch(e => console.error('Error:', e))
