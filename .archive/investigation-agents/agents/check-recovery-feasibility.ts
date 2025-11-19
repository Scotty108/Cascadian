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

async function checkRecoveryFeasibility() {
  console.log('═'.repeat(70))
  console.log('CAN WE RECOVER THE 638K MISSING TRANSACTIONS?')
  console.log('═'.repeat(70))
  console.log()

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0'

  console.log('CRITICAL FINDINGS:')
  console.log('- 638K tx_hashes missing from trades_with_direction for top wallet')
  console.log('- 100% have blank condition_ids in trades_raw')
  console.log('- 100% found on blockchain (erc1155_transfers)')
  console.log('- But only 0.3% have token_ids populated')
  console.log()

  // Check if erc1155_transfers has the data needed
  console.log('STEP 1: Check erc1155_transfers completeness')
  console.log('-'.repeat(70))

  const erc1155Check = await q(`
    SELECT
      count() as total,
      countIf(token_id != '' AND token_id IS NOT NULL) as with_token_id,
      countDistinct(tx_hash) as unique_txs
    FROM erc1155_transfers
  `)

  const erc = erc1155Check[0]
  console.log(`erc1155_transfers table:`)
  console.log(`  Total rows: ${Number(erc.total).toLocaleString()}`)
  console.log(`  With token_id: ${Number(erc.with_token_id).toLocaleString()} (${(Number(erc.with_token_id)/Number(erc.total)*100).toFixed(1)}%)`)
  console.log(`  Unique tx_hashes: ${Number(erc.unique_txs).toLocaleString()}`)
  console.log()

  // Check token_id format
  const tokenSample = await q(`
    SELECT token_id, tx_hash
    FROM erc1155_transfers
    WHERE token_id != '' AND token_id IS NOT NULL
    LIMIT 5
  `)

  console.log('Sample token_ids:')
  tokenSample.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. ${row.token_id} (${row.token_id.length} chars)`)
  })
  console.log()

  // Check if token_id can be decoded to condition_id
  console.log('STEP 2: Can token_id be decoded to condition_id?')
  console.log('-'.repeat(70))

  const tokenDecoding = await q(`
    SELECT
      e.token_id,
      e.tx_hash,
      map.condition_id_norm as mapped_condition_id
    FROM erc1155_transfers e
    LEFT JOIN erc1155_condition_map map ON e.token_id = map.token_id
    WHERE e.token_id != '' AND e.token_id IS NOT NULL
    LIMIT 5
  `)

  console.log('Token → Condition ID mapping:')
  tokenDecoding.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. token_id: ${row.token_id}`)
    console.log(`     condition_id: ${row.mapped_condition_id || '(not mapped)'}`)
  })
  console.log()

  // Check mapping coverage
  const mappingCoverage = await q(`
    SELECT
      (SELECT countDistinct(token_id) FROM erc1155_transfers WHERE token_id != '') as total_token_ids,
      (SELECT count() FROM erc1155_condition_map) as mapped_token_ids
  `)

  const mc = mappingCoverage[0]
  console.log(`Token ID → Condition ID mapping coverage:`)
  console.log(`  Unique token_ids in erc1155_transfers: ${Number(mc.total_token_ids).toLocaleString()}`)
  console.log(`  Mapped in erc1155_condition_map: ${Number(mc.mapped_token_ids).toLocaleString()}`)
  console.log(`  Coverage: ${(Number(mc.mapped_token_ids)/Number(mc.total_token_ids)*100).toFixed(1)}%`)
  console.log()

  // CRITICAL: Check if the "missing" tx_hashes can be recovered
  console.log('STEP 3: Recovery potential for "missing" tx_hashes')
  console.log('-'.repeat(70))

  const recoveryPotential = await q(`
    WITH missing_txs AS (
      SELECT DISTINCT transaction_hash
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
      countIf(e.tx_hash IS NOT NULL) as found_in_erc1155,
      countIf(e.token_id != '' AND e.token_id IS NOT NULL) as has_token_id,
      countIf(map.condition_id_norm != '') as can_map_to_condition
    FROM missing_txs m
    LEFT JOIN erc1155_transfers e ON m.transaction_hash = e.tx_hash
    LEFT JOIN erc1155_condition_map map ON e.token_id = map.token_id
  `)

  const rp = recoveryPotential[0]
  const totalMissing = Number(rp.total_missing)
  const foundInERC = Number(rp.found_in_erc1155)
  const hasTokenID = Number(rp.has_token_id)
  const canMap = Number(rp.can_map_to_condition)

  console.log(`Sample 10K "missing" tx_hashes:`)
  console.log(`  Total: ${totalMissing.toLocaleString()}`)
  console.log(`  Found in erc1155_transfers: ${foundInERC.toLocaleString()} (${(foundInERC/totalMissing*100).toFixed(1)}%)`)
  console.log(`  Has token_id populated: ${hasTokenID.toLocaleString()} (${(hasTokenID/totalMissing*100).toFixed(1)}%)`)
  console.log(`  Can map to condition_id: ${canMap.toLocaleString()} (${(canMap/totalMissing*100).toFixed(1)}%)`)
  console.log()

  console.log('═'.repeat(70))
  console.log('VERDICT')
  console.log('═'.repeat(70))
  console.log()

  if (hasTokenID / totalMissing < 0.05) {
    console.log('❌ CANNOT RECOVER - erc1155_transfers is incomplete')
    console.log()
    console.log('Evidence:')
    console.log(`1. Only ${(hasTokenID/totalMissing*100).toFixed(1)}% of "missing" txs have token_ids`)
    console.log('2. erc1155_transfers table needs backfill')
    console.log('3. Current backfill in progress may solve this')
    console.log()
    console.log('OPTIONS:')
    console.log('A. Wait for backfill to complete (~90 min)')
    console.log('B. Use trades_with_direction as-is (82M valid trades, 936K wallets)')
    console.log('C. Accept incomplete coverage for some high-volume wallets')
  } else if (canMap / totalMissing > 0.8) {
    console.log('✅ CAN RECOVER - Most missing txs can be mapped')
    console.log()
    console.log(`Recovery Rate: ${(canMap/totalMissing*100).toFixed(1)}%`)
    console.log()
    console.log('RECOVERY STRATEGY:')
    console.log('1. UNION trades_with_direction with trade_direction_assignments')
    console.log('2. Join to erc1155_transfers → erc1155_condition_map')
    console.log('3. Recover condition_ids from blockchain data')
    console.log('4. Deduplicate by (tx_hash, wallet, condition_id)')
  } else {
    console.log('⚠️  PARTIAL RECOVERY POSSIBLE')
    console.log()
    console.log(`Can recover: ${(canMap/totalMissing*100).toFixed(1)}%`)
    console.log(`Cannot recover: ${((totalMissing-canMap)/totalMissing*100).toFixed(1)}%`)
    console.log()
    console.log('DECISION REQUIRED:')
    console.log('- Accept partial coverage?')
    console.log('- Wait for backfill?')
    console.log('- Use trades_with_direction as primary (covers 936K wallets)?')
  }
  console.log()

  // Final comparison
  console.log('FINAL COMPARISON:')
  console.log('-'.repeat(70))
  console.log()
  console.log('Option A: Use trades_with_direction AS-IS')
  console.log(`  - ${dirGlobalTxs.toLocaleString()} unique transactions globally`)
  console.log('  - 82.1M valid trades')
  console.log('  - 936K wallets covered')
  console.log('  - 100% condition_id coverage')
  console.log('  - Ship TODAY')
  console.log()
  console.log('Option B: Wait for backfill + recovery')
  console.log(`  - Potentially recover ${((hasTokenID/totalMissing)*638522).toFixed(0)} transactions for top wallet`)
  console.log('  - 90 minutes remaining')
  console.log('  - May add 1-5% more transactions')
  console.log('  - Ship TOMORROW')
  console.log()
}

checkRecoveryFeasibility().catch(console.error)
