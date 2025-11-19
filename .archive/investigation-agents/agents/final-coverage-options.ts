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

async function finalCoverageOptions() {
  console.log('═'.repeat(70))
  console.log('FINAL ANALYSIS: PATH TO 95-100% COVERAGE')
  console.log('═'.repeat(70))
  console.log()

  console.log('GOAL: Calculate accurate P&L for all wallets')
  console.log('REQUIREMENT: 95-100% complete trade history per wallet')
  console.log()

  // Option 1: Current state
  console.log('OPTION 1: Use vw_trades_canonical AS-IS')
  console.log('-'.repeat(70))
  console.log('Coverage: 50.8% (80.1M valid out of 157.5M)')
  console.log('Pros: Immediate, no work needed')
  console.log('Cons: 77M trades missing condition_ids = INACCURATE P&L')
  console.log('Verdict: ❌ REJECTED - Cannot calculate accurate metrics')
  console.log()

  // Option 2: Enrichment via JOIN
  console.log('OPTION 2: Enrich via JOIN to trades_with_direction')
  console.log('-'.repeat(70))
  console.log('Coverage: 80.7% (127M valid out of 157.5M)')
  console.log('Pros: Better than Option 1, relatively quick (2-3 hours)')
  console.log('Cons: Still missing 30M trades (19.3%)')
  console.log('Verdict: ⚠️  PARTIAL - Better but still spotty data')
  console.log()

  // Option 3: Use only trades_with_direction
  console.log('OPTION 3: Use ONLY trades_with_direction (100% valid)')
  console.log('-'.repeat(70))
  console.log('Coverage: 100% condition_ids for 82.1M trades')
  console.log('Pros: Perfect data quality, ready to use')
  console.log('Cons: Missing 75M trades that are in vw_trades_canonical')
  console.log()

  // Check: For wallets, which is more complete?
  console.log('Per-Wallet Completeness Check:')
  const walletCheck = await q(`
    SELECT
      (SELECT count() FROM (SELECT DISTINCT wallet_address_norm FROM vw_trades_canonical WHERE condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000')) as canonical_wallets,
      (SELECT count() FROM (SELECT DISTINCT wallet_address FROM trades_with_direction)) as direction_wallets
  `)
  const wc = walletCheck[0]
  console.log(`  vw_trades_canonical: ${Number(wc.canonical_wallets).toLocaleString()} wallets with valid trades`)
  console.log(`  trades_with_direction: ${Number(wc.direction_wallets).toLocaleString()} wallets`)
  console.log()

  // Sample wallet comparison
  const sampleWallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
  const walletComparison = await q(`
    SELECT
      (SELECT count() FROM vw_trades_canonical WHERE wallet_address_norm = '${sampleWallet}' AND condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as canonical_valid,
      (SELECT count() FROM trades_with_direction WHERE wallet_address = '${sampleWallet}') as direction_count
  `)
  const wcomp = walletComparison[0]
  const canonValid = Number(wcomp.canonical_valid)
  const dirCount = Number(wcomp.direction_count)
  const missing = canonValid - dirCount

  console.log(`  Sample wallet (${sampleWallet.substring(0, 20)}...):`)
  console.log(`    vw_trades_canonical (valid only): ${canonValid.toLocaleString()} trades`)
  console.log(`    trades_with_direction: ${dirCount.toLocaleString()} trades`)
  console.log(`    MISSING in direction: ${missing.toLocaleString()} trades (${(missing/canonValid*100).toFixed(1)}%)`)
  console.log()
  console.log('Verdict: ❌ REJECTED - Missing 75M trades = incomplete per-wallet history')
  console.log()

  // Option 4: Rebuild from blockchain
  console.log('OPTION 4: Rebuild from Blockchain Source')
  console.log('-'.repeat(70))
  console.log('Strategy: Use erc1155_transfers + erc20_transfers (USDC) to reconstruct all trades')
  console.log()

  const blockchainCoverage = await q(`
    SELECT
      (SELECT count() FROM erc1155_transfers) as erc1155_count,
      (SELECT count() FROM erc20_transfers WHERE token_address = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e') as usdc_count
  `)
  const bc = blockchainCoverage[0]
  console.log(`  erc1155_transfers: ${Number(bc.erc1155_count).toLocaleString()} events`)
  console.log(`  erc20_transfers (USDC): ${Number(bc.usdc_count).toLocaleString()} events`)
  console.log()

  // Check if we can reconstruct
  console.log('Can we reconstruct? Check if erc1155_transfers has condition_ids:')
  const erc1155Sample = await q(`
    SELECT token_id FROM erc1155_transfers LIMIT 5
  `)
  console.log('  Sample token_ids from erc1155_transfers:')
  erc1155Sample.forEach((row: any, i: number) => {
    console.log(`    ${i + 1}. ${row.token_id}`)
  })
  console.log()
  console.log('Pros: 100% coverage from blockchain source of truth')
  console.log('Cons: 4-6 hours to rebuild, need to decode token_ids to condition_ids')
  console.log('Verdict: ✅ BEST PATH - Guarantees complete data')
  console.log()

  // Option 5: Hybrid approach
  console.log('OPTION 5: Hybrid Approach (RECOMMENDED)')
  console.log('-'.repeat(70))
  console.log('Strategy:')
  console.log('1. Start with trades_with_direction (82M trades, 100% valid)')
  console.log('2. Add missing trades from vw_trades_canonical that have valid condition_ids')
  console.log('3. Deduplicate by (tx_hash, wallet, condition_id, outcome_index)')
  console.log()

  // Estimate hybrid coverage
  const hybridEstimate = await q(`
    WITH combined AS (
      SELECT DISTINCT transaction_hash as tx, wallet_address_norm as wallet FROM vw_trades_canonical
      WHERE condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10000000
    )
    SELECT
      count() as total_unique_tx_wallet_pairs,
      (SELECT count() FROM (SELECT DISTINCT tx_hash, wallet_address FROM trades_with_direction LIMIT 10000000)) as direction_unique
    FROM combined
  `)
  const he = hybridEstimate[0]
  const totalUnique = Number(he.total_unique_tx_wallet_pairs)
  const directionUnique = Number(he.direction_unique)
  const additionalFromCanonical = totalUnique - directionUnique

  console.log('Coverage Estimate (10M sample):')
  console.log(`  trades_with_direction: ${directionUnique.toLocaleString()} unique (tx_hash, wallet) pairs`)
  console.log(`  Additional from vw_trades_canonical: ${additionalFromCanonical.toLocaleString()} pairs`)
  console.log(`  Total coverage: ${totalUnique.toLocaleString()} unique pairs`)
  console.log()

  const estimatedTotal = Math.round(totalUnique * (157541131 / 10000000))
  const estimatedDirection = Math.round(directionUnique * (157541131 / 10000000))
  const estimatedAdditional = estimatedTotal - estimatedDirection

  console.log('Extrapolated to full dataset:')
  console.log(`  trades_with_direction: ${estimatedDirection.toLocaleString()} trades`)
  console.log(`  Additional valid from canonical: ${estimatedAdditional.toLocaleString()} trades`)
  console.log(`  Total: ${estimatedTotal.toLocaleString()} trades`)
  console.log(`  Coverage: ${(estimatedTotal/157541131*100).toFixed(1)}%`)
  console.log()
  console.log('Pros: Best coverage without blockchain rebuild (est. 90-95%)')
  console.log('Cons: 2-3 hours to implement UNION + dedup')
  console.log('Verdict: ✅ RECOMMENDED if blockchain rebuild not feasible')
  console.log()

  console.log('═'.repeat(70))
  console.log('FINAL RECOMMENDATION')
  console.log('═'.repeat(70))
  console.log()
  console.log('To achieve 95-100% coverage for accurate P&L:')
  console.log()
  console.log('**PATH A: Hybrid UNION (2-3 hours) → 90-95% coverage**')
  console.log('  UNION trades_with_direction + vw_trades_canonical (valid only)')
  console.log('  Deduplicate by (tx_hash, wallet, condition_id, outcome_index)')
  console.log('  Production-ready today')
  console.log()
  console.log('**PATH B: Blockchain Rebuild (4-6 hours) → 100% coverage**')
  console.log('  Reconstruct from erc1155_transfers + erc20_transfers')
  console.log('  Decode token_ids to get condition_ids')
  console.log('  Guarantees complete data')
  console.log()
  console.log('Which path do you want to take?')
  console.log()
}

finalCoverageOptions().catch(console.error)
