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

async function unionVsBackfill() {
  console.log('═'.repeat(70))
  console.log('UNION APPROACH VS BLOCKCHAIN BACKFILL')
  console.log('═'.repeat(70))
  console.log()

  // Step 1: What does trades_raw actually have that's VALID?
  console.log('STEP 1: Valid data in trades_raw')
  console.log('-'.repeat(70))

  const rawValid = await q(`
    SELECT
      count() as total,
      countIf(condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000' AND condition_id IS NOT NULL) as valid,
      countDistinct(transaction_hash) as unique_txs,
      countDistinctIf(transaction_hash, condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000' AND condition_id IS NOT NULL) as unique_valid_txs
    FROM trades_raw
  `)

  const rv = rawValid[0]
  console.log(`trades_raw:`)
  console.log(`  Total rows: ${Number(rv.total).toLocaleString()}`)
  console.log(`  Valid condition_ids: ${Number(rv.valid).toLocaleString()} (${(Number(rv.valid)/Number(rv.total)*100).toFixed(1)}%)`)
  console.log(`  Unique tx_hashes: ${Number(rv.unique_txs).toLocaleString()}`)
  console.log(`  Unique tx_hashes with valid condition_ids: ${Number(rv.unique_valid_txs).toLocaleString()}`)
  console.log()

  // Step 2: How much overlap between trades_with_direction and trades_raw (valid)?
  console.log('STEP 2: Overlap analysis')
  console.log('-'.repeat(70))

  const overlap = await q(`
    WITH raw_valid AS (
      SELECT DISTINCT transaction_hash as tx
      FROM trades_raw
      WHERE condition_id != ''
        AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id IS NOT NULL
      LIMIT 20000000
    ),
    direction_txs AS (
      SELECT DISTINCT tx_hash as tx
      FROM trades_with_direction
      LIMIT 20000000
    )
    SELECT
      (SELECT count() FROM raw_valid) as raw_valid_count,
      (SELECT count() FROM direction_txs) as direction_count,
      countIf(d.tx IS NOT NULL) as overlap_count
    FROM raw_valid r
    LEFT JOIN direction_txs d ON r.tx = d.tx
  `)

  const ov = overlap[0]
  const rawValidCount = Number(ov.raw_valid_count)
  const directionCount = Number(ov.direction_count)
  const overlapCount = Number(ov.overlap_count)
  const uniqueInRaw = rawValidCount - overlapCount

  console.log(`Overlap between trades_with_direction and trades_raw (valid):`)
  console.log(`  trades_with_direction unique tx_hashes: ${directionCount.toLocaleString()}`)
  console.log(`  trades_raw valid unique tx_hashes: ${rawValidCount.toLocaleString()}`)
  console.log(`  Overlap: ${overlapCount.toLocaleString()} (${(overlapCount/rawValidCount*100).toFixed(1)}%)`)
  console.log(`  Unique to trades_raw: ${uniqueInRaw.toLocaleString()} (${(uniqueInRaw/rawValidCount*100).toFixed(1)}%)`)
  console.log()

  // Step 3: Estimate UNION coverage
  console.log('STEP 3: Estimated UNION coverage')
  console.log('-'.repeat(70))

  const unionEstimate = directionCount + uniqueInRaw

  console.log(`If we UNION trades_with_direction + trades_raw (valid):`)
  console.log(`  trades_with_direction: ${directionCount.toLocaleString()} tx_hashes`)
  console.log(`  + trades_raw unique valid: ${uniqueInRaw.toLocaleString()} tx_hashes`)
  console.log(`  = Total: ${unionEstimate.toLocaleString()} unique tx_hashes`)
  console.log()

  // Step 4: What's the backfill progress?
  console.log('STEP 4: Blockchain backfill progress')
  console.log('-'.repeat(70))

  const backfillProgress = await q(`
    SELECT
      count() as total_rows,
      countDistinct(tx_hash) as unique_txs,
      countIf(token_id != '' AND token_id IS NOT NULL) as with_token_id
    FROM erc1155_transfers
  `)

  const bp = backfillProgress[0]
  console.log(`erc1155_transfers (blockchain backfill):`)
  console.log(`  Total rows: ${Number(bp.total_rows).toLocaleString()}`)
  console.log(`  Unique tx_hashes: ${Number(bp.unique_txs).toLocaleString()}`)
  console.log(`  With token_id: ${Number(bp.with_token_id).toLocaleString()} (${(Number(bp.with_token_id)/Number(bp.total_rows)*100).toFixed(1)}%)`)
  console.log()

  // Calculate what backfill COULD recover
  const rawInvalid = Number(rv.unique_txs) - Number(rv.unique_valid_txs)
  const backfillCoverage = Number(bp.unique_txs)

  console.log(`Backfill potential:`)
  console.log(`  tx_hashes with blank condition_ids in trades_raw: ${rawInvalid.toLocaleString()}`)
  console.log(`  tx_hashes in erc1155_transfers: ${backfillCoverage.toLocaleString()}`)
  console.log(`  Backfill progress: ${(backfillCoverage/rawInvalid*100).toFixed(2)}%`)
  console.log()

  // Step 5: Per-wallet improvement
  console.log('STEP 5: Per-wallet improvement with UNION')
  console.log('-'.repeat(70))

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0'

  const walletImprovement = await q(`
    WITH direction_txs AS (
      SELECT DISTINCT tx_hash
      FROM trades_with_direction
      WHERE wallet_address = '${topWallet}'
    ),
    raw_valid_txs AS (
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE wallet_address = '${topWallet}'
        AND condition_id != ''
        AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id IS NOT NULL
    ),
    union_txs AS (
      SELECT tx_hash as tx FROM direction_txs
      UNION DISTINCT
      SELECT transaction_hash as tx FROM raw_valid_txs
    )
    SELECT
      (SELECT count() FROM direction_txs) as direction_count,
      (SELECT count() FROM raw_valid_txs) as raw_valid_count,
      (SELECT count() FROM union_txs) as union_count
  `)

  const wi = walletImprovement[0]
  const dirWallet = Number(wi.direction_count)
  const rawValidWallet = Number(wi.raw_valid_count)
  const unionWallet = Number(wi.union_count)
  const improvement = unionWallet - dirWallet

  console.log(`Top wallet (${topWallet.substring(0, 20)}...):`)
  console.log(`  trades_with_direction: ${dirWallet.toLocaleString()} tx_hashes`)
  console.log(`  trades_raw (valid): ${rawValidWallet.toLocaleString()} tx_hashes`)
  console.log(`  UNION: ${unionWallet.toLocaleString()} tx_hashes`)
  console.log(`  Improvement: +${improvement.toLocaleString()} tx_hashes (+${(improvement/dirWallet*100).toFixed(1)}%)`)
  console.log()

  // Step 6: Check what % of wallets would have complete coverage
  console.log('STEP 6: Wallet coverage after UNION')
  console.log('-'.repeat(70))

  const walletCoverage = await q(`
    WITH raw_valid_wallets AS (
      SELECT
        wallet_address,
        countDistinct(transaction_hash) as raw_valid_txs
      FROM trades_raw
      WHERE condition_id != ''
        AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id IS NOT NULL
      GROUP BY wallet_address
    ),
    direction_wallets AS (
      SELECT
        wallet_address,
        countDistinct(tx_hash) as direction_txs
      FROM trades_with_direction
      GROUP BY wallet_address
    )
    SELECT
      (SELECT countDistinct(wallet_address) FROM trades_with_direction) as total_wallets,
      countIf(r.raw_valid_txs > d.direction_txs) as improved_wallets,
      avg(CASE WHEN r.raw_valid_txs > d.direction_txs THEN r.raw_valid_txs - d.direction_txs ELSE 0 END) as avg_improvement
    FROM direction_wallets d
    LEFT JOIN raw_valid_wallets r ON d.wallet_address = r.wallet_address
  `)

  const wc = walletCoverage[0]
  const totalWallets = Number(wc.total_wallets)
  const improvedWallets = Number(wc.improved_wallets)
  const avgImprovement = Number(wc.avg_improvement)

  console.log(`Wallet improvement:`)
  console.log(`  Total wallets: ${totalWallets.toLocaleString()}`)
  console.log(`  Wallets with more data in trades_raw: ${improvedWallets.toLocaleString()} (${(improvedWallets/totalWallets*100).toFixed(1)}%)`)
  console.log(`  Average additional tx_hashes per wallet: ${avgImprovement.toFixed(0)}`)
  console.log()

  console.log('═'.repeat(70))
  console.log('VERDICT: IS BACKFILL NECESSARY?')
  console.log('═'.repeat(70))
  console.log()

  const backfillProgressPct = backfillCoverage / rawInvalid * 100

  if (backfillProgressPct < 5) {
    console.log('❌ STOP THE BACKFILL - It\'s only ' + backfillProgressPct.toFixed(2) + '% complete')
    console.log()
    console.log('Evidence:')
    console.log(`1. Backfill has only recovered ${backfillCoverage.toLocaleString()} tx_hashes`)
    console.log(`2. Need to recover ${rawInvalid.toLocaleString()} tx_hashes with blank condition_ids`)
    console.log(`3. Progress: ${backfillProgressPct.toFixed(2)}%`)
    console.log(`4. At current rate, would take days/weeks to complete`)
    console.log()
    console.log('✅ BETTER APPROACH: UNION trades_with_direction + trades_raw (valid)')
    console.log()
    console.log('Result:')
    console.log(`- ${unionEstimate.toLocaleString()} unique tx_hashes (vs ${directionCount.toLocaleString()} with direction alone)`)
    console.log(`- Adds ${uniqueInRaw.toLocaleString()} more transactions immediately`)
    console.log(`- ${improvedWallets.toLocaleString()} wallets get more complete data`)
    console.log(`- Can complete in 2-3 hours`)
    console.log()
    console.log('The backfill was trying to recover blank condition_ids, but UNION approach')
    console.log('uses existing valid data from trades_raw, which is much faster.')
  } else if (backfillProgressPct < 50) {
    console.log('⚠️  CONSIDER STOPPING BACKFILL - Only ' + backfillProgressPct.toFixed(1) + '% complete')
    console.log()
    console.log('UNION approach would be faster and give ' + (uniqueInRaw/rawInvalid*100).toFixed(1) + '% coverage immediately')
  } else {
    console.log('✅ KEEP BACKFILL RUNNING - Already ' + backfillProgressPct.toFixed(1) + '% complete')
    console.log()
    console.log('Worth waiting to complete')
  }
  console.log()
}

unionVsBackfill().catch(console.error)
