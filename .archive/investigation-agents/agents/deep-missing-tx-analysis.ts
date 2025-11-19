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

async function deepMissingAnalysis() {
  console.log('═'.repeat(70))
  console.log('DEEP ANALYSIS: Are "Missing" Trades Real or Phantom?')
  console.log('═'.repeat(70))
  console.log()

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0'

  // Step 1: What % of trades_raw are NOT in trades_with_direction?
  console.log('STEP 1: What % of trades_raw are "missing" from trades_with_direction?')
  console.log('-'.repeat(70))

  const coverage = await q(`
    SELECT
      (SELECT count() FROM trades_raw WHERE wallet_address = '${topWallet}') as raw_total,
      (SELECT count() FROM trades_with_direction WHERE wallet_address = '${topWallet}') as direction_total,
      (SELECT countDistinct(transaction_hash) FROM trades_raw WHERE wallet_address = '${topWallet}') as raw_unique_txs,
      (SELECT countDistinct(tx_hash) FROM trades_with_direction WHERE wallet_address = '${topWallet}') as direction_unique_txs
  `)

  const c = coverage[0]
  const rawTotal = Number(c.raw_total)
  const dirTotal = Number(c.direction_total)
  const rawUniqueTxs = Number(c.raw_unique_txs)
  const dirUniqueTxs = Number(c.direction_unique_txs)

  console.log(`Top wallet (${topWallet}):`)
  console.log(`  trades_raw: ${rawTotal.toLocaleString()} rows (${rawUniqueTxs.toLocaleString()} unique tx_hashes)`)
  console.log(`  trades_with_direction: ${dirTotal.toLocaleString()} rows (${dirUniqueTxs.toLocaleString()} unique tx_hashes)`)
  console.log()
  console.log(`  Missing: ${(rawTotal - dirTotal).toLocaleString()} rows`)
  console.log(`  Missing tx_hashes: ${(rawUniqueTxs - dirUniqueTxs).toLocaleString()}`)
  console.log()

  // Step 2: Check quality of "missing" trades in trades_raw
  console.log('STEP 2: Quality check of "missing" trades')
  console.log('-'.repeat(70))

  const qualityCheck = await q(`
    WITH missing_txs AS (
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE wallet_address = '${topWallet}'
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash
          FROM trades_with_direction
          WHERE wallet_address = '${topWallet}'
        )
    )
    SELECT
      count() as total,
      countIf(r.condition_id = '' OR r.condition_id IS NULL) as blank_condition,
      countIf(r.market_id = '' OR r.market_id = '0x0' OR r.market_id = '0x0000000000000000000000000000000000000000000000000000000000000000' OR r.market_id = '12' OR r.market_id IS NULL) as bad_market,
      countIf(r.trade_id LIKE '%undefined%' OR r.trade_id LIKE '%unidentified%') as bad_trade_id,
      sum(r.usd_value) as total_volume
    FROM missing_txs m
    INNER JOIN trades_raw r ON m.transaction_hash = r.transaction_hash AND r.wallet_address = '${topWallet}'
  `)

  const qc = qualityCheck[0]
  const total = Number(qc.total)
  console.log(`"Missing" trades quality:`)
  console.log(`  Total "missing" rows: ${total.toLocaleString()}`)
  console.log(`  Blank condition_id: ${Number(qc.blank_condition).toLocaleString()} (${(Number(qc.blank_condition)/total*100).toFixed(1)}%)`)
  console.log(`  Bad market_id: ${Number(qc.bad_market).toLocaleString()} (${(Number(qc.bad_market)/total*100).toFixed(1)}%)`)
  console.log(`  Bad trade_id (undefined/unidentified): ${Number(qc.bad_trade_id).toLocaleString()} (${(Number(qc.bad_trade_id)/total*100).toFixed(1)}%)`)
  console.log(`  Total volume: $${Number(qc.total_volume).toLocaleString()}`)
  console.log()

  // Step 3: Can trade_direction_assignments recover them?
  console.log('STEP 3: Can we recover from trade_direction_assignments?')
  console.log('-'.repeat(70))

  const tdaRecovery = await q(`
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
      count() as total,
      countIf(tda.condition_id_norm != '' AND tda.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as recoverable,
      countIf(tda.tx_hash IS NOT NULL) as found_in_tda
    FROM missing_txs m
    LEFT JOIN trade_direction_assignments tda
      ON m.transaction_hash = tda.tx_hash AND tda.wallet_address = '${topWallet}'
  `)

  const tda = tdaRecovery[0]
  console.log(`Sample 10K "missing" tx_hashes:`)
  console.log(`  Found in trade_direction_assignments: ${Number(tda.found_in_tda).toLocaleString()} (${(Number(tda.found_in_tda)/Number(tda.total)*100).toFixed(1)}%)`)
  console.log(`  With valid condition_id_norm: ${Number(tda.recoverable).toLocaleString()} (${(Number(tda.recoverable)/Number(tda.total)*100).toFixed(1)}%)`)
  console.log()

  // Step 4: Can erc1155_transfers recover them?
  console.log('STEP 4: Can we recover from erc1155_transfers (blockchain source)?')
  console.log('-'.repeat(70))

  const erc1155Recovery = await q(`
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
      count() as total,
      countIf(e.tx_hash IS NOT NULL) as found_on_blockchain,
      countIf(e.token_id != '') as with_token_id
    FROM missing_txs m
    LEFT JOIN erc1155_transfers e
      ON m.transaction_hash = e.tx_hash
      AND (e.from_address = '${topWallet}' OR e.to_address = '${topWallet}')
  `)

  const erc = erc1155Recovery[0]
  console.log(`Sample 10K "missing" tx_hashes:`)
  console.log(`  Found on blockchain (erc1155_transfers): ${Number(erc.found_on_blockchain).toLocaleString()} (${(Number(erc.found_on_blockchain)/Number(erc.total)*100).toFixed(1)}%)`)
  console.log(`  With token_id: ${Number(erc.with_token_id).toLocaleString()} (${(Number(erc.with_token_id)/Number(erc.total)*100).toFixed(1)}%)`)
  console.log()

  // Step 5: The Paradox - why does trades_with_direction have MORE unique tx_hashes globally?
  console.log('STEP 5: The Global Paradox')
  console.log('-'.repeat(70))

  const globalComparison = await q(`
    SELECT
      (SELECT countDistinct(transaction_hash) FROM trades_raw) as raw_unique_txs,
      (SELECT countDistinct(tx_hash) FROM trades_with_direction) as direction_unique_txs,
      (SELECT count() FROM trades_raw) as raw_total_rows,
      (SELECT count() FROM trades_with_direction) as direction_total_rows
  `)

  const gc = globalComparison[0]
  const rawGlobalTxs = Number(gc.raw_unique_txs)
  const dirGlobalTxs = Number(gc.direction_unique_txs)
  const rawGlobalRows = Number(gc.raw_total_rows)
  const dirGlobalRows = Number(gc.direction_total_rows)

  console.log(`GLOBALLY:`)
  console.log(`  trades_raw: ${rawGlobalTxs.toLocaleString()} unique tx_hashes (${rawGlobalRows.toLocaleString()} rows)`)
  console.log(`  trades_with_direction: ${dirGlobalTxs.toLocaleString()} unique tx_hashes (${dirGlobalRows.toLocaleString()} rows)`)
  console.log()

  if (dirGlobalTxs > rawGlobalTxs) {
    console.log(`  ✅ trades_with_direction has ${(dirGlobalTxs - rawGlobalTxs).toLocaleString()} MORE unique tx_hashes globally!`)
    console.log(`  📊 Rows per transaction:`)
    console.log(`     trades_raw: ${(rawGlobalRows / rawGlobalTxs).toFixed(2)} rows/tx (duplicates + phantoms)`)
    console.log(`     trades_with_direction: ${(dirGlobalRows / dirGlobalTxs).toFixed(2)} rows/tx (properly deduplicated)`)
  } else {
    console.log(`  ⚠️  trades_raw has ${(rawGlobalTxs - dirGlobalTxs).toLocaleString()} MORE unique tx_hashes`)
  }
  console.log()

  console.log('═'.repeat(70))
  console.log('VERDICT')
  console.log('═'.repeat(70))
  console.log()

  const blankPct = Number(qc.blank_condition) / total * 100
  const blockchainPct = Number(erc.found_on_blockchain) / Number(erc.total) * 100

  if (blankPct > 95 && blockchainPct < 5) {
    console.log('❌ The "missing" trades are PHANTOM DATA')
    console.log()
    console.log('Evidence:')
    console.log(`1. ${blankPct.toFixed(1)}% have blank/null condition_ids`)
    console.log(`2. Only ${blockchainPct.toFixed(1)}% found on blockchain`)
    console.log('3. trades_with_direction has MORE unique tx_hashes globally')
    console.log('4. These are likely artifacts from buggy CLOB API import')
    console.log()
    console.log('✅ CONCLUSION: trades_with_direction is MORE complete than trades_raw')
    console.log('   The "missing" trades don\'t exist in reality')
  } else if (blockchainPct > 50) {
    console.log('✅ The "missing" trades are REAL')
    console.log()
    console.log(`Evidence: ${blockchainPct.toFixed(1)}% found on blockchain`)
    console.log('Recommendation: Continue backfill to recover these transactions')
  } else {
    console.log('⚠️  MIXED RESULTS')
    console.log()
    console.log(`Blank condition_ids: ${blankPct.toFixed(1)}%`)
    console.log(`Found on blockchain: ${blockchainPct.toFixed(1)}%`)
    console.log('Investigate further before deciding')
  }
  console.log()
}

deepMissingAnalysis().catch(console.error)
