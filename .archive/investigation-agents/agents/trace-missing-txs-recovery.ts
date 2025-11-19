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

async function traceMissingTxs() {
  console.log('═'.repeat(70))
  console.log('TRACING "MISSING" TRANSACTIONS - CAN WE RECOVER THEM?')
  console.log('═'.repeat(70))
  console.log()

  // Step 1: Find the "missing" transactions (in trades_raw but not in trades_with_direction)
  console.log('STEP 1: Identify "missing" transactions')
  console.log('-'.repeat(70))

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0'

  console.log(`Top wallet: ${topWallet}`)
  console.log()

  // Get sample of "missing" tx_hashes
  const missingTxs = await q(`
    SELECT DISTINCT transaction_hash
    FROM trades_raw
    WHERE wallet_address = '${topWallet}'
      AND transaction_hash NOT IN (
        SELECT DISTINCT tx_hash
        FROM trades_with_direction
        WHERE wallet_address = '${topWallet}'
      )
    LIMIT 1000
  `)

  console.log(`Found ${missingTxs.length} sample "missing" tx_hashes`)
  console.log()

  // Step 2: Check if these tx_hashes exist in trade_direction_assignments
  console.log('STEP 2: Can trade_direction_assignments recover them?')
  console.log('-'.repeat(70))

  const recoveryCheck = await q(`
    WITH missing_txs AS (
      SELECT DISTINCT transaction_hash as tx
      FROM trades_raw
      WHERE wallet_address = '${topWallet}'
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash
          FROM trades_with_direction
          WHERE wallet_address = '${topWallet}'
        )
      LIMIT 10000
    )
    SELECT
      count() as total_missing,
      countIf(tda.condition_id_norm != '' AND tda.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as recovered_from_assignments
    FROM missing_txs m
    LEFT JOIN trade_direction_assignments tda
      ON m.tx = tda.tx_hash
      AND tda.wallet_address = '${topWallet}'
  `)

  const rc = recoveryCheck[0]
  console.log(`Sample of 10K "missing" tx_hashes:`)
  console.log(`  Total missing: ${Number(rc.total_missing).toLocaleString()}`)
  console.log(`  Recoverable from trade_direction_assignments: ${Number(rc.recovered_from_assignments).toLocaleString()} (${(Number(rc.recovered_from_assignments)/Number(rc.total_missing)*100).toFixed(1)}%)`)
  console.log()

  // Step 3: Check if these tx_hashes exist in erc1155_transfers
  console.log('STEP 3: Can erc1155_transfers recover them?')
  console.log('-'.repeat(70))

  const erc1155Check = await q(`
    WITH missing_txs AS (
      SELECT DISTINCT transaction_hash as tx
      FROM trades_raw
      WHERE wallet_address = '${topWallet}'
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash
          FROM trades_with_direction
          WHERE wallet_address = '${topWallet}'
        )
      LIMIT 10000
    )
    SELECT
      count() as total_missing,
      countIf(e.token_id != '') as found_in_erc1155
    FROM missing_txs m
    LEFT JOIN erc1155_transfers e
      ON m.tx = e.tx_hash
      AND (e.from_address = '${topWallet}' OR e.to_address = '${topWallet}')
  `)

  const ec = erc1155Check[0]
  console.log(`Sample of 10K "missing" tx_hashes:`)
  console.log(`  Total missing: ${Number(ec.total_missing).toLocaleString()}`)
  console.log(`  Found in erc1155_transfers: ${Number(ec.found_in_erc1155).toLocaleString()} (${(Number(ec.found_in_erc1155)/Number(ec.total_missing)*100).toFixed(1)}%)`)
  console.log()

  // Step 4: Sample recovery demonstration
  console.log('STEP 4: Recovery Demonstration (5 sample transactions)')
  console.log('-'.repeat(70))

  const sampleTxs = missingTxs.slice(0, 5).map((r: any) => r.transaction_hash)

  for (const tx of sampleTxs) {
    console.log(`\nTransaction: ${tx}`)

    // Check trades_raw data
    const rawData = await q(`
      SELECT condition_id, market_id, shares, usd_value
      FROM trades_raw
      WHERE transaction_hash = '${tx}' AND wallet_address = '${topWallet}'
      LIMIT 1
    `)

    if (rawData.length > 0) {
      const r = rawData[0]
      console.log(`  trades_raw:`)
      console.log(`    condition_id: ${r.condition_id || '(empty)'}`)
      console.log(`    market_id: ${r.market_id || '(empty)'}`)
      console.log(`    shares: ${r.shares}`)
      console.log(`    usd_value: ${r.usd_value}`)
    }

    // Check trade_direction_assignments
    const assignData = await q(`
      SELECT condition_id_norm, token_id, usdc_in, usdc_out, tokens_in, tokens_out
      FROM trade_direction_assignments
      WHERE tx_hash = '${tx}' AND wallet_address = '${topWallet}'
      LIMIT 1
    `)

    if (assignData.length > 0) {
      const a = assignData[0]
      console.log(`  trade_direction_assignments:`)
      console.log(`    condition_id_norm: ${a.condition_id_norm || '(empty)'}`)
      console.log(`    token_id: ${a.token_id || '(empty)'}`)
      console.log(`    usdc_in: ${a.usdc_in}`)
      console.log(`    usdc_out: ${a.usdc_out}`)
    } else {
      console.log(`  trade_direction_assignments: NOT FOUND`)
    }

    // Check erc1155_transfers
    const erc1155Data = await q(`
      SELECT token_id, value
      FROM erc1155_transfers
      WHERE tx_hash = '${tx}'
        AND (from_address = '${topWallet}' OR to_address = '${topWallet}')
      LIMIT 1
    `)

    if (erc1155Data.length > 0) {
      const e = erc1155Data[0]
      console.log(`  erc1155_transfers:`)
      console.log(`    token_id: ${e.token_id}`)
      console.log(`    value: ${e.value}`)
    } else {
      console.log(`  erc1155_transfers: NOT FOUND`)
    }
  }
  console.log()

  // Step 5: Full recovery potential
  console.log('═'.repeat(70))
  console.log('RECOVERY POTENTIAL')
  console.log('═'.repeat(70))
  console.log()

  const fullRecovery = await q(`
    WITH missing_txs AS (
      SELECT DISTINCT transaction_hash as tx, wallet_address as wallet
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash
        FROM trades_with_direction
      )
      LIMIT 100000
    )
    SELECT
      count() as total_missing,
      countIf(tda.condition_id_norm != '' AND tda.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as recoverable_from_assignments,
      countIf(e.token_id != '') as recoverable_from_erc1155
    FROM missing_txs m
    LEFT JOIN trade_direction_assignments tda
      ON m.tx = tda.tx_hash AND m.wallet = tda.wallet_address
    LEFT JOIN erc1155_transfers e
      ON m.tx = e.tx_hash
  `)

  const fr = fullRecovery[0]
  console.log(`Sample of 100K "missing" transactions:`)
  console.log(`  Total missing: ${Number(fr.total_missing).toLocaleString()}`)
  console.log(`  Recoverable from trade_direction_assignments: ${Number(fr.recoverable_from_assignments).toLocaleString()} (${(Number(fr.recoverable_from_assignments)/Number(fr.total_missing)*100).toFixed(1)}%)`)
  console.log(`  Recoverable from erc1155_transfers: ${Number(fr.recoverable_from_erc1155).toLocaleString()} (${(Number(fr.recoverable_from_erc1155)/Number(fr.total_missing)*100).toFixed(1)}%)`)
  console.log()

  console.log('═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))
  console.log()

  const assignRecovery = Number(fr.recoverable_from_assignments) / Number(fr.total_missing) * 100
  const erc1155Recovery = Number(fr.recoverable_from_erc1155) / Number(fr.total_missing) * 100

  if (assignRecovery > 80 || erc1155Recovery > 80) {
    console.log('✅ YES! We can recover most "missing" transactions')
    console.log()
    console.log('Recovery Strategy:')
    console.log('1. UNION trades_with_direction with trade_direction_assignments (valid only)')
    console.log('2. Deduplicate by (tx_hash, wallet, condition_id)')
    console.log('3. Result: Near 100% coverage')
    console.log()
    console.log(`Estimated recovery: ${Math.max(assignRecovery, erc1155Recovery).toFixed(1)}%`)
  } else if (assignRecovery > 50 || erc1155Recovery > 50) {
    console.log('⚠️  PARTIAL recovery possible')
    console.log()
    console.log(`Can recover ${Math.max(assignRecovery, erc1155Recovery).toFixed(1)}% from other tables`)
    console.log('Consider hybrid approach or accept current coverage')
  } else {
    console.log('❌ Limited recovery possible')
    console.log()
    console.log('The "missing" transactions may be phantom/corrupted data')
    console.log('Current trades_with_direction coverage is likely the best available')
  }
  console.log()
}

traceMissingTxs().catch(console.error)
