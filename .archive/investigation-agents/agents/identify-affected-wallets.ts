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

async function identifyAffectedWallets() {
  console.log('═'.repeat(70))
  console.log('WHICH WALLETS ARE AFFECTED BY "MISSING" TRADES?')
  console.log('═'.repeat(70))
  console.log()

  // Step 1: Find wallets that have trades in trades_raw but not in trades_with_direction
  console.log('STEP 1: Identify wallets with missing transactions')
  console.log('-'.repeat(70))

  const affectedWallets = await q(`
    WITH wallet_comparison AS (
      SELECT
        wallet_address,
        countDistinct(transaction_hash) as raw_txs
      FROM trades_raw
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
      r.wallet_address,
      r.raw_txs,
      COALESCE(d.direction_txs, 0) as direction_txs,
      r.raw_txs - COALESCE(d.direction_txs, 0) as missing_txs,
      (r.raw_txs - COALESCE(d.direction_txs, 0)) / r.raw_txs * 100 as missing_pct
    FROM wallet_comparison r
    LEFT JOIN direction_wallets d ON r.wallet_address = d.wallet_address
    WHERE r.raw_txs > COALESCE(d.direction_txs, 0)
    ORDER BY missing_txs DESC
    LIMIT 20
  `)

  console.log('Top 20 wallets with most missing transactions:\\n')
  console.log('  Rank | Wallet                          | Raw TXs | Direction TXs | Missing | Missing %')
  console.log('  -----|----------------------------------|---------|---------------|---------|----------')

  affectedWallets.forEach((row: any, i: number) => {
    const wallet = row.wallet_address.substring(0, 20) + '...'
    const rawTxs = Number(row.raw_txs).toLocaleString().padStart(9)
    const dirTxs = Number(row.direction_txs).toLocaleString().padStart(13)
    const missing = Number(row.missing_txs).toLocaleString().padStart(9)
    const missingPct = Number(row.missing_pct).toFixed(1).padStart(9)
    console.log(`  ${(i+1).toString().padStart(4)} | ${wallet} | ${rawTxs} | ${dirTxs} | ${missing} | ${missingPct}%`)
  })
  console.log()

  // Step 2: Calculate overall impact
  console.log('STEP 2: Calculate overall impact')
  console.log('-'.repeat(70))

  const impact = await q(`
    WITH wallet_comparison AS (
      SELECT
        wallet_address,
        countDistinct(transaction_hash) as raw_txs
      FROM trades_raw
      GROUP BY wallet_address
    ),
    direction_wallets AS (
      SELECT
        wallet_address,
        countDistinct(tx_hash) as direction_txs
      FROM trades_with_direction
      GROUP BY wallet_address
    ),
    affected AS (
      SELECT
        r.wallet_address,
        r.raw_txs,
        COALESCE(d.direction_txs, 0) as direction_txs,
        r.raw_txs - COALESCE(d.direction_txs, 0) as missing_txs
      FROM wallet_comparison r
      LEFT JOIN direction_wallets d ON r.wallet_address = d.wallet_address
      WHERE r.raw_txs > COALESCE(d.direction_txs, 0)
    )
    SELECT
      count() as affected_wallets,
      (SELECT countDistinct(wallet_address) FROM trades_with_direction) as total_wallets,
      sum(missing_txs) as total_missing_txs,
      (SELECT countDistinct(transaction_hash) FROM trades_raw) as total_raw_txs
    FROM affected
  `)

  const imp = impact[0]
  const affectedCount = Number(imp.affected_wallets)
  const totalWallets = Number(imp.total_wallets)
  const totalMissingTxs = Number(imp.total_missing_txs)
  const totalRawTxs = Number(imp.total_raw_txs)

  console.log(`Impact Summary:`)
  console.log(`  Affected wallets: ${affectedCount.toLocaleString()} out of ${totalWallets.toLocaleString()} (${(affectedCount/totalWallets*100).toFixed(2)}%)`)
  console.log(`  Total missing transactions: ${totalMissingTxs.toLocaleString()} out of ${totalRawTxs.toLocaleString()} (${(totalMissingTxs/totalRawTxs*100).toFixed(2)}%)`)
  console.log()

  // Step 3: Categorize affected wallets
  console.log('STEP 3: Categorize affected wallets by severity')
  console.log('-'.repeat(70))

  const categories = await q(`
    WITH wallet_comparison AS (
      SELECT
        wallet_address,
        countDistinct(transaction_hash) as raw_txs
      FROM trades_raw
      GROUP BY wallet_address
    ),
    direction_wallets AS (
      SELECT
        wallet_address,
        countDistinct(tx_hash) as direction_txs
      FROM trades_with_direction
      GROUP BY wallet_address
    ),
    affected AS (
      SELECT
        r.wallet_address,
        r.raw_txs,
        COALESCE(d.direction_txs, 0) as direction_txs,
        r.raw_txs - COALESCE(d.direction_txs, 0) as missing_txs,
        (r.raw_txs - COALESCE(d.direction_txs, 0)) / r.raw_txs * 100 as missing_pct
      FROM wallet_comparison r
      LEFT JOIN direction_wallets d ON r.wallet_address = d.wallet_address
      WHERE r.raw_txs > COALESCE(d.direction_txs, 0)
    )
    SELECT
      CASE
        WHEN missing_pct >= 90 THEN 'CRITICAL (90-100% missing)'
        WHEN missing_pct >= 50 THEN 'SEVERE (50-90% missing)'
        WHEN missing_pct >= 10 THEN 'MODERATE (10-50% missing)'
        ELSE 'MINOR (<10% missing)'
      END as severity,
      count() as wallet_count,
      sum(missing_txs) as total_missing
    FROM affected
    GROUP BY severity
    ORDER BY severity DESC
  `)

  console.log('Severity Distribution:\\n')
  categories.forEach((row: any) => {
    console.log(`  ${row.severity}`)
    console.log(`    Wallets: ${Number(row.wallet_count).toLocaleString()}`)
    console.log(`    Missing TXs: ${Number(row.total_missing).toLocaleString()}`)
    console.log()
  })

  console.log('═'.repeat(70))
  console.log('RECOMMENDATION')
  console.log('═'.repeat(70))
  console.log()

  if (affectedCount / totalWallets < 0.01) {
    console.log('✅ SHIP NOW - Less than 1% of wallets affected')
    console.log()
    console.log('Strategy:')
    console.log('1. Use trades_with_direction as primary table')
    console.log('2. Add "data_completeness" flag for affected wallets')
    console.log('3. Show banner: "High-volume trader wallets may have partial data"')
    console.log('4. Backfill can improve coverage later without blocking launch')
  } else if (affectedCount / totalWallets < 0.05) {
    console.log('⚠️  CONSIDER WAITING - Up to 5% of wallets affected')
    console.log()
    console.log('Options:')
    console.log('A. Ship now with transparency about incomplete data')
    console.log('B. Wait for backfill to complete (~90 min)')
    console.log('C. Exclude affected wallets from leaderboard temporarily')
  } else {
    console.log('❌ WAIT FOR BACKFILL - More than 5% of wallets affected')
    console.log()
    console.log('Reason: Too many wallets have incomplete data')
    console.log('Recommendation: Wait for backfill to complete')
  }
  console.log()
}

identifyAffectedWallets().catch(console.error)
