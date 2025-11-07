#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Restore Missing condition_ids
 *
 * Problem: 77.4M trades have EMPTY condition_id (48.53% of all trades!)
 * Solution: Extract condition_id from erc1155_transfers table using tx_hash matching
 *
 * Polymarket token_id encoding:
 * - token_id = (condition_id << 8) | outcome_index
 * - Extract: substring(token_id, 1, 64).toLowerCase()
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Restore Missing condition_ids')
  console.log('='.repeat(100))

  // Step 1: Verify we have erc1155_transfers data
  console.log('\n[STEP 1] Verifying erc1155_transfers data...')

  const erc1155Check = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT tx_hash) as unique_tx_hashes,
        COUNT(DISTINCT token_id) as unique_token_ids
      FROM erc1155_transfers
      WHERE token_id != '' AND token_id != '0'
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const erc = erc1155Check[0]
  console.log(`  ✅ erc1155_transfers available`)
  console.log(`     Total rows: ${erc.total_rows}`)
  console.log(`     Unique tx_hashes: ${erc.unique_tx_hashes}`)
  console.log(`     Unique token_ids: ${erc.unique_token_ids}`)

  // Step 2: Create recovery table
  console.log('\n[STEP 2] Creating recovery table with ERC1155 condition_id extraction...')

  await clickhouse.command({
    query: `
      DROP TABLE IF EXISTS trades_raw_recovered
    `
  })

  console.log('  Creating trades_raw_recovered...')

  const recoveryQuery = `
    CREATE TABLE trades_raw_recovered
    ENGINE = MergeTree()
    ORDER BY (wallet_address, timestamp)
    AS
    SELECT
      t.*,
      CASE
        WHEN t.condition_id != '' THEN t.condition_id
        WHEN e.token_id != '' AND length(e.token_id) > 64
          THEN substring(lower(e.token_id), 1, 64)
        ELSE ''
      END as condition_id_recovered
    FROM trades_raw t
    LEFT JOIN erc1155_transfers e ON
      t.transaction_hash = e.tx_hash
      AND (
        lower(t.wallet_address) = lower(e.from_address)
        OR lower(t.wallet_address) = lower(e.to_address)
      )
  `

  await clickhouse.command({
    query: recoveryQuery
  })

  console.log('  ✅ trades_raw_recovered created')

  // Step 3: Validate recovery results
  console.log('\n[STEP 3] Validating recovery...')

  const validation = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id_recovered != '' THEN 1 ELSE 0 END) as recovered,
        SUM(CASE WHEN condition_id_recovered = '' THEN 1 ELSE 0 END) as still_empty,
        SUM(CASE WHEN condition_id_recovered != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as recovery_rate
      FROM trades_raw_recovered
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const v = validation[0]
  console.log(`  Total rows: ${v.total}`)
  console.log(`  Recovered: ${v.recovered} (${v.recovery_rate.toFixed(2)}%)`)
  console.log(`  Still empty: ${v.still_empty}`)

  // Step 4: Show before/after for test wallets
  console.log('\n[STEP 4] Before/After for test wallets...')

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
          COUNT(DISTINCT condition_id) as unique_conditions
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const after = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id_recovered = '' THEN 1 ELSE 0 END) as empty,
          COUNT(DISTINCT condition_id_recovered) as unique_conditions
        FROM trades_raw_recovered
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const b = before[0]
    const a = after[0]

    console.log(`\n  ${wallet.name}:`)
    console.log(`    Before: ${b.total} trades, ${b.empty} empty, ${b.unique_conditions} unique conditions`)
    console.log(`    After:  ${a.total} trades, ${a.empty} empty, ${a.unique_conditions} unique conditions`)
    console.log(`    Recovery: ${(b.empty - a.empty)} condition_ids recovered`)
  }

  // Step 5: Atomic swap
  console.log('\n[STEP 5] Performing atomic table swap...')

  await clickhouse.command({
    query: `
      RENAME TABLE trades_raw TO trades_raw_with_empty_ids,
                  trades_raw_recovered TO trades_raw
    `
  })

  console.log('  ✅ Tables swapped atomically')
  console.log('  trades_raw now has recovered condition_ids')
  console.log('  trades_raw_with_empty_ids backed up (can be dropped)')

  // Step 6: Final verification
  console.log('\n[STEP 6] Final verification...')

  const finalCheck = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition_ids,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_empty
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const final = finalCheck[0]
  console.log(`  Total trades: ${final.total_trades}`)
  console.log(`  Empty condition_ids: ${final.empty_condition_ids} (${final.pct_empty.toFixed(2)}%)`)

  if (parseFloat(final.pct_empty) < 1) {
    console.log(`\n  ✅ SUCCESS! Empty condition_ids reduced from 48.53% to ${final.pct_empty.toFixed(2)}%`)
  } else {
    console.log(`\n  ⚠️  WARNING: Still have empty condition_ids (${final.pct_empty.toFixed(2)}%)`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('NEXT STEPS')
  console.log('='.repeat(100))
  console.log(`
1. ✅ ERC1155 recovery complete
2. ⏳ Run test wallet P&L calculation to verify recovery worked
3. ⏳ If successful: Full 900K wallet backfill
4. ⏳ Validate P&L against Polymarket UI
  `)
}

main().catch(e => console.error('Error:', e))
